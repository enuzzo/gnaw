#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/app/Gnaw"
DERIVED_DATA="${TMPDIR:-/tmp}/GnawDerivedData-$UID"
APP_BUNDLE="$DERIVED_DATA/Build/Products/Debug/Gnaw.app"

pkill -x Gnaw >/dev/null 2>&1 || true

cd "$ROOT_DIR"
npm run build
xcodegen generate --spec "$PROJECT_DIR/project.yml"
xcodebuild \
  -project "$PROJECT_DIR/Gnaw.xcodeproj" \
  -scheme Gnaw \
  -configuration Debug \
  -derivedDataPath "$DERIVED_DATA" \
  build

export GNAW_PROJECT_ROOT="$ROOT_DIR"

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BUNDLE/Contents/MacOS/Gnaw"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate 'process == "Gnaw"'
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate 'subsystem == "dev.gnaw.app"'
    ;;
  --verify|verify)
    open_app
    sleep 2
    pgrep -x Gnaw >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
