from typing import Literal

import anthropic

from ..config import get_settings

Language = Literal["pt", "en"]

MODEL = "claude-sonnet-4-6"


def _analysis_tool(lang: Language) -> dict:
    desc = (
        "Submit the structured analysis of the user's spoken answer."
        if lang == "en"
        else "Submete a análise estruturada da resposta falada do utilizador."
    )
    return {
        "name": "submit_analysis",
        "description": desc,
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
NUNCA uses o termo "CoV" (nem "coeficiente de variação", nem a sigla) em nenhuma string que devolvas. Diz apenas "variação de ritmo" quando precisares de te referir a esse indicador.
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
Variação de ritmo: <0.15 monotónico, 0.15-0.35 saudável, >0.35 errático.

Strengths/weaknesses/suggestions DEVEM ser específicos à transcrição: cita expressões do utilizador.
Suggestions são accionáveis (o que fazer no próximo treino), não vagas."""

SYSTEM_EN = """You are a communication coach. You evaluate spoken answers in English.
NEVER use em dashes (—) in any string you return. Use periods, commas, colons, or parentheses.
NEVER use the term "CoV" (or "coefficient of variation") in any string you return. Just say "pacing variation" when you need to refer to that metric.
All your output is in plain English, in a direct, encouraging, specific tone, never generic.
ALWAYS return the analysis via the submit_analysis tool, never as free text.

Rating rubric (1-10), apply it consistently:
- 9-10: WPM 130-160, fewer than 1 filler / 30s, pacing variation 0.15-0.35, clear structure (intro+body+conclusion), language tuned to the audience, no rambling.
- 7-8: 1 or 2 of the above slightly off.
- 5-6: scattered answers OR more than 3 fillers / 30s OR WPM < 100 or > 180 OR language mismatched to the audience.
- 3-4: two or more serious problems at once.
- 1-2: incomprehensible, structureless, or off-topic.

WPM bands: 90-120 slow, 120-160 ideal, 160-200 fast, >200 rushed.
Filler density: > 5/min is high.
Pacing variation: <0.15 monotone, 0.15-0.35 healthy, >0.35 erratic.

Strengths/weaknesses/suggestions MUST be specific to the transcript: quote the user's own expressions.
Suggestions are actionable (what to do in the next training session), not vague."""

USER_PT_TPL = """Contexto:
- Preparação para: {prep_for}
- Audiência: {audience_info}
- Tema do dia: {theme}
- Pergunta colocada: {question}

Métricas da resposta:
- Duração: {duration}s ({word_count} palavras)
- WPM: {wpm}
- Fillers totais: {filler_count} (mais usado: "{top_filler}")
- Variação de ritmo: {pacing_variation}

Transcrição literal:
\"\"\"
{transcript}
\"\"\"

Avalia esta resposta usando a tool submit_analysis. O campo `dispersion` indica se o utilizador divagou (e em quê); `conciseness` se foi sucinto ou prolixo; `audience_fit` se o registo, a linguagem técnica e os exemplos encaixam na audiência descrita."""

USER_EN_TPL = """Context:
- Preparing for: {prep_for}
- Audience: {audience_info}
- Day's theme: {theme}
- Question asked: {question}

Answer metrics:
- Duration: {duration}s ({word_count} words)
- WPM: {wpm}
- Total fillers: {filler_count} (most used: "{top_filler}")
- Pacing variation: {pacing_variation}

Literal transcript:
\"\"\"
{transcript}
\"\"\"

Evaluate this answer using the submit_analysis tool. The `dispersion` field captures whether the user rambled (and on what); `conciseness` whether they were succinct or verbose; `audience_fit` whether the register, technical language, and examples match the described audience."""


def analyze(
    transcript: str,
    metrics: dict,
    duration_s: float,
    prep_for: str,
    audience_info: str,
    theme: str,
    question: str,
    lang: Language = "pt",
) -> dict:
    system = SYSTEM_EN if lang == "en" else SYSTEM_PT
    user_tpl = USER_EN_TPL if lang == "en" else USER_PT_TPL
    client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
    resp = client.messages.create(
        model=MODEL,
        max_tokens=1500,
        tools=[_analysis_tool(lang)],
        tool_choice={"type": "tool", "name": "submit_analysis"},
        system=system,
        messages=[
            {
                "role": "user",
                "content": user_tpl.format(
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
    """Sonnet occasionally returns a single string instead of an array, despite
    the schema. Normalize to list[str] so the client never breaks on items.map."""
    if isinstance(value, list):
        return [str(v).strip() for v in value if v is not None and str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []
