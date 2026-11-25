#!/usr/bin/env bash
# FSB bid: the facts only the server can answer (items 3, 5, 6, 7). Read-only. Prints key NAMES, never key values.
# Usage: bash bn_info.sh    -> screen + bn_info.txt
PG="docker exec -i aivhub_postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-aivhub}"
{
echo "=== Deployed version ==="; git -C /opt/flow log -1 --format='%h %ad %s' --date=short
echo; echo "=== Item 3: TPS/CTPS screening. Any screened numbers? (0 rows = Not screened) ==="
$PG -c "SELECT tps_status, provider, count(*) FROM phone_screenings GROUP BY 1,2;"
echo; echo "=== Item 5: monthly vendor call counts kept by the app (Tavily, Telnyx lookup, ...) ==="
$PG -c "SELECT id, data FROM app_settings WHERE id LIKE 'vendor_calls:%' ORDER BY id DESC LIMIT 4;"
echo; echo "=== Item 6: Apollo. Which keys exist (names only) and how much they were used ==="
$PG -c "SELECT key_id, key_label, key_tail, purpose, outcome, count(*) AS calls, min(at)::date AS first, max(at)::date AS last FROM apollo_calls GROUP BY 1,2,3,4,5 ORDER BY 6 DESC;"
echo "-- Apollo-first switch and which vendor keys are set in the environment (values hidden)"
docker exec aivhub_backend env | grep -E '^(APOLLO|TAVILY|GOOGLE_PLACES|HUNTER|FINDYMAIL|LEADMAGIC|ICYPEAS|BETTERCONTACT|DATASOAP|FIREBASE)' | sed -E 's/=(.{0,4}).*/=\1…(set)/'
echo "-- Apollo data actually held on company records, and how it is shown (source apollo)"
$PG -c "SELECT count(*) FILTER (WHERE raw_data::jsonb ? 'apollo' ) AS records_with_apollo_block, count(*) FILTER (WHERE raw_data::jsonb->'contacts_web'->>'source' = 'apollo') AS shown_as_contact FROM business_records WHERE raw_data IS NOT NULL;"
echo "-- Apollo / Google / Tavily keys saved in the platform key store (names only)"
$PG -c "SELECT id, data->>'group' AS grp, data->>'name' AS name, (data ? 'value') AS has_value FROM app_settings WHERE id ILIKE '%key%' LIMIT 40;"
echo; echo "=== Item 7: features. Roles in use and sign-in methods ==="
$PG -c "SELECT name, is_admin, count(*) AS orgs FROM roles GROUP BY 1,2 ORDER BY 3 DESC;"
echo "-- Public API keys and last 90 days of requests"
$PG -c "SELECT count(*) AS requests, count(DISTINCT key_id) AS keys, min(created_at)::date AS first, max(created_at)::date AS last FROM public_api_audit;" 2>&1 | head -8
echo "-- Does a scheduled job / SFTP / Salesforce exist anywhere in the running code?"
docker exec aivhub_backend sh -c "grep -rIl -i -E 'sftp|salesforce|saml|microsoft' /app/app 2>/dev/null | head; echo '(empty above = not built)'"
echo; echo "=== Hosting facts: run bn_costs.sh for provider, region, disk, backups, monitoring ==="
} 2>&1 | tee bn_info.txt
