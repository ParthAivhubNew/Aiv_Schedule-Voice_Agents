import io
import re
import shutil
import subprocess
import zipfile

import pytest

from app.api import partner_docs as DOCS
from app.partner_kit import PASS, STACKS, build, server_file, snippet

ARGS = dict(client_id="pk_abc123", host="https://outreach.example.test/", origin="https://app.partner.test", company='Acme "Rockets" <Ltd>')
SNIPPETS = ("panel.html", "popup.html", "drawer.html", "full-page.html", "OutreachScreen.jsx")


def files(stack):
    z = zipfile.ZipFile(io.BytesIO(build(stack, **ARGS)))
    return {n: z.read(n).decode("utf-8") for n in z.namelist()}


@pytest.mark.parametrize("stack", list(STACKS))
def test_kit_is_filled_in_and_has_no_secret(stack):
    kit = files(stack)
    joined = "\n".join(kit.values())
    assert not re.search(r"\{\{[A-Z_]+\}\}", joined)          # every placeholder is filled
    assert "pk_abc123" in joined and "https://outreach.example.test" in joined
    assert "https://outreach.example.test//" not in joined      # the trailing slash of the host is dropped
    assert not re.search(r"psk_(live|test)_[A-Za-z0-9]{12,}", joined)  # a key can be named in the notes, but none is in the kit
    assert "psk_test_paste" in kit[".env.example"]                     # the .env file holds a placeholder only
    assert "check.mjs" in kit and "START-HERE.txt" in kit
    assert any(n.endswith("outreach-test.html") for n in kit)


@pytest.mark.parametrize("stack", list(STACKS))
def test_every_kit_ships_the_same_page_snippets_filled_in(stack):
    kit = files(stack)
    for name in SNIPPETS:
        assert f"snippets/{name}" in kit
    for name in SNIPPETS[:4]:
        text = kit[f"snippets/{name}"]
        assert 'data-key="pk_abc123"' in text and f'data-pass="{PASS.get(stack, "/outreach-start")}"' in text
        assert 'src="https://outreach.example.test/embed.js"' in text


def test_files_land_where_the_project_expects_them():
    assert {"outreach-vite.mjs", "outreach-vite.d.mts", "public/outreach-test.html"} <= set(files("vite"))
    assert {"outreach-express.mjs", "public/outreach-test.html"} <= set(files("node"))
    assert {"app/outreach-start/route.js", "public/outreach-test.html"} <= set(files("next"))
    assert {"outreach_flask.py", "outreach-test.html"} <= set(files("python"))
    assert {"outreach-start.php", "outreach-test.html"} <= set(files("php"))


def test_the_test_page_is_the_panel_snippet_so_what_they_test_is_what_they_paste():
    page = files("vite")["public/outreach-test.html"]
    for line in snippet("panel.html", client_id="pk_abc123", host="https://outreach.example.test").splitlines():
        if line.strip() and not line.lstrip().startswith(("<!--", "The screen can be")) and "-->" not in line:
            assert line.strip() in page


def test_company_name_is_escaped_in_the_page_but_kept_in_the_notes():
    kit = files("vite")
    assert "&lt;Ltd&gt;" in kit["public/outreach-test.html"] and "<Ltd>" not in kit["public/outreach-test.html"]
    assert 'Acme "Rockets" <Ltd>' in kit["START-HERE.txt"]


def test_start_here_names_the_partners_own_address_and_the_right_pass_address():
    assert "node check.mjs https://app.partner.test" in files("vite")["START-HERE.txt"]
    assert "/outreach-start.php" in files("php")["check.mjs"] and "/outreach-start.php" not in files("vite")["check.mjs"]


def test_the_notes_are_short_and_numbered_with_one_edit_to_make():
    for stack, steps in (("vite", 4), ("node", 4), ("next", 3), ("python", 4), ("php", 3)):
        notes = files(stack)["START-HERE.txt"]
        assert all(f"STEP {i} -" in notes for i in range(1, steps + 1))
        assert f"STEP {steps + 1} -" not in notes
        assert "node check.mjs https://app.partner.test" in notes and "outreach-server" not in notes and "proxy" not in notes
        assert "snippets" in notes and "SHOW IT YOUR WAY" in notes


def test_the_docs_show_the_very_files_the_kit_ships():
    page = DOCS._guide_html("snippets")
    unescaped = page.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#x27;", "'").replace("&amp;", "&")
    for name in SNIPPETS:
        for line in snippet(name).splitlines():
            if line.strip():
                assert line.strip() in unescaped, (name, line)
    for stack in ("vite", "node", "next", "python", "php"):
        _, text = server_file(stack)
        for line in [l for l in text.splitlines() if l.strip()][:12]:
            assert line.strip() in unescaped, (stack, line)
    assert not re.search(r"\{\{(snippet|server|HOST)", page)


def test_every_server_file_is_named_after_its_tool_and_the_notes_use_that_exact_name():
    names = {"vite": "outreach-vite.mjs", "node": "outreach-express.mjs", "next": "app/outreach-start/route.js", "python": "outreach_flask.py", "php": "outreach-start.php"}
    for stack, name in names.items():
        kit = files(stack)
        assert name in kit
        assert f"THE ONE FILE THAT MATTERS IN THIS KIT:  {name}" in kit["START-HERE.txt"]
        others = [n for k, n in names.items() if k != stack and not n.startswith("app/") and n != "outreach-start.php"]
        assert not any(o in kit["START-HERE.txt"] for o in others)      # a kit never names another tool's file
    assert 'import outreach from "./outreach-vite.mjs";' in files("vite")["START-HERE.txt"]
    assert 'import outreach from "./outreach-express.mjs";' in files("node")["START-HERE.txt"] and "app.use(outreach());" in files("node")["START-HERE.txt"]
    assert "from outreach_flask import outreach" in files("python")["START-HERE.txt"]


def test_the_docs_use_the_same_file_names_and_lines_as_the_kit():
    for name in ("snippets", "start"):
        page = DOCS._guide_html(name).replace("&quot;", '"')
        for token in ("outreach-vite.mjs", "outreach-express.mjs", "outreach_flask.py", "outreach-start.php", "app/outreach-start/route.js"):
            assert token in page, (name, token)
        for old in ("outreach-plugin", "outreach-routes", "mountOutreach", "outreach_pass", "app/api/outreach-start"):
            assert old not in page, (name, old)
    assert 'import outreach from "./outreach-vite.mjs";' in DOCS._guide_html("snippets").replace("&quot;", '"')


def test_the_checker_catches_the_wrong_vite_import_the_way_aiv_support_wrote_it(tmp_path):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    for name, text in files("vite").items():
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")

    def run(config):
        (tmp_path / "vite.config.ts").write_text(config, encoding="utf-8")
        done = subprocess.run(["node", "check.mjs", "http://localhost:1"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
        return done.stdout

    wrong = run('import { outreach } from "./outreach-routes.mjs";\nexport default { plugins: [outreach()] };\n')
    assert "[X]   vite.config.ts imports \"./outreach-routes.mjs\", which is not this kit's file" in wrong
    assert "[X]   vite.config.ts does not use outreach-vite.mjs yet" in run("export default { plugins: [outreach()] };\n")
    assert "[ok]  vite.config.ts uses outreach-vite.mjs" in run('import outreach from "./outreach-vite.mjs";\nexport default { plugins: [outreach()] };\n')


def test_unknown_stack_is_refused():
    with pytest.raises(ValueError):
        build("cobol", **ARGS)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("stack", list(STACKS))
def test_every_node_script_in_the_kit_parses(stack, tmp_path):
    for name, text in files(stack).items():
        if name.endswith((".mjs", ".js")):
            p = tmp_path / name.replace("/", "_")
            p.write_text(text, encoding="utf-8")
            if name.endswith(".js"):
                p = p.with_suffix(".mjs")
                p.write_text(text, encoding="utf-8")
            done = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
            assert done.returncode == 0, f"{name}: {done.stderr}"


def test_the_python_file_compiles():
    compile(files("python")["outreach_flask.py"], "outreach_flask.py", "exec")


@pytest.mark.skipif(shutil.which("php") is None, reason="php is not installed")
def test_the_php_file_parses(tmp_path):
    p = tmp_path / "outreach-start.php"
    p.write_text(files("php")["outreach-start.php"], encoding="utf-8")
    done = subprocess.run(["php", "-l", str(p)], capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
