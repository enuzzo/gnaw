#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"      # e.g. v22.13.0
DEST="$2"         # cache dir; produces $DEST/bin/node

if [[ -x "$DEST/bin/node" ]]; then
  echo "universal node already cached at $DEST/bin/node"
  lipo -info "$DEST/bin/node"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for ARCH in arm64 x64; do
  URL="https://nodejs.org/dist/$VERSION/node-$VERSION-darwin-$ARCH.tar.gz"
  echo "downloading $URL"
  curl -fsSL "$URL" -o "$TMP/node-$ARCH.tar.gz"
  mkdir -p "$TMP/$ARCH"
  tar -xzf "$TMP/node-$ARCH.tar.gz" -C "$TMP/$ARCH" --strip-components=1
done

mkdir -p "$DEST/bin"
TMP_NODE="$TMP/node.universal"
lipo -create "$TMP/arm64/bin/node" "$TMP/x64/bin/node" -output "$TMP_NODE"
chmod +x "$TMP_NODE"
codesign --force --sign - "$TMP_NODE"
mv "$TMP_NODE" "$DEST/bin/node"
lipo -info "$DEST/bin/node"
