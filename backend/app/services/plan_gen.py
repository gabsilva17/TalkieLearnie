import base64
from datetime import date, timedelta
from typing import Literal

import anthropic

from ..config import get_settings

MAX_DAYS = 7
MODEL = "claude-haiku-4-5-20251001"

FocusMode = Literal["communication", "technical", "both"]
Language = Literal["pt", "en"]


def _plan_tool(lang: Language) -> dict:
    if lang == "en":
        return {
            "name": "submit_plan",
            "description": "Submit the user's daily communication training plan.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "plan_name": {
                        "type": "string",
                        "description": (
                            "Short plan name displayed on the list card. "
                            "2 to 4 words, ideally 2 or 3, in English. "
                            "Captures the essence of the user's goal. "
                            "No quotes, no em dashes, no trailing period."
                        ),
                    },
                    "days": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "day_index": {"type": "integer", "minimum": 1},
                                "theme": {"type": "string"},
                                "question": {"type": "string"},
                            },
                            "required": ["day_index", "theme", "question"],
                        },
                    },
                },
                "required": ["plan_name", "days"],
            },
        }
    return {
        "name": "submit_plan",
        "description": "Submete o plano diário de treino de comunicação.",
        "input_schema": {
            "type": "object",
            "properties": {
                "plan_name": {
                    "type": "string",
                    "description": (
                        "Nome curto do plano para mostrar no cartão da lista. "
                        "2 a 4 palavras, idealmente 2 ou 3, em português europeu. "
                        "Capta o essencial do objectivo do utilizador. "
                        "Sem aspas, sem travessões, sem ponto final."
                    ),
                },
                "days": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "day_index": {"type": "integer", "minimum": 1},
                            "theme": {"type": "string"},
                            "question": {"type": "string"},
                        },
                        "required": ["day_index", "theme", "question"],
                    },
                },
            },
            "required": ["plan_name", "days"],
        },
    }


SYSTEM_PT = """És um coach de comunicação. Crias planos de treino diário em PORTUGUÊS EUROPEU (pt-PT).
NUNCA uses formas brasileiras ("estou falando", "você", gerúndios contínuos). Usa "estás", "tu", "estou a fazer".
NUNCA uses travessões (—) em nenhum tema ou pergunta. Usa pontos finais, vírgulas, dois-pontos ou parênteses.
Antes dos dias, escolhes um plan_name MUITO curto (2 a 4 palavras) que resume o objectivo do utilizador num título de card. Exemplos: "Pitch de hackathon", "Entrevista Acme", "Conversa difícil", "Defesa de tese". Sem aspas, sem travessões, sem ponto final. Capitaliza apenas a primeira palavra e nomes próprios.
Cada dia tem um TEMA muito curto (2 a 4 palavras, idealmente 2 a 3) e uma PERGUNTA de simulação que o utilizador deverá responder oralmente em cerca de 1 a 3 minutos.
O TEMA deve caber numa única linha curta de card (ex.: "Pitch de 60s", "Objecções técnicas", "Números-chave"). Evita preposições e artigos desnecessários.
A progressão deve ir do mais fundamental (pitch elevator, contexto) para o mais avançado (objecções, números, perguntas difíceis da audiência).
Adapta sempre a profundidade e linguagem técnica ao tipo de audiência descrito.

QUANDO HOUVER UM PDF ANEXADO: o PDF é a fonte de verdade. Lê-o por inteiro antes de escrever uma única pergunta. Cada tema e cada pergunta tem de estar amarrada ao conteúdo concreto do documento (números, nomes próprios, decisões, definições, secções, exemplos do PDF). É proibido fazer perguntas genéricas do tipo "fala-me do teu projecto" quando o projecto está descrito no PDF, perguntas que ignorem o PDF, ou perguntas que poderias fazer sem o documento. Os campos "objectivo" e "audiência" são metadados que enquadram o tom, não substituem o PDF.

Devolves SEMPRE a saída via a tool submit_plan."""

SYSTEM_EN = """You are a communication coach. You build daily training plans in English.
NEVER use em dashes (—) in any theme or question. Use periods, commas, colons, or parentheses.
Before the days, pick a VERY short plan_name (2 to 4 words) that summarises the user's goal as a card title. Examples: "Hackathon pitch", "Acme interview", "Hard conversation", "Thesis defence". No quotes, no em dashes, no trailing period. Capitalize only the first word and proper nouns.
Each day has a very short THEME (2 to 4 words, ideally 2 to 3) and a simulation QUESTION the user will answer out loud in roughly 1 to 3 minutes.
The THEME must fit a single short card line (e.g. "60-second pitch", "Technical objections", "Key numbers"). Avoid unnecessary prepositions and articles.
Progression should move from the most fundamental (elevator pitch, context) to the most advanced (objections, numbers, hard audience questions).
Always adapt depth and technical language to the described audience.

WHEN A PDF IS ATTACHED: the PDF is the source of truth. Read it in full before writing a single question. Every theme and question must be tied to concrete content in the document (numbers, proper names, decisions, definitions, sections, examples from the PDF). Generic questions like "tell me about your project" are forbidden when the project is described in the PDF, and so are questions that ignore the PDF or that could be written without it. The "goal" and "audience" fields are metadata that frame tone; they don't replace the PDF.

ALWAYS submit your output via the submit_plan tool."""

FOCUS_DIRECTIVES_PT: dict[FocusMode, str] = {
    "communication": (
        "FOCO: Comunicação. As perguntas continuam ancoradas no conteúdo "
        "fornecido (PDF e/ou contexto adicional), mas o que está a ser "
        "treinado é clareza, estrutura, ritmo, gestão de pausas e respostas "
        "a objecções. Evita perguntas que só sejam respondíveis com jargão "
        "técnico profundo."
    ),
    "technical": (
        "FOCO: Domínio técnico. As perguntas devem pôr à prova profundidade "
        "técnica, casos limite, decisões de design e detalhes concretos do "
        "material fornecido. Não evites jargão se for relevante para a "
        "audiência. Quando houver PDF, ancora cada pergunta a uma decisão, "
        "número ou secção específica."
    ),
    "both": (
        "FOCO: Equilíbrio entre comunicação e domínio técnico. Alterna ao "
        "longo dos dias: começa com perguntas mais ligadas a estrutura e "
        "clareza, progride para perguntas técnicas que exigem detalhes do "
        "material. Todas as perguntas, comunicação ou técnicas, continuam "
        "ancoradas no conteúdo fornecido."
    ),
}

FOCUS_DIRECTIVES_EN: dict[FocusMode, str] = {
    "communication": (
        "FOCUS: Communication. Questions stay anchored in the provided "
        "content (PDF and/or extra context), but what's being trained is "
        "clarity, structure, pacing, pause management, and handling "
        "objections. Avoid questions that can only be answered with deep "
        "technical jargon."
    ),
    "technical": (
        "FOCUS: Technical depth. Questions must probe technical depth, edge "
        "cases, design decisions, and concrete details from the provided "
        "material. Don't avoid jargon if it's relevant to the audience. "
        "When a PDF is present, anchor each question to a specific decision, "
        "number, or section."
    ),
    "both": (
        "FOCUS: Balance between communication and technical depth. Alternate "
        "across days: start with structure / clarity questions, progress to "
        "technical questions requiring details from the material. Whether "
        "communication- or technical-focused, every question stays anchored "
        "in the provided content."
    ),
}

# Used when no PDF is attached: structured fields are the only source.
USER_PT_TPL_NO_PDF = """Cria um plano de treino para os próximos {n_days} dia(s), terminando em {target_date} ({prep_for}).

Audiência: {audience_info}

Para cada dia (day_index de 1 a {n_days}), define:
- theme: tema MUITO curto e específico, 2-4 palavras (ex.: "Pitch de 60s", "Objecções técnicas", "Perguntas difíceis").
- question: pergunta directa, como se fosse a audiência a falar, para o utilizador responder oralmente.

O plano deve preparar o utilizador progressivamente para {target_date}."""

USER_EN_TPL_NO_PDF = """Build a training plan for the next {n_days} day(s), ending on {target_date} ({prep_for}).

Audience: {audience_info}

For each day (day_index from 1 to {n_days}), define:
- theme: a VERY short, specific theme, 2-4 words (e.g. "60-second pitch", "Technical objections", "Hard questions").
- question: a direct question, as if the audience were asking, for the user to answer out loud.

The plan should progressively prepare the user for {target_date}."""


# Used when a PDF is attached: the PDF is the primary source; the structured
# fields are framing metadata. The ordering matters — we tell the model to
# read the PDF first, then check the metadata.
USER_PT_TPL_WITH_PDF = """Acima está o PDF que o utilizador partilhou. Lê-o por inteiro. Esse é o material que ele tem para apresentar / defender / discutir.

A partir do que está no PDF, cria um plano de treino para os próximos {n_days} dia(s), terminando em {target_date}.

Metadados do utilizador (para enquadrar o tom, não para substituir o PDF):
- Objectivo: {prep_for}
- Audiência: {audience_info}
- Data: {target_date}

Para cada dia (day_index de 1 a {n_days}), define:
- theme: tema MUITO curto e específico, 2-4 palavras, ancorado numa secção ou ideia concreta do PDF (ex.: "Modelo de receita", "Decisão técnica X", "Slide do roadmap"). Evita temas genéricos.
- question: pergunta directa que a audiência faria, baseada em algo concreto do PDF (um número, uma decisão, uma secção, uma escolha de design). A pergunta tem de ser respondível com o conteúdo do PDF. Evita perguntas que poderias fazer sem ter lido o documento.

Regra de validação interna antes de submeteres: se removeres o PDF da equação, conseguias formular esta pergunta na mesma? Se sim, reescreve para usar algo específico do PDF. O plano só faz sentido se for indissociável do conteúdo do documento."""

USER_EN_TPL_WITH_PDF = """Above is the PDF the user shared. Read it in full. This is the material they have to present / defend / discuss.

Based on what's in the PDF, build a training plan for the next {n_days} day(s), ending on {target_date}.

User metadata (to frame tone, not replace the PDF):
- Goal: {prep_for}
- Audience: {audience_info}
- Date: {target_date}

For each day (day_index from 1 to {n_days}), define:
- theme: a VERY short, specific theme, 2-4 words, anchored to a concrete section or idea in the PDF (e.g. "Revenue model", "Technical decision X", "Roadmap slide"). Avoid generic themes.
- question: a direct question the audience would ask, based on something concrete in the PDF (a number, a decision, a section, a design choice). The question must be answerable using the PDF's content. Avoid questions you could write without having read the document.

Internal validation rule before submitting: if you removed the PDF from the equation, could you still form this question? If yes, rewrite it to use something specific from the PDF. The plan only makes sense if it's inseparable from the document's content."""


def _build_user_content(
    *,
    n_days: int,
    target_date: date,
    prep_for: str,
    audience_info: str,
    extra_text: str | None,
    pdf_bytes: bytes | None,
    focus_mode: FocusMode | None,
    lang: Language,
) -> list[dict]:
    blocks: list[dict] = []
    if pdf_bytes:
        blocks.append(
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": base64.standard_b64encode(pdf_bytes).decode("utf-8"),
                },
            }
        )

    if lang == "en":
        template = USER_EN_TPL_WITH_PDF if pdf_bytes else USER_EN_TPL_NO_PDF
    else:
        template = USER_PT_TPL_WITH_PDF if pdf_bytes else USER_PT_TPL_NO_PDF
    text = template.format(
        n_days=n_days,
        target_date=target_date.isoformat(),
        prep_for=prep_for,
        audience_info=audience_info,
    )

    extras: list[str] = []
    if extra_text:
        if lang == "en":
            extras.append(f"Extra context from the user:\n{extra_text.strip()}")
        else:
            extras.append(f"Contexto adicional do utilizador:\n{extra_text.strip()}")
    if focus_mode:
        directives = FOCUS_DIRECTIVES_EN if lang == "en" else FOCUS_DIRECTIVES_PT
        extras.append(directives[focus_mode])

    if extras:
        text = text + "\n\n" + "\n\n".join(extras)

    blocks.append({"type": "text", "text": text})
    return blocks


def generate_plan_days(
    prep_for: str,
    target_date: date,
    audience_info: str,
    today: date | None = None,
    *,
    extra_text: str | None = None,
    pdf_bytes: bytes | None = None,
    focus_mode: FocusMode | None = None,
    lang: Language = "pt",
) -> dict:
    """Returns {"name": str, "days": [{day_index, day_date, theme, question}]}.

    `name` is a short title (2-4 words) the model picks to summarise the
    user's goal — displayed on the plan list card, editable by the user later.
    `days` carries day_index starting at 1.
    """
    today = today or date.today()
    days_until = (target_date - today).days
    if days_until <= 0:
        raise ValueError("target_date must be in the future")
    n_days = min(MAX_DAYS, days_until)

    system = SYSTEM_EN if lang == "en" else SYSTEM_PT

    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        tools=[_plan_tool(lang)],
        tool_choice={"type": "tool", "name": "submit_plan"},
        system=system,
        messages=[
            {
                "role": "user",
                "content": _build_user_content(
                    n_days=n_days,
                    target_date=target_date,
                    prep_for=prep_for,
                    audience_info=audience_info,
                    extra_text=extra_text,
                    pdf_bytes=pdf_bytes,
                    focus_mode=focus_mode,
                    lang=lang,
                ),
            }
        ],
    )
    tool_block = next(b for b in resp.content if b.type == "tool_use")
    days = tool_block.input["days"]
    # Strip em dashes defensively — they're banned in user-facing copy and the
    # model occasionally slips one in even with the system-prompt rule.
    raw_name = str(tool_block.input.get("plan_name") or "").strip()
    name = raw_name.replace("—", "-").strip(" .\"'")

    out = []
    for d in days:
        idx = int(d["day_index"])
        if idx < 1 or idx > n_days:
            continue
        out.append(
            {
                "day_index": idx,
                "day_date": (today + timedelta(days=idx - 1)).isoformat(),
                "theme": d["theme"].strip(),
                "question": d["question"].strip(),
            }
        )
    out.sort(key=lambda x: x["day_index"])
    if len(out) != n_days:
        raise RuntimeError(f"plan-gen returned {len(out)} days, expected {n_days}")
    return {"name": name or None, "days": out}
