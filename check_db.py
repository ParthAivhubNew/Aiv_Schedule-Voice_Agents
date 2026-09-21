import sqlite3

db_path = r'c:\Users\aivhu\OneDrive - aivhub.com\Desktop\Voice_AI_agent\backend\aivhub.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=== Telephony and Voice Orchestration Connections ===")
cursor.execute("SELECT group_name, name, status, api_key_masked FROM connections WHERE group_name IN ('Telephony', 'Voice Orchestration')")
rows = cursor.fetchall()

if rows:
    for row in rows:
        print(f"{row[0]}: {row[1]} ({row[2]}) - Masked Key: {row[3]}")
else:
    print("No Telephony or Voice Orchestration connections found.")

print("\n=== Recent Process Logs (last 10) ===")
cursor.execute("""
    SELECT datetime(created_at), subsystem, process_name, level, message 
    FROM process_logs 
    WHERE process_name LIKE '%provision%' OR process_name LIKE '%xai%'
    ORDER BY created_at DESC 
    LIMIT 10
""")
logs = cursor.fetchall()
if logs:
    for log in logs:
        print(f"[{log[0]}] {log[2]} ({log[3]}): {log[4]}")
else:
    print("No provisioning or xAI process logs found.")

conn.close()
