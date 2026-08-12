// Hierarquia do nome do contato: quem pode sobrescrever quem.
// Cria leads de teste, exercita registrarNome() e apaga tudo no fim.
//
//   npx tsx --env-file=.env scripts/test-lead-nome-origem.ts

import { prisma } from '../src/lib/prisma.js'
import {
  registrarNome, podeSubstituir, telefoneComoNome, nomeInicialWhatsapp,
} from '../src/services/leadDisplayName.js'

let falhas = 0
function checa(ok: boolean, desc: string, detalhe = '') {
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${desc}${detalhe ? ` — ${detalhe}` : ''}`)
}

async function criarLead(nome: string, origem: string | null): Promise<number> {
  const l = await prisma.lead.create({
    data: {
      empresa: '__nometest', nome, email: 'nome@example.invalid',
      whatsapp: `5500000009${Math.floor(Math.random() * 900 + 100)}`,
      formData: {}, scores: {}, ...(origem ? { nomeOrigem: origem } : {}),
    },
    select: { id: true },
  })
  return l.id
}

async function nomeDe(id: number) {
  const l = await prisma.lead.findUnique({ where: { id }, select: { nome: true, nomeOrigem: true, pushName: true, nomeWhatsappAgenda: true } })
  return l!
}

async function main() {
  const criados: number[] = []

  // ── formatação do telefone ──
  checa(telefoneComoNome('5562998716285') === '(62) 99871-6285', 'telefone 13 dígitos vira (62) 99871-6285', telefoneComoNome('5562998716285'))
  checa(telefoneComoNome('556285407003') === '(62) 8540-7003', 'telefone 12 dígitos (sem nono)', telefoneComoNome('556285407003'))
  checa(telefoneComoNome('') === 'Sem nome', 'sem telefone → "Sem nome"')

  // ── nome inicial de um contato de WhatsApp ──
  const comAgenda = nomeInicialWhatsapp({ nomeAgenda: 'Padaria do Zé', phone: '5562998716285' })
  checa(comAgenda.nome === 'Padaria do Zé' && comAgenda.origem === 'agenda', 'agenda vence o telefone')
  const semAgenda = nomeInicialWhatsapp({ nomeAgenda: null, phone: '5562998716285' })
  checa(semAgenda.nome === '(62) 99871-6285' && semAgenda.origem === 'telefone', 'sem agenda → telefone formatado')

  // ── tabela de força ──
  checa(podeSubstituir('telefone', 'agenda'), 'agenda substitui telefone')
  checa(podeSubstituir('pushname', 'agenda'), 'agenda substitui pushname')
  checa(!podeSubstituir('manual', 'agenda'), 'agenda NÃO substitui manual')
  checa(!podeSubstituir('formulario', 'agenda'), 'agenda NÃO substitui formulário')
  checa(!podeSubstituir('agenda', 'agenda'), 'agenda não se substitui (empate mantém)')
  checa(podeSubstituir('agenda', 'manual'), 'manual substitui agenda')

  // ── comportamento real no banco ──
  const idManual = await criarLead('Nathalia Goulart', 'manual'); criados.push(idManual)
  await registrarNome({ leadId: idManual, nome: 'Nath 💅', origem: 'agenda', nomeAgenda: 'Nath 💅' })
  const manual = await nomeDe(idManual)
  checa(manual.nome === 'Nathalia Goulart', 'sync da agenda não toca em nome digitado', manual.nome ?? '')
  checa(manual.nomeWhatsappAgenda === 'Nath 💅', 'mas guarda o nome da agenda como referência')

  const idTelefone = await criarLead('(62) 99871-6285', 'telefone'); criados.push(idTelefone)
  await registrarNome({ leadId: idTelefone, nome: 'Padaria do Zé', origem: 'agenda', nomeAgenda: 'Padaria do Zé' })
  const tel = await nomeDe(idTelefone)
  checa(tel.nome === 'Padaria do Zé' && tel.nomeOrigem === 'agenda', 'agenda melhora um nome que era só o número')

  const idPush = await criarLead('Zé da Obra 🔨', 'pushname'); criados.push(idPush)
  await registrarNome({ leadId: idPush, pushName: 'Zé da Obra 🔨', origem: 'pushname' })
  const push1 = await nomeDe(idPush)
  checa(push1.nome === 'Zé da Obra 🔨' && push1.pushName === 'Zé da Obra 🔨', 'pushName é guardado no campo próprio')
  await registrarNome({ leadId: idPush, nome: 'José Marcos', origem: 'agenda', nomeAgenda: 'José Marcos' })
  const push2 = await nomeDe(idPush)
  checa(push2.nome === 'José Marcos', 'agenda corrige um lead que estava com o apelido', push2.nome ?? '')
  checa(push2.pushName === 'Zé da Obra 🔨', 'e o apelido continua acessível como referência')

  // pushName nunca vira nome, mesmo em lead sem origem definida
  const idSemOrigem = await criarLead('(11) 98888-7777', null); criados.push(idSemOrigem)
  await registrarNome({ leadId: idSemOrigem, pushName: 'Vendas 24h ⚡', origem: 'pushname' })
  const semOrigem = await nomeDe(idSemOrigem)
  checa(semOrigem.nome === '(11) 98888-7777', 'pushName não assume o nome de lead já nomeado', semOrigem.nome ?? '')

  await prisma.lead.deleteMany({ where: { id: { in: criados } } })
  console.log(`limpeza: ${criados.length} leads de teste removidos`)
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
