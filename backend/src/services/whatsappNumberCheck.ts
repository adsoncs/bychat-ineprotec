// src/services/whatsappNumberCheck.ts
//
// "Este número tem WhatsApp?" — em um lugar só.
//
// O painel já barrava número inexistente ao ABRIR uma conversa nova pelo botão
// (services/conversationStarter.ts), mas o lead que chega por formulário, Meta
// ou agendamento nunca passava por ali: o operador só descobria ao tentar
// falar. E nem sempre descobria — pela Cloud API a Meta ACEITA o envio para um
// número que não existe e nunca entrega, então a bolha aparece na tela como se
// tivesse saído. Foi assim que 6 leads ficaram parados em "Lead novo" com
// telefone inválido, um deles com atendimento aberto e zero mensagem.
//
// Duas portas de entrada:
//   · `lead.created` (ouvido aqui) — todo lead novo é conferido em segundo plano;
//   · `checarNumeroDoLead()` — chamada sob demanda ao abrir a conversa, para
//     alcançar também o acervo que nasceu antes disto existir.
//
// O resultado fica no `formData` do lead (`_waCheck`) e, quando o número não
// existe, também numa TAG — que já tem filtro na lista, chip na ficha e entra
// nos relatórios sem front novo nem migration.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { onlyDigits } from '../lib/phone.js'

/** Nome da tag aplicada a quem não tem WhatsApp. */
export const TAG_SEM_WHATSAPP = 'Sem WhatsApp'

/**
 * Por quanto tempo a resposta vale. Número pode ganhar WhatsApp depois — mas
 * reconferir a cada abertura de conversa geraria uma rajada de consultas, que é
 * o padrão que o WhatsApp associa a spam.
 */
const VALIDADE_DIAS = 30

/** Intervalo entre consultas da fila de leads novos. */
const INTERVALO_FILA_MS = 3000

export interface ResultadoChecagem {
  /** null = não deu para saber (sem Evolution ativa, telefone ausente, erro). */
  existe: boolean | null
  checadoEm: string | null
  /** true quando veio do carimbo anterior, sem consultar a Evolution. */
  doCache: boolean
}

interface CarimboWa {
  existe: boolean
  em: string
  numero: string
}

function carimbo(formData: unknown): CarimboWa | null {
  const fd = (formData || {}) as Record<string, unknown>
  const c = fd._waCheck as CarimboWa | undefined
  if (!c || typeof c.existe !== 'boolean' || !c.em) return null
  return c
}

function venceu(em: string): boolean {
  const t = new Date(em).getTime()
  if (isNaN(t)) return true
  return Date.now() - t > VALIDADE_DIAS * 86400000
}

/**
 * A checagem só existe na Evolution — a Cloud API não expõe esse endpoint.
 * Por isso procura-se uma instância Evolution ativa em vez do provider padrão,
 * que no beyond é Cloud API (era o que fazia a validação passar batido).
 */
async function providerEvolution(): Promise<any | null> {
  try {
    const wp = await import('./whatsappProvider.js')
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { active: true },
      select: { instanceName: true },
      orderBy: { id: 'asc' },
    })
    if (!inst) return null
    const { provider } = await wp.getProviderForChannel(`evolution:${inst.instanceName}`)
    // `checkNumbers` só existe no provider da Evolution, não na interface comum
    // (a Cloud API não expõe equivalente) — daí o acesso solto.
    const p = provider as any
    if (p?.providerName !== 'evolution' || typeof p.checkNumbers !== 'function') return null
    return p
  } catch {
    return null
  }
}

async function aplicarTag(leadId: number, existe: boolean): Promise<void> {
  const tag = await prisma.tag.findFirst({ where: { name: TAG_SEM_WHATSAPP }, select: { id: true } })
    ?? (existe ? null : await prisma.tag.create({
      data: {
        name: TAG_SEM_WHATSAPP,
        color: '#8C1D18',
        description: 'Número conferido no WhatsApp e inexistente — não adianta tentar falar por aqui.',
        position: 99,
      },
      select: { id: true },
    }).catch(() => null))
  if (!tag) return

  if (existe) {
    // Número passou a existir (portabilidade, dígito corrigido): tira a marca.
    await prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } }).catch(() => {})
  } else {
    await prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId, tagId: tag.id } },
      create: { leadId, tagId: tag.id },
      update: {},
    }).catch(() => {})
  }
}

/**
 * Confere o número do lead. Devolve o carimbo anterior enquanto ele valer, para
 * que abrir a mesma conversa dez vezes não vire dez consultas.
 *
 * @param opts.forcar ignora o carimbo e consulta de novo.
 */
export async function checarNumeroDoLead(leadId: number, opts?: { forcar?: boolean }): Promise<ResultadoChecagem> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, whatsapp: true, isGroup: true, formData: true },
  })
  if (!lead) return { existe: null, checadoEm: null, doCache: false }
  // Grupo não é pessoa e o JID não é telefone: consultar daria "não existe".
  if (lead.isGroup) return { existe: null, checadoEm: null, doCache: false }

  const numero = onlyDigits(lead.whatsapp || '')
  if (!numero || numero.length < 10) return { existe: null, checadoEm: null, doCache: false }

  const anterior = carimbo(lead.formData)
  if (!opts?.forcar && anterior && anterior.numero === numero && !venceu(anterior.em)) {
    return { existe: anterior.existe, checadoEm: anterior.em, doCache: true }
  }

  const provider = await providerEvolution()
  if (!provider) return { existe: null, checadoEm: null, doCache: false }

  let existe: boolean
  try {
    const r = await provider.checkNumbers([numero])
    if (!r?.length || typeof r[0]?.exists !== 'boolean') return { existe: null, checadoEm: null, doCache: false }
    existe = r[0].exists
  } catch {
    // Evolution fora do ar não é resposta: não carimba nada, tenta na próxima.
    return { existe: null, checadoEm: null, doCache: false }
  }

  const em = new Date().toISOString()
  const fd = (lead.formData || {}) as Record<string, unknown>
  await prisma.lead.update({
    where: { id: leadId },
    data: { formData: { ...fd, _waCheck: { existe, em, numero } } as never },
  }).catch(() => {})
  await aplicarTag(leadId, existe)

  if (!existe) console.log(`[waCheck] lead ${leadId}: ${numero} não tem WhatsApp`)
  return { existe, checadoEm: em, doCache: false }
}

/** Lê o carimbo sem consultar nada — para telas que só querem exibir. */
export async function statusNumeroDoLead(leadId: number): Promise<ResultadoChecagem> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
  const c = carimbo(lead?.formData)
  if (!c) return { existe: null, checadoEm: null, doCache: true }
  return { existe: c.existe, checadoEm: c.em, doCache: true }
}

// ── Fila dos leads novos ────────────────────────────────────────────────────
// Enfileirar em vez de consultar na hora do evento: uma importação de 200 leads
// dispararia 200 consultas no mesmo segundo.

const fila: number[] = []
let rodando = false

async function processarFila(): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    while (fila.length) {
      const leadId = fila.shift()!
      await checarNumeroDoLead(leadId).catch(() => {})
      if (fila.length) await new Promise((r) => setTimeout(r, INTERVALO_FILA_MS))
    }
  } finally {
    rodando = false
  }
}

export function startWhatsAppNumberCheck(): void {
  eventBus.on('lead.created', (event: { leadId?: number }) => {
    if (!event?.leadId) return
    if (fila.includes(event.leadId)) return
    fila.push(event.leadId)
    void processarFila()
  })
  console.log('[waCheck] checagem de número ativa (leads novos + abertura de conversa)')
}
