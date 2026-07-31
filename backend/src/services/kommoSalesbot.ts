// src/services/kommoSalesbot.ts
//
// Importação dos Salesbots da Kommo para o motor de chatbot do bychat.
//
// POR QUE PRECISA COLAR O CÓDIGO-FONTE:
// A API pública da Kommo (api/v4) só expõe METADADOS dos bots — GET /api/v4/bots
// devolve id, nome, tipo e settings.active, e GET /api/v4/bots/:id não devolve os
// passos (testado: `?with=steps` é ignorado, /steps → 404, /ajax/* → 403 "private
// API"). O roteiro só sai pelo painel: editor do Salesbot → "Ver código-fonte".
//
// FORMATO REAL DO EXPORT (verificado nos 12 bots do ineprotec):
//   { "type_functionality": 0, "model": { "text": "<STRING com JSON>" } }
// e essa string é um MAPA de passos indexado por número:
//   { "0": { "question": [ {handler, params}, … ], "block_uuid": "…" },
//     "3": { "question": [ …list_message… ], "answer": [ {handler:"buttons", …} ] },
//     "conversation": true  ← chaves não numéricas existem e não são passos }
// O fluxo NÃO é a ordem das chaves: cada passo termina em `goto` apontando o
// próximo, e menus ramificam via `answer.buttons` (callback_data → step).
//
// COMO CONVERTE:
// Um chatbot que roda de verdade no bychat é `mode='scripted'` + Form vinculado
// (o runner scriptedChatbotFlow.ts lê perguntas/qualificação do form). Então um
// Salesbot conversacional vira: Form (menu como campo select, cada opção com
// `route`) + Chatbot inativo. As mensagens antes do menu viram greetingMessage e
// a mensagem de cada ramo vira o `confirmText` daquela opção.
// Os IDs da Kommo nos ramos (pipeline/status/usuário) são traduzidos para
// funil/etapa/usuário locais pelos KommoMapping já importados.
//
// O que não é conversa (distribuição, tarefas, timers, campos, webhooks) NÃO é
// inventado: sai no relatório. Bots que só têm automação (distribuição de leads,
// cadência, traqueio) são marcados como `kind='automation'` e não viram chatbot.

import { prisma } from '../lib/prisma.js'
import { kommoFetch, type KommoConfig } from '../lib/kommoClient.js'

// ── Lista de bots (API pública) ───────────────────────────────────────────────

export interface KommoBot {
  id: number
  name: string
  typeFunctionality: string | null
  active: boolean
}

/** Lista todos os Salesbots da conta Kommo (GET /api/v4/bots, paginado). */
export async function listKommoBots(cfg?: KommoConfig): Promise<KommoBot[]> {
  const out: KommoBot[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await kommoFetch(`/bots?limit=250&page=${page}`, cfg)
    const items: any[] = res?._embedded?.items ?? []
    for (const b of items) {
      out.push({
        id: Number(b.id),
        name: String(b.name ?? `Bot ${b.id}`),
        typeFunctionality: b.type_functionality ?? null,
        active: b?.settings?.active === true,
      })
    }
    if (items.length === 0 || !res?._links?.next) break
  }
  return out
}

// ── Desempacotamento do export ────────────────────────────────────────────────

type StepMap = Record<string, any>

/** Aceita o export do painel (`model.text` como string) ou o mapa de passos cru. */
export function unwrapSalesbotSource(raw: string): StepMap {
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('O código-fonte colado não é um JSON válido.')
  }
  let steps: any = data
  if (data && typeof data === 'object' && data.model) {
    const text = data.model.text
    if (typeof text === 'string') {
      try {
        steps = JSON.parse(text)
      } catch {
        throw new Error('O campo model.text do export não contém um JSON válido.')
      }
    } else {
      steps = data.model
    }
  }
  if (!steps || typeof steps !== 'object' || Array.isArray(steps)) {
    throw new Error('Não reconheci o formato: esperava o mapa de passos do Salesbot.')
  }
  // Chaves não numéricas ("conversation": true) não são passos.
  const out: StepMap = {}
  for (const [k, v] of Object.entries(steps)) {
    if (/^\d+$/.test(k) && v && typeof v === 'object') out[k] = v
  }
  if (Object.keys(out).length === 0) throw new Error('Nenhum passo encontrado no código-fonte.')
  return out
}

// ── Macros ────────────────────────────────────────────────────────────────────

const MACRO_MAP: Array<[RegExp, string]> = [
  [/\{\{\s*(lead|contact)\.name\s*\}\}/gi, '{{nome}}'],
  [/\{\{\s*contact\.first_name\s*\}\}/gi, '{{nome}}'],
  [/\{\{\s*(lead|contact)\.phone\s*\}\}/gi, '{{whatsapp}}'],
  [/\{\{\s*(lead|contact)\.email\s*\}\}/gi, '{{email}}'],
  [/\{\{\s*manager\.name\s*\}\}/gi, '{{responsavel}}'],
]

export function normalizeMacros(input: string): string {
  let s = String(input ?? '')
  for (const [re, to] of MACRO_MAP) s = s.replace(re, to)
  s = s.replace(/\{\{[^}]*\}\}/g, (m) => (/^\{\{(nome|whatsapp|email|responsavel)\}\}$/.test(m) ? m : ''))
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Caminhada pelo grafo ──────────────────────────────────────────────────────

interface Collected {
  messages: string[]
  /** Mensagens seguidas de espera por resposta do lead → viram campo do form. */
  questions: string[]
  statusChanges: Array<{ pipelineId: number | null; statusId: number }>
  responsibleUsers: number[]
  tasks: string[]
  waits: number[] // delays em segundos
  other: Map<string, { handler: string; detail: string; count: number }>
}

function newCollected(): Collected {
  return { messages: [], questions: [], statusChanges: [], responsibleUsers: [], tasks: [], waits: [], other: new Map() }
}

function note(col: Collected, handler: string, detail: string) {
  const cur = col.other.get(handler)
  if (cur) cur.count++
  else col.other.set(handler, { handler, detail, count: 1 })
}

/** Menu encontrado durante a caminhada: enunciado + opções com o step de destino. */
interface Menu {
  label: string
  options: Array<{ label: string; callbackData: string | null; step: string | null; synonyms: string[] }>
}

/**
 * Caminha a partir de `start` seguindo `goto`, coletando o que encontra.
 * Para ao chegar num passo com menu (list_message/buttons) — devolvido em `menu`
 * — ou quando não há mais para onde ir. `visited` corta ciclos.
 */
function walk(steps: StepMap, start: string, col: Collected, visited: Set<string>, stopAtMenu: boolean): Menu | null {
  let cursor: string | null = start
  while (cursor != null && steps[cursor] && !visited.has(cursor)) {
    visited.add(cursor)
    const step: any = steps[cursor]
    let next: string | null = null

    // ── menu? (list_message no question + buttons no answer) ──
    const menu = extractMenu(step)
    if (menu && stopAtMenu) return menu

    // `question` é o que o bot executa; `finish` encerra o bloco. O `answer` só
    // é lido para menus (extractMenu) — aqui pegamos os handlers de execução.
    const handlers: any[] = [...(step.question ?? []), ...(step.finish ?? [])]
    for (const h of handlers) {
      if (!h || typeof h !== 'object') continue
      const p = h.params ?? {}
      switch (h.handler) {
        case 'send_message': {
          const t = normalizeMacros(String(p.text ?? ''))
          if (t) col.messages.push(t)
          break
        }
        case 'goto':
          next = p.step != null ? String(p.step) : null
          break
        case 'action': {
          if (p.name === 'change_status') {
            const v = Number(p.params?.value)
            if (Number.isFinite(v)) col.statusChanges.push({ pipelineId: p.params?.pipeline_id != null ? Number(p.params.pipeline_id) : null, statusId: v })
          } else if (p.name === 'change_responsible_user') {
            const v = Number(p.params?.value)
            if (Number.isFinite(v) && !col.responsibleUsers.includes(v)) col.responsibleUsers.push(v)
          } else if (p.name === 'set_custom_fields') {
            note(col, 'action:set_custom_fields', 'gravação de campo personalizado')
          } else {
            note(col, `action:${p.name ?? '?'}`, JSON.stringify(p.params ?? {}).slice(0, 120))
          }
          break
        }
        case 'distribution': {
          // Round-robin entre variantes: cada variante é um ramo que atribui um usuário.
          const variants: any[] = Array.isArray(p.variants) ? p.variants : []
          for (const v of variants) {
            const s = v?.step != null ? String(v.step) : null
            if (s) walk(steps, s, col, visited, false)
          }
          break
        }
        case 'trigger': {
          const text = p?.trigger?.settings?.task_text
          if (p?.trigger?.action === 'create_task' && text) col.tasks.push(String(text))
          else note(col, 'trigger', String(p?.trigger?.action ?? 'gatilho'))
          break
        }
        case 'waits': {
          const conds: any[] = Array.isArray(p.conditions) ? p.conditions : []
          // Espera por MENSAGEM = o bot aguarda a resposta do lead: a última coisa
          // que ele enviou era, na verdade, uma pergunta.
          const waitsForReply = conds.some((c: any) => c?.event?.source === 'message')
          if (waitsForReply && col.messages.length > 0) col.questions.push(col.messages.pop()!)
          for (const c of conds) {
            const delay = Number(c?.event?.delay)
            if (Number.isFinite(delay)) col.waits.push(delay)
            // Segue o ramo da resposta do lead (não o do timeout, que é desistência).
            const s = c?.action?.step != null ? String(c.action.step) : null
            if (s && (next == null || c?.event?.source === 'message')) next = s
          }
          break
        }
        // Condicionais/validações: seguimos o ramo "verdadeiro" (params.result) para
        // não perder o resto do fluxo; a lógica em si vai pro relatório.
        case 'conditions':
        case 'validations': {
          const result: any[] = Array.isArray(p.result) ? p.result : []
          const g = result.find((x: any) => x?.handler === 'goto')
          if (g?.params?.step != null && next == null) next = String(g.params.step)
          note(col, h.handler, JSON.stringify(p.conditions ?? {}).slice(0, 120))
          break
        }
        case '_stop':
          next = null
          break
        default:
          if (typeof h.handler === 'string') note(col, h.handler, JSON.stringify(p).slice(0, 120))
      }
    }

    cursor = next
  }
  return null
}

/** Lê o menu de um passo: enunciado (list_message) + destinos (answer.buttons). */
function extractMenu(step: any): Menu | null {
  let label = ''
  const rows: Array<{ title: string; cb: string | null }> = []

  for (const h of (step.question ?? []) as any[]) {
    const p = h?.params ?? {}
    const lm = p.list_message ?? (h?.handler === 'list_message' ? p : null)
    if (lm) {
      label = normalizeMacros(String(lm.body ?? lm.text ?? ''))
      for (const sec of (lm.sections ?? []) as any[]) {
        for (const r of (sec?.rows ?? []) as any[]) {
          rows.push({ title: normalizeMacros(String(r?.title ?? '')), cb: r?.callback_data != null ? String(r.callback_data) : null })
        }
      }
    }
    // Botões simples (não-lista): params.buttons = ["A","B"]
    if (Array.isArray(p.buttons) && p.buttons.length > 0 && rows.length === 0) {
      if (!label) label = normalizeMacros(String(p.text ?? p.value ?? ''))
      for (const b of p.buttons) {
        const title = typeof b === 'string' ? b : String(b?.title ?? b?.text ?? '')
        rows.push({ title: normalizeMacros(title), cb: typeof b === 'object' ? (b?.callback_data ?? null) : null })
      }
    }
  }
  if (rows.length === 0) return null

  // answer.buttons: mapeia callback_data → step de destino (+ sinônimos digitados).
  const dest = new Map<string, { step: string | null; synonyms: string[] }>()
  for (const h of (step.answer ?? []) as any[]) {
    if (h?.handler !== 'buttons' || !Array.isArray(h.params)) continue
    for (const b of h.params) {
      const gotos = (b?.params ?? []).filter((x: any) => x?.handler === 'goto')
      const target = gotos.length > 0 && gotos[0]?.params?.step != null ? String(gotos[0].params.step) : null
      const key = b?.type === 'else' ? '__else__' : String(b?.value ?? '')
      dest.set(key, { step: target, synonyms: Array.isArray(b?.synonyms) ? b.synonyms.map(String) : [] })
    }
  }

  return {
    label: label || 'Escolha uma opção:',
    options: rows.map((r) => {
      const d = (r.cb && dest.get(r.cb)) || null
      return { label: r.title, callbackData: r.cb, step: d?.step ?? null, synonyms: d?.synonyms ?? [] }
    }),
  }
}

// ── Plano de importação ───────────────────────────────────────────────────────

export interface PlanOption {
  value: string
  label: string
  route?: {
    funnelId?: number | null
    stageKey?: string | null
    teamId?: number | null
    userIds?: number[]
    confirmText?: string
  }
  /** Só pro relatório: o que o ramo fazia na Kommo e não coube no route. */
  branchNotes: string[]
}

export interface ImportPlan {
  kind: 'chatbot' | 'automation'
  greetingMessage: string
  completionMessage: string
  fields: any[]
  questionCount: number
  options: PlanOption[]
  unsupported: Array<{ handler: string; detail: string; count: number }>
  notes: string[]
  /** Resumo do que o bot faz quando é pura automação (kind='automation'). */
  automationSummary: string[]
}

interface Refs {
  funnelByPipeline: Map<string, number>
  stageByStatus: Map<string, { funnelId: number | null; key: string; name: string }>
  userByKommo: Map<string, number>
  teamByUser: Map<number, number>
  userNames: Map<number, string>
}

/** Carrega os mapeamentos Kommo→local já importados (pipeline/status/usuário). */
async function loadRefs(): Promise<Refs> {
  const rows = await prisma.kommoMapping.findMany({
    where: { entityType: { in: ['pipeline', 'status', 'user'] } },
    select: { entityType: true, kommoId: true, localId: true, meta: true },
  })
  const funnelByPipeline = new Map<string, number>()
  const stageByStatus = new Map<string, { funnelId: number | null; key: string; name: string }>()
  const userByKommo = new Map<string, number>()
  for (const r of rows) {
    const meta = (r.meta ?? {}) as any
    if (r.entityType === 'pipeline') funnelByPipeline.set(r.kommoId, r.localId)
    else if (r.entityType === 'status') {
      stageByStatus.set(r.kommoId, {
        funnelId: meta.pipelineId != null ? funnelByPipeline.get(String(meta.pipelineId)) ?? null : null,
        key: String(meta.key ?? `kommo_${r.kommoId}`),
        name: String(meta.name ?? ''),
      })
    } else if (r.entityType === 'user') userByKommo.set(r.kommoId, r.localId)
  }
  // status pode ter sido lido antes do pipeline — resolve o funil agora.
  for (const [kommoId, st] of stageByStatus) {
    if (st.funnelId == null) {
      const meta = rows.find((r) => r.entityType === 'status' && r.kommoId === kommoId)?.meta as any
      if (meta?.pipelineId != null) st.funnelId = funnelByPipeline.get(String(meta.pipelineId)) ?? null
    }
  }

  const localUserIds = [...userByKommo.values()]
  const [members, users] = await Promise.all([
    localUserIds.length ? prisma.teamMember.findMany({ where: { userId: { in: localUserIds } }, select: { userId: true, teamId: true } }) : Promise.resolve([]),
    localUserIds.length ? prisma.user.findMany({ where: { id: { in: localUserIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  return {
    funnelByPipeline,
    stageByStatus,
    userByKommo,
    teamByUser: new Map(members.map((m) => [m.userId, m.teamId])),
    userNames: new Map(users.map((u) => [u.id, u.name])),
  }
}

function slugKey(text: string, fallback: string): string {
  const s = String(text ?? '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return s || fallback
}

function mergeOther(target: Map<string, { handler: string; detail: string; count: number }>, src: Collected['other']) {
  for (const [k, v] of src) {
    const cur = target.get(k)
    if (cur) cur.count += v.count
    else target.set(k, { ...v })
  }
}

function humanDelay(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}min`
  return `${seconds}s`
}

/** Converte o código-fonte em um plano pronto pra revisão (resolve IDs locais). */
export async function planFromSource(raw: string): Promise<ImportPlan> {
  const steps = unwrapSalesbotSource(raw)
  const refs = await loadRefs()

  const startKey = Object.keys(steps).sort((a, b) => Number(a) - Number(b))[0]!
  const head = newCollected()
  const visited = new Set<string>()
  const menu = walk(steps, startKey, head, visited, true)

  const unsupported = new Map<string, { handler: string; detail: string; count: number }>()
  mergeOther(unsupported, head.other)
  const notes: string[] = []
  const automationSummary: string[] = []

  // Ações do trecho ANTES do menu (responsável inicial, etapa, tarefas, esperas).
  const describeCollected = (c: Collected, prefix: string) => {
    for (const st of c.statusChanges) {
      const s = refs.stageByStatus.get(String(st.statusId))
      automationSummary.push(`${prefix}move o lead para a etapa "${s?.name ?? `status ${st.statusId}`}"`)
    }
    for (const u of c.responsibleUsers) {
      const local = refs.userByKommo.get(String(u))
      automationSummary.push(`${prefix}atribui o responsável ${local ? refs.userNames.get(local) ?? `#${local}` : `(usuário Kommo ${u})`}`)
    }
    for (const t of c.tasks) automationSummary.push(`${prefix}cria tarefa: "${t}"`)
    for (const w of c.waits) automationSummary.push(`${prefix}aguarda ${humanDelay(w)}`)
  }
  describeCollected(head, '')

  const greeting = head.messages.join('\n\n')

  // ── Sem menu: ou é um roteiro linear (mensagens + perguntas), ou é só automação ──
  if (!menu) {
    // Percorre o que sobrou para descrever o que o bot faz fora do caminho principal.
    const rest = newCollected()
    for (const key of Object.keys(steps)) if (!visited.has(key)) walk(steps, key, rest, visited, false)
    mergeOther(unsupported, rest.other)
    describeCollected(rest, '')

    const questions = [...head.questions, ...rest.questions]
    const strayMessages = rest.messages
    const linearFields = questions.map((q, i) => ({
      id: `kb_${i + 1}`,
      key: slugKey(q, `pergunta_${i + 1}`),
      type: /\b(de\s*1\s*a\s*10|nota|quantos?)\b/i.test(q) ? 'number' : 'text',
      label: q,
      required: true,
    }))

    const linearNotes: string[] = []
    if (strayMessages.length > 0) {
      linearNotes.push(`${strayMessages.length} mensagem(ns) em ramos que não entraram no roteiro: ` +
        strayMessages.map((m) => `"${m.slice(0, 60)}"`).join(' | '))
    }

    if (linearFields.length === 0 && !greeting) {
      return {
        kind: 'automation',
        greetingMessage: '',
        completionMessage: '',
        fields: [],
        questionCount: 0,
        options: [],
        unsupported: [...unsupported.values()],
        notes: ['Este bot não conversa: ele só executa automações de CRM. No bychat isso é roteamento de equipe / Workflow, não chatbot.', ...linearNotes],
        automationSummary: [...new Set(automationSummary)],
      }
    }

    return {
      kind: 'chatbot',
      greetingMessage: greeting,
      completionMessage: '',
      fields: linearFields,
      questionCount: linearFields.length,
      options: [],
      unsupported: [...unsupported.values()],
      notes: [
        ...(linearFields.length === 0 ? ['O bot envia mensagem mas não faz perguntas — vira um chatbot só de saudação.'] : []),
        ...linearNotes,
      ],
      automationSummary: [...new Set(automationSummary)],
    }
  }

  // ── Com menu: cada opção vira uma opção do campo select, com route ──
  const options: PlanOption[] = []
  for (const opt of menu.options) {
    const col = newCollected()
    const branchNotes: string[] = []
    if (opt.step) walk(steps, opt.step, col, new Set(), false)
    mergeOther(unsupported, col.other)

    const route: NonNullable<PlanOption['route']> = {}
    const st = col.statusChanges[0]
    if (st) {
      const mapped = refs.stageByStatus.get(String(st.statusId))
      if (mapped) {
        route.funnelId = mapped.funnelId ?? (st.pipelineId != null ? refs.funnelByPipeline.get(String(st.pipelineId)) ?? null : null)
        route.stageKey = mapped.key
        branchNotes.push(`etapa → ${mapped.name}`)
      } else {
        branchNotes.push(`etapa da Kommo (status ${st.statusId}) não está mapeada aqui — configure a etapa manualmente`)
      }
    }
    if (col.statusChanges.length > 1) branchNotes.push(`o ramo mudava de etapa ${col.statusChanges.length}× — só a primeira foi aplicada`)

    const localUsers = col.responsibleUsers.map((u) => refs.userByKommo.get(String(u))).filter((v): v is number => Number.isFinite(v as number))
    if (localUsers.length > 0) {
      const teams = [...new Set(localUsers.map((u) => refs.teamByUser.get(u)).filter((t): t is number => t != null))]
      if (teams.length === 1 && localUsers.every((u) => refs.teamByUser.get(u) === teams[0])) {
        route.teamId = teams[0]
        branchNotes.push(`atendimento → equipe (${localUsers.map((u) => refs.userNames.get(u) ?? `#${u}`).join(', ')})`)
      } else {
        route.userIds = localUsers
        branchNotes.push(`responsável → ${localUsers.map((u) => refs.userNames.get(u) ?? `#${u}`).join(' / ')}${localUsers.length > 1 ? ' (rodízio)' : ''}`)
      }
    }
    const unmapped = col.responsibleUsers.filter((u) => !refs.userByKommo.has(String(u)))
    if (unmapped.length > 0) branchNotes.push(`usuário(s) da Kommo sem correspondente aqui: ${unmapped.join(', ')}`)

    if (col.messages.length > 0) {
      route.confirmText = col.messages.join('\n\n')
    }
    for (const t of col.tasks) branchNotes.push(`criava tarefa "${t}" (não convertido)`)
    for (const w of col.waits) branchNotes.push(`aguardava ${humanDelay(w)} (não convertido)`)

    options.push({
      value: slugKey(opt.label, `opcao_${options.length + 1}`),
      label: opt.label,
      route: Object.keys(route).length > 0 ? route : undefined,
      // O rodízio repete o mesmo ramo em variantes; sem dedup o relatório duplica.
      branchNotes: [...new Set(branchNotes)],
    })
  }

  const field: any = {
    id: 'kb_menu',
    key: slugKey(menu.label, 'menu'),
    type: 'select',
    label: menu.label,
    required: true,
    options: options.map((o) => ({ value: o.value, label: o.label, ...(o.route ? { route: o.route } : {}) })),
  }

  if (head.waits.length > 0) {
    notes.push(`O bot esperava ${head.waits.map(humanDelay).join(', ')} antes do menu — o chatbot envia na sequência.`)
  }
  if (head.responsibleUsers.length > 0) {
    const names = head.responsibleUsers.map((u) => {
      const l = refs.userByKommo.get(String(u))
      return l ? refs.userNames.get(l) ?? `#${l}` : `Kommo ${u}`
    })
    notes.push(`Responsável inicial na Kommo: ${names.join(', ')} — no bychat defina o responsável/equipe padrão do chatbot.`)
  }

  return {
    kind: 'chatbot',
    greetingMessage: greeting,
    completionMessage: '',
    fields: [field],
    questionCount: 1,
    options,
    unsupported: [...unsupported.values()],
    notes,
    automationSummary: [...new Set(automationSummary)],
  }
}

// ── Gravação ──────────────────────────────────────────────────────────────────

export interface ImportOptions {
  kommoBotId: number
  name: string
  source: string
  channel?: string
  funnelId?: number | null
  stageKey?: string | null
  defaultTeamId?: number | null
}

export interface ImportResult {
  formId: number
  chatbotId: number
  plan: ImportPlan
  reimported: boolean
}

/**
 * Cria o Form + Chatbot correspondentes a um Salesbot. O chatbot nasce INATIVO —
 * quem liga é o operador, depois de revisar. Reimportar recria e reaponta o mapeamento.
 */
export async function importSalesbot(opts: ImportOptions): Promise<ImportResult> {
  const plan = await planFromSource(opts.source)
  if (plan.kind === 'automation') {
    throw new Error('Esse bot não conversa — só executa automações de CRM (distribuição, tarefas, campos). Não há chatbot a criar; use roteamento de equipe/Workflow.')
  }
  if (plan.fields.length === 0 && !plan.greetingMessage) {
    throw new Error('Não foi possível extrair nenhuma mensagem ou pergunta desse código-fonte.')
  }

  const existing = await prisma.kommoMapping.findUnique({
    where: { entityType_kommoId: { entityType: 'bot', kommoId: String(opts.kommoBotId) } },
  })

  const name = opts.name.slice(0, 191)
  const settings = {
    displayMode: 'conversational',
    submitText: 'Enviar',
    successMode: 'message',
    successTitle: 'Tudo certo!',
    successMessage: plan.completionMessage || 'Recebemos suas respostas.',
    journey: { partialCapture: true },
    conversational: {
      welcomeEnabled: false,
      welcomeTitle: name,
      welcomeText: plan.greetingMessage,
      startButtonText: 'Começar',
      navButtonText: 'Continuar',
      showProgress: true,
    },
  }

  const created = await prisma.$transaction(async (tx) => {
    const form = await tx.form.create({
      data: {
        // Evita "Fulano (Kommo) (Kommo)" quando o operador já nomeia com o sufixo.
        name: (/\bkommo\b/i.test(name) ? name : `${name} (Kommo)`).slice(0, 191),
        fields: plan.fields,
        settings,
        styling: {},
        funnelId: opts.funnelId ?? null,
        stageKey: opts.stageKey ?? null,
        defaultTeamId: opts.defaultTeamId ?? null,
        active: true,
      },
    })

    const chatbot = await tx.chatbot.create({
      data: {
        name,
        channel: opts.channel || 'whatsapp',
        mode: 'scripted',
        formId: form.id,
        active: false, // sempre inativo — o operador revisa e liga
        funnelId: opts.funnelId ?? null,
        defaultTeamId: opts.defaultTeamId ?? null,
        systemPrompt: '',
        extractionPrompt: '',
        analysisPrompt: '',
        greetingMessage: plan.greetingMessage,
        completionMessage: plan.completionMessage,
      },
    })

    await tx.kommoMapping.upsert({
      where: { entityType_kommoId: { entityType: 'bot', kommoId: String(opts.kommoBotId) } },
      create: {
        entityType: 'bot',
        kommoId: String(opts.kommoBotId),
        localId: chatbot.id,
        meta: { formId: form.id, name, importedAt: new Date().toISOString(), unsupported: plan.unsupported, notes: plan.notes },
      },
      update: {
        localId: chatbot.id,
        meta: { formId: form.id, name, importedAt: new Date().toISOString(), unsupported: plan.unsupported, notes: plan.notes },
      },
    })

    return { formId: form.id, chatbotId: chatbot.id }
  })

  return { ...created, plan, reimported: Boolean(existing) }
}

/** Chatbots já importados da Kommo, por id do bot na Kommo. */
export async function getImportedBots(): Promise<Map<string, { chatbotId: number; meta: any }>> {
  const rows = await prisma.kommoMapping.findMany({
    where: { entityType: 'bot' },
    select: { kommoId: true, localId: true, meta: true },
  })
  return new Map(rows.map((r) => [r.kommoId, { chatbotId: r.localId, meta: r.meta }]))
}
