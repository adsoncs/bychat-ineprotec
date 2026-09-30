// src/services/contratoDoPortal.ts
//
// O contrato de verdade na inscrição: o modelo em Word da instituição (ver
// contratoWord.ts), escolhido pelo portal e pelo curso, preenchido com os dados
// da inscrição e assinado na Autentique.
//
//   • Qual modelo: o que cita o CURSO ganha do que cita só o PORTAL; lista vazia
//     vale para qualquer um. Sem modelo em Word que sirva, a etapa segue com o
//     termo de aceite de sempre (portalJornada.contratoDaInscricao).
//   • Os campos: os mesmos dados do cadastro que o portal pede (dadosCadastro
//     .CATALOGO, com as mesmas chaves), mais curso, preços e instituição. A tela
//     do modelo lista todos (CAMPOS_CONTRATO) — é a "legenda" para o jurídico.
//   • A assinatura: um envelope (AcaAssinatura) ligado à inscrição. Quando fecha,
//     o aceite da inscrição é gravado (contratoAceite) e, na efetivação, o
//     envelope passa a pertencer à matrícula — o ERP não manda um 2º contrato.

import { prisma } from '../lib/prisma.js'
import { CATALOGO, valoresAtuais } from './dadosCadastro.js'
import { lerTabelaDePrecos, totalDoCartao, totalDoBoletoParcelado } from './tabelaDePrecos.js'
import { getDocHeader, dataExtenso } from './acaDocRender.js'
import { gerarPdfDoModelo, type VarsContrato } from './contratoWord.js'

// ─── Campos disponíveis ────────────────────────────────────────────────────

export interface CampoContrato { chave: string; rotulo: string; grupo: string; exemplo: string }

const EXEMPLO_CADASTRO: Record<string, string> = {
  nome: 'Maria da Silva Souza', email: 'maria@exemplo.com', whatsapp: '(62) 99999-0000', cpf: '123.456.789-09',
  nascimento: '15/03/2000', sexo: 'Feminino', nomeSocial: '', rg: '1234567', rgOrgaoEmissor: 'SSP/GO',
  racaCor: 'Parda', estadoCivil: 'Solteiro(a)', nacionalidade: 'Brasileira', naturalidade: 'Goiânia/GO',
  nomeMae: 'Ana da Silva', nomePai: 'João Souza', cep: '74000-000', logradouro: 'Rua 10', numero: '100',
  complemento: 'Apto 1', bairro: 'Centro', municipio: 'Goiânia', uf: 'GO', escolaOrigem: 'Colégio Estadual',
  tipoEscolaEM: 'Pública', anoConclusaoEM: '2018', enemInscricao: '', enemAno: '', deficiencia: 'Não', rendaFamiliar: '',
  responsavelNome: 'Ana da Silva', responsavelCpf: '987.654.321-00', responsavelParentesco: 'Mãe',
  responsavelTelefone: '(62) 98888-0000', responsavelEmail: 'ana@exemplo.com',
}

const DERIVADOS: CampoContrato[] = [
  { chave: 'endereco_completo', rotulo: 'Endereço completo do aluno', grupo: 'Endereço', exemplo: 'Rua 10, 100, Apto 1 — Centro, Goiânia/GO, CEP 74000-000' },
  { chave: 'contratante_nome', rotulo: 'Contratante: nome (responsável financeiro, ou o próprio aluno)', grupo: 'Contratante', exemplo: 'Maria da Silva Souza' },
  { chave: 'contratante_cpf', rotulo: 'Contratante: CPF', grupo: 'Contratante', exemplo: '123.456.789-09' },
  { chave: 'aluno_menor', rotulo: '"Sim" quando o aluno é menor de 18 anos', grupo: 'Contratante', exemplo: 'Não' },
  { chave: 'curso', rotulo: 'Curso', grupo: 'Curso', exemplo: 'Técnico em Administração' },
  { chave: 'oferta', rotulo: 'Oferta (turma/complemento do portal)', grupo: 'Curso', exemplo: 'Técnico em Administração — EAD 2026/2' },
  { chave: 'nivel', rotulo: 'Nível de ensino', grupo: 'Curso', exemplo: 'Técnico' },
  { chave: 'modalidade', rotulo: 'Modalidade', grupo: 'Curso', exemplo: 'EAD' },
  { chave: 'turno', rotulo: 'Turno', grupo: 'Curso', exemplo: 'Noturno' },
  { chave: 'carga_horaria', rotulo: 'Carga horária (h)', grupo: 'Curso', exemplo: '1.000' },
  { chave: 'duracao_meses', rotulo: 'Duração (meses)', grupo: 'Curso', exemplo: '18' },
  { chave: 'inicio_curso', rotulo: 'Início do curso', grupo: 'Curso', exemplo: '01/11/2026' },
  { chave: 'termino_curso', rotulo: 'Término do curso', grupo: 'Curso', exemplo: '30/04/2028' },
  { chave: 'polo', rotulo: 'Polo/unidade escolhida', grupo: 'Curso', exemplo: 'Polo Goiânia' },
  { chave: 'valor_total', rotulo: 'Valor total contratado', grupo: 'Pagamento', exemplo: 'R$ 3.000,00' },
  { chave: 'valor_total_extenso', rotulo: 'Valor total por extenso', grupo: 'Pagamento', exemplo: 'três mil reais' },
  { chave: 'forma_pagamento', rotulo: 'Forma de pagamento escolhida', grupo: 'Pagamento', exemplo: 'Boleto em 18 parcelas de R$ 180,00' },
  { chave: 'num_parcelas', rotulo: 'Número de parcelas', grupo: 'Pagamento', exemplo: '18' },
  { chave: 'valor_parcela', rotulo: 'Valor da parcela', grupo: 'Pagamento', exemplo: 'R$ 180,00' },
  { chave: 'valor_matricula', rotulo: 'Valor da matrícula', grupo: 'Pagamento', exemplo: 'R$ 0,00' },
  { chave: 'preco_a_vista', rotulo: 'Tabela: preço à vista (Pix/boleto)', grupo: 'Pagamento', exemplo: 'R$ 2.700,00' },
  { chave: 'preco_cartao', rotulo: 'Tabela: condição no cartão', grupo: 'Pagamento', exemplo: '12x de R$ 250,00 (R$ 3.000,00)' },
  { chave: 'preco_boleto', rotulo: 'Tabela: condição no boleto parcelado', grupo: 'Pagamento', exemplo: '18x de R$ 180,00 (R$ 3.240,00)' },
  { chave: 'instituicao', rotulo: 'Nome da instituição', grupo: 'Instituição', exemplo: 'Instituto Exemplo Ltda' },
  { chave: 'cnpj', rotulo: 'CNPJ da instituição', grupo: 'Instituição', exemplo: '00.000.000/0001-00' },
  { chave: 'data', rotulo: 'Data de hoje por extenso', grupo: 'Documento', exemplo: '30 de setembro de 2026' },
  { chave: 'data_curta', rotulo: 'Data de hoje (dd/mm/aaaa)', grupo: 'Documento', exemplo: '30/09/2026' },
  { chave: 'codigo_inscricao', rotulo: 'Código da inscrição', grupo: 'Documento', exemplo: 'INS-2026-0001' },
  { chave: 'ra', rotulo: 'RA do aluno (vazio antes da matrícula)', grupo: 'Documento', exemplo: '' },
]

/** Nomes antigos dos modelos de texto ({{aluno.nome}}…) — continuam valendo no Word. */
const APELIDOS: Record<string, string> = {
  'aluno.nome': 'nome', 'aluno.cpf': 'cpf', 'aluno.email': 'email', 'aluno.ra': 'ra',
  valor: 'valor_total', parcelas: 'num_parcelas',
}

export const CAMPOS_CONTRATO: CampoContrato[] = [
  ...CATALOGO.map((d) => ({ chave: d.chave, rotulo: d.rotulo, grupo: d.grupo, exemplo: EXEMPLO_CADASTRO[d.chave] ?? '' })),
  ...DERIVADOS,
]
const CHAVES_CONHECIDAS = new Set([...CAMPOS_CONTRATO.map((c) => c.chave), ...Object.keys(APELIDOS)].map((k) => k.toLowerCase()))

/** Campos do modelo que o sistema não conhece (erro de digitação no Word). */
export function camposDesconhecidos(campos: string[]): string[] {
  return campos.filter((c) => !CHAVES_CONHECIDAS.has(c.trim().toLowerCase()))
}

function comApelidos(v: VarsContrato): VarsContrato {
  const out = { ...v }
  for (const [apelido, chave] of Object.entries(APELIDOS)) if (out[apelido] === undefined) out[apelido] = out[chave] ?? ''
  return out
}

export function varsDeExemplo(): VarsContrato {
  return comApelidos(Object.fromEntries(CAMPOS_CONTRATO.map((c) => [c.chave, c.exemplo])))
}

// ─── Formatação ────────────────────────────────────────────────────────────

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '')

function formatarDoc(v: string): string {
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return v
}

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

function ate999(n: number): string {
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100), r = n % 100
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (r) partes.push(r < 20 ? UNIDADES[r] : [DEZENAS[Math.floor(r / 10)], UNIDADES[r % 10]].filter(Boolean).join(' e '))
  return partes.join(' e ')
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero'
  const grupos = [
    { valor: Math.floor(n / 1e6) % 1000, um: 'um milhão', varios: 'milhões' },
    { valor: Math.floor(n / 1e3) % 1000, um: 'mil', varios: 'mil' },
    { valor: n % 1000, um: 'um', varios: '' },
  ]
  const partes: string[] = []
  grupos.forEach((g, i) => {
    if (!g.valor) return
    if (i === 0) partes.push(g.valor === 1 ? g.um : `${ate999(g.valor)} ${g.varios}`)
    else if (i === 1) partes.push(g.valor === 1 ? 'mil' : `${ate999(g.valor)} mil`)
    else partes.push(ate999(g.valor))
  })
  // "mil e cem", "dois mil e trinta": o "e" antes do último grupo quando ele é < 100 ou centena redonda.
  const ultimo = n % 1000
  // "um milhão e quinhentos mil": idem entre milhão e milhares redondos.
  const milhares = Math.floor(n / 1e3) % 1000
  if (n >= 1e6 && !ultimo && milhares && (milhares < 100 || milhares % 100 === 0) && partes.length === 2) return partes.join(' e ')
  if (partes.length > 1 && ultimo && (ultimo < 100 || ultimo % 100 === 0)) {
    const fim = partes.pop()!
    return `${partes.join(' ')} e ${fim}`
  }
  return partes.join(' ')
}

/** R$ 3.240,50 → "três mil, duzentos e quarenta reais e cinquenta centavos" (formato de contrato). */
export function reaisPorExtenso(centavos: number): string {
  const inteiro = Math.floor(Math.abs(centavos) / 100), cent = Math.abs(centavos) % 100
  const partes: string[] = []
  if (inteiro) {
    const redondoMilhao = inteiro % 1e6 === 0
    partes.push(`${inteiroPorExtenso(inteiro)}${redondoMilhao ? ' de' : ''} ${inteiro === 1 ? 'real' : 'reais'}`)
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`)
  return partes.join(' e ') || 'zero reais'
}

function idade(nascimento: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(nascimento) || /^(\d{4})-(\d{2})-(\d{2})/.exec(nascimento)
  if (!m) return null
  const [d, mo, a] = m[0].includes('/') ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]]
  const hoje = new Date()
  let anos = hoje.getFullYear() - a
  if (hoje.getMonth() + 1 < mo || (hoje.getMonth() + 1 === mo && hoje.getDate() < d)) anos--
  return anos
}

const MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão de crédito' }

// ─── Dados de uma inscrição ────────────────────────────────────────────────

export interface DadosDoContrato {
  vars: VarsContrato
  portalId: number
  courseId: number | null
  menor: boolean
  aluno: { nome: string; email: string | null; telefone: string | null; cpf: string | null }
  responsavel: { nome: string; email: string | null; telefone: string | null; cpf: string | null } | null
  plano: { valorTotalCentavos: number; numParcelas: number; valorParcelaCentavos: number }
}

export async function dadosDoContratoDaInscricao(registrationId: number): Promise<DadosDoContrato | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, portalId: true, candidateCode: true, leadId: true, formData: true, paymentPlan: true, paymentStatus: true,
      processRegistration: { select: { offering: { select: {
        id: true, nome: true, complemento: true, turno: true, courseId: true, tabelaPrecos: true,
        valorMensalidade: true, valorMatricula: true, inicioCurso: true, terminoCurso: true,
        course: { select: { nome: true, cargaHoraria: true, duracaoMeses: true } },
        modality: { select: { nome: true } }, level: { select: { nome: true } },
      } } } },
    },
  })
  const of = reg?.processRegistration?.offering
  if (!reg || !of) return null

  const cad = await valoresAtuais(reg, CATALOGO.map((d) => d.chave))
  const v: VarsContrato = {}
  for (const d of CATALOGO) {
    const bruto = cad[d.chave]
    v[d.chave] = bruto == null ? '' : d.tipo === 'cpf' ? formatarDoc(String(bruto)) : String(bruto)
  }

  // Condição do contrato: a paga no checkout (tabela), o plano do ERP, ou a oferta.
  const { contratoDaInscricao } = await import('./portalJornada.js')
  const c = await contratoDaInscricao(registrationId)
  const pp = (reg.paymentStatus === 'paid' ? reg.paymentPlan : null) as Record<string, any> | null
  const tabela = lerTabelaDePrecos(of.tabelaPrecos)
  const plano = {
    valorTotalCentavos: c?.valorTotalCentavos ?? 0,
    numParcelas: c?.numParcelas ?? 0,
    valorParcelaCentavos: c?.valorParcelaCentavos ?? 0,
  }
  let forma = 'Conforme escolhido no pagamento da inscrição'
  if (pp?.meio) {
    const n = Math.max(1, Number(pp.tabela?.parcelas ?? pp.parcelas ?? 1) || 1)
    forma = n > 1 ? `${MEIO[pp.meio] ?? pp.meio} em ${n} parcelas de ${reais(plano.valorParcelaCentavos)}` : `${MEIO[pp.meio] ?? pp.meio} à vista`
  } else if (!tabela && plano.numParcelas > 0) {
    forma = `${plano.numParcelas} parcela(s) de ${reais(plano.valorParcelaCentavos)}`
  }
  const cond = (x: { parcelas: number; valorParcela: number } | null, total: number | null) =>
    x ? `${x.parcelas}x de ${reais(Math.round(x.valorParcela * 100))}${total ? ` (${reais(Math.round(total * 100))})` : ''}` : ''

  const header = await getDocHeader()
  const end = [
    [v.logradouro, v.numero, v.complemento].filter(Boolean).join(', '),
    v.bairro, [v.municipio, v.uf].filter(Boolean).join('/'), v.cep ? `CEP ${v.cep}` : '',
  ].filter(Boolean).join(' — ')
  const anos = idade(v.nascimento)
  const menor = anos != null && anos < 18
  const temResp = !!v.responsavelNome && !/pr[óo]pri/i.test(v.responsavelParentesco)

  Object.assign(v, {
    endereco_completo: end,
    contratante_nome: temResp ? v.responsavelNome : v.nome,
    contratante_cpf: temResp ? v.responsavelCpf : v.cpf,
    aluno_menor: menor ? 'Sim' : 'Não',
    curso: of.course?.nome ?? of.nome,
    oferta: [of.nome, of.complemento].filter(Boolean).join(' — '),
    nivel: of.level?.nome ?? '', modalidade: of.modality?.nome ?? '', turno: of.turno ?? '',
    carga_horaria: of.course?.cargaHoraria ? of.course.cargaHoraria.toLocaleString('pt-BR') : '',
    duracao_meses: of.course?.duracaoMeses ? String(of.course.duracaoMeses) : '',
    inicio_curso: dataBr(of.inicioCurso), termino_curso: dataBr(of.terminoCurso),
    polo: String((reg.formData as any)?.campusNome ?? ''),
    valor_total: plano.valorTotalCentavos ? reais(plano.valorTotalCentavos) : '',
    valor_total_extenso: plano.valorTotalCentavos ? reaisPorExtenso(plano.valorTotalCentavos) : '',
    forma_pagamento: forma,
    num_parcelas: plano.numParcelas ? String(plano.numParcelas) : '',
    valor_parcela: plano.valorParcelaCentavos ? reais(plano.valorParcelaCentavos) : '',
    valor_matricula: reais(Math.round(Number(of.valorMatricula ?? 0) * 100)),
    preco_a_vista: tabela ? reais(Math.round(tabela.aVista * 100)) : '',
    preco_cartao: tabela ? cond(tabela.cartao, tabela.cartao ? totalDoCartao(tabela) : null) : '',
    preco_boleto: tabela ? cond(tabela.boleto, totalDoBoletoParcelado(tabela)) : '',
    instituicao: header.instituicao, cnpj: header.cnpj ? formatarDoc(header.cnpj) : '',
    data: dataExtenso(), data_curta: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    codigo_inscricao: reg.candidateCode, ra: '',
  })

  return {
    vars: comApelidos(v), portalId: reg.portalId, courseId: of.courseId, menor,
    aluno: { nome: v.nome, email: v.email || null, telefone: v.whatsapp || null, cpf: v.cpf || null },
    responsavel: temResp ? { nome: v.responsavelNome, email: v.responsavelEmail || null, telefone: v.responsavelTelefone || null, cpf: v.responsavelCpf || null } : null,
    plano,
  }
}

// ─── Qual modelo vale ──────────────────────────────────────────────────────

const ids = (j: unknown): number[] => (Array.isArray(j) ? j.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [])

/**
 * O modelo em Word para uma inscrição: curso + portal (3) > curso (2) > portal (1).
 * Um modelo que cita portais/cursos só vale para eles; sem nenhum dos dois ele
 * não é usado na inscrição (é modelo do ERP, escolhido pelo tipo de negócio).
 */
export async function modeloDoPortal(portalId: number, courseId: number | null) {
  const modelos = await prisma.acaContratoTemplate.findMany({
    where: { ativo: true, arquivoDocx: { not: null } },
    select: { id: true, nome: true, portalIds: true, cursoIds: true, ordem: true, config: true, updatedAt: true },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  })
  let melhor: (typeof modelos)[number] | null = null
  let nota = 0
  for (const m of modelos) {
    const ps = ids(m.portalIds), cs = ids(m.cursoIds)
    if (!ps.length && !cs.length) continue
    if (ps.length && !ps.includes(portalId)) continue
    if (cs.length && (!courseId || !cs.includes(courseId))) continue
    const n = (cs.length ? 2 : 0) + (ps.length ? 1 : 0)
    if (n > nota) { melhor = m; nota = n }
  }
  return melhor
}

/** PDF do contrato de uma inscrição, pelo modelo que vale para ela. */
export async function pdfDoContratoDaInscricao(registrationId: number) {
  const dados = await dadosDoContratoDaInscricao(registrationId)
  if (!dados) return null
  const modelo = await modeloDoPortal(dados.portalId, dados.courseId)
  if (!modelo) return null
  const t = await prisma.acaContratoTemplate.findUnique({ where: { id: modelo.id }, select: { arquivoDocx: true } })
  const { pdf, faltando } = await gerarPdfDoModelo(Buffer.from(t!.arquivoDocx!, 'base64'), dados.vars)
  return { pdf, faltando, modelo, dados }
}

// ─── Dados de um aluno (contrato disparado pelo ERP) ───────────────────────

/**
 * Os mesmos campos, para o modelo em Word usado num envelope do ERP (gatilho ou
 * secretaria). Matrícula que veio do portal usa os dados da inscrição; as demais,
 * o cadastro do aluno.
 */
export async function varsDoAluno(ctx: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null }): Promise<VarsContrato> {
  let matriculaId = ctx.matriculaId ?? null
  if (!matriculaId && ctx.contratoId) {
    matriculaId = (await prisma.acaContrato.findUnique({ where: { id: ctx.contratoId }, select: { matriculaId: true } }))?.matriculaId ?? null
  }
  const mat = matriculaId
    ? await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { enrollmentRegistrationId: true, aluno: { select: { ra: true } } } })
    : null
  if (mat?.enrollmentRegistrationId) {
    const d = await dadosDoContratoDaInscricao(mat.enrollmentRegistrationId)
    if (d) return { ...d.vars, ra: mat.aluno?.ra ?? '', 'aluno.ra': mat.aluno?.ra ?? '' }
  }
  const v: VarsContrato = {}
  const aluno = ctx.alunoId ? await prisma.aluno.findUnique({ where: { id: ctx.alunoId }, select: { leadId: true, ra: true } }) : null
  if (aluno) {
    const cad = await valoresAtuais({ leadId: aluno.leadId, formData: {} }, CATALOGO.map((d) => d.chave))
    for (const d of CATALOGO) {
      const bruto = cad[d.chave]
      v[d.chave] = bruto == null ? '' : d.tipo === 'cpf' ? formatarDoc(String(bruto)) : String(bruto)
    }
    v.ra = aluno.ra ?? ''
    const temResp = !!v.responsavelNome && !/pr[óo]pri/i.test(v.responsavelParentesco)
    v.contratante_nome = temResp ? v.responsavelNome : v.nome
    v.contratante_cpf = temResp ? v.responsavelCpf : v.cpf
    const anos = idade(v.nascimento)
    v.aluno_menor = anos != null && anos < 18 ? 'Sim' : 'Não'
    v.endereco_completo = [[v.logradouro, v.numero, v.complemento].filter(Boolean).join(', '), v.bairro,
      [v.municipio, v.uf].filter(Boolean).join('/'), v.cep ? `CEP ${v.cep}` : ''].filter(Boolean).join(' — ')
  }
  const contrato = ctx.contratoId
    ? await prisma.acaContrato.findUnique({ where: { id: ctx.contratoId }, select: { valorTotalCentavos: true, _count: { select: { parcelas: true } } } })
    : null
  if (contrato) {
    v.valor_total = reais(contrato.valorTotalCentavos)
    v.valor_total_extenso = reaisPorExtenso(contrato.valorTotalCentavos)
    v.num_parcelas = String(contrato._count.parcelas)
  }
  const header = await getDocHeader()
  Object.assign(v, {
    instituicao: header.instituicao, cnpj: header.cnpj ? formatarDoc(header.cnpj) : '',
    data: dataExtenso(), data_curta: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  })
  return comApelidos(v)
}

// ─── Assinatura na inscrição ───────────────────────────────────────────────

const ABERTOS = ['ENVIADO', 'PARCIAL', 'ASSINADO'] as const

/** Envelope da inscrição que ainda vale (em assinatura ou assinado). */
export function envelopeDaInscricao(registrationId: number) {
  return prisma.acaAssinatura.findFirst({
    where: { registrationId, status: { in: [...ABERTOS] } },
    orderBy: { id: 'desc' },
    include: { signatarios: { orderBy: { ordem: 'asc' } } },
  })
}

export interface EstadoDaAssinatura {
  envelopeId: number
  status: string
  provedor: string
  assinadoEm: string | null
  signatarios: Array<{ id: number; papel: string; nome: string; status: string; link: string | null; porEmail: boolean }>
}

function estado(env: NonNullable<Awaited<ReturnType<typeof envelopeDaInscricao>>>): EstadoDaAssinatura {
  return {
    envelopeId: env.id, status: env.status, provedor: env.provider,
    assinadoEm: env.finalizadoEm?.toISOString() ?? null,
    signatarios: env.signatarios.map((s) => ({
      id: s.id, papel: s.papel, nome: s.nome, status: s.status,
      // Link simulado não abre nada: não vai para a tela.
      link: s.linkAssinatura && !s.linkAssinatura.includes('assinatura.simulada') ? s.linkAssinatura : null,
      porEmail: s.deliveryMethod === 'EMAIL',
    })),
  }
}

export async function estadoDaAssinaturaDaInscricao(registrationId: number, atualizar = false): Promise<EstadoDaAssinatura | null> {
  let env = await envelopeDaInscricao(registrationId)
  if (env && atualizar && env.provider === 'AUTENTIQUE' && env.status !== 'ASSINADO') {
    const { sincronizar } = await import('./acaAssinatura.js')
    await sincronizar(env.id).catch(() => {})
    env = await envelopeDaInscricao(registrationId)
  }
  return env ? estado(env) : null
}

/** A Autentique está configurada de verdade (token + modo)? Sem ela, o aceite é no portal. */
export async function assinaturaEletronicaAtiva(): Promise<boolean> {
  const { getConfig } = await import('./autentique.js')
  const cfg = await getConfig()
  return cfg.modo === 'AUTENTIQUE' && !!cfg.token
}

type Resultado = { ok: true; assinatura: EstadoDaAssinatura } | { ok: false; erro: string }

/**
 * Gera o contrato da inscrição e o manda para assinatura (Autentique, por link:
 * a pessoa assina na hora, pelo portal). Chamar de novo devolve o mesmo envelope
 * — não gasta um documento a cada clique. O responsável financeiro (e o legal,
 * no caso de menor) assina junto: por e-mail quando tem, senão pelo link que o
 * portal mostra para encaminhar.
 */
export async function iniciarAssinaturaDaInscricao(registrationId: number): Promise<Resultado> {
  // Sem Autentique, o "envelope" seria simulado e o link não abriria nada: o
  // caminho é o aceite no portal (aceitarContratoNoPortal).
  if (!(await assinaturaEletronicaAtiva())) return { ok: false, erro: 'A assinatura eletrônica não está configurada — assine pelo aceite nesta página.' }
  const { redis } = await import('../lib/redis.js')
  const trava = `contrato:insc:${registrationId}`
  if (!(await redis.set(trava, '1', 'EX', 90, 'NX'))) return { ok: false, erro: 'O contrato já está sendo preparado — aguarde alguns segundos.' }
  try {
    const atual = await envelopeDaInscricao(registrationId)
    if (atual) return { ok: true, assinatura: (await estadoDaAssinaturaDaInscricao(registrationId, true))! }

    const r = await pdfDoContratoDaInscricao(registrationId)
    if (!r) return { ok: false, erro: 'Não há contrato configurado para este curso.' }
    const { dados, modelo, pdf } = r
    if (dados.menor && !dados.responsavel) {
      return { ok: false, erro: 'Aluno menor de idade: informe os dados do responsável financeiro para gerar o contrato.' }
    }
    const signatarios = [
      { nome: dados.aluno.nome, email: dados.aluno.email, telefone: dados.aluno.telefone, cpf: dados.aluno.cpf, papel: 'ALUNO', deliveryMethod: 'LINK' },
      ...(dados.responsavel ? [{
        nome: dados.responsavel.nome, email: dados.responsavel.email, telefone: dados.responsavel.telefone, cpf: dados.responsavel.cpf,
        papel: 'RESPONSAVEL', deliveryMethod: dados.responsavel.email ? 'EMAIL' : 'LINK',
      }] : []),
    ]
    const cfg = (modelo.config as any) || {}
    const svc = await import('./acaAssinatura.js')
    const env = await svc.criar({
      titulo: `${modelo.nome} — ${dados.aluno.nome}`, origem: 'UPLOAD', templateId: modelo.id,
      arquivoBase64: pdf.toString('base64'), arquivoNome: `${modelo.nome}.pdf`, registrationId,
      deadlineEm: cfg.deadlineDias ? new Date(Date.now() + cfg.deadlineDias * 864e5).toISOString() : null,
      reminder: cfg.reminder || null, refusable: cfg.refusable !== false, mensagem: cfg.mensagem || null,
      signatarios,
    })
    try {
      await svc.enviar(env.id)
    } catch (e: any) {
      // Não deixa rascunho órfão: a próxima tentativa começa limpa.
      await prisma.acaAssinatura.update({ where: { id: env.id }, data: { status: 'CANCELADO' } }).catch(() => {})
      return { ok: false, erro: `Não foi possível preparar a assinatura: ${e?.message || e}` }
    }
    return { ok: true, assinatura: (await estadoDaAssinaturaDaInscricao(registrationId))! }
  } finally {
    await redis.del(trava).catch(() => {})
  }
}

/**
 * Sem Autentique configurada: o aceite é no próprio portal (nome digitado), mas
 * sobre o contrato em Word de verdade — o PDF fica guardado no envelope, que
 * nasce assinado e segue o mesmo caminho (aceite da inscrição, GED, matrícula).
 */
export async function aceitarContratoNoPortal(registrationId: number, nome: string): Promise<Resultado> {
  const atual = await envelopeDaInscricao(registrationId)
  if (atual?.status === 'ASSINADO') return { ok: true, assinatura: estado(atual) }
  const r = await pdfDoContratoDaInscricao(registrationId)
  if (!r) return { ok: false, erro: 'Não há contrato configurado para este curso.' }
  const svc = await import('./acaAssinatura.js')
  const env = await svc.criar({
    titulo: `${r.modelo.nome} — ${r.dados.aluno.nome}`, origem: 'UPLOAD', templateId: r.modelo.id,
    arquivoBase64: r.pdf.toString('base64'), arquivoNome: `${r.modelo.nome}.pdf`, registrationId,
    signatarios: [{ nome: nome.slice(0, 191), email: r.dados.aluno.email, cpf: r.dados.aluno.cpf, papel: 'ALUNO', deliveryMethod: 'LINK' }],
  })
  await prisma.acaAssinatura.update({ where: { id: env.id }, data: { provider: 'PORTAL', status: 'ENVIADO', enviadoEm: new Date() } })
  for (const s of env.signatarios) await svc.simularAssinatura(env.id, s.id)
  const fim = await envelopeDaInscricao(registrationId)
  return { ok: true, assinatura: estado(fim!) }
}

/**
 * Envelope da inscrição fechado → aceite gravado na inscrição (a etapa
 * "Contrato" fica feita e o ERP herda o aceite, como no termo de sempre).
 */
export async function aceiteDaInscricaoPeloEnvelope(envelopeId: number): Promise<void> {
  const env = await prisma.acaAssinatura.findUnique({ where: { id: envelopeId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } })
  if (!env?.registrationId || env.status !== 'ASSINADO') return
  const dados = await dadosDoContratoDaInscricao(env.registrationId).catch(() => null)
  const aluno = env.signatarios.find((s) => s.papel === 'ALUNO') ?? env.signatarios[0]
  const aceite = {
    termo: `${env.titulo} — assinado eletronicamente${env.provider === 'AUTENTIQUE' ? ` na Autentique (documento ${env.documentoExternoId})` : ' no portal'}.`,
    nome: aluno?.nome ?? '', ip: '', userAgent: '', em: (env.finalizadoEm ?? new Date()).toISOString(),
    via: env.provider, envelopeId: env.id,
    plano: dados?.plano ?? null,
  }
  const n = await prisma.$executeRaw`UPDATE bychat_enrollment_registrations SET contratoAceite = ${JSON.stringify(aceite)} WHERE id = ${env.registrationId} AND contratoAceite IS NULL`
  if (Number(n) > 0) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: env.registrationId }, select: { leadId: true, candidateCode: true } })
    if (reg?.leadId) {
      const { logEvent } = await import('./leadHistory.js')
      logEvent({
        leadId: reg.leadId, type: 'contract_signed', category: 'lifecycle', title: 'Contrato assinado',
        source: 'system', actorType: 'system',
        description: `${env.titulo} — inscrição ${reg.candidateCode}.`,
        metadata: { registrationId: env.registrationId, envelopeId: env.id, provedor: env.provider },
      })
    }
  }
}

/**
 * Matrícula criada a partir de uma inscrição que já tem contrato (assinado ou
 * em assinatura): o envelope passa a ser da matrícula — vai para o GED e efetiva
 * a matrícula quando assinado. Devolve o id quando adotou (o gatilho não cria outro).
 */
export async function adotarEnvelopeDaInscricao(ctx: { alunoId?: number | null; matriculaId?: number | null; contratoId?: number | null }): Promise<number | null> {
  let matriculaId = ctx.matriculaId ?? null
  if (!matriculaId && ctx.contratoId) {
    matriculaId = (await prisma.acaContrato.findUnique({ where: { id: ctx.contratoId }, select: { matriculaId: true } }))?.matriculaId ?? null
  }
  if (!matriculaId) return null
  const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { id: true, alunoId: true, enrollmentRegistrationId: true } })
  if (!mat?.enrollmentRegistrationId) return null
  const env = await envelopeDaInscricao(mat.enrollmentRegistrationId)
  if (!env) return null
  await prisma.acaAssinatura.update({
    where: { id: env.id },
    data: {
      alunoId: env.alunoId ?? mat.alunoId, matriculaId: env.matriculaId ?? mat.id,
      ...(ctx.contratoId && !env.contratoId ? { contratoId: ctx.contratoId } : {}),
    },
  })
  if (env.status === 'ASSINADO') {
    const { efetivarPorContratoAssinado, arquivarContratoNoGed } = await import('./acaEfetivacao.js')
    await efetivarPorContratoAssinado(env.id)
    await arquivarContratoNoGed(env.id)
  }
  return env.id
}
