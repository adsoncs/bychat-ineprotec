/** Templates pré-prontos para acelerar a criação de chatbots. */

export interface ChatbotTemplate {
  id: string
  name: string
  description: string
  category: 'vendas' | 'atendimento' | 'agendamento' | 'captacao' | 'educacional'
  emoji: string
  defaults: {
    name: string
    channel: string
    systemPrompt: string
    extractionPrompt: string
    analysisPrompt: string
    greetingMessage: string
    completionMessage: string
  }
}

export const CHATBOT_TEMPLATES: ChatbotTemplate[] = [
  {
    id: 'sales-saas',
    name: 'Vendas SaaS',
    description: 'Qualifica lead e agenda demo do produto.',
    category: 'vendas',
    emoji: '💼',
    defaults: {
      name: 'Vendas SaaS',
      channel: 'chat',
      systemPrompt: 'Você é um assistente de vendas do {{brand_name}}. Sua missão é qualificar o lead, entender a dor e agendar uma demonstração com o time comercial. Seja consultivo, não agressivo. Não invente preços nem prazos.',
      extractionPrompt: 'Extraia em JSON: { nome, empresa, cargo, tamanho_time, principal_dor, urgencia, melhor_horario_demo }.',
      analysisPrompt: 'Resuma a conversa em 2 frases destacando a dor principal e o nível de urgência (baixa/média/alta).',
      greetingMessage: 'Olá! 👋 Sou o assistente do {{brand_name}}. Em poucas perguntas posso entender se faz sentido você falar com nosso time. Posso começar?',
      completionMessage: 'Perfeito! Já encaminhei seu contato pro time comercial. Em até 1 dia útil alguém retorna pra agendar a demo.',
    },
  },
  {
    id: 'support',
    name: 'Atendimento ao cliente',
    description: 'Recebe dúvidas, classifica urgência, escala humano se necessário.',
    category: 'atendimento',
    emoji: '🎧',
    defaults: {
      name: 'Atendimento',
      channel: 'whatsapp',
      systemPrompt: 'Você é um atendente do {{brand_name}}. Seja gentil e direto. Antes de responder, identifique se a dúvida é (1) faturamento, (2) técnica ou (3) outra. Para faturamento, sempre transfira para humano.',
      extractionPrompt: 'Extraia em JSON: { tipo_duvida, urgencia (baixa/media/alta), produto_ou_servico, descricao_resumida, prefere_humano (true/false) }.',
      analysisPrompt: 'Resuma a conversa em uma frase indicando o tipo de dúvida e se exige escalada.',
      greetingMessage: 'Oi! 😊 Aqui é o assistente de atendimento do {{brand_name}}. Me conta como posso te ajudar hoje?',
      completionMessage: 'Anotado! Se precisar continuar, é só responder por aqui que retomamos o atendimento.',
    },
  },
  {
    id: 'scheduling',
    name: 'Agendamento',
    description: 'Coleta dados e horário preferido para reunião.',
    category: 'agendamento',
    emoji: '📅',
    defaults: {
      name: 'Agendamento',
      channel: 'chat',
      systemPrompt: 'Você ajuda visitantes a agendar reuniões com a equipe do {{brand_name}}. Pergunte nome, e-mail, motivo do contato e melhor janela (manhã/tarde) com 2 opções de data.',
      extractionPrompt: 'Extraia em JSON: { nome, email, motivo, data_preferida_1, data_preferida_2, periodo (manha/tarde) }.',
      analysisPrompt: 'Resuma o pedido em uma frase com nome e janela preferida.',
      greetingMessage: 'Oi! Vou te ajudar a agendar uma conversa rápida com a equipe. Para começar, qual o seu nome?',
      completionMessage: 'Show! Já registrei suas opções de horário. Você recebe a confirmação por e-mail em breve.',
    },
  },
  {
    id: 'lead-triage',
    name: 'Triagem / qualificação',
    description: 'Roteia leads de marketing por interesse e ICP.',
    category: 'vendas',
    emoji: '🔍',
    defaults: {
      name: 'Triagem de leads',
      channel: 'chat',
      systemPrompt: 'Você qualifica leads que vieram de campanhas. Verifique se a empresa do lead atende o ICP do {{brand_name}}: empresa com 10+ funcionários, segmento B2B, decisão em até 90 dias.',
      extractionPrompt: 'Extraia em JSON: { nome, empresa, segmento, tamanho_empresa, decisor (true/false), prazo_decisao_dias, dentro_do_icp (true/false) }.',
      analysisPrompt: 'Indique em 1 frase se o lead está dentro do ICP e por quê.',
      greetingMessage: 'Olá! Vi que você se interessou pelo {{brand_name}}. Posso fazer 4 perguntas rápidas pra te direcionar pra pessoa certa?',
      completionMessage: 'Perfeito! Direcionei seu contato para a pessoa mais adequada. Você terá retorno em breve.',
    },
  },
  {
    id: 'post-sale',
    name: 'Pós-venda / onboarding',
    description: 'Acompanha primeiro uso e coleta feedback inicial.',
    category: 'atendimento',
    emoji: '🚀',
    defaults: {
      name: 'Pós-venda',
      channel: 'whatsapp',
      systemPrompt: 'Você acompanha clientes nos primeiros 30 dias do {{brand_name}}. Pergunte se a configuração inicial foi feita, se há bloqueios técnicos e qual a percepção até aqui (NPS 0-10).',
      extractionPrompt: 'Extraia em JSON: { etapa_onboarding, blocker_atual, nps (0-10), comentario }.',
      analysisPrompt: 'Resuma o status do onboarding em 1 frase indicando se há blocker.',
      greetingMessage: 'Oi! 👋 Já faz alguns dias que você começou com o {{brand_name}}. Como tem sido até aqui?',
      completionMessage: 'Valeu pelo retorno! Qualquer coisa que travar, manda mensagem aqui que a gente desbloqueia rapidinho.',
    },
  },
  {
    id: 'faq',
    name: 'FAQ inteligente',
    description: 'Responde perguntas frequentes e escala humano para tópicos novos.',
    category: 'atendimento',
    emoji: '❓',
    defaults: {
      name: 'FAQ',
      channel: 'chat',
      systemPrompt: 'Responda dúvidas frequentes sobre o {{brand_name}}. Se a pergunta sair do escopo de FAQ, peça desculpa e ofereça transferir para humano. Nunca invente respostas.',
      extractionPrompt: 'Extraia em JSON: { pergunta, categoria_faq, foi_respondida (true/false), pediu_humano (true/false) }.',
      analysisPrompt: 'Resuma a interação em 1 frase: pergunta principal + se foi resolvida.',
      greetingMessage: 'Oi! Posso te responder em segundos sobre {{brand_name}}. Qual a sua dúvida?',
      completionMessage: 'Espero ter ajudado! Se precisar de algo mais aprofundado, é só dizer e eu chamo um humano.',
    },
  },
  {
    id: 'lead-magnet',
    name: 'Captação de lead (lead magnet)',
    description: 'Entrega material em troca de e-mail e qualifica.',
    category: 'captacao',
    emoji: '🧲',
    defaults: {
      name: 'Captação',
      channel: 'chat',
      systemPrompt: 'Você entrega o material gratuito do {{brand_name}} em troca de e-mail e empresa. Após entregar, faça 2 perguntas curtas pra entender o interesse.',
      extractionPrompt: 'Extraia em JSON: { nome, email, empresa, motivo_interesse, segmento }.',
      analysisPrompt: 'Resuma o lead em 1 linha (nome, empresa, motivo de interesse).',
      greetingMessage: 'Oi! Vi que você quer baixar o material gratuito do {{brand_name}}. Me passa seu e-mail e em qual empresa você está?',
      completionMessage: 'Pronto! Acabei de te enviar o material por e-mail. Boa leitura! 📚',
    },
  },
  {
    id: 'enrollment',
    name: 'Matrícula educacional',
    description: 'Coleta dados do candidato e direciona ao processo seletivo.',
    category: 'educacional',
    emoji: '🎓',
    defaults: {
      name: 'Matrícula',
      channel: 'whatsapp',
      systemPrompt: 'Você atende candidatos interessados em cursos do {{brand_name}}. Identifique nível desejado (graduação/pós/técnico), curso e modalidade (presencial/EAD/híbrido). Confirme se já fez ENEM se aplicável.',
      extractionPrompt: 'Extraia em JSON: { nome, email, telefone, nivel, curso_desejado, modalidade, fez_enem (true/false), nota_enem (se houver) }.',
      analysisPrompt: 'Resuma o candidato em 1 frase com nível, curso e modalidade pretendidos.',
      greetingMessage: 'Olá! 🎓 Sou o assistente de admissões do {{brand_name}}. Vou te ajudar com a matrícula. Para começar, qual o seu nome?',
      completionMessage: 'Perfeito! Seus dados foram enviados ao time acadêmico e você recebe os próximos passos por e-mail em até 1 dia útil.',
    },
  },
]
