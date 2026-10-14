"""Render the original vector-style brand assets; requires Pillow for this design step only."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4

def icon(size):
    canvas = Image.new('RGBA', (128 * SCALE, 128 * SCALE))
    draw = ImageDraw.Draw(canvas)
    def rect(box, radius, fill=None, outline=None, width=1):
        draw.rounded_rectangle(tuple(int(v * SCALE) for v in box), radius * SCALE, fill=fill, outline=outline, width=width * SCALE)
    def line(points, color, width):
        p = [(int(x * SCALE), int(y * SCALE)) for x, y in points]
        draw.line(p, fill=color, width=width * SCALE, joint='curve')
        r = width * SCALE / 2
        for x, y in p:
            draw.ellipse((x-r, y-r, x+r, y+r), fill=color)
    rect((16, 16, 112, 112), 24, fill='#123b45')
    rect((31, 33, 97, 95), 9, outline='#d6f8ec', width=4)
    line([(32, 47), (96, 47)], '#d6f8ec', 3)
    for x in (40, 46, 52):
        draw.ellipse(((x-1)*SCALE, 39*SCALE, (x+1)*SCALE, 41*SCALE), fill='#d6f8ec')
    line([(44, 62), (81, 62), (73, 54)], '#ffffff', 4)
    line([(81, 62), (73, 70)], '#ffffff', 4)
    line([(84, 80), (47, 80), (55, 72)], '#5be4bc', 4)
    line([(47, 80), (55, 88)], '#5be4bc', 4)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)

(ROOT / 'icons').mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    icon(size).save(ROOT / 'icons' / f'icon-{size}.png')

# Promotional artwork, not a product screenshot: saturated full-bleed brand graphic.
width, height = 440, 280
promo = Image.new('RGB', (width * SCALE, height * SCALE))
pixels = promo.load()
for y in range(height * SCALE):
    for x in range(width * SCALE):
        t = (x / (width * SCALE) + y / (height * SCALE)) / 2
        pixels[x, y] = (int(9 + 10*t), int(35 + 48*t), int(62 + 12*t))
draw = ImageDraw.Draw(promo)
for box in ((-110, -100, 150, 160), (290, 120, 570, 400)):
    draw.ellipse(tuple(v * SCALE for v in box), outline='#277e83', width=3*SCALE)
brand = icon(240 * SCALE)
promo.paste(brand, (100 * SCALE, 20 * SCALE), brand)
(ROOT / 'store').mkdir(exist_ok=True)
promo.resize((width, height), Image.Resampling.LANCZOS).save(ROOT / 'store' / 'promo-small-440x280.png')
print('Rendered four extension icons and the 440x280 promotional artwork.')
