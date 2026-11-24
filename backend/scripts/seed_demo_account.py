"""Kept for the old command: the same as seed_fsb_demo.py, which seeds sample data into a demo organisation staff created. No logins are made.

    python backend/scripts/seed_demo_account.py --org org_xxx
    python backend/scripts/seed_demo_account.py --org org_xxx --reset
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from seed_fsb_demo import main  # noqa: E402

if __name__ == "__main__":
    asyncio.run(main())
