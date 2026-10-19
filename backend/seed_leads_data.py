import asyncio
from app.database import engine
from sqlalchemy import text
import json

async def seed_data():
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT id FROM organizations LIMIT 1;"))
        row = res.fetchone()
        org_id = row[0] if row else 'org_default'
        
        accounts = [
            {'id': 'acc_1', 'org_id': org_id, 'name': 'Leeds City Dental Clinic', 'website': 'https://leedscitydental.co.uk', 'phone': '+441132456789', 'email': 'info@leedscitydental.co.uk', 'industry': 'Healthcare', 'region': 'Leeds'},
            {'id': 'acc_2', 'org_id': org_id, 'name': 'Headingley Dental Care', 'website': 'https://headingleydental.co.uk', 'phone': '+441132789123', 'email': 'contact@headingleydental.co.uk', 'industry': 'Healthcare', 'region': 'Leeds'},
            {'id': 'acc_3', 'org_id': org_id, 'name': 'Whitecross Dental Centre', 'website': 'https://whitecrossdental.co.uk', 'phone': '+441132345678', 'email': 'reception@whitecrossdental.co.uk', 'industry': 'Healthcare', 'region': 'Leeds'},
            {'id': 'acc_4', 'org_id': org_id, 'name': 'Yorkshire Smile Studio', 'website': 'https://yorkshiresmile.co.uk', 'phone': '+441132678901', 'email': 'hello@yorkshiresmile.co.uk', 'industry': 'Healthcare', 'region': 'Leeds'},
        ]
        for a in accounts:
            await conn.execute(text("""
                INSERT INTO lead_accounts (id, org_id, name, website, phone, email, industry, region, created_at)
                VALUES (:id, :org_id, :name, :website, :phone, :email, :industry, :region, NOW())
                ON CONFLICT (id) DO NOTHING;
            """), a)
            
        lists_doc = json.dumps({"lists": [
            {"id": "list_leeds_dental", "name": "Leeds Dental Practices", "ids": ["acc_1", "acc_2", "acc_3", "acc_4"]}
        ]})
        key = f"leadlists:{org_id}"
        await conn.execute(text("""
            INSERT INTO app_settings (id, data, updated_at)
            VALUES (:id, :data, NOW())
            ON CONFLICT (id) DO UPDATE SET data = :data, updated_at = NOW();
        """), {'id': key, 'data': lists_doc})
        
    print('Seeded sample list and accounts successfully!')

if __name__ == '__main__':
    asyncio.run(seed_data())
