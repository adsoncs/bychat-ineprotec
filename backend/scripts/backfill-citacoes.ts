// Recupera citações perdidas: respostas que chegaram antes da mensagem citada
// ficaram com `quotedMsgId` nulo e o vínculo foi descartado.
//
// Duas fontes, nesta ordem:
//   1. `quotedExternalId` já gravado (respostas novas) — resolve local, sem rede;
//   2. o Postgres da Evolution, que guarda `contextInfo.stanzaId` de cada
//      mensagem — cobre o histórico anterior à coluna existir.
//
//   npx tsx --env-file=.env scripts/backfill-citacoes.ts [--apply] [--instancias=a,b]
//
// Sem --apply só relata. Idempotente: nunca sobrescreve citação já resolvida.

import { prisma } from '../src/lib/prisma.js'

const APLICAR = process.argv.includes('--apply')
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]

async function pelaColunaLocal(): Promise<number> {
  let resolvidas = 0
  for (;;) {
    const pend = await prisma.message.findMany({
      where: { quotedMsgId: null, quotedExternalId: { not: null } },
      select: { id: true, quotedExternalId: true },
      take: 500,
      skip: resolvidas,
    })
    if (!pend.length) break
    const externos = [...new Set(pend.map((p) => p.quotedExternalId as string))]
    const achadas = await prisma.message.findMany({
      where: { externalId: { in: externos } },
      select: { id: true, externalId: true },
    })
    const mapa = new Map(achadas.map((a) => [a.externalId, a.id]))
    for (const p of pend) {
      const alvo = mapa.get(p.quotedExternalId as string)
      if (!alvo) continue
      if (APLICAR) await prisma.message.update({ where: { id: p.id }, data: { quotedMsgId: alvo } })
      resolvidas++
    }
    if (pend.length < 500) break
  }
  return resolvidas
}

async function pelaEvolution(instancias: string[]): Promise<{ pares: number; resolvidas: number }> {
  const { Client } = await import('pg')
  const uri = process.env.EVOLUTION_DB_URI
  if (!uri) { console.log('  (EVOLUTION_DB_URI não definida — pulando a fonte da Evolution)'); return { pares: 0, resolvidas: 0 } }
  const pg = new Client({ connectionString: uri })
  await pg.connect()
  const { rows } = await pg.query(
    `SELECT m."key"->>'id' AS id, m."contextInfo"->>'stanzaId' AS citada
       FROM "Message" m JOIN "Instance" i ON i.id = m."instanceId"
      WHERE i.name = ANY($1) AND m."contextInfo"->>'stanzaId' IS NOT NULL`,
    [instancias],
  )
  await pg.end()

  let resolvidas = 0
  for (let i = 0; i < rows.length; i += 400) {
    const lote = rows.slice(i, i + 400)
    const respostas = await prisma.message.findMany({
      where: { externalId: { in: lote.map((r: any) => r.id) }, quotedMsgId: null },
      select: { id: true, externalId: true },
    })
    if (!respostas.length) continue
    const citadasIds = lote.map((r: any) => r.citada)
    const citadas = await prisma.message.findMany({
      where: { externalId: { in: citadasIds } },
      select: { id: true, externalId: true },
    })
    const porExterno = new Map(citadas.map((c) => [c.externalId, c.id]))
    const paraCitada = new Map(lote.map((r: any) => [r.id, r.citada]))
    for (const r of respostas) {
      const alvo = porExterno.get(paraCitada.get(r.externalId as string))
      if (!alvo) continue
      if (APLICAR) {
        await prisma.message.update({
          where: { id: r.id },
          data: { quotedMsgId: alvo, quotedExternalId: paraCitada.get(r.externalId as string) },
        })
      }
      resolvidas++
    }
  }
  return { pares: rows.length, resolvidas }
}

async function main() {
  const antes = await prisma.message.count({ where: { quotedMsgId: { not: null } } })
  console.log(`citações resolvidas hoje: ${antes}\n`)

  console.log('1) pela coluna quotedExternalId (local)')
  const local = await pelaColunaLocal()
  console.log(`   ${local} recuperáveis\n`)

  const instancias = (arg('instancias') || '').split(',').map((s) => s.trim()).filter(Boolean)
  let evo = { pares: 0, resolvidas: 0 }
  if (instancias.length) {
    console.log(`2) pelo histórico da Evolution (${instancias.join(', ')})`)
    evo = await pelaEvolution(instancias)
    console.log(`   ${evo.pares} pares na Evolution → ${evo.resolvidas} recuperáveis\n`)
  }

  const depois = await prisma.message.count({ where: { quotedMsgId: { not: null } } })
  console.log(APLICAR
    ? `APLICADO: ${antes} → ${depois} (+${depois - antes})`
    : `dry-run: ${local + evo.resolvidas} seriam recuperadas (use --apply)`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
