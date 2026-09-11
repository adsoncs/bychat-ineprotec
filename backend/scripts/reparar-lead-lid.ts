// scripts/reparar-lead-lid.ts
//
// Devolve o telefone a quem entrou só com o LID do WhatsApp.
//
// O LID (`123...@lid`) é o identificador de privacidade da Meta. Quando ele
// chega sem o número real, o webhook gravava os dígitos dele na coluna
// `whatsapp` "só pra não derrubar a mensagem". O efeito colateral é caro e
// silencioso: a ficha mostra um telefone que ninguém disca, o disparo ativo não
// chega, e a mesma pessoa volta com o número real e vira OUTRO lead.
//
// O reparo tem duas saídas, nesta ordem:
//
//   1. TELEFONE DE VERDADE — a Evolution guarda o número real em
//      `lastMessage.key.remoteJidAlt` do chat. É dado, não palpite: o lead
//      recupera o telefone e a conversa inteira passa a ser discável.
//   2. Sem isso, a coluna fica VAZIA e o LID vai para `waLid`, que é onde ele
//      liga a conversa à pessoa. A ficha passa a dizer a verdade — "ainda não
//      temos o telefone" — em vez de exibir um número inventado.
//
// Quando o telefone recuperado JÁ é de outro lead, as duas fichas são a mesma
// pessoa: o atendimento está partido em duas conversas. Isso não se resolve
// mexendo numa coluna — se resolve fundindo, e fundir é decisão de quem conhece
// o atendimento. Por isso a fusão só acontece com `--fundir` dito de propósito;
// sem ela o script relata a dupla e não toca em nenhum dos dois lados.
//
// A fusão usa `mergeLeads` (services/dedup.ts), a mesma do painel: move
// mensagens, eventos e atividades, respeita a hierarquia de nomes e registra o
// que aconteceu na timeline de quem fica.
//
//   npx tsx scripts/reparar-lead-lid.ts                       (só relata)
//   npx tsx scripts/reparar-lead-lid.ts --aplicar             (repara as colunas)
//   npx tsx scripts/reparar-lead-lid.ts --aplicar --fundir    (repara e funde as duplas)
//
// Antes de `--fundir`, rode `conferir-fichas-em-dobro-lid.ts`: ele põe as duas
// fichas lado a lado com mensagens, histórico, funil e dono de cada uma.

import { prisma } from '../src/lib/prisma.js'
import { isGroupJid, isLikelyLid, onlyDigits, phoneKey } from '../src/lib/phone.js'
import { SEM_NUMERO, telefoneComoNome } from '../src/services/leadDisplayName.js'

const aplicar = process.argv.includes('--aplicar')
const fundir = process.argv.includes('--fundir')

const API = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '')
const KEY = process.env.EVOLUTION_API_KEY || ''

/**
 * Pergunta à Evolution qual é o número por trás de um LID.
 *
 * `remoteJidAlt` é o campo em que a Evolution entrega o número real quando a
 * conversa usa `addressingMode: "lid"`. Ele aparece na última mensagem do chat,
 * então é de lá que se lê.
 */
async function numeroRealDoLid(instancia: string, lid: string): Promise<{ phone: string; pushName: string } | null> {
  if (!API || !KEY) return null
  try {
    const r = await fetch(`${API}/chat/findChats/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { remoteJid: lid } }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!r.ok) return null
    const chats = (await r.json()) as any[]
    const chat = Array.isArray(chats) ? chats[0] : null
    const alt: string = chat?.lastMessage?.key?.remoteJidAlt || ''
    const pushName: string = chat?.lastMessage?.pushName || chat?.pushName || ''
    const phone = alt.endsWith('@s.whatsapp.net') ? alt.replace('@s.whatsapp.net', '') : ''
    // Só aceita o que é telefone de verdade: phoneKey devolve null para lixo.
    if (!phone || isLikelyLid(phone) || !phoneKey(phone)) return null
    return { phone, pushName }
  } catch {
    return null
  }
}

/** Instâncias onde procurar um lead que não tem instância gravada. */
async function instanciasCandidatas(doLead: string | null): Promise<string[]> {
  if (doLead) return [doLead]
  const todas = await prisma.whatsAppInstance.findMany({ select: { instanceName: true } })
  return todas.map((i) => i.instanceName).filter(Boolean)
}

const leads = await prisma.lead.findMany({
  select: {
    id: true, uid: true, nome: true, nomeOrigem: true, whatsapp: true, waLid: true,
    phoneKey: true, groupJid: true, isGroup: true, pushName: true, instanceName: true,
    createdAt: true,
  },
  orderBy: { id: 'asc' },
})

const afetados = leads.filter((l) => isLikelyLid(l.whatsapp) || isGroupJid(l.whatsapp))

console.log(`\n═══ LID NA COLUNA DE TELEFONE ═══\n`)
console.log(`${leads.length} lead(s) no total · ${afetados.length} com LID ou JID de grupo em \`whatsapp\`\n`)
if (afetados.length === 0) {
  console.log('Nada a reparar.\n')
  await prisma.$disconnect()
  process.exit(0)
}

let recuperados = 0, esvaziados = 0, grupos = 0, colisoes = 0, fundidos = 0

for (const l of afetados) {
  const bruto = l.whatsapp
  const ehGrupo = isGroupJid(bruto) || isGroupJid(l.groupJid) || l.isGroup
  const lid = l.waLid || (isGroupJid(bruto) ? bruto : `${onlyDigits(bruto)}@lid`)
  const etiqueta = `#${l.id} ${l.uid} · ${l.createdAt.toISOString().slice(0, 10)} · "${l.nome}"`

  // ── Grupo ──────────────────────────────────────────────────────────────
  // Grupo não é pessoa e não tem telefone. O JID dele mora em `groupJid`, que
  // é por onde o webhook o encontra; a coluna de telefone só atrapalha.
  if (ehGrupo) {
    const jid = isGroupJid(l.groupJid) ? l.groupJid! : `${onlyDigits(bruto)}@g.us`
    console.log(`${etiqueta}\n  grupo → whatsapp vazio, groupJid=${jid}`)
    grupos++
    if (aplicar) {
      await prisma.lead.update({
        where: { id: l.id },
        data: { whatsapp: '', groupJid: jid, isGroup: true, phoneKey: null },
      })
    }
    continue
  }

  // ── Pessoa: tenta o número real antes de esvaziar ──────────────────────
  let achado: { phone: string; pushName: string } | null = null
  for (const inst of await instanciasCandidatas(l.instanceName)) {
    achado = await numeroRealDoLid(inst, lid)
    if (achado) break
  }

  if (achado) {
    // Fusão não é reparo: se o telefone já é de outra ficha, para aqui.
    const jaEDeOutro = await prisma.lead.findFirst({
      where: {
        id: { not: l.id },
        OR: [{ whatsapp: achado.phone }, { phoneKey: phoneKey(achado.phone) ?? '__nenhum__' }],
        ...(l.instanceName ? { instanceName: l.instanceName } : {}),
      },
      select: { id: true, uid: true, nome: true },
    })
    if (jaEDeOutro) {
      if (!fundir) {
        console.log(`${etiqueta}\n  ⚠ ${achado.phone} já é do lead #${jaEDeOutro.id} ${jaEDeOutro.uid} ("${jaEDeOutro.nome}") — FICHA EM DOBRO. Nada foi tocado (use --fundir).`)
        colisoes++
        continue
      }

      // O `waLid` precisa ir para a ficha que FICA. É por ele que a próxima
      // mensagem em modo privacidade encontra esta pessoa; sem isso a fusão
      // seria desfeita pela mensagem seguinte, que abriria a duplicata de novo.
      console.log(`${etiqueta}\n  ⇢ fundido em #${jaEDeOutro.id} ${jaEDeOutro.uid} ("${jaEDeOutro.nome}") · ${achado.phone} · waLid=${lid}`)
      fundidos++
      if (aplicar) {
        await prisma.lead.update({ where: { id: l.id }, data: { waLid: lid, whatsapp: '', phoneKey: null } })
        const { mergeLeads } = await import('../src/services/dedup.js')
        await mergeLeads({ keepId: jaEDeOutro.id, mergeId: l.id, operatorName: 'reparo do LID (script)' })
      }
      continue
    }

    // O nome só muda se o que está lá for o LID cru (origem fraca). Nome
    // digitado por alguém, vindo de formulário ou da agenda permanece.
    const nomeEhOLid = l.nome === bruto || l.nome === telefoneComoNome(bruto) || l.nome === SEM_NUMERO
    console.log(`${etiqueta}\n  ✔ telefone recuperado: ${achado.phone}${achado.pushName ? `  (WhatsApp: "${achado.pushName}")` : ''}${nomeEhOLid ? '  · nome passa a ser o número formatado' : ''}`)
    recuperados++
    if (aplicar) {
      await prisma.lead.update({
        where: { id: l.id },
        data: {
          whatsapp: achado.phone,
          waLid: lid,
          ...(nomeEhOLid ? { nome: telefoneComoNome(achado.phone), nomeOrigem: 'telefone' } : {}),
          ...(achado.pushName && !l.pushName ? { pushName: achado.pushName.slice(0, 191) } : {}),
        },
      })
    }
    continue
  }

  // ── Sem número: a ficha passa a dizer a verdade ────────────────────────
  const nomeEhOLid = l.nome === bruto || l.nome === telefoneComoNome(bruto)
  console.log(`${etiqueta}\n  → sem número na Evolution: whatsapp vazio, waLid=${lid}${nomeEhOLid ? `  · nome passa a "${SEM_NUMERO}"` : ''}`)
  esvaziados++
  if (aplicar) {
    await prisma.lead.update({
      where: { id: l.id },
      data: {
        whatsapp: '',
        waLid: lid,
        phoneKey: null,
        ...(nomeEhOLid ? { nome: SEM_NUMERO, nomeOrigem: 'sem_numero' } : {}),
      },
    })
  }
}

console.log(`\n${'─'.repeat(60)}`)
console.log(`  telefone recuperado ......... ${recuperados}`)
console.log(`  sem número (ficha honesta) .. ${esvaziados}`)
console.log(`  grupos ...................... ${grupos}`)
console.log(`  fichas em dobro fundidas .... ${fundidos}`)
console.log(`  fichas em dobro a decidir ... ${colisoes}`)
console.log(aplicar ? '\nGravado.\n' : '\nNada foi gravado. Rode com --aplicar.\n')

await prisma.$disconnect()
