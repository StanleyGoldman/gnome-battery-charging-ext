#!/usr/bin/env bash
# PROTOTYPE for issue #11: screenshot each #5 text variant headlessly, then
# crop the Quick Settings panel from each into one side-by-side image.
#   ./variants.sh [OUT_DIR]      (default: ./smoke-out/variants)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "${1:-$here/smoke-out/variants}")

run() {  # name title colspan
    echo "== $1"
    BATTERY_CHARGING_PROTO_TITLE=$2 BATTERY_CHARGING_PROTO_COLSPAN=$3 \
        "$here/smoke-test.sh" "$out/$1" | grep -E 'SMOKE (start|after|FAILED)' | sed 's/.*SMOKE/  /'
}
run A-two-columns 'Battery Charging' 2
run B-short-title 'Charging' 1
run C-truncate 'Battery Charging' 1

python3 - "$out" <<'PY'
import sys
import gi
gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf
out = sys.argv[1]
variants = ['A-two-columns', 'B-short-title', 'C-truncate']
shots = ['1-maximize-charge', '2-preserve-battery-health']
x, y, w, h = 872, 0, 408, 340          # the Quick Settings panel at 1280x720
gap, label_h = 12, 0
sheet = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8,
                             len(variants) * (w + gap), len(shots) * (h + gap))
sheet.fill(0xffffffff)
for col, v in enumerate(variants):
    for row, s in enumerate(shots):
        src = GdkPixbuf.Pixbuf.new_from_file(f'{out}/{v}/{s}.png')
        src.copy_area(x, y, w, h, sheet, col * (w + gap), row * (h + gap))
sheet.savev(f'{out}/comparison.png', 'png', [], [])
print(f'{out}/comparison.png  (columns: {", ".join(variants)}; rows: {", ".join(shots)})')
PY
