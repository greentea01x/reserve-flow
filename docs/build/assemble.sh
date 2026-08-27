#!/bin/bash
# Deterministic: rebuild SPEC-v2.md from the section markdown files.
set -e
MD="$(dirname "$0")/md"
OUT="$(dirname "$0")/SPEC-v2.md"
: > "$OUT"
first=1
for f in "$MD"/00-*.md "$MD"/01-*.md "$MD"/02-*.md "$MD"/03-*.md "$MD"/04-*.md "$MD"/05-*.md "$MD"/06-*.md "$MD"/07-*.md "$MD"/08-*.md "$MD"/09-*.md "$MD"/10-*.md "$MD"/11-*.md "$MD"/12-*.md; do
  [ -f "$f" ] || continue
  if [ $first -eq 0 ]; then printf '\n\n---\n\n' >> "$OUT"; fi
  cat "$f" >> "$OUT"
  first=0
done
wc -c "$OUT"
