#!/bin/sh
# Copy only what the page loads at runtime into a site folder (default _site/).
# Used by the Pages workflow; run it locally to check the shipped files.
#   sh tools/build-site.sh [out-dir]
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT"
mkdir -p "$OUT"
cp index.html "$OUT/"
cp -R css js art "$OUT/"
test -f "$OUT/index.html"
test -f "$OUT/art/title.jpg"
echo "site in $OUT: $(find "$OUT" -type f | wc -l) files"
