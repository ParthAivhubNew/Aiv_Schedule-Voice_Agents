"""Google Places: a company's phone, website, rating and status from Google (services/enrichment_service.py makes the calls).
Google's terms allow showing its values in the app but not exporting them, and they are not kept for other clients."""
from __future__ import annotations

import httpx

from app.providers.base import Licence, Manifest, Pricing, Provider, TestResult, rejected


class GooglePlaces(Provider):
    manifest = Manifest(
        id="google_places", name="Google Places", category="company_data", capabilities=("company_data",),
        provides=("phone", "website", "rating", "status"), key_group="Business Discovery",
        pricing=Pricing(usd=0.035, unit="call", billing="per_search"),
        licence=Licence(exportable=False, cache_days=1, share_across_clients=False, client_label="From Google"),
        credit_item="google_view", default_order=20, docs_url="https://developers.google.com/maps/documentation/places/web-service")

    async def saved_key(self) -> str:
        from app.services.enrichment_service import google_places_key

        return await google_places_key()

    async def test(self, client: httpx.AsyncClient, key: str) -> TestResult:
        # A text search asking for place ids only: Google's cheapest Places request, enough to show the key and the API are switched on.
        res = await client.post("https://places.googleapis.com/v1/places:searchText",
                                headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id"},
                                json={"textQuery": "Companies House Cardiff", "regionCode": "GB", "pageSize": 1})
        bad = rejected(res, self.label())
        if bad:
            return TestResult(False, f"Google refused the key or the Places API is not enabled for it ({res.status_code}).")
        if res.status_code == 400 and "API key" in res.text:
            return TestResult(False, "Google says the key is not valid.")
        if res.status_code != 200:
            return TestResult(False, f"Google answered {res.status_code}.")
        return TestResult(True, "Key works and the Places API is enabled.")


PROVIDER = GooglePlaces()
