#!/usr/bin/env bash
# download-gws-binary.sh — Download gws binary for a target platform.
#
# Fetches the pre-built gws binary from Google's GitHub releases
# and places it in mcpb/bin/ for bundling.
#
# Usage:
#   ./scripts/download-gws-binary.sh <platform> [version]
#
# Platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64
# Version defaults to the version in node_modules/@googleworkspace/cli

set -euo pipefail

PLATFORM="${1:-}"
VERSION="${2:-$(node -p 'require("@googleworkspace/cli/package.json").version')}"
BASE_URL="https://github.com/googleworkspace/cli/releases/download/v${VERSION}"
OUT_DIR="mcpb/bin"

if [[ -z "$PLATFORM" ]]; then
  echo "Usage: $0 <platform> [version]"
  echo "Platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64, all"
  exit 1
fi

download_binary() {
  local artifact="$1"
  local binary_name="$2"
  local url="${BASE_URL}/${artifact}"

  echo "  Downloading: ${url}"
  mkdir -p "${OUT_DIR}"

  if [[ "$artifact" == *.zip ]]; then
    local tmpzip
    tmpzip=$(mktemp)
    curl -sL "$url" -o "$tmpzip"
    unzip -qo "$tmpzip" -d "${OUT_DIR}"
    rm -f "$tmpzip"
  else
    curl -sL "$url" | tar xz -C "${OUT_DIR}"
  fi

  # Ensure binary is executable
  chmod +x "${OUT_DIR}/${binary_name}" 2>/dev/null || true
  echo "  Installed: ${OUT_DIR}/${binary_name}"
}

case "$PLATFORM" in
  darwin-arm64)
    echo "Fetching gws ${VERSION} for macOS ARM64..."
    download_binary "gws-aarch64-apple-darwin.tar.gz" "gws"
    ;;
  darwin-x64)
    echo "Fetching gws ${VERSION} for macOS x64..."
    download_binary "gws-x86_64-apple-darwin.tar.gz" "gws"
    ;;
  linux-arm64)
    echo "Fetching gws ${VERSION} for Linux ARM64..."
    download_binary "gws-aarch64-unknown-linux-gnu.tar.gz" "gws"
    ;;
  linux-x64)
    echo "Fetching gws ${VERSION} for Linux x64..."
    download_binary "gws-x86_64-unknown-linux-gnu.tar.gz" "gws"
    ;;
  windows-x64)
    echo "Fetching gws ${VERSION} for Windows x64..."
    download_binary "gws-x86_64-pc-windows-msvc.zip" "gws.exe"
    ;;
  all)
    # Build all platform bundles — creates one mcpb per platform
    for plat in darwin-arm64 darwin-x64 linux-arm64 linux-x64 windows-x64; do
      echo ""
      echo "=== ${plat} ==="
      rm -rf "${OUT_DIR}"
      "$0" "$plat" "$VERSION"
    done
    echo ""
    echo "All platforms downloaded."
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    echo "Valid: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64, all"
    exit 1
    ;;
esac
