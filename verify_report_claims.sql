-- Read-only checks of the claims in "Leads Finder — Test Report & Developer Notes" (an AI-written report, 3 Nov 2026).
-- Run against the production database with a read-only user. Every statement is a SELECT. Compare each result with the claim.

-- 1. "526 of 681 sampled (77%) have no company number yet tier = verified_registry" (issue 8)
SELECT confidence_tier,
       count(*) AS records,
       count(*) FILTER (WHERE coalesce(registration_number, '') = '') AS no_company_number,
       round(100.0 * count(*) FILTER (WHERE coalesce(registration_number, '') = '') / nullif(count(*), 0), 1) AS pct_no_number
FROM business_records GROUP BY 1 ORDER BY 2 DESC;

-- 2. "Tesco: 3,592 rows" and other repeated brands (issue 7). Top repeated names.
SELECT lower(name) AS name, count(*) AS rows FROM business_records
WHERE status ILIKE 'active' GROUP BY 1 HAVING count(*) > 100 ORDER BY 2 DESC LIMIT 20;

-- 3. "39 of 681 (6%) are schools, churches, food banks, nurseries" (issue 12). What the industry column holds, by size.
SELECT industry, count(*) FROM business_records GROUP BY 1 ORDER BY 2 DESC LIMIT 40;

-- 4. "Creative Cheesecakes website = ratings.food.gov.uk" and other directory pages stored as websites (issue 10)
SELECT count(*) AS directory_websites FROM business_records
WHERE website ILIKE ANY (ARRAY['%food.gov.uk%', '%facebook.com%', '%yell.com%', '%tripadvisor.%', '%linkedin.com%', '%instagram.com%',
                                '%companieshouse.gov.uk%', '%company-information.service.gov.uk%', '%192.com%', '%yelp.%']);

-- 5. "Contact coverage: accounting Leeds 0 of 379 have a website; dental Manchester 20 of 778" (data gap)
SELECT region,
       count(*) AS companies,
       count(*) FILTER (WHERE coalesce(website, '') <> '') AS with_website,
       count(*) FILTER (WHERE coalesce(email, '') <> '') AS with_email,
       count(*) FILTER (WHERE coalesce(phone, '') <> '') AS with_phone
FROM business_records
WHERE status ILIKE 'active' AND region ILIKE ANY (ARRAY['Leeds', 'Manchester'])
  AND (sic_text ILIKE ANY (ARRAY['%accounting%', '%dental%', '%dentist%']) OR sic_codes LIKE ANY (ARRAY['%|69201%', '%|69202%', '%|69203%', '%|86230%']))
GROUP BY 1;

-- 6. "Inconsistent formats: region UPPER vs Mixed; status active vs Active" (issue 13)
SELECT status, count(*) FROM business_records GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FILTER (WHERE region = upper(region) AND region <> '') AS region_all_caps,
       count(*) FILTER (WHERE region <> upper(region) AND region <> lower(region)) AS region_mixed,
       count(*) FILTER (WHERE industry LIKE '%|%') AS industry_pipe_joined
FROM business_records;

-- 7. "Tilbury Seafarers Centre shown as City of London Corporation" (issue 14): regions that look like councils, not towns
SELECT region, count(*) FROM business_records
WHERE region ILIKE '%council%' OR region ILIKE '%corporation%' OR region ILIKE '%borough%' OR region ILIKE '%authority%'
GROUP BY 1 ORDER BY 2 DESC LIMIT 25;

-- 8. "Best match sort is not ready; ranked is always false" (issue 15): does the ranking index exist, and are rows ranked?
SELECT indexname FROM pg_indexes WHERE tablename = 'business_records' AND indexname IN ('ix_business_records_rank_order', 'ix_business_records_postcode_prefix');
SELECT count(*) FILTER (WHERE rank_score IS NOT NULL) AS ranked_rows, count(*) AS all_rows FROM business_records;

-- 9. "Credits fell from 1,028 to 1,023 during a search-only session" (3 Nov 10:40-11:30). Change the time zone if needed.
SELECT created_at, org_id, kind, wallet, item, amount, quantity, note, ref
FROM credit_ledger
WHERE created_at >= '2026-11-03 10:40' AND created_at <= '2026-11-03 11:30' AND wallet = 'leadgen'
ORDER BY created_at;
