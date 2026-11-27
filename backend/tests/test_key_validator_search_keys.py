"""Tavily and Apollo keys are checked against the vendor before they are saved."""
import pytest

from app.services.key_validator import PROVIDER_HANDLERS, _validate_apollo, _validate_tavily, identify_provider


class _Res:
    def __init__(self, code, body=None):
        self.status_code, self._body, self.text = code, body or {}, str(body or "")

    def json(self):
        return self._body


class _Client:
    def __init__(self, res):
        self.res, self.seen = res, None

    async def get(self, url, headers=None):
        self.seen = (url, headers)
        return self.res


def test_names_map_to_their_checks():
    assert identify_provider("Tavily") == "tavily" and PROVIDER_HANDLERS["tavily"] is _validate_tavily
    assert identify_provider("Apollo.io") == "apollo" and PROVIDER_HANDLERS["apollo"] is _validate_apollo


async def test_tavily_accepts_and_rejects():
    ok = await _validate_tavily(_Client(_Res(200)), "tvly-x", None, None, None, "Tavily")
    bad = await _validate_tavily(_Client(_Res(401)), "tvly-x", None, None, None, "Tavily")
    assert ok["valid"] is True and bad["valid"] is False


async def test_apollo_needs_a_logged_in_answer():
    good = await _validate_apollo(_Client(_Res(200, {"is_logged_in": True})), "k", None, None, None, "Apollo.io")
    anon = await _validate_apollo(_Client(_Res(200, {"is_logged_in": False})), "k", None, None, None, "Apollo.io")
    denied = await _validate_apollo(_Client(_Res(403)), "k", None, None, None, "Apollo.io")
    assert good["valid"] is True and anon["valid"] is False and denied["valid"] is False
