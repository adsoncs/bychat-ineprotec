// scripts/setup-alertas.ts
//
// Cria os limiares dos alertas em Setting e mostra o que cada vigilante veria
// AGORA, sem enviar nada para fora.
//
// Os limiares moram em Setting mesmo sem tela de configuração: ajustar quantos
// dias contam como "proposta parada" não deveria exigir deploy. A tela vem
// depois — configurar antes de saber o que incomoda é construir opção que
// ninguém mexe.
//
// Uso:
//   cd backend && npx tsx --env-file=.env scripts/setup-alertas.ts            # simula
//   cd backend && npx tsx --env-file=.env scripts/setup-alertas.ts --aplicar
//   cd backend && npx tsx --env-file=.env scripts/setup-alertas.ts --varrer    # roda os vigilantes agora
//   cd backend && npx tsx --env-file=.env scripts/setup-alertas.ts --escalonar # o que sairia fora do painel (não envia)
//   cd backend && npx tsx --env-file=.env scripts/setup-alertas.ts --saude     # o sino está ajudando ou virando ruído?

import { prisma } from '../src/lib/prisma.js'

const APLICAR = process.argv.includes('--aplicar')
const VARRER = process.argv.includes('--varrer')
const ESCALONAR = process.argv.includes('--escalonar')
const SAUDE = process.argv.includes('--saude')

/** [chave, padrão, o que faz] */
const LIMIARES: Array<[string, string, string, string]> = [
  ['alertas.atividade_janela_dias', '7', 'number', 'Atividade atrasada: só alerta se venceu nos últimos N dias'],
  ['alertas.negociacao_parada_dias', '7', 'number', 'Proposta parada: dias sem movimento para virar alerta'],
  ['alertas.negociacao_janela_dias', '45', 'number', 'Proposta parada: teto de idade — mais velho que isso é passivo'],
  ['alertas.lead_parado_dias', '3', 'number', 'Lead sem resposta: dias sem interação para virar alerta'],
  ['alertas.lead_janela_dias', '10', 'number', 'Lead sem resposta: teto de idade — mais velho que isso é passivo'],
  ['alertas.digest_ativo', 'false', 'boolean', 'Resumo diário de pendências por WhatsApp/e-mail'],
  ['alertas.digest_hora', '8', 'number', 'Hora do dia em que o resumo sai (0-23)'],
  ['alertas.escalonamento_ativo', 'false', 'boolean', 'Avisar fora do painel um crítico que ninguém leu (máx. 2 avisos)'],
  ['alertas.escalonamento_horas', '2', 'number', 'Escalonamento: horas de carência antes do primeiro aviso'],
  ['alertas.escalonamento_reforco_horas', '24', 'number', 'Escalonamento: horas entre o primeiro e o segundo aviso'],
  ['alertas.retencao_dias', '60', 'number', 'Dias para apagar alerta já resolvido (aberto nunca é apagado)'],
]

async function main() {
  if (SAUDE) return saude()
  if (VARRER) return varrer()
  if (ESCALONAR) return escalonar()

  console.log(APLICAR ? 'Aplicando…\n' : 'SIMULAÇÃO — use --aplicar\n')
  for (const [key, value, tipo, label] of LIMIARES) {
    const atual = await prisma.setting.findUnique({ where: { key } })
    if (atual) { console.log(`  ${key} = ${atual.value} (mantido)`); continue }
    if (!APLICAR) { console.log(`  [simulação] ${key} = ${value}`); continue }
    await prisma.setting.create({ data: { key, value, label, grp: 'alertas', fieldType: tipo } })
    console.log(`  ${key} = ${value}`)
  }
  console.log('\nO resumo diário nasce DESLIGADO. Para ligar:')
  console.log("  UPDATE bychat_settings SET value='true' WHERE `key`='alertas.digest_ativo';")
  console.log('\nO escalonamento de crítico também nasce DESLIGADO. Para ligar:')
  console.log("  UPDATE bychat_settings SET value='true' WHERE `key`='alertas.escalonamento_ativo';")
  console.log('  Confira antes o que sairia com: --escalonar')
}

/**
 * Roda todos os vigilantes e mostra o placar. Cria alertas de verdade.
 *
 * Ressalva: "canais caídos" sempre aparece como 0 aqui. Ele lê o último
 * resultado do evolutionMonitor, que é estado em MEMÓRIA do servidor — este
 * script é outro processo e não tem acesso a ele. Dentro do servidor o
 * vigilante funciona; para conferir canal, use a tela de diagnóstico da
 * Evolution.
 */
async function varrer() {
  const { varrerTokens } = await import('../src/services/tokenHealthWatch.js')
  const { varrerAtividadesAtrasadas, varrerNegociacoesParadas, varrerCanaisCaidos, varrerLeadsSemResposta } =
    await import('../src/services/pendenciaWatch.js')
  const { varrerReunioesSemDesfecho, varrerBotsQueFalharam } =
    await import('../src/services/meetingOutcome.js')
  const { montarDigest } = await import('../src/services/alertDigest.js')

  const passos: Array<[string, () => Promise<{ abertos: number; fechados: number }>]> = [
    ['integrações/tokens', varrerTokens],
    ['canais caídos', varrerCanaisCaidos],
    ['reuniões sem desfecho', varrerReunioesSemDesfecho],
    ['bots que falharam', varrerBotsQueFalharam],
    ['negociações paradas', varrerNegociacoesParadas],
    ['atividades atrasadas', varrerAtividadesAtrasadas],
    ['leads sem resposta', varrerLeadsSemResposta],
  ]

  console.log('Varredura completa\n')
  for (const [nome, fn] of passos) {
    try {
      const r = await fn()
      console.log(`  ${nome.padEnd(24)} ${String(r.abertos).padStart(3)} aberto(s), ${r.fechados} fechado(s)`)
    } catch (e: any) {
      console.log(`  ${nome.padEnd(24)} FALHOU: ${e.message}`)
    }
  }

  const porKind = await prisma.alert.groupBy({
    by: ['kind', 'severity'],
    where: { status: 'open' },
    _count: true,
  })
  console.log('\nAlertas abertos:')
  for (const g of porKind.sort((a, b) => b._count - a._count)) {
    console.log(`  ${g.kind.padEnd(24)} ${g.severity.padEnd(9)} ${g._count}`)
  }

  // O acervo fecha a conta: sem ele, quem lê o placar acima acha que 15
  // pendências é tudo o que existe.
  const { acervo } = await import('../src/services/alertBacklog.js')
  const fora = await acervo()
  if (fora.length) {
    const total = fora.reduce((s, i) => s + i.quantidade, 0)
    console.log(`\n── Fora do sino de propósito: ${total} item(ns) ──`)
    for (const i of fora) {
      console.log(`  ${i.rotulo.padEnd(26)} ${String(i.quantidade).padStart(3)}  ${i.motivo}` +
        (i.maisAntigoDias !== null ? ` (mais antigo: ${i.maisAntigoDias} dias)` : ''))
    }
    console.log('  Precisam de decisão humana, não de notificação.')
  }

  console.log('\n── Como o resumo diário sairia ──')
  const texto = await montarDigest()
  console.log(texto ? texto.split('\n').map((l) => '  ' + l).join('\n') : '  (nada a enviar)')
}

/**
 * O placar do próprio sino: que tipo de alerta está sendo resolvido e que tipo
 * está sendo dispensado sem ninguém fazer nada.
 *
 * É a leitura que impede o sistema de apodrecer — tipo com descarte alto deve
 * ser desligado ou ter o limiar apertado, e sem medir ninguém percebe até o
 * hábito de ignorar ter contaminado o resto.
 */
async function saude() {
  const { saudeDosAlertas, recomendacao } = await import('../src/services/alertHealth.js')
  const dias = Number(process.argv.find((a) => /^\d+$/.test(a)) || 30)
  const tipos = await saudeDosAlertas(dias)

  console.log(`Saúde dos alertas — últimos ${dias} dias\n`)
  if (!tipos.length) {
    console.log('  Nenhum alerta real no período (demonstração e teste não contam).')
    return
  }

  const SINAL: Record<string, string> = {
    ruido: '🔴', irrelevante: '🟠', saudavel: '🟢', sem_amostra: '⚪',
  }
  console.log(
    'Tipo'.padEnd(24) + 'abertos'.padStart(8) + 'resolv.'.padStart(8) +
    'descarte'.padStart(10) + 'não lido'.padStart(10) + 'mediana'.padStart(9) + '  veredicto',
  )
  console.log('─'.repeat(96))
  for (const t of tipos) {
    console.log(
      t.kind.padEnd(24) +
      String(t.abertos).padStart(8) +
      String(t.resolvidos).padStart(8) +
      `${Math.round(t.taxaDescarte * 100)}%`.padStart(10) +
      `${Math.round(t.taxaNaoLido * 100)}%`.padStart(10) +
      (t.horasAteResolver !== null ? `${t.horasAteResolver}h` : '—').padStart(9) +
      `  ${SINAL[t.veredicto]} ${t.veredicto}`,
    )
    console.log(`${''.padEnd(24)}${recomendacao(t)}`)
    if (t.aguardando > 0 && t.destinatarios > 0) {
      console.log(`${''.padEnd(24)}(+${t.aguardando} novo(s) ainda na carência, fora da conta acima)`)
    }
  }
  console.log('\n  descarte = viu e tirou da caixa sem o problema ser resolvido (sinal de ruído)')
  console.log('  não lido = nem abriu (sinal de que o texto ou o destinatário está errado)')
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

/**
 * Mostra qual crítico sairia por WhatsApp/e-mail — sem enviar nada.
 *
 * Existe porque a única forma de conferir um envio externo costuma ser
 * enviando, e aí já foi.
 */
async function escalonar() {
  const { candidatos, textoDoAviso } = await import('../src/services/alertEscalation.js')
  const ativo = await prisma.setting.findUnique({ where: { key: 'alertas.escalonamento_ativo' } }).catch(() => null)
  const ligado = String(ativo?.value ?? '').replace(/"/g, '') === 'true'
  console.log(`Escalonamento: ${ligado ? 'LIGADO' : 'DESLIGADO'}\n`)

  const lista = await candidatos()
  if (!lista.length) {
    console.log('Nenhum crítico em condição de escalar — ou não há crítico aberto, ou')
    console.log('alguém já leu, ou ainda está na carência, ou o teto de 2 avisos foi atingido.')
    return
  }
  const { getNotificationTargets } = await import('../src/services/notify.js')
  const t = await getNotificationTargets()
  console.log(`${lista.length} aviso(s) sairiam para ${t.whatsapps.length} WhatsApp e ${t.emails.length} e-mail:\n`)
  for (const a of lista) {
    console.log('  ' + textoDoAviso(a).split('\n').join('\n  '))
    console.log('  ─────')
  }
  if (!ligado) console.log('\n(Nada foi enviado: o escalonamento está desligado.)')
}
