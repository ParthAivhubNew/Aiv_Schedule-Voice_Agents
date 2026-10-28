import io
import re
import shutil
import subprocess
import zipfile

import pytest

from app.partner_kit import STACKS, build

ARGS = dict(client_id="pk_abc123", host="https://outreach.example.test/", origin="https://app.partner.test", company='Acme "Rockets" <Ltd>')


def files(stack):
    z = zipfile.ZipFile(io.BytesIO(build(stack, **ARGS)))
    return {n: z.read(n).decode("utf-8") for n in z.namelist()}


@pytest.mark.parametrize("stack", list(STACKS))
def test_kit_is_filled_in_and_has_no_secret(stack):
    kit = files(stack)
    joined = "\n".join(kit.values())
    assert not re.search(r"\{\{[A-Z_]+\}\}", joined)          # every placeholder is filled
    assert "pk_abc123" in joined and "https://outreach.example.test/api/embed" in joined
    assert "https://outreach.example.test//" not in joined      # the trailing slash of the host is dropped
    assert not re.search(r"psk_(live|test)_[A-Za-z0-9]{12,}", joined)  # a key can be named in the notes, but none is in the kit
    assert "psk_test_paste" in kit[".env.example"]                     # the .env file holds a placeholder only
    assert "check.mjs" in kit and "START-HERE.txt" in kit and "public/outreach-test.html" in kit


def test_files_land_where_the_project_expects_them():
    assert {"outreach-server.mjs", "vite.config.snippet.txt", "src/OutreachScreen.jsx"} <= set(files("vite"))
    assert "outreach-routes.mjs" in files("node")
    assert {"app/outreach-start/route.js", "components/OutreachScreen.jsx"} <= set(files("next"))


def test_company_name_is_escaped_in_the_page_but_kept_in_the_notes():
    kit = files("vite")
    assert "&lt;Ltd&gt;" in kit["public/outreach-test.html"] and "<Ltd>" not in kit["public/outreach-test.html"]
    assert 'Acme "Rockets" <Ltd>' in kit["START-HERE.txt"]


def test_start_here_names_the_partners_own_address():
    assert "node check.mjs https://app.partner.test" in files("vite")["START-HERE.txt"]


def test_unknown_stack_is_refused():
    with pytest.raises(ValueError):
        build("cobol", **ARGS)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("stack", list(STACKS))
def test_every_script_in_the_kit_parses(stack, tmp_path):
    for name, text in files(stack).items():
        if name.endswith((".mjs", ".js")):
            p = tmp_path / name.replace("/", "_")
            p.write_text(text, encoding="utf-8")
            if name.endswith(".js"):
                p = p.with_suffix(".mjs")
                p.write_text(text, encoding="utf-8")
            done = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
            assert done.returncode == 0, f"{name}: {done.stderr}"
