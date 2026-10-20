#!/usr/bin/env bash
# Install AI Builder School Setup on macOS without Gatekeeper's "Apple could not verify" prompt.
#
# Why this works: Gatekeeper only assesses files carrying the com.apple.quarantine attribute.
# Browsers add it to downloads; curl does not, and tar does not copy it out of an archive.
# The app is ad-hoc signed, so it runs fine on Apple silicon - the prompt is the only problem.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ar-Raqmi/ai-builder-school-installer/master/scripts/install-mac.sh | bash

set -euo pipefail

RELEASES="https://github.com/ar-Raqmi/ai-builder-school-installer/releases"
APP="AI Builder School Setup.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS only."
  echo "For Windows or Linux, download the right file from $RELEASES/latest"
  exit 1
fi

case "$(uname -m)" in
  arm64) arch="aarch64" ;;
  x86_64) arch="x64" ;;
  *)
    echo "Sorry, I don't recognise this Mac's processor ($(uname -m))."
    echo "You can still download the .dmg from $RELEASES/latest"
    exit 1
    ;;
esac

tarball="AI.Builder.School.Setup_${arch}.app.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading AI Builder School Setup ($arch)..."
if ! curl -fL "$RELEASES/latest/download/$tarball" -o "$tmp/$tarball"; then
  echo "Couldn't download it. Check your internet connection, or get the .dmg from $RELEASES/latest"
  exit 1
fi

tar -xzf "$tmp/$tarball" -C "$tmp"
if [[ ! -d "$tmp/$APP" ]]; then
  echo "The download didn't contain \"$APP\" - please tell ar-Raqmi."
  exit 1
fi

# Never sudo: if /Applications isn't writable, a per-user folder works just as well.
if [[ -w /Applications ]]; then
  dest_dir="/Applications"
else
  dest_dir="$HOME/Applications"
  mkdir -p "$dest_dir"
fi
dest="$dest_dir/$APP"

rm -rf "${dest:?}"
mv "$tmp/$APP" "$dest"
# Insurance only: nothing above should have set the attribute.
xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

echo "Installed to $dest"
open "$dest"
