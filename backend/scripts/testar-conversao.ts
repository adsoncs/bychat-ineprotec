import { relatorioDeConversao } from '../src/services/acaRelatorioConversao.js'
const r = await relatorioDeConversao()
console.log(`inscrições ${r.total} · matriculadas ${r.matriculadas} · conversão ${r.conversaoGeral}%` + (r.amostraSuficiente ? '' : ' (amostra pequena)'))
const tabela = (titulo: string, linhas: typeof r.porCurso) => {
  console.log(`\n${titulo}:`)
  for (const l of linhas.slice(0, 6)) {
    const pct = l.amostraSuficiente ? `${l.conversao}%` : `${l.conversao}% *`
    console.log(`   ${l.rotulo.slice(0, 34).padEnd(36)} ${String(l.inscricoes).padStart(3)} insc · ${String(l.pagas).padStart(3)} pagas · ${String(l.matriculadas).padStart(3)} matr · ${pct}`)
  }
}
tabela('por curso', r.porCurso)
tabela('por forma de ingresso', r.porFormaDeIngresso)
tabela('por origem', r.porOrigem)
console.log(`\n* amostra abaixo de ${r.minimoParaPercentual} inscrições — porcentagem não conclui nada`)
process.exit(0)
