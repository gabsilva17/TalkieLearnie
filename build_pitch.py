"""Generate TalkieLearnie pitch deck (.pptx).

Editorial layout, coherent system across all slides:
  - White canvas
  - Eyebrow (primary dot + small caps letter-spaced) on every content slide
  - Big black headline
  - Optional small neutral subtitle
  - Footer chrome: brand left, section + page right
  - Primary blue used only as accent

Three parts:
  Parte 1 — Pitch (texto curto a guiar a narrativa)
  Parte 2 — DEMO (slide única, grande)
  Parte 3 — Tecnologia / arquitetura / complexidades (bullets curtos)
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt, Emu

# --- Brand ----------------------------------------------------------------

PRIMARY_50  = RGBColor(0xF0, 0xF9, 0xFF)
PRIMARY_100 = RGBColor(0xE0, 0xF2, 0xFE)
PRIMARY_200 = RGBColor(0xBA, 0xE6, 0xFD)
PRIMARY_500 = RGBColor(0x0E, 0xA5, 0xE9)
PRIMARY_600 = RGBColor(0x02, 0x84, 0xC7)
PRIMARY_700 = RGBColor(0x03, 0x69, 0xA1)

NEUTRAL_100 = RGBColor(0xF1, 0xF5, 0xF9)
NEUTRAL_200 = RGBColor(0xE2, 0xE8, 0xF0)
NEUTRAL_300 = RGBColor(0xCB, 0xD5, 0xE1)
NEUTRAL_400 = RGBColor(0x94, 0xA3, 0xB8)
NEUTRAL_500 = RGBColor(0x64, 0x74, 0x8B)
NEUTRAL_700 = RGBColor(0x33, 0x41, 0x55)
NEUTRAL_800 = RGBColor(0x1E, 0x29, 0x3B)
NEUTRAL_900 = RGBColor(0x0F, 0x17, 0x2A)

WHITE = RGBColor(0xFF, 0xFF, 0xFF)

FONT = "Nunito"

# 16:9
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

# Grid
MARGIN_X = Inches(0.95)
EYEBROW_Y = Inches(0.95)
HEADLINE_Y = Inches(2.3)
FOOTER_Y = Inches(7.1)

ROOT = Path(__file__).resolve().parent
ICON_PATH = ROOT / "mobile" / "assets" / "images" / "icon.png"
OUTPUT_PATH = ROOT / "TalkieLearnie_pitch_v2.pptx"


# --- Primitives -----------------------------------------------------------

def add_blank_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = WHITE
    return slide


def add_rect(slide, x, y, w, h, fill=None, line=None, line_w=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shape.shadow.inherit = False
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        if line_w is not None:
            shape.line.width = line_w
    return shape


def add_oval(slide, x, y, w, h, fill=None, line=None, line_w=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, x, y, w, h)
    shape.shadow.inherit = False
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        if line_w is not None:
            shape.line.width = line_w
    return shape


def add_line(slide, x1, y1, x2, y2, color=NEUTRAL_300, width=Pt(0.75)):
    line = slide.shapes.add_connector(1, x1, y1, x2, y2)
    line.line.color.rgb = color
    line.line.width = width
    return line


def add_text(
    slide, x, y, w, h, text,
    *, size=18, bold=False, color=NEUTRAL_900, align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP, font=FONT, letter_spacing=None, line_spacing=None,
):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    if line_spacing is not None:
        p.line_spacing = line_spacing
    run = p.add_run()
    run.text = text
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    if letter_spacing is not None:
        run.font._rPr.set("spc", str(int(letter_spacing * 100)))
    return tb


# --- Slide chrome ---------------------------------------------------------

def add_chrome(slide, section_label, page_num, total_pages, hide_brand=False):
    """Footer chrome: brand left, section · page right."""
    if not hide_brand:
        add_oval(slide, MARGIN_X, FOOTER_Y + Inches(0.06),
                 Inches(0.13), Inches(0.13), fill=PRIMARY_500)
        add_text(slide, MARGIN_X + Inches(0.22), FOOTER_Y,
                 Inches(4), Inches(0.3),
                 "TalkieLearnie", size=10, bold=True, color=NEUTRAL_700)
    # right side
    add_text(
        slide,
        SLIDE_W - MARGIN_X - Inches(4), FOOTER_Y,
        Inches(4), Inches(0.3),
        f"{section_label.upper()}   ·   {page_num:02d} / {total_pages:02d}",
        size=9, bold=True, color=NEUTRAL_400,
        align=PP_ALIGN.RIGHT, letter_spacing=3,
    )


def add_eyebrow(slide, label, y=None):
    """Primary dot + uppercase letter-spaced label, fixed grid position."""
    if y is None:
        y = EYEBROW_Y
    add_oval(slide, MARGIN_X, y + Inches(0.08),
             Inches(0.12), Inches(0.12), fill=PRIMARY_500)
    add_text(
        slide, MARGIN_X + Inches(0.22), y,
        Inches(8), Inches(0.3),
        label.upper(),
        size=11, bold=True, color=PRIMARY_600, letter_spacing=3,
    )


def add_headline(slide, text, *, size=58, y=None, color=NEUTRAL_900,
                 width=None, line_spacing=1.05):
    if y is None:
        y = HEADLINE_Y
    if width is None:
        width = SLIDE_W - 2 * MARGIN_X
    return add_text(
        slide, MARGIN_X, y, width, Inches(3.5),
        text, size=size, bold=True, color=color,
        line_spacing=line_spacing,
    )


def add_subtitle(slide, text, *, y, size=18, width=None, color=NEUTRAL_500):
    if width is None:
        width = SLIDE_W - 2 * MARGIN_X
    return add_text(
        slide, MARGIN_X, y, width, Inches(1.5),
        text, size=size, color=color, line_spacing=1.3,
    )


# --- Slide builders -------------------------------------------------------

def slide_cover(prs, total):
    s = add_blank_slide(prs)
    cx, cy = SLIDE_W // 2, SLIDE_H // 2 - Inches(0.3)
    # halo
    add_oval(s, cx - Inches(2.6), cy - Inches(2.6),
             Inches(5.2), Inches(5.2), fill=PRIMARY_50)
    add_oval(s, cx - Inches(1.7), cy - Inches(1.7),
             Inches(3.4), Inches(3.4), fill=PRIMARY_100)
    # icon
    if ICON_PATH.exists():
        size = Inches(1.7)
        s.shapes.add_picture(
            str(ICON_PATH),
            cx - size // 2, cy - size // 2,
            size, size,
        )
    # wordmark
    add_text(
        s, 0, cy + Inches(1.6), SLIDE_W, Inches(0.8),
        "TalkieLearnie", size=46, bold=True, color=NEUTRAL_900,
        align=PP_ALIGN.CENTER,
    )
    # tagline
    add_text(
        s, 0, cy + Inches(2.4), SLIDE_W, Inches(0.5),
        "A tua voz, treinada todos os dias.",
        size=16, color=NEUTRAL_500, align=PP_ALIGN.CENTER,
    )
    add_chrome(s, "Pitch", 1, total, hide_brand=True)
    return s


def slide_text(prs, eyebrow, headline, subtitle=None, *,
               section, page, total, headline_size=58, headline_y=None):
    s = add_blank_slide(prs)
    add_eyebrow(s, eyebrow)
    add_headline(s, headline, size=headline_size, y=headline_y)
    if subtitle is not None:
        y = (headline_y or HEADLINE_Y) + Inches(0.06 * (headline_size / 10) + 2.0)
        # heuristic placement: directly below the headline area
        add_subtitle(s, subtitle, y=Inches(5.0))
    add_chrome(s, section, page, total)
    return s


def slide_pitch_hook(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  o problema")
    add_headline(
        s,
        "Em 30 segundos,\ndecide-se quase tudo.",
        size=66, y=Inches(2.2),
    )
    add_subtitle(
        s,
        "Entrevistas. Pitches. Conversas difíceis.\n"
        "A voz é o produto. E ninguém a treina.",
        y=Inches(5.1), size=20,
    )
    add_chrome(s, "Pitch", page, total)
    return s


def slide_pitch_insight(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  o insight")
    add_headline(
        s,
        "Comunicar é o skill\nmais decisivo do século.",
        size=62, y=Inches(2.2),
    )
    add_subtitle(
        s,
        "Tratamo-la como talento. Devíamos tratá-la como hábito.",
        y=Inches(5.0), size=20,
    )
    add_chrome(s, "Pitch", page, total)
    return s


def slide_pitch_reveal(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  a solução")
    # Big two-line headline with accent on key phrase
    add_headline(
        s,
        "Duolingo para\ncomunicação falada.",
        size=72, y=Inches(1.9), color=NEUTRAL_900,
    )
    add_subtitle(
        s,
        "Plano diário. Cinco minutos. Feedback de IA, à medida.",
        y=Inches(5.2), size=20,
    )
    add_chrome(s, "Pitch", page, total)
    return s


def slide_pitch_how(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  como funciona")
    add_headline(s, "Três passos. Cinco minutos.",
                 size=44, y=Inches(2.0))

    steps = [
        ("01", "Define o objetivo",
         "Entrevista, pitch, conversa difícil. A IA gera um plano à medida."),
        ("02", "Treina a voz",
         "Mini-simulações curtas. Grava a resposta. Sem stress."),
        ("03", "Recebe feedback",
         "Score, métricas e sugestões em segundos. Repete amanhã."),
    ]
    col_w = (SLIDE_W - 2 * MARGIN_X - Inches(0.6)) // 3
    gap = Inches(0.3)
    y = Inches(3.7)
    for i, (num, title, body) in enumerate(steps):
        x = MARGIN_X + i * (col_w + gap)
        add_text(s, x, y, col_w, Inches(0.6), num,
                 size=14, bold=True, color=PRIMARY_600, letter_spacing=3)
        add_line(s, x, y + Inches(0.55),
                 x + Inches(0.5), y + Inches(0.55),
                 color=PRIMARY_500, width=Pt(2))
        add_text(s, x, y + Inches(0.85), col_w, Inches(0.6),
                 title, size=22, bold=True, color=NEUTRAL_900)
        add_text(s, x, y + Inches(1.55), col_w, Inches(2),
                 body, size=14, color=NEUTRAL_500, line_spacing=1.4)
    add_chrome(s, "Pitch", page, total)
    return s


def slide_pitch_why_now(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  porquê agora")
    add_headline(
        s,
        "Um coach pessoal\nà escala. Hoje, possível.",
        size=58, y=Inches(2.0),
    )
    add_subtitle(
        s,
        "Whisper transcreve com precisão de palavra.  Claude avalia em segundos.\n"
        "Tu treinas, todos os dias, no telemóvel.",
        y=Inches(5.0), size=18,
    )
    add_chrome(s, "Pitch", page, total)
    return s


def slide_pitch_manifesto(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Pitch  ·  manifesto")
    add_headline(
        s,
        "Hábito  >  talento.",
        size=92, y=Inches(2.6),
    )
    add_subtitle(
        s,
        "Cinco minutos por dia valem mais do que um workshop por ano.",
        y=Inches(5.3), size=20,
    )
    add_chrome(s, "Pitch", page, total)
    return s


def slide_demo(prs, page, total):
    s = add_blank_slide(prs)
    # subtle blue band on the right edge for continuity
    add_rect(s, SLIDE_W - Inches(0.35), 0, Inches(0.35), SLIDE_H,
             fill=PRIMARY_500)
    # big centered DEMO
    add_text(
        s, 0, Inches(2.7), SLIDE_W - Inches(0.35), Inches(2.4),
        "DEMO", size=220, bold=True, color=NEUTRAL_900,
        align=PP_ALIGN.CENTER, letter_spacing=8,
    )
    # small subtitle
    add_text(
        s, 0, Inches(5.4), SLIDE_W - Inches(0.35), Inches(0.4),
        "Ao vivo, na app.",
        size=18, color=NEUTRAL_500, align=PP_ALIGN.CENTER,
    )
    add_chrome(s, "Demo", page, total)
    return s


def slide_section_tech(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Tecnologia  ·  por trás")
    add_headline(
        s,
        "O que faz isto funcionar.",
        size=64, y=Inches(2.5),
    )
    add_subtitle(
        s,
        "Stack pequena, escolhas opinionadas, complexidade onde importa.",
        y=Inches(5.0), size=20,
    )
    add_chrome(s, "Tecnologia", page, total)
    return s


def _bullet_list(slide, items, *, x, y, w, gap=Inches(0.55),
                 title_size=16, body_size=13):
    """Render a vertical bullet list with primary dot + bold title + body."""
    cy = y
    for item in items:
        if isinstance(item, tuple):
            title, body = item
        else:
            title, body = item, None
        # dot
        add_oval(slide, x, cy + Inches(0.13),
                 Inches(0.13), Inches(0.13), fill=PRIMARY_500)
        # title
        add_text(slide, x + Inches(0.3), cy,
                 w - Inches(0.3), Inches(0.4),
                 title, size=title_size, bold=True, color=NEUTRAL_900)
        block_h = Inches(0.4)
        if body:
            add_text(slide, x + Inches(0.3), cy + Inches(0.42),
                     w - Inches(0.3), Inches(1.2),
                     body, size=body_size, color=NEUTRAL_500,
                     line_spacing=1.35)
            block_h = Inches(1.05)
        cy += block_h + gap
    return cy


def slide_stack(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Tecnologia  ·  stack")
    add_headline(s, "Construído com cinco peças.",
                 size=44, y=Inches(1.85))

    items = [
        ("Expo SDK 54 + TypeScript",
         "Mobile. expo-router file-based. Funciona em Expo Go, sem dev build."),
        ("FastAPI · Python 3.11 · uv",
         "Backend leve. Routes finas, services com a lógica, schemas Pydantic."),
        ("Claude  ·  Haiku 4.5 + Sonnet 4.6",
         "Haiku gera o plano. Sonnet é o juiz das gravações. Forced tool use para JSON."),
        ("OpenAI Whisper",
         "Único STT com word-level timestamps, necessário para variação de ritmo."),
        ("Supabase Postgres + AsyncStorage",
         "device_id anónimo no cliente, sem auth, sem tabela de utilizadores."),
    ]
    _bullet_list(
        s, items,
        x=MARGIN_X, y=Inches(3.0),
        w=SLIDE_W - 2 * MARGIN_X,
        gap=Inches(0.18), title_size=16, body_size=12,
    )
    add_chrome(s, "Tecnologia", page, total)
    return s


def slide_complex_pipeline(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Complexidade  ·  pipeline da voz")
    add_headline(s, "De áudio a score, sem tropeçar.",
                 size=40, y=Inches(1.85))
    items = [
        ("Whisper via SDK oficial",
         "Word-level timestamps com timestamp_granularities=['word']. Multipart à mão dá erros obscuros."),
        ("Junk filter pós-Whisper",
         "Transcript vazio ou clipe <5s devolve 422 antes de chamar o Sonnet. Não gastamos tokens em ruído."),
        ("Forced tool use no Sonnet 4.6",
         "Anthropic não tem json mode. Forçar um tool call é o único caminho fiável para output estruturado."),
        ("Métricas determinísticas locais",
         "WPM, filler words (lista pt-PT) e variação de ritmo calculadas em Python, não pelo LLM."),
        ("Reanalysis no retry",
         "Se o utilizador corrige o transcript, recomputamos só o que é texto. Sinais acústicos preservam-se."),
    ]
    _bullet_list(
        s, items,
        x=MARGIN_X, y=Inches(3.0),
        w=SLIDE_W - 2 * MARGIN_X,
        gap=Inches(0.16), title_size=16, body_size=12,
    )
    add_chrome(s, "Tecnologia", page, total)
    return s


def slide_complex_state(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Complexidade  ·  estado")
    add_headline(s, "O backend é a fonte da verdade.",
                 size=40, y=Inches(1.85))
    items = [
        ("Celebrations no servidor",
         "Conquistas, streaks e plano completo são diffados na mesma transação do POST /sessions e devolvidos em celebrations."),
        ("Zero cache no cliente",
         "Removemos AsyncStorage caches, baselines e gates. Eliminou uma classe inteira de bugs silenciosos."),
        ("Perfil 100% derivado",
         "Heatmap de 365 dias, trends de 14 dias e 12 conquistas calculados on-the-fly. Sem tabelas extra."),
        ("tz_offset_minutes no payload",
         "Streaks respeitam a meia-noite local do utilizador, não o UTC do servidor."),
        ("Retry como UPSERT",
         "Re-gravar um dia faz UPDATE da linha em vez de devolver 409. Mantém o histórico limpo."),
    ]
    _bullet_list(
        s, items,
        x=MARGIN_X, y=Inches(3.0),
        w=SLIDE_W - 2 * MARGIN_X,
        gap=Inches(0.16), title_size=16, body_size=12,
    )
    add_chrome(s, "Tecnologia", page, total)
    return s


def slide_complex_mobile(prs, page, total):
    s = add_blank_slide(prs)
    add_eyebrow(s, "Complexidade  ·  cliente")
    add_headline(s, "Detalhes que não se vêem.",
                 size=40, y=Inches(1.85))
    items = [
        ("FileSystem.uploadAsync (legacy)",
         "fetch + FormData partia silenciosamente em Android + New Architecture. uploadAsync é o que funciona."),
        ("Optimistic plan creation",
         "Onda A revela skeletons em sequência. Onda B, depois da API resolver, troca cada skeleton por uma DayCard real."),
        ("Reveal overlays estilo Revolut",
         "Origem do círculo medida em runtime via measureInWindow. Fila partilhada para chat e perfil."),
        ("Hold-to-talk com morph",
         "Crossfade entre input idle e pill de gravação sem perder o gesto. <400ms é tap acidental, ignorado."),
        ("Filas de celebrações",
         "pending → live → unmount evita que a coreografia pós-gravação seja interrompida pelas conquistas."),
    ]
    _bullet_list(
        s, items,
        x=MARGIN_X, y=Inches(3.0),
        w=SLIDE_W - 2 * MARGIN_X,
        gap=Inches(0.16), title_size=16, body_size=12,
    )
    add_chrome(s, "Tecnologia", page, total)
    return s


def slide_closing(prs, page, total):
    s = add_blank_slide(prs)
    cx, cy = SLIDE_W // 2, SLIDE_H // 2 - Inches(0.5)
    # halo
    add_oval(s, cx - Inches(2.4), cy - Inches(2.4),
             Inches(4.8), Inches(4.8), fill=PRIMARY_50)
    add_oval(s, cx - Inches(1.5), cy - Inches(1.5),
             Inches(3.0), Inches(3.0), fill=PRIMARY_100)
    if ICON_PATH.exists():
        size = Inches(1.3)
        s.shapes.add_picture(
            str(ICON_PATH),
            cx - size // 2, cy - size // 2,
            size, size,
        )
    add_text(
        s, 0, cy + Inches(1.5), SLIDE_W, Inches(0.9),
        "Obrigado.", size=64, bold=True, color=NEUTRAL_900,
        align=PP_ALIGN.CENTER,
    )
    add_text(
        s, 0, cy + Inches(2.45), SLIDE_W, Inches(0.4),
        "TalkieLearnie", size=14, bold=True, color=PRIMARY_600,
        align=PP_ALIGN.CENTER, letter_spacing=4,
    )
    add_chrome(s, "Fim", page, total, hide_brand=True)
    return s


# --- Build ----------------------------------------------------------------

def build():
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    TOTAL = 14

    # Pitch (7)
    slide_cover(prs, TOTAL)
    slide_pitch_hook(prs, 2, TOTAL)
    slide_pitch_insight(prs, 3, TOTAL)
    slide_pitch_reveal(prs, 4, TOTAL)
    slide_pitch_how(prs, 5, TOTAL)
    slide_pitch_why_now(prs, 6, TOTAL)
    slide_pitch_manifesto(prs, 7, TOTAL)

    # Demo (1)
    slide_demo(prs, 8, TOTAL)

    # Tecnologia (5) + Fim (1)
    slide_section_tech(prs, 9, TOTAL)
    slide_stack(prs, 10, TOTAL)
    slide_complex_pipeline(prs, 11, TOTAL)
    slide_complex_state(prs, 12, TOTAL)
    slide_complex_mobile(prs, 13, TOTAL)
    slide_closing(prs, 14, TOTAL)

    prs.save(str(OUTPUT_PATH))
    print(f"OK {OUTPUT_PATH}  ({TOTAL} slides)")


if __name__ == "__main__":
    build()
