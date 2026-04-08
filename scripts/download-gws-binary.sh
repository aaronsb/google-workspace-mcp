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

  local tmpdir
  tmpdir=$(mktemp -d)

  if [[ "$artifact" == *.zip ]]; then
    local tmpzip
    tmpzip=$(mktemp)
    curl -sL "$url" -o "$tmpzip"
    unzip -qo "$tmpzip" -d "$tmpdir"
    rm -f "$tmpzip"
  else
    curl -sL "$url" | tar xz -C "$tmpdir"
  fi

  # Find the actual binary (may be in a subdirectory) and move to OUT_DIR
  local found
  found=$(find "$tmpdir" -name "$binary_name" -type f | head -1)
  if [[ -z "$found" ]]; then
    echo "  ERROR: binary '$binary_name' not found in archive" >&2
    rm -rf "$tmpdir"
    return 1
  fi

  mv "$found" "${OUT_DIR}/${binary_name}"
  chmod +x "${OUT_DIR}/${binary_name}"
  rm -rf "$tmpdir"
  echo "  Installed: ${OUT_DIR}/${binary_name}"
}

case "$PLATFORM" in
  darwin-arm64)
    echo "Fetching gws ${VERSION} for macOS ARM64..."
    download_binary "google-workspace-cli-aarch64-apple-darwin.tar.gz" "gws"
    ;;
  darwin-x64)
    echo "Fetching gws ${VERSION} for macOS x64..."
    download_binary "google-workspace-cli-x86_64-apple-darwin.tar.gz" "gws"
    ;;
  linux-arm64)
    echo "Fetching gws ${VERSION} for Linux ARM64..."
    download_binary "google-workspace-cli-aarch64-unknown-linux-gnu.tar.gz" "gws"
    ;;
  linux-x64)
    echo "Fetching gws ${VERSION} for Linux x64..."
    download_binary "google-workspace-cli-x86_64-unknown-linux-gnu.tar.gz" "gws"
    ;;
  windows-x64)
    echo "Fetching gws ${VERSION} for Windows x64..."
    download_binary "google-workspace-cli-x86_64-pc-windows-msvc.zip" "gws.exe"
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
