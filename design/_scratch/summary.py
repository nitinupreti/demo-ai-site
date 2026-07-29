import json
from collections import Counter

with open('parsed.json','r',encoding='utf-8') as f:
    d = json.load(f)
p = d['pages'][0]
fonts = Counter(); colors = Counter(); sizes = Counter()
for t in p['text_runs']:
    fonts[t['font']] += 1
    colors[t['color']] += 1
    sizes[t['size']] += 1
print('FONTS:')
for k, v in fonts.most_common(): print(' ', k, v)
print('COLORS:')
for k, v in colors.most_common(): print(' ', k, v)
print('SIZES:')
for k, v in sizes.most_common(): print(' ', k, v)
print()
print('DESKTOP COLUMN RUNS (x<1000):')
runs = [t for t in p['text_runs'] if t['bbox'][0] < 1000]
runs.sort(key=lambda t: (t['bbox'][1], t['bbox'][0]))
for t in runs:
    print(f"  x={t['bbox'][0]:6.0f} y={t['bbox'][1]:6.0f} sz={t['size']:5.2f} c={t['color']} f={t['font']:35} :: {t['text']!r}")
