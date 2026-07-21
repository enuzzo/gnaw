#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.13.0}"
APP_NAME="Gnaw"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/app/$APP_NAME"
BUILD_DIR="$ROOT_DIR/.build/dmg"
DERIVED_DATA="$BUILD_DIR/DerivedData"
STAGE_ENGINE="$BUILD_DIR/engine"
NODE_CACHE="$ROOT_DIR/.build/node/$NODE_VERSION"
DIST_DIR="$ROOT_DIR/dist"

echo "==> 1/7 build engine"
cd "$ROOT_DIR"
npm run build

echo "==> 2/7 stage production engine tree"
rm -rf "$STAGE_ENGINE"
mkdir -p "$STAGE_ENGINE/dist"
cp -R "$ROOT_DIR/dist/engine" "$STAGE_ENGINE/dist/engine"
cp "$ROOT_DIR/package.json" "$STAGE_ENGINE/package.json"
cp "$ROOT_DIR/package-lock.json" "$STAGE_ENGINE/package-lock.json"
( cd "$STAGE_ENGINE" && npm ci --omit=dev --ignore-scripts )

echo "==> 3/7 prepare universal node"
"$ROOT_DIR/script/fetch_universal_node.sh" "$NODE_VERSION" "$NODE_CACHE"

echo "==> 4/7 build universal Release app"
xcodegen generate --spec "$PROJECT_DIR/project.yml"
xcodebuild \
  -project "$PROJECT_DIR/$APP_NAME.xcodeproj" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$DERIVED_DATA" \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  build

APP_BUNDLE="$DERIVED_DATA/Build/Products/Release/$APP_NAME.app"
RES="$APP_BUNDLE/Contents/Resources"

echo "==> 5/7 embed engine + node"
rm -rf "$RES/engine" "$RES/node"
mkdir -p "$RES/engine" "$RES/node/bin"
cp -R "$STAGE_ENGINE/." "$RES/engine/"
cp "$NODE_CACHE/bin/node" "$RES/node/bin/node"
chmod +x "$RES/node/bin/node"

echo "==> 6/7 ad-hoc sign inside-out"
codesign --force --sign - "$RES/node/bin/node"
# Sign any native Mach-O shipped in node_modules (defensive; prod deps are pure JS).
find "$RES/engine" -type f -perm +111 -print0 | while IFS= read -r -d '' f; do
  if file "$f" | grep -q "Mach-O"; then codesign --force --sign - "$f"; fi
done
codesign --force --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE" && echo "codesign verify OK"

echo "==> 7/7 build DMG"
mkdir -p "$DIST_DIR"
DMG_PATH="$DIST_DIR/$APP_NAME.dmg"
STAGE_DMG="$BUILD_DIR/dmg-root"
rm -f "$DMG_PATH"
rm -rf "$STAGE_DMG"; mkdir -p "$STAGE_DMG"
cp -R "$APP_BUNDLE" "$STAGE_DMG/"
ln -s /Applications "$STAGE_DMG/Applications"
cp "$ROOT_DIR/docs/dmg/FIRST-LAUNCH.txt" "$STAGE_DMG/How to open Gnaw.txt"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE_DMG" -ov -format UDZO "$DMG_PATH"

echo "Built $DMG_PATH"
