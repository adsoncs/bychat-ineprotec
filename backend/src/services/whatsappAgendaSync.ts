// src/services/whatsappAgendaSync.ts
//
// Traz para o CRM o nome que a EMPRESA salvou na agenda do celular conectado.
//
// Ao ler o QR Code, o WhatsApp sincroniza a agenda do aparelho e a Evolution
// guarda esses contatos — é por isso que uma instância tem milhares de contatos
// e só centenas de conversas. `POST /chat/findContacts/{instance}` devolve
// cada um com `isSaved: true` quando está na agenda.
//
// A Evolution guarda esse nome na MESMA coluna do pushName, então ele pode ser
// sobrescrito quando o contato manda mensagem. Por isso guardamos uma cópia
// nossa (`Lead.nomeWhatsappAgenda`) assim que vemos o contato: o nome da
// empresa não depende mais do que a Evolution fizer com o campo depois.

import { prisma } from '../lib/prisma.js'
import { phoneKey as phoneKeyOf } from '../lib/phone.js'
import { registrarNome } from './leadDisplayName.js'

interface ContatoEvolution {
  remoteJid: string
  pushName?: string | null
  isSaved?: boolean
  type?: string
}

function evoUrl() { return process.env.EVOLUTION_API_URL || '' }
function evoKey() { return process.env.EVOLUTION_API_KEY || '' }

async function findContacts(instance: string, timeoutMs: number): Promise<ContatoEvolution[]> {
  if (!evoUrl() || !evoKey()) return []
  const res = await fetch(`${evoUrl()}/chat/findContacts/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evoKey() },
    body: JSON.stringify({ where: {} }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Evolution ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** Só contato individual salvo na agenda com nome utilizável. */
function agendaUtil(c: ContatoEvolution): boolean {
  if (!c.isSaved) return false
  if (c.type === 'group' || (c.remoteJid || '').endsWith('@g.us')) return false
  const nome = (c.pushName ?? '').trim()
  if (!nome) return false
  // Nome que é só o próprio número não acrescenta nada.
  return !/^\+?[\d\s()-]+$/.test(nome)
}

// Cache curto por instância: o webhook consulta na criação de cada lead novo e
// não pode pagar uma chamada HTTP por contato.
const cache = new Map<string, { por: Map<string, string>; at: number }>()
const CACHE_TTL_MS = 10 * 60_000

async function mapaDaAgenda(instance: string, timeoutMs: number): Promise<Map<string, string>> {
  const atual = cache.get(instance)
  if (atual && Date.now() - atual.at < CACHE_TTL_MS) return atual.por
  const contatos = await findContacts(instance, timeoutMs)
  const por = new Map<string, string>()
  for (const c of contatos) {
    if (!agendaUtil(c)) continue
    const jid = c.remoteJid || ''
    const nome = (c.pushName ?? '').trim()
    if (jid.endsWith('@lid')) {
      por.set(jid, nome) // contato só-LID: a chave é o próprio JID
      continue
    }
    const pk = phoneKeyOf(jid.split('@')[0] || '')
    if (pk) por.set(pk, nome)
  }
  cache.set(instance, { por, at: Date.now() })
  return por
}

export function invalidarCacheAgenda(instance?: string): void {
  if (instance) cache.delete(instance); else cache.clear()
}

/**
 * Nome da agenda para um contato. Devolve null quando não está salvo, quando a
 * instância não responde ou quando a Evolution não está configurada — nunca
 * lança, porque isto roda no caminho do webhook.
 */
export async function nomeNaAgenda(
  instance: string | null | undefined,
  phone: string | null | undefined,
  waLid?: string | null,
): Promise<string | null> {
  const inst = (instance || process.env.EVOLUTION_INSTANCE || '').trim()
  if (!inst) return null
  try {
    const mapa = await mapaDaAgenda(inst, 8000)
    if (waLid) {
      const porLid = mapa.get(waLid.endsWith('@lid') ? waLid : `${waLid}@lid`)
      if (porLid) return porLid
    }
    const pk = phoneKeyOf(phone || '')
    return (pk && mapa.get(pk)) || null
  } catch {
    return null
  }
}

export interface ResultadoSync {
  instancia: string
  contatosSalvos: number
  leadsAtualizados: number
  erro?: string
}

/**
 * Varre a agenda de uma instância e grava o nome nos leads correspondentes.
 * Só melhora nomes de origem mais fraca (telefone/pushname) — quem foi digitado
 * no painel ou veio de formulário não é tocado.
 */
export async function sincronizarAgenda(instance: string): Promise<ResultadoSync> {
  const out: ResultadoSync = { instancia: instance, contatosSalvos: 0, leadsAtualizados: 0 }
  let contatos: ContatoEvolution[]
  try {
    contatos = await findContacts(instance, 60_000)
  } catch (e) {
    out.erro = (e as Error).message
    return out
  }

  for (const c of contatos) {
    if (!agendaUtil(c)) continue
    out.contatosSalvos++
    const jid = c.remoteJid || ''
    const nome = (c.pushName ?? '').trim()

    const where = jid.endsWith('@lid')
      ? { waLid: jid }
      : { phoneKey: phoneKeyOf(jid.split('@')[0] || '') || '__sem__' }

    const leads = await prisma.lead.findMany({
      where: { ...where, isGroup: false },
      select: { id: true },
      take: 20,
    })
    for (const l of leads) {
      const mudou = await registrarNome({
        leadId: l.id,
        nome,
        origem: 'agenda',
        nomeAgenda: nome,
      })
      if (mudou) out.leadsAtualizados++
    }
  }
  invalidarCacheAgenda(instance)
  return out
}

/** Sincroniza todas as instâncias ativas e conectadas. */
export async function sincronizarTodasAsAgendas(): Promise<ResultadoSync[]> {
  const instancias = await prisma.whatsAppInstance.findMany({
    where: { active: true },
    select: { instanceName: true },
  })
  const out: ResultadoSync[] = []
  for (const i of instancias) {
    if (!i.instanceName) continue
    out.push(await sincronizarAgenda(i.instanceName))
  }
  return out
}

// ── Job periódico ──────────────────────────────────────────────────────────
// A agenda muda devagar (alguém salva um contato novo no celular), então uma
// varredura por dia basta. A primeira roda 5 minutos depois de subir, para não
// disputar CPU com o boot.

let _timer: ReturnType<typeof setInterval> | null = null
const INTERVALO_MS = 24 * 60 * 60_000

export function startAgendaSyncJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      const r = await sincronizarTodasAsAgendas()
      const atualizados = r.reduce((s, x) => s + x.leadsAtualizados, 0)
      const salvos = r.reduce((s, x) => s + x.contatosSalvos, 0)
      if (atualizados > 0 || salvos > 0) {
        console.log(`[agendaSync] ${salvos} contatos salvos na agenda · ${atualizados} leads renomeados`)
      }
    } catch (e) {
      console.warn('[agendaSync] falhou:', (e as Error).message)
    }
  }
  setTimeout(() => { void tick(); _timer = setInterval(() => { void tick() }, INTERVALO_MS) }, 5 * 60_000)
  console.log('[agendaSync] job de sincronização da agenda agendado (24h)')
}

export function stopAgendaSyncJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
