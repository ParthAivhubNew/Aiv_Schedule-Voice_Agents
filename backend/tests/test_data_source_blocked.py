"""A publisher that refuses automated downloads (CQC answers 403): use an uploaded file, or give a plain instruction."""
from types import SimpleNamespace

import httpx
import pytest

from app.services import data_source_connector as C


def _refused(*_a, **_k):
    req = httpx.Request("GET", "https://www.cqc.org.uk/x")
    raise httpx.HTTPStatusError("403", request=req, response=httpx.Response(403, request=req))


def _source():
    return SimpleNamespace(id="ds_cqc", name="CQC care directory", base_url="https://www.cqc.org.uk", auth_type="none", api_key="",
                           config={"bulk_index_url": "https://www.cqc.org.uk/about-us/transparency/using-cqc-data",
                                   "bulk_link_pattern": r"x", "bulk_field_map": {"name": ["Name"]}})


async def _drain(source):
    return [row async for row in C.stream_bulk_rows(source)]


async def test_a_refused_download_says_what_to_do(monkeypatch):
    async def refuse(_s):
        _refused()

    monkeypatch.setattr(C, "discover_bulk_files", refuse)
    monkeypatch.setattr(C, "local_files", lambda _s: [])
    with pytest.raises(C.ConnectorError) as err:
        await _drain(_source())
    msg = str(err.value)
    assert "refuses automated downloads (HTTP 403)" in msg and "upload it under Files & preview" in msg and "Mozilla" not in msg


async def test_an_uploaded_file_is_used_when_the_download_is_refused(monkeypatch, tmp_path):
    async def refuse(_s):
        _refused()

    f = tmp_path / "CQC_directory.csv"
    f.write_text("Name\nOak Dental\n", encoding="utf-8")
    monkeypatch.setattr(C, "discover_bulk_files", refuse)
    monkeypatch.setattr(C, "local_files", lambda _s: [f])
    rows = await _drain(_source())
    assert [r["name"] for r in rows] == ["Oak Dental"]


def test_columns_listed_to_drop_are_not_kept_in_the_stored_row():
    cfg = {"bulk_drop_fields": ["ResponsiblePerson"]}
    out = C._finish_row({"name": "Acme"}, {"EmployerName": "Acme", "ResponsiblePerson": "Jo Bloggs"}, cfg)
    assert out["raw"] == {"EmployerName": "Acme"}
