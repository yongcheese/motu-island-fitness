#!/usr/bin/env python3
"""正式版 Markdown → Word：黑白、無 emoji、公文式排版。

與同目錄另兩支的差異：
  build_docx.py   企劃書專用（封面／目錄／mermaid 圖，藍色主題）
  build_simple.py 簡易閱讀版（藍色標題）
  build_formal.py 本支——**全黑白**，供正式送件或對外交付

用法：
    python3 build_formal.py <來源.md> [輸出.docx]
"""
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

CN = '標楷體'            # 中文：正式文件慣用
CN_BODY = '新細明體'      # 內文中文
EN = 'Times New Roman'   # 西文
MONO = 'Consolas'        # 等寬（程式碼與示意圖）
BLACK = RGBColor(0, 0, 0)
GREY = RGBColor(0x44, 0x44, 0x44)

# emoji 一律轉為文字標記——正式文件不使用彩色圖示，但語意必須保留
EMOJI_MAP = {
    '✅': '【已完成】', '🔷': '【規劃中】', '⬜': '【待確認】', '🎯': '【目標】',
    '⚠️': '※ ', '⚠': '※ ', '🔴': '【高】', '🟡': '【中】', '🟢': '【低】',
    '★': '', '⭐': '', '📌': '', '🏝️': '', '🏋️': '', '☀️': '', '📊': '', '⚙️': '',
    '🪙': '', '🔥': '', '💪': '', '⏱️': '', '🎉': '', '🛒': '', '✏️': '', '🧭': '',
    '👍': '', '🏟️': '', '🌬️': '', '🗼': '', '🗿': '', '⛲': '', '⚓': '', '🌺': '',
    '🛖': '', '🏮': '', '🌳': '', '🌷': '', '🟫': '', '🔍': '', '●': '●', '○': '○',
}


def strip_emoji(text):
    for k, v in EMOJI_MAP.items():
        text = text.replace(k, v)
    # 掃掉殘留的 emoji 區段（保留 ● ○ 等幾何符號與製表字元）
    text = re.sub(r'[\U0001F000-\U0001FAFF\U00002600-\U000027BF️]', '', text)
    return re.sub(r'  +', ' ', text).strip()


def set_font(run, cn=CN_BODY, en=EN):
    run.font.name = en
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn('w:rFonts'))
    if rf is None:
        rf = rpr.makeelement(qn('w:rFonts'), {})
        rpr.append(rf)
    rf.set(qn('w:ascii'), en)
    rf.set(qn('w:hAnsi'), en)
    rf.set(qn('w:eastAsia'), cn)


def add_inline(para, text, size=Pt(12), bold=False, cn=CN_BODY, color=BLACK):
    """處理 **粗體** 與 `行內程式碼`。正式版不用色彩區分，改用粗體與等寬字。"""
    text = strip_emoji(text)
    for part in re.split(r'(\*\*.+?\*\*|`[^`]+`)', text):
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            run = para.add_run(part[2:-2]); run.bold = True; set_font(run, cn)
        elif part.startswith('`') and part.endswith('`'):
            run = para.add_run(part[1:-1]); set_font(run, MONO, MONO)
        else:
            run = para.add_run(part); run.bold = bold; set_font(run, cn)
        run.font.size = size
        run.font.color.rgb = color


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    el = tcPr.makeelement(qn('w:shd'), {qn('w:val'): 'clear', qn('w:fill'): hexcolor})
    tcPr.append(el)


def table_borders(table):
    tbl = table._tbl
    pr = tbl.tblPr
    borders = pr.makeelement(qn('w:tblBorders'), {})
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = borders.makeelement(qn(f'w:{edge}'), {
            qn('w:val'): 'single', qn('w:sz'): '4', qn('w:color'): '000000'})
        borders.append(e)
    pr.append(borders)


def setup(doc):
    sec = doc.sections[0]
    sec.top_margin = sec.bottom_margin = Cm(2.54)
    sec.left_margin = sec.right_margin = Cm(2.54)
    st = doc.styles['Normal']
    st.font.size = Pt(12)                      # 官方規定 12 級字
    st.paragraph_format.line_spacing = 1.5
    st.paragraph_format.space_after = Pt(6)


def heading(doc, level, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(6 if level == 1 else 14)
    pf.space_after = Pt(8 if level == 1 else 6)
    pf.keep_with_next = True
    sizes = {1: Pt(18), 2: Pt(15), 3: Pt(13), 4: Pt(12)}
    add_inline(p, text, size=sizes.get(level, Pt(12)), bold=True, cn=CN)
    if level <= 2:                              # 章節標題加一條黑色下框線
        ppr = p._p.get_or_add_pPr()
        pbdr = ppr.makeelement(qn('w:pBdr'), {})
        bottom = pbdr.makeelement(qn('w:bottom'), {
            qn('w:val'): 'single', qn('w:sz'): '8' if level == 1 else '4',
            qn('w:space'): '2', qn('w:color'): '000000'})
        pbdr.append(bottom)
        ppr.append(pbdr)


def code_block(doc, lines):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.4)
    pf.space_before = pf.space_after = Pt(6)
    pf.line_spacing = 1.0
    for i, ln in enumerate(lines):
        # 示意圖中的裝飾性 emoji 一併去除；製表符號與 ●○ 保留（見 EMOJI_MAP）
        run = p.add_run(strip_emoji(ln) if re.search(r'[\U0001F300-\U0001FAFF]', ln) else ln)
        set_font(run, MONO, MONO)
        run.font.size = Pt(8.5)                 # 示意圖較寬，縮小以免折行
        run.font.color.rgb = BLACK
        if i < len(lines) - 1:
            run.add_break()


def make_table(doc, rows):
    header, body = rows[0], rows[2:]
    t = doc.add_table(rows=1, cols=len(header))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_borders(t)
    for cell, txt in zip(t.rows[0].cells, header):
        cell.text = ''
        shade(cell, 'D9D9D9')                   # 表頭淺灰，不用彩色
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        add_inline(p, txt, size=Pt(11), bold=True, cn=CN)
    for r in body:
        cells = t.add_row().cells
        for cell, txt in zip(cells, r):
            cell.text = ''
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, txt.replace('<br>', ' '), size=Pt(11))
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def convert(src: Path, out: Path):
    doc = Document()
    setup(doc)
    lines = src.read_text(encoding='utf-8').split('\n')
    i = 0
    while i < len(lines):
        ln = lines[i]
        st = ln.strip()

        if st.startswith('```'):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i]); i += 1
            code_block(doc, buf); i += 1
            continue

        if st.startswith('|'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                buf.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            if len(buf) >= 2:
                make_table(doc, buf)
            continue

        m = re.match(r'^(#{1,4})\s+(.*)', st)
        if m:
            heading(doc, len(m.group(1)), m.group(2)); i += 1; continue

        if st in ('---', '***', '___'):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            i += 1; continue

        if st.startswith('>'):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.75)
            p.paragraph_format.space_after = Pt(4)
            add_inline(p, st.lstrip('> ').strip(), size=Pt(11), color=GREY)
            i += 1; continue

        m = re.match(r'^([-*]|\d+\.)\s+(.*)', st)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.75)
            p.paragraph_format.space_after = Pt(3)
            bullet = '· ' if m.group(1) in '-*' else m.group(1) + ' '
            add_inline(p, bullet + m.group(2))
            i += 1; continue

        if not st:
            i += 1; continue

        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        add_inline(p, st)
        i += 1

    doc.save(out)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else src.with_suffix('.docx')
    convert(src, out)
    print(f'完成（正式黑白版）：{out}')
