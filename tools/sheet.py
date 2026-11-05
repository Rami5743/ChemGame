"""The printed sheet about the cards, opened up far enough to correct it.

The sheet was supplied as a PDF made by Word, and it is kept as it was: the
page, the pictures and the setting are the printed ones. What this module adds
is the ability to reach the text inside it — to recolour a word, to put a link
over it, and to correct a spelling — without resetting the page.

Word writes every run of text as its own `BT ... Tm ... TJ ET` block with an
absolute position, which is what makes this possible: a run can be split in
three, or rewritten, and only that run moves. A line that grew or shrank is
justified again by taking the difference out of the gaps between its words.

    from sheet import Sheet
    sheet = Sheet('facts.pdf')
    for line in sheet.lines:
        ...
    sheet.save('out.pdf')
"""

import re

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, NameObject, NumberObject

# The colour a link is given, the one the pages of the game use.
LINK_RGB = (0.122, 0.306, 0.475)

WINANSI = {i: bytes([i]).decode('cp1252', 'replace') for i in range(32, 256)}
SHOW = re.compile(r'(\[(?:[^\[\]]*)\]\s*TJ|<[0-9A-Fa-f]*>\s*Tj)', re.S)
HEXES = re.compile(r'<([0-9A-Fa-f]*)>')
TM = re.compile(r'([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm')
TF = re.compile(r'(/\w+)\s+([\d.]+)\s+Tf')
FILL = re.compile(r'(?<![\d.])(0|1|[01]\.\d+)\s+g\b')


def _cmap(font):
    """CID -> text, from a font's ToUnicode map."""
    obj = font.get('/ToUnicode')
    if obj is None:
        return None
    data = obj.get_object().get_data().decode('latin1')
    out = {}
    for block in re.findall(r'beginbfchar(.*?)endbfchar', data, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            out[int(src, 16)] = bytes.fromhex(dst).decode('utf-16-be')
    for block in re.findall(r'beginbfrange(.*?)endbfrange', data, re.S):
        for lo, hi, dst in re.findall(
                r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            first = int(dst, 16)
            for i, cid in enumerate(range(int(lo, 16), int(hi, 16) + 1)):
                out[cid] = chr(first + i)
    return out


def _widths(font):
    """CID -> width in thousandths, and the width of everything else."""
    if font.get('/Subtype') != '/Type0':
        first = int(font.get('/FirstChar', 0))
        table = {}
        for i, w in enumerate(font.get('/Widths', []) or []):
            table[first + i] = float(w)
        return table, 500.0
    kid = font['/DescendantFonts'][0].get_object()
    array = kid.get('/W')
    array = array.get_object() if hasattr(array, 'get_object') else (array or [])
    table, i = {}, 0
    while i < len(array):
        start = int(array[i].get_object() if hasattr(array[i], 'get_object') else array[i])
        nxt = array[i + 1].get_object() if hasattr(array[i + 1], 'get_object') else array[i + 1]
        if isinstance(nxt, (list, ArrayObject)):
            for j, w in enumerate(nxt):
                table[start + j] = float(w)
            i += 2
        else:
            end = int(nxt)
            w = float(array[i + 2])
            for cid in range(start, end + 1):
                table[cid] = w
            i += 3
    return table, float(kid.get('/DW', 1000))


class Font:
    def __init__(self, name, obj):
        self.name = name
        self.wide = obj.get('/Subtype') == '/Type0'
        cmap = _cmap(obj)
        self.to_text = cmap if cmap is not None else dict(WINANSI)
        self.of_text = {}
        for cid, text in self.to_text.items():
            self.of_text.setdefault(text, cid)
        self.width_of, self.default_width = _widths(obj)

    def width(self, cid):
        return self.width_of.get(cid, self.default_width)

    def hex(self, cid):
        return '%04X' % cid if self.wide else '%02X' % cid

    def cids(self, text):
        """The glyphs for a piece of text, or None if the font lacks one."""
        out = []
        for ch in text:
            cid = self.of_text.get(ch)
            if cid is None:
                return None
            out.append(cid)
        return out


class Run:
    """One `BT ... ET` block: a piece of text at a place on the page."""

    def __init__(self, page, index, body, font, size, x, y, items, head, tail):
        self.page, self.index = page, index
        self.body = body          # the block as it was
        self.font, self.size = font, size
        self.x, self.y = x, y
        self.items = items        # [(adjustment before the glyph, cid)]
        self.head, self.tail = head, tail
        self.pieces = None        # colours, once the run has any
        self.dirty = False        # whether the block has to be written again

    @property
    def text(self):
        """The glyphs as they stand on the page, from left to right."""
        return ''.join(self.font.to_text.get(cid, '�') for _, cid in self.items)

    @property
    def reading(self):
        """The same, in the order it is read. One glyph can spell more than
        one letter, so the glyphs are turned around, not the letters."""
        return ''.join(self.font.to_text.get(cid, '�')
                       for _, cid in reversed(self.items))

    @property
    def spelled(self):
        """How many letters each glyph spells, in reading order."""
        return [len(self.font.to_text.get(cid, '�'))
                for _, cid in reversed(self.items)]

    def advance(self, upto):
        """How far into the run the glyph at this index sits."""
        x = 0.0
        for i, (adj, cid) in enumerate(self.items):
            if i >= upto:
                break
            x += (self.font.width(cid) - adj) * self.size / 1000.0
        return x

    @property
    def width(self):
        return self.advance(len(self.items))

    def at(self, index):
        """The x of a glyph, counting the kerning that comes before it."""
        return self.x + self.advance(index) + \
            (-self.items[index][0] * self.size / 1000.0 if index < len(self.items) else 0)


class Line:
    """The runs that share a baseline, in reading order (right to left)."""

    def __init__(self, page, y, runs):
        self.page, self.y = page, y
        self.runs = runs                      # reading order
        self.visual = sorted(runs, key=lambda r: r.x)

    @property
    def text(self):
        return ''.join(r.reading for r in self.runs)

    def locate(self, start, end):
        """Which runs, and which glyphs of them, a span of the text covers."""
        out, seen = [], 0
        for run in self.runs:
            edges = [0]
            for n in run.spelled:
                edges.append(edges[-1] + n)
            total = edges[-1]
            lo, hi = max(start, seen) - seen, min(end, seen + total) - seen
            if lo < hi:
                first = next(i for i, e in enumerate(edges) if e >= lo)
                last = next(i for i, e in enumerate(edges) if e >= hi)
                # A run reads backwards, so a span of the reading order is a
                # span of the glyphs counted from the other end.
                count = len(run.items)
                out.append((run, count - last, count - first))
            seen += total
        return out


class Sheet:
    def __init__(self, path):
        self.reader = PdfReader(path)
        self.writer = PdfWriter(clone_from=path)
        self.pages = []
        self.runs = []
        self.lines = []
        for number, page in enumerate(self.writer.pages):
            fonts = {n: Font(n, ref.get_object())
                     for n, ref in page['/Resources']['/Font'].items()}
            data = page.get_contents().get_data().decode('latin1')
            blocks = list(re.finditer(r'BT(.*?)ET', data, re.S))
            self.pages.append({'page': page, 'data': data, 'blocks': blocks, 'runs': {}})
            for index, block in enumerate(blocks):
                run = self._run(number, index, block.group(1), fonts)
                if run:
                    self.pages[number]['runs'][index] = run
                    self.runs.append(run)
            self._group(number)

    def _run(self, page, index, body, fonts):
        tf, tm = TF.search(body), TM.search(body)
        shows = SHOW.findall(body)
        if not tf or not tm or len(shows) != 1:
            return None
        font = fonts.get(tf.group(1))
        if font is None:
            return None
        show = shows[0]
        head, tail = body.split(show, 1)
        step = 4 if font.wide else 2
        items, pending = [], 0.0
        for token in re.finditer(r'<([0-9A-Fa-f]*)>|([-\d.]+)', show):
            if token.group(2) is not None:
                pending += float(token.group(2))
                continue
            hexs = token.group(1)
            for i in range(0, len(hexs), step):
                items.append((pending, int(hexs[i:i + step], 16)))
                pending = 0.0
        if not items:
            return None
        return Run(page, index, body, font, float(tf.group(2)),
                   float(tm.group(5)), float(tm.group(6)), items, head, tail)

    def _group(self, page):
        rows = {}
        for run in self.pages[page]['runs'].values():
            rows.setdefault(round(run.y, 1), []).append(run)
        for y in sorted(rows, reverse=True):
            runs = sorted(rows[y], key=lambda r: -r.x)
            self.lines.append(Line(page, y, runs))

    # ---------------------------------------------------------------- editing

    def colour(self, run, start, end, rgb=LINK_RGB):
        """Give the glyphs [start, end) of a run a colour of their own."""
        run.pieces = run.pieces or [(0, len(run.items), None)]
        out = []
        for lo, hi, colour in run.pieces:
            for a, b, c in ((lo, min(hi, start), colour),
                            (max(lo, start), min(hi, end), rgb),
                            (max(lo, end), hi, colour)):
                if a < b:
                    out.append((a, b, c))
        run.pieces = out
        run.dirty = True

    def merge(self, line, runs):
        """Several runs of a line become one, keeping the spaces between them.

        The space a line was justified with sits between the runs, so it is
        kept as a kerning before the first glyph of each run that follows.
        """
        order = sorted(runs, key=lambda r: r.x)
        first = order[0]
        if any(r.font is not first.font or r.size != first.size for r in order):
            raise ValueError('the words are set in more than one font')
        items = list(first.items)
        edge = first.x + first.width
        for run in order[1:]:
            head = list(run.items)
            head[0] = (head[0][0] - (run.x - edge) * 1000.0 / first.size, head[0][1])
            items += head
            edge = run.x + run.width
            run.items = []
            run.pieces = None
            run.dirty = True
        first.items = items
        first.pieces = None
        first.dirty = True
        line.runs = [r for r in line.runs if r.items]
        line.visual = sorted(line.runs, key=lambda r: r.x)

    def replace(self, line, start, end, text):
        """Put other words in place of a span of a line, and justify it again."""
        where = line.locate(start, end)
        if len(where) != 1:
            self.merge(line, [run for run, _, _ in where])
            where = line.locate(start, end)
        if len(where) != 1:
            raise ValueError('a correction must sit inside one run: %r' % line.text[start:end])
        run, lo, hi = where[0]
        cids = run.font.cids(text[::-1])
        if cids is None:
            raise ValueError('the font of this run has no glyph for %r' % text)
        before = run.width
        head = run.items[:lo]
        tail = run.items[hi:]
        run.items = head + [(0.0, cid) for cid in cids] + \
            ([(tail[0][0], tail[0][1])] + tail[1:] if tail else [])
        run.pieces = None
        run.dirty = True
        # A Hebrew run is read from its right edge, so that edge is what stays
        # put when the run grows or shrinks.
        delta = run.width - before
        run.x -= delta
        self._justify(line, run, delta)

    def _justify(self, line, changed, delta):
        """Take the width a correction added out of the gaps between words.

        A Hebrew line begins at its right edge, which stays where it was, so
        only what lies to the left of the correction moves. The difference is
        shared out between the gaps in proportion to how wide they are, and no
        gap gives up more than most of itself, so words never run into one
        another; whatever is left over moves the rest of the line.
        """
        if abs(delta) < 0.01:
            return
        order = line.visual
        at = order.index(changed)
        gaps = []
        for i in range(at):
            gap = order[i + 1].x - (order[i].x + order[i].width)
            if gap > 0.3:
                gaps.append([i, gap])
        slack = sum(g for _, g in gaps)
        taken = min(delta, slack * 0.75) if delta > 0 and slack > 0 else 0.0
        if delta < 0:
            taken = delta  # a line that grew shorter only opens its gaps
        shift = -delta
        share = {i: taken * g / slack for i, g in gaps} if slack else {}
        for i in range(at - 1, -1, -1):
            order[i].x += shift
            order[i].dirty = True
            if i in share:
                shift += share[i]
        for run in order:
            run.x = round(run.x, 3)

    # ----------------------------------------------------------------- output

    def rect(self, run, start, end):
        """The box around glyphs [start, end) of a run, in page coordinates."""
        x0 = run.at(start) if start < len(run.items) else run.x + run.width
        x1 = run.at(end) if end < len(run.items) else run.x + run.width
        return (min(x0, x1) - 1, run.y - 0.24 * run.size,
                max(x0, x1) + 1, run.y + 0.84 * run.size)

    def _rewrite(self, run):
        """The block, or blocks, this run has become."""
        pieces = run.pieces or [(0, len(run.items), None)]
        out = []
        for lo, hi, rgb in pieces:
            if lo >= hi:
                continue
            items = run.items[lo:hi]
            x = run.at(lo)
            body = run.head
            body = TM.sub(lambda m: '1 0 0 1 %s %s Tm' % (_num(x), _num(run.y)), body, count=1)
            if rgb is not None:
                paint = '%s %s %s rg' % tuple(_num(c) for c in rgb)
                body, hits = FILL.subn(paint, body, count=1)
                if not hits:
                    body += '\n' + paint + '\n'
            show = '[' + ''.join(
                ('%s' % _num(adj) if i and adj else '') + '<%s>' % run.font.hex(cid)
                for i, (adj, cid) in enumerate(items)) + '] TJ'
            out.append('BT' + body + show + run.tail + 'ET')
        return '\n'.join(out)

    def save(self, path, annotations=()):
        for number, info in enumerate(self.pages):
            data, cut, out = info['data'], 0, []
            for index, block in enumerate(info['blocks']):
                run = info['runs'].get(index)
                if run is None or not run.dirty:
                    continue
                out.append(data[cut:block.start()])
                out.append(self._rewrite(run))
                cut = block.end()
            out.append(data[cut:])
            stream = DecodedStreamObject()
            stream.set_data(''.join(out).encode('latin1'))
            info['page'][NameObject('/Contents')] = self.writer._add_object(stream)
        for page, rect, url in annotations:
            _link(self.writer, page, rect, url)
        with open(path, 'wb') as fh:
            self.writer.write(fh)


def _num(value):
    text = ('%.4f' % value).rstrip('0').rstrip('.')
    return text if text not in ('', '-0') else '0'


def _link(writer, page, rect, url):
    from pypdf.annotations import Link
    link = Link(rect=rect, url=url)
    link[NameObject('/Border')] = ArrayObject(
        [NumberObject(0), NumberObject(0), NumberObject(0)])
    writer.add_annotation(page_number=page, annotation=link)
