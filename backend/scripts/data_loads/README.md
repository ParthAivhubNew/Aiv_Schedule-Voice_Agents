# One-off data loads and the FSB bid scripts

Moved here from the repository root (plan 11, step 7). Each was run by hand, once, inside the backend container
(`docker exec -w /app aivhub_backend python /tmp/<script>`). None runs on its own, and none is imported by the app.

They're kept because they're the record of **where bulk data in the shared company records came from**:

| raw_data key | Loaded by | What it is |
|---|---|---|
| `import_bn_leads` | `bn_load_leads.py` | The BN leads file. Its phones and websites came from Google (every row with one has a Google match), so they're view-only and never exported (`services/source_catalog.py`). |
| `import_scrapegraph_bn` | `load_scrapegraph.py` | A web scrape of company websites: phones, e-mails and websites. |
| `fsb_sample_2026_11` | `bn_sample500_v2.py` (earlier versions: `bn_sample*.py`; control: `bn_sample_ctl.py`; undo: `bn_restore.py`) | The FSB bid's research run on 500 companies. |
| `phone_screenings` table | `load_tps_to_db.py` | Provero's TPS / CTPS answers. |

The rest are read-only reports for the FSB bid (Appendix 1 counts, costs, server facts):
- `bn_appendix1.sh`, `bn_counts.sh`, `bn_matched.sh`, `bn_costs.sh`, `bn_info.sh`, `bn_discover.sh`
- `bn_company_list.py`, `bn_people.py`, `bn_store_bid.py`, `bn_enrich_all.py`
- `industry_values.py` (read-only notes for the industry search)

Before running one again, read it. Several write to the shared company records. The CSV files they read are kept outside the
repository, in `/root/aivhub-private-data/`, because they hold personal data.
