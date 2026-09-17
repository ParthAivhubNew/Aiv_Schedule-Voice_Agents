Classic Post Scheduler backup
=============================

`App.jsx.classic-backup` is a frozen copy of `frontend/src/App.jsx` taken before the Simple (chat + calendar) workspace shipped.

The live Classic UI is still the `PostSchedulerPlugin` function inside `frontend/src/App.jsx`. Do not delete it.

Restore the old 10-tab plugin without deleting Simple:
- Say "make it like old one"
- Gear: Use classic scheduler
- `localStorage.aivhub_scheduler_edition = classic`
- Hash: `#/scheduler?edition=classic`

Back to Simple: "make it simple" or `edition=simple`.
