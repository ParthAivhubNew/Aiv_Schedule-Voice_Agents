import sqlite3
import json

conn = sqlite3.connect("aivhub.db")
cur = conn.cursor()

# 1. Update company caller ID
cur.execute("UPDATE company_profile SET caller_id = ? WHERE id = ?", ("+44 56 0002 2627", "default"))

# 2. Insert or replace Sipgate connection
cfg = {
    "sip_id": "4032431t0",
    "auth_token": "qURd1qn99mBV",
    "api_key": "qURd1qn99mBV",
    "server": "sipconnect.sipgate.co.uk",
    "phoneNumber": "+445600022627",
    "carrier": "sipgate"
}
cur.execute(
    "INSERT OR REPLACE INTO connections (id, name, group_name, status, api_key_masked, config) VALUES (?, ?, ?, ?, ?, ?)",
    ("c_tele_sipgate", "Sipgate UK Trunk", "Telephony", "connected", "4032431••••", json.dumps(cfg))
)

conn.commit()
print("Sipgate successfully persisted in aivhub.db!")
conn.close()
