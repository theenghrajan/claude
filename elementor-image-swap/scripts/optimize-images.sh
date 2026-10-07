#!/usr/bin/env bash
# Resize + convert every JPG/PNG under <src>/<folder>/ to WebP in <dst>/<folder>/ (same folder structure).
# Never upscales. Usage: optimize-images.sh [src=images/source] [dst=images/output] [width=1600] [quality=80]
set -euo pipefail
SRC=${1:-images/source}; DST=${2:-images/output}; W=${3:-1600}; Q=${4:-80}

M=$(command -v magick || ls /c/Program\ Files/ImageMagick*/magick.exe 2>/dev/null | head -1 || true)
[ -n "$M" ] || { echo "ImageMagick not found. Install: winget install ImageMagick.ImageMagick"; exit 1; }

shopt -s nullglob nocaseglob
for d in "$SRC"/*/; do
  name=$(basename "$d")
  files=("$d"*.jpg "$d"*.jpeg "$d"*.png)
  [ ${#files[@]} -gt 0 ] || continue
  mkdir -p "$DST/$name"
  "$M" mogrify -path "$DST/$name" -resize "${W}x>" -quality "$Q" -format webp "${files[@]}"
  echo "$name: ${#files[@]} file(s)"
done
echo "Before: $(du -sh "$SRC" | cut -f1)  After: $(du -sh "$DST" | cut -f1)"
