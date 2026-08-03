// scripts/status_summary_seed_comercial.ts
// Semeia o catálogo COMERCIAL do módulo Resumo a partir do processo do cliente
// (funil de captação → matrícula). Idempotente: rode quantas vezes quiser, faz
// upsert por código e re-liga as atividades de cada resumo.
//
//   npx tsx scripts/status_summary_seed_comercial.ts
//   npx tsx scripts/status_summary_seed_comercial.ts --funnel="Comercial · Matrícula EAD"
//
// ESCOPO: só atendimento/comercial. A jornada de secretaria (documentos, AVA,
// SISTEC, estágio, diploma, taxa de correios) NÃO entra aqui — depende do ERP
// acadêmico e de integração com LMS, que estão fora desta fase.

import { prisma } from '../src/lib/prisma.js'

const FUNNEL_NAME =
  process.argv.find((a) => a.startsWith('--funnel='))?.split('=')[1] ?? 'Comercial · Matrícula EAD'

// ─── Etapas do funil ──────────────────────────────────────
// slaHours vem do "Tipo: Transição (N dias)" declarado no processo; null = etapa
// de permanência indefinida.
const STAGES = [
  { key: 'potenciais',         name: 'Potenciais',           color: '#38bdf8', slaHours: 48,        temperature: 'quente', terminalKind: null },
  { key: 'inscrito',           name: 'Inscrito',             color: '#0ea5e9', slaHours: 48,        temperature: 'quente', terminalKind: null },
  { key: 'follow_up',          name: 'Follow Up',            color: '#f59e0b', slaHours: null,      temperature: 'quente', terminalKind: null },
  { key: 'sem_resposta',       name: 'Sem Resposta',         color: '#a78bfa', slaHours: 25 * 24,   temperature: 'morno',  terminalKind: null },
  { key: 'aguardando_decisao', name: 'Aguardando Decisão',   color: '#fbbf24', slaHours: null,      temperature: 'quente', terminalKind: null },
  { key: 'aguardando_desconto',name: 'Aguardando Desconto',  color: '#94a3b8', slaHours: 60 * 24,   temperature: 'frio',   terminalKind: null },
  { key: 'pre_matriculado',    name: 'Pré Matriculado',      color: '#34d399', slaHours: 20 * 24,   temperature: 'quente', terminalKind: null },
  { key: 'matriculado',        name: 'Matriculado',          color: '#10b981', slaHours: 48,        temperature: 'quente', terminalKind: 'won' },
  { key: 'desqualificado',     name: 'Desqualificado/Perdido', color: '#ef4444', slaHours: null,    temperature: 'frio',   terminalKind: 'lost' },
]

// ─── Catálogo de atividades ───────────────────────────────
// O sufixo do código é o canal: -WP- WhatsApp, -EM- e-mail, -LI- ligação,
// -ST- sistema.
const ACTIVITY_TEMPLATES = [
  { code: 'AT-WP-01', name: 'ENVIAR MENSAGEM WPP - INTERACAO',            type: 'whatsapp', dueMode: 'immediate',     dueValue: 0 },
  { code: 'AT-WP-02', name: 'ENVIAR WPP - INTERACAO (INSCRICAO ONLINE)',  type: 'whatsapp', dueMode: 'immediate',     dueValue: 0 },
  { code: 'AT-WP-05', name: 'INFORMAR ANALISE DA EXPERIENCIA',            type: 'whatsapp', dueMode: 'hours',         dueValue: 48 },
  { code: 'AT-WP-06', name: 'COBRANCA DE TAXA DE MATRICULA/CONTRATO',     type: 'whatsapp', dueMode: 'hours',         dueValue: 24 },
  { code: 'AT-WP-07', name: 'ACAO COMERCIAL - DESCONTO',                  type: 'whatsapp', dueMode: 'business_days', dueValue: 1 },
  { code: 'AT-LI-01', name: 'REALIZAR LIGACAO - INTERACAO',               type: 'call',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'AT-ST-01', name: 'VERIFICAR INSCRICAO ONLINE',                 type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'AT-ST-02', name: 'ENVIO DE CONTRATO E MEIO DE PAGAMENTO',      type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'DC-ST-03', name: 'VERIFICAR PGTO - ALTERAR ETAPA',             type: 'task',     dueMode: 'hours',         dueValue: 24 },
  { code: 'DC-ST-11', name: 'CANCELAR FATURAS/INATIVAR ALUNO',            type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'DC-WP-01', name: 'BOAS VINDAS - VERIFICAR/COBRAR ENVIO DE DOCS', type: 'whatsapp', dueMode: 'immediate',   dueValue: 0 },
]

interface SummaryDef {
  code: string
  name: string
  sector: string
  helpText?: string
  targetStageKey?: string
  setOutcome?: 'won' | 'lost'
  requireLossReason?: boolean
  temperature?: 'quente' | 'morno' | 'frio'
  closeOpenActivities?: boolean
  nextSummaryCode?: string
  autoAdvanceOnDue?: boolean
  allowedFromStages?: string[]
  /** [codigoTemplate, modoPrazo?, valorPrazo?, tituloOverride?] */
  activities?: Array<[string, string?, number?, string?]>
}

// ─── Resumos ──────────────────────────────────────────────
// As três escadas de "sem resposta" (nunca respondeu / qualificado / após o
// valor) seguem a mesma cadência 5→7→10 dias e diferem só no destino final:
// as duas primeiras perdem o lead, a terceira manda para Aguardando Desconto,
// porque objeção de preço é recuperável por campanha.
const SUMMARIES: SummaryDef[] = [
  // ── Topo ──
  { code: 'AT-001', name: 'PRIMEIRA ABORDAGEM', sector: 'AT', temperature: 'quente',
    targetStageKey: 'follow_up',
    helpText: 'Primeira mensagem enviada ao lead. Avança para Follow Up.' },

  { code: 'AT-003', name: 'FOLLOW UP ATIVO - AGUARDANDO RESPOSTA', sector: 'AT', temperature: 'quente',
    targetStageKey: 'follow_up',
    helpText: 'Lead não respondeu há mais de 4h, ou parou de responder no meio do atendimento. Transição antes de classificar como Sem Resposta.' },

  { code: 'AT-004', name: 'FOLLOW UP ATIVO - EM INTERACAO', sector: 'AT', temperature: 'quente',
    targetStageKey: 'follow_up',
    helpText: 'Lead responde, mas devagar (40 min a 4h). Ainda não dá pra definir a situação.' },

  { code: 'AT-005', name: 'AGUARDANDO INFORMACAO PARA AVANCAR', sector: 'AT', temperature: 'quente',
    targetStageKey: 'follow_up',
    helpText: 'Lead depende de análise de documentação ou de aproveitamento por competência.',
    activities: [['AT-WP-05']] },

  // ── Perdas declaradas ──
  { code: 'AT-006', name: 'DECLAROU NAO TER INTERESSE EM AVANCAR', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true,
    helpText: 'Lead disse que não quer prosseguir. Use qualquer objeção, exceto as de valor.' },

  { code: 'AT-007', name: 'DESQUALIFICADO', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true,
    helpText: 'Não atende aos critérios mínimos (idade, escolaridade), busca curso gratuito, dados inválidos ou entrou por engano.' },

  // ── Escada 1: nunca respondeu ──
  { code: 'AT-020', name: 'PRIMEIRA ABORDAGEM - 01 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-021', autoAdvanceOnDue: true,
    helpText: 'Nunca respondeu a primeira abordagem. Próxima tentativa em 5 dias.',
    activities: [['AT-WP-01', 'business_days', 5, 'Tentativa 01']] },

  { code: 'AT-021', name: 'PRIMEIRA ABORDAGEM - 02 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-022', autoAdvanceOnDue: true,
    activities: [['AT-WP-01', 'business_days', 7, 'Tentativa 02']] },

  { code: 'AT-022', name: 'PRIMEIRA ABORDAGEM - 03 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-023', autoAdvanceOnDue: true,
    helpText: 'Última tentativa. Sem retorno em 10 dias, o lead é perdido.',
    activities: [['AT-WP-01', 'business_days', 10, 'Tentativa 03']] },

  { code: 'AT-023', name: 'PRIMEIRA ABORDAGEM - SEM RESPOSTAS PERDIDO', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true },

  // ── Escada 2: qualificado que sumiu ──
  { code: 'AT-026', name: 'QUALIFICADO - 01 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-027', autoAdvanceOnDue: true,
    helpText: 'Interagiu, foi qualificado e parou de responder sem motivo claro.',
    activities: [['AT-WP-01', 'business_days', 5, 'Tentativa 01']] },

  { code: 'AT-027', name: 'QUALIFICADO - 02 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-028', autoAdvanceOnDue: true,
    activities: [['AT-WP-01', 'business_days', 7, 'Tentativa 02']] },

  { code: 'AT-028', name: 'QUALIFICADO - 03 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-029', autoAdvanceOnDue: true,
    activities: [['AT-WP-01', 'business_days', 10, 'Tentativa 03']] },

  { code: 'AT-029', name: 'QUALIFICADO - SEM RESPOSTAS PERDIDO', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true },

  // ── Escada 3: sumiu após o valor ──
  { code: 'AT-030', name: 'APOS O VALOR - 01 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-031', autoAdvanceOnDue: true,
    helpText: 'Parou de responder depois de saber o preço. Não perca este lead: ele termina em Aguardando Desconto.',
    activities: [['AT-WP-01', 'business_days', 5, 'Tentativa 01']] },

  { code: 'AT-031', name: 'APOS O VALOR - 02 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-032', autoAdvanceOnDue: true,
    activities: [['AT-WP-01', 'business_days', 7, 'Tentativa 02']] },

  { code: 'AT-032', name: 'APOS O VALOR - 03 TENTATIVA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-033', autoAdvanceOnDue: true,
    activities: [['AT-WP-01', 'business_days', 10, 'Tentativa 03']] },

  { code: 'AT-033', name: 'APOS O VALOR - SEM RESPOSTAS OFERECER DESCONTOS', sector: 'AT', temperature: 'frio',
    targetStageKey: 'aguardando_desconto', closeOpenActivities: true,
    helpText: 'Só pode ser perdido depois de uma ação comercial focada em desconto.' },

  // ── Pré-matriculado que sumiu ──
  { code: 'AT-035', name: 'PRE MATRICULADO - SEM RESPOSTA', sector: 'AT', temperature: 'morno',
    targetStageKey: 'sem_resposta', closeOpenActivities: true,
    nextSummaryCode: 'AT-036', autoAdvanceOnDue: true,
    helpText: 'Primeira parcela inadimplente e sem retorno em 48h. Cobrança escalonada 7 → 15 → 30 dias.',
    activities: [['AT-WP-06', 'business_days', 7, 'Cobrança - Tentativa 01']] },

  { code: 'AT-036', name: 'PRE MATRICULADO - SEM RESPOSTA/PERDIDO', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true,
    activities: [['DC-ST-11', 'immediate', 0, 'Aluno Pre Matriculado/Sem Resposta']] },

  // ── Aguardando decisão ──
  { code: 'AT-056', name: 'AGUARDANDO DECISAO COM DATA', sector: 'AT', temperature: 'quente',
    targetStageKey: 'aguardando_decisao',
    helpText: 'Lead precisa validar com terceiro (empresa, família) e informou uma data.',
    activities: [['AT-WP-01', 'lead_defined', 0, 'Retomar no dia combinado']] },

  { code: 'AT-057', name: 'AGUARDANDO DECISAO SEM DATA', sector: 'AT', temperature: 'quente',
    targetStageKey: 'aguardando_decisao',
    helpText: 'Mesma situação, mas sem data definida. Retoma em 48h.',
    activities: [['AT-WP-01', 'hours', 48]] },

  { code: 'AT-058', name: 'PRE MATRICULADO ONLINE', sector: 'AT', temperature: 'quente',
    targetStageKey: 'pre_matriculado',
    helpText: 'Veio pelo formulário do site sem passar por atendimento humano — é o lead mais quente da etapa.',
    activities: [['AT-ST-01'], ['AT-WP-02']] },

  { code: 'AT-150', name: 'COM INTERESSE - PROXIMA CAMPANHA', sector: 'AT', temperature: 'frio',
    targetStageKey: 'aguardando_desconto',
    helpText: 'Lead quer voltar quando houver desconto.' },

  { code: 'AT-155', name: 'SEM INTERESSE - NAO CONTACTAR', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true,
    helpText: 'Use SÓ quando realmente não foi possível descobrir a objeção. Objeção genérica não gera ação de recuperação.' },

  { code: 'AT-156', name: 'PRE MATRICULADO - DECLAROU DESISTENCIA', sector: 'AT', temperature: 'frio',
    targetStageKey: 'desqualificado', setOutcome: 'lost', requireLossReason: true, closeOpenActivities: true,
    helpText: 'Já pré-matriculado, declarou que desiste.',
    activities: [['DC-ST-11', 'immediate', 0, 'Aluno Pre Matriculado/Desistente']] },

  // ── Conversão ──
  { code: 'AT-200', name: 'SOLICITOU MATRICULA', sector: 'AT', temperature: 'quente',
    targetStageKey: 'pre_matriculado',
    helpText: 'Lead decidiu se matricular, dados enviados e cadastro feito. Gera o envio de contrato e meio de pagamento.',
    activities: [['AT-ST-02'], ['DC-ST-03', 'hours', 24]] },

  { code: 'DC-003', name: 'PENDENTE TX DE MATRICULA, CONTRATO E DEMAIS', sector: 'DC', temperature: 'quente',
    allowedFromStages: ['pre_matriculado'],
    helpText: 'Contrato e link de pagamento já enviados. Cobrança em 24h ou na data que o lead informou.',
    activities: [['AT-WP-06', 'hours', 24, 'Cobrar Pagamento e Contrato']] },

  { code: 'DC-004', name: 'PENDENTE DE CONTRATO ASSINADO E DEMAIS', sector: 'DC', temperature: 'quente',
    allowedFromStages: ['pre_matriculado'],
    helpText: 'Pagou, mas ainda não assinou o contrato.',
    activities: [['AT-WP-06', 'hours', 24, 'Cobrar Apenas Assinatura do Contrato']] },

  { code: 'DC-006', name: 'PRIMEIRA PARCELA INADIMPLENTE', sector: 'DC', temperature: 'quente',
    allowedFromStages: ['pre_matriculado'],
    nextSummaryCode: 'AT-035', autoAdvanceOnDue: true,
    helpText: 'Não pagou na data combinada e não deu retorno. Sem resposta em 48h, cai para Sem Resposta.',
    activities: [['AT-WP-06', 'hours', 48, 'Cobrança - primeira parcela']] },

  { code: 'DC-009', name: 'PENDENTE DE DOCS PESSOAIS', sector: 'DC', temperature: 'quente',
    targetStageKey: 'matriculado', closeOpenActivities: true,
    helpText: 'Pagamento confirmado e contrato assinado. Encerra o esforço comercial e passa o aluno para a secretaria.',
    activities: [['DC-WP-01', 'immediate', 0, 'Boas vindas Secretaria']] },
]

async function run() {
  console.log(`→ funil "${FUNNEL_NAME}"`)
  let funnel = await prisma.funnel.findFirst({ where: { name: FUNNEL_NAME } })
  if (!funnel) {
    funnel = await prisma.funnel.create({ data: { name: FUNNEL_NAME, description: 'Funil comercial de captação até matrícula.' } })
  }

  console.log('→ etapas')
  for (const [i, s] of STAGES.entries()) {
    await prisma.stage.upsert({
      where: { funnelId_key: { funnelId: funnel.id, key: s.key } },
      create: {
        funnelId: funnel.id, key: s.key, name: s.name, color: s.color, position: i,
        slaHours: s.slaHours, temperature: s.temperature, terminalKind: s.terminalKind,
      },
      update: {
        name: s.name, color: s.color, position: i,
        slaHours: s.slaHours, temperature: s.temperature, terminalKind: s.terminalKind,
      },
    })
  }

  console.log('→ atividades padrão')
  const tplByCode = new Map<string, number>()
  for (const t of ACTIVITY_TEMPLATES) {
    const row = await prisma.activityTemplate.upsert({
      where: { code: t.code },
      create: { code: t.code, name: t.name, type: t.type, dueMode: t.dueMode, dueValue: t.dueValue },
      update: { name: t.name, type: t.type, dueMode: t.dueMode, dueValue: t.dueValue, active: true },
      select: { id: true },
    })
    tplByCode.set(t.code, row.id)
  }

  console.log('→ resumos')
  for (const [i, s] of SUMMARIES.entries()) {
    const data = {
      name: s.name,
      sector: s.sector,
      helpText: s.helpText ?? null,
      position: i,
      active: true,
      targetStageKey: s.targetStageKey ?? null,
      setOutcome: s.setOutcome ?? null,
      requireLossReason: s.requireLossReason ?? false,
      temperature: s.temperature ?? null,
      closeOpenActivities: s.closeOpenActivities ?? false,
      nextSummaryCode: s.nextSummaryCode ?? null,
      autoAdvanceOnDue: s.autoAdvanceOnDue ?? false,
      allowedFromStages: (s.allowedFromStages ?? null) as never,
    }
    const row = await prisma.statusSummary.upsert({
      where: { funnelId_code: { funnelId: funnel.id, code: s.code } },
      create: { funnelId: funnel.id, code: s.code, ...data },
      update: data,
      select: { id: true },
    })

    // Re-liga as atividades do zero: o seed é a fonte da verdade do catálogo.
    await prisma.statusSummaryActivity.deleteMany({ where: { summaryId: row.id } })
    const acts = s.activities ?? []
    if (acts.length) {
      await prisma.statusSummaryActivity.createMany({
        data: acts.map(([code, mode, value, title], order) => {
          const tplId = tplByCode.get(code)
          if (!tplId) throw new Error(`Template ${code} não existe no catálogo (resumo ${s.code})`)
          return {
            summaryId: row.id,
            activityTemplateId: tplId,
            dueOverrideMode: mode ?? null,
            dueOverrideValue: value ?? null,
            titleOverride: title ?? null,
            order,
          }
        }),
      })
    }
  }

  console.log(
    `\n✓ ${STAGES.length} etapas, ${ACTIVITY_TEMPLATES.length} atividades padrão e ${SUMMARIES.length} resumos no funil "${FUNNEL_NAME}" (id ${funnel.id}).`,
  )
  console.log('  Ative o módulo "Resumos" em Configurações › Módulos para o time começar a usar.')
  console.log('  Fora deste seed (dependem do ERP acadêmico/LMS): jornada da secretaria — documentos, AVA, SISTEC, estágio, diploma e taxa de correios.')
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
