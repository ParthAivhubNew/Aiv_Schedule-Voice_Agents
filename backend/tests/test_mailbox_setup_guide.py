from types import SimpleNamespace

from app.api.email_outreach import _sending_blockers
from app.services.dns_verifier import setup_guide


def test_guide_lists_only_missing_records_with_exact_values():
    steps = setup_guide("aivhub.com", "gmail", {"spf_verified": True, "dkim_verified": False, "dmarc_verified": False, "mx_verified": True})
    keys = [s["key"] for s in steps]
    assert keys == ["dkim", "dmarc"]
    dmarc = steps[1]
    assert dmarc["host"] == "_dmarc.aivhub.com" and dmarc["value"].startswith("v=DMARC1")
    assert "Google Admin" in steps[0]["howto"]


def test_guide_is_empty_when_everything_passes():
    ok = {"spf_verified": True, "dkim_verified": True, "dmarc_verified": True, "mx_verified": True}
    assert setup_guide("aivhub.com", "gmail", ok) == []


def test_blockers_say_why_a_mailbox_cannot_send():
    box = SimpleNamespace(spf_verified=True, dkim_verified=False, status="connected")
    assert _sending_blockers(box) == ["DKIM is missing", "warm-up has not been started"]
    ready = SimpleNamespace(spf_verified=True, dkim_verified=True, status="warming")
    assert _sending_blockers(ready) == []
