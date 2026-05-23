import anthropic

from ..config import get_settings

MODEL = "claude-sonnet-4-6"

ANALYSIS_TOOL = {
    "name": "submit_analysis",
    "description": "Submete a análise estruturada da resposta falada do utilizador.",
    "input_schema": {
        "type": "object",
        "properties": {
            "rating": {"type": "integer", "minimum": 1, "maximum": 10},
            "summary": {"type": "string"},
            "strengths": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
            "weaknesses": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
            "suggestions": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
            "audience_fit": {"type": "string"},
            "conciseness": {"type": "string"},
            "dispersion": {"type": "string"},
        },
        "required": [
            "rating", "summary", "strengths", "weaknesses",
            "suggestions", "audience_fit", "conciseness", "dispersion",
        ],
    },
}

SYSTEM_PT = """És um coach de comunicação. Avalias respostas faladas em PORTUGUÊS EUROPEU (pt-PT, NÃO pt-BR).
NUNCA uses gerúndios brasileiros ("estou falando"); usa "estou a falar". Usa "tu" e formas europeias ("estás", "olha", "epá").
NUNCA uses travessões (—) em nenhuma string que devolvas. Usa pontos finais, vírgulas, dois-pontos ou parênteses.
Toda a tua saída é em pt-PT, num tom directo, encorajador e específico, nunca genérico.
Devolves SEMPRE a análise através da tool submit_analysis, nunca em texto livre.

Rubrica de rating (1-10), aplica de forma consistente:
- 9-10: WPM 130-160, menos de 1 filler / 30s, variação de ritmo 0.15-0.35, estrutura clara (intro+corpo+conclusão), linguagem ajustada à audiência, sem divagar.
- 7-8: 1 ou 2 dos critérios acima ligeiramente fora.
- 5-6: respostas dispersas OU mais de 3 fillers / 30s OU WPM < 100 ou > 180 OU linguagem desadequada à audiência.
- 3-4: dois ou mais problemas graves simultâneos.
- 1-2: incompreensível, sem estrutura, ou fora do tema.

Bandas de WPM: 90-120 lento, 120-160 ideal, 160-200 rápido, >200 atropelado.
Densidade de fillers: > 5/min é alto.
Variação de ritmo (CoV): <0.15 monotónico, 0.15-0.35 saudável, >0.35 errático.

Strengths/weaknesses/suggestions DEVEM ser específicos à transcrição: cita expressões do utilizador.
Suggestions são accionáveis (o que fazer no próximo treino), não vagas."""

USER_PT_TPL = """Contexto:
- Preparação para: {prep_for}
- Audiência: {audience_info}
- Tema do dia: {theme}
- Pergunta colocada: {question}

Métricas da resposta:
- Duração: {duration}s ({word_count} palavras)
- WPM: {wpm}
- Fillers totais: {filler_count} (mais usado: "{top_filler}")
- Variação de ritmo (CoV): {pacing_variation}

Transcrição literal:
\"\"\"
{transcript}
\"\"\"

Avalia esta resposta usando a tool submit_analysis. O campo `dispersion` indica se o utilizador divagou (e em quê); `conciseness` se foi sucinto ou prolixo; `audience_fit` se o registo, a linguagem técnica e os exemplos encaixam na audiência descrita."""


def analyze(
    transcript: str,
    metrics: dict,
    duration_s: float,
    prep_for: str,
    audience_info: str,
    theme: str,
    question: str,
) -> dict:
    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        tools=[ANALYSIS_TOOL],
        tool_choice={"type": "tool", "name": "submit_analysis"},
        system=SYSTEM_PT,
        messages=[
            {
                "role": "user",
                "content": USER_PT_TPL.format(
                    prep_for=prep_for,
                    audience_info=audience_info,
                    theme=theme,
                    question=question,
                    duration=round(duration_s, 1),
                    word_count=metrics["word_count"],
                    wpm=metrics["wpm"],
                    filler_count=metrics["filler_count"],
                    top_filler=metrics["top_filler"] or "-",
                    pacing_variation=metrics["pacing_variation"],
                    transcript=transcript.strip(),
                ),
            }
        ],
    )
    tool_block = next(b for b in resp.content if b.type == "tool_use")
    out = dict(tool_block.input)
    for key in ("strengths", "weaknesses", "suggestions"):
        out[key] = _coerce_string_list(out.get(key))
    return out


def _coerce_string_list(value) -> list[str]:
    """Sonnet ocasionalmente devolve uma string única em vez de array, apesar do schema.
    Normaliza para list[str] para o cliente nunca rebentar com items.map."""
    if isinstance(value, list):
        return [str(v).strip() for v in value if v is not None and str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []
