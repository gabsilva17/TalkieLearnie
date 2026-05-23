from datetime import date, timedelta

import anthropic

from ..config import get_settings

MAX_DAYS = 7
MODEL = "claude-haiku-4-5-20251001"

PLAN_TOOL = {
    "name": "submit_plan",
    "description": "Submete o plano diário de treino de comunicação.",
    "input_schema": {
        "type": "object",
        "properties": {
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
            }
        },
        "required": ["days"],
    },
}

SYSTEM_PT = """És um coach de comunicação. Crias planos de treino diário em PORTUGUÊS EUROPEU (pt-PT).
NUNCA uses formas brasileiras ("estou falando", "você", gerúndios contínuos). Usa "estás", "tu", "estou a fazer".
NUNCA uses travessões (—) em nenhum tema ou pergunta. Usa pontos finais, vírgulas, dois-pontos ou parênteses.
Cada dia tem um TEMA muito curto (2 a 4 palavras, idealmente 2 a 3) e uma PERGUNTA de simulação que o utilizador deverá responder oralmente em cerca de 1 a 3 minutos.
O TEMA deve caber numa única linha curta de card (ex.: "Pitch de 60s", "Objecções técnicas", "Números-chave"). Evita preposições e artigos desnecessários.
A progressão deve ir do mais fundamental (pitch elevator, contexto) para o mais avançado (objecções, números, perguntas difíceis da audiência).
Adapta sempre a profundidade e linguagem técnica ao tipo de audiência descrito.
Devolves SEMPRE a saída via a tool submit_plan."""

USER_PT_TPL = """Cria um plano de treino para os próximos {n_days} dia(s), terminando em {target_date} ({prep_for}).

Audiência: {audience_info}

Para cada dia (day_index de 1 a {n_days}), define:
- theme: tema MUITO curto e específico, 2-4 palavras (ex.: "Pitch de 60s", "Objecções técnicas", "Perguntas difíceis").
- question: pergunta directa, como se fosse a audiência a falar, para o utilizador responder oralmente.

O plano deve preparar o utilizador progressivamente para {target_date}."""


def generate_plan_days(
    prep_for: str,
    target_date: date,
    audience_info: str,
    today: date | None = None,
) -> list[dict]:
    """Returns list of {day_index, day_date, theme, question}. day_index starts at 1."""
    today = today or date.today()
    days_until = (target_date - today).days
    if days_until <= 0:
        raise ValueError("target_date must be in the future")
    n_days = min(MAX_DAYS, days_until)

    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        tools=[PLAN_TOOL],
        tool_choice={"type": "tool", "name": "submit_plan"},
        system=SYSTEM_PT,
        messages=[
            {
                "role": "user",
                "content": USER_PT_TPL.format(
                    n_days=n_days,
                    target_date=target_date.isoformat(),
                    prep_for=prep_for,
                    audience_info=audience_info,
                ),
            }
        ],
    )
    tool_block = next(b for b in resp.content if b.type == "tool_use")
    days = tool_block.input["days"]

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
    return out
