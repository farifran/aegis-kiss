#!/usr/bin/env bash
set -euo pipefail
SVG="assets/header-2.transparent.svg"
OUT1="assets/header-2.png"
OUT2="assets/header-2@2x.png"

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 560 -h 180 -o "$OUT1" "$SVG"
  rsvg-convert -w 1120 -h 360 -o "$OUT2" "$SVG"
  echo "Gerado: $OUT1 e $OUT2 usando rsvg-convert"
elif command -v convert >/dev/null 2>&1; then
  convert -background none -density 144 -resize 560x "$SVG" "$OUT1"
  convert -background none -density 288 -resize 1120x "$SVG" "$OUT2"
  echo "Gerado: $OUT1 e $OUT2 usando ImageMagick convert"
else
  echo "Nenhuma ferramenta de conversão SVG->PNG encontrada. Instale 'librsvg2-bin' ou 'imagemagick' e rode scripts/export-header-svg.sh novamente." >&2
  exit 1
fi
