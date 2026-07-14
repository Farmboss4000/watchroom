#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  Schedule the Bills uploader to run automatically every night at 23:50.
#
#  Usage:   bash install-schedule.sh
#
#  It writes a launchd job (com.farmboss.bills-watcher) wired to THIS folder
#  and your installed node, (re)loads it, and runs it once so you can see it
#  work. Re-run any time to update it. To remove the schedule later:
#     bash install-schedule.sh --uninstall
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

LABEL="com.farmboss.bills-watcher"
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed the nightly schedule."
    exit 0
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
    echo "Error: node is not installed / not on PATH. Install Node first (nodejs.org)." >&2
    exit 1
fi
if [ ! -f "$DIR/.env" ]; then
    echo "Warning: no .env found in $DIR — the scheduled run needs BILLS_EMAIL / BILLS_PASSWORD set." >&2
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Note: this heredoc lives in a file (not pasted into a terminal), so it is
# written reliably. $NODE_BIN and $DIR are expanded to real paths.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$DIR/watch-paperwork.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$DIR</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>23</integer>
        <key>Minute</key><integer>50</integer>
    </dict>
    <key>StandardOutPath</key><string>$DIR/watcher.log</string>
    <key>StandardErrorPath</key><string>$DIR/watcher.err.log</string>
</dict>
</plist>
PLISTEOF

echo "Wrote schedule:"
echo "  file: $PLIST"
echo "  node: $NODE_BIN"
echo "  dir:  $DIR"

# (Re)load with the modern launchctl commands (bootout/bootstrap are reliable
# on current macOS; the older load/unload often silently no-ops).
launchctl bootout   "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
echo "Scheduled: the uploader now runs every night at 23:50."

echo
echo "Running it once now to confirm it works ..."
launchctl kickstart -p "gui/$UID_NUM/$LABEL" || true
sleep 12
echo "----- watcher.log -----"
cat "$DIR/watcher.log" 2>/dev/null || echo "(no log yet — see watcher.err.log)"
echo "-----------------------"
echo "Done. It will now run automatically at 23:50 nightly."
echo "To remove it later:  bash install-schedule.sh --uninstall"
