#!/usr/bin/env python3
"""PROTOTYPE for issue #11: crop the Quick Settings panel (and the top bar)
from each scenarios.sh screenshot into one labelled contact sheet.
    python3 scenario-sheet.py [DIR]     (default: smoke-out/scenarios)"""
import glob
import os
import sys

from PIL import Image, ImageDraw

d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'smoke-out/scenarios')
shots = sorted(glob.glob(f'{d}/s*.png'))
box = (872, 0, 1280, 340)                  # Quick Settings panel at 1280x720
w, h, label_h, cols, gap = box[2] - box[0], box[3] - box[1], 22, 4, 10
rows = -(-len(shots) // cols)
sheet = Image.new('RGB', (cols * (w + gap), rows * (h + label_h + gap)), 'white')
draw = ImageDraw.Draw(sheet)
for i, path in enumerate(shots):
    x, y = (i % cols) * (w + gap), (i // cols) * (h + label_h + gap)
    draw.text((x + 4, y + 4), os.path.basename(path)[:-4], fill='black')
    sheet.paste(Image.open(path).crop(box), (x, y + label_h))
sheet.save(f'{d}/sheet.png')
print(f'{d}/sheet.png')
