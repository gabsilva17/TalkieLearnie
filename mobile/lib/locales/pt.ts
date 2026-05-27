// pt-PT translation dictionary. The canonical key set lives here — en.ts must
// mirror every key. Keys are dotted, grouped by screen / surface.
//
// Placeholders: {name} interpolation. Use `t("foo", { name: "x" })`.

export const pt = {
  // Generic UI / common actions
  common: {
    cancel: "Cancelar",
    cancel_caps: "CANCELAR",
    save_caps: "GUARDAR",
    saving_caps: "A GUARDAR…",
    continue_caps: "CONTINUAR",
    retry_caps: "TENTAR DE NOVO",
    back_caps: "VOLTAR",
    close: "Fechar",
    delete_caps: "APAGAR",
    error: "Erro",
    error_generic: "Algo correu mal.",
    yes: "Sim",
    no: "Não",
    dash: "-",
    day_label: "Dia {index}",
  },

  // Plans home (mobile/app/plans.tsx)
  plans: {
    title: "Planos",
    subtitle_one: "1 plano a treinar",
    subtitle_many: "{count} planos a treinar",
    subtitle_all_done: "Concluíste tudo. Cria um novo plano.",
    subtitle_first_time: "Cria o teu primeiro plano de treino.",
    empty_title_first: "Pronto para",
    empty_title_first_accent: "falar?",
    empty_title_after: "Tudo concluído",
    empty_body_first:
      "A IA monta-te um plano diário para te preparares para aquele momento em que as tuas skills de comunicação precisam de estar afiadas.",
    empty_body_after: "Cria um novo plano para continuar a treinar.",
    feature_1: "Plano personalizado",
    feature_2: "Treino por voz",
    feature_3: "Feedback instantâneo",
    new_plan_caps: "NOVO PLANO",
    archived_label: "Concluídos ({count})",
    target_done: "concluído",
    target_today: "hoje",
    target_tomorrow: "amanhã",
    target_in_days: "em {count} dias",
    eyebrow_archived: "Concluído",
    sheet_eyebrow_plan: "Plano",
    sheet_action_rename: "Mudar o nome",
    sheet_action_delete: "Apagar plano",
    delete_confirm_title: "Apagar plano?",
    delete_confirm_body:
      'Vais perder o histórico de "{name}". Esta acção é definitiva.',
    rename_eyebrow: "Mudar nome",
    rename_title: "Como queres chamar a este plano?",
    rename_placeholder: "Ex.: entrevista na Acme",
  },

  // Plan detail (mobile/app/plan/[planId]/index.tsx)
  plan_detail: {
    title: "Plano",
    subtitle_remaining_one: "1 dia para te preparares",
    subtitle_remaining_many: "{count} dias para te preparares",
    subtitle_done: "O teu plano diário",
    prep_eyebrow: "A preparar",
  },

  // Pending plan (mobile/app/plan/pending.tsx)
  plan_pending: {
    title: "Plano",
    subtitle_preparing: "A preparar o teu plano",
    subtitle_error: "Algo correu mal",
    error_title: "Não conseguimos preparar o plano",
    prep_eyebrow: "A preparar",
  },

  // Onboarding (mobile/app/onboarding.tsx)
  onboarding: {
    step_indicator: "Passo {step} de {total}",
    prompt_step_0: "Olá! Para que te queres preparar?",
    prompt_step_1: "Quando é o grande dia?",
    prompt_step_2: "E quem te vai estar a ouvir?",
    prompt_step_3: "Tens material para partilhar?",
    subtitle_step_0:
      "Pitch, entrevista, conversa difícil. Diz-nos em poucas palavras.",
    subtitle_step_2:
      "Quanto mais souberes sobre eles, melhor preparamos o plano.",
    subtitle_step_3:
      "Adiciona um deck, briefing ou notas para um plano mais afinado. (opcional)",
    placeholder_prep:
      "Ex.: pitch de hackathon, entrevista de emprego...",
    placeholder_audience:
      "Ex.: júri não técnico, investidor série A, manager directo...",
    placeholder_extra:
      "Ex.: notas do briefing, perguntas frequentes, números-chave...",
    placeholder_transcribing: "A transcrever…",
    cta_continue_caps: "CONTINUAR",
    cta_generate_caps: "GERAR O MEU PLANO",
    hint_generation_time: "A IA prepara as sessões em 10–20 segundos.",
    error_pdf_too_big: "O PDF é demasiado grande (máximo 32 MB).",
    error_no_speech:
      "Não consegui ouvir nada. Tenta de novo num sítio mais calmo.",
    voice_a11y_prep: "Manter premido para ditar a resposta",
    voice_hold_hint: "Solta para enviar",
    mic_permission_title: "Microfone",
    mic_permission_body:
      "Precisamos de permissão de microfone para ditar a resposta.",
    pdf_attach: "Anexar PDF",
    pdf_remove_a11y: "Remover PDF",
    calendar_selected: "Seleccionado:",
    focus_title: "Onde queres treinar mais?",
    focus_subtitle: "O plano vai dar mais peso a esta dimensão.",
    focus_communication: "Comunicação",
    focus_technical: "Técnico",
    focus_both: "Ambos",
  },

  // Session record screen (mobile/app/session/[dayId]/index.tsx)
  session: {
    not_found: "Sessão não encontrada.",
    unavailable: "Sessão indisponível",
    save_failed: "Gravação não foi guardada. Tenta de novo.",
    too_short_local:
      "A tua gravação foi demasiado curta. Precisamos de pelo menos 5 segundos para te darmos um feedback útil. Responde com um pouco mais de detalhe e tenta de novo.",
    mic_permission_title: "Microfone",
    mic_permission_body:
      "Precisamos de permissão de microfone para gravar.",
    intro_pill_day: "Dia {index}",
    intro_pill_retry: "Nova tentativa",
    intro_subtitle_today:
      "Treino de hoje. Respira fundo, vamos lá.",
    intro_subtitle_retry:
      "Aplica o feedback que recebeste e tenta de novo.",
    focus_tip_eyebrow: "Foco desta tentativa",
    cta_ready_caps: "PRONTO?",
    cta_finished_caps: "TERMINADO",
    cta_repeat_caps: "REPETIR",
    record_recording: "A gravar",
    record_preparing: "A preparar…",
    record_perm_warning:
      "Sem permissão de microfone. Activa nas Definições do telemóvel.",
    record_close_a11y: "Fechar gravação",
    too_short_title: "Vamos repetir.",

    // Celebration choreography
    boa_title: "Boa!",
    boa_subtitle: "Gravaste mais um treino.",
    rail_eyebrow: "Plano",
    rail_title: "Mais um dia feito.",
    rail_day: "Dia {index}",
    motivation_eyebrow: "Para ti",
    motivation_fallback: "Estás um passo mais perto.",
    motivation_fetch_fallback: "Estás um passo mais perto. Mais um treino feito.",
    transcript_eyebrow: "A tua resposta",
    transcript_title: "Pronto para o feedback?",
    transcript_hint: "Algo ficou mal transcrito? Toca no texto para corrigir.",
    transcript_caption: "Transcrição",
    transcript_a11y: "Transcrição editável",
    cta_see_feedback_caps: "VER FEEDBACK",
    thanks_title: "Obrigado pela correção!",
    thanks_body:
      "Vamos usar as tuas alterações para treinar o modelo e evitar este erro no futuro.",
    reformulating_title: "A reformular o feedback inicial",
    reformulating_body: "Estamos a aplicar as tuas correções à análise.",
  },

  // Result screen (mobile/app/session/[dayId]/result.tsx)
  result: {
    no_result: "Ainda não há resultado para este dia.",
    unavailable: "Resultado indisponível.",
    cta_back_to_plan_caps: "VOLTAR AO PLANO",
    cta_retry_better_caps: "REPETIR PARA MELHORAR",
    cta_see_all_caps: "VER TUDO",
    eyebrow_result: "Resultado",
    section_summary: "Resumo",
    section_strengths: "Pontos fortes",
    section_improve: "A melhorar",
    section_next_training: "Próximo treino",
    section_judging: "Avaliação",
    metric_velocity: "Velocidade",
    metric_filler_words: "Filler words",
    metric_variation: "Variação",
    metric_words_per_min: "palavras/min",
    metric_filler_word_unit: "filler words",
    metric_pace_unit: "ritmo",
    judge_audience_fit: "Adequação à audiência",
    judge_conciseness: "Concisão",
    judge_dispersion: "Foco",
    page_subtitle_strengths: "O que correu mesmo bem hoje.",
    page_subtitle_improve: "Onde focar na próxima tentativa.",
    page_subtitle_next: "Leva isto para a próxima sessão.",
    transcript_eyebrow: "Transcrição",
    transcript_meta: "{duration} · {wpm} WPM",
    filler_heading: "Filler words ({count}) · toca para ouvir",
    play_a11y: "Reproduzir",
    pause_a11y: "Pausar",
    close_a11y: "Fechar",
    motivation_high: "Excelente. Continua assim.",
    motivation_mid: "Bom progresso. Estás no caminho certo.",
    motivation_low: "Vamos treinar mais. Cada tentativa conta.",
    wpm_band_very_slow: "Muito lento",
    wpm_band_slow: "Lento",
    wpm_band_ideal: "Ideal",
    wpm_band_fast: "Rápido",
    wpm_band_too_fast: "Atropelado",
    filler_band_perfect: "Perfeito",
    filler_band_ok: "Aceitável",
    filler_band_reduce: "A reduzir",
    pace_band_monotone: "Monotónico",
    pace_band_healthy: "Saudável",
    pace_band_erratic: "Errático",
  },

  // Profile (mobile/components/screens/ProfileOverlay.tsx)
  profile: {
    greeting_hello: "Olá, ",
    section_streak: "Dias consecutivos",
    section_last_7_days: "Últimos 7 dias",
    section_stats: "Estatísticas",
    section_wpm_trend: "Ritmo de fala (WPM)",
    section_achievements: "Conquistas",
    section_language: "Idioma / Language",
    link_see_all: "Ver tudo",
    link_see_more: "Ver mais",
    streak_record_label: "Recorde",
    stat_sessions: "Sessões",
    stat_minutes: "Minutos",
    stat_avg_wpm: "WPM médio",
    stat_best_rating: "Melhor nota",
    chart_min: "mín",
    chart_max: "máx",
    filler_inline:
      'Filler word mais comum: "{word}"',
    achievements_summary_one: "conquista desbloqueada",
    achievements_summary_many: "conquistas desbloqueadas",
    achievements_modal_title: "Conquistas",
    achievements_modal_subtitle: "{earned} de {total} desbloqueadas",
    activity_modal_title: "Atividade · 12 meses",
    activity_modal_subtitle_one: "1 dia ativo no total",
    activity_modal_subtitle_many: "{count} dias ativos no total",
    activity_calendar_footnote_one: "1 dia ativo neste mês",
    activity_calendar_footnote_many: "{count} dias ativos neste mês",
    heatmap_legend_less: "menos",
    heatmap_legend_more: "mais",
    name_modal_title: "Como te chamas?",
    name_modal_placeholder: "O teu nome",
  },

  // Ask overlay (mobile/components/screens/AskOverlay.tsx)
  ask: {
    title: "Perguntar",
    new_conversation_a11y: "Nova conversa",
    context_label: "Contexto",
    context_a11y_switch: "Contexto: {plan}. Toca para trocar de plano.",
    context_a11y_only: "Contexto: {plan}",
    suggestions_1: "Como começo um pitch forte?",
    suggestions_2: "Dicas para controlar os nervos.",
    welcome_title: "Em que te posso ajudar?",
    composer_placeholder: "Escreve ou dita a tua pergunta…",
    composer_transcribing: "A transcrever…",
    composer_mic_a11y: "Manter premido para ditar a pergunta",
    composer_send_a11y: "Enviar pergunta",
    composer_hold_hint: "Solta para enviar",
    mic_permission_title: "Microfone",
    mic_permission_body:
      "Precisamos de permissão de microfone para ditar a pergunta.",
    error_no_speech:
      "Não consegui ouvir nada. Tenta de novo num sítio mais calmo.",
    picker_eyebrow: "Contexto",
    picker_title: "Sobre que plano queres falar?",
  },

  // Bottom navigation
  bottom_nav: {
    plans: "Planos",
    ask: "Perguntar",
    profile: "Perfil",
  },

  // Overlays
  achievement_overlay: {
    eyebrow: "Conquista desbloqueada",
  },
  plan_completed_overlay: {
    eyebrow: "Conquistaste",
    headline: "Plano completo!",
    days_one: "1 dia treinado",
    days_many: "{count} dias treinados",
    cta_close_caps: "FECHAR",
  },
  streak_overlay: {
    eyebrow: "Streak ativado",
    headline: "Estás em chamas!",
    unit_one: "dia seguidos",
    unit_many: "dias seguidos",
    new_best: "Novo recorde pessoal",
  },

  // Motivational arrays (hash-picked at the call site)
  motivations: {
    achievement: [
      "Mais um passo. Continua a treinar.",
      "Isso é trabalho consistente. Não pares.",
      "A prática diária está a dar frutos.",
      "Estás a construir um hábito. Mantém o ritmo.",
      "Vai com tudo para a próxima sessão.",
      "Pequenas vitórias, grande caminho.",
      "Estás cada vez mais à vontade. Continua.",
    ],
    plan_completed: [
      "Terminaste o plano. Agora és outro orador.",
      "Cada dia treinado conta. E tu treinaste todos.",
      "Plano fechado. Tens isto na ponta da língua.",
      "Acabaste o que começaste. Isso é raro.",
      "A consistência venceu. Bom trabalho.",
      "Estás pronto. Foi isto que vieste treinar.",
      "Um plano inteiro, do início ao fim. Respeita esse esforço.",
    ],
    streak: [
      "Mais um dia em chamas. Continua.",
      "Aceitaste o desafio de hoje. Bom trabalho.",
      "O hábito está a pegar. Não pares agora.",
      "Cada dia conta. E este, ficou no bolso.",
      "Treino consistente, resultados garantidos.",
      "Dia somado. Estás a construir algo.",
      "Mantém a chama acesa. Amanhã também.",
    ],
  },

  a11y: {
    back: "Voltar",
    close: "Fechar",
  },
} as const;

export type Dict = typeof pt;
