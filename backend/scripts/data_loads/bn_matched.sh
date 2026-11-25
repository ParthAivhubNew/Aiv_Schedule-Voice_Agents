#!/usr/bin/env bash
# Contact data held for FSB's Companies House population, taken from the store's other records of the same business
# (Google / food hygiene / other imports) matched on company name + postcode. Read-only. Run in /opt/flow next to bn_appendix1.sh.
# Writes appendix1_matched.csv
set -u
eval "$(sed -n '/^PG=/,/^)"$/p' bn_appendix1.sh)"   # reuses PG, the exclusion rules and BASE from bn_appendix1.sh

$PG --csv > appendix1_matched.csv <<SQL
$BASE,
pop AS (SELECT id, district, postcode,
          regexp_replace(regexp_replace(upper(name),'\s+(LIMITED|LTD|LLP|PLC)\.?\s*\$',''),'[^A-Z0-9]','','g') AS nm,
          regexp_replace(upper(postcode),'\s','','g') AS pc
        FROM ruled WHERE removed_by IS NULL),
oth AS (SELECT b.id,
          regexp_replace(regexp_replace(upper(b.name),'\s+(LIMITED|LTD|LLP|PLC)\.?\s*\$',''),'[^A-Z0-9]','','g') AS nm,
          regexp_replace(upper(b.postcode),'\s','','g') AS pc,
          regexp_replace(regexp_replace(regexp_replace(COALESCE(b.phone,''),'\(0\)',''),'\D','','g'),'^(0044|44)','0') AS ph,
          NULLIF(b.email,'') AS em, NULLIF(COALESCE(NULLIF(b.website,''),b.domain),'') AS site
        FROM business_records b
        WHERE b.postcode LIKE 'BN%' AND COALESCE(b.registration_number,'') !~ '^[A-Z0-9]{8}\$'
          AND COALESCE(b.sources::text,'') NOT LIKE '%ds_charity_commission%'
          AND COALESCE(b.sources::text,'') !~* 'apollo' AND COALESCE(b.raw_data::text,'') !~* '"apollo'),
m AS (SELECT p.id, p.district,
          bool_or(o.ph ~ '^0[123][0-9]{8,9}\$') land, bool_or(o.ph ~ '^07[1-57-9][0-9]{8}\$') mob,
          bool_or(o.em IS NOT NULL) em, bool_or(o.site IS NOT NULL AND o.site !~* '(facebook|linkedin|twitter|instagram|yell\.com|companieshouse|checkatrade|trustpilot|192\.com|google\.)') web
      FROM pop p JOIN oth o ON o.nm = p.nm AND o.pc = p.pc GROUP BY p.id, p.district)
SELECT p.district, count(*) AS companies,
  count(*) FILTER (WHERE m.land) AS landline, count(*) FILTER (WHERE m.mob) AS mobile,
  count(*) FILTER (WHERE m.land OR m.mob) AS telephoneable, count(*) FILTER (WHERE m.em) AS with_email,
  count(*) FILTER (WHERE m.web) AS website, count(m.id) AS matched_to_other_record
FROM pop p LEFT JOIN m ON m.id = p.id
GROUP BY p.district ORDER BY substring(p.district from '[0-9]+')::int;
SQL
cat appendix1_matched.csv
