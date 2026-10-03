"""Switch Stripe Tax on for subscriptions bought before STRIPE_AUTOMATIC_TAX was set.

Stripe keeps a subscription's tax setting from the day it was bought, so those stay VAT-free.
This turns tax on for every active one: VAT is added from its next renewal (nothing is charged
now). Run once after setting up Stripe Tax and STRIPE_AUTOMATIC_TAX=true, and tell customers first.

    python scripts/enable_vat_on_subscriptions.py           # list what would change
    python scripts/enable_vat_on_subscriptions.py --apply   # change them
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.services import billing as B  # noqa: E402

LIVE = ("active", "past_due", "trialing")


async def main(apply: bool) -> None:
    if not B.automatic_tax():
        sys.exit("Set up Stripe Tax and STRIPE_AUTOMATIC_TAX=true first.")
    print(f"Stripe {'TEST' if B.test_mode() else 'LIVE'} account{'' if apply else ' (dry run: add --apply to change)'}")
    todo, after = [], None
    while True:
        page = await B.stripe("GET", "/subscriptions", {"status": "all", "limit": 100, **({"starting_after": after} if after else {})})
        todo += [s for s in page["data"] if s["status"] in LIVE and not s["automatic_tax"]["enabled"]]
        if not page.get("has_more"):
            break
        after = page["data"][-1]["id"]
    failed = 0
    for s in todo:
        if not apply:
            print(f"  would switch tax on: {s['id']} (customer {s['customer']})")
            continue
        try:
            await B.stripe("POST", f"/subscriptions/{s['id']}", {"automatic_tax": {"enabled": True}, "proration_behavior": "none"})
            print(f"  tax on: {s['id']}")
        except B.StripeError as err:  # e.g. the customer has no address Stripe can tax
            failed += 1
            print(f"  NOT changed: {s['id']} (customer {s['customer']}): {err}")
    print(f"{len(todo)} subscription(s) without tax{'' if not apply else f', {len(todo) - failed} switched on, {failed} failed'}.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv[1:]))
