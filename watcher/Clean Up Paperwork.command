#!/usr/bin/env bash
# Double-click me in Finder to clean up the Paperwork folder right now.
# Uploads any new bills, then moves every Paid & Filed bill's source file
# into Paperwork/PROCESSED/. Safe to run any time.
cd "$(dirname "$0")"
echo "🧹 Farmboss Paperwork cleanup — running..."
echo
node watch-paperwork.mjs
STATUS=$?
echo
if [ $STATUS -eq 0 ]; then echo "✅ Done. You can close this window."; else echo "⚠️ Finished with errors — see above."; fi
read -n 1 -s -r -p "Press any key to close..."
