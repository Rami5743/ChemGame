#!/usr/bin/env python3
"""Corrects the spelling of the printed sheet, and links its terms.

The sheet is the file the game came with, and it stays that file: the setting,
the pictures and every measure of the page are the printed ones. What this
does is reach inside it — correct a spelling, colour a term and lay a link
over it — through tools/sheet.py, which rewrites only the runs it touches.

    python3 tools/link-facts-pdf.py
"""

import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))

from sheet import Sheet  # noqa: E402

SRC = ROOT / 'materials/facts/facts2_1.pdf'
OUT = ROOT / 'facts.pdf'
WIKI = 'https://he.wikipedia.org/wiki/'

# What the sheet says, and what it should say. Each piece on the left has to
# appear exactly as many times as the number beside it, and each occurrence
# has to sit inside one run of the file, which is what lets the correction be
# made without resetting the page.
FIXES = [
    # --- the atom cards ---
    ('המודל האטום המקובל', 'מודל האטום המקובל'),
    ('של בור כמוהו', 'של בוהר, וכמוהו'),
    ('קןונטית', 'קוונטית'),
    ('בתמונת מופיעות', 'בתמונה מופיעות'),
    ('שלוש צורת תלת מימדיות', 'שלוש צורות תלת-ממדיות'),
    ('ולמיספר', 'ולמספר'),
    ('קטנים מידי', 'קטנים מדי'),
    ('מכדי שהיה להם', 'מכדי שיהיה להם'),
    ('אלה גם במספר', 'אלא גם במספר'),
    ('רטרפורד', 'רתרפורד'),
    ('ממודל האטום של בור', 'ממודל האטום של בוהר'),
    ('אינו עיקבי. אם', 'אינו עקבי. עם'),
    ('למודל האטום של בור', 'למודל האטום של בוהר'),
    # --- the molecule cards ---
    ('גלם ליצור חומרים', 'גלם לייצור חומרים'),
    ('האדם.אומנם', 'האדם. אומנם'),
    ('לרוב תרכובת החנקן', 'לרוב תרכובות החנקן'),
    ('למדו ליצר אמוניה', 'למדו לייצר אמוניה'),
    ('ליכולת יצור דשנים', 'ליכולת ייצור דשנים'),
    ('תרכובת פחמן המכיל', 'תרכובת פחמן המכילה'),
    ('גלם ליצור תרכובות', 'גלם לייצור תרכובות'),
    ('יעיל ליצור אצטון', 'יעיל לייצור אצטון'),
    ('תהליך זה סיעה', 'תהליך זה סייע'),
    ('במלחמת האולם', 'במלחמת העולם'),
    ('והכנה לוויצמן', 'והקנתה לוויצמן'),
    ('כדי להסיג את', 'כדי להשיג את'),
    ('שהותה צעד', 'שהייתה צעד'),
    ('טיקסי.', 'טקסי.'),
    ('מרכיב מישני', 'מרכיב משני'),
    ('באמצאות אנרגית השמש', 'באמצעות אנרגיית השמש'),
    ('מתעכלים במהירות', 'מתעכלים במהירות,'),
    ('מה שמקשה ויסוּתם', 'מה שמקשה על ויסותם'),
    ('ההבדל בינם לבין', 'ההבדל ביניהן לבין'),
    ('לעיתים קראים', 'לעיתים קוראים'),
    ('להתקיים בילדיו', 'להתקיים בלעדיו'),
    ('החלו ליצר אותו', 'החלו לייצר אותו'),
    ('גם ליצור  אותו', 'גם ליצור אותו'),
    ('באופן תעשיתי', 'באופן תעשייתי'),
    ('פסולת ביולגית', 'פסולת ביולוגית'),
    ('שיתנן', 'שתנן'),
    # --- the molecule cards, second page ---
    ('בלץ אטמוספרי', 'בלחץ אטמוספרי'),
    ('קל לנקת אותו', 'קל לנקות אותו'),
    ('מתים משתית מתנול', 'מתים משתיית מתנול'),
    ('בעזרת פותוסינתזה', 'בעזרת פוטוסינתזה'),
    ('חיים מיצרים פחמן', 'חיים מייצרים פחמן'),
    ('דו-חמצני ניפלט', 'דו-חמצני נפלט'),
    ('שאחוּזו', 'שאחוזו'),
    ('עליה זאת', 'עלייה זאת'),
    ('אולם עלית טמפרטורת', 'אולם עליית טמפרטורת'),
    ('את אנרגית', 'את אנרגיית'),
]

# The term as it reads on the sheet, and the article it leads to. A term is
# linked where Wikipedia itself would link it: a subject of its own that a
# reader may want to go on to, once, including in the captions.
TERMS = [
    ('מימן', 'מימן'),
    ('האטום', 'אטום', 'הקטן ביותר והקל'),
    ('פחמן', 'פחמן'),
    ('תרכובות', 'תרכובת'),
    ('חנקן', 'חנקן'),
    ('באטמוספירת', 'אטמוספירה'),
    ('חמצן', 'חמצן'),
    ('היתוך גרעיני', 'היתוך גרעיני'),
    ('בסופרנובות', 'סופרנובה'),
    ('במספר האטומי', 'מספר אטומי'),
    ('במספר המסה', 'מספר מסה'),
    ('פצצת', 'פצצת מימן'),
    ('המימן', 'פצצת מימן', 'יש ניסיונות רבים'),
    ('היתוך גרעיני מבוקר', 'היתוך גרעיני'),
    ('מודל האטום של בוהר', 'מודל בוהר'),
    ('מכניקה', 'מכניקת הקוונטים'),
    ('קוונטית', 'מכניקת הקוונטים'),
    ('האלקטרונים', 'אלקטרון'),
    ('רמות אנרגיה', 'רמת אנרגיה'),
    ('לאורביטאלים', 'אורביטל אטומי'),
    ('הגרעין', 'גרעין האטום'),
    ('מפרוטונים', 'פרוטון'),
    ('ונייטרונים', 'נייטרון'),
    ('מודל האטום של רתרפורד', 'מודל האטום של רתרפורד'),
    # --- the molecule cards ---
    ('נפט', 'נפט'),
    ('אמוניה', 'אמוניה'),
    ('דשנים', 'דשן'),
    ('אצטון', 'אצטון'),
    ('כממס', 'ממס'),
    ('חומרי נפץ', 'חומר נפץ'),
    ('חיים ויצמן', 'חיים ויצמן'),
    ('מדינות ההסכמה', 'מדינות ההסכמה'),
    ('במלחמת העולם הראשונה', 'מלחמת העולם הראשונה'),
    ('הצהרת בלפור', 'הצהרת בלפור'),
    ('אתנול', 'אתנול'),
    ('הכוהל', 'כוהל'),
    ('שיכרות', 'שכרות'),
    ('אתאן', 'אתאן', 'מרכיב משני'),
    ('גז טבעי', 'גז טבעי'),
    ('בוטאן', 'בוטאן', 'לצד פרופאן'),
    ('זיקוק', 'זיקוק'),
    ('גלוקוז', 'גלוקוז'),
    ('הסוכרים', 'סוכר'),
    ('פרוקטוז', 'פרוקטוז'),
    ('פוטוסינתזה', 'פוטוסינתזה'),
    ('גליצין', 'גליצין'),
    ('חומצת האמינו', 'חומצת אמינו'),
    ('קשר פפטידי', 'קשר פפטידי'),
    ('חלבון', 'חלבון'),
    ('הידרזין', 'הידרזין'),
    ('חומצה אצטית', 'חומצה אצטית'),
    ('בחומץ', 'חומץ'),
    ('מים', 'מים', 'התרכובת הנפוצה ביותר'),
    ('כדור פורח', 'כדור פורח'),
    ('מתאן', 'מתאן', 'המרכיב המרכזי של'),
    ('מתנול', 'מתנול'),
    ('הצפלין', 'צפלין'),
    ('פחמן דו-חמצני', 'פחמן דו-חמצני'),
    ('אפקט החממה', 'אפקט החממה'),
    ('פרופאן', 'פרופאן', 'לצד בוטאן'),
    ('שתנן', 'שתנן'),
    ('בשתן', 'שתן'),
    ('בכבד', 'כבד'),
    # --- what the photographs show ---
    ('ענבים', 'ענב'),
    ('וודקה', 'וודקה'),
    ('גבישים', 'גביש'),
    ('סודה', 'מי סודה'),
    ('אסדה', 'אסדת קידוח'),
    ('חנקן נוזלי', 'חנקן נוזלי'),
    ('הינדנבורג', 'אסון הינדנבורג'),
    ('למסכה', 'מסכת חמצן'),
]


def fix(sheet):
    """Puts every correction in, and says if one of them did not take."""
    missed = []
    for old, new in FIXES:
        where = [ln for ln in sheet.lines if old in ln.text]
        if len(where) != 1:
            missed.append((old, '%d lines' % len(where)))
            continue
        line = where[0]
        at = line.text.index(old)
        try:
            sheet.replace(line, at, at + len(old), new)
        except ValueError as problem:
            missed.append((old, str(problem)))
    return missed


LETTER = re.compile(r'[\w\u0590-\u05ff]')


def whole_word(text, needle, start=0):
    """Where the term stands as a word of its own, not inside another."""
    at = text.find(needle, start)
    while at != -1:
        before = text[at - 1] if at else ' '
        after = text[at + len(needle)] if at + len(needle) < len(text) else ' '
        if not LETTER.match(before) and not LETTER.match(after):
            return at
        at = text.find(needle, at + 1)
    return -1


def link(sheet):
    """Colours every term and returns the link each one needs."""
    annotations, taken, missed = [], set(), []
    for needle, article, *rest in TERMS:
        context = rest[0] if rest else None
        where = None
        for index, line in enumerate(sheet.lines):
            if context and context not in line.text:
                continue
            at = whole_word(line.text, needle)
            while at != -1:
                if (index, at) not in taken:
                    where = (index, line, at)
                    break
                at = whole_word(line.text, needle, at + 1)
            if where:
                break
        if not where:
            missed.append(needle)
            continue
        index, line, at = where
        taken.add((index, at))
        url = WIKI + quote(article.replace(' ', '_'))
        for run, lo, hi in line.locate(at, at + len(needle)):
            sheet.colour(run, lo, hi)
            annotations.append((run.page, sheet.rect(run, lo, hi), url))
    return annotations, missed


def main():
    sheet = Sheet(SRC)
    missed = fix(sheet)
    annotations, unlinked = link(sheet)
    sheet.save(OUT, annotations)
    print('%d of %d corrections, %d links over %d pages -> %s'
          % (len(FIXES) - len(missed), len(FIXES), len(annotations),
             len(sheet.pages), OUT.name))
    for old, why in missed:
        print('  not corrected: %r (%s)' % (old, why))
    for needle in unlinked:
        print('  not found on the sheet:', needle)
    return 1 if missed or unlinked else 0


if __name__ == '__main__':
    raise SystemExit(main())
