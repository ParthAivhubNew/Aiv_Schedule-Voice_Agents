import logging
import re
import uuid
from typing import List, Tuple
from datetime import datetime
import httpx
from bs4 import BeautifulSoup
from sqlalchemy import delete
from sqlalchemy.future import select

from app.models.models import KnowledgeSource, KnowledgeChunk
from app.services.embedding_service import generate_embeddings_batch
from app.services.process_logger import log_process_event
import time

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 AIVHubCrawler/1.0"

def extract_clean_text_from_html(html: str) -> Tuple[str, str]:
    """
    Strips scripts, styles, navigation, headers, footers and extracts
    meaningful text and page title.
    """
    soup = BeautifulSoup(html, "html.parser")
    
    # Extract page title
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
        
    # Remove clutter elements
    for element in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "iframe", "button", "form"]):
        element.decompose()
        
    # Extract text from meaningful content blocks
    paragraphs = []
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "article", "section"]):
        text = tag.get_text(separator=" ", strip=True)
        if text and len(text) > 15:
            paragraphs.append(text)
            
    if not paragraphs:
        # Fallback to general stripped body text
        raw_text = soup.get_text(separator=" ", strip=True)
        cleaned = re.sub(r"\s+", " ", raw_text).strip()
        return title, cleaned
        
    cleaned = "\n\n".join(paragraphs)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return title, cleaned

def chunk_text(text: str, chunk_size: int = 550, overlap: int = 80) -> List[str]:
    """
    Splits text into overlapping sliding-window chunks around sentence/paragraph boundaries.
    """
    if not text:
        return []
    
    text = text.strip()
    if len(text) <= chunk_size:
        return [text]
        
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        # Try to break on a sentence boundary or newline if possible
        if end < len(text):
            boundary = text.rfind(". ", start, end)
            if boundary == -1:
                boundary = text.rfind("\n", start, end)
            if boundary == -1:
                boundary = text.rfind(" ", start, end)
                
            if boundary != -1 and boundary > start + (chunk_size // 2):
                end = boundary + 1
                
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
            
        start = max(start + 1, end - overlap)
        if start >= len(text):
            break
            
    return chunks

async def fetch_url_content(url: str) -> Tuple[str, str]:
    """
    Fetches URL content over HTTP with timeout and browser headers.
    """
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
        
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(url)
        response.raise_for_status()
        return extract_clean_text_from_html(response.text)

async def crawl_and_index_source_task(source_id: str, db_session_maker):
    """
    Background worker that fetches, cleans, chunks, embeds, and indexes a KnowledgeSource.
    Logs each step to the crawler_rag subsystem log.
    """
    start_time = time.time()
    async with db_session_maker() as session:
        try:
            # 1. Fetch source
            result = await session.execute(select(KnowledgeSource).where(KnowledgeSource.id == source_id))
            source = result.scalars().first()
            if not source:
                logger.warning(f"KnowledgeSource {source_id} not found for indexing.")
                return

            source.status = "crawling"
            await session.commit()

            await log_process_event(
                subsystem="crawler_rag",
                process_name="crawl_started",
                message=f"Beginning crawl and extraction for '{source.name}' ({source.type}): {source.value}",
                level="INFO",
                details={"sourceId": source_id, "type": source.type, "url": source.value}
            )

            title = source.name
            raw_text = ""

            # 2. Extract content based on source type
            if source.type == "Website URL":
                try:
                    fetched_title, content = await fetch_url_content(source.value)
                    if fetched_title and not source.name:
                        source.name = fetched_title
                    title = fetched_title or source.name
                    raw_text = content
                except Exception as fetch_err:
                    raise RuntimeError(f"Failed to crawl website: {str(fetch_err)}")
            elif source.type == "Manual text":
                raw_text = source.value
            else:
                # Document upload / Drive links
                raw_text = f"{source.name}: {source.value}"

            if not raw_text or len(raw_text.strip()) < 10:
                raise ValueError("No extractable content found in this knowledge source.")

            # 3. Create semantic chunks
            chunks = chunk_text(raw_text)
            if not chunks:
                chunks = [raw_text[:600]]

            await log_process_event(
                subsystem="crawler_rag",
                process_name="text_chunked",
                message=f"Cleaned {len(raw_text)} chars from '{title}' and split into {len(chunks)} semantic chunks",
                level="INFO",
                details={"sourceId": source_id, "title": title, "rawLength": len(raw_text), "chunkCount": len(chunks)}
            )

            # 4. Generate batch embeddings
            emb_start = time.time()
            embeddings = generate_embeddings_batch(chunks)
            emb_duration = (time.time() - emb_start) * 1000

            # 5. Delete old chunks for this source
            await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.source_id == source_id))

            # 6. Insert new chunks
            for idx, (chunk_content, emb) in enumerate(zip(chunks, embeddings)):
                chunk_obj = KnowledgeChunk(
                    id=f"chk_{uuid.uuid4().hex[:8]}",
                    source_id=source_id,
                    url=source.value if source.type == "Website URL" else None,
                    title=title,
                    content=chunk_content,
                    chunk_index=idx,
                    embedding=emb,
                    created_at=datetime.utcnow()
                )
                session.add(chunk_obj)

            # 7. Mark as indexed
            source.status = "indexed"
            source.chunk_count = len(chunks)
            source.crawled_at = datetime.utcnow()
            source.synced = "Just now"
            source.last_error = None
            await session.commit()
            
            total_duration = (time.time() - start_time) * 1000
            await log_process_event(
                subsystem="crawler_rag",
                process_name="indexing_complete",
                message=f"Successfully indexed '{source.name}' with {len(chunks)} vector chunks into pgvector",
                level="SUCCESS",
                details={"sourceId": source_id, "chunkCount": len(chunks), "embeddingLatencyMs": round(emb_duration, 1)},
                duration_ms=round(total_duration, 1)
            )

        except Exception as e:
            logger.error(f"Error crawling/indexing knowledge source {source_id}: {e}", exc_info=True)
            await log_process_event(
                subsystem="crawler_rag",
                process_name="crawl_error",
                message=f"Crawl/index failed for source {source_id}: {str(e)}",
                level="ERROR",
                details={"sourceId": source_id, "error": str(e)}
            )
            try:
                result = await session.execute(select(KnowledgeSource).where(KnowledgeSource.id == source_id))
                source = result.scalars().first()
                if source:
                    source.status = "failed"
                    source.last_error = str(e)
                    await session.commit()
            except Exception as rollback_err:
                logger.error(f"Error updating failed state for {source_id}: {rollback_err}")
