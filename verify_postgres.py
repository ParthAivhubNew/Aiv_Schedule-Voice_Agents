#!/usr/bin/env python3
"""Verify PostgreSQL connection status"""
import os
import sys
from pathlib import Path

# Read .env
env_file = Path("backend/.env")
if not env_file.exists():
    print("❌ backend/.env not found")
    sys.exit(1)

db_url = None
with open(env_file) as f:
    for line in f:
        if line.startswith("DATABASE_URL="):
            db_url = line.split("=", 1)[1].strip()
            break

print("=" * 60)
print("PostgreSQL Connection Verification")
print("=" * 60)

if not db_url:
    print("❌ DATABASE_URL not set in .env")
    sys.exit(1)

print(f"\n📋 Current DATABASE_URL:")
print(f"   {db_url}")

# Check if using PostgreSQL
if "postgresql" in db_url:
    print("\n✅ Using PostgreSQL (correct)")
    
    # Parse connection details
    if "@" in db_url and "://" in db_url:
        parts = db_url.split("@")[1].split("/")
        host_port = parts[0]
        dbname = parts[1] if len(parts) > 1 else "aivhub"
        print(f"\n🔗 Connection Details:")
        print(f"   Host: {host_port.split(':')[0]}")
        print(f"   Port: {host_port.split(':')[1] if ':' in host_port else '5432'}")
        print(f"   Database: {dbname}")
        
        print("\n✅ To test connection, run:")
        print(f"   psql -U postgres -d {dbname} -c 'SELECT 1;'")
        
elif "sqlite" in db_url:
    print("\n❌ Using SQLite (NOT PostgreSQL)")
    print("   This means your data is local only!")
    print(f"   File: {db_url.split('///')[-1]}")
    print("\n⚠️  To fix, update DATABASE_URL to:")
    print("   DATABASE_URL=postgresql+asyncpg://postgres:postgres_secure_password_2026@postgres:5432/aivhub")

print("\n" + "=" * 60)
print("To verify the connection is ACTUALLY working:")
print("=" * 60)
print("\n1. Check Docker logs:")
print("   docker-compose logs backend --tail 20")
print("\n2. Make a change in the app and restart:")
print("   docker-compose restart backend")
print("   Then check if the change persists")
print("\n3. Query the database directly:")
print("   docker-compose exec postgres psql -U postgres -d aivhub -c 'SELECT COUNT(*) FROM connections;'")
print("\n" + "=" * 60)
