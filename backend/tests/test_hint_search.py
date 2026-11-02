"""Extra words from the person go onto the search and always mean a fresh search, never a saved answer."""
import asyncio
from types import SimpleNamespace

from app.services import social_lookup as SL


def test_hint_reaches_social_query_and_skips_saved(monkeypatch):
    seen = []

    async def fake_search(query, **kw):
        seen.append(query)
        return []

    import app.services.enrichment_service as ES
    monkeypatch.setattr(ES, "search_web", fake_search)

    async def no_rows(*a, **k):
        return []

    monkeypatch.setattr(SL.CH, "rows_for", no_rows)
    biz = SimpleNamespace(id="b1", name="Acme Ltd", region="Leeds", postcode="LS1",
                          raw_data={"socials": {"x": {"url": "https://x.com/old", "options": [], "at": "2999-01-01T00:00:00Z"}}})
    r = asyncio.run(SL.find(None, biz, "x", hint="  trades as   Acme Bakes "))
    assert r["searched"] is True
    assert seen and seen[0].endswith("trades as Acme Bakes")
