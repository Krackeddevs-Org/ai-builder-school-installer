#!/usr/bin/env bash
# Build everything this machine can build locally.
#
# What this can and cannot do:
#   Linux  -> deb, rpm, AppImage   (YES, natively)
#   Windows -> msi, nsis           (NO  — .msi needs WiX, which only runs on Windows)
#   macOS  -> dmg, app             (NO  — needs the Apple SDK, not redistributable)
#
# For Windows/macOS use the GitHub Actions workflow (.github/workflows/release.yml),
# which builds each target on its native runner.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> building for $(uname -s)"
case "$(uname -s)" in
  Linux)
    npx tauri build --bundles deb,rpm,appimage
    echo
    echo "==> verifying the AppImage is self-contained"
    APPIMAGE=$(find src-tauri/target/release/bundle/appimage -name "*.AppImage" | head -1)
    [[ -n "$APPIMAGE" ]] && ./scripts/verify-appimage.sh "$APPIMAGE"
    ;;
  Darwin)
    npx tauri build --bundles dmg,app
    ;;
  *)
    echo "unsupported host: $(uname -s)" >&2
    exit 1
    ;;
esac

echo
echo "==> artifacts"
find src-tauri/target/release/bundle -maxdepth 2 -type f \
  \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.dmg" -o -name "*.msi" -o -name "*.exe" \) \
  -exec ls -lh {} \; 2>/dev/null || echo "(none found — check the build output above)"