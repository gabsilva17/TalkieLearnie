from typing import Iterable

import anthropic

from ..config import get_settings

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 700

SYSTEM_BASE = """És um coach de comunicação que ajuda o utilizador a preparar-se para situações orais (entrevistas, pitches, conversas difíceis, apresentações).

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

CONTEXT_TPL = """\n\nCONTEXTO DO PLANO ACTIVO DO UTILIZADOR (usa-o para personalizar a resposta):
- Está a preparar-se para: {prep_for}
- Data-alvo: {target_date}
- Audiência: {audience_info}"""


def _system_prompt(plan_ctx: dict | None) -> str:
    if not plan_ctx:
        return SYSTEM_BASE
    return SYSTEM_BASE + CONTEXT_TPL.format(
        prep_for=plan_ctx.get("prep_for", "-"),
        target_date=plan_ctx.get("target_date", "-"),
        audience_info=plan_ctx.get("audience_info", "-"),
    )


def answer(
    messages: Iterable[dict],
    plan_ctx: dict | None = None,
) -> str:
    """messages: list of {role: 'user'|'assistant', content: str}. Returns the assistant reply text."""
    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=_system_prompt(plan_ctx),
        messages=list(messages),
    )
    chunks = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    return "".join(chunks).strip()
