#!/usr/bin/env bash
# Install AI Builder School Setup on Linux from the latest release's AppImage.
#
# Why this isn't a fixed download URL like install-mac.sh: Tauri puts the version in the
# AppImage's filename (AI.Builder.School.Setup_<version>_amd64.AppImage), so the real name
# is looked up through the GitHub API on every run. The file is then saved under a fixed
# name, so the command students type never changes between releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ar-Raqmi/ai-builder-school-installer/master/scripts/install-linux.sh | bash

set -euo pipefail

REPO="ar-Raqmi/ai-builder-school-installer"
RELEASES="https://github.com/$REPO/releases"
API="https://api.github.com/repos/$REPO/releases/latest"
NAME="ai-builder-school-setup"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script is for Linux only."
  echo "For Windows or macOS, download the right file from $RELEASES/latest"
  exit 1
fi

case "$(uname -m)" in
  x86_64 | amd64) arch="amd64" ;;
  aarch64 | arm64) arch="aarch64" ;;
  *)
    echo "Sorry, I don't recognise this computer's processor ($(uname -m))."
    echo "You can still look for a download on $RELEASES/latest"
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One download URL per line. python3 is preferred, but a minimal system may not have it.
asset_urls() {
  if command -v python3 > /dev/null 2>&1; then
    python3 -c 'import json, sys
for a in json.load(open(sys.argv[1])).get("assets", []):
    print(a["browser_download_url"])' "$1"
  else
    grep -o '"browser_download_url": *"[^"]*"' "$1" | sed 's/^[^:]*: *"//; s/"$//'
  fi
}

echo "Looking up the latest release..."
if ! curl -fsSL -H "Accept: application/vnd.github+json" "$API" -o "$tmp/release.json"; then
  echo "Couldn't ask GitHub for the latest release. Either you're offline, or GitHub has"
  echo "temporarily limited requests from your network. Wait a few minutes and try again,"
  echo "or download the .AppImage yourself from $RELEASES/latest"
  exit 1
fi

urls="$(asset_urls "$tmp/release.json" 2> /dev/null | grep "_${arch}\.AppImage$" || true)"
if [[ -z "$urls" ]]; then
  echo "The latest release has no AppImage for this computer ($arch) yet."
  echo "Have a look at $RELEASES/latest, or tell ar-Raqmi."
  exit 1
fi

url="$(printf '%s\n' "$urls" | sed -n 1p)"
file="${url##*/}"
if [[ "$(printf '%s\n' "$urls" | grep -c .)" -gt 1 ]]; then
  echo "Found more than one AppImage, using $file"
fi

echo "Downloading AI Builder School Setup ($arch)..."
if ! curl -fL "$url" -o "$tmp/$file"; then
  echo "Couldn't download it. Check your internet connection, or get the .AppImage from $RELEASES/latest"
  exit 1
fi

# Never sudo: ~/.local/bin is yours, and most distros already put it on the PATH.
dest_dir="$HOME/.local/bin"
mkdir -p "$dest_dir"
dest="$dest_dir/$NAME"
mv -f "$tmp/$file" "$dest"
chmod +x "$dest"

echo "Installed to $dest"
echo "To open it again any time, run: $NAME"
case ":$PATH:" in
  *":$dest_dir:"*) ;;
  *)
    echo "($dest_dir isn't on your PATH yet, so until it is, run $dest instead."
    echo " To fix that, add this line to your ~/.bashrc or ~/.zshrc: export PATH=\"\$HOME/.local/bin:\$PATH\")"
    ;;
esac

echo "Opening it now (this terminal stays busy until you close the app)..."
# stdin is /dev/null so the app can't swallow the rest of this script when it's piped to bash.
if "$dest" < /dev/null 2> "$tmp/app.err"; then
  exit 0
fi

# AppImages need FUSE (libfuse2) to mount themselves. Without it they fail with a confusing
# error; extracting first needs no FUSE at all.
if ! grep -qi fuse "$tmp/app.err"; then
  echo "The app stopped with an error:"
  cat "$tmp/app.err"
  exit 1
fi

echo "Your system is missing FUSE, which AppImages normally need, so I'm unpacking it first."
echo "Next time, open it with: APPIMAGE_EXTRACT_AND_RUN=1 $NAME"
(cd "$tmp" && "$dest" --appimage-extract > /dev/null)
"$tmp/squashfs-root/AppRun" < /dev/null
