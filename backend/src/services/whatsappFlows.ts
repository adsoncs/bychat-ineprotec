// src/services/whatsappFlows.ts
//
// WhatsApp Flows ESTÁTICOS (sem endpoint/criptografia). Gera, a partir de um Form,
// um Flow JSON (TextInput / TextArea / Dropdown / RadioButtonsGroup) cujas respostas
// voltam de uma vez no `nfm_reply` do webhook. Cobre o caso "formulário dentro do
// WhatsApp" (cadastro/intake, pesquisa de satisfação) sem precisar de endpoint
// público nem RSA/AES.
//
// Dois formatos:
//   - TELA ÚNICA (padrão): todos os campos numa tela terminal. É o que os forms de
//     captação usam hoje.
//   - MULTI-TELA (opts.multiScreen): uma tela por seção, quebrando nos campos
//     `statement`. Cada tela navega para a próxima levando no payload tudo o que já
//     foi coletado; a última completa o Flow com o conjunto inteiro. Serve a
//     questionários longos (NPS/pesquisa), onde 11 perguntas numa tela só viram um
//     paredão de rolagem.
//
// Fluxo de publicação (acionado pelo admin no painel):
//   1. POST /{wabaId}/flows           → cria rascunho
//   2. POST /{flowId}/assets (FLOW_JSON, multipart) → sobe o Flow JSON
//   3. POST /{flowId}/publish         → publica
// Para enviar: interactive type:'flow' com flow_id + flow_token (buildFlowSendPayload).

import { decryptToken, cloudApiFetch } from './cloudApi.js'
import { scaleRange, scaleValueLabel } from './formFlow.js'

// Versão do Flow JSON. Se a Meta rejeitar na publicação, ajuste aqui (o erro de
// validação é exibido ao admin, pois a publicação é acionada por ele).
const FLOW_JSON_VERSION = '7.0'
const GRAPH_URL = 'https://graph.facebook.com/v22.0'

// Tipos de campo de form que viram input no Flow (os demais são ignorados).
const SKIP_TYPES = new Set(['statement', 'scheduling', 'hidden'])
const INPUT_TYPE: Record<string, string> = { text: 'text', email: 'email', phone: 'phone', number: 'number', url: 'text' }

function stripTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
function trunc(s: string | null | undefined, n: number): string {
  const v = String(s ?? '').trim()
  return v.length <= n ? v : v.slice(0, n - 1) + '…'
}

// Nome do campo no Flow (identificador válido). Determinístico → usado também na
// ingestão para casar a resposta de volta ao field.key do form.
export function flowFieldName(key: string): string {
  let n = String(key || '').replace(/[^a-zA-Z0-9_]/g, '_')
  if (!n || /^[0-9]/.test(n)) n = 'f_' + n
  return n.slice(0, 40)
}

// Quais campos do form entram no Flow (input-collecting).
export function flowInputFields(form: any): any[] {
  const fields: any[] = Array.isArray(form?.fields) ? form.fields : []
  return fields.filter((f) => f && !SKIP_TYPES.has(f.type))
}

// Override editável por campo (editor visual), desacoplado do form.
export interface FlowFieldConfig { key: string; label?: string; include?: boolean; required?: boolean }

// Limites da Meta respeitados aqui (Flow JSON reference):
//   label de input/radio ≤ 30 | title de opção ≤ 30 | RadioButtonsGroup ≤ 20 opções
//   TextSubheading ≤ 80 | componentes por tela ≤ 50 | título de tela ≤ 30
const LABEL_MAX = 30
const SUBHEADING_MAX = 80
const BODY_MAX = 300
const OPTION_TITLE_MAX = 30
const RADIO_MAX_OPTIONS = 20
const SCREEN_TITLE_MAX = 30
// Cada pergunta gasta até 2 componentes (texto da pergunta + input) e a tela ainda
// leva cabeçalho e rodapé. 20 perguntas = 43 componentes, dentro do teto de 50.
const MAX_INPUTS_PER_SCREEN = 20

/** Componentes de UMA pergunta: o texto (quando o rótulo não cabe no label) + o input. */
function fieldComponents(f: any, cfg: FlowFieldConfig | undefined): { comps: any[]; name: string } {
  const comps: any[] = []
  const name = flowFieldName(f.key)
  const required = cfg?.required ?? !!f.required
  const fullLabel = stripTags(cfg?.label ?? f.label) || f.key

  // Rótulo longo (> 30) → o texto da pergunta sai acima do input, em vez de ser
  // cortado no meio: subtítulo até 80 caracteres, corpo de texto acima disso.
  let label = fullLabel
  if (fullLabel.length > LABEL_MAX) {
    comps.push(fullLabel.length <= SUBHEADING_MAX
      ? { type: 'TextSubheading', text: fullLabel }
      : { type: 'TextBody', text: trunc(fullLabel, BODY_MAX) })
    label = f.type === 'scale' ? 'Sua nota' : f.type === 'select' ? 'Selecione' : 'Sua resposta'
  }
  label = trunc(label, LABEL_MAX)

  if (f.type === 'scale') {
    // Escala vira RadioButtonsGroup: mostra todas as notas abertas, sem o usuário
    // ter que abrir um dropdown para responder. 0–10 = 11 opções, dentro do teto.
    const { min, max } = scaleRange(f)
    const rows: any[] = []
    for (let n = min; n <= max && rows.length < RADIO_MAX_OPTIONS; n++) {
      rows.push({ id: String(n), title: trunc(scaleValueLabel(f, n), OPTION_TITLE_MAX) })
    }
    comps.push({ type: 'RadioButtonsGroup', name, label, required, 'data-source': rows })
  } else if (f.type === 'select' && Array.isArray(f.options) && f.options.length) {
    comps.push({
      type: 'Dropdown', name, label, required,
      'data-source': f.options.slice(0, 200).map((o: any) => ({ id: String(o.value), title: trunc(stripTags(o.label), OPTION_TITLE_MAX) })),
    })
  } else if (f.type === 'textarea') {
    comps.push({ type: 'TextArea', name, label, required })
  } else {
    comps.push({ type: 'TextInput', name, label, 'input-type': INPUT_TYPE[f.type] || 'text', required })
  }
  return { comps, name }
}

/** Uma tela planejada: cabeçalho opcional (vindo de um `statement`) + suas perguntas. */
interface ScreenPlan { heading: any | null; fields: any[] }

// Agrupa os campos em telas. Cada `statement` abre uma tela nova e vira o cabeçalho
// dela; seções muito longas são quebradas para não estourar o teto de componentes.
function planScreens(form: any, cfgByKey: Map<string, FlowFieldConfig>): ScreenPlan[] {
  const all: any[] = Array.isArray(form?.fields) ? form.fields : []
  const screens: ScreenPlan[] = []
  let current: ScreenPlan | null = null

  for (const f of all) {
    if (!f) continue
    if (f.type === 'statement') {
      current = { heading: f, fields: [] }
      screens.push(current)
      continue
    }
    if (SKIP_TYPES.has(f.type)) continue
    if (cfgByKey.get(String(f.key))?.include === false) continue
    if (!current || current.fields.length >= MAX_INPUTS_PER_SCREEN) {
      current = { heading: null, fields: [] }
      screens.push(current)
    }
    current.fields.push(f)
  }
  // Telas sem cabeçalho e sem pergunta não têm o que mostrar.
  return screens.filter((s) => s.fields.length > 0 || s.heading)
}

export interface BuildFlowOpts {
  title?: string
  cta?: string
  fieldConfig?: FlowFieldConfig[]
  /** Uma tela por seção (quebra nos `statement`). Padrão: tela única. */
  multiScreen?: boolean
  /** Rótulo do botão das telas intermediárias no modo multi-tela. */
  navLabel?: string
}

/** Constrói o Flow JSON estático a partir do form + overrides do editor. */
export function buildFlowJson(form: any, opts?: BuildFlowOpts): { json: any; screenId: string } {
  const cfgByKey = new Map<string, FlowFieldConfig>((opts?.fieldConfig || []).map((c) => [String(c.key), c]))
  const title = trunc(opts?.title || form?.name || 'Formulário', SCREEN_TITLE_MAX)

  if (!opts?.multiScreen) {
    const screenId = 'INTAKE'
    const children: any[] = []
    const payload: Record<string, string> = {}
    for (const f of flowInputFields(form)) {
      const cfg = cfgByKey.get(String(f.key))
      if (cfg?.include === false) continue // campo removido do formulário do WhatsApp
      const { comps, name } = fieldComponents(f, cfg)
      children.push(...comps)
      payload[name] = '${form.' + name + '}'
    }
    children.push({ type: 'Footer', label: trunc(opts?.cta || 'Enviar', 30), 'on-click-action': { name: 'complete', payload } })
    return {
      screenId,
      json: {
        version: FLOW_JSON_VERSION,
        screens: [{
          id: screenId, title, terminal: true, success: true, data: {},
          layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form', children }] },
        }],
      },
    }
  }

  // ── Multi-tela ──
  const plans = planScreens(form, cfgByKey)
  if (!plans.length) return buildFlowJson(form, { ...opts, multiScreen: false })

  const screenIds = plans.map((_, i) => `SCREEN_${i}`)
  const screens: any[] = []
  // Nomes já coletados nas telas ANTERIORES: cada tela precisa declará-los em `data`
  // e repassá-los no payload, senão o dado se perde ao navegar.
  const carried: string[] = []

  plans.forEach((plan, i) => {
    const last = i === plans.length - 1
    const children: any[] = []
    if (plan.heading) {
      const h = stripTags(plan.heading.label)
      const sub = stripTags(plan.heading.helpText)
      if (h) children.push({ type: 'TextHeading', text: trunc(h, SUBHEADING_MAX) })
      if (sub) children.push({ type: 'TextBody', text: trunc(sub, BODY_MAX) })
    }

    const payload: Record<string, string> = {}
    for (const n of carried) payload[n] = '${data.' + n + '}'
    const mine: string[] = []
    for (const f of plan.fields) {
      const { comps, name } = fieldComponents(f, cfgByKey.get(String(f.key)))
      children.push(...comps)
      payload[name] = '${form.' + name + '}'
      mine.push(name)
    }

    children.push({
      type: 'Footer',
      label: trunc(last ? (opts?.cta || 'Enviar') : (opts?.navLabel || 'Continuar'), 30),
      'on-click-action': last
        ? { name: 'complete', payload }
        : { name: 'navigate', next: { type: 'screen', name: screenIds[i + 1] }, payload },
    })

    const data: Record<string, any> = {}
    for (const n of carried) data[n] = { type: 'string', __example__: '-' }

    screens.push({
      id: screenIds[i], title, data,
      ...(last ? { terminal: true, success: true } : {}),
      // Tela só de texto (seção sem pergunta) não precisa do wrapper Form.
      layout: {
        type: 'SingleColumnLayout',
        children: mine.length ? [{ type: 'Form', name: 'form', children }] : children,
      },
    })
    carried.push(...mine)
  })

  return { json: { version: FLOW_JSON_VERSION, screens }, screenId: screenIds[0]! }
}

/** Sobe o Flow JSON como asset (multipart). */
async function uploadFlowAsset(flowId: string, token: string, flowJson: any): Promise<void> {
  const fd = new FormData()
  fd.append('asset_type', 'FLOW_JSON')
  fd.append('name', 'flow.json')
  fd.append('file', new Blob([JSON.stringify(flowJson)], { type: 'application/json' }), 'flow.json')
  const resp = await fetch(`${GRAPH_URL}/${flowId}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  const data = await resp.json().catch(() => ({})) as any
  if (!resp.ok) throw new Error(`Upload do Flow JSON falhou: ${resp.status} ${JSON.stringify(data)}`)
  if (Array.isArray(data?.validation_errors) && data.validation_errors.length) {
    throw new Error(`Flow JSON inválido: ${JSON.stringify(data.validation_errors)}`)
  }
}

/** Cria (ou ATUALIZA, se existingFlowId) e publica o Flow na Meta. Retorna o id. */
export async function createAndPublishFlow(conn: any, name: string, flowJson: any, existingFlowId?: string | null): Promise<{ metaFlowId: string }> {
  const token = decryptToken(conn.systemUserToken)
  // Republicar: re-sobe o asset no MESMO flow e publica de novo. Se a Meta recusar
  // (ex.: flow já publicado não aceita update), cai no fluxo de criar um novo.
  if (existingFlowId) {
    try {
      await uploadFlowAsset(String(existingFlowId), token, flowJson)
      await cloudApiFetch(`/${existingFlowId}/publish`, token, 'POST', {})
      return { metaFlowId: String(existingFlowId) }
    } catch { /* fallback: cria um novo flow abaixo */ }
  }
  const created = await cloudApiFetch(`/${conn.wabaId}/flows`, token, 'POST', { name: trunc(name, 200), categories: ['OTHER'] })
  const flowId = created?.id
  if (!flowId) throw new Error('Meta não retornou o id do Flow (verifique a permissão whatsapp_business_management do token).')
  await uploadFlowAsset(String(flowId), token, flowJson)
  await cloudApiFetch(`/${flowId}/publish`, token, 'POST', {})
  return { metaFlowId: String(flowId) }
}

/** Payload `interactive` (type flow) para enviar o Flow ao lead. */
export function buildFlowSendPayload(
  metaFlowId: string, screenId: string,
  opts: { bodyText: string; cta?: string; flowToken: string; headerText?: string; footerText?: string },
): any {
  return {
    type: 'flow',
    ...(opts.headerText ? { header: { type: 'text', text: trunc(opts.headerText, 60) } } : {}),
    body: { text: trunc(opts.bodyText, 1024) },
    ...(opts.footerText ? { footer: { text: trunc(opts.footerText, 60) } } : {}),
    action: {
      name: 'flow',
      parameters: {
        flow_message_version: '3',
        flow_token: opts.flowToken,
        flow_id: String(metaFlowId),
        flow_cta: trunc(opts.cta || 'Preencher', 30),
        flow_action: 'navigate',
        flow_action_payload: { screen: screenId },
      },
    },
  }
}

/** Casa o response_json do nfm_reply de volta às chaves do form (field.key). */
export function ingestFlowResponse(form: any, responseJson: Record<string, any>): Record<string, any> {
  const answers: Record<string, any> = {}
  for (const f of flowInputFields(form)) {
    const name = flowFieldName(f.key)
    const v = responseJson?.[name]
    if (v != null && v !== '') answers[f.key] = v
  }
  return answers
}
