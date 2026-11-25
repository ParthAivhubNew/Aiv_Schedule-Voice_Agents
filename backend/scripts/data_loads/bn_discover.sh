#!/usr/bin/env bash
# Read-only look at what this server holds. Changes nothing. Prints to screen and saves bn_discover.txt
# Usage: cd /opt/flow && bash bn_discover.sh
PG="docker exec -i aivhub_postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-aivhub}"
q() { echo; echo "--- $1"; $PG -c "$2" 2>&1; }
{
echo "################ 1. WHAT IS RUNNING ################"
docker compose ps 2>&1 | head -20
echo; echo "--- deployed commit"; git -C /opt/flow log -1 --format='%h %ad %s' --date=short
echo; echo "--- disk"; df -h / | tail -1; docker system df 2>&1 | head -6

echo; echo "################ 2. THE DATABASE ################"
q "database size" "SELECT current_database() db, pg_size_pretty(pg_database_size(current_database())) size, version();"
q "biggest tables (rows are estimates)" "SELECT relname AS table, n_live_tup AS approx_rows, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 25;"
q "organisations (who the platform serves)" "SELECT * FROM organizations LIMIT 10;"

echo; echo "################ 3. THE COMPANY STORE (business_records) ################"
q "overall" "SELECT count(*) AS companies, count(*) FILTER (WHERE lower(status)='active') AS active, count(*) FILTER (WHERE COALESCE(sic_codes,'')<>'') AS with_sic, count(*) FILTER (WHERE COALESCE(postcode,'')<>'') AS with_postcode, count(*) FILTER (WHERE COALESCE(phone,'')<>'') AS with_phone, count(*) FILTER (WHERE COALESCE(email,'')<>'') AS with_email, count(*) FILTER (WHERE COALESCE(website,'')<>'' OR COALESCE(domain,'')<>'') AS with_website FROM business_records;"
q "status values (so the Active filter is right)" "SELECT status, count(*) FROM business_records GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"
q "company types (spot charities and guarantee companies)" "SELECT company_category, count(*) FROM business_records GROUP BY 1 ORDER BY 2 DESC LIMIT 12;"
q "postcode format (is there always a space? e.g. BN1 4AB)" "SELECT postcode FROM business_records WHERE postcode LIKE 'BN%' LIMIT 8;"
q "BN companies by district, all and active" "SELECT split_part(upper(postcode),' ',1) AS district, count(*) AS all_cos, count(*) FILTER (WHERE lower(status)='active') AS active FROM business_records WHERE postcode ~ '^BN' GROUP BY 1 ORDER BY substring(split_part(upper(postcode),' ',1) from '[0-9]+')::int NULLS LAST LIMIT 45;"
q "SIC code format sample" "SELECT sic_codes, sic_text FROM business_records WHERE COALESCE(sic_codes,'')<>'' LIMIT 4;"
q "where contact data came from (raw_data keys)" "SELECT k, count(*) FROM business_records, jsonb_object_keys(raw_data::jsonb) k WHERE raw_data IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15;"
q "shared research dossiers held" "SELECT count(*) FILTER (WHERE shared_research IS NOT NULL) AS with_research FROM business_records;"

echo; echo "################ 4. CONTACT POINTS ################"
q "by kind and source" "SELECT kind, source, count(*) FROM company_contact_points GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25;"
q "named-person entries (owner set)" "SELECT kind, count(*) FROM company_contact_points WHERE COALESCE(owner,'')<>'' GROUP BY 1;"

echo; echo "################ 5. USAGE AND COST TRAIL ################"
q "AI usage by month" "SELECT to_char(created_at,'YYYY-MM') m, count(*) calls, round(sum(cost_usd)::numeric,2) usd FROM ai_usage GROUP BY 1 ORDER BY 1 DESC LIMIT 6;"
q "email finders by month" "SELECT to_char(created_at,'YYYY-MM') m, provider, count(*) FROM enrichment_attempts GROUP BY 1,2 ORDER BY 1 DESC, 3 DESC LIMIT 20;"
q "Apollo calls by month" "SELECT to_char(at,'YYYY-MM') m, count(*) FROM apollo_calls GROUP BY 1 ORDER BY 1 DESC LIMIT 6;"
q "TPS screening rows" "SELECT count(*) FROM phone_screenings;"
q "vendor call counters" "SELECT id, data FROM app_settings WHERE id LIKE 'vendor_calls:%' ORDER BY id DESC LIMIT 4;"

echo; echo "################ 6. SETTINGS NAMES (no values) ################"
docker exec aivhub_backend env | cut -d= -f1 | grep -E 'APOLLO|TAVILY|GOOGLE|HUNTER|FINDYMAIL|LEADMAGIC|ICYPEAS|BETTER|TELNYX|FIREBASE|STRIPE|OPENAI|ANTHROPIC|XAI|DEEPSEEK' | sort
echo; echo "################ DONE ################"
} 2>&1 | tee bn_discover.txt
