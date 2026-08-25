// Diagnóstico: a Evolution está entregando o nome da AGENDA ou o apelido do
// contato?
//
// A dúvida existe porque a Evolution guarda os dois na MESMA coluna
// (`Contact.pushName`) e pode sobrescrevê-la quando o contato manda mensagem.
// Se isso acontecer com um contato salvo (`isSaved: true`), o sync grava o
// apelido dele com força de "agenda" (60) — exatamente o que a hierarquia de
// nomes existe para impedir.
//
// O que este script faz, sem escrever nada:
//   1. Lê os contatos de cada instância conectada (`/chat/findContacts`).
//   2. Cruza com o que temos gravado no lead (`nomeWhatsappAgenda`, `pushName`).
//   3. Aponta os casos SUSPEITOS: contato marcado como salvo cujo nome na
//      Evolution é idêntico ao apelido que o contato usa — o sintoma que a
//      contaminação produziria.
//
// Coincidência legítima é comum (muita gente é salva com o mesmo nome que usa),
// então o número sozinho não prova nada. O que prova é o TESTE CONTROLADO no
// fim da saída: um contato salvo por você com um nome que ele não usa. Se o
// nome DELE aparecer ali, a Evolution sobrescreveu.
//
// Uso:  npx tsx --env-file=.env scripts/diagnostico-agenda-vs-pushname.ts

import { prisma } from '../src/lib/prisma.js'
import { phoneKey as phoneKeyOf } from '../src/lib/phone.js'

const EVO_URL = process.env.EVOLUTION_API_URL || ''
const EVO_KEY = process.env.EVOLUTION_API_KEY || ''

interface ContatoEvolution {
  remoteJid: string
  pushName?: string | null
  isSaved?: boolean
  type?: string
}

async function findContacts(instance: string): Promise<ContatoEvolution[]> {
  const res = await fetch(`${EVO_URL}/chat/findContacts/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`findContacts ${instance}: HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function soDigitos(jid: string): string {
  return (jid.split('@')[0] || '').replace(/\D/g, '')
}

async function main() {
  if (!EVO_URL || !EVO_KEY) {
    console.error('EVOLUTION_API_URL / EVOLUTION_API_KEY não configuradas.')
    process.exit(1)
  }

  const instancias = await prisma.whatsAppInstance.findMany({
    where: { active: true },
    select: { instanceName: true, name: true },
    orderBy: { id: 'asc' },
  })
  if (!instancias.length) {
    console.log('Nenhuma instância ativa.')
    return
  }

  for (const inst of instancias) {
    console.log(`\n═══ ${inst.name} (${inst.instanceName}) ═══`)

    let contatos: ContatoEvolution[]
    try {
      contatos = await findContacts(inst.instanceName)
    } catch (e: any) {
      console.log(`  não deu para ler: ${e.message}`)
      continue
    }

    const individuais = contatos.filter(
      (c) => c.type !== 'group' && !(c.remoteJid || '').endsWith('@g.us'),
    )
    const salvos = individuais.filter((c) => c.isSaved)
    console.log(`  contatos: ${individuais.length} · marcados como salvos: ${salvos.length}`)

    if (!salvos.length) {
      console.log('  ⚠ nenhum contato vem marcado como salvo — o sync não tem material para trabalhar.')
      continue
    }

    // Cruza com o que está gravado nos leads.
    const porChave = new Map<string, string>()
    for (const c of salvos) {
      const nome = (c.pushName ?? '').trim()
      if (nome) porChave.set(phoneKeyOf(soDigitos(c.remoteJid)) || soDigitos(c.remoteJid), nome)
    }

    const leads = await prisma.lead.findMany({
      where: { phoneKey: { in: [...porChave.keys()] } },
      select: { id: true, nome: true, nomeOrigem: true, nomeWhatsappAgenda: true, pushName: true, phoneKey: true },
    })

    const suspeitos: Array<{ id: number; nome: string; evolution: string; pushName: string }> = []
    let semPushName = 0
    let distintos = 0
    for (const l of leads) {
      const naEvolution = porChave.get(l.phoneKey ?? '') ?? ''
      const push = (l.pushName ?? '').trim()
      if (!push) { semPushName++; continue }
      if (naEvolution && naEvolution === push) {
        suspeitos.push({ id: l.id, nome: l.nome ?? '', evolution: naEvolution, pushName: push })
      } else {
        distintos++
      }
    }

    console.log(`  leads cruzados: ${leads.length}`)
    console.log(`    · sem apelido conhecido (nada a comparar): ${semPushName}`)
    console.log(`    · agenda DIFERENTE do apelido (saudável):  ${distintos}`)
    console.log(`    · agenda IGUAL ao apelido (suspeito):      ${suspeitos.length}`)

    if (suspeitos.length) {
      console.log('\n  Amostra dos suspeitos (pode ser coincidência legítima):')
      for (const s of suspeitos.slice(0, 10)) {
        console.log(`    lead #${s.id} — exibido "${s.nome}" · Evolution "${s.evolution}" · apelido "${s.pushName}"`)
      }
    }
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  TESTE CONTROLADO — é ele que decide, não os números acima           ║
╚══════════════════════════════════════════════════════════════════════╝

Os números acima não separam contaminação de coincidência: muita gente é
salva na agenda com o mesmo nome que usa no WhatsApp. Para saber de verdade:

  1. No celular conectado, salve um número de teste com um nome que a pessoa
     NÃO usa no WhatsApp dela. Ex.: salve como "TESTE AGENDA BYCHAT".
  2. Peça para esse número mandar uma mensagem qualquer para o seu WhatsApp.
     (O apelido dele precisa ser diferente — "João", "Maria", o que for.)
  3. Rode este script de novo e procure o número na saída.

  Se aparecer "TESTE AGENDA BYCHAT"  → a agenda vence. A regra está sã e o
                                        sync pode ficar como está.
  Se aparecer o apelido do contato   → a Evolution sobrescreveu a coluna. Aí o
                                        sync precisa parar de confiar em
                                        \`Contact.pushName\` para contato salvo e
                                        buscar o nome por outro caminho.
`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
