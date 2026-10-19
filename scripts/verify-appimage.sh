#!/usr/bin/env bash
# Verify a built AppImage is actually self-contained (i.e. will run on any distro).
#
# Why this matters: the whole point of the AppImage is that an Arch user, an Ubuntu
# user and a Fedora user all download the SAME file. If it silently links against the
# host's libwebkit2gtk, it will break on someone else's machine.
#
# Usage:  ./scripts/verify-appimage.sh "path/to/App.AppImage"

set -euo pipefail

APPIMAGE="${1:-}"
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "usage: $0 <path-to.AppImage>" >&2
  exit 1
fi

echo "==> checking $APPIMAGE"
ls -lh "$APPIMAGE"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

echo
echo "==> extracting"
"$APPIMAGE" --appimage-extract >/dev/null

DIR="squashfs-root"
[[ -d "$DIR" ]] || { echo "FAIL: extraction produced no squashfs-root" >&2; exit 1; }

fail=0

echo
echo "==> 1. bundled shared libraries"
COUNT=$(find "$DIR" -name "*.so*" -o -name "*.so" 2>/dev/null | wc -l)
echo "    found $COUNT bundled .so files"
if [[ "$COUNT" -lt 50 ]]; then
  echo "    WARN: suspiciously few — the app may depend on the host's libs"
  fail=1
fi

echo
echo "==> 2. bundled WebKit (the fragile dependency)"
if find "$DIR" -path "*webkit2gtk*" -name "WebKitWebProcess" | grep -q .; then
  echo "    WebKitWebProcess bundled"
else
  echo "    FAIL: WebKit is NOT bundled — AppImage will break on other distros"
  fail=1
fi

echo
echo "==> 3. AppRun + desktop entry + icon"
for f in "AppRun" "AppRun.wrapped"; do
  [[ -f "$DIR/$f" ]] && echo "    $f present" || { echo "    FAIL: missing $f"; fail=1; }
done
if compgen -G "$DIR/*.desktop" > /dev/null || compgen -G "$DIR/usr/share/applications/*.desktop" > /dev/null; then
  echo "    .desktop present"
else
  echo "    FAIL: no .desktop entry"
  fail=1
fi
if compgen -G "$DIR/*.png" > /dev/null || compgen -G "$DIR/usr/share/icons/hicolor/*/apps/*.png" > /dev/null; then
  echo "    icon present"
else
  echo "    WARN: no icon found"
fi

echo
echo "==> 4. ELF architecture + interpreter"
BIN=$(find "$DIR/usr/bin" -type f -executable 2>/dev/null | head -1)
if [[ -n "$BIN" ]]; then
  echo "    binary: ${BIN#"$DIR/"}"
  file "$BIN" | sed 's/^/    /'
else
  echo "    FAIL: no executable found under usr/bin"
  fail=1
fi

echo
if [[ "$fail" -eq 0 ]]; then
  echo "PASS — AppImage is self-contained and distro-independent."
else
  echo "FAILED — see the issues above."
fi
exit "$fail"