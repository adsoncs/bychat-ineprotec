// scripts/alerta-de-teste.ts
//
// Põe (ou tira) um alerta de mentira na caixa da gestão, para o time olhar o
// sino antes de qualquer produtor real existir.
//
// A Fase 2 fecha sem produtor de propósito: se o sino não convencer com UM
// alerta, não melhora com sessenta — e é o que apareceria no primeiro tick se a
// Fase 3 entrasse junto (18 atividades atrasadas + 34 reuniões sem desfecho +
// 10 negociações paradas).
//
// Uso:
//   cd backend && npx tsx --env-file=.env scripts/alerta-de-teste.ts          # põe
//   cd backend && npx tsx --env-file=.env scripts/alerta-de-teste.ts --tirar  # tira

import { prisma } from '../src/lib/prisma.js'
import { raiseAlert, resolveAlert } from '../src/services/alertService.js'

const CHAVE = 'demo:sino'
const TIRAR = process.argv.includes('--tirar')

async function main() {
  if (TIRAR) {
    await resolveAlert(CHAVE)
    await prisma.alert.deleteMany({ where: { dedupeKey: CHAVE } })
    console.log('alerta de teste removido')
    return
  }

  const r = await raiseAlert({
    dedupeKey: CHAVE,
    kind: 'demo',
    severity: 'warning',
    audience: 'management',
    title: 'Sino de alertas no ar',
    body: 'Este é um alerta de mentira, só para vocês verem como fica. Use o X para tirar da sua caixa — isso não apaga da caixa dos outros. Para remover de todo mundo: npx tsx --env-file=.env scripts/alerta-de-teste.ts --tirar',
  })
  console.log(`alerta ${r.novo ? 'criado' : 'atualizado'} (id ${r.alertId})`)
  console.log(`na caixa de ${r.novosDestinatarios.length || '(já estavam com ele)'} pessoa(s)`)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
