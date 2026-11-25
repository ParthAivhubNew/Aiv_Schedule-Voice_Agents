"""Provero: TPS / CTPS screening of UK numbers (services/provero.py makes the calls; results are kept 28 days in phone_screenings).
Client-facing text never names the vendor."""
from __future__ import annotations

import httpx

from app.providers.base import Licence, Manifest, Pricing, Provider, TestResult


class ProveroTps(Provider):
    manifest = Manifest(
        id="provero_tps", name="Provero (TPS / CTPS)", category="tps_screening", capabilities=("tps_screening",), provides=("tps", "ctps"),
        key_group="Leads", pricing=Pricing(usd=0.0053, unit="call", billing="per_search"),
        licence=Licence(exportable=True, cache_days=28, client_label="TPS / CTPS register"), credit_item="tps_check", default_order=10,
        docs_url="https://provero.io", note="Its test runs one real check of a number Ofcom reserves for drama, so it costs one check.",
        test_spends=True)

    async def saved_key(self) -> str:
        from app.services import provero

        return await provero.get_key()

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        from app.services import provero

        try:
            await provero.check_one(client, key, provero.TEST_NUMBER)
            return TestResult(True, "Key works. One check was used.")
        except provero.KeyRejected:
            return TestResult(False, "Provero rejected the key (401).")
        except provero.OutOfBalance:
            return TestResult(False, "Provero: the account is out of credits.")
        except provero.ProveroError as err:
            return TestResult(False, f"Provero did not answer the test: {err}")


PROVIDER = ProveroTps()
