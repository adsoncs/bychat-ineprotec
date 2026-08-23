// Passada única no acervo: confere o telefone dos leads que já existiam antes
// da checagem automática entrar no ar.
//
// Vai DEVAGAR de propósito. Consultar números em rajada é o padrão que o
// WhatsApp associa a spam, e quem paga a conta é a linha de atendimento — a
// mesma que o time usa o dia inteiro.
//
// Uso:  npx tsx scripts/backfill-whatsapp-check.ts [--aplicar] [--limite=N]
import { prisma } from '../src/lib/prisma.js'
import { checarNumeroDoLead } from '../src/services/whatsappNumberCheck.js'

const APLICAR = process.argv.includes('--aplicar')
const LIMITE = Number(process.argv.find((a) => a.startsWith('--limite='))?.split('=')[1] || 500)
/** Uma consulta a cada 4s: ~15/min, ritmo de gente usando o painel. */
const INTERVALO_MS = 4000

async function main() {
  // Só quem ainda pode ser trabalhado: ciclo aberto, não é grupo, tem telefone
  // e ainda não foi conferido.
  const leads = await prisma.$queryRawUnsafe<{ id: number; nome: string; status: string }[]>(`
    SELECT id, nome, status FROM bychat_leads
     WHERE outcome IS NULL AND isGroup = 0
       AND whatsapp <> '' AND CHAR_LENGTH(whatsapp) >= 10
       AND JSON_EXTRACT(formData, '$._waCheck') IS NULL
     ORDER BY (status = 'NOVO') DESC, lastActivityAt IS NULL DESC, id DESC
     LIMIT ${LIMITE}
  `)

  const minutos = Math.round((leads.length * INTERVALO_MS) / 60000)
  console.log(`${leads.length} lead(s) sem checagem · ~${minutos} min no ritmo atual`)
  if (!APLICAR) {
    console.log('== SIMULAÇÃO (use --aplicar) ==')
    for (const l of leads.slice(0, 5)) console.log(`   #${l.id} ${l.status} — ${l.nome}`)
    return
  }

  let semWhats = 0
  let inconclusivos = 0
  for (const [i, l] of leads.entries()) {
    const r = await checarNumeroDoLead(l.id).catch(() => null)
    if (r?.existe === false) { semWhats++; console.log(`   sem WhatsApp: #${l.id} ${l.nome}`) }
    if (!r || r.existe === null) inconclusivos++
    if (i % 25 === 24) console.log(`   … ${i + 1}/${leads.length}`)
    if (i < leads.length - 1) await new Promise((r) => setTimeout(r, INTERVALO_MS))
  }
  console.log(`\nconferidos: ${leads.length} · sem WhatsApp: ${semWhats} · inconclusivos: ${inconclusivos}`)
}

main().then(() => process.exit(0))
