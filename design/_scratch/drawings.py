import json
from collections import Counter

with open('parsed.json','r',encoding='utf-8') as f:
    d = json.load(f)
p = d['pages'][0]

# Convert (r,g,b) float 0-1 tuples to hex
def to_hex(c):
    if not c: return None
    if isinstance(c, list) and len(c) >= 3:
        r, g, b = c[0], c[1], c[2]
        return "#{:02x}{:02x}{:02x}".format(int(r*255), int(g*255), int(b*255))
    return str(c)

fills = Counter()
strokes = Counter()
for dr in p['drawings']:
    fills[to_hex(dr.get('fill'))] += 1
    strokes[to_hex(dr.get('stroke'))] += 1
print('FILLS:')
for k, v in fills.most_common(): print(' ', k, v)
print('STROKES:')
for k, v in strokes.most_common(): print(' ', k, v)

# Drawings on desktop column
print()
print('Desktop drawings (x<1000), y order:')
draws = [dr for dr in p['drawings'] if dr.get('rect') and dr['rect'][0] < 1000]
draws.sort(key=lambda dr: (dr['rect'][1], dr['rect'][0]))
for dr in draws[:80]:
    r = dr['rect']
    fill = to_hex(dr.get('fill'))
    stroke = to_hex(dr.get('stroke'))
    w = r[2]-r[0]; h = r[3]-r[1]
    print(f"  x={r[0]:6.0f} y={r[1]:6.0f} w={w:6.0f} h={h:6.0f} fill={fill} stroke={stroke} type={dr.get('type')}")
