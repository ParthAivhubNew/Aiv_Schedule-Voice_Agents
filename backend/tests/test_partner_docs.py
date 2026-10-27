"""The partner guides are public web pages built from backend/docs/partners/*.md."""
from app.api import partner_docs as P
from app.services import mini_markdown as MD


def test_markdown_basics_and_escaping():
    out = MD.render("# Title\n\nSome `code` and **bold** <script>x</script>\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nGET /x <y>\n```")
    assert '<h1 id="title">Title</h1>' in out and "<code>code</code>" in out and "<strong>bold</strong>" in out
    assert "<script>" not in out and "&lt;script&gt;" in out
    assert "<ul><li>one</li><li>two</li></ul>" in out and "<th>a</th>" in out and "<td>2</td>" in out
    assert "GET /x &lt;y&gt;" in out


def test_the_team_only_section_and_its_contents_line_are_dropped():
    text = "- [Go live](#go-live)\n- [Deploying this (for the Outreach team)](#d)\n\n## Go live\nA\n\n## Deploying this (for the Outreach team)\nsecret\n\n## Next\nB\n"
    out = MD.drop_section(text, "for the Outreach team")
    assert "secret" not in out and "Deploying" not in out and "## Go live" in out and "## Next" in out


def test_each_guide_renders_without_the_team_section_and_links_to_the_other():
    for name in ("start", "embed", "api"):
        page = P._guide_html(name)
        assert "<h2" in page and "Deploying this" not in page
    assert "/docs/partners/start" in P._guide_html("embed") and "start.md" not in P._guide_html("embed")


def test_the_pages_can_be_framed_by_the_app_but_no_other_site():
    page = P._page("t", "<p>x</p>")
    assert page.headers["x-frame-options"] == "SAMEORIGIN"
