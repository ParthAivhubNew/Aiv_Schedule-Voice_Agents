#!/usr/bin/env bash
# FSB bid item 5: what the app has recorded spending over the last 3 months, plus the hosting facts of this server.
# Read-only. Usage: bash bn_costs.sh   -> prints to screen and saves bn_costs.txt
PG="docker exec -i aivhub_postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-aivhub}"
{
echo "=== Recorded vendor spend by month (USD), last 3 full+current months ==="
$PG -c "
SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, 'ai/lookup:'||kind AS what, provider, model,
       count(*) AS calls, round(coalesce(sum(cost_usd),0)::numeric,2) AS usd, count(*) FILTER (WHERE NOT priced) AS unpriced_calls
FROM ai_usage WHERE created_at >= date_trunc('month', now()) - interval '2 months'
GROUP BY 1,2,3,4 ORDER BY 1,6 DESC;"
echo "=== Email finders by month (USD) ==="
$PG -c "
SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, provider, count(*) AS attempts, count(*) FILTER (WHERE hit) AS hits,
       round(coalesce(sum(cost_usd),0)::numeric,2) AS usd
FROM enrichment_attempts WHERE created_at >= date_trunc('month', now()) - interval '2 months'
GROUP BY 1,2 ORDER BY 1,5 DESC;"
echo "=== Apollo calls by month and outcome (priced by plan, not per call) ==="
$PG -c "
SELECT to_char(date_trunc('month', at),'YYYY-MM') AS month, purpose, outcome, count(*) AS calls
FROM apollo_calls WHERE at >= date_trunc('month', now()) - interval '2 months' GROUP BY 1,2,3 ORDER BY 1,2,4 DESC;"
echo "=== Price table (what each unit is priced at; confirmed=f means nobody has checked it) ==="
$PG -c "SELECT provider, model, kind, price_in_usd, price_out_usd, confirmed FROM provider_prices ORDER BY provider, model;"
echo "=== Data volume ==="
$PG -c "SELECT pg_size_pretty(pg_database_size('${POSTGRES_DB:-aivhub}')) AS database_size;"
echo
echo "=== Server (provider, region, size) ==="
echo "-- hostname / OS / CPU / RAM"; hostnamectl 2>/dev/null | head -8; nproc; free -h | head -2
echo "-- disk"; df -h / /opt 2>/dev/null
echo "-- docker disk use"; docker system df
echo "-- public IP and where it is registered (the server asks ipinfo.io about its own address)"; curl -s --max-time 8 https://ipinfo.io/json | head -20
echo "-- cloud metadata (AWS / Azure / GCP / Hetzner / DO answer one of these)"
curl -s --max-time 3 http://169.254.169.254/latest/meta-data/placement/region; echo
curl -s --max-time 3 -H Metadata:true "http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01" | head -c 600; echo
curl -s --max-time 3 http://169.254.169.254/hetzner/v1/metadata 2>/dev/null | head -12
echo "-- backups: cron jobs and any backup files"; crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null; ls -lh /opt/flow/backups /var/backups 2>/dev/null | head -20
echo "-- monitoring / alerting containers or services"; docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
} 2>&1 | tee bn_costs.txt
