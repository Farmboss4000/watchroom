#!/usr/bin/env bash
# Schedule the Farmboss backup to run automatically every Sunday at 00:30.
# Usage:  bash install-backup-schedule.sh          (install / update)
#         bash install-backup-schedule.sh --uninstall
set -euo pipefail
LABEL="com.farmboss.backup"
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed the weekly backup schedule."
    exit 0
fi

NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && { echo "Error: node not found — install Node first (nodejs.org)." >&2; exit 1; }
[ -f "$DIR/.env" ] || echo "Warning: no .env in $DIR — the scheduled run needs BILLS_EMAIL / BILLS_PASSWORD." >&2

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$DIR/backup.mjs</string>
    </array>
    <key>WorkingDirectory</key><string>$DIR</string>
    <key>StartCalendarInterval</key>
    <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>0</integer><key>Minute</key><integer>30</integer></dict>
    <key>StandardOutPath</key><string>$DIR/backup.log</string>
    <key>StandardErrorPath</key><string>$DIR/backup.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl bootout   "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
echo "Scheduled: backup runs every Sunday at 00:30."
echo "Run it now to test:  launchctl kickstart -p gui/$UID_NUM/$LABEL   (log: backup.log)"
