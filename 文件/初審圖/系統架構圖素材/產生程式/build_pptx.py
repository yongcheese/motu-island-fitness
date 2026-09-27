import re, json
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

# Google 簡報預設 16:9（10 × 5.625 英吋）；原圖 1900×1000 等比縮放，上方補 OFFSET 讓比例吻合
SLIDE_W, SLIDE_H = 9144000, 5143500
W, H = 1900, 1000
PX = SLIDE_W / W               # 每個原圖 px 對應的 EMU
OFFSET = (SLIDE_H / PX - H)    # 原圖座標系中，上方要補的高度（px）
PT = PX / 12700                 # 每個原圖 px 對應的 pt
svg = open('figma_layers.svg', encoding='utf-8').read()
order = re.findall(r'<(?:g|svg) id="([^"]+)"', svg)
order = [i for i in order if i != 'labels']
labels = json.load(open('elements4/_labels.json', encoding='utf-8'))

prs = Presentation()
prs.slide_width, prs.slide_height = Emu(SLIDE_W), Emu(SLIDE_H)
slide = prs.slides.add_slide(prs.slide_layouts[6])
bg = slide.background.fill; bg.solid(); bg.fore_color.rgb = RGBColor(0xFF, 0xFC, 0xF4)

def bbox(el):
    s = open(f'elements4/{el}.svg', encoding='utf-8').read()
    if el == 'user-coach-aji':
        return (-4, 368, 250, 258)
    x, y, w, h = map(float, re.search(r'viewBox="([^"]+)"', s).group(1).split())
    return x, y, w, h

for el in order:
    x, y, w, h = bbox(el)
    pic = slide.shapes.add_picture(f'png/{el}.png', Emu(int(x * PX)), Emu(int((y + OFFSET) * PX)), Emu(int(w * PX)), Emu(int(h * PX)))
    pic.name = el

for t in labels:
    size = t['size']; s = t['s']
    wpx = max(60, int(sum(size * 1.15 if ord(c) > 255 else size * 0.7 for c in s) * 1.3 + 40))
    hpx = int(size * 1.6)
    left = t['x'] if t['anchor'] == 'start' else t['x'] - wpx / 2
    if left + wpx > W: wpx = int(W - left)
    top = t['y'] - size * 1.1 + OFFSET
    tb = slide.shapes.add_textbox(Emu(int(left * PX)), Emu(int(top * PX)), Emu(int(wpx * PX)), Emu(int(hpx * PX)))
    tb.name = t['id']
    tf = tb.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.TOP
    tf.auto_size = None
    p0 = tf.paragraphs[0]; p0.line_spacing = 1.0
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT if t['anchor'] == 'start' else PP_ALIGN.CENTER
    r = p.add_run(); r.text = s
    r.font.size = Pt(round(size * PT, 1))
    r.font.name = 'Huninn'
    c = t['color'].lstrip('#'); r.font.color.rgb = RGBColor.from_string(c.upper())

prs.save('系統架構圖_Google簡報.pptx')
print('ok', len(order), 'images', len(labels), 'text boxes')
