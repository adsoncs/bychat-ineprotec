// scripts/status_summary_seed_secretaria.ts
// Semeia o funil e o catálogo da SECRETARIA (pós-matrícula até a entrega do
// diploma/certificado). Idempotente — rode quantas vezes quiser.
//
//   npx tsx scripts/status_summary_seed_secretaria.ts
//
// PRÉ-REQUISITO: rode antes o status_summary_seed_comercial.ts — o resumo de
// handoff (SE-001) vive no catálogo do funil comercial e aponta para cá.
//
// ── Por que isso cabe em resumos + tarefas (sem ERP/LMS) ──
// As checagens externas — adimplência no sistema acadêmico, conclusão no AVA,
// situação no SISTEC, valor do frete nos Correios — já são feitas por uma
// pessoa que depois registra o resultado no CRM. É assim que o processo roda
// hoje; nenhuma delas era consulta automática. O que precisa ser armazenado
// vira CustomField (quitado em, tem experiência, forma de envio, rastreio).
// Quando o ERP acadêmico entrar, esses campos passam a ser preenchidos por
// integração e NADA aqui muda de forma.

import { prisma } from '../src/lib/prisma.js'

const COMERCIAL = 'Comercial · Matrícula EAD'
const SECRETARIA = 'Secretaria · Inscrições'

// ─── Etapas ───────────────────────────────────────────────
const STAGES = [
  { key: 'pre_matriculado_pago', name: 'Pré Matriculado Pago',    color: '#34d399', slaHours: 48,       temperature: 'quente', terminalKind: null },
  { key: 'docs_pendentes',       name: 'Documentos Pendentes',    color: '#fbbf24', slaHours: 30 * 24,  temperature: 'morno',  terminalKind: null },
  { key: 'em_curso',             name: 'Em Curso',                color: '#60a5fa', slaHours: null,     temperature: 'morno',  terminalKind: null },
  { key: 'aguardando_quitacao',  name: 'Aguardando Quitação',     color: '#f59e0b', slaHours: null,     temperature: 'morno',  terminalKind: null },
  { key: 'aguardando_emissao',   name: 'Aguardando Emissão',      color: '#a78bfa', slaHours: 45 * 24,  temperature: 'quente', terminalKind: null },
  { key: 'aguardando_envio',     name: 'Aguardando Envio',        color: '#818cf8', slaHours: 60 * 24,  temperature: 'quente', terminalKind: null },
  { key: 'concluido',            name: 'Concluído',               color: '#10b981', slaHours: null,     temperature: null,     terminalKind: 'won' },
  { key: 'abandono',             name: 'Abandono',                color: '#94a3b8', slaHours: null,     temperature: 'frio',   terminalKind: 'lost' },
]

// ─── Campos que a secretaria precisa registrar ────────────
// Substituem as consultas manuais a outro sistema: o dado passa a morar no CRM,
// que é o que permite filtrar, cobrar e medir. Todos preenchidos por pessoa.
const CUSTOM_FIELDS = [
  { key: 'quitado_em',            label: 'Quitado em',                 type: 'date',   group: 'financeiro', description: 'Data em que o contrato foi quitado. Preenchido pelo financeiro na conciliação.' },
  { key: 'tem_experiencia',       label: 'Tem experiência comprovada', type: 'select', group: 'academico',  description: 'Dispensa o prazo mínimo de 6 meses de contrato para certificar.', options: [{ label: 'Sim', value: 'sim' }, { label: 'Não', value: 'nao' }] },
  { key: 'forma_envio_diploma',   label: 'Forma de envio do diploma',  type: 'select', group: 'academico',  description: 'Definida no requerimento assinado pelo aluno.', options: [{ label: 'Sedex', value: 'sedex' }, { label: 'Carta registrada', value: 'carta_registrada' }, { label: 'Retirada presencial', value: 'presencial' }] },
  { key: 'codigo_rastreio',       label: 'Código de rastreio',         type: 'text',   group: 'academico',  description: 'Rastreio dos Correios, informado ao aluno na entrega.' },
]

// ─── Catálogo de atividades da secretaria ─────────────────
const ACTIVITY_TEMPLATES = [
  // Recepção / documentos
  { code: 'DC-EM-01', name: 'VERIFICAR/COBRAR ENVIO DE DOCS',            type: 'email',    dueMode: 'days',          dueValue: 30 },
  { code: 'DC-ST-09', name: 'COMPLETAR E CORRIGIR CADASTRO',             type: 'task',     dueMode: 'business_days', dueValue: 3 },
  { code: 'DC-EM-03', name: 'ENVIO DE LOGIN E SENHA AVA',                type: 'email',    dueMode: 'immediate',     dueValue: 0 },
  { code: 'DC-ST-04', name: 'CADASTRAR SISTEMA AVA',                     type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-ST-01', name: 'CADASTRAR NO SISTEC',                       type: 'task',     dueMode: 'business_days', dueValue: 3 },
  // Estágio e estudos
  { code: 'SE-WP-02', name: 'VERIFICAR/COBRAR ENVIO DE A E F P R FISICOS', type: 'whatsapp', dueMode: 'days',        dueValue: 30 },
  { code: 'SE-ST-02', name: 'VERIFICAR ETAPA DE ESTUDOS NO AVA',         type: 'task',     dueMode: 'days',          dueValue: 30 },
  { code: 'SE-ST-04', name: 'ATUALIZAR SITUACAO DO ALUNO',               type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-ST-05', name: 'LIBERACAO DE PROVA',                        type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'DC-ST-05', name: 'SENHA INCORRETA AO ENTRAR NO AVA',          type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  // Certificação
  { code: 'SE-WP-04', name: 'SOLICITAR QUITACAO',                        type: 'whatsapp', dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-IL-01', name: 'ENTREGA DE PASTA PARA INSTITUICAO',         type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-IL-02', name: 'RETIRAR DIPLOMA - INSTITUICAO/CORREIOS',    type: 'task',     dueMode: 'days',          dueValue: 45 },
  // Envio
  { code: 'SE-IL-03', name: 'ENVIAR DIPLOMA',                            type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-IL-06', name: 'ENVIAR DECLARACAO/HISTORICO',               type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-IL-07', name: 'ENVIAR CERTIFICADO',                        type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-WP-06', name: 'ENVIAR REQUERIMENTO DE TAXA DE CORREIOS',   type: 'whatsapp', dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-WP-07', name: 'COBRAR REQUERIMENTO DE TAXA DE CORREIOS',   type: 'whatsapp', dueMode: 'business_days', dueValue: 3 },
  { code: 'SE-ST-07', name: 'GERAR/ENVIAR TAXA DE CORREIOS',             type: 'task',     dueMode: 'immediate',     dueValue: 0 },
  { code: 'SE-WP-08', name: 'VERIFICAR/COBRAR TAXA DE CORREIOS',         type: 'whatsapp', dueMode: 'business_days', dueValue: 2 },
]

interface SummaryDef {
  code: string
  name: string
  sector: string
  helpText?: string
  /** Em qual catálogo o resumo entra: 'secretaria' (padrão) ou 'comercial'. */
  catalog?: 'secretaria' | 'comercial'
  targetFunnel?: 'secretaria' | 'comercial'
  targetStageKey?: string
  setOutcome?: 'won' | 'lost'
  requireLossReason?: boolean
  /** Nome da objeção padrão — criada se não existir. Necessária para que o
   *  arquivamento automático registre o motivo em vez de perder sem explicação. */
  defaultLossReasonName?: string
  temperature?: 'quente' | 'morno' | 'frio'
  closeOpenActivities?: boolean
  nextSummaryCode?: string
  autoAdvanceOnDue?: boolean
  allowedFromStages?: string[]
  requiredFields?: string[]
  activities?: Array<[string, string?, number?, string?]>
}

const SUMMARIES: SummaryDef[] = [
  // ── Handoff: vive no catálogo COMERCIAL e joga o lead para a Secretaria ──
  // Responde ao pedido de "transferência de registro entre processos": o
  // colaborador aplica um resumo e o registro troca de funil sozinho.
  {
    code: 'SE-001', name: 'PRE MATRICULADO PAGO', sector: 'SE', catalog: 'comercial',
    targetFunnel: 'secretaria', targetStageKey: 'pre_matriculado_pago',
    temperature: 'quente', closeOpenActivities: true,
    helpText: 'Pagamento e contrato confirmados. Transfere o registro do Comercial para o processo da Secretaria e abre a recepção da matrícula.',
    activities: [
      ['DC-EM-03'], ['DC-ST-04'],
      ['DC-EM-01', 'days', 30], ['DC-ST-09', 'business_days', 3],
      ['SE-ST-01', 'business_days', 3, 'Somente escolas Ineprotec e Ensa'],
    ],
  },

  // ── Recepção e documentos ──
  {
    code: 'SE-003', name: 'PENDENTE DE DOCUMENTOS', sector: 'SE',
    targetStageKey: 'docs_pendentes', temperature: 'morno',
    helpText: 'Documentos pessoais faltando ou recusados. A cobrança se repete até todos serem aceitos.',
    activities: [['DC-EM-01', 'days', 30, 'Cobrar documentos pendentes']],
  },
  {
    code: 'SE-002', name: 'DOCUMENTOS VALIDADOS', sector: 'SE',
    targetStageKey: 'em_curso', temperature: 'morno', closeOpenActivities: true,
    helpText: 'Documentos conferidos e arquivados. Abre o acompanhamento de estágio e de estudos no AVA.',
    activities: [
      ['SE-WP-02', 'days', 30, 'Cobrar estágio, ata e ficha de atividades'],
      ['SE-ST-02', 'days', 30, 'Ajustar para 30 dias antes da previsão de término'],
    ],
  },

  // ── Estágio e estudos ──
  {
    code: 'SE-008', name: 'ESTAGIO PENDENTE', sector: 'SE',
    targetStageKey: 'em_curso', temperature: 'morno',
    helpText: 'Relatório de estágio, ata e ficha de práticas ainda não chegaram.',
    activities: [['SE-WP-02', 'days', 30, 'Cobrança de estágio']],
  },
  {
    code: 'SE-009', name: 'ESTAGIO EM CORRECAO', sector: 'SE',
    targetStageKey: 'em_curso', temperature: 'morno', closeOpenActivities: true,
    helpText: 'Documentação física recebida com pendências. Aponte as correções na descrição da atividade.',
    activities: [['SE-WP-02', 'days', 30, 'Reenvio após correções']],
  },
  {
    code: 'SE-004', name: 'AGUARDANDO CONCLUSAO DO AVA', sector: 'SE',
    targetStageKey: 'em_curso', temperature: 'morno',
    helpText: 'Estágio validado, mas o ambiente de estudos ainda não foi concluído. Ajuste o vencimento para a data prevista pelo aluno.',
    activities: [['SE-ST-02', 'lead_defined', 0, 'Conclusão do AVA antes de expirar o contrato']],
  },
  {
    code: 'SE-011', name: 'INTERCORRENCIA DE ACESSO AO AVA', sector: 'SE',
    temperature: 'quente',
    helpText: 'Aluno sem acesso ao ambiente. Resete a senha e confirme com ele.',
    activities: [['DC-ST-05']],
  },
  {
    code: 'SE-012', name: 'AGENDAMENTO DE PROVA', sector: 'SE',
    temperature: 'quente',
    helpText: 'Antes de liberar: exercícios concluídos no AVA, aluno adimplente e contrato dentro do prazo.',
    activities: [['SE-ST-05'], ['SE-ST-04']],
  },
  {
    code: 'SE-013', name: 'LIBERACAO DE 2A CHAMADA/RECUPERACAO', sector: 'SE',
    temperature: 'quente',
    helpText: 'Prova de segunda chamada ou recuperação liberada. Oriente o aluno sobre as boas práticas.',
    activities: [['SE-ST-05', 'immediate', 0, 'Liberação de 2ª chamada']],
  },

  // ── Certificação ──
  {
    code: 'SE-005', name: 'SOMENTE FINANCEIRO PENDENTE', sector: 'SE',
    targetStageKey: 'aguardando_quitacao', temperature: 'morno',
    helpText: 'Documentos e estudos completos; falta quitar. A atividade vai para Sucesso do Aluno acompanhar.',
    activities: [['SE-WP-04', 'immediate', 0, 'Solicitar quitação']],
  },
  {
    code: 'SE-016', name: 'AGUARDANDO PRAZO MINIMO DE CURSO', sector: 'SE',
    targetStageKey: 'aguardando_quitacao', temperature: 'morno',
    helpText: 'Quitado, mas o contrato ainda não completou os 6 meses. Ajuste o vencimento para a data em que completa.',
    activities: [['SE-IL-01', 'lead_defined', 0, 'Aguardando completar 6 meses de contrato']],
  },
  {
    code: 'SE-006', name: 'AGUARDANDO EMISSAO DE DIPLOMA', sector: 'SE',
    targetStageKey: 'aguardando_emissao', temperature: 'quente', closeOpenActivities: true,
    requiredFields: ['quitado_em'],
    helpText: 'Quitado e com prazo cumprido. Entrega a pasta na instituição e abre o prazo de 45 dias para retirar o diploma.',
    activities: [
      ['SE-IL-01', 'immediate', 0, 'Entregar pasta na instituição'],
      ['SE-IL-02', 'days', 45],
    ],
  },

  // ── Envio ──
  {
    code: 'SE-007', name: 'AGUARDANDO ENVIO DE DIPLOMA', sector: 'SE',
    targetStageKey: 'aguardando_envio', temperature: 'quente', closeOpenActivities: true,
    helpText: 'Diploma/certificado em mãos. Ajuste as datas conforme o dia previsto de envio.',
    activities: [['SE-IL-03'], ['SE-IL-06'], ['SE-IL-07']],
  },
  {
    code: 'SE-015', name: 'PENDENTE DE TAXA DE CORREIOS', sector: 'SE',
    targetStageKey: 'aguardando_envio', temperature: 'quente',
    nextSummaryCode: 'SE-017', autoAdvanceOnDue: true,
    helpText: 'Envia o requerimento de endereço e a autorização da taxa. Sem resposta, a cobrança sobe sozinha de degrau.',
    activities: [
      ['SE-WP-06'],
      ['SE-WP-07', 'business_days', 3, 'Cobrança do requerimento - 1ª'],
      ['SE-ST-07'],
      ['SE-WP-08', 'business_days', 2],
    ],
  },
  // Escada da taxa: 3 dias × 3, depois 30 dias × 2, e no limite de 60 dias o
  // documento é arquivado. Códigos SE-017/018/019 não constam nos documentos do
  // cliente — foram criados para materializar a régua que lá é feita na mão.
  {
    code: 'SE-017', name: 'TAXA DE CORREIOS - COBRANCA 02', sector: 'SE',
    targetStageKey: 'aguardando_envio', temperature: 'morno', closeOpenActivities: true,
    nextSummaryCode: 'SE-018', autoAdvanceOnDue: true,
    activities: [['SE-WP-07', 'business_days', 3, 'Cobrança do requerimento - 2ª']],
  },
  {
    code: 'SE-018', name: 'TAXA DE CORREIOS - COBRANCA 03', sector: 'SE',
    targetStageKey: 'aguardando_envio', temperature: 'morno', closeOpenActivities: true,
    nextSummaryCode: 'SE-019', autoAdvanceOnDue: true,
    activities: [['SE-WP-07', 'business_days', 3, 'Cobrança do requerimento - 3ª']],
  },
  {
    code: 'SE-019', name: 'TAXA DE CORREIOS - ULTIMA CHAMADA', sector: 'SE',
    targetStageKey: 'aguardando_envio', temperature: 'frio', closeOpenActivities: true,
    nextSummaryCode: 'SE-020', autoAdvanceOnDue: true,
    helpText: 'Última janela (30 dias). Avise o aluno de que o documento será arquivado se não houver retorno.',
    activities: [['SE-WP-07', 'days', 30, 'Cobrança final - avisar sobre arquivamento']],
  },

  // ── Terminais ──
  {
    code: 'SE-010', name: 'DIPLOMA ENTREGUE', sector: 'SE',
    targetStageKey: 'concluido', setOutcome: 'won', temperature: 'quente', closeOpenActivities: true,
    requiredFields: ['codigo_rastreio'],
    helpText: 'Despachado. Registre o rastreio no campo do lead e informe o aluno.',
  },
  {
    code: 'SE-014', name: 'CERTIFICADO ENTREGUE', sector: 'SE',
    targetStageKey: 'concluido', setOutcome: 'won', temperature: 'quente', closeOpenActivities: true,
    helpText: 'Certificado entregue ao aluno (correios ou retirada presencial).',
  },
  {
    code: 'SE-020', name: 'DIPLOMA ARQUIVADO', sector: 'SE',
    targetStageKey: 'abandono', setOutcome: 'lost', requireLossReason: true,
    defaultLossReasonName: 'Diploma não retirado — sem retorno',
    temperature: 'frio', closeOpenActivities: true,
    helpText: '60 dias sem o requerimento nem a taxa. O documento fica arquivado até o aluno procurar.',
  },
]

async function run() {
  console.log(`→ funil "${SECRETARIA}"`)
  let secretaria = await prisma.funnel.findFirst({ where: { name: SECRETARIA } })
  if (!secretaria) {
    secretaria = await prisma.funnel.create({
      data: { name: SECRETARIA, description: 'Da matrícula paga até a entrega do diploma/certificado.' },
    })
  }

  const comercial = await prisma.funnel.findFirst({ where: { name: COMERCIAL } })
  if (!comercial) {
    throw new Error(`Funil "${COMERCIAL}" não existe. Rode antes: npx tsx scripts/status_summary_seed_comercial.ts`)
  }

  console.log('→ etapas')
  for (const [i, s] of STAGES.entries()) {
    await prisma.stage.upsert({
      where: { funnelId_key: { funnelId: secretaria.id, key: s.key } },
      create: {
        funnelId: secretaria.id, key: s.key, name: s.name, color: s.color, position: i,
        slaHours: s.slaHours, temperature: s.temperature, terminalKind: s.terminalKind,
      },
      update: {
        name: s.name, color: s.color, position: i,
        slaHours: s.slaHours, temperature: s.temperature, terminalKind: s.terminalKind,
      },
    })
  }

  console.log('→ campos personalizados')
  for (const [i, f] of CUSTOM_FIELDS.entries()) {
    await prisma.customField.upsert({
      where: { key: f.key },
      create: {
        key: f.key, label: f.label, type: f.type, group: f.group,
        description: f.description, options: (f.options ?? null) as never,
        position: 100 + i, showInList: false, showInKanban: false, showInForm: false,
      },
      // Não sobrescreve label/visibilidade: o cliente pode ter ajustado.
      update: { description: f.description, active: true },
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

  console.log('→ objeções usadas pelos resumos')
  const reasonByName = new Map<string, number>()
  for (const name of new Set(SUMMARIES.map((s) => s.defaultLossReasonName).filter(Boolean) as string[])) {
    const found = await prisma.lossReason.findFirst({ where: { name }, select: { id: true } })
    const id = found?.id ?? (await prisma.lossReason.create({ data: { name, color: '#94a3b8', position: 90 } })).id
    reasonByName.set(name, id)
  }

  console.log('→ resumos')
  for (const [i, s] of SUMMARIES.entries()) {
    const catalogId = s.catalog === 'comercial' ? comercial.id : secretaria.id
    const targetFunnelId =
      s.targetFunnel === 'secretaria' ? secretaria.id
      : s.targetFunnel === 'comercial' ? comercial.id
      : null

    const data = {
      name: s.name,
      sector: s.sector,
      helpText: s.helpText ?? null,
      position: i,
      active: true,
      targetFunnelId,
      targetStageKey: s.targetStageKey ?? null,
      setOutcome: s.setOutcome ?? null,
      requireLossReason: s.requireLossReason ?? false,
      defaultLossReasonId: s.defaultLossReasonName ? reasonByName.get(s.defaultLossReasonName) ?? null : null,
      temperature: s.temperature ?? null,
      closeOpenActivities: s.closeOpenActivities ?? false,
      nextSummaryCode: s.nextSummaryCode ?? null,
      autoAdvanceOnDue: s.autoAdvanceOnDue ?? false,
      allowedFromStages: (s.allowedFromStages ?? null) as never,
      requiredFields: (s.requiredFields ?? null) as never,
    }

    const row = await prisma.statusSummary.upsert({
      where: { funnelId_code: { funnelId: catalogId, code: s.code } },
      create: { funnelId: catalogId, code: s.code, ...data },
      update: data,
      select: { id: true },
    })

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

  const handoff = SUMMARIES.filter((s) => s.catalog === 'comercial').length
  console.log(
    `\n✓ ${STAGES.length} etapas, ${CUSTOM_FIELDS.length} campos, ${ACTIVITY_TEMPLATES.length} atividades padrão e ` +
    `${SUMMARIES.length} resumos (${handoff} no catálogo do Comercial, para o handoff).`,
  )
  console.log(`  Funil "${SECRETARIA}" id ${secretaria.id}.`)
  console.log('  Handoff: aplique SE-001 no lead do Comercial — o registro troca de funil sozinho.')
  console.log('  Continua manual (e sem previsão de automação nesta fase): conferência no sistema acadêmico,')
  console.log('  conclusão no AVA, situação no SISTEC, simulação de frete e emissão do diploma.')
}

run()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
