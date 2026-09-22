# Multi-Tenant LiveKit Integration Setup

## Overview

The system has been configured for multi-tenant architecture where each organization:
- Has its own unique `org_id`
- Gets isolated LiveKit rooms (namespaced as `org_{org_id}_{room_name}`)
- Can only see their own calls and data
- Automatically passes org context through all API requests

## What Was Implemented

### 1. Database Schema Changes

**New Tables:**
- `organizations` - Stores tenant organization records with:
  - `id` (primary key)
  - `name` (organization name)
  - `slug` (unique URL-friendly identifier)
  - `status` (active/inactive/suspended)
  - Created/updated timestamps

**Updated Tables** (added `org_id` foreign key):
- `operators` - Associates users with organizations
- `company_profile` - Each org has their own company settings
- `missions` - Campaigns isolated per organization
- `live_calls` - Call records isolated per organization

### 2. Backend Changes

**Authentication (`backend/app/api/auth.py`):**
- Login endpoint now includes `org_id` in OperatorResponse
- `/auth/me` returns operator's `org_id`
- `/auth/users` lists all operators with their org context
- Fallback admin always gets `org_id: "default"`

**Schemas (`backend/app/schemas/schemas.py`):**
- `OperatorResponse` includes optional `org_id` field

**LiveKit Integration (`backend/app/api/livekit_router.py` + `backend/app/services/livekit_service.py`):**
- `/livekit/token` endpoint extracts org_id from:
  1. `X-Org-ID` HTTP header (primary)
  2. JWT claims in Authorization header (fallback)
  3. Defaults to "default" if not found
- Room names automatically prefixed: `org_{org_id}_{room_name}`
- Metadata includes `org_id` for tracking
- Each organization's calls are completely isolated

### 3. Frontend Changes

**API Client (`frontend/src/api/apiClient.js`):**
- Automatically extracts `org_id` from operator context in `sessionStorage`
- Injects `X-Org-ID` header in all API requests
- Fallback gracefully if operator context not available

**LiveKit Component (`frontend/src/components/LiveKitBrowserCallModal.jsx`):**
- No direct changes needed (apiClient handles org_id injection)
- Works transparently with multi-tenant backend

### 4. Migration Script

**`backend/scripts/migrate_to_multitenant.py`:**
- Creates organizations table
- Adds org_id columns to all relevant tables
- Creates "default" organization for backward compatibility
- Assigns all existing data to "default" organization
- Makes org_id non-nullable for operators and live_calls

## How It Works

### User Login Flow

```
User logs in with username/password
  ↓
Backend authenticates and returns operator object WITH org_id
  ↓
Frontend stores operator in sessionStorage (includes org_id)
  ↓
Frontend extracts org_id from sessionStorage
  ↓
Frontend adds X-Org-ID header to all API requests
```

### LiveKit Room Isolation

```
User requests LiveKit token
  ↓
Backend receives X-Org-ID header (from frontend)
  ↓
Backend generates room name: org_123_room_abc
  ↓
Users from other orgs cannot join this room
  ↓
Database records call with org_id for querying isolated data
```

### Database Queries (org isolation example)

```python
# Only see calls from user's org
calls = await db.execute(
    select(LiveCall)
    .where(LiveCall.org_id == user_org_id)
)

# Cross-org data is invisible
```

## Setup Instructions

### 1. Run Database Migration

```bash
cd backend
python -m scripts.migrate_to_multitenant
```

This will:
- Create organizations table
- Add org_id columns
- Create "default" organization
- Assign existing operators/missions/calls to "default" org

### 2. Verify Configuration

After migration, verify multi-tenant is working:

1. **Test Login:**
   - Admin logs in → receives org_id in response
   - Check browser console: `sessionStorage.getItem("aivhub_operator")` shows org_id

2. **Test LiveKit Token:**
   - Request token from browser
   - Check backend logs for `X-Org-ID: default` header
   - Verify room name includes org prefix: `org_default_room_abc`

3. **Test Call Isolation:**
   - Create call as Org A
   - Switch context to Org B
   - Org B should NOT see Org A's calls

### 3. Creating New Organizations

To add a new organization via API:

```python
# Create organization
org = Organization(
    id=f"org_{uuid.uuid4().hex[:8]}",
    name="Acme Corp",
    slug="acme-corp",
    status="active"
)
db.add(org)
await db.commit()

# Create user for that org
operator = Operator(
    id=f"op_{uuid.uuid4().hex[:8]}",
    username="alice@acme.com",
    name="Alice",
    org_id=org.id,  # Link to organization
    role="Admin",
    hashed_password=hash_password("...")
)
db.add(operator)
await db.commit()

# When Alice logs in, she gets org_id in response
# All her API calls automatically isolated to her org
```

## Testing Multi-Tenant Isolation

### Test Case 1: Cross-org call visibility

```python
# Setup: Create two orgs with operators
org_a = Organization(id="org_acme", name="Acme", slug="acme")
org_b = Organization(id="org_widgetco", name="Widget Co", slug="widgetco")

op_a = Operator(username="alice", org_id="org_acme")
op_b = Operator(username="bob", org_id="org_widgetco")

# When Alice calls list_missions():
# Should ONLY see missions WHERE org_id = "org_acme"
# Bob's missions are completely hidden
```

### Test Case 2: LiveKit room isolation

```python
# Alice requests token for room "call_123"
# Backend generates: org_acme_call_123

# Bob requests token for room "call_456"  
# Backend generates: org_widgetco_call_456

# Alice cannot join org_widgetco_call_456
# (LiveKit room join requires matching room name in token)
```

## Database Query Examples

### Query Only Organization's Data

```python
# Missions for current org only
from app.models.models import Mission

result = await db.execute(
    select(Mission)
    .where(Mission.org_id == operator.org_id)
)
missions = result.scalars().all()

# Live calls for current org only
from app.models.models import LiveCall

result = await db.execute(
    select(LiveCall)
    .where(LiveCall.org_id == operator.org_id)
    .order_by(LiveCall.created_at.desc())
)
calls = result.scalars().all()
```

### Create Multi-Tenant Data

```python
# Always set org_id when creating new records
new_mission = Mission(
    id=f"miss_{uuid.uuid4().hex[:8]}",
    org_id=operator.org_id,  # Associate with operator's org
    title="Q4 Campaign",
    ...
)
db.add(new_mission)
await db.commit()
```

## Backward Compatibility

- All existing data (operators, calls, missions) is automatically assigned to `org_id = "default"`
- Single-org deployments work exactly as before (just with org isolation layer)
- The system defaults to "default" org if org_id not provided
- Existing API clients that don't send X-Org-ID header will use default org

## Next Steps

1. **Run migration:** `python -m scripts.migrate_to_multitenant`
2. **Test login:** Verify operator context includes org_id
3. **Test LiveKit:** Verify room names have org prefix
4. **Deploy:** Rebuild and redeploy containers
5. **Monitor:** Watch logs for org_id extraction during first calls

## Troubleshooting

### "X-Org-ID header not found"
- Ensure frontend operator context is saved in sessionStorage
- Check browser DevTools → Application → SessionStorage → aivhub_operator
- Verify apiClient is reading and injecting the header

### "Room join failed for cross-org user"
- This is correct behavior (isolation working!)
- User cannot join rooms from different organizations
- Each user's calls are scoped to their org_id

### "Operator has no org_id after migration"
- Run migration script again: `python -m scripts.migrate_to_multitenant`
- Check that "default" organization was created
- Verify non-nullable constraint is working

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (React)                       │
│                                                           │
│  1. User logs in → Backend returns operator w/ org_id   │
│  2. sessionStorage stores operator object               │
│  3. apiClient reads org_id from sessionStorage           │
│  4. apiClient adds X-Org-ID header to every request     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ↓ X-Org-ID: org_123
         ┌─────────────────────────────────┐
         │    Backend FastAPI Routers      │
         │                                 │
         │  1. Extract X-Org-ID header    │
         │  2. Use org_id for DB queries  │
         │  3. Isolate all data per org   │
         │  4. LiveKit room prefix        │
         └──────────────┬──────────────────┘
                        │
                        ↓
         ┌──────────────────────────────────────┐
         │   PostgreSQL Database               │
         │                                      │
         │  organizations (id, name, slug)     │
         │  operators (org_id FK)              │
         │  missions (org_id FK)               │
         │  live_calls (org_id FK)             │
         │                                      │
         │  WHERE org_id = 'org_123' on ALL   │
         │  queries for isolation              │
         └──────────────────────────────────────┘
```

