// src/services/whatsappFlows.ts
//
// WhatsApp Flows ESTÁTICOS (sem endpoint/criptografia). Gera, a partir de um Form,
// um Flow JSON de tela única (TextInput / TextArea / Dropdown) cujas respostas
// voltam de uma vez no `nfm_reply` do webhook. Cobre o caso "formulário dentro do
// WhatsApp" (cadastro/intake) sem precisar de endpoint público nem RSA/AES.
//
// Fluxo de publicação (acionado pelo admin no painel):
//   1. POST /{wabaId}/flows           → cria rascunho
//   2. POST /{flowId}/assets (FLOW_JSON, multipart) → sobe o Flow JSON
//   3. POST /{flowId}/publish         → publica
// Para enviar: interactive type:'flow' com flow_id + flow_token (buildFlowSendPayload).

import { decryptToken, cloudApiFetch } from './cloudApi.js'

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
const LABEL_MAX = 30
const SUBHEADING_MAX = 80

/** Constrói o Flow JSON estático de tela única a partir do form + overrides do editor. */
export function buildFlowJson(form: any, opts?: { title?: string; cta?: string; fieldConfig?: FlowFieldConfig[] }): { json: any; screenId: string } {
  const screenId = 'INTAKE'
  const children: any[] = []
  const payload: Record<string, string> = {}
  const cfgByKey = new Map<string, FlowFieldConfig>((opts?.fieldConfig || []).map((c) => [String(c.key), c]))

  for (const f of flowInputFields(form)) {
    const cfg = cfgByKey.get(String(f.key))
    if (cfg?.include === false) continue // campo removido do formulário do WhatsApp
    const name = flowFieldName(f.key)
    const required = cfg?.required ?? !!f.required
    const fullLabel = stripTags(cfg?.label ?? f.label) || f.key

    // Rótulo longo (> 30) → vira um subtítulo acima + input com rótulo curto, em vez
    // de cortar a pergunta no meio (limite de rótulo do componente da Meta).
    let label = fullLabel
    if (fullLabel.length > LABEL_MAX) {
      children.push({ type: 'TextSubheading', text: trunc(fullLabel, SUBHEADING_MAX) })
      label = f.type === 'select' ? 'Selecione' : 'Sua resposta'
    }
    label = trunc(label, LABEL_MAX)

    if (f.type === 'select' && Array.isArray(f.options) && f.options.length) {
      children.push({
        type: 'Dropdown', name, label, required,
        'data-source': f.options.slice(0, 200).map((o: any) => ({ id: String(o.value), title: trunc(stripTags(o.label), 30) })),
      })
    } else if (f.type === 'textarea') {
      children.push({ type: 'TextArea', name, label, required })
    } else {
      children.push({ type: 'TextInput', name, label, 'input-type': INPUT_TYPE[f.type] || 'text', required })
    }
    payload[name] = '${form.' + name + '}'
  }

  children.push({ type: 'Footer', label: trunc(opts?.cta || 'Enviar', 30), 'on-click-action': { name: 'complete', payload } })

  const json = {
    version: FLOW_JSON_VERSION,
    screens: [{
      id: screenId,
      title: trunc(opts?.title || form?.name || 'Formulário', 30),
      terminal: true,
      success: true,
      data: {},
      layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'form', children }] },
    }],
  }
  return { json, screenId }
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
