# Farmboss Bills — Paperwork folder watcher

A small background program for **macOS** that watches a local **Paperwork**
folder and automatically ingests bills into the [Bills](../bills.html) app.

When you drop a bill (PDF or photo) into the folder, the watcher:

1. reads it with Claude — the **same** extraction the Bills page uses (vendor,
   amount, bill date, due date, account #, invoice #, category, notes);
2. uploads the file to Firebase Storage;
3. creates the bill in the shared `bills` collection, defaulting to **Unpaid &
   Unfiled**, so it appears in the Bills app automatically;
4. moves the file into `Paperwork/_processed/` (or `Paperwork/_failed/` with a
   `.error.txt` note if something went wrong) so nothing is ingested twice.

It watches the **top level** of the Paperwork folder (files dropped directly
into it), not sub-folders. Supported file types: **PDF, PNG, JPG/JPEG, GIF,
WEBP**. Other types (e.g. `.heic`) are moved to `_failed/` — convert those to
PDF/JPEG first.

---

## One-time setup

**1. Install Node.js 18+** (if you don't have it):

```bash
brew install node          # or download from https://nodejs.org
node --version             # should print v18 or newer
```

**2. Install dependencies:**

```bash
cd watcher
npm install
```

**3. Create your config:**

```bash
cp .env.example .env
```

Open `.env` and set `BILLS_EMAIL` and `BILLS_PASSWORD` to the **same login you
use for the Bills web app**. Leave the `ANTHROPIC_*` lines blank to reuse the
API key you already saved in **Bills → Settings**. `.env` is gitignored and
stays on your machine.

**4. Make the folder** (if it doesn't exist):

```bash
mkdir -p ~/Desktop/Paperwork
```

*(To watch a different folder, set `WATCH_DIR` in `.env`.)*

---

## Try it

```bash
npm start
```

You should see `Watching /Users/you/Desktop/Paperwork …`. Drop a bill PDF or
photo into the folder and watch it get added — then open the Bills app to see
it. Press `Ctrl+C` to stop.

Run the built-in logic tests any time with:

```bash
npm test
```

---

## Auto-start on login (keep it always running)

macOS `launchd` can run the watcher in the background and restart it on login.

**1.** Find your node path and this folder's absolute path:

```bash
which node          # e.g. /opt/homebrew/bin/node
pwd                 # e.g. /Users/you/watchroom/watcher
```

**2.** Edit `com.farmboss.bills-watcher.plist` and replace the node path and
both `/ABSOLUTE/PATH/TO/watchroom/watcher` placeholders with your real paths.

**3.** Install and start it:

```bash
cp com.farmboss.bills-watcher.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
```

It now starts automatically at every login. Logs are written to
`watcher.log` / `watcher.err.log` in this folder.

**To stop / remove it:**

```bash
launchctl unload ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
rm ~/Library/LaunchAgents/com.farmboss.bills-watcher.plist
```

---

## Notes & troubleshooting

- **Nothing happens when I add a file:** make sure the file is a supported type
  and was placed directly in the Paperwork folder (not a sub-folder). Check
  `watcher.err.log`.
- **"Sign-in failed":** double-check `BILLS_EMAIL` / `BILLS_PASSWORD` in `.env`.
- **"out of API credits":** add credits at console.anthropic.com → Settings →
  Billing (the watcher uses the same key as the app).
- **A file went to `_failed/`:** open the matching `.error.txt` for the reason,
  fix it, and move the file back into `Paperwork/` to retry.
- **Re-processing:** already-added files live in `_processed/`; the watcher
  never touches that sub-folder.
- This program runs entirely on your machine. Your `.env` (including your
  password) is never committed or uploaded anywhere.
