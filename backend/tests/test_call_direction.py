from types import SimpleNamespace

import pytest

from app.api.calls import _call_direction

BASE = dict(direction=None, mission="", listed_as="", canonical_name="", lead_id=None, registry_id=None)


@pytest.mark.parametrize("over,want", [
    ({"direction": "inbound"}, "inbound"),
    ({"direction": "OUTBOUND"}, "outbound"),
    ({"mission": "Inbound call"}, "inbound"),
    ({"mission": "Telnyx AI Assistant — inbound"}, "inbound"),
    ({"listed_as": "Caller (1234)"}, "inbound"),
    ({"canonical_name": "Unknown caller"}, "inbound"),
    ({"lead_id": "l1"}, "outbound"),
    ({"mission": "Direct Outbound Outreach"}, "outbound"),
    ({"listed_as": "Acme"}, ""),  # an older call with nothing to go on is left unlabelled, not guessed
    ({"direction": "inbound", "lead_id": "l1"}, "inbound"),  # what was recorded wins over the guess
])
def test_call_direction(over, want):
    assert _call_direction(SimpleNamespace(**{**BASE, **over})) == want
