# Generator PDF: oferta (1 strona) dla INNOCHEM — Programo
# python3 generate_oferta.py  ->  oferta-innochem-2026-08-21.pdf

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    HRFlowable,
)
from reportlab.lib.utils import ImageReader
import os

LOGO = ImageReader(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "assets", "programo-logo-white.png"))
LOGO_W, LOGO_H = 30 * mm, 30 * mm * 245 / 1200
CONTACT = ("Programo s.c.  ·  programo.pl  ·  biuro@programo.pl  ·  "
           "Wojciech Płonka, +48 797 222 363  ·  wojciech.plonka@programo.pl")

SUP = "/System/Library/Fonts/Supplemental"
pdfmetrics.registerFont(TTFont("Body", f"{SUP}/Arial.ttf"))
pdfmetrics.registerFont(TTFont("Body-Bold", f"{SUP}/Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Disp-Bold", f"{SUP}/Georgia Bold.ttf"))

PINE = HexColor("#1E4D4A")
DEEP = HexColor("#0D2724")
COPPER = HexColor("#A85E2B")
COPPER_SOFT = HexColor("#BD6F38")
INK = HexColor("#10302C")
MUTED = HexColor("#4E5C55")
PORCELAIN = HexColor("#F5F1E9")
IVORY = HexColor("#FCFAF5")
HAIR = HexColor("#D8D2C4")

W, H = A4
M = 18 * mm
CW = W - 2 * M
DATE = "21.08.2026"
TITLE = f"Oferta · INNOCHEM · {DATE}"


def S(name, **kw):
    base = dict(fontName="Body", fontSize=8.6, leading=12.4, textColor=INK, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)


st_kicker = S("kicker", fontName="Body-Bold", fontSize=8, leading=11, textColor=COPPER, spaceBefore=8, spaceAfter=3)
st_h1 = S("h1", fontName="Disp-Bold", fontSize=19, leading=24, textColor=DEEP, spaceAfter=3)
st_h2 = S("h2", fontName="Disp-Bold", fontSize=11.5, leading=14, textColor=PINE, spaceBefore=8, spaceAfter=4)
st_body = S("body", spaceAfter=4)
st_muted = S("muted", textColor=MUTED, spaceAfter=4)
st_li = S("li", leftIndent=11, bulletIndent=2, spaceAfter=2)
st_small = S("small", fontSize=7.6, leading=10.6, textColor=MUTED)
st_lead = S("lead", fontSize=9.6, leading=14, textColor=MUTED, spaceAfter=5)
st_cell = S("cell", fontSize=8.2, leading=11.2)
st_cell_b = S("cell_b", fontName="Body-Bold", fontSize=8.2, leading=11.2)
st_cell_h = S("cell_h", fontName="Body-Bold", fontSize=7.8, leading=10.5, textColor=white)


def bullet(text, style=st_li):
    return Paragraph(f'<bullet><font color="#A85E2B">✦</font></bullet>{text}', style)


def P(text, style=st_body):
    return Paragraph(text, style)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DEEP)
    canvas.rect(0, H - 16 * mm, W, 16 * mm, stroke=0, fill=1)
    canvas.drawImage(LOGO, M, H - 8 * mm - LOGO_H / 2, width=LOGO_W, height=LOGO_H, mask="auto")
    canvas.setFillColor(HexColor("#D89A66"))
    canvas.setFont("Body", 8)
    canvas.drawRightString(W - M, H - 10.4 * mm, TITLE)
    canvas.setStrokeColor(HAIR)
    canvas.setLineWidth(0.6)
    canvas.line(M, 13 * mm, W - M, 13 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Body", 7.5)
    canvas.drawString(M, 9 * mm, CONTACT)
    canvas.restoreState()


doc = BaseDocTemplate("oferta-innochem-2026-08-21.pdf", pagesize=A4,
                      leftMargin=M, rightMargin=M, topMargin=21 * mm, bottomMargin=15 * mm,
                      title=TITLE, author="Programo s.c.")
doc.addPageTemplates([PageTemplate(id="page", frames=[Frame(M, 15 * mm, CW, H - 36 * mm, id="main")],
                                   onPage=header_footer)])


def tbl(rows, col_widths):
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Body"),
        ("BACKGROUND", (0, 0), (-1, 0), PINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [IVORY, PORCELAIN]),
        ("GRID", (0, 0), (-1, -1), 0.5, HAIR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def hdr(*cells):
    return [Paragraph(c, st_cell_h) for c in cells]


def row(*cells, bold=()):
    return [Paragraph(c, st_cell_b if i in bold else st_cell) for i, c in enumerate(cells)]


story = []

story.append(Paragraph("OFERTA DLA INNOCHEM.PL", st_kicker))
story.append(Paragraph("Nowy sklep internetowy Royal Purple", st_h1))
story.append(Paragraph("Ceny netto · " + DATE + " · działające demo: "
                       "<b><font color='#A85E2B'>innochem.programo.pl</font></b>", st_lead))
story.append(HRFlowable(width="100%", thickness=0.8, color=COPPER_SOFT, spaceAfter=6))

story.append(P("Przygotowaliśmy projekt sklepu od zera — szybki, bezpieczny i poprawnie wyświetlający się "
               "na telefonach. Zanim cokolwiek Pani zdecyduje, można go obejrzeć i przeklikać pod adresem "
               "powyżej: strona główna, karta produktu i ścieżka zamówienia."))

story.append(Paragraph("Zakres i ceny", st_h2))
story.append(tbl([
    hdr("Zakres", "Cena netto", "Termin"),
    row("<b>Wdrożenie nowego sklepu</b><br/>Projekt graficzny i budowa sklepu, przeniesienie wszystkich "
        "produktów i treści, płatności online (BLIK, szybkie przelewy), kurier i paczkomaty, faktury VAT, "
        "pełna wersja mobilna. Uruchomienie pod obecną domeną bez przerwy w działaniu.",
        "2 500 zł<br/>jednorazowo", "3 tygodnie<br/>od akceptacji", bold=(1,)),
    row("<b>Utrzymanie — pakiet podstawowy</b><br/>Hosting, certyfikat SSL, codzienne kopie zapasowe, "
        "monitoring, aktualizacje bezpieczeństwa i bieżące drobne zmiany treści.",
        "350 zł<br/>miesięcznie", "od startu", bold=(1,)),
    row("<b>Utrzymanie — pakiet z SEO</b><br/>Wszystko z pakietu podstawowego oraz stała praca nad "
        "widocznością w Google: optymalizacja opisów produktów i kategorii, dane strukturalne (ceny i "
        "dostępność widoczne w wynikach), rozbudowa bazy wiedzy o teksty, których klienci szukają, "
        "i miesięczny raport pozycji. To ruch, za który nie płaci się reklamami.",
        "550 zł<br/>miesięcznie", "od startu", bold=(1,)),
    row("<b>Aplikacja mobilna sklepu (iOS + Android)</b><br/>Sklep jako aplikacja w App Store i Google Play, "
        "z tym samym magazynem i zamówieniami. Bez podnoszenia abonamentu — utrzymanie w cenie pakietu. "
        "Powiadomienia push o promocjach trafiają do klientów za darmo, bez płacenia za reklamy.",
        "1 500 zł<br/>jednorazowo", "3 tygodnie<br/>od startu sklepu", bold=(1,)),
], [96 * mm, 26 * mm, CW - 122 * mm]))
story.append(Spacer(1, 4))

story.append(Paragraph("Opcje do dokupienia w dowolnym momencie", st_h2))
story.append(tbl([
    hdr("Zakres", "Cena netto"),
    row("<b>Google Ads</b> — reklamy nad wynikami Google dla szukających olejów Royal Purple; "
        "prowadzenie, optymalizacja i miesięczny raport. Budżet reklamowy płacony bezpośrednio do Google, "
        "z ustalonym limitem.", "250 zł miesięcznie", bold=(1,)),
    row("<b>Social media</b> — prowadzenie profilu firmowego (Facebook/Instagram): regularne posty "
        "produktowe i poradnikowe, grafiki, odpowiadanie na wiadomości.", "400 zł miesięcznie", bold=(1,)),
], [96 * mm, CW - 96 * mm]))
story.append(Spacer(1, 4))

story.append(P("<b>Dlaczego pakiet ze sklepem i aplikacją się opłaca:</b> klienci, którzy raz kupili, wracają "
               "z powiadomienia push zamiast z płatnej reklamy — koszt dotarcia do stałego klienta spada "
               "praktycznie do zera, a budżet reklamowy pracuje tylko na pozyskanie nowych.", st_muted))

story.append(Paragraph("Czego potrzebujemy od Państwa", st_h2))
for t in [
    "<b>Dostęp do obecnego sklepu</b> — przeniesiemy produkty, opisy i zdjęcia; nic nie trzeba przepisywać ręcznie.",
    "<b>Dostęp do domeny innochem.pl</b> — zmiana według naszej instrukcji, bez przerwy w działaniu poczty.",
    "<b>Dane do płatności</b> — umowa z operatorem płatności (pomożemy ją założyć, jeśli jej nie ma).",
]:
    story.append(bullet(t))

story.append(Paragraph("Warunki", st_h2))
story.append(P("Wdrożenie płatne po odbiorze sklepu, abonament od miesiąca startu. Sklep, treści i domena "
               "pozostają Państwa własnością. 30 dni gwarancji poprawek po starcie. Faktura VAT. "
               "Do cen netto doliczany jest VAT 23%."))

doc.build(story)
print("OK oferta-innochem-2026-08-21.pdf")
