#!/usr/bin/env bash
# Regera o manual do ERP em PDF a partir do guia em Markdown.
#
# O servidor não tem pandoc nem wkhtmltopdf: o caminho é HTML autossuficiente +
# google-chrome headless. O CSS vive dentro do manualPdf.py.
#
# Uso: bash scripts/gerar-manual-pdf.sh [destino.pdf]
set -euo pipefail

GUIA="$(dirname "$0")/../../docs/erp-academico/GUIA_TREINAMENTO.md"
SAIDA="${1:-/tmp/manual-erp-academico.pdf}"
TMP_HTML="$(mktemp --suffix=.html)"

python3 "$(dirname "$0")/manualPdf.py" "$GUIA" > "$TMP_HTML"
google-chrome --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="$SAIDA" "$TMP_HTML" 2>&1 | grep -i "written" || true
rm -f "$TMP_HTML"
echo "PDF: $SAIDA"
