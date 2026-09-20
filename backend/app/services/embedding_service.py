import os
import re
import math
import hashlib
import logging
from typing import List, Dict, Any, Optional
import httpx

logger = logging.getLogger(__name__)

TARGET_DIM = 384
DEFAULT_LOCAL_MODEL = "BAAI/bge-small-en-v1.5"

_fastembed_cache: Dict[str, Any] = {}
_active_config: Dict[str, Any] = {
    "model": DEFAULT_LOCAL_MODEL,
    "provider": "builtin",
    "api_key": None,
    "base_url": None,
}


def normalize_and_clamp_dim(vec: List[float], target_dim: int = TARGET_DIM) -> List[float]:
    """
    Ensures vector has exactly target_dim (384) floats and is unit-normalized (L2 norm = 1.0).
    Guarantees 100% compatibility with PostgreSQL Vector(384) and python_cosine_similarity.
    """
    if not vec:
        return [0.0] * target_dim

    if len(vec) > target_dim:
        vec = vec[:target_dim]
    elif len(vec) < target_dim:
        vec = list(vec) + [0.0] * (target_dim - len(vec))

    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 1e-9:
        return [float(x / norm) for x in vec]
    return [float(x) for x in vec]


def deterministic_fallback_embedding(text: str, target_dim: int = TARGET_DIM) -> List[float]:
    """
    Deterministic pseudo-embedding (384 floats, L2-normalized) used if offline/fallback.
    Ensures crawl indexing and knowledge queries never fail or throw dimensional errors.
    """
    seed = int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % (10**8)
    raw = [math.sin(seed + i * 0.71) + math.cos(seed + i * 1.37) for i in range(target_dim)]
    norm = math.sqrt(sum(x * x for x in raw))
    return [float(x / norm) for x in raw]


def clean_model_name(raw: str) -> str:
    """Strips UI parenthetical annotations like '(local CPU)', '(OpenAI)', etc."""
    cleaned = re.sub(r"\s*\([^)]*\)", "", str(raw or "")).strip()
    if cleaned.lower() == "all-minilm-l6-v2":
        return "sentence-transformers/all-MiniLM-L6-v2"
    return cleaned or DEFAULT_LOCAL_MODEL


def set_active_embedding_config(
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
):
    """Sets active embedding configuration in memory."""
    global _active_config
    if model:
        _active_config["model"] = model
    if provider:
        _active_config["provider"] = provider
    if api_key is not None:
        _active_config["api_key"] = api_key
    if base_url is not None:
        _active_config["base_url"] = base_url
    logger.info(f"Active embedding config updated: model={_active_config.get('model')}, provider={_active_config.get('provider')}")


def get_active_embedding_config() -> Dict[str, Any]:
    return dict(_active_config)


def get_fastembed_model(model_name: str = DEFAULT_LOCAL_MODEL):
    """Lazy-loads FastEmbed TextEmbedding model by name and caches in memory."""
    clean_name = clean_model_name(model_name)
    if clean_name in _fastembed_cache:
        return _fastembed_cache[clean_name]

    try:
        from fastembed import TextEmbedding
        logger.info(f"Initializing FastEmbed model '{clean_name}'...")
        m = TextEmbedding(model_name=clean_name)
        _fastembed_cache[clean_name] = m
        logger.info(f"FastEmbed model '{clean_name}' loaded successfully.")
        return m
    except Exception as e:
        logger.warning(f"FastEmbed failed for '{clean_name}': {e}. Trying default '{DEFAULT_LOCAL_MODEL}'...")
        if clean_name != DEFAULT_LOCAL_MODEL:
            try:
                from fastembed import TextEmbedding
                if DEFAULT_LOCAL_MODEL not in _fastembed_cache:
                    _fastembed_cache[DEFAULT_LOCAL_MODEL] = TextEmbedding(model_name=DEFAULT_LOCAL_MODEL)
                return _fastembed_cache[DEFAULT_LOCAL_MODEL]
            except Exception as e2:
                logger.error(f"FastEmbed default model fallback failed: {e2}")
        return None


def get_embedding_model():
    """Legacy backward-compatibility getter for default FastEmbed model."""
    return get_fastembed_model(DEFAULT_LOCAL_MODEL)


async def resolve_config_from_db(db) -> Dict[str, Any]:
    """Queries DB connections to detect custom or external embedding providers."""
    cfg = get_active_embedding_config()
    if db is None:
        return cfg

    try:
        from app.models.models import Connection
        from app.services.secret_box import config_get_secret
        from sqlalchemy.future import select

        stmt = select(Connection)
        result = await db.execute(stmt)
        conns = result.scalars().all()

        # 1. Look for explicit Embeddings connection
        for c in conns:
            c_group = (c.group_name or "").lower()
            c_name = (c.name or "").lower()
            if "embed" in c_group or "embed" in c_name or "rag" in c_group:
                c_cfg = c.config or {}
                k = config_get_secret(c_cfg, "api_key", "apiKey", "auth_token")
                m = c_cfg.get("model") or cfg.get("model")
                burl = c_cfg.get("base_url") or c_cfg.get("baseUrl") or cfg.get("base_url")
                p = c_cfg.get("provider") or ("openai" if ("text-embedding" in str(m) or (k and k.startswith("sk-"))) else "custom")
                if k or "ollama" in str(p).lower() or "builtin" in str(p).lower():
                    cfg.update({"model": m, "provider": p, "api_key": k, "base_url": burl})
                    return cfg

        # 2. Look for OpenAI connection if current model is OpenAI
        current_model = str(cfg.get("model", "")).lower()
        if "text-embedding" in current_model or "openai" in current_model:
            for c in conns:
                c_name = (c.name or "").lower()
                c_group = (c.group_name or "").lower()
                if "openai" in c_name or ("llm" in c_group and "openai" in c_name):
                    c_cfg = c.config or {}
                    k = config_get_secret(c_cfg, "api_key", "apiKey", "auth_token")
                    if k:
                        cfg["api_key"] = k
                        cfg["provider"] = "openai"
                        if not cfg.get("base_url"):
                            cfg["base_url"] = c_cfg.get("base_url") or c_cfg.get("baseUrl")
                        return cfg

    except Exception as ex:
        logger.debug(f"Could not resolve embedding config from DB: {ex}")

    return cfg


# --- Synchronous & Asynchronous Embedding Engine ---

def _embed_openai_sync(texts: List[str], model: str, api_key: str, base_url: Optional[str] = None) -> List[List[float]]:
    clean_base = (base_url or "https://api.openai.com/v1").strip().rstrip("/")
    endpoint = clean_base if clean_base.endswith("/embeddings") else f"{clean_base}/embeddings"
    clean_mod = clean_model_name(model)

    payload: Dict[str, Any] = {
        "model": clean_mod,
        "input": texts,
    }
    if "text-embedding-3" in clean_mod:
        payload["dimensions"] = TARGET_DIM

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=15.0) as client:
        res = client.post(endpoint, headers=headers, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"OpenAI Embeddings error {res.status_code}: {res.text[:200]}")
        data = res.json().get("data", [])
        data_sorted = sorted(data, key=lambda x: x.get("index", 0))
        return [normalize_and_clamp_dim(item["embedding"], TARGET_DIM) for item in data_sorted]


async def _embed_openai_async(texts: List[str], model: str, api_key: str, base_url: Optional[str] = None) -> List[List[float]]:
    clean_base = (base_url or "https://api.openai.com/v1").strip().rstrip("/")
    endpoint = clean_base if clean_base.endswith("/embeddings") else f"{clean_base}/embeddings"
    clean_mod = clean_model_name(model)

    payload: Dict[str, Any] = {
        "model": clean_mod,
        "input": texts,
    }
    if "text-embedding-3" in clean_mod:
        payload["dimensions"] = TARGET_DIM

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(endpoint, headers=headers, json=payload)
        if res.status_code != 200:
            raise RuntimeError(f"OpenAI Embeddings error {res.status_code}: {res.text[:200]}")
        data = res.json().get("data", [])
        data_sorted = sorted(data, key=lambda x: x.get("index", 0))
        return [normalize_and_clamp_dim(item["embedding"], TARGET_DIM) for item in data_sorted]


def _embed_ollama_sync(texts: List[str], model: str, base_url: Optional[str] = None) -> List[List[float]]:
    clean_base = (base_url or "http://localhost:11434").strip().rstrip("/")
    clean_mod = clean_model_name(model)
    results = []

    with httpx.Client(timeout=20.0) as client:
        try:
            res = client.post(f"{clean_base}/api/embed", json={"model": clean_mod, "input": texts})
            if res.status_code == 200:
                data = res.json().get("embeddings", [])
                if len(data) == len(texts):
                    return [normalize_and_clamp_dim(emb, TARGET_DIM) for emb in data]
        except Exception:
            pass

        for t in texts:
            r = client.post(f"{clean_base}/api/embeddings", json={"model": clean_mod, "prompt": t})
            if r.status_code == 200:
                vec = r.json().get("embedding", [])
                results.append(normalize_and_clamp_dim(vec, TARGET_DIM))
            else:
                results.append(deterministic_fallback_embedding(t, TARGET_DIM))
    return results


async def _embed_ollama_async(texts: List[str], model: str, base_url: Optional[str] = None) -> List[List[float]]:
    clean_base = (base_url or "http://localhost:11434").strip().rstrip("/")
    clean_mod = clean_model_name(model)
    results = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            res = await client.post(f"{clean_base}/api/embed", json={"model": clean_mod, "input": texts})
            if res.status_code == 200:
                data = res.json().get("embeddings", [])
                if len(data) == len(texts):
                    return [normalize_and_clamp_dim(emb, TARGET_DIM) for emb in data]
        except Exception:
            pass

        for t in texts:
            r = await client.post(f"{clean_base}/api/embeddings", json={"model": clean_mod, "prompt": t})
            if r.status_code == 200:
                vec = r.json().get("embedding", [])
                results.append(normalize_and_clamp_dim(vec, TARGET_DIM))
            else:
                results.append(deterministic_fallback_embedding(t, TARGET_DIM))
    return results


def _embed_fastembed(texts: List[str], model_name: str) -> Optional[List[List[float]]]:
    clean_name = clean_model_name(model_name)
    m = get_fastembed_model(clean_name)
    if m is None:
        return None
    try:
        embeddings = list(m.embed(texts))
        return [normalize_and_clamp_dim([float(x) for x in emb], TARGET_DIM) for emb in embeddings]
    except Exception as e:
        logger.error(f"Error during FastEmbed generation for '{clean_name}': {e}")
        return None


# --- Public High-Level Interface ---

def generate_embeddings_batch(
    texts: List[str],
    db=None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[List[float]]:
    """Generates 384-dimensional vector embeddings for multiple text chunks synchronously."""
    if not texts:
        return []

    active_model = model or _active_config.get("model") or DEFAULT_LOCAL_MODEL
    active_prov = (provider or _active_config.get("provider") or "builtin").lower()
    active_key = api_key or _active_config.get("api_key") or os.environ.get("OPENAI_API_KEY")
    active_burl = base_url or _active_config.get("base_url")

    # 1. External OpenAI / OpenAI-compatible
    if "text-embedding" in active_model.lower() or "openai" in active_prov or (active_key and not "ollama" in active_prov and not "builtin" in active_prov):
        if active_key:
            try:
                return _embed_openai_sync(texts, active_model, active_key, active_burl)
            except Exception as ex:
                logger.error(f"OpenAI embedding batch call failed: {ex}. Falling back to FastEmbed/local.")

    # 2. Local Ollama
    if "ollama" in active_prov or "ollama" in active_model.lower():
        try:
            return _embed_ollama_sync(texts, active_model, active_burl)
        except Exception as ex:
            logger.error(f"Ollama embedding batch call failed: {ex}. Falling back to FastEmbed/local.")

    # 3. Local FastEmbed (CPU)
    fastembed_res = _embed_fastembed(texts, active_model)
    if fastembed_res:
        return fastembed_res

    # 4. Rock-solid deterministic pseudo-embedding fallback
    logger.warning("Using deterministic fallback vector embeddings.")
    return [deterministic_fallback_embedding(t, TARGET_DIM) for t in texts]


def generate_embedding(
    text: str,
    db=None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[float]:
    """Generates a 384-dimensional vector embedding for a single text chunk synchronously."""
    batch = generate_embeddings_batch([text], db=db, model=model, provider=provider, api_key=api_key, base_url=base_url)
    return batch[0] if batch else deterministic_fallback_embedding(text, TARGET_DIM)


async def generate_embeddings_batch_async(
    texts: List[str],
    db=None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[List[float]]:
    """Generates 384-dimensional vector embeddings for multiple text chunks asynchronously."""
    if not texts:
        return []

    cfg = await resolve_config_from_db(db) if db is not None else get_active_embedding_config()
    active_model = model or cfg.get("model") or DEFAULT_LOCAL_MODEL
    active_prov = (provider or cfg.get("provider") or "builtin").lower()
    active_key = api_key or cfg.get("api_key") or os.environ.get("OPENAI_API_KEY")
    active_burl = base_url or cfg.get("base_url")

    # 1. External OpenAI / OpenAI-compatible
    if "text-embedding" in active_model.lower() or "openai" in active_prov or (active_key and not "ollama" in active_prov and not "builtin" in active_prov):
        if active_key:
            try:
                return await _embed_openai_async(texts, active_model, active_key, active_burl)
            except Exception as ex:
                logger.error(f"OpenAI async embedding batch call failed: {ex}. Falling back to FastEmbed/local.")

    # 2. Local Ollama
    if "ollama" in active_prov or "ollama" in active_model.lower():
        try:
            return await _embed_ollama_async(texts, active_model, active_burl)
        except Exception as ex:
            logger.error(f"Ollama async embedding batch call failed: {ex}. Falling back to FastEmbed/local.")

    # 3. Local FastEmbed (CPU)
    fastembed_res = _embed_fastembed(texts, active_model)
    if fastembed_res:
        return fastembed_res

    # 4. Rock-solid deterministic pseudo-embedding fallback
    logger.warning("Using deterministic fallback vector embeddings.")
    return [deterministic_fallback_embedding(t, TARGET_DIM) for t in texts]


async def generate_embedding_async(
    text: str,
    db=None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[float]:
    """Generates a 384-dimensional vector embedding for a single text chunk asynchronously."""
    batch = await generate_embeddings_batch_async([text], db=db, model=model, provider=provider, api_key=api_key, base_url=base_url)
    return batch[0] if batch else deterministic_fallback_embedding(text, TARGET_DIM)
