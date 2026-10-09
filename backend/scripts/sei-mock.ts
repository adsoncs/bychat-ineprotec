// scripts/sei-mock.ts — SEI simulado para testar a integração (só desenvolvimento).
//
// Responde os serviços da "Matrícula Externa" (doc v4.0) com dados fixos e
// guarda o que recebeu em memória. Exige `Authorization: Bearer teste-sei`
// para provar que o header de autenticação sai.
//
//   npx tsx scripts/sei-mock.ts [porta]   → GET /_estado mostra o que chegou
import http from 'node:http'

const porta = Number(process.argv[2] || 3999)
const RS = '/webservice/matriculaOnlineExternaRS'
const estado = { pessoas: [] as any[], matriculas: [] as any[], uploads: [] as any[], documentacoes: [] as any[] }
let seq = 1000

const opcoes = () => ({
  unidadeEnsinos: [{ codigo: '4', nome: 'Faculdade Sede', possuiUnidadesEnsinoComoPolo: true, unidadeEnsinosPolo: [{ codigo: '10', nome: 'Polo Centro' }] }],
  turnos: [{ codigo: '7', nome: 'NOTURNO' }, { codigo: '8', nome: 'EAD' }],
  turmas: [{ codigo: '1377', nome: 'ADM-2026-1' }],
  processoMatriculas: [{ codigo: '59', nome: 'Vestibular 2026/1' }],
  condicaoPagamentos: [{ codigo: '1325', nome: 'GRADUAÇÃO 12x', parcelas: '12', valorMatricula: '99.0', valorMensalidade: '450.0' }],
})

function dadosMatricula(curso: string, banner: string, pessoa: string, extra: any = {}) {
  const o = opcoes()
  return {
    ano: '2026', codigoBanner: banner, codigoCondicaoPagamento: '0', codigoMatriculaPeriodo: '0', codigoProcessoMatricula: '0',
    codigoTurma: '0', codigoTurno: '0', codigoUnidadeEnsino: '0',
    condicaoPagamento: { codigo: '0' }, condicaoPagamentos: o.condicaoPagamentos,
    curso: { codigo: curso, nome: 'Administração', gradeDisciplina: { codigo: '204' } },
    linkDownloadComprovante: '', linkDownloadContrato: '', motivoRecusa: '', matricula: '', matriculaRealizadaComSucesso: 'false',
    periodoLetivo: { codigo: '1', nome: '1º período' },
    pessoa: { codigo: pessoa },
    processoMatricula: { codigo: '0' }, processoMatriculas: o.processoMatriculas,
    semestre: '1', turma: { codigo: '0' }, turmas: o.turmas, turno: { codigo: '0' }, turnos: o.turnos,
    unidadeEnsino: { codigo: '0' }, unidadeEnsinos: o.unidadeEnsinos, cupomDesconto: '',
    ...extra,
  }
}

const documentacao = (matricula: string) => [
  { codigo: '501', matricula, situacao: 'Pendente', tipoDeDocumentoVO: { codigo: '5', nome: 'RG', contrato: 'false' } },
  { codigo: '502', matricula, situacao: 'Pendente', tipoDeDocumentoVO: { codigo: '6', nome: 'CPF', contrato: 'false' } },
  { codigo: '503', matricula, situacao: 'Pendente', tipoDeDocumentoVO: { codigo: '9', nome: 'HISTÓRICO ESCOLAR', contrato: 'false' } },
  { codigo: '504', matricula, situacao: 'Pendente', tipoDeDocumentoVO: { codigo: '20', nome: 'CONTRATO ASSINADO', contrato: 'true' } },
]

function corpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok) => { const p: Buffer[] = []; req.on('data', (c) => p.push(c)); req.on('end', () => ok(Buffer.concat(p))) })
}

http.createServer(async (req, res) => {
  const url = req.url || ''
  const json = (s: number, d: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)) }
  if (url === '/_estado') return json(200, estado)
  if (req.headers.authorization !== 'Bearer teste-sei') return json(401, { campo: '', codigo: 'UNAUTHORIZED', mensagem: 'Token inválido' })
  const raw = await corpo(req)
  const b = () => { try { return JSON.parse(raw.toString('utf8') || '{}') } catch { return {} } }
  const p = url.split('?')[0].split('/').map(decodeURIComponent)

  if (url === `${RS}/banners`) return json(200, { banner: [{ codigoBanner: '14', curso: { codigo: '47', gradeDisciplina: { codigo: '204' } }, descricao: 'Administração' }] })
  if (url.startsWith(`${RS}/consultarCurso/`)) return json(200, { codigo: p.at(-1), nome: 'Administração', gradeDisciplina: { codigo: 204, disciplinas: [] } })
  if (url === `${RS}/cadastrarPreInscricao`) {
    const pr = b()
    if (!pr.nome || !pr.email) return json(400, { campo: 'nome', codigo: 'BAD_REQUEST', mensagem: 'Nome e e-mail obrigatórios' })
    const codigo = String(++seq)
    estado.pessoas.push({ codigo, ...pr })
    return json(200, { codigo, codigoCurso: pr.codigoCurso, nome: pr.nome, email: pr.email, erro: '', liberar: 'false' })
  }
  if (url.startsWith(`${RS}/V2/consultarDadosParaRealizarMatriculaOnlineExterna/`)) return json(200, dadosMatricula(p.at(-3)!, p.at(-2)!, p.at(-1)!))
  if (url.startsWith(`${RS}/atualizarDadosQuandoUnidadeEnsinoAlterado/`)) return json(200, dadosMatricula(p.at(-4)!, p.at(-3)!, p.at(-2)!, { unidadeEnsino: { codigo: p.at(-1) }, codigoUnidadeEnsino: p.at(-1) }))
  if (url.startsWith(`${RS}/atualizarDadosQuandoTurnoAlterado/`)) return json(200, dadosMatricula(p.at(-5)!, p.at(-2)!, p.at(-1)!, { turno: { codigo: p.at(-4) }, codigoTurno: p.at(-4), unidadeEnsino: { codigo: p.at(-6) } }))
  if (url.startsWith(`${RS}/V2/atualizarDadosQuandoTurmaAlterado/`)) return json(200, dadosMatricula(p.at(-7)!, p.at(-4)!, p.at(-3)!, { turma: { codigo: p.at(-2) }, codigoTurma: p.at(-2), turno: { codigo: p.at(-6) }, unidadeEnsino: { codigo: p.at(-8) } }))
  if (url.startsWith(`${RS}/realizarMontagemPlanoFinanceiroAluno/`)) {
    return json(200, [
      { nrParcelasPeriodo: 'Matrícula', vencimentoPrimeiraParcela: '10/01/26', valorMensalidadeCheio: '99.0', totalMensalidadeCheio: '99.0', listaDescricaoDescontos: [] },
      { nrParcelasPeriodo: 'Parcelas 1 à 12', vencimentoPrimeiraParcela: '10/02/26', valorMensalidadeCheio: '450.0', totalMensalidadeCheio: '5400.0', listaDescricaoDescontos: [] },
    ])
  }
  if (url === `${RS}/matricularAluno`) {
    const m = b()
    for (const k of ['codigoBanner', 'codigoCondicaoPagamento', 'codigoProcessoMatricula', 'codigoTurma', 'codigoTurno', 'codigoUnidadeEnsino']) {
      if (!m[k] || m[k] === '0') return json(401, { campo: k, codigo: 'BAD_REQUEST', mensagem: `${k} obrigatório` })
    }
    if (!m.pessoa?.cpf) return json(401, { campo: 'cpf', codigo: 'BAD_REQUEST', mensagem: 'CPF obrigatório' })
    const numero = m.matricula || `2026${++seq}`
    estado.matriculas.push({ numero, recebido: m })
    return json(200, { ...m, codigoMatriculaPeriodo: String(++seq), matricula: numero, matriculaRealizadaComSucesso: 'true' })
  }
  if (url.startsWith(`${RS}/consultarEntregaDocumentos/`)) return json(200, documentacao(p.at(-1)!))
  if (url === `${RS}/realizarUploadArquivoDocumentoMatricula`) {
    const tipo = String(req.headers['content-type'] || '')
    const objeto = /name="objeto"\r\n\r\n([^\r]*)/.exec(raw.toString('latin1'))?.[1]
    const nome = /filename="([^"]*)"/.exec(raw.toString('latin1'))?.[1]
    if (!tipo.startsWith('multipart/form-data') || !objeto || !nome) return json(400, { mensagem: 'Envie multipart com file e objeto' })
    estado.uploads.push({ objeto, nome, bytes: raw.length })
    return json(200, { codigo: objeto, situacao: 'Pendente', arquivoVO: { codigo: String(++seq), nome }, tipoDeDocumentoVO: documentacao('x').find((d) => d.codigo === objeto)?.tipoDeDocumentoVO })
  }
  if (url === `${RS}/gravarDocumentacaoMatricula`) {
    const d = b()
    estado.documentacoes.push({ codigo: d.codigo, arquivo: d.arquivoVO?.nome })
    return json(200, { ...d, situacao: 'Entregue', isEntregue: 'true' })
  }
  return json(404, { mensagem: `rota não simulada: ${req.method} ${url}` })
}).listen(porta, '127.0.0.1', () => console.log(`[sei-mock] ouvindo em http://127.0.0.1:${porta}`))
