"""Bulk imports from files: whatever format a publisher uses, the same mapped rows come out."""
import json
import zipfile
from types import SimpleNamespace

import pytest

from app.services import data_source_connector as C

CQC_CSV = (
    "CQC Locations data,,,\n,,,\nThis data was produced on 30 September 2026,,,\n,,,\n"
    "Name,Address,Postcode,Phone number,Service types\n"
    '"Square Mile Dental Centre","7-9 White Kennet Street,London",E1 7BS,2073770990,Dentist\n'
    ',,,,\n'
    '"Hebburn Manor","Victoria Road East,Hebburn",NE31 1YQ,1914301100,Nursing homes\n'
)
MAP = {"name": ["Name"], "address": ["Address"], "postcode": ["Postcode"], "phone": ["Phone number"], "industry": ["Service types"]}
CFG = {"bulk_field_map": MAP, "bulk_defaults": {"status": "Active"}}


def _rows(path, cfg=CFG):
    return list(C.iter_file_rows(path, cfg, cfg["bulk_field_map"]))


def test_csv_with_title_lines_above_the_header_still_maps(tmp_path):
    f = tmp_path / "cqc.csv"
    f.write_text("﻿" + CQC_CSV, encoding="utf-8")  # a BOM, like real spreadsheet exports
    rows = _rows(f)
    assert [r["name"] for r in rows] == ["Square Mile Dental Centre", "Hebburn Manor"]  # blank row skipped
    assert rows[0]["postcode"] == "E1 7BS" and rows[0]["address"] == "7-9 White Kennet Street,London"
    assert rows[0]["status"] == "Active" and rows[0]["raw"]["Service types"] == "Dentist"  # default added, original row kept


def test_tab_separated_json_jsonlines_and_zip_all_give_the_same_rows(tmp_path):
    tsv = tmp_path / "a.tsv"
    tsv.write_text("Name\tPostcode\nAcme Ltd\tM1 1AA\n", encoding="utf-8")
    assert _rows(tsv)[0]["postcode"] == "M1 1AA"

    js = tmp_path / "a.json"
    js.write_text(json.dumps({"data": [{"Name": "Acme Ltd", "Postcode": "M1 1AA"}]}), encoding="utf-8")
    assert _rows(js)[0]["name"] == "Acme Ltd"  # the list is found without being told where

    nested = tmp_path / "b.json"
    nested.write_text(json.dumps({"result": {"orgs": [{"org": {"title": "Nested Co"}}]}}), encoding="utf-8")
    cfg = {"bulk_items_path": "result.orgs", "bulk_field_map": {"name": ["org.title"]}}
    assert _rows(nested, cfg)[0]["name"] == "Nested Co"

    jl = tmp_path / "a.jsonl"
    jl.write_text('{"Name": "One"}\n\nnot json\n{"Name": "Two"}\n', encoding="utf-8")
    assert [r["name"] for r in _rows(jl)] == ["One", "Two"]

    z = tmp_path / "a.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("part1.csv", CQC_CSV)
        zf.writestr("readme.pdf", "ignored")
    assert len(_rows(z)) == 2


def test_a_file_with_none_of_the_mapped_columns_says_so_instead_of_importing_nothing(tmp_path):
    f = tmp_path / "x.csv"
    f.write_text("Foo,Bar\n1,2\n", encoding="utf-8")
    with pytest.raises(C.ConnectorError, match="header row"):
        _rows(f)
    assert C.file_columns(f) == ["Foo", "Bar"]


def test_modes_are_inferred_and_the_folder_stays_inside_the_imports_root(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "IMPORT_ROOT", tmp_path)
    src = SimpleNamespace(id="ds_x", config={"bulk_mode": "folder", "bulk_local_dir": "../../etc"})
    assert C.is_bulk(src) and C.bulk_mode(SimpleNamespace(id="a", config={"bulk_paged_url": "http://x/{page}"})) == "paged"
    assert C.bulk_mode(SimpleNamespace(id="a", config={"bulk_file_urls": ["http://x/a.csv"]})) == "urls"
    assert not C.is_bulk(SimpleNamespace(id="a", config={}))
    inside = tmp_path / "uploads" / "ds_x"
    inside.mkdir(parents=True)
    (inside / "ok.csv").write_text("Name\nA\n")
    (inside / ".hidden.csv.part").write_text("partial")
    (inside / "notes.pdf").write_text("x")
    assert [f.name for f in C.local_files(src)] == ["ok.csv"]  # the ../../etc escape was ignored


async def test_paged_api_is_read_once_per_key_and_stops_on_an_empty_page(monkeypatch):
    calls = []

    class Resp:
        status_code = 200

        def __init__(self, data):
            self._d = data

        def json(self):
            return self._d

        def raise_for_status(self):
            pass

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            calls.append(url)
            if "authorities" in url:
                return Resp({"authorities": [{"id": 1}, {"id": 2}]})
            page = int(url.split("page=")[1])
            key = url.split("auth=")[1].split("&")[0]
            return Resp({"establishments": [{"BusinessName": f"Cafe {key}-{page}"}] if page == 1 else []})

    monkeypatch.setattr(C.httpx, "AsyncClient", Client)
    src = SimpleNamespace(id="ds_fsa", auth_type="none", api_key="", min_delay_ms=0, config={
        "bulk_paged_url": "https://api/x?auth={key}&page={page}", "bulk_keys_url": "https://api/authorities",
        "bulk_keys_path": "authorities", "bulk_key_field": "id", "bulk_items_path": "establishments",
        "bulk_field_map": {"name": ["BusinessName"]}, "bulk_headers": {"x-api-version": "2"}})
    got = [r["name"] async for r in C.stream_bulk_rows(src)]
    assert got == ["Cafe 1-1", "Cafe 2-1"]


def test_no_key_api_sources_are_allowed_but_keyed_ones_still_need_a_key():
    free = SimpleNamespace(auth_type="none", api_key="", config={"headers": {"x-api-version": "2"}}, base_url="http://x")
    assert C._headers(free) == {"x-api-version": "2"}
    keyed = SimpleNamespace(auth_type="bearer", api_key="", config={"search_endpoint": "/s"}, base_url="http://x")
    with pytest.raises(C.ConnectorError, match="No API key"):
        import asyncio
        asyncio.run(C._raw_search(keyed, "q"))


# -- plan 14: the ICO, OSCR and NHS registers ---------------------------------------------------------------------------------------
def test_a_headerless_file_takes_its_column_names_from_the_config_and_keeps_only_matching_rows(tmp_path):
    f = tmp_path / "epraccur.csv"
    f.write_text('"A81001","THE DENSHAM SURGERY","ACTIVE","RO76"\n"A81009","CLOSED SURGERY","INACTIVE","RO76"\n'
                 '"Y01234","OUT OF HOURS","ACTIVE","RO80"\n', encoding="utf-8")
    cfg = {"bulk_column_names": ["Code", "Name", "Status", "Setting"], "bulk_field_map": {"name": ["Name"], "code": ["Code"]},
           "bulk_registration": [{"field": "code", "prefix": "NHS-"}], "bulk_only": {"Status": ["ACTIVE"], "Setting": ["RO76"]}}
    rows = _rows(f, cfg)
    assert [(r["registration_number"], r["name"]) for r in rows] == [("NHS-A81001", "THE DENSHAM SURGERY")]  # the first row is data, not a header


def test_a_zip_behind_a_link_with_no_extension_is_still_opened(tmp_path):
    z = tmp_path / "charity-register.dat"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("CharityExport.csv", "Charity Number,Charity Name\nSC000001,Stoneyburn Centre\n")
    cfg = {"bulk_field_map": {"name": ["Charity Name"]}}
    assert _rows(z, cfg)[0]["name"] == "Stoneyburn Centre"


async def test_root_relative_links_on_an_index_page_become_full_links(monkeypatch):
    import httpx

    page = '<a href="/media2/abc123/register-of-data-controllers-2026-11-27.zip">Download</a>'
    real = httpx.AsyncClient

    def client(*a, **kw):
        kw["transport"] = httpx.MockTransport(lambda req: httpx.Response(200, text=page))
        return real(*a, **kw)

    monkeypatch.setattr(C.httpx, "AsyncClient", client)
    src = SimpleNamespace(config={"bulk_index_url": "https://ico.org.uk/about-the-ico/download-the-register/",
                                  "bulk_link_pattern": r"/media2/[A-Za-z0-9]+/register-of-data-controllers-\d{4}-\d{2}-\d{2}\.zip"})
    assert await C.discover_bulk_files(src) == ["https://ico.org.uk/media2/abc123/register-of-data-controllers-2026-11-27.zip"]


async def test_each_file_of_a_source_can_have_its_own_defaults_and_filter(tmp_path, monkeypatch):
    files = {"gp": '"A1","GP ONE","ACTIVE","RO76"\n"A2","CLINIC","ACTIVE","RO80"\n', "dent": '"V1","DENTIST ONE","ACTIVE",""\n'}

    async def download(url, headers=None, limit_bytes=0):
        f = open(tmp_path / url.rsplit("=", 1)[1], "w+b")
        f.write(files[url.rsplit("=", 1)[1]].encode())
        f.flush()
        return f

    monkeypatch.setattr(C, "_download", download)
    src = SimpleNamespace(id="ds_x", name="X", config={
        "bulk_file_urls": ["https://x/getReport?report=gp", "https://x/getReport?report=dent"],
        "bulk_column_names": ["Code", "Name", "Status", "Setting"], "bulk_field_map": {"name": ["Name"]},
        "bulk_only": {"Status": ["ACTIVE"]},
        "bulk_per_file": {"report=gp": {"bulk_only": {"Status": ["ACTIVE"], "Setting": ["RO76"]}, "bulk_defaults": {"industry": "GP practice"}},
                          "report=dent": {"bulk_defaults": {"industry": "Dental practice"}}}})
    got = [(r["name"], r["industry"]) async for r in C.stream_bulk_rows(src)]
    assert got == [("GP ONE", "GP practice"), ("DENTIST ONE", "Dental practice")]
