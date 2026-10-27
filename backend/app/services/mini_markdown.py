"""Turns the partner guides (plain markdown in backend/docs) into HTML. Covers what those files use: headings, paragraphs, lists,
tables, fenced code, block quotes, rules, and inline code, bold, italic and links. Everything is escaped first, so a stray tag in
a guide shows as text."""
from __future__ import annotations

import html
import re
from typing import Callable, List

_SLUG_DROP = re.compile(r"[^a-z0-9 -]")


def slug(text: str) -> str:
    return _SLUG_DROP.sub("", re.sub(r"[`*_]", "", text).lower()).strip().replace(" ", "-")


def _inline(text: str, link: Callable[[str], str]) -> str:
    out = html.escape(text, quote=False)
    codes: List[str] = []

    def keep(m: "re.Match[str]") -> str:
        codes.append(f"<code>{m.group(1)}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = re.sub(r"`([^`]+)`", keep, out)
    out = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", lambda m: f'<a href="{html.escape(link(html.unescape(m.group(2))), quote=True)}">{m.group(1)}</a>', out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def _cells(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def render(source: str, link: Callable[[str], str] = lambda href: href) -> str:
    lines = source.replace("\r\n", "\n").split("\n")
    out: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            block: List[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            out.append(f"<pre><code>{html.escape(chr(10).join(block), quote=False)}</code></pre>")
        elif re.match(r"^#{1,4} ", line):
            level = len(line) - len(line.lstrip("#"))
            text = line[level:].strip()
            out.append(f'<h{level} id="{slug(text)}">{_inline(text, link)}</h{level}>')
            i += 1
        elif re.match(r"^\s*([-*]|\d+\.) ", line):
            ordered = bool(re.match(r"^\s*\d+\. ", line))
            items: List[str] = []
            while i < len(lines) and re.match(r"^\s*([-*]|\d+\.) ", lines[i]):
                item = re.sub(r"^\s*([-*]|\d+\.) ", "", lines[i])
                i += 1
                while i < len(lines) and lines[i].startswith("   ") and lines[i].strip() and not re.match(r"^\s*([-*]|\d+\.) ", lines[i]):
                    item += " " + lines[i].strip()
                    i += 1
                items.append(f"<li>{_inline(item, link)}</li>")
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>{''.join(items)}</{tag}>")
        elif line.lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]):
            head = _cells(line)
            i += 2
            rows: List[List[str]] = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            th = "".join(f"<th>{_inline(c, link)}</th>" for c in head)
            body = "".join("<tr>" + "".join(f"<td>{_inline(c, link)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="wide"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>')
        elif line.startswith(">"):
            quote: List[str] = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip(">").strip())
                i += 1
            text = " ".join(quote)
            kind = "tip" if text.startswith("**Tip") else "warn" if text.startswith("**Careful") else "note"
            out.append(f'<blockquote class="{kind}">{_inline(text, link)}</blockquote>')
        elif re.match(r"^-{3,}$", line.strip()):
            out.append("<hr>")
            i += 1
        elif not line.strip():
            i += 1
        else:
            para: List[str] = []
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |```|>|\s*([-*]|\d+\.) |\s*\|)", lines[i]):
                para.append(lines[i].strip())
                i += 1
            if not para:  # a line that matched no rule above must still move on
                para, i = [lines[i].strip()], i + 1
            out.append(f"<p>{_inline(' '.join(para), link)}</p>")
    return "\n".join(out)


def drop_section(source: str, heading_contains: str) -> str:
    """Removes a '## ' section (and the contents-list line that points at it) from the guide."""
    kept: List[str] = []
    skipping = False
    for line in source.split("\n"):
        if line.startswith("## "):
            skipping = heading_contains.lower() in line.lower()
        if skipping:
            continue
        if line.lstrip().startswith("- [") and heading_contains.lower() in line.lower():
            continue
        kept.append(line)
    return "\n".join(kept)


def headings(source: str, level: int = 2) -> List[tuple]:
    """(id, text) of each heading at the given level, outside code blocks, for a contents list."""
    found: List[tuple] = []
    in_code = False
    for line in source.split(chr(10)):
        if line.startswith("```"):
            in_code = not in_code
        elif not in_code and line.startswith("#" * level + " "):
            text = line[level:].strip()
            found.append((slug(text), re.sub(r"[`*]", "", text)))
    return found
