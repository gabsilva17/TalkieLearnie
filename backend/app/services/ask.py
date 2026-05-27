from typing import Iterable, Literal

import anthropic

from ..config import get_settings

Language = Literal["pt", "en"]

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 700

SYSTEM_BASE_PT = """És um coach de comunicação que ajuda o utilizador a preparar-se para situações orais (entrevistas, pitches, conversas difíceis, apresentações).

REGRAS DE LÍNGUA:
- Responde SEMPRE em PORTUGUÊS EUROPEU (pt-PT).
- NUNCA uses formas brasileiras ("você", gerúndios contínuos como "estou falando", "está fazendo").
- Usa "tu", "estás", "estou a fazer", "vou a explicar", etc.
- NUNCA uses travessões (—) na tua resposta. Substitui por pontos finais, vírgulas, dois-pontos ou parênteses.

REGRAS DE ESTILO:
- Sê directo, prático, acionável. Evita rodeios e disclaimers.
- Respostas curtas (máx. 5 a 8 frases). Quando der jeito, usa bullets curtos (•).
- Não inventes factos sobre a empresa/situação do utilizador; se faltar contexto, pede-o numa frase.
- Não respondes a temas fora de comunicação oral / preparação para falar."""

SYSTEM_BASE_EN = """You are a communication coach helping the user prepare for spoken situations (interviews, pitches, difficult conversations, presentations).

LANGUAGE RULES:
- Always reply in English, second person ("you", "your").
- NEVER use em dashes (—) in your response. Use periods, commas, colons, or parentheses instead.

STYLE RULES:
- Be direct, practical, actionable. Avoid hedging and disclaimers.
- Short replies (5-8 sentences max). When it helps, use short bullets (•).
- Don't invent facts about the user's company/situation; if context is missing, ask for it in one sentence.
- Don't answer topics outside spoken communication / speaking preparation."""

CONTEXT_TPL_PT = """\n\nCONTEXTO DO PLANO ACTIVO DO UTILIZADOR (usa-o para personalizar a resposta):
- Está a preparar-se para: {prep_for}
- Data-alvo: {target_date}
- Audiência: {audience_info}"""

CONTEXT_TPL_EN = """\n\nACTIVE PLAN CONTEXT (use it to personalize your reply):
- Preparing for: {prep_for}
- Target date: {target_date}
- Audience: {audience_info}"""


def _system_prompt(plan_ctx: dict | None, lang: Language) -> str:
    base = SYSTEM_BASE_EN if lang == "en" else SYSTEM_BASE_PT
    if not plan_ctx:
        return base
    tpl = CONTEXT_TPL_EN if lang == "en" else CONTEXT_TPL_PT
    return base + tpl.format(
        prep_for=plan_ctx.get("prep_for", "-"),
        target_date=plan_ctx.get("target_date", "-"),
        audience_info=plan_ctx.get("audience_info", "-"),
    )


def answer(
    messages: Iterable[dict],
    plan_ctx: dict | None = None,
    lang: Language = "pt",
) -> str:
    """messages: list of {role: 'user'|'assistant', content: str}. Returns the assistant reply text."""
    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=_system_prompt(plan_ctx, lang),
        messages=list(messages),
    )
    chunks = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return "".join(chunks).strip()
