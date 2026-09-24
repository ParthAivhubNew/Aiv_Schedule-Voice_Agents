#!/usr/bin/env python3
"""
Migration script to set up multi-tenant architecture with org_id.

This script:
1. Creates the organizations table
2. Adds org_id columns to Operator, CompanyProfile, Mission, LiveCall
3. Ensures backward compatibility with existing data
4. Creates a default organization for existing operators
"""

import asyncio
import uuid
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.config import settings
from app.database import Base
from app.models.models import Organization, Operator, CompanyProfile, Mission, LiveCall

async def migrate_to_multitenant():
    """Run the multi-tenant migration"""
    
    # Create engine from DATABASE_URL
    db_url = settings.DATABASE_URL
    if not db_url:
        raise ValueError("DATABASE_URL not configured in environment")
    
    engine = create_async_engine(db_url, echo=True)
    
    async with engine.begin() as conn:
        print("🔄 Starting multi-tenant migration...")
        
        # 1. Create organizations table if it doesn't exist
        print("📋 Creating organizations table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS organizations (
                id VARCHAR NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL,
                slug VARCHAR UNIQUE NOT NULL,
                status VARCHAR DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))
        
        # 2. Add org_id column to operators table if it doesn't exist
        print("👤 Updating operators table...")
        await conn.execute(text("""
            ALTER TABLE operators
            ADD COLUMN IF NOT EXISTS org_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE;
        """))
        
        # 3. Add org_id column to company_profile table if it doesn't exist
        print("🏢 Updating company_profile table...")
        await conn.execute(text("""
            ALTER TABLE company_profile
            ADD COLUMN IF NOT EXISTS org_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE;
        """))
        
        # 4. Add org_id column to missions table if it doesn't exist
        print("🎯 Updating missions table...")
        await conn.execute(text("""
            ALTER TABLE missions
            ADD COLUMN IF NOT EXISTS org_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE;
        """))
        
        # 5. Add org_id column to live_calls table if it doesn't exist
        print("📞 Updating live_calls table...")
        await conn.execute(text("""
            ALTER TABLE live_calls
            ADD COLUMN IF NOT EXISTS org_id VARCHAR REFERENCES organizations(id) ON DELETE CASCADE;
        """))
        
        # 6. Create default organization if none exists
        print("🌍 Creating default organization...")
        await conn.execute(text("""
            INSERT INTO organizations (id, name, slug, status)
            VALUES ('org_default', 'Default Organization', 'default', 'active')
            ON CONFLICT DO NOTHING;
        """))
        
        # 7. Assign existing operators to default organization (if not already assigned)
        print("👥 Assigning existing operators to default organization...")
        await conn.execute(text("""
            UPDATE operators
            SET org_id = 'org_default'
            WHERE org_id IS NULL;
        """))
        
        # 8. Assign existing company profiles to default organization (if not already assigned)
        print("🏢 Assigning existing company profiles to default organization...")
        await conn.execute(text("""
            UPDATE company_profile
            SET org_id = 'org_default'
            WHERE org_id IS NULL;
        """))
        
        # 9. Assign existing missions to default organization (if not already assigned)
        print("🎯 Assigning existing missions to default organization...")
        await conn.execute(text("""
            UPDATE missions
            SET org_id = 'org_default'
            WHERE org_id IS NULL;
        """))
        
        # 10. Assign existing live calls to default organization (if not already assigned)
        print("📞 Assigning existing live calls to default organization...")
        await conn.execute(text("""
            UPDATE live_calls
            SET org_id = 'org_default'
            WHERE org_id IS NULL;
        """))
        
        # 11. Make org_id NOT NULL for all tables (after migration)
        print("🔒 Making org_id non-nullable...")
        await conn.execute(text("""
            ALTER TABLE operators
            ALTER COLUMN org_id SET NOT NULL;
        """))
        
        await conn.execute(text("""
            ALTER TABLE live_calls
            ALTER COLUMN org_id SET NOT NULL;
        """))
        
        # Note: CompanyProfile and missions may still have nullable org_id if needed for multi-tenant support
        
        await conn.commit()
        print("✅ Multi-tenant migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(migrate_to_multitenant())
