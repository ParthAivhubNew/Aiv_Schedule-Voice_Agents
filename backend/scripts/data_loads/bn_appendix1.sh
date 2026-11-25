#!/usr/bin/env bash
# FSB Appendix 1, contact side, under FSB's exclusion rules ("FSB exclusion rules - for developers"). Read-only: SELECTs only.
# Usage: cd /opt/flow && bash bn_appendix1.sh
# Writes: bn_formats.txt (what the store calls statuses/types), bn_funnel.txt (rule-by-rule counts to compare with 65,214 / 59,366),
#         appendix1_counts.csv (30 rows), appendix1_summary.csv (3 rows), bn_population_ids.txt (company numbers counted)
set -u
PG="docker exec -i aivhub_postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-aivhub}"
SIC_LIST="84110,84120,84130,84210,84220,84230,84240,84250,84300,85100,85200,85310,85320,85410,85421,85422,85510,85520,85590,85600,86101,86102,86210,86220,86230,86900,64110,64191,64192,64910,64921,64922,64929,82911,94110,94120,94200,94910,94920,94990,88910,91011,52230,49100,52212,50100,50300,36000,37000,19201,06100,53100,99000"
SIC_ARR="ARRAY['$(echo "$SIC_LIST" | sed "s/,/','/g")']"
DIST='^BN([1-3]|[5-9]|1[0-8]|2[0-7]|4[1-4]|50)$'
TYPES="'charitable incorporated organisation','scottish charitable incorporated organisation','registered society','royal charter company','other company type'"
KW='\m(charit[a-z]*|church|parish|mosque|synagogue|temple|casino[a-z]*|credit union|nhs|hospital|school|college|university|academy trust|shopping centre|bureau de change|tourist information|weighbridge[a-z]*)\M'
KEEP='(driving school|dance school)'

# Companies in FSB's 30 districts with status exactly Active; removed_by = the first exclusion rule each one meets (NULL = kept).
BASE="
WITH pop0 AS (
  SELECT b.*, split_part(upper(b.postcode),' ',1) AS district, string_to_array(btrim(COALESCE(b.sic_codes,''),'|'),'|') AS sics
  FROM business_records b
  WHERE b.postcode LIKE 'BN%' AND split_part(upper(b.postcode),' ',1) ~ '$DIST'
    AND b.registration_number ~ '^[A-Z0-9]{8}$' AND btrim(b.status) = 'Active'
),
ruled AS (
  SELECT p.*, CASE
     WHEN lower(btrim(COALESCE(company_category,''))) IN ($TYPES) THEN '2.1 company type'
     WHEN COALESCE(sources::text,'') LIKE '%\"ds_charity_commission\"%' THEN '2.2 Charity Commission'
     WHEN sics && $SIC_ARR THEN '2.3 SIC code'
     WHEN name ~* '$KW' AND name !~* '$KEEP' THEN '2.4 name keyword'
     ELSE NULL END AS removed_by
  FROM pop0 p
)"

# What a company holds today, Apollo never counted: Apollo source blocks and Apollo web lookups are skipped.
HELD="
pop AS (SELECT * FROM ruled WHERE removed_by IS NULL),
src AS (
  SELECT p.id, 'phone' k, p.phone v FROM pop p WHERE COALESCE(p.phone,'')<>''
  UNION ALL SELECT p.id,'email',p.email FROM pop p WHERE COALESCE(p.email,'')<>''
  UNION ALL SELECT p.id, s.k, e FROM pop p
     CROSS JOIN LATERAL (VALUES ('phone', p.raw_data::jsonb->'contacts_web'->'phones'), ('email', p.raw_data::jsonb->'contacts_web'->'emails'),
                                ('phone', p.shared_research::jsonb->'phones'), ('email', p.shared_research::jsonb->'emails')) s(k,j)
     CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(s.j)='array' THEN s.j ELSE '[]'::jsonb END) e
     WHERE COALESCE(p.raw_data::jsonb->'contacts_web'->>'source','') <> 'apollo'
  UNION ALL SELECT p.id, CASE WHEN lower(g.key) IN ('email','email address','email_address') THEN 'email' ELSE 'phone' END, g.value
     FROM pop p, jsonb_each(p.raw_data::jsonb) e, jsonb_each_text(e.value) g
     WHERE jsonb_typeof(e.value)='object' AND e.key !~* 'apollo'
       AND e.key NOT IN ('contacts_web','contacts_web_all','linkedin','socials','lookups_missed','lookup_options')
       AND lower(g.key) IN ('phone','phone number','phone_number','telephone','email','email address','email_address')
  UNION ALL SELECT p.id,'phone',e FROM pop p CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p.raw_data::jsonb->'fsb_sample_2026_11'->'phones','[]'::jsonb)) e
  UNION ALL SELECT p.id,'email',c.key FROM pop p CROSS JOIN LATERAL jsonb_each(COALESCE(p.raw_data::jsonb->'fsb_sample_2026_11'->'email_checks','{}'::jsonb)) c
     WHERE c.value->>'status' IN ('valid','accept_all')
  UNION ALL SELECT c.business_record_id,c.kind,c.value FROM company_contact_points c JOIN pop ON pop.id=c.business_record_id
     WHERE c.kind IN ('phone','email') AND c.source !~* 'apollo'
),
ph AS (SELECT DISTINCT id, regexp_replace(regexp_replace(regexp_replace(v,'\(0\)',''),'\D','','g'),'^(0044|44)','0') n FROM src WHERE k='phone'),
em AS (SELECT DISTINCT id FROM src WHERE k='email' AND v ~ '^[^@ ]+@[^@ ]+[.][^@ ]+$')"

{
echo "== statuses in the store for BN postcodes =="
$PG -c "SELECT status, count(*) FROM business_records WHERE postcode LIKE 'BN%' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"
echo "== company types in the store for BN postcodes =="
$PG -c "SELECT company_category, count(*) FROM business_records WHERE postcode LIKE 'BN%' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;"
echo "== registration number shapes =="
$PG -c "SELECT CASE WHEN registration_number ~ '^CC-' THEN 'CC-charity-only' WHEN registration_number ~ '^[A-Z0-9]{8}\$' THEN '8-char company number' ELSE 'other' END AS shape, count(*) FROM business_records WHERE postcode LIKE 'BN%' GROUP BY 1;"
} > bn_formats.txt 2>&1

{
echo "TARGET: 65,214 before exclusions, 59,366 after (FSB exclusion rules document)."
$PG -c "$BASE SELECT count(*) AS before_exclusions, count(*) FILTER (WHERE removed_by IS NULL) AS after_exclusions FROM ruled;"
$PG -c "$BASE SELECT COALESCE(removed_by,'kept') AS rule, count(*) FROM ruled GROUP BY 1 ORDER BY 1;"
$PG -c "$BASE SELECT district, count(*) FILTER (WHERE removed_by IS NULL) AS kept, count(*) AS before FROM ruled GROUP BY 1 ORDER BY substring(district from '[0-9]+')::int;"
} > bn_funnel.txt 2>&1

$PG --csv > appendix1_counts.csv <<SQL
$BASE,
$HELD,
tel AS (SELECT DISTINCT id FROM ph WHERE n ~ '^0[123][0-9]{8,9}$' OR n ~ '^07[1-57-9][0-9]{8}$'),
tps AS (SELECT DISTINCT ph.id FROM ph JOIN phone_screenings s ON s.number IN (ph.n, '+44'||substr(ph.n,2)) WHERE s.tps_status='listed' OR s.ctps),
dirs AS (SELECT DISTINCT p.id FROM pop p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.officers::jsonb)='array' THEN p.officers::jsonb ELSE '[]'::jsonb END) o
         WHERE o->>'role' ILIKE '%director%' AND COALESCE(o->>'name','')<>'' AND COALESCE(o->>'resigned_on','')=''),
f AS (SELECT p.district, (em.id IS NOT NULL) has_em, (tel.id IS NOT NULL) is_tel, (tps.id IS NOT NULL) is_tps, (dirs.id IS NOT NULL) has_dir
      FROM pop p LEFT JOIN em ON em.id=p.id LEFT JOIN tel ON tel.id=p.id LEFT JOIN tps ON tps.id=p.id LEFT JOIN dirs ON dirs.id=p.id)
SELECT district,
  count(*) FILTER (WHERE NOT has_em) AS no_email_mailable,
  count(*) FILTER (WHERE NOT has_em AND is_tel) AS no_email_telephoneable,
  count(*) FILTER (WHERE NOT has_em AND is_tel AND is_tps) AS no_email_tel_on_tps_ctps,
  count(*) FILTER (WHERE has_em) AS with_email_mailable,
  count(*) FILTER (WHERE has_em AND is_tel) AS with_email_telephoneable,
  count(*) FILTER (WHERE has_em AND is_tel AND is_tps) AS with_email_tel_on_tps_ctps,
  count(*) AS total_mailable,
  count(*) FILTER (WHERE is_tel) AS total_telephoneable,
  count(*) FILTER (WHERE is_tel AND is_tps) AS total_tel_on_tps_ctps,
  count(*) FILTER (WHERE has_dir) AS named_director_companies_house
FROM f GROUP BY district ORDER BY substring(district from '[0-9]+')::int;
SQL

$PG --csv > appendix1_summary.csv <<SQL
$BASE,
$HELD
SELECT 'Records with email addresses' AS summary_row, count(DISTINCT id) AS companies FROM em
UNION ALL SELECT 'Records with mobile numbers', count(DISTINCT id) FROM ph WHERE n ~ '^07[1-57-9][0-9]{8}$'
UNION ALL SELECT 'Records with landline numbers', count(DISTINCT id) FROM ph WHERE n ~ '^0[123][0-9]{8,9}$';
SQL

$PG -At -c "$BASE SELECT registration_number FROM ruled WHERE removed_by IS NULL ORDER BY 1;" > bn_population_ids.txt

echo "=== bn_formats.txt ==="; cat bn_formats.txt
echo "=== bn_funnel.txt (targets 65,214 / 59,366) ==="; cat bn_funnel.txt
echo "=== appendix1_counts.csv ==="; cat appendix1_counts.csv
echo "=== appendix1_summary.csv ==="; cat appendix1_summary.csv
echo "population ids saved: $(wc -l < bn_population_ids.txt)"
