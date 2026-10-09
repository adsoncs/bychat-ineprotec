// src/services/seiIntegracao.ts
//
// Envio de uma inscrição concluída no portal para o SEI (ERP acadêmico).
//
// O webservice do SEI não recebe "um aluno pronto": ele expõe o roteiro da
// matrícula on-line dele, e a integração conduz esse roteiro em nome do aluno:
//
//   pessoa      NE005 cadastrarPreInscricao        → codigoPessoa
//   matrícula   NE009 iniciar → NE010/011/012 (unidade, turno, turma)
//               NE013 simula o plano da condição de pagamento escolhida
//               NE014 matricularAluno              → matricula + codigoMatriculaPeriodo
//   documentos  NE021 lista o que o SEI exige → NE022 upload → NE023 grava
//               (inclui o contrato assinado, como documento)
//
// Cada passo grava o que o SEI devolveu em SeiEnvio antes de seguir: uma falha
// no meio retoma do passo em que parou, e reenviar nunca cria outra pessoa nem
// outra matrícula. Os códigos do SEI (curso, banner, unidade, polo, turno,
// turma, processo, condição de pagamento, tipo de documento) vêm do de-para
// em SeiMapeamento — nada de código de cliente no código.

import { readFile } from 'fs/promises'
import { basename } from 'path'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import * as sei from '../lib/seiClient.js'
import { valoresAtuais, CATALOGO } from './dadosCadastro.js'
import { caminhoLocalDeUploads } from './whatsappMediaFormat.js'

// ── De-para ─────────────────────────────────────────────────────────────────

export interface MapaOferta {
  codigoCurso?: string
  codigoBanner?: string
  codigoUnidadeEnsino?: string
  codigoTurno?: string
  codigoGradeCurricular?: string
  codigoTurma?: string
  numeroPeriodoLetivo?: string
  codigoProcessoMatricula?: string
  ano?: string
  semestre?: string
  /** Condição de pagamento padrão da oferta. */
  codigoCondicaoPagamento?: string
  /** Condição por nº de parcelas escolhido no portal: { "12": "1325" }. */
  condicoesPorParcelas?: Record<string, string>
  /** Polo do SEI por polo (Campus) do portal: { "<campusId>": "<codigoUnidadeEnsinoPolo>" }. */
  polos?: Record<string, string>
  cupomDesconto?: string
}

export interface MapaDocumento {
  codigoTipoDocumento?: string
  nome?: string
}

/** localId 0 do tipo 'contrato' guarda o tipo de documento do SEI que recebe o contrato. */
export const CONTRATO_LOCAL_ID = 0

const limpo = (v: unknown) => (v == null ? '' : String(v).trim())

export async function mapaDaOferta(offeringId: number): Promise<MapaOferta | null> {
  const m = await prisma.seiMapeamento.findUnique({ where: { tipo_localId: { tipo: 'oferta', localId: offeringId } } })
  return (m?.dados as MapaOferta) ?? null
}

async function mapasDeDocumento(): Promise<Map<number, MapaDocumento>> {
  const rows = await prisma.seiMapeamento.findMany({ where: { tipo: 'documento' } })
  return new Map(rows.map((r) => [r.localId, r.dados as MapaDocumento]))
}

async function tipoDoContrato(): Promise<string> {
  const m = await prisma.seiMapeamento.findUnique({ where: { tipo_localId: { tipo: 'contrato', localId: CONTRATO_LOCAL_ID } } })
  return limpo((m?.dados as MapaDocumento | undefined)?.codigoTipoDocumento)
}

// ── Erros ───────────────────────────────────────────────────────────────────

/** Falta configuração/dado do nosso lado: tentar de novo sozinho não resolve. */
export class SeiPendencia extends Error {}

// ── Dados da inscrição ──────────────────────────────────────────────────────

const so = (v: unknown) => limpo(v).replace(/\D/g, '')

async function carregarInscricao(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, status: true, formData: true, leadId: true,
      paymentPlan: true, paymentAmount: true, paymentPaidAt: true, paymentMethod: true, paymentStatus: true,
      processRegistration: { select: { offeringId: true } },
      documents: {
        select: { id: true, typeId: true, typeCode: true, label: true, fileUrl: true, fileName: true, mimeType: true, status: true, uploadedAt: true, type: { select: { name: true } } },
        orderBy: { uploadedAt: 'desc' },
      },
    },
  })
  if (!reg) throw new SeiPendencia('Inscrição não encontrada.')
  return reg
}

/**
 * Pessoa no formato do SEI (NE005/NE014). Só os campos que a documentação
 * mostra; os demais (nascimento, sexo…) só com `sei.campos_extras` ligado,
 * porque os nomes ainda não foram confirmados pelo fornecedor.
 */
export async function montarPessoa(reg: { leadId: number | null; formData: unknown }, camposExtras: boolean) {
  const v = await valoresAtuais(reg, CATALOGO.map((c) => c.chave))
  const tel = so(v.whatsapp)
  const filiacao: any[] = []
  const parentesco = limpo(v.responsavelParentesco)
  const respNome = limpo(v.responsavelNome)
  const respProprio = !respNome || parentesco.startsWith('O(a) próprio')
  // Filiação no formato do NE005: tipo MA/PA/RL/OT; os dados da pessoa vão em `pais`.
  const entrada = (tipo: string, nome: string) => ({
    tipo, descricaoTipoOutro: '', responsavelFinanceiro: false, responsavelLegal: false,
    responsavelPedagogico: false, assinaContratoMatricula: false, pais: { nome } as Record<string, unknown>,
  })
  if (limpo(v.nomeMae)) filiacao.push(entrada('MA', limpo(v.nomeMae)))
  if (limpo(v.nomePai)) filiacao.push(entrada('PA', limpo(v.nomePai)))
  if (!respProprio) {
    const dadosResp = { cpf: so(v.responsavelCpf), email: limpo(v.responsavelEmail), celular: so(v.responsavelTelefone) }
    const mesmo = parentesco === 'Mãe' ? filiacao.find((f) => f.tipo === 'MA') : parentesco === 'Pai' ? filiacao.find((f) => f.tipo === 'PA') : null
    if (mesmo) {
      mesmo.responsavelFinanceiro = true
      mesmo.pais = { ...mesmo.pais, ...dadosResp }
    } else {
      const f = entrada('OT', respNome)
      f.descricaoTipoOutro = parentesco || 'Responsável financeiro'
      f.responsavelFinanceiro = true
      f.pais = { ...f.pais, ...dadosResp }
      filiacao.push(f)
    }
  }
  const pessoa: Record<string, unknown> = {
    nome: limpo(v.nome),
    email: limpo(v.email),
    cpf: so(v.cpf),
    rg: limpo(v.rg),
    orgaoEmissor: limpo(v.rgOrgaoEmissor),
    celular: tel,
    telefoneResidencial: '',
    cep: so(v.cep),
    endereco: limpo(v.logradouro),
    numero: limpo(v.numero),
    complemento: limpo(v.complemento),
    setor: limpo(v.bairro),
    resideExterior: false,
    filiacao,
  }
  if (camposExtras) {
    Object.assign(pessoa, {
      dataNascimento: limpo(v.nascimento),
      sexo: limpo(v.sexo),
      estadoCivil: limpo(v.estadoCivil),
      nacionalidade: limpo(v.nacionalidade),
      naturalidade: limpo(v.naturalidade),
      nomeSocial: limpo(v.nomeSocial),
      corRaca: limpo(v.racaCor),
      deficiencia: limpo(v.deficiencia),
      cidade: limpo(v.municipio),
      estado: limpo(v.uf),
    })
  }
  return { pessoa, valores: v }
}

function condicaoEscolhida(mapa: MapaOferta, paymentPlan: any): string {
  const parcelas = limpo(paymentPlan?.tabela?.parcelas ?? paymentPlan?.parcelas)
  return limpo(mapa.condicoesPorParcelas?.[parcelas]) || limpo(mapa.codigoCondicaoPagamento)
}

async function arquivoLocalOuRemoto(url: string): Promise<Buffer> {
  const local = caminhoLocalDeUploads(url)
  if (local) return readFile(local)
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`não deu para baixar o arquivo (HTTP ${r.status})`)
  return Buffer.from(await r.arrayBuffer())
}

/** PDF do contrato assinado da inscrição: envelope da assinatura ou GED do aluno. */
async function contratoAssinado(registrationId: number, matriculaId: number | null) {
  const env = await prisma.acaAssinatura.findFirst({
    where: {
      status: 'ASSINADO',
      OR: [{ registrationId }, ...(matriculaId ? [{ matriculaId }] : [])],
    },
    orderBy: { finalizadoEm: 'desc' },
    select: { id: true, alunoId: true, arquivoAssinadoUrl: true, titulo: true },
  })
  if (env?.arquivoAssinadoUrl) return { url: env.arquivoAssinadoUrl, nome: `contrato-${env.id}.pdf` }
  if (env?.alunoId) {
    const ged = await prisma.acaGedArquivo.findFirst({
      where: { alunoId: env.alunoId, tipo: 'Contrato', eliminadoEm: null },
      orderBy: { createdAt: 'desc' },
      select: { url: true, nome: true },
    })
    if (ged?.url) return { url: ged.url, nome: ged.nome || 'contrato.pdf' }
  }
  return null
}

async function matriculaDaInscricao(registrationId: number): Promise<number | null> {
  const m = await prisma.acaMatricula.findFirst({ where: { enrollmentRegistrationId: registrationId }, select: { id: true }, orderBy: { id: 'desc' } })
  return m?.id ?? null
}

/** Documentos aprovados, um por tipo (o mais recente). */
function aprovadosPorTipo(docs: Awaited<ReturnType<typeof carregarInscricao>>['documents']) {
  const porTipo = new Map<number, (typeof docs)[number]>()
  for (const d of docs) {
    if (d.status !== 'approved' || !d.typeId) continue
    if (!porTipo.has(d.typeId)) porTipo.set(d.typeId, d)
  }
  return porTipo
}

// ── Prévia: o que será enviado e o que falta ─────────────────────────────────

export interface PreviaSei {
  registrationId: number
  candidateCode: string
  offeringId: number | null
  oferta: { id: number; nome: string } | null
  mapaOferta: MapaOferta | null
  condicaoPagamento: string
  pessoa: Record<string, unknown>
  documentos: Array<{ id: number; tipo: string; nome: string; codigoTipoDocumentoSei: string | null }>
  contrato: { url: string; nome: string } | null
  pendencias: string[]
  avisos: string[]
}

export async function previa(registrationId: number): Promise<PreviaSei> {
  const cfg = await sei.getSeiConfig()
  const reg = await carregarInscricao(registrationId)
  const offeringId = reg.processRegistration?.offeringId ?? null
  const oferta = offeringId ? await prisma.courseOffering.findUnique({ where: { id: offeringId }, select: { id: true, nome: true } }) : null
  const mapa = offeringId ? await mapaDaOferta(offeringId) : null
  const { pessoa } = await montarPessoa(reg, cfg.camposExtras)
  const pend: string[] = []
  const avisos: string[] = []

  if (!cfg.baseUrl) pend.push('URL do SEI não configurada.')
  if (!offeringId) pend.push('Inscrição sem curso/oferta definida.')
  else if (!mapa) pend.push(`Oferta "${oferta?.nome ?? offeringId}" sem de-para com o SEI.`)
  else {
    for (const [k, rot] of [['codigoCurso', 'curso'], ['codigoBanner', 'banner'], ['codigoUnidadeEnsino', 'unidade de ensino'], ['codigoTurno', 'turno'], ['codigoTurma', 'turma'], ['codigoProcessoMatricula', 'processo de matrícula']] as const) {
      if (!limpo(mapa[k])) pend.push(`De-para da oferta sem ${rot}.`)
    }
    if (!condicaoEscolhida(mapa, reg.paymentPlan)) pend.push('De-para da oferta sem condição de pagamento.')
    const campusId = limpo((reg.formData as any)?.campusId)
    if (campusId && mapa.polos && Object.keys(mapa.polos).length && !limpo(mapa.polos[campusId])) {
      pend.push(`Polo escolhido (#${campusId}) sem de-para com o polo do SEI.`)
    }
  }
  for (const [campo, rot] of [['nome', 'nome'], ['cpf', 'CPF'], ['email', 'e-mail']] as const) {
    if (!limpo(pessoa[campo])) pend.push(`Aluno sem ${rot} (obrigatório no SEI).`)
  }

  const mapasDoc = await mapasDeDocumento()
  const docs = [...aprovadosPorTipo(reg.documents).values()].map((d) => ({
    id: d.id,
    tipo: d.typeCode,
    nome: d.type?.name || d.typeCode,
    codigoTipoDocumentoSei: limpo(mapasDoc.get(d.typeId!)?.codigoTipoDocumento) || null,
  }))
  for (const d of docs) if (!d.codigoTipoDocumentoSei) avisos.push(`Documento "${d.nome}" sem de-para: não será enviado.`)

  const matriculaId = await matriculaDaInscricao(registrationId)
  const contrato = await contratoAssinado(registrationId, matriculaId)
  if (cfg.enviarContrato) {
    if (!contrato) avisos.push('Contrato assinado não encontrado: segue sem ele.')
    else if (!(await tipoDoContrato())) avisos.push('Tipo de documento do contrato no SEI não definido: o contrato vai para a documentação marcada como "contrato" no SEI, se houver.')
  }
  if (reg.paymentPaidAt) {
    avisos.push(`1ª parcela paga no portal (R$ ${Number(reg.paymentAmount ?? 0).toFixed(2)} em ${reg.paymentPaidAt.toLocaleDateString('pt-BR')}): a baixa no SEI depende de definição do fornecedor.`)
  }

  return {
    registrationId: reg.id,
    candidateCode: reg.candidateCode,
    offeringId,
    oferta,
    mapaOferta: mapa,
    condicaoPagamento: mapa ? condicaoEscolhida(mapa, reg.paymentPlan) : '',
    pessoa,
    documentos: docs,
    contrato,
    pendencias: pend,
    avisos,
  }
}

// ── Fila de envios ──────────────────────────────────────────────────────────

export async function enfileirar(registrationId: number, origem: 'manual' | 'automatico', userId?: number | null) {
  const atual = await prisma.seiEnvio.findUnique({ where: { registrationId } })
  if (atual?.status === 'CONCLUIDO') return atual
  if (atual?.status === 'PROCESSANDO') return atual
  return prisma.seiEnvio.upsert({
    where: { registrationId },
    create: { registrationId, origem, criadoPorId: userId ?? null, status: 'PENDENTE', proximaTentativaEm: new Date() },
    update: { status: 'PENDENTE', proximaTentativaEm: new Date(), ultimoErro: null, ...(origem === 'manual' ? { tentativas: 0 } : {}) },
  })
}

/** Espera entre tentativas automáticas de falha transitória (rede, 5xx). */
const ESPERAS_MIN = [1, 5, 15, 60, 180, 360]

const emAndamento = new Set<number>()

export async function processar(envioId: number): Promise<void> {
  if (emAndamento.has(envioId)) return
  emAndamento.add(envioId)
  try {
    await processarSemTrava(envioId)
  } finally {
    emAndamento.delete(envioId)
  }
}

async function processarSemTrava(envioId: number): Promise<void> {
  const envio = await prisma.seiEnvio.findUnique({ where: { id: envioId } })
  if (!envio || envio.status === 'CONCLUIDO' || envio.status === 'CANCELADO') return
  await prisma.seiEnvio.update({ where: { id: envioId }, data: { status: 'PROCESSANDO', tentativas: { increment: 1 } } })
  const ctx = { envioId }
  try {
    const cfg = await sei.getSeiConfig(true)
    if (!cfg.enabled) throw new SeiPendencia('Integração com o SEI desligada.')
    const pv = await previa(envio.registrationId)
    if (pv.pendencias.length) throw new SeiPendencia(pv.pendencias.join(' '))
    const mapa = pv.mapaOferta!
    const reg = await carregarInscricao(envio.registrationId)
    let e = envio

    // 1) Pessoa
    if (!e.codigoPessoa) {
      const r: any = await sei.cadastrarPreInscricao({
        nome: pv.pessoa.nome, email: pv.pessoa.email,
        telefoneResidencial: pv.pessoa.telefoneResidencial || pv.pessoa.celular,
        celular: pv.pessoa.celular, codigoCurso: mapa.codigoCurso,
      }, ctx)
      if (r?.erro) throw new sei.SeiError(String(r.erro), 200, 'NE005 cadastrarPreInscricao', r)
      const codigo = limpo(r?.codigo)
      if (!codigo || codigo === '0') throw new sei.SeiError('O SEI não devolveu o código da pessoa.', 200, 'NE005 cadastrarPreInscricao', r)
      e = await prisma.seiEnvio.update({ where: { id: e.id }, data: { codigoPessoa: codigo, etapa: 'matricula' } })
    }

    // 2) Matrícula
    if (!e.matricula) {
      const pessoaCod = e.codigoPessoa!
      const curso = limpo(mapa.codigoCurso), banner = limpo(mapa.codigoBanner)
      let dados: any = await sei.iniciarMatricula(curso, banner, pessoaCod, ctx)
      const unidade = limpo(mapa.codigoUnidadeEnsino)
      if (unidade && limpo(dados?.unidadeEnsino?.codigo) !== unidade) {
        exigirOpcao(dados?.unidadeEnsinos, unidade, 'unidade de ensino')
        dados = await sei.escolherUnidade(curso, banner, pessoaCod, unidade, ctx)
      }
      const grade = limpo(mapa.codigoGradeCurricular) || limpo(dados?.curso?.gradeDisciplina?.codigo)
      const turno = limpo(mapa.codigoTurno)
      if (turno && limpo(dados?.turno?.codigo) !== turno) {
        exigirOpcao(dados?.turnos, turno, 'turno')
        dados = await sei.escolherTurno({ unidade, curso, turno, grade, banner, pessoa: pessoaCod }, ctx)
      }
      const turma = limpo(mapa.codigoTurma)
      const periodo = limpo(mapa.numeroPeriodoLetivo) || '1'
      if (turma && limpo(dados?.turma?.codigo) !== turma) {
        exigirOpcao(dados?.turmas, turma, 'turma')
        dados = await sei.escolherTurma({ unidade, curso, turno, grade, banner, pessoa: pessoaCod, turma, periodo }, ctx)
      }
      const processo = limpo(mapa.codigoProcessoMatricula)
      exigirOpcao(dados?.processoMatriculas, processo, 'processo de matrícula')
      const condicao = pv.condicaoPagamento
      exigirOpcao(dados?.condicaoPagamentos, condicao, 'condição de pagamento')
      const condObj = (dados?.condicaoPagamentos ?? []).find((c: any) => limpo(c?.codigo) === condicao) ?? { codigo: condicao }
      const campusId = limpo((reg.formData as any)?.campusId)
      const polo = campusId ? limpo(mapa.polos?.[campusId]) : ''

      const simulacao = await sei.simularPlano({ unidade, curso, turma, processo, condicao, cupom: limpo(mapa.cupomDesconto), turno }, ctx)
      e = await prisma.seiEnvio.update({ where: { id: e.id }, data: { simulacaoPlano: simulacao as any } })

      const final = {
        ...dados,
        codigoBanner: banner,
        codigoUnidadeEnsino: unidade, unidadeEnsino: { ...(dados?.unidadeEnsino ?? {}), codigo: unidade },
        codigoTurno: turno, turno: { ...(dados?.turno ?? {}), codigo: turno },
        codigoTurma: turma, turma: { ...(dados?.turma ?? {}), codigo: turma },
        codigoProcessoMatricula: processo, processoMatricula: { ...(dados?.processoMatricula ?? {}), codigo: processo },
        codigoCondicaoPagamento: condicao, condicaoPagamento: condObj,
        ...(limpo(mapa.ano) ? { ano: limpo(mapa.ano) } : {}),
        ...(limpo(mapa.semestre) ? { semestre: limpo(mapa.semestre) } : {}),
        ...(polo ? { codigoUnidadeEnsinoPolo: polo } : {}),
        cupomDesconto: limpo(mapa.cupomDesconto),
        pessoa: { ...(dados?.pessoa ?? {}), ...pv.pessoa, codigo: pessoaCod, codigoCurso: limpo(mapa.codigoCurso) },
      }
      const r: any = await sei.matricularAluno(final, ctx)
      const numero = limpo(r?.matricula)
      if (!numero || String(r?.matriculaRealizadaComSucesso) !== 'true') {
        throw new sei.SeiError(limpo(r?.mensagem || r?.motivoRecusa) || 'O SEI não confirmou a matrícula.', 200, 'NE014 matricularAluno', r)
      }
      e = await prisma.seiEnvio.update({
        where: { id: e.id },
        data: {
          matricula: numero, codigoMatriculaPeriodo: limpo(r?.codigoMatriculaPeriodo) || null,
          dadosMatricula: r, etapa: 'documentos', matriculaId: await matriculaDaInscricao(e.registrationId),
        },
      })
    }

    // 3) Documentos (+ contrato)
    if (e.etapa === 'documentos') {
      const enviados: Record<string, any> = { ...((e.documentosEnviados as any) ?? {}) }
      const lista: any[] = (await sei.listarDocumentacao(e.matricula!, ctx)) ?? []
      const mapasDoc = await mapasDeDocumento()
      const aprovados = aprovadosPorTipo(reg.documents)
      const tipoContrato = await tipoDoContrato()
      const contrato = cfg.enviarContrato ? await contratoAssinado(e.registrationId, e.matriculaId) : null
      const naoAtendidos: string[] = []

      for (const item of Array.isArray(lista) ? lista : []) {
        const codDoc = limpo(item?.codigo)
        const tipo = item?.tipoDeDocumentoVO ?? {}
        const codTipo = limpo(tipo.codigo)
        if (!codDoc || enviados[codDoc]) continue
        const ehContrato = String(tipo.contrato) === 'true' || (!!tipoContrato && codTipo === tipoContrato)
        let arquivo: { nome: string; mime: string; url: string; localId: number | null } | null = null
        if (ehContrato) {
          if (contrato) arquivo = { nome: contrato.nome, mime: 'application/pdf', url: contrato.url, localId: null }
        } else {
          for (const [typeId, m] of mapasDoc) {
            if (limpo(m.codigoTipoDocumento) !== codTipo) continue
            const d = aprovados.get(typeId)
            if (d) { arquivo = { nome: nomeDoArquivo(d.type?.name || d.typeCode, d.fileName || basename(d.fileUrl)), mime: d.mimeType || 'application/octet-stream', url: d.fileUrl, localId: d.id }; break }
          }
        }
        if (!arquivo) { naoAtendidos.push(limpo(tipo.nome) || codTipo || codDoc); continue }
        const bytes = await arquivoLocalOuRemoto(arquivo.url)
        const subido: any = await sei.enviarArquivoDocumentacao(codDoc, { nome: arquivo.nome, mime: arquivo.mime, bytes }, ctx)
        await sei.gravarDocumentacao(subido && typeof subido === 'object' ? subido : { ...item }, ctx)
        enviados[codDoc] = { localId: arquivo.localId, nome: arquivo.nome, tipo: limpo(tipo.nome) || codTipo, contrato: ehContrato, em: new Date().toISOString() }
        await prisma.seiEnvio.update({ where: { id: e.id }, data: { documentosEnviados: enviados } })
      }
      const avisos = [...pv.avisos]
      if (naoAtendidos.length) avisos.push(`O SEI pede documentos que o portal não tem aprovados/mapeados: ${naoAtendidos.join(', ')}.`)
      e = await prisma.seiEnvio.update({
        where: { id: e.id },
        data: { etapa: 'concluido', status: 'CONCLUIDO', concluidoEm: new Date(), ultimoErro: null, proximaTentativaEm: null, avisos },
      })
    }
  } catch (err: any) {
    const transitorio = err instanceof sei.SeiError && err.transitorio
    const atual = await prisma.seiEnvio.findUnique({ where: { id: envioId }, select: { tentativas: true } })
    const n = atual?.tentativas ?? 1
    const espera = transitorio && n <= ESPERAS_MIN.length ? ESPERAS_MIN[n - 1] : null
    const onde = err instanceof sei.SeiError ? `[${err.servico}] ` : ''
    await prisma.seiEnvio.update({
      where: { id: envioId },
      data: {
        status: espera ? 'PENDENTE' : 'ERRO',
        ultimoErro: onde + (err?.message || String(err)),
        proximaTentativaEm: espera ? new Date(Date.now() + espera * 60_000) : null,
      },
    })
  }
}

/** Nome legível no SEI: "RG ou CNH.png" em vez do nome sorteado do upload. */
function nomeDoArquivo(tipo: string, original: string): string {
  const ext = /\.[a-z0-9]{2,5}$/i.exec(original)?.[0] ?? ''
  const base = tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .-]+/g, '').trim().slice(0, 80) || 'documento'
  return base + ext.toLowerCase()
}

/** A opção escolhida no de-para precisa existir na lista que o SEI ofereceu. */
function exigirOpcao(lista: unknown, codigo: string, rotulo: string) {
  if (!codigo) throw new SeiPendencia(`De-para sem ${rotulo}.`)
  if (!Array.isArray(lista) || lista.length === 0) return
  if (!lista.some((x: any) => limpo(x?.codigo) === codigo)) {
    const ofertas = lista.map((x: any) => `${limpo(x?.codigo)} (${limpo(x?.nome)})`).join(', ')
    throw new SeiPendencia(`O SEI não oferece ${rotulo} ${codigo} para esta matrícula. Opções: ${ofertas}.`)
  }
}

// ── Agendador e gatilho ─────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null
let rodando = false

async function tick() {
  if (rodando) return
  rodando = true
  try {
    const cfg = await sei.getSeiConfig()
    if (!cfg.enabled || !cfg.baseUrl) return
    // Envio preso em PROCESSANDO (servidor reiniciou no meio): volta para a fila.
    await prisma.seiEnvio.updateMany({
      where: { status: 'PROCESSANDO', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { status: 'PENDENTE', proximaTentativaEm: new Date() },
    })
    const prontos = await prisma.seiEnvio.findMany({
      where: { status: 'PENDENTE', proximaTentativaEm: { lte: new Date() } },
      orderBy: { proximaTentativaEm: 'asc' },
      take: 10,
      select: { id: true },
    })
    for (const p of prontos) await processar(p.id)
  } catch (e: any) {
    console.warn('[sei] agendador:', e?.message || e)
  } finally {
    rodando = false
  }
}

export function iniciarIntegracaoSei() {
  if (timer) return
  timer = setInterval(() => { void tick() }, 60_000)
  // Matrícula efetivada (contrato assinado) → envia, se o envio automático estiver ligado.
  eventBus.on('matricula.efetivada', async (ev: any) => {
    try {
      const registrationId = Number(ev?.payload?.registrationId)
      if (!registrationId) return
      const cfg = await sei.getSeiConfig(true)
      if (!cfg.enabled || !cfg.autoEnviar) return
      await enfileirar(registrationId, 'automatico')
    } catch (e: any) {
      console.warn('[sei] gatilho matricula.efetivada:', e?.message || e)
    }
  })
}
