from typing import Literal

import anthropic

from ..config import get_settings

Language = Literal["pt", "en"]

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 80

SYSTEM_PT = """És um coach de comunicação que escreve UMA frase curta para celebrar o utilizador acabar de gravar mais um treino de comunicação oral.

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

SYSTEM_EN = """You are a communication coach writing ONE short sentence to celebrate the user finishing another spoken-communication training session.

LANGUAGE RULES:
- Always reply in English, second person ("you", "your").
- NEVER use em dashes (—). Use periods, commas, colons, or parentheses instead.

STYLE RULES:
- ONE sentence, at most 14 words.
- Duolingo tone: energetic, close, but not corny.
- Reference the user's goal naturally (don't copy "prep_for" literally, reframe it in second person).
- Don't start with "Nice", "Great", "Let's", or a greeting.
- No quotes, no prefixes, no emojis.
- At most one "!" at the end.

TONE EXAMPLES (don't copy, take inspiration):
- "You're one step closer to crushing that Microsoft interview."
- "Another rep. Your next investor meeting will feel the difference."
- "You just inched closer to the stage waiting for you."
- "This hard conversation is starting to feel a lot less hard."
"""

USER_TPL_PT = """Acabei de treinar uma resposta oral. Estou a preparar-me para: "{prep_for}".

Escreve UMA frase pt-PT motivacional, em segunda pessoa do singular, a celebrar este treino e a ligar ao objectivo. Devolve SÓ a frase, sem aspas nem prefixos."""

USER_TPL_EN = """I just trained a spoken answer. I'm preparing for: "{prep_for}".

Write ONE English motivational sentence, in the second person, celebrating this training and tying it to my goal. Return ONLY the sentence, no quotes or prefixes."""


FALLBACK_PT = "Estás um passo mais perto. Mais um treino feito."
FALLBACK_EN = "You're one step closer. Another rep in the books."


def motivate(prep_for: str, lang: Language = "pt") -> str:
    """One-line motivational sentence tied to prep_for. Falls back on errors."""
    fallback = FALLBACK_EN if lang == "en" else FALLBACK_PT
    system = SYSTEM_EN if lang == "en" else SYSTEM_PT
    user_tpl = USER_TPL_EN if lang == "en" else USER_TPL_PT
    default_prep = "an important moment" if lang == "en" else "uma situação importante"
    try:
        client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[
                {
                    "role": "user",
                    "content": user_tpl.format(prep_for=prep_for or default_prep),
                }
            ],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
    except Exception:
        return fallback

    # Defensive cleanup: drop wrapping quotes, em-dashes, line breaks.
    text = text.strip().strip('"').strip("'").replace("—", ",").replace("\n", " ").strip()
    if not text:
        return fallback
    # Hard cap. The prompt asks for one sentence but the model occasionally
    # appends a second; keep only the first sentence.
    for terminator in ("!", "."):
        idx = text.find(terminator)
        if 0 < idx < len(text) - 1:
            text = text[: idx + 1]
            break
    return text
