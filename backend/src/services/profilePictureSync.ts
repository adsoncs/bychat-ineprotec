// src/services/profilePictureSync.ts
//
// Busca e mantém as fotos de perfil de contatos e grupos.
//
// Antes a foto só era buscada no inbound, e com duas exclusões que deixavam a
// maior parte da base sem imagem:
//   - LID (`<id>@lid`) era ignorado de propósito, e é assim que boa parte dos
//     contatos chega hoje
//   - grupo nunca era tentado
// Resultado no beyond: 263 de 315 contatos e 3 de 3 grupos sem foto. A Evolution
// TEM essas imagens — bastava pedir com o JID certo.
//
// O que não tem solução técnica: contato que escondeu a foto por privacidade.
// Para esses, a interface cai nas iniciais, e nenhuma busca muda isso.

import { mkdir, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { prisma } from '../lib/prisma.js'

const AVATAR_DIR = join(process.cwd(), '..', 'uploads', 'avatars')
/** Foto de perfil muda pouco; 7 dias evita rebuscar a base toda a cada tick. */
const TTL_MS = 7 * 24 * 3600 * 1000

async function evoFetch(path: string, body: unknown): Promise<any> {
  const url = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  if (!url || !key) throw new Error('Evolution API não configurada')
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Evolution ${r.status}`)
  return r.json()
}

/**
 * Identificador que o WhatsApp entende para este lead.
 *
 * Grupo usa o JID do grupo; contato usa o telefone; e quando só se conhece o
 * LID, é o LID mesmo — ele funciona no fetchProfilePictureUrl (testado), o que
 * torna a exclusão antiga desnecessária.
 */
function jidDoLead(l: { whatsapp: string | null; groupJid: string | null; waLid: string | null; isGroup: boolean | null }): string | null {
  if (l.isGroup && l.groupJid) return l.groupJid
  const w = (l.whatsapp || '').trim()
  if (w && !w.includes('@')) return w
  if (l.waLid) return l.waLid
  return w || null
}

/** Baixa a foto e devolve a URL pública local; '' quando não há foto. */
export async function sincronizarFoto(
  leadId: number,
  jid: string,
  instanceName: string,
): Promise<string> {
  const arquivo = join(AVATAR_DIR, `${leadId}.jpg`)
  try {
    const r = await evoFetch(`/chat/fetchProfilePictureUrl/${instanceName}`, { number: jid })
    const url: string | null = r?.profilePictureUrl || r?.picture || r?.url || null
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(AVATAR_DIR, { recursive: true })
    await writeFile(arquivo, buf)
    // ?v= força o navegador a recarregar quando a imagem muda.
    const publica = `/uploads/avatars/${leadId}.jpg?v=${Date.now()}`
    await prisma.lead.update({ where: { id: leadId }, data: { profilePicUrl: publica } }).catch(() => {})
    return publica
  } catch {
    return ''
  }
}

/**
 * Linha por onde perguntar a foto DESTE lead.
 *
 * Não é detalhe: o WhatsApp só devolve a foto de um grupo para uma linha que
 * está DENTRO dele, e a foto de um contato para a linha que o conhece. Usar
 * sempre a primeira instância ativa (o que este job fazia) fazia toda conversa
 * das outras linhas voltar "sem foto" — e, pior, ser MARCADA como sem foto, o
 * que a tirava da fila. No kobogo, 21 dos 30 grupos estavam assim.
 *
 * `Lead.instanceName` é o titular do grupo e a linha de entrada do contato; a
 * primeira ativa continua sendo o fallback de quem não tem essa marca.
 */
function instanciaDoLead(l: { instanceName: string | null }, ativas: Set<string>, padrao: string): string {
  return l.instanceName && ativas.has(l.instanceName) ? l.instanceName : padrao
}

/** Instâncias ligadas agora, para não perguntar por uma linha desativada. */
async function instanciasAtivas(): Promise<{ ativas: Set<string>; padrao: string | null }> {
  const linhas = await prisma.whatsAppInstance.findMany({
    where: { active: true },
    select: { instanceName: true },
    orderBy: { id: 'asc' },
  })
  return { ativas: new Set(linhas.map((i) => i.instanceName)), padrao: linhas[0]?.instanceName ?? null }
}

export interface ResultadoSync {
  tentados: number
  baixadas: number
  semFoto: number
}

/**
 * Varre quem está sem foto (ou com foto vencida) e busca.
 *
 * `limite` mantém cada passada barata: com base grande, buscar tudo de uma vez
 * seria centenas de chamadas à Evolution em sequência.
 */
export async function sincronizarFotosPendentes(limite = 40): Promise<ResultadoSync> {
  const { ativas, padrao } = await instanciasAtivas()
  if (!padrao) return { tentados: 0, baixadas: 0, semFoto: 0 }

  const candidatos = await prisma.lead.findMany({
    where: { profilePicUrl: null },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: limite,
    select: { id: true, whatsapp: true, groupJid: true, waLid: true, isGroup: true, instanceName: true },
  })

  let baixadas = 0
  let semFoto = 0
  for (const l of candidatos) {
    const jid = jidDoLead(l)
    if (!jid) { semFoto++; continue }
    const url = await sincronizarFoto(l.id, jid, instanciaDoLead(l, ativas, padrao))
    if (url) baixadas++
    else {
      semFoto++
      // Marca a tentativa para não repetir a cada tick em quem não tem foto
      // pública. Sem isso, a varredura ficaria presa nos mesmos contatos e
      // nunca alcançaria o resto da base.
      await prisma.lead.update({
        where: { id: l.id },
        data: { profilePicUrl: '' },
      }).catch(() => {})
    }
  }
  return { tentados: candidatos.length, baixadas, semFoto }
}

/** Renova fotos antigas (arquivo local acima do TTL). */
export async function renovarFotosVencidas(limite = 20): Promise<ResultadoSync> {
  const { ativas, padrao } = await instanciasAtivas()
  if (!padrao) return { tentados: 0, baixadas: 0, semFoto: 0 }

  const comFoto = await prisma.lead.findMany({
    where: { profilePicUrl: { startsWith: '/uploads/avatars/' } },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: limite * 5,
    select: { id: true, whatsapp: true, groupJid: true, waLid: true, isGroup: true, instanceName: true },
  })

  // Quem foi marcado como "sem foto" ('') entra em rodízio: a pessoa pode ter
  // colocado foto depois, e sem isso ficaria para sempre nas iniciais. Como o
  // update empurra o registro para o fim da ordenação por updatedAt, a fila
  // gira sozinha sem repetir os mesmos contatos.
  const semFotoAntes = await prisma.lead.findMany({
    where: { profilePicUrl: '' },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(5, Math.floor(limite / 4)),
    select: { id: true, whatsapp: true, groupJid: true, waLid: true, isGroup: true, instanceName: true },
  })

  let baixadas = 0
  let tentados = 0
  for (const l of [...comFoto, ...semFotoAntes]) {
    if (tentados >= limite + semFotoAntes.length) break
    try {
      const s = await stat(join(AVATAR_DIR, `${l.id}.jpg`))
      if (Date.now() - s.mtimeMs < TTL_MS) continue
    } catch { /* arquivo sumiu → rebaixa */ }
    const jid = jidDoLead(l)
    if (!jid) continue
    tentados++
    if (await sincronizarFoto(l.id, jid, instanciaDoLead(l, ativas, padrao))) baixadas++
  }
  return { tentados, baixadas, semFoto: tentados - baixadas }
}


/**
 * Tick de manutenção das fotos.
 *
 * Roda espaçado (10 min): é chamada de rede por contato, e foto de perfil não
 * tem urgência. Em base grande o backlog é consumido aos poucos, priorizando
 * quem tem conversa recente — que é quem o operador vê na tela.
 */
let timer: NodeJS.Timeout | null = null

export function startProfilePictureSync(): void {
  if (timer) return
  const rodar = async () => {
    try {
      const pend = await sincronizarFotosPendentes(40)
      const renov = await renovarFotosVencidas(10)
      if (pend.baixadas || renov.baixadas) {
        console.log(`[avatares] ${pend.baixadas} nova(s), ${renov.baixadas} renovada(s), ${pend.semFoto} sem foto pública`)
      }
    } catch (e: any) {
      console.warn('[avatares] tick falhou:', e?.message || e)
    }
  }
  // Primeira passada 30s após o boot: não concorre com o resto da inicialização.
  setTimeout(rodar, 30_000)
  timer = setInterval(rodar, 10 * 60_000)
  console.log('[avatares] sincronização iniciada (tick 10 min)')
}
