"""Knowledge file upload for Voice AI: PDF, Word, text; bad files refused; only text kept."""
import io
import zipfile

import pytest

pytestmark = pytest.mark.db


def _pdf(text: str) -> bytes:
    """A one-page PDF with real text (what a typed document exported to PDF contains)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, obj in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def _docx(paragraphs) -> bytes:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def test_text_from_each_kind():
    from app.services.document_text import extract_text

    assert "Window cleaning costs 40 pounds" in extract_text("prices.pdf", _pdf("Window cleaning costs 40 pounds a month."))
    assert extract_text("faq.docx", _docx(["We work Saturdays.", "Parking is free."])) == "We work Saturdays.\nParking is free."
    assert extract_text("notes.md", "# Hours\nMonday to Friday, 9 to 5.".encode()) == "# Hours\nMonday to Friday, 9 to 5."
    assert "Café" in extract_text("menu.txt", "Café open from eight in the morning.".encode("cp1252"))
    for name, data, says in [
        ("deck.pptx", b"x" * 100, "Upload a PDF"),
        ("blank.pdf", _pdf(""), "No readable text"),
        ("broken.docx", b"not a zip file at all", "could not be opened"),
        ("big.txt", b"a" * (10 * 1024 * 1024 + 1), "over 10 MB"),
    ]:
        with pytest.raises(ValueError, match=says):
            extract_text(name, data)


async def test_upload_adds_a_source_and_indexes_it(client, monkeypatch):
    started = []

    async def fake_index(source_id, session_maker):
        started.append(source_id)

    monkeypatch.setattr("app.api.profile.crawl_and_index_source_task", fake_index)
    long_text = "Our prices. " + "Gutter cleaning is 60 pounds. " * 40
    r = await client.post("/api/profile/sources/upload", data={"name": "Price list"},
                          files={"file": ("prices.txt", long_text.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Price list" and started == [r.json()["id"]]
    listed = {s["id"]: s for s in (await client.get("/api/profile/sources")).json()}
    row = listed[r.json()["id"]]
    assert row["type"] == "File upload" and len(row["value"]) == 300  # the list shows the start only

    bad = await client.post("/api/profile/sources/upload", files={"file": ("slides.pptx", b"zzz", "application/octet-stream")})
    assert bad.status_code == 400 and "Upload a PDF" in bad.json()["detail"]


async def test_uploaded_text_is_what_gets_indexed(db, monkeypatch):
    """The indexer treats an uploaded file's text like pasted text (not a link to fetch)."""
    from sqlalchemy.future import select

    from app.database import AsyncSessionLocal
    from app.models.models import KnowledgeChunk, KnowledgeSource
    from app.services import crawler_service

    async def fake_embeddings(chunks, db=None):
        return [[0.0] * 384 for _ in chunks]

    monkeypatch.setattr(crawler_service, "generate_embeddings_batch_async", fake_embeddings)
    db.add(KnowledgeSource(id="k_up", name="FAQ", type="File upload", value="We work Saturdays from nine until one. Parking is free.",
                           status="pending", chunk_count=0))
    await db.commit()
    await crawler_service.crawl_and_index_source_task("k_up", AsyncSessionLocal)
    async with AsyncSessionLocal() as s:
        src = (await s.execute(select(KnowledgeSource).where(KnowledgeSource.id == "k_up"))).scalars().first()
        chunks = (await s.execute(select(KnowledgeChunk).where(KnowledgeChunk.source_id == "k_up"))).scalars().all()
    assert src.status == "indexed", src.last_error
    assert chunks and "Saturdays" in chunks[0].content
