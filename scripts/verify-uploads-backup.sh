#!/usr/bin/env bash
# Verify a ChatAI uploads backup archive (testable after every backup).
#
# Usage:
#   ./scripts/verify-uploads-backup.sh backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz
set -euo pipefail

archive="${1:?Usage: ./scripts/verify-uploads-backup.sh <path-to-backup.tgz>}"

if [[ ! -f "$archive" ]]; then
  echo "[verify] Archive not found: $archive" >&2
  exit 1
fi

checksum_file="${archive}.sha256"
if [[ ! -f "$checksum_file" ]]; then
  echo "[verify] Missing checksum file: $checksum_file" >&2
  exit 1
fi

echo "[verify] Checking SHA256…"
(
  cd "$(dirname "$archive")"
  sha256sum -c "$(basename "$checksum_file")"
)

echo "[verify] Listing tarball contents…"
tar tzf "$archive" >/dev/null

file_count="$(tar tzf "$archive" | wc -l | tr -d ' ')"
byte_size="$(wc -c <"$archive" | tr -d ' ')"

echo "[verify] Dry-run extract to temp directory…"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

tar xzf "$archive" -C "$tmpdir"
extracted_count="$(find "$tmpdir" -type f 2>/dev/null | wc -l | tr -d ' ')"

echo "[verify] OK"
echo "[verify] Archive entries: ${file_count}"
echo "[verify] Extracted files: ${extracted_count}"
echo "[verify] Archive size (bytes): ${byte_size}"
