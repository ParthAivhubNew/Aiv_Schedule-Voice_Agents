import logging
from typing import List

logger = logging.getLogger(__name__)

_embed_model = None

def get_embedding_model():
    """
    Lazy-loads fastembed TextEmbedding model (BAAI/bge-small-en-v1.5, 384 dimensions).
    Runs 100% locally on CPU with zero external API calls.
    """
    global _embed_model
    if _embed_model is None:
        try:
            from fastembed import TextEmbedding
            # BAAI/bge-small-en-v1.5 is a top-ranking 384-dim compact embedding model
            _embed_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
            logger.info("FastEmbed initialized successfully with BAAI/bge-small-en-v1.5 (384 dims).")
        except Exception as e:
            logger.warning(f"FastEmbed not available or failed to load: {e}. Using deterministic fallback.")
            _embed_model = False
    return _embed_model

def generate_embedding(text: str) -> List[float]:
    """Generates a 384-dimensional vector embedding for a single text chunk."""
    model = get_embedding_model()
    if model:
        try:
            embeddings = list(model.embed([text]))
            return [float(x) for x in embeddings[0]]
        except Exception as e:
            logger.error(f"Error generating embedding with fastembed: {e}")
    
    # Fallback deterministic pseudo-embedding (384 float dimensions) if model is not loaded yet
    import hashlib
    import math
    seed = int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16) % (10**8)
    return [math.sin(seed + i) for i in range(384)]

def generate_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """Generates 384-dimensional vector embeddings for multiple text chunks in batch."""
    if not texts:
        return []
    model = get_embedding_model()
    if model:
        try:
            embeddings = list(model.embed(texts))
            return [[float(x) for x in emb] for emb in embeddings]
        except Exception as e:
            logger.error(f"Error generating batch embeddings with fastembed: {e}")
            
    return [generate_embedding(t) for t in texts]
