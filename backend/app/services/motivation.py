import anthropic

from ..config import get_settings

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 80

SYSTEM = """És um coach de comunicação que escreve UMA frase curta para celebrar o utilizador acabar de gravar mais um treino de comunicação oral.

REGRAS DE LÍNGUA:
- Responde SEMPRE em PORTUGUÊS EUROPEU (pt-PT).
- Trata o utilizador por "tu". Nunca uses "você", gerúndios brasileiros ("estou falando", "está fazendo"), nem outras formas brasileiras.
- NUNCA uses travessões (—). Substitui por pontos finais, vírgulas, dois-pontos ou parênteses.

REGRAS DE ESTILO:
- UMA frase, no máximo 14 palavras.
- Tom Duolingo: energético, próximo, mas sem ser piroso.
- Refere o objectivo do utilizador de forma natural (não copies o "prep_for" literalmente, reformula em segunda pessoa).
- Não comeces com "Boa", "Boa!", "Força", "Vamos" nem com saudações.
- Sem aspas, sem prefixos, sem emojis.
- No máximo um "!" no final.

EXEMPLOS DO TOM (não copies, inspira-te):
- "Estás um passo mais perto de esmagar essa entrevista para a Microsoft."
- "Mais um treino. A tua próxima reunião com investidores vai notar a diferença."
- "Acabaste de aproximar-te do palco que te espera."
- "Esta conversa difícil começa a parecer cada vez menos difícil."
"""

USER_TPL = """Acabei de treinar uma resposta oral. Estou a preparar-me para: "{prep_for}".

Escreve UMA frase pt-PT motivacional, em segunda pessoa do singular, a celebrar este treino e a ligar ao objectivo. Devolve SÓ a frase, sem aspas nem prefixos."""


FALLBACK = "Estás um passo mais perto. Mais um treino feito."


def motivate(prep_for: str) -> str:
    """One-line pt-PT motivational sentence tied to prep_for. Falls back on errors."""
    try:
        client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            messages=[{"role": "user", "content": USER_TPL.format(prep_for=prep_for or "uma situação importante")}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
    except Exception:
        return FALLBACK

    # Defensive cleanup: drop wrapping quotes, em-dashes, line breaks.
    text = text.strip().strip('"').strip("'").replace("—", ",").replace("\n", " ").strip()
    if not text:
        return FALLBACK
    # Hard cap. The prompt asks for one sentence but the model occasionally
    # appends a second; keep only the first sentence.
    for terminator in ("!", "."):
        idx = text.find(terminator)
        if 0 < idx < len(text) - 1:
            text = text[: idx + 1]
            break
    return text
