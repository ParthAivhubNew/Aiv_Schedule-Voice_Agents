"""Kept for the old command: the FSB demo account is now made by seed_fsb_demo.py, in its own organisation (org_fsb_demo).

    python backend/scripts/seed_demo_account.py            (same as seed_fsb_demo.py)
    python backend/scripts/seed_demo_account.py --reset
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
