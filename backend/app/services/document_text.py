"""Text from a file a client uploads to their knowledge: PDF, Word (.docx), plain text,
Markdown or CSV. Only the text is kept; the file itself is not stored."""
from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

MAX_BYTES = 10 * 1024 * 1024
MAX_CHARS = 400_000
KINDS = (".pdf", ".docx", ".txt", ".md", ".csv")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ValueError("That PDF is password-protected. Upload a copy without a password.")
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise ValueError("That Word file could not be opened. Save it as .docx and try again.")
    root = ElementTree.fromstring(xml)
    paragraphs = []
    for p in root.iter(f"{_W}p"):
        text = "".join(t.text or "" for t in p.iter(f"{_W}t"))
        if text.strip():
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _plain(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower().strip()
    if not name.endswith(KINDS):
        raise ValueError("Upload a PDF, Word (.docx), text, Markdown or CSV file.")
    if len(data) > MAX_BYTES:
        raise ValueError("That file is over 10 MB. Split it or upload the most useful part.")
    try:
        text = _pdf(data) if name.endswith(".pdf") else _docx(data) if name.endswith(".docx") else _plain(data)
    except ValueError:
        raise
    except Exception:
        raise ValueError("That file could not be read. Check it opens on your computer and try again.")
    text = re.sub(r"[ \t]+", " ", text.replace("\x00", ""))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) < 20:
        raise ValueError("No readable text was found in that file (a scanned PDF has none). Upload a text version.")
    return text[:MAX_CHARS]
