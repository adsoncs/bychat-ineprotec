// src/services/leadExportData.ts
// Motor de COLETA para a exportação de leads. Reúne, para um conjunto de leads e
// um conjunto de "seções" escolhidas pelo usuário, TODOS os dados associados —
// campos do próprio Lead (incl. JSONs), as relações declaradas e os ~20 models
// modulares ligados por leadId escalar (Negociações, Reuniões, VoIP, Bookings,
// tracking/visitor, LGPD, workflows, etc.).
//
// A saída é normalizada em "blocos" (kv = ficha chave/valor por lead; table =
// muitas linhas por lead). Essa forma única alimenta os 4 renderizadores
// (XLSX/CSV/HTML/PDF) em leadExportRender.ts.

import { prisma } from '../lib/prisma.js'

// ── Tipos normalizados ──────────────────────────────────────────────────────
export interface KvRow { label: string; value: string }
export interface Block {
  key: string                 // identificador único (nome de aba/âncora)
  label: string               // rótulo exibido
  kind: 'kv' | 'table'
  columns?: string[]          // colunas (kind=table)
  byLead: Record<number, KvRow[] | Record<string, string>[]>
}
export interface Dossier {
  generatedAt: Date
  leads: { id: number; uid: string; nome: string; empresa: string }[]
  blocks: Block[]
}

interface Ctx { leadIds: number[]; leadsById: Map<number, any> }

// Campo de uma ficha kv: rótulo + extrator do lead.
type LeadField = [string, (lead: any) => any]
// Coluna de tabela: [chave no registro, rótulo].
type Col = [string, string]

// ── Formatação de valores ───────────────────────────────────────────────────
export function fmt(v: any): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return fmtDate(v)
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (typeof v === 'object') {
    if (typeof (v as any).toFixed === 'function') return (v as any).toString() // Prisma.Decimal
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function fmtDate(d: Date): string {
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function pick(r: any, cols: Col[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, label] of cols) out[label] = fmt(getPath(r, key))
  return out
}

function getPath(obj: any, path: string): any {
  if (!path.includes('.')) return obj?.[path]
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

// Bloco de tabela genérico: findMany por leadId → linhas agrupadas por lead.
async function tableBlock(
  key: string, label: string, model: string, ctx: Ctx, cols: Col[],
  opts: { orderBy?: any; include?: any } = {},
): Promise<Block> {
  const recs: any[] = await (prisma as any)[model].findMany({
    where: { leadId: { in: ctx.leadIds } },
    ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
    ...(opts.include ? { include: opts.include } : {}),
  })
  const byLead: Record<number, Record<string, string>[]> = {}
  for (const lid of ctx.leadIds) byLead[lid] = []
  for (const r of recs) (byLead[r.leadId] ||= []).push(pick(r, cols))
  return { key, label, kind: 'table', columns: cols.map(c => c[1]), byLead }
}

// Bloco kv (ficha) a partir dos campos do próprio lead.
function kvBlock(key: string, label: string, ctx: Ctx, fields: LeadField[]): Block {
  const byLead: Record<number, KvRow[]> = {}
  for (const lid of ctx.leadIds) {
    const lead = ctx.leadsById.get(lid)
    byLead[lid] = fields.map(([lbl, get]) => ({ label: lbl, value: fmt(safe(() => get(lead))) }))
  }
  return { key, label, kind: 'kv', byLead }
}

function safe<T>(fn: () => T): T | null { try { return fn() } catch { return null } }

// Expande um objeto JSON {k:v} numa lista de KvRow (rótulo=chave).
function jsonRows(obj: any, labelMap?: Record<string, string>): KvRow[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj).map(([k, v]) => ({ label: labelMap?.[k] || k, value: fmt(v) }))
}

// ── Definição dos grupos (o que o seletor mostra) ───────────────────────────
export interface GroupDef {
  id: string
  label: string
  module?: string                 // gating: só oferecido se o módulo estiver ativo
  collect: (ctx: Ctx) => Promise<Block[]>
}

export const GROUPS: GroupDef[] = [
  {
    id: 'dados', label: 'Dados & contato',
    collect: async (ctx) => [kvBlock('dados', 'Dados & contato', ctx, [
      ['Código (uid)', l => l.uid], ['Nome', l => l.nome], ['Empresa', l => l.empresa],
      ['WhatsApp', l => l.whatsapp], ['E-mail', l => l.email], ['Segmento', l => l.segmento],
      ['Cidade', l => l.cidade], ['Solução', l => l.solucaoNome], ['Maturidade', l => l.maturidade],
      ['Status', l => l.status], ['Funil', l => l.funnel?.name], ['Responsável', l => l.assignedUser?.name],
      ['Equipe', l => l.team?.name], ['Atribuído em', l => l.assignedAt], ['1ª resposta em', l => l.firstResponseAt],
      ['Qualificado em', l => l.qualifiedAt], ['Origem da qualificação', l => l.qualificationSource],
      ['Origem', l => l.source], ['Tipo de origem', l => l.originType],
      ['Desfecho', l => l.outcome], ['Desfecho em', l => l.outcomeAt], ['Motivo de perda', l => l.lostReason?.name],
      ['Obs. do desfecho', l => l.outcomeNote], ['Venda detectada', l => l.saleDetected],
      ['Valor de venda', l => l.saleValue], ['Não perturbe (canais)', l => l.optOutChannels],
      ['Criado em', l => l.createdAt], ['Atualizado em', l => l.updatedAt],
      ['Última mensagem', l => l.lastMessageAt], ['Última atividade', l => l.lastActivityAt],
    ])],
  },
  {
    id: 'campos', label: 'Campos personalizados & formulário',
    collect: async (ctx) => {
      const defs = await prisma.customField.findMany().catch(() => [] as any[])
      const labelByKey: Record<string, string> = {}
      for (const d of defs as any[]) labelByKey[d.key ?? d.fieldKey ?? d.name] = d.label ?? d.name
      const cf: Record<number, KvRow[]> = {}
      const fd: Record<number, KvRow[]> = {}
      for (const lid of ctx.leadIds) {
        const l = ctx.leadsById.get(lid)
        cf[lid] = jsonRows(l.customFields, labelByKey)
        fd[lid] = jsonRows(l.formData)
      }
      return [
        { key: 'campos', label: 'Campos personalizados', kind: 'kv', byLead: cf },
        { key: 'formulario', label: 'Dados do formulário de origem', kind: 'kv', byLead: fd },
      ]
    },
  },
  {
    id: 'score', label: 'Lead Score & IA (resumo, sentimento, pilares)',
    collect: async (ctx) => {
      const byLead: Record<number, KvRow[]> = {}
      for (const lid of ctx.leadIds) {
        const l = ctx.leadsById.get(lid)
        const rows: KvRow[] = [
          { label: 'Lead Score IA (0-100)', value: fmt(l.aiScore) },
          { label: 'Classificação IA', value: fmt(l.aiScoreLabel) },
          { label: 'Pontuado em', value: fmt(l.aiScoredAt) },
          { label: 'Priority Score', value: fmt(l.priorityScore) },
        ]
        rows.push({ label: '— Sinais do Score IA —', value: '' }, ...jsonRows(l.aiScoreReason))
        rows.push({ label: '— Score por pilar —', value: '' }, ...jsonRows(l.scores))
        if (l.analysis) rows.push({ label: '— Análise (IA) —', value: '' }, ...jsonRows(l.analysis))
        if (l.aiSentiment) rows.push({ label: '— Sentimento (IA) —', value: '' }, ...jsonRows(l.aiSentiment))
        byLead[lid] = rows
      }
      return [{ key: 'score', label: 'Lead Score & IA', kind: 'kv', byLead }]
    },
  },
  {
    id: 'etapa', label: 'Etapa, funil & movimentações',
    collect: async (ctx) => [
      kvBlock('etapa', 'Etapa & funil', ctx, [
        ['Funil', l => l.funnel?.name], ['Status/etapa', l => l.status],
        ['Etapa alcançada', l => l.lastStep], ['Concluído', l => l.completed],
      ]),
      await tableBlock('mov_etapas', 'Movimentações de etapa', 'leadStageMovement', ctx, [
        ['movedAt', 'Data'], ['fromStageKey', 'De'], ['toStageKey', 'Para'],
        ['source', 'Origem'], ['reason', 'Motivo'], ['movedByUserId', 'Por (userId)'],
      ], { orderBy: { movedAt: 'asc' } }),
    ],
  },
  {
    id: 'tags', label: 'Tags',
    collect: async (ctx) => [await tableBlock('tags', 'Tags', 'leadTag', ctx, [
      ['tag.name', 'Tag'], ['tag.color', 'Cor'], ['tag.description', 'Descrição'],
    ], { include: { tag: true } })],
  },
  {
    id: 'anotacoes', label: 'Anotações',
    collect: async (ctx) => [await tableBlock('anotacoes', 'Anotações', 'leadNote', ctx, [
      ['createdAt', 'Data'], ['userName', 'Autor'], ['content', 'Anotação'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'negociacoes', label: 'Negociações', module: 'negotiations',
    collect: async (ctx) => {
      const negs: any[] = await prisma.negotiation.findMany({
        where: { leadId: { in: ctx.leadIds } },
        include: { items: true, attachments: true },
        orderBy: { createdAt: 'asc' },
      })
      const negByLead: Record<number, Record<string, string>[]> = {}
      const itemsByLead: Record<number, Record<string, string>[]> = {}
      for (const lid of ctx.leadIds) { negByLead[lid] = []; itemsByLead[lid] = [] }
      for (const n of negs) {
        negByLead[n.leadId]?.push(pick(n, [
          ['titulo', 'Título'], ['status', 'Status'], ['valorTabela', 'Valor tabela'],
          ['descontoValor', 'Desconto'], ['frete', 'Frete'], ['valorFinal', 'Valor final'],
          ['valorUnico', 'Pagamento único'], ['valorRecorrente', 'Mensalidade (MRR)'],
          ['pagamentoForma', 'Pagamento'], ['parcelas', 'Parcelas'], ['probabilidade', 'Probabilidade %'],
          ['validadeAte', 'Válida até'], ['resultado', 'Resultado'], ['observacoes', 'Observações'],
        ] as Col[]))
        for (const it of n.items || []) {
          itemsByLead[n.leadId]?.push({
            'Negociação': fmt(n.titulo), 'Item': fmt(it.nome), 'Qtd': fmt(it.quantidade),
            'Preço unit.': fmt(it.precoUnit), 'Desconto': fmt(it.descontoItem), 'Subtotal': fmt(it.subtotal),
            'Cobrança': it.cobranca === 'recorrente' ? 'Mensalidade' : 'Pagamento único',
            'Parcelas': fmt(it.parcelas), 'Meses de contrato': fmt(it.recorrenciaMeses),
          })
        }
      }
      return [
        { key: 'negociacoes', label: 'Negociações', kind: 'table', byLead: negByLead,
          columns: ['Título', 'Status', 'Valor tabela', 'Desconto', 'Frete', 'Valor final', 'Pagamento', 'Parcelas', 'Probabilidade %', 'Válida até', 'Resultado', 'Observações'] },
        { key: 'negociacao_itens', label: 'Itens das negociações', kind: 'table', byLead: itemsByLead,
          columns: ['Negociação', 'Item', 'Qtd', 'Preço unit.', 'Desconto', 'Subtotal'] },
      ]
    },
  },
  {
    id: 'atividades', label: 'Atividades',
    collect: async (ctx) => [await tableBlock('atividades', 'Atividades', 'activity', ctx, [
      ['type', 'Tipo'], ['title', 'Título'], ['description', 'Descrição'], ['status', 'Status'],
      ['direction', 'Direção'], ['scheduledAt', 'Agendada'], ['completedAt', 'Concluída'],
      ['recipientPhone', 'Telefone'], ['recipientEmail', 'E-mail'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'cadencias', label: 'Cadências & envios',
    collect: async (ctx) => [
      await tableBlock('cadencias', 'Cadências', 'cadenceEnrollment', ctx, [
        ['cadenceId', 'Cadência'], ['status', 'Status'], ['currentStep', 'Passo atual'],
        ['nextActionAt', 'Próxima ação'], ['exitReason', 'Motivo de saída'], ['lastReplyClass', 'Última resposta'],
      ], { orderBy: { createdAt: 'asc' } }),
      await tableBlock('envios', 'Envios (outbound)', 'outboundSend', ctx, [
        ['channel', 'Canal'], ['recipient', 'Destinatário'], ['subject', 'Assunto'],
        ['bodyPreview', 'Prévia'], ['status', 'Status'], ['sentAt', 'Enviado'],
        ['deliveredAt', 'Entregue'], ['readAt', 'Lido'], ['error', 'Erro'],
      ], { orderBy: { createdAt: 'asc' } }),
    ],
  },
  {
    id: 'jornada', label: 'Jornada IA (sugestões de etapa)',
    collect: async (ctx) => [await tableBlock('jornada', 'Jornada IA', 'leadStageSuggestion', ctx, [
      ['createdAt', 'Data'], ['fromStageKey', 'De'], ['suggestedStageKey', 'Sugerido'],
      ['confidence', 'Confiança'], ['reasoning', 'Justificativa'], ['status', 'Status'], ['appliedAt', 'Aplicado'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'inteligencia', label: 'Inteligência / enriquecimento',
    collect: async (ctx) => [
      kvBlock('enriquecimento', 'Enriquecimento (resumo)', ctx, [
        ['Status', l => l.enrichmentStatus], ['Confiança (0-100)', l => l.enrichmentScore],
        ['Enriquecido em', l => l.enrichedAt], ['Consentimento LGPD', l => l.lgpdConsent],
      ]),
      await tableBlock('fatos', 'Fatos de enriquecimento', 'leadEnrichment', ctx, [
        ['source', 'Fonte'], ['field', 'Campo'], ['value', 'Valor'],
        ['confidence', 'Confiança'], ['status', 'Status'], ['fetchedAt', 'Coletado em'],
      ], { orderBy: { fetchedAt: 'asc' } }),
    ],
  },
  {
    id: 'tracking', label: 'Tracking, origem & UTM',
    collect: async (ctx) => [
      kvBlock('tracking', 'Origem & UTM', ctx, [
        ['Origem', l => l.source], ['ID de origem', l => l.sourceId], ['Tipo de origem', l => l.originType],
        ['Campanha', l => l.campaignName], ['Conjunto (adset)', l => l.adsetName], ['Anúncio', l => l.adName],
        ['Meta form', l => l.metaFormId], ['Meta page', l => l.metaPageId],
        ['utm_source', l => l.utmSource], ['utm_medium', l => l.utmMedium], ['utm_campaign', l => l.utmCampaign],
        ['utm_content', l => l.utmContent], ['utm_term', l => l.utmTerm], ['utm_id', l => l.utmId],
        ['gclid', l => l.gclid], ['fbclid', l => l.fbclid], ['ctwaClid', l => l.ctwaClid],
        ['Link rastreável (id)', l => l.trackableLinkId], ['Visitor de tracking', l => l.trackingVisitorId],
      ]),
      await tableBlock('origem_consolidada', 'Origem consolidada', 'leadOrigin', ctx, [
        ['originType', 'Tipo'], ['referralSource', 'Referral'], ['referralHeadline', 'Headline'],
        ['gclid', 'gclid'], ['utmSource', 'utm_source'], ['utmCampaign', 'utm_campaign'], ['confidence', 'Confiança'],
      ]),
      await tableBlock('touchpoints', 'Touchpoints (multi-touch)', 'leadTouchpoint', ctx, [
        ['timestamp', 'Data'], ['channel', 'Canal'], ['source', 'Origem'], ['medium', 'Meio'],
        ['campaign', 'Campanha'], ['touchType', 'Tipo (first/last)'],
      ], { orderBy: { timestamp: 'asc' } }),
      await tableBlock('conversoes', 'Eventos de conversão (CAPI)', 'conversionEvent', ctx, [
        ['eventName', 'Evento'], ['platform', 'Plataforma'], ['eventTime', 'Data'],
        ['value', 'Valor'], ['funnelStage', 'Etapa'], ['status', 'Status'], ['sentAt', 'Enviado'],
      ], { orderBy: { eventTime: 'asc' } }),
      await tableBlock('form_submissions', 'Submissões de formulário', 'formSubmission', ctx, [
        ['formId', 'Formulário'], ['pageSlug', 'Página'], ['referrer', 'Referrer'],
        ['utmSource', 'utm_source'], ['data', 'Dados'], ['createdAt', 'Data'],
      ], { orderBy: { createdAt: 'asc' } }),
      await tableBlock('meta_lead_logs', 'Logs Meta Lead Ads', 'metaLeadLog', ctx, [
        ['metaLeadId', 'Meta lead id'], ['metaFormId', 'Form'], ['status', 'Status'], ['processedAt', 'Processado'],
      ], { orderBy: { createdAt: 'asc' } }),
    ],
  },
  {
    id: 'auditoria', label: 'Auditoria de conversas (IA)',
    collect: async (ctx) => [await tableBlock('auditoria', 'Auditoria de conversas', 'conversationAudit', ctx, [
      ['createdAt', 'Data'], ['operatorName', 'Operador'], ['periodFrom', 'De'], ['periodTo', 'Até'],
      ['messageCount', 'Mensagens'], ['score', 'Nota'], ['tone', 'Tom'], ['responseTimeAvg', 'TMR médio'],
      ['scriptAdherence', 'Aderência ao script'], ['summary', 'Resumo'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'timeline', label: 'Timeline / histórico',
    collect: async (ctx) => [await tableBlock('timeline', 'Timeline / histórico', 'leadEvent', ctx, [
      ['createdAt', 'Data'], ['category', 'Categoria'], ['type', 'Tipo'], ['channel', 'Canal'],
      ['actorType', 'Autor (tipo)'], ['userName', 'Usuário'], ['title', 'Título'], ['description', 'Descrição'],
      ['oldValue', 'De'], ['newValue', 'Para'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'conversas', label: 'Mensagens / conversas',
    collect: async (ctx) => [await tableBlock('conversas', 'Mensagens', 'message', ctx, [
      ['timestamp', 'Data'], ['fromMe', 'Enviada por nós'], ['senderName', 'Remetente'],
      ['mediaType', 'Tipo'], ['body', 'Mensagem'], ['ack', 'Status'], ['provider', 'Canal'],
    ], { orderBy: { timestamp: 'asc' } })],
  },
  {
    id: 'reunioes', label: 'Reuniões (transcrição & análise)', module: 'meetings',
    collect: async (ctx) => [await tableBlock('reunioes', 'Reuniões', 'meetingRecording', ctx, [
      ['title', 'Título'], ['platform', 'Plataforma'], ['status', 'Status'], ['source', 'Modo'],
      ['startedAt', 'Início'], ['endedAt', 'Fim'], ['transcriptText', 'Transcrição'], ['analysis', 'Análise (IA)'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'ligacoes', label: 'Ligações (VoIP)',
    collect: async (ctx) => [await tableBlock('ligacoes', 'Ligações', 'voipCall', ctx, [
      ['startedAt', 'Data'], ['direction', 'Direção'], ['phone', 'Telefone'], ['provider', 'Provedor'],
      ['status', 'Status'], ['durationSec', 'Duração (s)'], ['userName', 'Operador'], ['recordingUrl', 'Gravação'],
    ], { orderBy: { startedAt: 'asc' } })],
  },
  {
    id: 'agendamentos', label: 'Agendamentos',
    collect: async (ctx) => [await tableBlock('agendamentos', 'Agendamentos', 'booking', ctx, [
      ['startAt', 'Início'], ['endAt', 'Fim'], ['status', 'Status'], ['inviteeName', 'Convidado'],
      ['inviteeEmail', 'E-mail'], ['inviteePhone', 'Telefone'], ['meetLink', 'Link'], ['confirmedAt', 'Confirmado'],
    ], { orderBy: { startAt: 'asc' } })],
  },
  {
    id: 'vendas', label: 'Vendas detectadas',
    collect: async (ctx) => [await tableBlock('vendas', 'Vendas detectadas', 'detectedSale', ctx, [
      ['detectedAt', 'Data'], ['value', 'Valor'], ['currency', 'Moeda'], ['productService', 'Produto/Serviço'],
      ['detectionMethod', 'Método'], ['confidence', 'Confiança'], ['status', 'Status'], ['aiExplanation', 'Explicação IA'],
    ], { orderBy: { detectedAt: 'asc' } })],
  },
  {
    id: 'anexos', label: 'Anexos',
    collect: async (ctx) => [await tableBlock('anexos', 'Anexos', 'leadAttachment', ctx, [
      ['createdAt', 'Data'], ['fileName', 'Arquivo'], ['mimeType', 'Tipo'], ['fileSize', 'Tamanho (bytes)'],
      ['uploadedByName', 'Enviado por'], ['description', 'Descrição'], ['storagePath', 'Caminho'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
  {
    id: 'lgpd', label: 'LGPD & consentimento',
    collect: async (ctx) => [
      kvBlock('lgpd', 'LGPD (resumo)', ctx, [
        ['Consentimento', l => l.lgpdConsent], ['Consentido em', l => l.lgpdConsentAt],
        ['Origem do consentimento', l => l.lgpdConsentSource], ['Não perturbe (canais)', l => l.optOutChannels],
      ]),
      await tableBlock('consent_logs', 'Logs de consentimento', 'consentLog', ctx, [
        ['createdAt', 'Data'], ['action', 'Ação'], ['categories', 'Categorias'],
        ['policyVersion', 'Política'], ['source', 'Origem'], ['url', 'URL'], ['ip', 'IP'],
      ], { orderBy: { createdAt: 'asc' } }),
      await tableBlock('dsr', 'Requisições de titular (direitos)', 'dataSubjectRequest', ctx, [
        ['createdAt', 'Data'], ['type', 'Tipo'], ['status', 'Status'], ['dueAt', 'Prazo'], ['handledAt', 'Tratado em'],
      ], { orderBy: { createdAt: 'asc' } }),
    ],
  },
  {
    id: 'duplicados', label: 'Duplicados',
    collect: async (ctx) => [
      kvBlock('duplicados', 'Duplicidade', ctx, [
        ['Status de duplicidade', l => l.duplicateStatus], ['Possível duplicata de (id)', l => l.possibleDuplicateOfId],
        ['Casou por', l => l.duplicateMatchedBy], ['Marcado em', l => l.duplicateFlaggedAt],
        ['Resolvido em', l => l.duplicateResolvedAt],
      ]),
    ],
  },
  {
    id: 'educacional', label: 'Matrículas & inscrições',
    collect: async (ctx) => [
      await tableBlock('inscricoes_processo', 'Inscrições em processo seletivo', 'processRegistration', ctx, [
        ['codigo', 'Código'], ['status', 'Status'], ['inscritoEm', 'Inscrito em'],
        ['notaClassificacao', 'Nota'], ['posicaoClassificacao', 'Posição'], ['valorPago', 'Valor pago'],
      ], { orderBy: { createdAt: 'asc' } }),
      await tableBlock('matriculas', 'Inscrições/Matrículas', 'enrollmentRegistration', ctx, [
        ['candidateCode', 'Código'], ['status', 'Status'], ['paymentStatus', 'Pagamento'],
        ['paymentAmount', 'Valor'], ['paymentMethod', 'Método'], ['paidAt', 'Pago em'],
      ], { orderBy: { createdAt: 'asc' } }),
    ],
  },
  {
    id: 'transferencias', label: 'Transferências',
    collect: async (ctx) => [await tableBlock('transferencias', 'Transferências', 'leadTransferRequest', ctx, [
      ['requestedAt', 'Solicitada'], ['fromUserId', 'De (userId)'], ['toUserId', 'Para (userId)'],
      ['status', 'Status'], ['reason', 'Motivo'], ['response', 'Resposta'], ['respondedAt', 'Respondida'],
    ], { orderBy: { requestedAt: 'asc' } })],
  },
  {
    id: 'campanhas', label: 'Campanhas & broadcast',
    collect: async (ctx) => [
      await tableBlock('broadcast', 'Destinatário de broadcast', 'broadcastRecipient', ctx, [
        ['campaignId', 'Campanha'], ['phone', 'Telefone'], ['status', 'Status'],
        ['skipReason', 'Motivo skip'], ['sentAt', 'Enviado'], ['deliveredAt', 'Entregue'], ['readAt', 'Lido'],
      ], { orderBy: { createdAt: 'asc' } }),
      await tableBlock('cloud_api_logs', 'Mensagens Cloud API (WhatsApp)', 'cloudApiMessageLog', ctx, [
        ['createdAt', 'Data'], ['direction', 'Direção'], ['category', 'Categoria'], ['status', 'Status'],
        ['templateName', 'Template'], ['billable', 'Cobrável'], ['errorTitle', 'Erro'],
      ], { orderBy: { createdAt: 'asc' } }),
    ],
  },
  {
    id: 'automacoes', label: 'Automações (workflows)',
    collect: async (ctx) => [await tableBlock('automacoes', 'Execuções de workflow', 'workflowExecution', ctx, [
      ['workflowId', 'Workflow'], ['status', 'Status'], ['currentStepId', 'Passo atual'],
      ['pausedAt', 'Pausado'], ['completedAt', 'Concluído'],
    ], { orderBy: { createdAt: 'asc' } })],
  },
]

export const ALL_SECTION_IDS = GROUPS.map(g => g.id)

// Lista de seções p/ o seletor do frontend (id + rótulo + módulo de gating).
export function listSections() {
  return GROUPS.map(g => ({ id: g.id, label: g.label, module: g.module ?? null }))
}

// ── Coleta principal ────────────────────────────────────────────────────────
export async function collectDossier(leadIds: number[], sectionIds: string[]): Promise<Dossier> {
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    include: { funnel: true, assignedUser: true, team: true, lostReason: true },
  })
  const leadsById = new Map<number, any>(leads.map(l => [l.id, l]))
  // Preserva a ordem pedida.
  const orderedLeads = leadIds.map(id => leadsById.get(id)).filter(Boolean)
  const ctx: Ctx = { leadIds: orderedLeads.map(l => l.id), leadsById }

  const wanted = new Set(sectionIds.length ? sectionIds : ALL_SECTION_IDS)
  const blocks: Block[] = []
  for (const g of GROUPS) {
    if (!wanted.has(g.id)) continue
    try {
      const bs = await g.collect(ctx)
      blocks.push(...bs)
    } catch (e: any) {
      console.warn(`[leadExport] seção ${g.id} falhou:`, e?.message)
    }
  }

  return {
    generatedAt: new Date(),
    leads: orderedLeads.map(l => ({ id: l.id, uid: l.uid || `#${l.id}`, nome: l.nome, empresa: l.empresa })),
    blocks,
  }
}
