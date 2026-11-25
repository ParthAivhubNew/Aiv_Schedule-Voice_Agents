#!/usr/bin/env bash
# BN contact counts for the FSB bid (Appendix 1). Read-only: runs SELECTs inside the aivhub_postgres container.
# Usage:  bash bn_counts.sh                      (no FSB sector exclusion yet)
#         FSB_SIC='56|64|65|66' bash bn_counts.sh (SIC code prefixes to exclude, pipe-separated)
# Output: bn_counts.csv (one row per BN district) and bn_checks.txt (sanity checks).
set -u
PG="docker exec -i aivhub_postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-aivhub}"
# FSB excluded sectors mapped to SIC 2007 prefixes of the MAIN activity (see the mapping table sent to the boss). Override with FSB_SIC='...'.
FSB_SIC="${FSB_SIC:-0610|0620|1920|3600|4910|5010|5030|5221|5222|5223|5310|5320|641|6491|6492|8291|84|851|852|853|854|8559|856|86|9101|920|941|942|9491|9492}"

{
echo "== business_records: total / BN / BN active =="
$PG -c "SELECT count(*) total, count(*) FILTER (WHERE postcode ~ '^BN') bn, count(*) FILTER (WHERE postcode ~ '^BN' AND lower(status)='active') bn_active FROM business_records;"
echo "== contact points in step with records? =="
$PG -c "SELECT (SELECT count(DISTINCT business_record_id) FROM company_contact_points) with_points, (SELECT count(*) FROM business_records WHERE COALESCE(phone,'')<>'' OR COALESCE(email,'')<>'' OR COALESCE(website,'')<>'') with_record_contact;"
echo "== FSB_SIC used: $FSB_SIC =="
} > bn_checks.txt 2>&1

$PG --csv -v fsb_sic="$FSB_SIC" > bn_counts.csv <<'SQL'
WITH base AS (
  SELECT b.id, b.raw_data::jsonb AS raw, b.shared_research::jsonb AS sr,
         b.phone, b.email, COALESCE(NULLIF(b.website,''), b.domain, '') AS site,
         CASE WHEN position(' ' IN upper(b.postcode)) > 0 THEN split_part(upper(b.postcode),' ',1)
              ELSE substring(upper(b.postcode) from '^[A-Z]{1,2}[0-9][0-9A-Z]?') END AS district
  FROM business_records b
  WHERE lower(b.status) = 'active'
    AND b.postcode LIKE 'BN%' AND b.postcode ~ '^BN[0-9]'   -- LIKE first so the postcode index is used
    AND NOT (COALESCE(b.company_category,'') ILIKE '%charit%'
             OR COALESCE(b.registration_number,'') LIKE 'CC-%'
             OR b.sources::text LIKE '%"ds_charity_commission"%')
    AND split_part(btrim(COALESCE(b.sic_codes,''),'|'),'|',1) !~ ('^(' || :'fsb_sic' || ')')
),
team AS (
  SELECT base.id,
         COALESCE(t->>'title', t->>'job_title', t->>'role', '') AS title,
         COALESCE(t->>'name','') AS name, t->>'phone' AS tphone, t->>'email' AS temail
  FROM base
  CROSS JOIN LATERAL (
    SELECT jsonb_array_elements(x) t FROM (
      SELECT CASE WHEN jsonb_typeof(base.raw->'contacts_web'->'team')='array' THEN base.raw->'contacts_web'->'team' END
      UNION ALL SELECT CASE WHEN jsonb_typeof(base.sr->'team')='array' THEN base.sr->'team' END
      UNION ALL SELECT CASE WHEN jsonb_typeof(base.sr->'people')='array' THEN base.sr->'people' END
    ) s(x) WHERE x IS NOT NULL) j
  WHERE jsonb_typeof(t)='object'
),
src AS (   -- phone/email lists kept by web lookups and research, read straight from the records
  SELECT b.id, s.k, s.j FROM base b CROSS JOIN LATERAL (VALUES
    ('phone', b.raw->'contacts_web'->'phones'), ('email', b.raw->'contacts_web'->'emails'),
    ('phone', b.sr->'phones'), ('email', b.sr->'emails')) s(k,j)
  WHERE jsonb_typeof(s.j)='array'
),
arr AS (
  SELECT src.id, src.k, CASE jsonb_typeof(e) WHEN 'string' THEN e#>>'{}'
         WHEN 'object' THEN COALESCE(e->>'value', e->>'phone', e->>'email', e->>'number') END AS v
  FROM src, jsonb_array_elements(src.j) e
),
srcrec AS ( -- what each source (Companies House bulk, Google, Apollo, imports) published about the company itself
  SELECT b.id,
         CASE lower(g.key) WHEN 'phone' THEN 'phone' WHEN 'phone number' THEN 'phone' WHEN 'phone_number' THEN 'phone' WHEN 'telephone' THEN 'phone'
              WHEN 'email' THEN 'email' WHEN 'email address' THEN 'email' WHEN 'email_address' THEN 'email'
              ELSE 'website' END AS k, g.value AS v
  FROM base b, jsonb_each(b.raw) e, jsonb_each_text(e.value) g
  WHERE jsonb_typeof(e.value)='object'
    AND e.key NOT IN ('contacts_web','contacts_web_all','linkedin','socials','lookups_missed','lookup_options')
    AND lower(g.key) IN ('phone','phone number','phone_number','telephone','email','email address','email_address',
                         'website','website_url','web','domain','service''s website (if available)')
),
pts AS (
  SELECT id, 'phone' k, phone v, '' owner FROM base WHERE COALESCE(phone,'')<>''
  UNION ALL SELECT id,'email',email,'' FROM base WHERE COALESCE(email,'')<>''
  UNION ALL SELECT id,'website',site,'' FROM base WHERE site<>''
  UNION ALL SELECT id,'website',raw->'contacts_web'->>'website','' FROM base WHERE COALESCE(raw->'contacts_web'->>'website','')<>''
  UNION ALL SELECT id,k,v,'' FROM arr WHERE COALESCE(v,'')<>''
  UNION ALL SELECT id,k,v,'' FROM srcrec WHERE COALESCE(v,'')<>''
  UNION ALL SELECT id,'phone',tphone,name FROM team WHERE COALESCE(tphone,'')<>''
  UNION ALL SELECT id,'email',temail,name FROM team WHERE COALESCE(temail,'')<>''
  UNION ALL SELECT p.business_record_id, p.kind, p.value, p.owner
            FROM company_contact_points p JOIN base ON base.id = p.business_record_id
            WHERE p.kind IN ('phone','email','website')
),
ph AS (
  SELECT id, regexp_replace(regexp_replace(regexp_replace(v,'\(0\)',''),'\D','','g'),'^(0044|44)','0') n
  FROM pts WHERE k='phone'
),
flags AS (
  SELECT b.id, b.district,
    EXISTS (SELECT 1 FROM ph WHERE ph.id=b.id AND n ~ '^0[12][0-9]{8,9}$') AS landline,
    EXISTS (SELECT 1 FROM ph WHERE ph.id=b.id AND n ~ '^07[1-57-9][0-9]{8}$') AS mobile,
    EXISTS (SELECT 1 FROM pts WHERE pts.id=b.id AND k='email'
            AND lower(split_part(v,'@',1)) IN ('info','sales','hello','contact','contactus','enquiries','enquiry','support','admin','office','accounts','hr','careers','marketing','press','media','team','mail','general')) AS generic_email,
    EXISTS (SELECT 1 FROM pts WHERE pts.id=b.id AND k='email'
            AND (owner<>'' OR lower(split_part(v,'@',1)) ~ '^[a-z]{2,}[._-][a-z]{2,}$')
            AND lower(split_part(v,'@',1)) NOT IN ('info','sales','hello','contact','contactus','enquiries','enquiry','support','admin','office','accounts','hr','careers','marketing','press','media','team','mail','general')) AS named_email,
    EXISTS (SELECT 1 FROM team WHERE team.id=b.id AND name<>'' AND title<>'') AS named_with_title,
    EXISTS (SELECT 1 FROM pts WHERE pts.id=b.id AND k='website'
            AND v !~* '(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)') AS website
  FROM base b
)
SELECT district,
       count(*)                                 AS companies,
       count(*) FILTER (WHERE landline)         AS landline,
       count(*) FILTER (WHERE mobile)           AS mobile,
       count(*) FILTER (WHERE generic_email)    AS generic_email,
       count(*) FILTER (WHERE named_email)      AS named_contact_email,
       count(*) FILTER (WHERE named_with_title) AS named_contact_with_title,
       count(*) FILTER (WHERE website)          AS website
FROM flags
WHERE district ~ '^BN([1-3]|[5-9]|1[0-8]|2[0-7]|4[1-5])$'  -- the 30 BN districts: BN1-3, BN5-18, BN20-27, BN41-45
GROUP BY district
ORDER BY substring(district from '^BN([0-9]+)')::int;
SQL

echo "--- bn_checks.txt ---"; cat bn_checks.txt
echo "--- bn_counts.csv ---"; cat bn_counts.csv
