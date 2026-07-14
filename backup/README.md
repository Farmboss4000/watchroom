# Farmboss — global backup & archive

Backs up **everything the sites have ever uploaded**, plus the database,
to your Mac. Two things happen on every run:

1. **Files — full mirror & archive.** Walks the entire Firebase Storage
   bucket (every folder: `bills_docs`, `armory_photos`,
   `machinery_maint_docs`, automotive receipts, real-estate statements —
   all of it, including folders added in the future) and copies every file
   into `~/FarmbossBackups/files/<same path>`.
   - **Incremental:** unchanged files are skipped (tracked in
     `backup-manifest.json`), so repeat runs are fast.
   - **Archive semantics:** a file deleted from the site is **kept** in
     the backup — nothing is ever removed locally.

2. **Data — dated snapshots.** Exports every known Firestore collection
   (bills, armory, machinery, automotive, livestock, real estate,
   contacts, settings, and more) as JSON into
   `~/FarmbossBackups/data/YYYY-MM-DD/`, giving you point-in-time copies
   of the database itself.

```
~/FarmbossBackups/
├── backup-manifest.json      what's been backed up (for incremental runs)
├── files/                    mirror + archive of every uploaded file
│   ├── bills_docs/…
│   ├── armory_photos/…
│   └── machinery_maint_docs/…
└── data/
    ├── 2026-07-14/bills.json, machinery_items.json, …
    └── 2026-07-21/…
```

## One-time setup

```bash
cd watchroom-app/backup
npm install
cp .env.example .env
open -e .env        # set BILLS_EMAIL / BILLS_PASSWORD (same as the watcher's .env)
```

## Run a backup

```bash
npm start           # incremental — only new/changed files
npm run full        # re-download everything from scratch
```

You'll get a summary like:

```
Files: 42 copied (63.5 MB), 118 unchanged, 0 failed.
Data: 14 collections (312 records) snapshotted to data/2026-07-14/
Backup complete → /Users/you/FarmbossBackups
```

## Run automatically every week

```bash
bash install-backup-schedule.sh
```

Schedules a launchd job for **every Sunday at 00:30** (the Mac must be
awake; if asleep it runs at next wake). Logs go to `backup.log` /
`backup.err.log` in this folder. Remove with
`bash install-backup-schedule.sh --uninstall`.

## Notes

- To change where backups go, set `BACKUP_DIR` in `.env`.
- New Firestore collections aren't picked up automatically — add their
  names to the `COLLECTIONS` list at the top of `backup.mjs`.
  (Files need no such list — the whole bucket is always walked.)
- Backups are plain files/JSON — for true disaster recovery, keep
  `~/FarmbossBackups` on a drive that's covered by Time Machine, iCloud,
  or another off-machine backup.
