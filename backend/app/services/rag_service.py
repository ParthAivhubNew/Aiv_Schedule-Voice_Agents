import logging
import math
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import KnowledgeChunk
from app.services.embedding_service import generate_embedding

logger = logging.getLogger(__name__)

def python_cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """Calculates cosine similarity between two numeric vectors in python."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)

async def search_knowledge(
    db: AsyncSession,
    query: str,
    top_k: int = 3,
    min_score: float = 0.45
) -> List[Dict[str, Any]]:
    """
    Finds the most semantically relevant knowledge chunks for a given question or phrase.
    Uses PostgreSQL pgvector cosine distance if available, with graceful Python fallback for SQLite.
    """
    if not query or not query.strip():
        return []

    query_embedding = generate_embedding(query.strip())
    results: List[Dict[str, Any]] = []

    # 1. Try native PostgreSQL pgvector cosine distance
    try:
        stmt = (
            select(
                KnowledgeChunk,
                (1 - KnowledgeChunk.embedding.cosine_distance(query_embedding)).label("score")
            )
            .where(KnowledgeChunk.embedding.isnot(None))
            .order_by(KnowledgeChunk.embedding.cosine_distance(query_embedding))
            .limit(top_k)
        )
        query_res = await db.execute(stmt)
        rows = query_res.all()

        for chunk_obj, score in rows:
            calc_score = float(score) if score is not None else 0.0
            if calc_score >= min_score:
                results.append({
                    "id": chunk_obj.id,
                    "source_id": chunk_obj.source_id,
                    "title": chunk_obj.title,
                    "content": chunk_obj.content,
                    "url": chunk_obj.url,
                    "score": round(calc_score, 4)
                })
        return results

    except Exception as pg_err:
        logger.debug(f"pgvector query fallback to in-memory evaluation: {pg_err}")

    # 2. Resilient fallback: in-memory calculation (e.g. SQLite or when running tests)
    try:
        stmt = select(KnowledgeChunk)
        all_chunks_res = await db.execute(stmt)
        all_chunks = all_chunks_res.scalars().all()

        scored_chunks = []
        for chk in all_chunks:
            emb = chk.embedding
            if isinstance(emb, list) and len(emb) == len(query_embedding):
                sim = python_cosine_similarity(query_embedding, emb)
                if sim >= min_score:
                    scored_chunks.append((sim, chk))

        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        top_matches = scored_chunks[:top_k]

        for sim, chk in top_matches:
            results.append({
                "id": chk.id,
                "source_id": chk.source_id,
                "title": chk.title,
                "content": chk.content,
                "url": chk.url,
                "score": round(sim, 4)
            })

    except Exception as fb_err:
        logger.error(f"Error in knowledge search fallback: {fb_err}", exc_info=True)

    return results

async def build_rag_prompt_context(db: AsyncSession, user_utterance: str, top_k: int = 3) -> str:
    """
    Formats the top matching knowledge snippets into a clean, concise prompt block
    for the Voice LLM during telephone conversations.
    """
    matches = await search_knowledge(db, user_utterance, top_k=top_k)
    if not matches:
        return ""

    context_lines = ["--- VERIFIED COMPANY KNOWLEDGE RETRIEVED FOR CALL ---"]
    for idx, m in enumerate(matches, 1):
        context_lines.append(f"[{idx}] Source: {m['title'] or 'Company Doc'}")
        context_lines.append(f"{m['content']}")
        context_lines.append("")
    context_lines.append("-----------------------------------------------------")

    return "\n".join(context_lines)
