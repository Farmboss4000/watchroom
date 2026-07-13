# Farmboss Bills — Paperwork folder uploader

A small program for **macOS** that looks at a local **Paperwork** folder,
figures out which files haven't been uploaded yet, and uploads only those into
the [Bills](../bills.html) app. It can run **once a night on a schedule** or
stay running continuously.

For each new PDF/image it: reads the bill with Claude — the **same** extraction
the Bills page uses (vendor, amount, bill date, due date, account #, invoice #,
category, notes) — uploads the file to Firebase Storage, and creates the bill
in the shared `bills` collection, defaulting to **Unpaid & Unfiled**.

### How it knows what's already uploaded

Files are **never moved or renamed** — they stay in your Paperwork folder. The
uploader keeps a hidden ledger, `.bills-watcher-ledger.json`, inside that folder
recording every file it has uploaded, keyed by the file's **contents**. So:

- Re-running only uploads files it hasn't seen before.
- Renaming a file won't cause a duplicate upload.
- A file that fails (e.g. a network hiccup) is **not** recorded, so it's retried
  on the next run.

Supported file types: **PDF, PNG, JPG/JPEG, GIF, WEBP** (others like `.heic` are
skipped — convert them to PDF/JPEG first). It looks at the **top level** of the
Paperwork folder, not sub-folders.

---

## One-time setup

**1. Install Node.js 18+** (if you don't have it): download the **LTS** installer
from [nodejs.org](https://nodejs.org), run it, then quit and reopen Terminal.
Check with `node --version`.

**2. Install dependencies:**

```bash
cd watchroom-app/watcher
npm install
```

**3. Create your config:**

```bash
cp .env.example .env
open -e .env
```

Set `BILLS_EMAIL` and `BILLS_PASSWORD` to the **same login you use for the Bills
web app**, save, and close. Leave the `ANTHROPIC_*` lines blank to reuse the key
already saved in **Bills → Settings**. `.env` stays on your machine (gitignored).

**4. Make the folder** (if needed): `mkdir -p ~/Desktop/Paperwork`
*(To watch a different folder, set `WATCH_DIR` in `.env`.)*

---

## Running it

**Upload new files now, once (recommended for testing):**

```bash
npm start
```

It prints a summary like `Done — 4 uploaded, 12 already uploaded, 0 unsupported,
0 failed.` and exits. Run it as often as you like — it only ever uploads files
it hasn't uploaded before.

**Stay running and upload files the moment they're added:**

```bash
npm run watch
```

(Press `Ctrl+C` to stop.)

**Run the built-in logic tests:**

```bash
npm test
```

---

## Run automatically every night at 11:50 PM

macOS `launchd` can run the uploader on a schedule. This runs it once each night
at **23:50** and uploads anything added that day.

**1.** Find your node path and this folder's absolute path:

```bash
which node          # e.g. /opt/homebrew/bin/node  (Apple Silicon)
pwd                 # e.g. /Users/you/watchroom-app/watcher
```

**2.** Edit `com.farmboss.bills-watcher.plist` and replace the node path and both
`/ABSOLUTE/PATH/TO/watchroom-app/watcher` placeholders with your real paths.

**3.** Install and start the schedule:

```bash
cp com.farmboss.bills-watcher.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
```

It now runs every night at 23:50. Output is written to `watcher.log` /
`watcher.err.log` in this folder. To run it immediately as a test:

```bash
launchctl start com.farmboss.bills-watcher
```

**To change the time / stop / remove it:**

```bash
# stop & remove
launchctl unload ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
rm ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
```

To change the time, edit the `Hour`/`Minute` in the plist, then unload and load
it again.

> **Note:** the Mac must be **awake** at 23:50 for the job to run on time. If it's
> asleep, launchd runs the job the next time the Mac wakes — so nothing is
> skipped, it just runs a bit later.

---

## Notes & troubleshooting

- **"Sign-in failed":** check `BILLS_EMAIL` / `BILLS_PASSWORD` in `.env`.
- **"out of API credits":** add credits at console.anthropic.com → Settings →
  Billing (the uploader uses the same key as the app).
- **"storage/quota-exceeded":** your Firebase Storage is full — upgrade the
  Firebase project to the Blaze plan or free up space, then re-run.
- **A file keeps getting skipped:** it's already in the ledger (already
  uploaded) or it's an unsupported type. To force a re-upload, remove its entry
  from `.bills-watcher-ledger.json` (or delete that file to re-upload
  everything).
- Everything runs on your machine. Your `.env` (including your password) and the
  ledger are never committed or uploaded anywhere.
