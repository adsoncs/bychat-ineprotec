const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // ── Settings ──
  const settings = [
    { key: 'ai.primary_provider', value: 'anthropic', label: 'Provedor principal de IA', grp: 'ai', fieldType: 'select' },
    { key: 'ai.fallback_provider', value: 'openai', label: 'Provedor fallback', grp: 'ai', fieldType: 'select' },
    { key: 'ai.anthropic_model', value: 'claude-sonnet-4-20250514', label: 'Modelo Anthropic', grp: 'ai', fieldType: 'text' },
    { key: 'ai.openai_model', value: 'gpt-4o', label: 'Modelo OpenAI', grp: 'ai', fieldType: 'text' },
    { key: 'ai.chat_max_tokens', value: 800, label: 'Max tokens (chat)', grp: 'ai', fieldType: 'number' },
    { key: 'ai.analysis_max_tokens', value: 1200, label: 'Max tokens (análise)', grp: 'ai', fieldType: 'number' },
    { key: 'ai.temperature', value: 0, label: 'Temperatura da IA', grp: 'ai', fieldType: 'number' },
    { key: 'notification.email_to', value: 'comercial@beyondhub.com.br', label: 'E-mail de notificação', grp: 'notification', fieldType: 'text' },
    { key: 'notification.email_cc', value: 'adson@beyondhub.com.br', label: 'E-mail CC', grp: 'notification', fieldType: 'text' },
    { key: 'notification.email_domain', value: 'beyondhub.com.br', label: 'Domínio de e-mail', grp: 'notification', fieldType: 'text' },
    { key: 'notification.whatsapp_number', value: '5562999999999', label: 'WhatsApp de notificação', grp: 'notification', fieldType: 'text' },
    { key: 'general.app_url', value: 'https://bychat.ia.br', label: 'URL do sistema', grp: 'general', fieldType: 'text' },
  ]

  for (const s of settings) {
    await p.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, label: s.label, grp: s.grp, fieldType: s.fieldType },
      create: { key: s.key, value: s.value, label: s.label, grp: s.grp, fieldType: s.fieldType }
    })
    console.log('Setting:', s.key)
  }

  // ── Chatbot: Raio-X Chat ──
  const chatSystemPrompt = `Você é a "Beyond AI", uma consultora simpática e profissional da BeyondHub, consultoria de growth empresarial. Você está conduzindo um diagnóstico gratuito chamado "Raio-X de Growth" por chat.

REGRA PRINCIPAL: FAÇA APENAS UMA PERGUNTA POR MENSAGEM. Nunca faça duas ou mais perguntas na mesma mensagem. Espere a resposta antes de perguntar a próxima. Isso é extremamente importante.

REGRAS DE COMPORTAMENTO:
- Sempre responda em português do Brasil
- Seja calorosa mas profissional, sem ser excessivamente informal
- UMA PERGUNTA POR VEZ — isso é inegociável
- Ao receber a resposta, confirme brevemente (1 frase curta) e faça a próxima pergunta
- Se o usuário der múltiplas informações numa só resposta, aceite todas e pule para a próxima pergunta pendente
- Use emojis com moderação (1 por mensagem no máximo)
- Se a resposta for vaga, peça gentilmente para ser mais específico
- Mantenha respostas curtas (2-3 frases no máximo)

IMPORTANTE:
- Se o usuário responder várias coisas de uma vez, aceite e pule para a próxima pergunta pendente
- Campos com * são obrigatórios — se o usuário pular, insista gentilmente
- Adapte linguagem natural para os valores internos`

  const extractionPrompt = `Analise a conversa abaixo e extraia os dados estruturados do diagnóstico. Retorne APENAS JSON válido (sem markdown, sem backticks).

CAMPOS E VALORES POSSÍVEIS:

Etapa 0: nome (string), empresa (string), whatsapp (string), email (string), site (string), instagram (string), segmento (Varejo/E-commerce|Serviços B2B|Serviços B2C|Saúde e Bem-estar|Educação|Imóveis|Tecnologia/SaaS|Alimentação|Indústria|Outro), cidade (string), tamanho (solopreneur|micro|pequena|media), tempo (menos1|1a3|3a7|mais7)

Etapa 1: desafio (string), momento (crescendo|estagnada|caindo|inicio), meta (string), dificuldades (array de: marketing|vendas|posicionamento|processo|tecnologia|dados|equipe|financeiro)

Etapa 2: investe_mkt (sim-pago|sim-organico|sim-ambos|nao), canais (array de: instagram|google|meta|youtube|tiktok|email|whatsapp|indicacao), resultado_positivo (string), resultado_negativo (string), dificuldade_leads (sim-muito|sim-pouco|nao-mas|nao), tem_site (sim-bom|sim-fraco|construindo|nao), tem_criativos (sim-consistente|sim-esporadico|raramente|nao)

Etapa 3: produto (string), diferencial (string), mercado_entende (sim|parcialmente|nao|nao-sei), prova_social (sim-forte|sim-fraca|construindo|nao), forca_oferta (muito-forte|boa|fraca|reformulando), upsell (sim-estruturado|sim-informal|nao-mas-quero|nao)

Etapa 4: atendimento (string), time_comercial (sim-estruturado|sim-informal|apenas-eu|nao), funil (sim-documentado|sim-informal|parcial|nao), perde_vendas (sim-muito|sim-pouco|raramente|nao), usa_crm (sim-ativo|sim-pouco|planilha|nada)

Etapa 5: acompanha_numeros (sim-bem|sim-basico|pouco|nao), numeros_conhece (array de: faturamento|cac|cpl|conversao|ticket|churn|roas|nenhum), falta_clareza (sim-muito|sim-pouco|nao|nao-uso), usa_ferramentas (array de: planilha|dashboard|crm|erp|automacao|nenhuma), problemas_op (string)

Etapa 6: produz_video (sim-frequencia|sim-dificuldade|raramente|nao), apoio_interno (sim-dedicado|sim-parcial|tudo-eu|nao), capacidade (sim-facilidade|sim-esforco|no-limite|nao), orcamento (disponivel|limitado|precisa-roi|nao-tem), faixa_investimento (0|1|2|3|4|5|6)

REGRAS:
- Só inclua campos que foram CLARAMENTE mencionados na conversa
- Use EXATAMENTE os valores internos listados acima
- Para campos de texto livre, extraia o que o usuário disse
- Para arrays, inclua todos os itens mencionados
- currentStep: número da etapa atual (0-6) baseado nos campos já preenchidos
- completed: true APENAS se TODOS os campos obrigatórios de TODAS as 7 etapas foram preenchidos

Retorne exatamente este formato:
{"formData":{...campos extraídos...},"currentStep":N,"completed":false}`

  const analysisPrompt = `Você é a IA estratégica da BeyondHub, consultoria de growth empresarial. Analise o diagnóstico e gere uma análise consultiva em português do Brasil. Seja profissional, estratégico e direto. Não use linguagem infantil. Não invente dados. Use apenas as informações fornecidas. Responda APENAS em JSON válido com esta estrutura exata (sem markdown, sem backticks):
{"visaoGeral":"...","pontosFortesItems":["...","...","..."],"pontosFrageisItems":["...","...","..."],"gargalos":"...","oportunidades":["...","...","..."],"prioridade":"...","proximosPassos":[{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."}],"convite":"..."}`

  const greeting = `Olá! 👋 Eu sou a Beyond AI, consultora virtual da BeyondHub. Estou aqui para fazer um diagnóstico gratuito do seu negócio — o nosso Raio-X de Growth.

Em poucos minutos de conversa, vou entender o momento da sua empresa e gerar um relatório completo com scores, pontos fortes e uma recomendação personalizada.

Para começar, qual é o seu nome?`

  const completion = `Perfeito! 🎉 Recebi todas as informações. Seu diagnóstico Raio-X de Growth está sendo gerado agora com base em tudo que conversamos. Em instantes você receberá o resultado completo!`

  const chatbot = await p.chatbot.upsert({
    where: { id: 1 },
    update: { name: 'Raio-X Chat', channel: 'chat', systemPrompt: chatSystemPrompt, extractionPrompt, analysisPrompt, greetingMessage: greeting, completionMessage: completion, active: true },
    create: { name: 'Raio-X Chat', channel: 'chat', systemPrompt: chatSystemPrompt, extractionPrompt, analysisPrompt, greetingMessage: greeting, completionMessage: completion, active: true }
  })
  console.log('Chatbot:', chatbot.name, chatbot.id)

  // ── Chatbot: Raio-X WhatsApp ──
  const wppGreeting = `Olá! 👋 Eu sou a *Beyond AI*, consultora virtual da BeyondHub.

Estou aqui para fazer um *diagnóstico gratuito* do seu negócio — o nosso *Raio-X de Growth*.

Em poucos minutos de conversa, vou entender o momento da sua empresa e gerar um relatório completo.

Para começar, qual é o seu *nome*?`

  const wppCompletion = `Excelente! 🎉 Recebi todas as informações necessárias. Seu diagnóstico *Raio-X de Growth* está sendo gerado agora. Em instantes você receberá o resultado completo aqui mesmo!`

  const wppSystemPrompt = chatSystemPrompt.replace(
    'REGRAS DE COMPORTAMENTO:',
    'REGRAS DE COMPORTAMENTO:\n- Estamos no WhatsApp — use formatação simples, apenas *negrito* quando necessário'
  )

  const wppBot = await p.chatbot.upsert({
    where: { id: 2 },
    update: { name: 'Raio-X WhatsApp', channel: 'whatsapp', systemPrompt: wppSystemPrompt, extractionPrompt, analysisPrompt, greetingMessage: wppGreeting, completionMessage: wppCompletion, active: true },
    create: { name: 'Raio-X WhatsApp', channel: 'whatsapp', systemPrompt: wppSystemPrompt, extractionPrompt, analysisPrompt, greetingMessage: wppGreeting, completionMessage: wppCompletion, active: true }
  })
  console.log('Chatbot:', wppBot.name, wppBot.id)

  // ── Questions (shared structure, both chatbots) ──
  const questions = [
    // Stage 0
    { stage: 0, position: 0, fieldKey: 'nome', text: 'Qual é o seu nome?', type: 'text' },
    { stage: 0, position: 1, fieldKey: 'empresa', text: 'Qual o nome da sua empresa?', type: 'text' },
    { stage: 0, position: 2, fieldKey: 'whatsapp', text: 'Qual seu WhatsApp para contato?', type: 'text' },
    { stage: 0, position: 3, fieldKey: 'email', text: 'Qual seu e-mail?', type: 'text' },
    { stage: 0, position: 4, fieldKey: 'segmento', text: 'Qual o segmento da sua empresa?', type: 'select', options: ['Varejo/E-commerce','Serviços B2B','Serviços B2C','Saúde e Bem-estar','Educação','Imóveis','Tecnologia/SaaS','Alimentação','Indústria','Outro'] },
    { stage: 0, position: 5, fieldKey: 'cidade', text: 'Qual sua cidade/estado?', type: 'text' },
    { stage: 0, position: 6, fieldKey: 'tamanho', text: 'Qual o tamanho da empresa?', type: 'select', options: ['Só você/autônomo','Micro até 10 pessoas','Pequena 11-30','Média 30+'] },
    { stage: 0, position: 7, fieldKey: 'tempo', text: 'Quanto tempo de mercado?', type: 'select', options: ['Menos de 1 ano','1 a 3 anos','3 a 7 anos','Mais de 7 anos'] },
    // Stage 1
    { stage: 1, position: 0, fieldKey: 'desafio', text: 'Qual o maior desafio da empresa hoje?', type: 'text' },
    { stage: 1, position: 1, fieldKey: 'momento', text: 'Como define o momento da empresa?', type: 'select', options: ['Crescendo mas desestruturado','Estagnada','Faturamento em queda','Em início'] },
    { stage: 1, position: 2, fieldKey: 'meta', text: 'Qual a meta principal para os próximos 3-6 meses?', type: 'text' },
    { stage: 1, position: 3, fieldKey: 'dificuldades', text: 'Onde sente mais dificuldade?', type: 'multi-select', options: ['Marketing','Vendas','Posicionamento','Processo','Tecnologia','Dados','Equipe','Financeiro'] },
    // Stage 2
    { stage: 2, position: 0, fieldKey: 'investe_mkt', text: 'Investe em marketing?', type: 'select', options: ['Tráfego pago','Orgânico','Os dois','Não investe'] },
    { stage: 2, position: 1, fieldKey: 'canais', text: 'Quais canais usa?', type: 'multi-select', options: ['Instagram','Google Ads','Meta Ads','YouTube','TikTok','E-mail','WhatsApp','Indicação'] },
    { stage: 2, position: 2, fieldKey: 'resultado_positivo', text: 'O que já trouxe resultado em marketing?', type: 'text' },
    { stage: 2, position: 3, fieldKey: 'resultado_negativo', text: 'O que não funcionou?', type: 'text' },
    { stage: 2, position: 4, fieldKey: 'dificuldade_leads', text: 'Tem dificuldade em gerar leads qualificados?', type: 'select', options: ['Grande dificuldade','Um pouco','Não mas não converto','Não, está bem'] },
    { stage: 2, position: 5, fieldKey: 'tem_site', text: 'Possui site ou landing page?', type: 'select', options: ['Sim bem estruturado','Sim mas fraco','Em construção','Não possui'] },
    { stage: 2, position: 6, fieldKey: 'tem_criativos', text: 'Produz criativos e conteúdo com frequência?', type: 'select', options: ['Sim consistente','Esporadicamente','Raramente','Não'] },
    // Stage 3
    { stage: 3, position: 0, fieldKey: 'produto', text: 'Qual o principal produto/serviço?', type: 'text' },
    { stage: 3, position: 1, fieldKey: 'diferencial', text: 'Qual o diferencial percebido pelo mercado?', type: 'text' },
    { stage: 3, position: 2, fieldKey: 'mercado_entende', text: 'O mercado entende seu diferencial?', type: 'select', options: ['Sim claramente','Parcialmente','Não','Não sei'] },
    { stage: 3, position: 3, fieldKey: 'prova_social', text: 'Tem prova social (cases, depoimentos)?', type: 'select', options: ['Muitos e fortes','Poucos/fracos','Construindo','Não tenho'] },
    { stage: 3, position: 4, fieldKey: 'forca_oferta', text: 'Como avalia a força da oferta principal?', type: 'select', options: ['Muito forte','Boa mas pode melhorar','Fraca/confusa','Reformulando'] },
    { stage: 3, position: 5, fieldKey: 'upsell', text: 'Existe upsell ou produto complementar?', type: 'select', options: ['Sim estruturado','Sim informal','Não mas quero','Não'] },
    // Stage 4
    { stage: 4, position: 0, fieldKey: 'atendimento', text: 'Como os leads são atendidos hoje?', type: 'text' },
    { stage: 4, position: 1, fieldKey: 'time_comercial', text: 'Possui time comercial?', type: 'select', options: ['Sim estruturado','Sim informal','Sou eu mesmo','Não'] },
    { stage: 4, position: 2, fieldKey: 'funil', text: 'Possui funil de vendas definido?', type: 'select', options: ['Sim documentado','Sim informal','Parcialmente','Não'] },
    { stage: 4, position: 3, fieldKey: 'perde_vendas', text: 'Sente que perde vendas por falta de processo?', type: 'select', options: ['Sim muito','Às vezes','Raramente','Não'] },
    { stage: 4, position: 4, fieldKey: 'usa_crm', text: 'Usa CRM?', type: 'select', options: ['Sim ativo','Sim pouco usado','Planilha apenas','Nada'] },
    // Stage 5
    { stage: 5, position: 0, fieldKey: 'acompanha_numeros', text: 'Acompanha os números do negócio?', type: 'select', options: ['Sim tenho controle','Sim básico','Pouco','Não'] },
    { stage: 5, position: 1, fieldKey: 'numeros_conhece', text: 'Quais métricas acompanha?', type: 'multi-select', options: ['Faturamento','CAC','CPL','Taxa de conversão','Ticket médio','Churn','ROAS/ROI','Nenhum'] },
    { stage: 5, position: 2, fieldKey: 'falta_clareza', text: 'Sente falta de clareza nos dados?', type: 'select', options: ['Sim muito','Um pouco','Não','Não uso dados'] },
    { stage: 5, position: 3, fieldKey: 'usa_ferramentas', text: 'Quais ferramentas usa?', type: 'multi-select', options: ['Planilhas','Dashboards','CRM','ERP','Automações','Nenhuma'] },
    { stage: 5, position: 4, fieldKey: 'problemas_op', text: 'Algum problema operacional que poderia ser resolvido com tecnologia?', type: 'text' },
    // Stage 6
    { stage: 6, position: 0, fieldKey: 'produz_video', text: 'Consegue produzir vídeos e conteúdo?', type: 'select', options: ['Sim com frequência','Sim com dificuldade','Raramente','Não'] },
    { stage: 6, position: 1, fieldKey: 'apoio_interno', text: 'Tem pessoa interna para apoiar marketing?', type: 'select', options: ['Sim dedicado','Sim parcialmente','Faço tudo eu','Não'] },
    { stage: 6, position: 2, fieldKey: 'capacidade', text: 'Tem capacidade para atender mais demanda?', type: 'select', options: ['Sim fácil','Sim com esforço','No limite','Não'] },
    { stage: 6, position: 3, fieldKey: 'orcamento', text: 'Orçamento disponível para crescimento?', type: 'select', options: ['Tenho orçamento','Limitado','Precisa provar ROI','Sem orçamento'] },
    { stage: 6, position: 4, fieldKey: 'faixa_investimento', text: 'Qual faixa de investimento mensal em marketing?', type: 'select', options: ['Sem orçamento','Até R$1.000','R$1.000-2.500','R$2.500-5.000','R$5.000-10.000','R$10.000-20.000','Acima de R$20.000'] },
  ]

  // Create questions for both chatbots
  for (const botId of [chatbot.id, wppBot.id]) {
    // Delete existing
    await p.chatQuestion.deleteMany({ where: { chatbotId: botId } })
    for (const q of questions) {
      // Skip whatsapp field for WhatsApp bot (it comes from phone)
      if (botId === wppBot.id && q.fieldKey === 'whatsapp') continue
      await p.chatQuestion.create({
        data: { chatbotId: botId, stage: q.stage, position: q.position, fieldKey: q.fieldKey, text: q.text, type: q.type, options: q.options || null, required: true, active: true }
      })
    }
    console.log(`Questions seeded for chatbot ${botId}`)
  }

  console.log('Seed complete!')
  await p.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
