// Põe nome e foto dos grupos de WhatsApp em dia com o que está no aparelho.
//
// Por que existe: até 08/09/2026 o nome do grupo só era consultado na PRIMEIRA
// mensagem (e depois disso, apenas enquanto fosse placeholder). Grupo renomeado
// no WhatsApp ficava com o nome antigo para sempre — no kobogo o cliente não
// achava mais a conversa na busca porque procurava pelo nome novo. A foto nunca
// era buscada: o cache de avatar do webhook ignora JID de grupo (18 dígitos).
//
// O código novo mantém isso em dia sozinho (evento `groups.update` + revalidação
// com TTL a cada mensagem). Este script é para o passivo: os grupos que já estão
// no banco e podem levar semanas até receberem mensagem.
//
// Grupo de linha desconectada ou que a conta já não participa apenas falha na
// consulta e é reportado — não apaga nem renomeia nada com palpite.
//
//   npx tsx --env-file=.env scripts/sincronizar-perfil-grupos.ts          # simulação
//   npx tsx --env-file=.env scripts/sincronizar-perfil-grupos.ts --apply

import { prisma } from '../src/lib/prisma.js'
import { fetchGroupInfo, sincronizarPerfilDoGrupo } from '../src/services/whatsappGroups.js'

const APLICAR = process.argv.includes('--apply')

async function main() {
  const grupos = await prisma.lead.findMany({
    where: { isGroup: true, groupJid: { not: null }, instanceName: { not: null } },
    select: { id: true, nome: true, groupJid: true, instanceName: true, profilePicUrl: true },
    orderBy: { id: 'asc' },
  })
  console.log(`${grupos.length} grupo(s) com número titular\n`)

  let renomeados = 0
  let fotos = 0
  let falhas = 0

  for (const g of grupos) {
    const jid = g.groupJid as string
    const inst = g.instanceName as string

    if (!APLICAR) {
      const info = await fetchGroupInfo(inst, jid)
      if (!info) {
        falhas++
        console.log(`  [erro ] ${g.id} ${g.nome} — ${inst} não respondeu (linha desconectada?)`)
        continue
      }
      const mudaNome = info.subject && info.subject !== g.nome
      const mudaFoto = !!info.pictureUrl && !(g.profilePicUrl || '').startsWith('/uploads/avatars/')
      if (mudaNome) renomeados++
      if (mudaFoto) fotos++
      if (mudaNome || mudaFoto) {
        console.log(`  [mudar] ${g.id} ${mudaNome ? `"${g.nome}" -> "${info.subject}"` : g.nome}${mudaFoto ? ' + foto' : ''}`)
      }
      continue
    }

    const r = await sincronizarPerfilDoGrupo(g, inst, jid, { force: true })
    if (!r) {
      const info = await fetchGroupInfo(inst, jid)
      if (!info) {
        falhas++
        console.log(`  [erro ] ${g.id} ${g.nome} — ${inst} não respondeu (linha desconectada?)`)
      }
      continue
    }
    if (r.nome) renomeados++
    if (r.profilePicUrl) fotos++
    console.log(`  [ok   ] ${g.id} ${r.nome ? `"${g.nome}" -> "${r.nome}"` : g.nome}${r.profilePicUrl ? ' + foto' : ''}`)
  }

  console.log(`\n${APLICAR ? 'Aplicado' : 'Simulação'}: ${renomeados} nome(s), ${fotos} foto(s), ${falhas} sem resposta.`)
  if (!APLICAR) console.log('Rode com --apply para gravar.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
