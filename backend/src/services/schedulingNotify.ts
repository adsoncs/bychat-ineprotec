// Notificações do módulo de Agendamento: confirmação, lembrete e cancelamento
// (WhatsApp + e-mail), links públicos de remarcar/cancelar, e cron de lembretes.
import { prisma } from '../lib/prisma.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { getMeetingRecordingNotice } from '../lib/meetingsConfig.js'
import { renderizarModelo, registrarModelosPadrao } from './modelosDoSistema.js'
import { saudacaoAgora, primeiroNome } from '../lib/interpolate.js'
import { EMPTY_PARAM_PLACEHOLDER, buildBodyParams, renderTemplateText } from '../lib/waTemplateParams.js'

// ── Pedido de confirmação por TEXTO (opt-in) ────────────────────────────────
// Setting `scheduling.confirmar_por_texto` (padrão desligado). Ligado:
//   • sem HSM de confirmação utilizável, o pedido sai como texto livre
//     (modelo `agendamento_confirmar_wa`) pelo roteador de saída;
//   • um "Sim"/"ok" curto confirma a reserva que está aguardando confirmação.
// Desligado, nada muda: sem HSM o pedido não sai, e só "confirmar" ou o botão
// confirmam — um "sim" pode ser a resposta a outra pergunta do chatbot.
export async function confirmacaoPorTextoLigada(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'scheduling.confirmar_por_texto' } }).catch(() => null)
  return ['true', '1', 'sim', 'on'].includes(String(row?.value ?? '').replace(/^"|"$/g, '').trim().toLowerCase())
}

/** Registrado sob demanda (services/modelosOpcionais.ts), só com o Setting acima ligado. */
export function registrarModelosDaConfirmacaoPorTexto(): void {
  registrarModelosPadrao([{
    key: 'agendamento_confirmar_wa', name: 'Agendamento — pedido de confirmação sem modelo da Meta (WhatsApp)', channel: 'whatsapp',
    body: '{{saudacao}}, {{nome}}!{{#agente}} Aqui é o {{agente}}{{#marca}}, da {{marca}}{{/marca}}.{{/agente}}\n\nVi que temos {{#presencial}}uma visita{{/presencial}}{{^presencial}}uma reunião{{/presencial}} agendada e gostaria de confirmar nosso encontro.\n📅 {{quando}}{{#link}}\n{{#presencial}}📍 Endereço{{/presencial}}{{^presencial}}🔗 Link{{/presencial}}: {{link}}{{/link}}\n\nPode me confirmar respondendo com um *Sim*, por favor?',
  }])
}

/** Roteador de saída ligado (Setting `whatsapp.roteador_saida`)? Ver outboundRouter.ts. */
async function roteadorLigado(): Promise<boolean> {
  const { configDoRoteador } = await import('./outboundRouter.js')
  return (await configDoRoteador()).ligado
}

function publicBase(): string { return (process.env.APP_URL || 'https://localhost').replace(/\/$/, '') }
export function cancelLink(token: string): string { return `${publicBase()}/agendar/cancelar/${token}` }
export function rescheduleLink(token: string): string { return `${publicBase()}/agendar/remarcar/${token}` }

function fmtDateTime(d: Date, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d) }
  catch { return d.toISOString() }
}
// Formatos curtos para os HSM ("12/08/2026" e "14h30"), como nos exemplos aprovados
// na Meta — o dateStyle:'full' do fmtDateTime fica longo demais dentro do template.
function fmtDateOnly(d: Date, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) }
  catch { return d.toISOString().slice(0, 10) }
}
function fmtTimeOnly(d: Date, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', 'h') }
  catch { return d.toISOString().slice(11, 16).replace(':', 'h') }
}
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// Persiste a mensagem enviada ao lead em Conversas (fromMe=true), pra confirmação/
// lembrete do agendamento ficarem visíveis no histórico do contato — espelha o
// saveOutgoing do scriptedChatbotFlow. Só persiste quando há lead (avisos internos
// ao operador, sem leadId, não entram na timeline de nenhum contato).
// Usado no caminho do roteador de saída (Setting `whatsapp.roteador_saida`).
async function persistOutgoing(
  leadId: number | null, body: string, providerType: string, instanceName: string | null, messageId: string | null,
  cloudApiConnectionId?: number | null,
): Promise<void> {
  if (!leadId || !body) return
  try {
    await prisma.message.create({ data: {
      leadId, fromMe: true, body, mediaType: 'text', provider: providerType,
      ...(providerType === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
      ...(cloudApiConnectionId ? { cloudApiConnectionId } : {}),
      senderName: 'Agendamento', isInternal: false, externalId: messageId, ack: messageId ? 1 : 0, timestamp: new Date(),
    } })
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } }).catch(() => {})
  } catch (e: any) { console.warn('[scheduling] persistir msg falhou:', e?.message) }
}

/** Envia texto livre ao lead. Devolve se a mensagem SAIU — quem marca estado a
 *  partir do envio (ex.: `confirmRequestedAt`) precisa saber, senão a reserva fica
 *  registrada como "confirmação pedida" sem ninguém ter recebido nada.
 *  `hsm` (opcional) só vale no roteador de saída: é o template usado quando o
 *  contato está fora da janela de 24h da Cloud API. */
async function sendWa(
  leadId: number | null, phone: string, text: string,
  hsm?: { name: string; values: Record<string, string> } | null,
): Promise<boolean> {
  if (!phone) return false
  if (await roteadorLigado()) {
    try {
      // O roteador decide o número: canal da conversa, Cloud API com HSM quando o
      // contato está frio, Evolution como rede de segurança.
      const { enviarAutomatico } = await import('./outboundRouter.js')
      const r = await enviarAutomatico({ leadId, phone, texto: text, hsm: hsm ?? null })
      await persistOutgoing(leadId, r.textoEnviado, r.canal, r.instanceName, r.externalId, r.cloudApiConnectionId)
      // Aviso a GRUPO também entra na conversa do grupo — `persistOutgoing` só
      // cobre o lead. Idempotente pelo externalId: nunca duplica a bolha.
      const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
      await registrarSaidaParaGrupo({
        destino: phone, texto: r.textoEnviado, externalId: r.externalId, instanceName: r.instanceName,
      })
      return true
    } catch (e: any) { console.warn('[scheduling] WhatsApp falhou:', e?.message); return false }
  }
  try {
    const wp = await import('./whatsappProvider.js')
    // Lead → provider do dono/canal do lead. Sem leadId (aviso interno ao operador)
    // → Evolution (Cloud API não entrega texto livre a número fora da janela 24h).
    const provider = leadId
      ? (await wp.getProviderForLeadOwner({ id: leadId, whatsapp: phone })).provider
      : wp.createEvolutionProvider()
    const r = await provider.sendText(phone, text)
    const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
    await registrarSaidaParaGrupo({
      destino: phone, texto: text, externalId: r?.messageId ?? null,
      instanceName: (provider as any).instanceName ?? null,
    })
    return true
  } catch (e: any) { console.warn('[scheduling] WhatsApp falhou:', e?.message); return false }
}

// Nomes dos templates HSM (Cloud API) usados pelo agendamento. São o único jeito de
// falar com quem está FORA da janela de 24h — que é a regra, não a exceção: lembrete
// de véspera e confirmação de lead de formulário caem quase sempre nessa situação.
// Configuráveis por tenant (Configurações) porque cada escola/empresa aprova os seus
// com nomes próprios na Meta; os defaults preservam o comportamento antigo.
// Sem nome configurado = não usa modelo da Meta (nenhum nome é presumido).
const TEMPLATE_KEYS = {
  confirmation: 'scheduling.confirm_template',
  reminder24h: 'scheduling.reminder_24h_template',
  reminder1h: 'scheduling.reminder_1h_template',
  // HSM do cancelamento — só usado pelo roteador de saída (fora da janela de 24h).
  cancelled: 'scheduling.cancelled_template',
} as const

async function templateNameFor(kind: keyof typeof TEMPLATE_KEYS): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: TEMPLATE_KEYS[kind] } }).catch(() => null)
  return row ? String(row.value).replace(/^"|"$/g, '').trim() : ''
}

/** Texto curto de um modelo do sistema (vazio quando desligado). */
async function textoDoModelo(key: string): Promise<string> {
  return (await renderizarModelo(key))?.body.trim() || ''
}

// Em que ordem os nossos nomes entram nos {{1}}, {{2}}… de um template POSICIONAL.
// Segue o exemplo aprovado na Meta para `confirmacao_agendamento_reuniao`:
//   {{1}} Glauber · {{2}} Reunião com BeyondHub · {{3}} segunda-feira, … às 17:00
//   {{4}} https://meet.google.com/abc-defg-hij
// Um template NOMEADO ({{nome}}, {{quando}}…) ignora esta lista: ali o token já
// é o nome.
const ORDEM_AGENDAMENTO = ['nome', 'reuniao', 'quando', 'link'] as const

/**
 * Envia um HSM ao lead. Retorna false se o template não existir, não estiver
 * aprovado, ou se algum parâmetro ficaria em branco.
 *
 * A recusa por parâmetro em branco é deliberada. A Meta aceita a mensagem com o
 * placeholder e o envio "dá certo" — o que chega ao cliente é "Olá, —! Recebemos
 * o seu agendamento da *—* para —". Isso é pior que não mandar nada: o cliente
 * lê, desconfia, e ninguém fica sabendo que precisa refazer. Segurar aqui devolve
 * o caso para o caminho alternativo (texto livre) e abre alerta para a equipe.
 */
async function sendHsm(
  conn: { phoneNumberId: string; systemUserToken: string; wabaId: string | null; id: number },
  templateName: string, phone: string, values: Record<string, string>, leadId: number | null,
): Promise<boolean> {
  if (!templateName) return false
  const tpl = await prisma.cloudApiTemplate.findFirst({
    where: { name: templateName, ...(conn.wabaId ? { wabaId: conn.wabaId } : {}) },
    select: { status: true, language: true, components: true },
  })
  if (!tpl || tpl.status !== 'APPROVED') {
    console.warn(`[scheduling] template ${templateName} não aprovado (${tpl?.status ?? 'inexistente'}) — WhatsApp não enviado`)
    return false
  }

  const ordem = [...ORDEM_AGENDAMENTO]
  const { params, faltando } = buildBodyParams(tpl.components, values, ordem)
  if (faltando.length) {
    const quais = faltando.map((t) => `{{${t}}}`).join(', ')
    console.error(`[scheduling] template ${templateName}: ${quais} sem valor — envio CANCELADO (a mensagem sairia com "${EMPTY_PARAM_PLACEHOLDER}")`)
    await avisarTemplateIncompleto(templateName, faltando, leadId, values)
    return false
  }

  const wp = await import('./whatsappProvider.js')
  const provider = new wp.CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
  await provider.sendTemplate(phone, templateName, tpl.language || 'pt_BR', params.length ? [{ type: 'body', parameters: params }] : [])
  if (leadId) {
    await prisma.message.create({
      data: { leadId, body: renderTemplateText(tpl.components, values, ordem), fromMe: true, senderName: 'Agendamento', ack: 1, provider: 'cloud_api', cloudApiConnectionId: conn.id },
    }).catch(() => {})
  }
  return true
}

/**
 * Abre alerta para a gestão quando um template ficaria incompleto.
 *
 * Sem isto a correção seria só silêncio de outro tipo: o cliente deixa de
 * receber a mensagem errada, mas também não recebe a certa, e a equipe continua
 * sem saber. O `dedupeKey` é por template + variáveis faltando, então cem
 * agendamentos com o mesmo defeito viram UM alerta, não cem.
 */
async function avisarTemplateIncompleto(
  templateName: string, faltando: string[], leadId: number | null, values: Record<string, string>,
): Promise<void> {
  try {
    const { raiseAlert } = await import('./alertService.js')
    await raiseAlert({
      dedupeKey: `hsm:incompleto:${templateName}:${faltando.join(',')}`,
      kind: 'scheduling',
      severity: 'critical',
      title: `Confirmação de agendamento não enviada: o template "${templateName}" ficou incompleto`,
      body: `As variáveis ${faltando.map((t) => `{{${t}}}`).join(', ')} chegaram sem valor, então a mensagem foi SEGURADA — ela sairia com "—" no lugar do nome, da data e do link.\n\n`
        + `O contato NÃO recebeu a confirmação: alguém precisa falar com ele.\n\n`
        + `Valores disponíveis no momento do envio: ${Object.keys(values).filter((k) => values[k]).join(', ') || '(nenhum)'}.`,
      ...(leadId ? { entityType: 'lead', entityId: leadId } : {}),
      metadata: { templateName, faltando, valores: Object.keys(values) },
    })
  } catch (e: any) {
    console.warn('[scheduling] não consegui abrir alerta do template incompleto:', e?.message)
  }
}

// Envia a confirmação de agendamento ao lead pelo WhatsApp e marca confirmRequestedAt
// (escopo do auto-cancelamento + detecção do clique "Confirmar reunião").
//   • Janela 24h ABERTA (lead conversando agora pela Cloud API — ex.: Jornada IA):
//     entrega TEXTO + link do Meet + botão interativo "Confirmar reunião" direto,
//     SEM depender da aprovação do template HSM.
//   • Lead FRIO (fora da janela, ex.: lead de formulário): template HSM aprovado.
async function sendBookingConfirmationToLead(
  bookingId: number, leadId: number | null, mt: { name: string; locationType?: string | null; locationDetail: string | null }, name: string, when: string, meetLink: string | null, phone: string,
  vars: Record<string, string>,
): Promise<void> {
  try {
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
    if (!conn) { console.warn('[scheduling] sem conexão Cloud API — confirmação WhatsApp não enviada'); return }
    const linkText = meetLink || mt.locationDetail || ''
    const presencial = String(mt.locationType || '') === 'in_person'

    const openWindow = leadId
      ? await prisma.message.findFirst({ where: { leadId, provider: 'cloud_api', fromMe: false, createdAt: { gt: new Date(Date.now() - 24 * 3600000) } }, select: { id: true } })
      : null

    if (openWindow) {
      // Sem pedido de confirmação (auto-cancel removido; cancelar/remarcar = manual):
      // mensagem limpa de "agendado" com o link da reunião.
      // F0.3: reforça o aviso de gravação (quando ligada) para transparência/consentimento.
      const wp = await import('./whatsappProvider.js')
      const provider = new wp.CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
      const recNotice = await getMeetingRecordingNotice()
      // Encontro presencial não tem "link": o modelo separa visita (endereço) de
      // reunião online (link + aviso de gravação) por {{presencial}}.
      const msg = await renderizarModelo('agendamento_confirmado_janela_wa', {
        quando: when, presencial: presencial ? 'sim' : '',
        link: presencial ? '' : linkText, local: presencial ? linkText : '',
        aviso_gravacao: recNotice || '',
      })
      if (msg?.body.trim()) {
        const r = await provider.sendText(phone, msg.body)
        // Com o roteador ligado, a mensagem também entra em Conversas.
        if (await roteadorLigado()) await persistOutgoing(leadId, msg.body, 'cloud_api', null, (r as any)?.messageId ?? null, conn.id)
      }
      return
    }

    // Lead frio (fora da janela de 24h) → só passa HSM aprovado.
    const templateName = await templateNameFor('confirmation')
    const sent = await sendHsm(conn, templateName, phone, { ...vars, reuniao: mt.name, quando: when, link: linkText || await textoDoModelo('agendamento_hsm_sem_link') }, leadId)
    if (sent) {
      await prisma.booking.update({ where: { id: bookingId }, data: { confirmRequestedAt: new Date() } }).catch(() => {})
      return
    }
    // HSM indisponível (não aprovado, ou nunca criado) e a Cloud API recusa texto
    // livre fora da janela: sem este caminho a confirmação simplesmente NÃO SAI —
    // foi o que aconteceu no terram, onde todo lead de formulário marcou reunião e
    // nunca recebeu o pedido de confirmação. Opt-in (`scheduling.confirmar_por_texto`):
    // é um envio a mais para o lead, então não liga sozinho em ninguém.
    if (await confirmacaoPorTextoLigada()) {
      await sendBookingConfirmationViaEvolution(bookingId, leadId, mt, when, linkText, presencial, phone)
    }
  } catch (e: any) { console.warn('[scheduling] confirmação ao lead falhou:', e?.message) }
}

/** Texto do pedido de confirmação por escrito, editável em
 *  `agendamento_confirmar_wa`. Exportado para poder ser conferido sem disparar
 *  mensagem a ninguém. */
export async function montarPedidoDeConfirmacao(
  bookingId: number, leadId: number | null,
  mt: { name: string; locationDetail: string | null }, when: string,
  linkText: string, presencial: boolean,
): Promise<string> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { operatorUserId: true, inviteeName: true },
  })
  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } }) : null
  const dono = booking?.operatorUserId
    ? await prisma.user.findFirst({ where: { id: booking.operatorUserId, active: true }, select: { name: true } }).catch(() => null)
    : null
  const agenteSetting = await prisma.setting.findUnique({ where: { key: 'company.agent_name' } }).catch(() => null)
  const agente = dono?.name
    ? primeiroNome(dono.name)
    : (agenteSetting ? String(agenteSetting.value ?? '').replace(/^"|"$/g, '').trim() : '')
  // Modelo agendamento_confirmar_wa. A assinatura ("Aqui é o X, da Y") só entra
  // com nome de gente — {{#agente}} — senão viraria "Aqui é o , da …".
  const msg = await renderizarModelo('agendamento_confirmar_wa', {
    saudacao: saudacaoAgora(),
    nome: primeiroNome(lead?.nome || booking?.inviteeName || ''),
    agente,
    reuniao: mt.name,
    quando: when,
    presencial: presencial ? 'sim' : '',
    link: linkText,
  })
  return msg?.body.trim() || ''
}

/** Pedido de confirmação por texto livre. Sem botão nativo aqui: a resposta
 *  esperada é escrita, e `tryConfirmBookingReply` aceita o "sim" quando existe
 *  reserva aguardando. `confirmRequestedAt` só é gravado se a mensagem realmente
 *  saiu — do contrário a reserva ficaria marcada como "confirmação pedida" sem o
 *  contato ter recebido nada, e ninguém iria atrás. */
async function sendBookingConfirmationViaEvolution(
  bookingId: number, leadId: number | null,
  mt: { name: string; locationDetail: string | null }, when: string,
  linkText: string, presencial: boolean, phone: string,
): Promise<void> {
  const texto = await montarPedidoDeConfirmacao(bookingId, leadId, mt, when, linkText, presencial)
  if (!texto) return
  const enviou = await sendWa(leadId, phone, texto)
  if (!enviou) {
    console.warn(`[scheduling] pedido de confirmação da reserva #${bookingId} não saiu — reserva segue sem confirmRequestedAt`)
    return
  }
  await prisma.booking.update({ where: { id: bookingId }, data: { confirmRequestedAt: new Date() } }).catch(() => {})
}

// Detecta resposta afirmativa em texto livre (caso o lead digite em vez de tocar no botão).
const AFFIRMATIVE = /^(sim|confirmo|confirmar|confirmado|confirmada|ok|okay|claro|isso|positivo|com certeza|certo|fechado|combinado|👍|✅|🙌)/i
export function isAffirmative(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/[!.,\s]+$/g, '')
  return !!t && AFFIRMATIVE.test(t)
}

// Confirmação de agendamento a partir de uma mensagem recebida do lead. Só confirma se o
// lead CLICAR no botão "Confirmar reunião" (id confirm_booking, ou o quick-reply do HSM
// com título "Confirmar reunião") OU digitar explicitamente "confirmar/confirmo". NÃO
// confirma com afirmativos genéricos ("sim", "ok") nem com outro botão (ex.: escolher
// horário) — a confirmação exige o compromisso explícito do lead. Retorna true se confirmou
// (o webhook deve então parar e não rodar o chatbot sobre essa mensagem).
export async function tryConfirmBookingReply(phone: string, text: string, interactiveReplyId: string | null): Promise<boolean> {
  const norm = (phone || '').replace(/\D/g, '')
  if (!norm) return false
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const isConfirmButton = interactiveReplyId === 'confirm_booking'
  const isConfirmText = /^(confirmo|confirmar|confirmado|confirmada)\b/.test(t) || /confirmar reuni/.test(t)
  // "Sim"/"ok" curtos também confirmam QUANDO o pedido sai por texto
  // (`scheduling.confirmar_por_texto`): ele pede literalmente "responda Sim", e
  // exigir a palavra "confirmar" deixaria a reserva pendente para sempre. Só vale
  // se houver reserva esperando confirmação (checagem logo abaixo) e se não vier
  // de OUTRO botão (ex.: escolher horário).
  const isAffirmativeShort = !interactiveReplyId && t.length <= 30 && isAffirmative(t)
    && await confirmacaoPorTextoLigada()
  if (!isConfirmButton && !isConfirmText && !isAffirmativeShort) return false

  let lead = await prisma.lead.findFirst({ where: { whatsapp: norm }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!lead && norm.length >= 8) {
    lead = await prisma.lead.findFirst({ where: { whatsapp: { contains: norm.slice(-8) } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  }
  if (!lead) return false
  const booking = await prisma.booking.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] }, confirmRequestedAt: { not: null }, startAt: { gt: new Date() } },
    orderBy: { startAt: 'asc' },
    select: { id: true, status: true },
  })
  if (!booking) return false
  // Já confirmada (ex.: tocou "Confirmar presença" no lembrete da véspera e de
  // novo no do dia): só reafirma, sem repetir o evento de confirmação.
  if (booking.status === 'scheduled') {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'confirmed', confirmedAt: new Date() } })
    import('./meetingStatus.js').then((m) => m.aoMudarStatusDaReuniao(booking.id, 'confirmed', 'contact_reply')).catch(() => {})
  }
  // Roteador ligado: o aviso de "confirmada" sai pelo MESMO canal da conversa —
  // quem confirmou pela Evolution não tinha resposta nenhuma (o trecho abaixo só
  // fala pela Cloud API) e a reserva mudava de estado em silêncio.
  if (await roteadorLigado()) {
    const confirmada = await renderizarModelo('agendamento_presenca_confirmada_wa')
    if (confirmada?.body.trim()) await sendWa(lead.id, phone, confirmada.body)
    return true
  }
  // Resposta de confirmação — a mensagem do lead abriu a janela de 24h, então texto livre
  // pela Cloud API é entregue normalmente. Aqui "confirmada" é correto (ele confirmou).
  try {
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
    if (conn) {
      const msg = await renderizarModelo('agendamento_presenca_confirmada_wa')
      if (msg?.body.trim()) {
        const wp = await import('./whatsappProvider.js')
        await new wp.CloudApiProvider(conn.phoneNumberId, conn.systemUserToken).sendText(phone, msg.body)
      }
    }
  } catch { /* best-effort */ }
  return true
}

async function resolveMeetLink(booking: { meetLink: string | null; activityId: number | null; id: number }): Promise<string | null> {
  if (booking.meetLink) return booking.meetLink
  if (!booking.activityId) return null
  const a = await prisma.activity.findUnique({ where: { id: booking.activityId }, select: { metadata: true } })
  const link = ((a?.metadata as any)?.googleMeetLink) || null
  if (link) await prisma.booking.update({ where: { id: booking.id }, data: { meetLink: link } }).catch(() => {})
  return link
}

/** Pede a confirmação de uma reserva que já existe — para o caso retroativo: a
 *  reunião foi marcada quando o pedido ainda não saía (sem HSM aprovado) e a data
 *  está chegando. Só WhatsApp: e-mail e aviso ao operador já foram na reserva.
 *  Não repete se a confirmação já foi pedida ou já veio. Uso manual (script). */
export async function pedirConfirmacaoDaReserva(bookingId: number): Promise<boolean> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking || booking.status === 'cancelled') return false
  if (booking.confirmRequestedAt || booking.confirmedAt) return false
  const mt = await prisma.meetingType.findUnique({ where: { id: booking.meetingTypeId } })
  if (!mt) return false
  const lead = booking.leadId
    ? await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { whatsapp: true } })
    : null
  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (!phone) return false

  const meetLink = await resolveMeetLink(booking)
  const linkText = meetLink || mt.locationDetail || ''
  const presencial = String(mt.locationType || '') === 'in_person'
  await sendBookingConfirmationViaEvolution(
    booking.id, booking.leadId ?? null, mt, fmtDateTime(booking.startAt, booking.timezone),
    linkText, presencial, phone,
  )
  const depois = await prisma.booking.findUnique({ where: { id: bookingId }, select: { confirmRequestedAt: true } })
  return !!depois?.confirmRequestedAt
}

// kind: 'confirmation' (na reserva) | 'reminder' (antes da reunião)
export async function notifyBooking(bookingId: number, kind: 'confirmation' | 'reminder', which?: '24h' | '1h'): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking || booking.status === 'cancelled') return
  const mt = await prisma.meetingType.findUnique({ where: { id: booking.meetingTypeId } })
  if (!mt) return
  const lead = booking.leadId
    ? await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { id: true, whatsapp: true, email: true, nome: true, customFields: true } })
    : null

  const meetLink = await resolveMeetLink(booking)
  const when = fmtDateTime(booking.startAt, booking.timezone)
  const name = booking.inviteeName || lead?.nome || ''
  const kindKey = kind === 'reminder' ? 'lembrete' : 'confirmado' // chave do modelo (pt-BR)
  const local = mt.locationDetail || ''

  // ── WhatsApp ao lead — modelo agendamento_<kind>_wa (desligado = não envia) ──
  const waVars = { nome: name, reuniao: mt.name, quando: when, link: meetLink || '', local }
  const wa = (await renderizarModelo(`agendamento_${kindKey}_wa`, waVars)) ?? { subject: '', body: '' }

  // Variáveis dos HSM de agendamento. `aluno` sai do 1º filho cadastrado (convenção
  // filho_1_nome) — os templates de escola citam a criança pelo nome.
  const cf = ((lead as any)?.customFields || {}) as Record<string, unknown>
  const hsmVars: Record<string, string> = {
    nome: name || await textoDoModelo('agendamento_hsm_sem_nome'),
    data_visita: fmtDateOnly(booking.startAt, booking.timezone),
    hora_visita: fmtTimeOnly(booking.startAt, booking.timezone),
    aluno: String(cf.filho_1_nome || cf.aluno_nome || '').trim() || await textoDoModelo('agendamento_hsm_sem_aluno'),
  }

  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (phone) {
    const cloudConn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
    if (kind === 'confirmation') {
      // Confirmação ao lead. COM Cloud API → texto (janela aberta) ou HSM (frio).
      // SEM Cloud API → texto livre via Evolution.
      if (cloudConn) {
        await sendBookingConfirmationToLead(booking.id, lead?.id ?? null, mt, name, when, meetLink, phone, hsmVars)
      } else if (wa.body.trim()) {
        await sendWa(lead?.id ?? null, phone, wa.body)
      }
    } else {
      // Lembrete. O caso normal é a janela de 24h estar FECHADA (véspera de uma visita
      // marcada dias antes): ali a Cloud API recusa texto livre e só HSM entrega. Com a
      // janela aberta, o texto livre é melhor — não gasta template nem soa robótico.
      const openWindow = lead?.id
        ? await prisma.message.findFirst({ where: { leadId: lead.id, provider: 'cloud_api', fromMe: false, createdAt: { gt: new Date(Date.now() - 24 * 3600000) } }, select: { id: true } })
        : null
      // `link` vai junto: o lembrete sem o link do Meet obriga o contato a caçar a
      // mensagem antiga bem na hora em que a reunião vai começar — e um template
      // com {{link}} sem esse valor era recusado por parâmetro em branco.
      const linkLembrete = meetLink || mt.locationDetail || await textoDoModelo('agendamento_hsm_sem_link')
      let sent = false
      if (cloudConn && !openWindow) {
        const templateName = await templateNameFor(which === '1h' ? 'reminder1h' : 'reminder24h')
        sent = await sendHsm(cloudConn, templateName, phone, { ...hsmVars, reuniao: mt.name, quando: when, link: linkLembrete }, lead?.id ?? null)
      }
      if (!sent && wa.body.trim()) await sendWa(lead?.id ?? null, phone, wa.body)
    }
  }

  const toEmail = lead?.email || booking.inviteeEmail
  if (toEmail) {
    try {
      const cfg = await getEmailConfig()
      // E-mail ao lead — modelo agendamento_<kind>_email (valores já escapados).
      const em = await renderizarModelo(`agendamento_${kindKey}_email`, {
        nome: esc(name), reuniao: esc(mt.name), quando: esc(when), link: esc(meetLink || ''), local: esc(local),
      })
      if (em?.body.trim()) await sendEmailGeneric({ from: getFromAddress(cfg), to: toEmail, subject: em.subject, html: em.body })
    } catch (e: any) { console.warn('[scheduling] e-mail falhou:', e?.message) }
  }

  // Operador (só na confirmação) — WhatsApp + e-mail, ambos editáveis.
  // Vai para o OPERADOR DO AGENDAMENTO (booking.operatorUserId — respeita o roteamento
  // por equipe), com fallback ao dono do tipo de reunião. Antes ia sempre p/ o dono do
  // tipo (mt.ownerUserId), avisando o agente errado quando o lead era roteado p/ outro.
  const responsibleUserId = booking.operatorUserId ?? mt.ownerUserId
  if (kind === 'confirmation' && responsibleUserId) {
    const op = await prisma.user.findUnique({ where: { id: responsibleUserId }, select: { email: true, name: true, notifyWhatsapp: true } })
    // WhatsApp ao operador (se ele tiver número de avisos configurado).
    if (op?.notifyWhatsapp) {
      const waOp = await renderizarModelo('agendamento_operador_wa', {
        operador: op.name || '', nome: name, telefone: phone || '', email_contato: toEmail || '',
        reuniao: mt.name, quando: when, link: meetLink || '', local,
      })
      if (waOp?.body.trim()) await sendWa(null, op.notifyWhatsapp, waOp.body)
    }
    // E-mail ao operador.
    if (op?.email) {
      try {
        const cfg = await getEmailConfig()
        const emOp = await renderizarModelo('agendamento_operador_email', {
          operador: esc(op.name || ''), nome: esc(name), telefone: esc(phone || ''), email_contato: esc(toEmail || ''),
          reuniao: esc(mt.name), quando: esc(when), link: esc(meetLink || ''), local: esc(local),
        })
        if (emOp?.body.trim()) await sendEmailGeneric({ from: getFromAddress(cfg), to: op.email, subject: emOp.subject, html: emOp.body })
      } catch { /* best-effort */ }
    }
  }
}

export async function notifyCancelled(bookingId: number): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) return
  const mt = await prisma.meetingType.findUnique({ where: { id: booking.meetingTypeId }, select: { name: true, ownerUserId: true } })
  const lead = booking.leadId ? await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { id: true, whatsapp: true, nome: true } }) : null
  const when = fmtDateTime(booking.startAt, booking.timezone)
  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (phone) {
    // Cancelamento ao lead — modelo agendamento_cancelado_wa.
    const cancelled = await renderizarModelo('agendamento_cancelado_wa', { reuniao: mt?.name || '', quando: when })
    // Um cancelamento quase sempre chega com a janela de 24h fechada — sem HSM ele
    // não sairia pela Cloud API. O HSM (`scheduling.cancelled_template`) só é usado
    // pelo roteador de saída; nos demais casos `sendWa` o ignora.
    const templateName = await templateNameFor('cancelled')
    const nomeHsm = booking.inviteeName || lead?.nome || await textoDoModelo('agendamento_hsm_sem_nome')
    const hsm = templateName
      ? { name: templateName, values: { nome: nomeHsm, reuniao: mt?.name || '', quando: when } }
      : null
    if (cancelled?.body.trim()) await sendWa(lead?.id ?? null, phone, cancelled.body, hsm)
  }
}

// ── Cron de lembretes (24h e 1h antes) — idempotente via metadata da Activity ──
let reminderTimer: NodeJS.Timeout | null = null

async function reminderTick(): Promise<void> {
  const now = Date.now()
  // Janela ampla: pega meetings nas próximas ~25h ainda pendentes.
  const acts = await prisma.activity.findMany({
    where: { type: 'meeting', status: 'pending', scheduledAt: { gt: new Date(now), lt: new Date(now + 25 * 3600000) } },
    select: { id: true, scheduledAt: true, metadata: true },
    take: 200,
  })
  for (const a of acts) {
    const meta = (a.metadata as any) || {}
    const bookingId = meta.bookingId
    if (!bookingId) continue
    const diffMin = (a.scheduledAt.getTime() - now) / 60000
    let flag: string | null = null
    if (diffMin <= 70 && !meta.reminded1h) flag = 'reminded1h'
    else if (diffMin <= 25 * 60 && diffMin > 70 && !meta.reminded24h) flag = 'reminded24h'
    if (!flag) continue
    try {
      await notifyBooking(bookingId, 'reminder', flag === 'reminded1h' ? '1h' : '24h')
      await prisma.activity.update({ where: { id: a.id }, data: { metadata: { ...meta, [flag]: true } } })
    } catch { /* tenta no próximo tick */ }
  }
}

// Auto-cancelamento de reservas não confirmadas: REMOVIDO por política — apenas
// CRIAR agendamento fica ativo; remarcar/cancelar são SOMENTE manuais (pela
// equipe, no painel). Antes, uma cron (tick 5min) cancelava reservas não
// confirmadas a <3h da reunião e APAGAVA o evento do Google (sumiço silencioso),
// pior na Evolution onde a confirmação do lead nem é detectada.

export function startSchedulingReminders(): void {
  if (reminderTimer) return
  reminderTimer = setInterval(() => {
    reminderTick().catch(() => {})
  }, 5 * 60000)
  console.log('[scheduling] lembretes iniciados (tick 5min) — sem auto-cancelamento (cancelar/remarcar = manual)')
}
