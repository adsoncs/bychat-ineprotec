// src/services/portalJornada.ts
//
// As etapas depois da inscrição — pagamento, documentos, contrato e prova
// (redação online) — e a ORDEM em que cada portal quer que elas aconteçam.
//
// Cada portal escolhe duas sequências:
//   · inscricao: o que a pessoa faz logo depois de enviar o formulário, ali na
//     mesma tela, uma etapa por vez;
//   · painel: a ordem em que as etapas aparecem no portal logado ("o que falta").
//     null = a mesma da inscrição.
// Etapa que não se aplica à inscrição some sozinha — portal que não cobra não
// mostra pagamento, processo sem redação online não mostra prova —, então a
// ordem configurada vale para o que existe de fato.

import { prisma } from '../lib/prisma.js'
import { getTermoTemplate } from './acaContrato.js'
import { normalizarDados, dadosEfetivos, camposDaEtapa, valoresAtuais, type EtapaDados } from './dadosCadastro.js'
import { requisitosQueValem } from './docCondicional.js'

export type ChaveEtapa = 'cadastro' | 'analise' | 'pagamento' | 'documentos' | 'contrato' | 'prova'
export const CHAVES: ChaveEtapa[] = ['cadastro', 'analise', 'pagamento', 'documentos', 'contrato', 'prova']

export interface EtapaConfig {
  chave: ChaveEtapa
  ativo: boolean
  /** Na inscrição: a pessoa não pode deixar para depois. */
  obrigatoria: boolean
  /** Trava: as etapas seguintes só liberam quando esta estiver CONCLUÍDA
   *  (documentos aprovados, pagamento confirmado, redação aprovada, contrato
   *  assinado, dados completos) — "em análise" ainda segura a fila. */
  trava?: boolean
  /** Formas de ingresso (EntryMode.id) em que a trava vale. Vazio = todas. */
  travaIngressos?: number[]
  /** Análise acadêmica: formas de ingresso em que a etapa aparece (vazio = todas). */
  ingressos?: number[]
  /** Análise acadêmica: documentos (DocumentType.code) que a instituição analisa
   *  antes de liberar o resto — ex.: histórico e conteúdo programático. */
  documentos?: string[]
  /** Documentos: a etapa conclui com os obrigatórios ENVIADOS (não espera a
   *  aprovação da secretaria) — a trava libera no envio. */
  liberaNoEnvio?: boolean
}

export interface JornadaConfig {
  inscricao: EtapaConfig[]
  /** null = mesma ordem da inscrição. */
  painel: EtapaConfig[] | null
  /** Dados pedidos em cada etapa, ajustados para este portal (services/dadosCadastro).
   *  null = usa o padrão da instituição. */
  dados?: unknown
  /** O que vale depois da inscrição, já no ERP e no SEI (lerJornada sempre preenche). */
  matricula?: MatriculaConfig
  /**
   * De-para com o funil do portal: em que etapa do funil o lead fica enquanto
   * o candidato está em cada etapa da jornada (chave da etapa → Stage.key), e
   * `concluido` quando todas terminaram. Ver services/funilDaJornada.
   */
  funil?: FunilDaJornada
}

export type FunilDaJornada = Partial<Record<ChaveEtapa | 'concluido', string>>

function lerFunil(bruto: unknown): FunilDaJornada {
  const b = (bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>
  const out: FunilDaJornada = {}
  for (const k of [...CHAVES, 'concluido'] as const) {
    const v = typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, 50) : ''
    if (v) out[k] = v
  }
  return out
}

/**
 * Regras da matrícula por portal. Portal de curso livre (extensão, por exemplo)
 * não tem contrato e não vai para o SEI: sem isto, a matrícula ficava parada em
 * INSCRITO esperando um aceite que nunca vem, e o SEI cobrava "contrato não assinado".
 */
export interface MatriculaConfig {
  /** A matrícula só vira MATRICULADO com o contrato aceito/assinado. Desligado:
   *  efetivar a inscrição já matricula, sem contrato. */
  exigeContrato: boolean
  /** As inscrições deste portal entram no envio ao SEI. */
  enviarSei: boolean
}

export const MATRICULA_PADRAO: MatriculaConfig = { exigeContrato: true, enviarSei: true }

function lerMatricula(bruto: unknown): MatriculaConfig {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  return {
    exigeContrato: b.exigeContrato === undefined ? MATRICULA_PADRAO.exigeContrato : !!b.exigeContrato,
    enviarSei: b.enviarSei === undefined ? MATRICULA_PADRAO.enviarSei : !!b.enviarSei,
  }
}

export const ROTULO: Record<ChaveEtapa, string> = {
  cadastro: 'Completar cadastro',
  analise: 'Análise acadêmica',
  pagamento: 'Pagamento',
  documentos: 'Documentos',
  contrato: 'Contrato',
  prova: 'Redação online',
}

/**
 * O comportamento de antes vira o padrão: na inscrição, só o pagamento (quando
 * o portal cobra); no portal logado, documentos → contrato → pagamento, que era
 * a ordem fixa do painel. Prova e contrato na inscrição só entram se escolhidos.
 */
export const PADRAO: JornadaConfig = {
  inscricao: [
    { chave: 'cadastro', ativo: true, obrigatoria: false },
    { chave: 'analise', ativo: false, obrigatoria: false },
    { chave: 'pagamento', ativo: true, obrigatoria: false },
    { chave: 'documentos', ativo: false, obrigatoria: false },
    { chave: 'contrato', ativo: false, obrigatoria: false },
    { chave: 'prova', ativo: false, obrigatoria: false },
  ],
  painel: [
    { chave: 'cadastro', ativo: true, obrigatoria: false },
    { chave: 'analise', ativo: false, obrigatoria: false },
    { chave: 'documentos', ativo: true, obrigatoria: false },
    { chave: 'contrato', ativo: true, obrigatoria: false },
    { chave: 'pagamento', ativo: true, obrigatoria: false },
    { chave: 'prova', ativo: true, obrigatoria: false },
  ],
}

function normalizarLista(bruto: unknown, padrao: EtapaConfig[]): EtapaConfig[] {
  if (!Array.isArray(bruto)) return padrao.map((e) => ({ ...e }))
  const vistos = new Set<string>()
  const out: EtapaConfig[] = []
  for (const x of bruto) {
    const chave = String((x as any)?.chave ?? '') as ChaveEtapa
    if (!CHAVES.includes(chave) || vistos.has(chave)) continue
    vistos.add(chave)
    const ids = (v: unknown) => Array.isArray(v) ? [...new Set((v as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []
    const ingressos = ids((x as any)?.travaIngressos)
    const aparece = ids((x as any)?.ingressos)
    const documentos = Array.isArray((x as any)?.documentos)
      ? [...new Set(((x as any).documentos as unknown[]).map((c) => String(c ?? '').trim().slice(0, 30)).filter(Boolean))]
      : []
    out.push({
      chave, ativo: (x as any)?.ativo !== false, obrigatoria: !!(x as any)?.obrigatoria, trava: !!(x as any)?.trava,
      ...(ingressos.length ? { travaIngressos: ingressos } : {}),
      ...(chave === 'analise' && aparece.length ? { ingressos: aparece } : {}),
      ...(chave === 'analise' && documentos.length ? { documentos } : {}),
      ...(chave === 'documentos' && (x as any)?.liberaNoEnvio ? { liberaNoEnvio: true } : {}),
    })
  }
  // Chave que faltou na config entra no fim, desligada — a lista tem sempre todas.
  // "Completar cadastro" é a exceção: veio depois das outras e entra LIGADA e na
  // frente, porque só aparece quando há dado configurado para ela.
  // A análise acadêmica (nova) entra desligada logo depois do cadastro, onde faz sentido.
  for (const c of CHAVES) {
    if (vistos.has(c)) continue
    if (c === 'cadastro') out.unshift({ chave: c, ativo: true, obrigatoria: false })
    else if (c === 'analise') {
      const i = out.findIndex((e) => e.chave === 'cadastro')
      out.splice(i + 1, 0, { chave: c, ativo: false, obrigatoria: false })
    } else out.push({ chave: c, ativo: false, obrigatoria: false })
  }
  return out
}

export function lerJornada(bruto: unknown): JornadaConfig {
  const b = (bruto && typeof bruto === 'object' ? bruto : null) as any
  if (!b) return { inscricao: normalizarLista(null, PADRAO.inscricao), painel: normalizarLista(null, PADRAO.painel!), matricula: { ...MATRICULA_PADRAO } }
  const inscricao = normalizarLista(b.inscricao, PADRAO.inscricao)
  return {
    inscricao,
    painel: b.painel === null || b.painel === undefined ? null : normalizarLista(b.painel, PADRAO.painel!),
    dados: b.dados ?? null,
    matricula: lerMatricula(b.matricula),
    funil: lerFunil(b.funil),
  }
}

/** O que gravar: normalizado, com todas as chaves, a ordem recebida e os dados do portal. */
export function jornadaParaGravar(bruto: unknown): JornadaConfig {
  const j = lerJornada(bruto)
  return { inscricao: j.inscricao, painel: j.painel, dados: normalizarDados(j.dados), matricula: j.matricula, funil: j.funil ?? {} }
}

/** Regras da matrícula do portal (padrão quando o portal não configurou). */
export async function matriculaDoPortal(portalId: number | null | undefined): Promise<MatriculaConfig> {
  if (!portalId) return { ...MATRICULA_PADRAO }
  const p = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { jornadaEtapas: true } })
  return lerJornada(p?.jornadaEtapas).matricula ?? { ...MATRICULA_PADRAO }
}

/**
 * Regras da matrícula de uma inscrição: as do portal E as do curso escolhido
 * (Educacional › Cursos). As duas precisam exigir — o polo vende graduação e
 * extensão no mesmo portal, e é o curso que diz que extensão não tem contrato.
 */
export function combinarMatricula(portal: MatriculaConfig, curso: { exigeContrato?: boolean | null; enviarSei?: boolean | null } | null | undefined): MatriculaConfig {
  return {
    exigeContrato: portal.exigeContrato && curso?.exigeContrato !== false,
    enviarSei: portal.enviarSei && curso?.enviarSei !== false,
  }
}

export async function matriculaDaInscricao(registrationId: number): Promise<MatriculaConfig> {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      portal: { select: { jornadaEtapas: true } },
      processRegistration: { select: { offering: { select: { course: { select: { exigeContrato: true, enviarSei: true } } } } } },
    },
  })
  const portal = lerJornada(r?.portal?.jornadaEtapas).matricula ?? { ...MATRICULA_PADRAO }
  return combinarMatricula(portal, r?.processRegistration?.offering?.course)
}

// ─── Situação de cada etapa para uma inscrição ────────────────────────────

export type SituacaoEtapa = 'feito' | 'pendente' | 'aguardando'

export interface EtapaDaInscricao {
  chave: ChaveEtapa
  titulo: string
  situacao: SituacaoEtapa
  detalhe: string
  obrigatoria: boolean
  /** Dados obrigatórios desta etapa ainda em branco (a etapa pede antes da ação). */
  dadosFaltando?: number
  /** Documentos: contagem dos OBRIGATÓRIOS (lista do admin mostra "4/6"). */
  progresso?: { enviados: number; total: number; aprovados: number; recusados: number }
  /** Esta etapa trava as seguintes até ser concluída. */
  trava?: boolean
  /** Travada por uma etapa anterior ainda não concluída: não dá para fazer agora. */
  bloqueada?: { por: ChaveEtapa; titulo: string; motivo: string } | null
  /** Só na análise acadêmica: documentos analisados e o parecer. */
  analise?: AnaliseDaEtapa
}

/** Parecer da análise acadêmica, gravado na inscrição (analiseAcademica). */
export interface ParecerAnalise {
  offeringId: number | null
  resultado: 'deferido' | 'indeferido'
  periodo: string | null
  aproveitamento: string | null
  observacao: string | null
  emitidoEm: string
  emitidoPor: { id: number | null; nome: string | null }
  /** Resposta do candidato a um parecer deferido. */
  aceite: { decisao: 'aceito' | 'desistiu'; em: string; via: 'portal' | 'chatbot' | 'equipe' } | null
  /** Pareceres anteriores (reemissão, outra oferta), do mais novo ao mais antigo. */
  historico?: Array<Omit<ParecerAnalise, 'historico'>>
}

export interface AnaliseDaEtapa {
  /** opcional: a forma de ingresso aceita o documento, mas não o exige — não segura a análise. */
  documentos: Array<{ code: string; nome: string; status: 'faltando' | 'pending' | 'approved' | 'rejected'; reviewNote: string | null; opcional?: boolean }>
  /** Parecer desta oferta (null = ainda em análise). */
  parecer: Omit<ParecerAnalise, 'historico'> | null
}

/** O que "concluir" quer dizer em cada etapa — usado na mensagem da trava. */
export const CONCLUIR: Record<ChaveEtapa, string> = {
  cadastro: 'todos os dados preenchidos',
  analise: 'parecer da análise emitido e aceito pelo candidato',
  pagamento: 'pagamento confirmado',
  documentos: 'todos os documentos obrigatórios aprovados',
  contrato: 'contrato assinado',
  prova: 'redação aprovada',
}

/** O "concluir" da etapa como o portal a configurou (documentos podem liberar no envio). */
export function concluirDe(e: Pick<EtapaConfig, 'chave' | 'liberaNoEnvio'>): string {
  if (e.chave === 'documentos' && e.liberaNoEnvio) return 'todos os documentos obrigatórios enviados'
  return CONCLUIR[e.chave]
}

/** Parecer gravado na inscrição, se for desta oferta (trocou de curso/forma = análise nova). */
export function parecerAtual(bruto: unknown, offeringId: number | null): ParecerAnalise | null {
  const a = (bruto && typeof bruto === 'object' ? bruto : null) as ParecerAnalise | null
  if (!a || (a.resultado !== 'deferido' && a.resultado !== 'indeferido')) return null
  if ((a.offeringId ?? null) !== (offeringId ?? null)) return null
  return a
}

async function contexto(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, leadId: true, paymentStatus: true, paymentPaidAt: true, contratoAceite: true, formData: true, analiseAcademica: true,
      lead: { select: { nome: true } },
      portal: { select: { id: true, slug: true, nome: true, requirePayment: true, jornadaEtapas: true } },
      documents: { select: { typeCode: true, status: true, reviewNote: true }, orderBy: { uploadedAt: 'asc' } },
      processRegistration: {
        select: {
          offeringId: true,
          offering: { select: { id: true, nome: true, course: { select: { nome: true, exigeContrato: true, enviarSei: true } } } },
          selectionProcess: {
            select: {
              entryModeId: true,
              useCustomDocuments: true,
              documentRequirements: { select: { required: true, condicao: true, documentType: { select: { code: true, name: true } } } },
              entryMode: { select: { evaluationType: true, documentRequirements: { select: { required: true, condicao: true, documentType: { select: { code: true, name: true } } } } } },
            },
          },
        },
      },
      essaySubmissions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, passed: true } },
    },
  })
  return reg
}

/** Etapas que existem para esta inscrição, com a situação, na ordem pedida. */
export async function etapasDaInscricao(registrationId: number, onde: 'inscricao' | 'painel'): Promise<{
  portal: { id: number; slug: string; nome: string } | null
  etapas: EtapaDaInscricao[]
} | null> {
  const reg = await contexto(registrationId)
  if (!reg) return null
  const cfg = lerJornada(reg.portal?.jornadaEtapas)
  const lista = onde === 'inscricao' ? cfg.inscricao : (cfg.painel ?? cfg.inscricao)
  const sp = reg.processRegistration?.selectionProcess as any
  const exigidos: Array<{ required: boolean; documentType: { code: string; name: string } }> = sp
    ? requisitosQueValem(sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? []), reg.formData)
    : []
  const obrigatorios = exigidos.filter((e) => e.required)
  const porTipo = new Map(reg.documents.map((d) => [d.typeCode, d.status]))
  const notaPorTipo = new Map(reg.documents.map((d) => [d.typeCode, d.reviewNote]))
  const entryModeId: number | null = sp?.entryModeId ?? null
  const offeringId: number | null = reg.processRegistration?.offeringId ?? null

  // Contrato do ERP (já matriculado) vale sobre o aceite da inscrição.
  const matricula = await prisma.acaMatricula.findFirst({
    where: { enrollmentRegistrationId: reg.id },
    select: { contrato: { select: { aceiteEm: true } } },
  }).catch(() => null)

  // Dados pedidos em cada etapa (Educacional › Dados por etapa / ajuste do portal)
  // Contrato em Word: os dados que ele usa e ainda faltam são pedidos na etapa Contrato.
  const { cfgDadosComContrato } = await import('./contratoDoPortal.js')
  const cfgDados = await cfgDadosComContrato(reg.id, await dadosEfetivos(reg.portal))
  const faltandoPorEtapa = new Map<string, number>()
  if (cfgDados) {
    for (const et of ['cadastro', 'documentos', 'contrato', 'pagamento'] as EtapaDados[]) {
      const campos = camposDaEtapa(cfgDados, et)
      if (!campos.length) { faltandoPorEtapa.set(et, -1); continue }
      const atuais = await valoresAtuais(reg, campos.map((c) => c.name))
      faltandoPorEtapa.set(et, campos.filter((c) => c.required && String(atuais[c.name] ?? '').trim() === '').length)
    }
  }

  const etapas: EtapaDaInscricao[] = []
  for (const e of lista) {
    if (!e.ativo) continue
    if (e.chave === 'cadastro') {
      const falta = faltandoPorEtapa.get('cadastro') ?? -1
      if (falta < 0) continue // nenhum dado configurado para esta etapa
      etapas.push({
        chave: 'cadastro', titulo: ROTULO.cadastro, obrigatoria: e.obrigatoria, dadosFaltando: falta,
        situacao: falta ? 'pendente' : 'feito',
        detalhe: falta ? `Faltam ${falta} dado(s)` : 'Dados completos',
      })
      continue
    }
    if (e.chave === 'analise') {
      // Só para as formas de ingresso escolhidas (vazio = todas) e com documento a analisar.
      if (!e.documentos?.length) continue
      if (e.ingressos?.length && (entryModeId == null || !e.ingressos.includes(entryModeId))) continue
      // Cada forma de ingresso analisa só os documentos que ela pede (ENEM → boletim,
      // segunda graduação → diploma, transferência → histórico e ementa). Forma sem
      // documento cadastrado analisa a lista inteira, como antes.
      const exigeDe = new Map(exigidos.map((x) => [x.documentType.code, x.required]))
      const codigos = exigidos.length ? e.documentos.filter((c) => exigeDe.has(c)) : e.documentos
      if (!codigos.length) continue
      const tipos = await prisma.documentType.findMany({ where: { code: { in: codigos } }, select: { code: true, name: true } })
      const nomeDe = new Map(tipos.map((t) => [t.code, t.name]))
      const docs = codigos.map((code) => ({
        code, nome: nomeDe.get(code) ?? code,
        status: (porTipo.get(code) ?? 'faltando') as 'faltando' | 'pending' | 'approved' | 'rejected',
        reviewNote: porTipo.get(code) === 'rejected' ? (notaPorTipo.get(code) ?? null) : null,
        ...(exigeDe.get(code) === false ? { opcional: true } : {}),
      }))
      const parecer = parecerAtual(reg.analiseAcademica, offeringId)
      const { historico: _h, ...semHistorico } = parecer ?? ({} as ParecerAnalise)
      const recusados = docs.filter((d) => d.status === 'rejected')
      const faltam = docs.filter((d) => d.status === 'faltando' && !d.opcional)
      let situacao: SituacaoEtapa
      let detalhe: string
      if (parecer?.resultado === 'indeferido') {
        situacao = 'pendente'; detalhe = 'Análise indeferida — você pode escolher outra forma de ingresso'
      } else if (parecer?.resultado === 'deferido' && parecer.aceite?.decisao === 'aceito') {
        situacao = 'feito'; detalhe = `Parecer aceito em ${new Date(parecer.aceite.em).toLocaleDateString('pt-BR')}`
      } else if (parecer?.resultado === 'deferido' && parecer.aceite?.decisao === 'desistiu') {
        situacao = 'pendente'; detalhe = 'Você optou por não continuar após o parecer'
      } else if (parecer?.resultado === 'deferido') {
        situacao = 'pendente'; detalhe = 'Parecer emitido — leia e confirme para continuar'
      } else if (recusados.length) {
        situacao = 'pendente'; detalhe = `${recusados.length} recusado(s) — reenvie: ${recusados.map((d) => d.nome).join(', ')}`
      } else if (faltam.length) {
        situacao = 'pendente'; detalhe = `Envie para análise: ${faltam.map((d) => d.nome).join(', ')}`
      } else {
        situacao = 'aguardando'; detalhe = 'Documentos enviados, em análise acadêmica'
      }
      etapas.push({
        chave: 'analise', titulo: ROTULO.analise, obrigatoria: e.obrigatoria, situacao, detalhe,
        analise: { documentos: docs, parecer: parecer ? semHistorico as Omit<ParecerAnalise, 'historico'> : null },
      })
      continue
    }
    if (e.chave === 'pagamento') {
      if (!reg.portal?.requirePayment) continue
      const pago = reg.paymentStatus === 'paid'
      etapas.push({
        chave: 'pagamento', titulo: ROTULO.pagamento, obrigatoria: e.obrigatoria,
        situacao: pago ? 'feito' : 'pendente',
        detalhe: pago ? `Pago${reg.paymentPaidAt ? ' em ' + reg.paymentPaidAt.toLocaleDateString('pt-BR') : ''}` : reg.paymentStatus === 'pending' ? 'Cobrança gerada, aguardando o pagamento' : 'Falta pagar',
      })
    } else if (e.chave === 'documentos') {
      if (!exigidos.length) continue
      const recusados = obrigatorios.filter((x) => porTipo.get(x.documentType.code) === 'rejected').length
      const entregues = obrigatorios.filter((x) => { const st = porTipo.get(x.documentType.code); return st && st !== 'rejected' }).length
      const aprovados = obrigatorios.filter((x) => porTipo.get(x.documentType.code) === 'approved').length
      const tudo = entregues >= obrigatorios.length
      // O que falta enviar — obrigatório OU opcional. Antes só contavam os
      // obrigatórios: com um opcional faltando, a etapa dizia "Enviados, em
      // análise" e a pessoa não sabia que ainda havia documento a mandar.
      const faltam = exigidos.filter((x) => { const st = porTipo.get(x.documentType.code); return !st || st === 'rejected' })
      const faltamObrig = faltam.filter((x) => x.required)
      const faltamOpc = faltam.filter((x) => !x.required)
      const nomes = (l: typeof faltam) => l.map((x) => x.documentType.name).join(', ')
      const falta = (n: number) => (n === 1 ? 'falta enviar 1' : `faltam enviar ${n}`)
      let detalhe: string
      // "Libera ao enviar": enviados bastam para concluir; a análise segue sem segurar a fila.
      const concluiu = !recusados && tudo && (e.liberaNoEnvio || aprovados >= obrigatorios.length)
      if (recusados) detalhe = `${recusados} recusado(s) — reenvie`
      else if (!tudo) detalhe = `${entregues} de ${obrigatorios.length} obrigatórios enviados — ${falta(faltamObrig.length)}: ${nomes(faltamObrig)}`
      else detalhe = aprovados >= obrigatorios.length ? 'Obrigatórios aprovados' : e.liberaNoEnvio ? 'Obrigatórios enviados (a secretaria confere)' : 'Obrigatórios enviados, em análise'
      if (!recusados && faltamOpc.length) detalhe += ` · ${falta(faltamOpc.length)} opcional: ${nomes(faltamOpc)}`
      etapas.push({
        chave: 'documentos', titulo: ROTULO.documentos, obrigatoria: e.obrigatoria,
        situacao: recusados ? 'pendente' : concluiu ? 'feito' : tudo ? 'aguardando' : 'pendente',
        detalhe,
        progresso: { enviados: entregues, total: obrigatorios.length, aprovados, recusados },
      })
    } else if (e.chave === 'contrato') {
      if (!reg.processRegistration?.offering) continue
      // Curso sem contrato (ex.: extensão vendida no portal do polo): a etapa some.
      if (reg.processRegistration.offering.course?.exigeContrato === false) continue
      const aceite = (reg.contratoAceite ?? null) as any
      const erp = matricula?.contrato?.aceiteEm ?? null
      const assinado = !!erp || !!aceite?.em
      etapas.push({
        chave: 'contrato', titulo: ROTULO.contrato, obrigatoria: e.obrigatoria,
        situacao: assinado ? 'feito' : 'pendente',
        detalhe: assinado ? `Assinado em ${new Date(erp ?? aceite.em).toLocaleDateString('pt-BR')}` : 'Falta ler e assinar',
      })
    } else if (e.chave === 'prova') {
      if (sp?.entryMode?.evaluationType !== 'exam_online') continue
      const ult = reg.essaySubmissions[0]
      const st = ult?.status
      etapas.push({
        chave: 'prova', titulo: ROTULO.prova, obrigatoria: e.obrigatoria,
        situacao: st === 'approved' ? 'feito' : st === 'ai_reviewing' || st === 'needs_human' || st === 'submitted' ? 'aguardando' : 'pendente',
        detalhe: st === 'approved' ? 'Aprovada' : st === 'rejected' ? 'Não aprovada' : st === 'ai_reviewing' || st === 'needs_human' || st === 'submitted' ? 'Enviada, em correção' : st === 'draft' ? 'Em andamento' : 'Falta fazer',
      })
    }
  }
  // Etapa que pede dados antes da ação fica pendente enquanto faltarem.
  for (const et of etapas) {
    if (et.chave === 'cadastro' || et.chave === 'prova' || et.chave === 'analise') continue
    const falta = faltandoPorEtapa.get(et.chave) ?? -1
    if (falta > 0) {
      et.dadosFaltando = falta
      if (et.situacao !== 'feito') { et.situacao = 'pendente'; et.detalhe = `Faltam ${falta} dado(s) · ${et.detalhe}` }
    } else if (falta === 0) et.dadosFaltando = 0
  }
  aplicarTravas(etapas, lista, entryModeId)
  return { portal: reg.portal ? { id: reg.portal.id, slug: reg.portal.slug, nome: reg.portal.nome } : null, etapas }
}

/**
 * Trava: depois de uma etapa com trava que ainda não está concluída, as
 * seguintes ficam bloqueadas. Etapa que não se aplica à inscrição já saiu da
 * lista — não trava nada. Etapa já concluída não volta a ficar bloqueada.
 */
function aplicarTravas(etapas: EtapaDaInscricao[], lista: EtapaConfig[], entryModeId: number | null) {
  // Trava restrita a formas de ingresso só vale para quem entrou por uma delas
  // (inscrição sem forma de ingresso definida não cai em trava restrita).
  const vale = (e: EtapaConfig) => !e.travaIngressos?.length || (entryModeId != null && e.travaIngressos.includes(entryModeId))
  // A análise acadêmica trava sempre: é para isso que ela existe.
  const comTrava = new Set(lista.filter((e) => e.ativo && ((e.trava && vale(e)) || e.chave === 'analise')).map((e) => e.chave))
  const cfgDe = new Map(lista.map((e) => [e.chave, e]))
  let segurando: EtapaDaInscricao | null = null
  for (const et of etapas) {
    et.trava = comTrava.has(et.chave)
    et.bloqueada = null
    if (segurando && et.situacao !== 'feito') {
      et.bloqueada = {
        por: segurando.chave, titulo: segurando.titulo,
        motivo: `Libera depois de concluir "${segurando.titulo}" (${concluirDe(cfgDe.get(segurando.chave) ?? { chave: segurando.chave })}).`,
      }
    }
    if (!segurando && et.trava && et.situacao !== 'feito') segurando = et
  }
}

/**
 * Por que esta etapa não pode ser feita agora (null = pode). É a trava do lado
 * do servidor: portal, painel e chatbot passam pelas mesmas rotas, então
 * ninguém pula a fila chamando a API direto.
 *
 * Cada tela respeita a SUA configuração: na tela de inscrição (e no chatbot,
 * que conduz a inscrição) vale a sequência "inscricao"; no portal logado, a
 * "painel" (null = a mesma da inscrição). Quem diz onde a pessoa está é o
 * token assinado (lib/candidateAuth › ondeDoToken), não o navegador.
 */
export async function bloqueioDaEtapa(registrationId: number, chave: ChaveEtapa, onde: 'inscricao' | 'painel'): Promise<string | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portal: { select: { jornadaEtapas: true } } } })
  const cfg = lerJornada(reg?.portal?.jornadaEtapas)
  const lista = onde === 'painel' ? (cfg.painel ?? cfg.inscricao) : cfg.inscricao
  if (!lista.some((e) => e.ativo && (e.trava || e.chave === 'analise'))) return null
  const j = await etapasDaInscricao(registrationId, onde)
  const et = j?.etapas.find((e) => e.chave === chave)
  return et?.bloqueada ? `Esta etapa ainda está travada. ${et.bloqueada.motivo}` : null
}

/**
 * Trava no envio de UM documento: os documentos da análise acadêmica seguem a
 * etapa da análise (vêm antes de tudo); os demais, a etapa Documentos.
 */
export async function bloqueioDoDocumento(registrationId: number, typeCode: string, onde: 'inscricao' | 'painel'): Promise<string | null> {
  const j = await etapasDaInscricao(registrationId, onde)
  const analise = j?.etapas.find((e) => e.chave === 'analise')
  if (analise?.analise?.documentos.some((d) => d.code === typeCode)) {
    if (analise.bloqueada) return `Esta etapa ainda está travada. ${analise.bloqueada.motivo}`
    if (analise.analise.parecer) return 'A análise acadêmica destes documentos já foi concluída.'
    return null
  }
  const docs = j?.etapas.find((e) => e.chave === 'documentos')
  return docs?.bloqueada ? `Esta etapa ainda está travada. ${docs.bloqueada.motivo}` : null
}

// ─── Análise acadêmica: parecer da instituição e resposta do candidato ────

/** A etapa de análise desta inscrição (em qualquer das duas sequências), ou null. */
export async function etapaDeAnalise(registrationId: number) {
  for (const onde of ['inscricao', 'painel'] as const) {
    const j = await etapasDaInscricao(registrationId, onde)
    const et = j?.etapas.find((e) => e.chave === 'analise')
    if (et) return et
  }
  return null
}

export async function emitirParecer(p: {
  registrationId: number
  resultado: 'deferido' | 'indeferido'
  periodo?: string | null
  aproveitamento?: string | null
  observacao?: string | null
  userId: number | null
  userNome: string | null
}): Promise<{ ok: true; parecer: ParecerAnalise } | { ok: false; erro: string }> {
  const et = await etapaDeAnalise(p.registrationId)
  if (!et?.analise) return { ok: false, erro: 'Esta inscrição não passa por análise acadêmica (veja Portal › Etapas).' }
  const txt = (v: unknown, max: number) => { const t = String(v ?? '').trim().slice(0, max); return t || null }
  const periodo = txt(p.periodo, 120)
  const observacao = txt(p.observacao, 4000)
  if (p.resultado === 'deferido' && !periodo) return { ok: false, erro: 'Informe o período em que o candidato vai ingressar.' }
  if (p.resultado === 'indeferido' && !observacao) return { ok: false, erro: 'Explique o motivo do indeferimento — o candidato vai ler.' }
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: p.registrationId },
    select: { analiseAcademica: true, processRegistration: { select: { offeringId: true } } },
  })
  if (!reg) return { ok: false, erro: 'Inscrição não encontrada.' }
  const anterior = (reg.analiseAcademica && typeof reg.analiseAcademica === 'object' ? reg.analiseAcademica : null) as ParecerAnalise | null
  const { historico: histAnterior, ...anteriorSem } = anterior ?? ({} as ParecerAnalise)
  const parecer: ParecerAnalise = {
    offeringId: reg.processRegistration?.offeringId ?? null,
    resultado: p.resultado, periodo, aproveitamento: txt(p.aproveitamento, 8000), observacao,
    emitidoEm: new Date().toISOString(),
    emitidoPor: { id: p.userId, nome: p.userNome },
    aceite: null,
    historico: anterior ? [anteriorSem as Omit<ParecerAnalise, 'historico'>, ...(histAnterior ?? [])].slice(0, 10) : [],
  }
  await prisma.enrollmentRegistration.update({ where: { id: p.registrationId }, data: { analiseAcademica: parecer as any } })
  // Deferido: os documentos analisados ficam aprovados (a análise já os conferiu).
  if (p.resultado === 'deferido') {
    await prisma.enrollmentDocument.updateMany({
      where: { registrationId: p.registrationId, typeCode: { in: et.analise.documentos.map((d) => d.code) }, status: 'pending' },
      data: { status: 'approved', reviewNote: 'Aprovado na análise acadêmica', reviewedBy: p.userId, reviewedAt: new Date() },
    })
  }
  return { ok: true, parecer }
}

export async function responderParecer(registrationId: number, decisao: 'aceito' | 'desistiu', via: 'portal' | 'chatbot' | 'equipe'):
  Promise<{ ok: true } | { ok: false; erro: string }> {
  const et = await etapaDeAnalise(registrationId)
  const parecer = et?.analise?.parecer
  if (!parecer) return { ok: false, erro: 'Ainda não há parecer da análise acadêmica.' }
  if (parecer.resultado !== 'deferido') return { ok: false, erro: 'A análise foi indeferida — escolha outra forma de ingresso.' }
  if (parecer.aceite) return { ok: false, erro: parecer.aceite.decisao === 'aceito' ? 'Você já aceitou este parecer.' : 'Você já optou por não continuar.' }
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { analiseAcademica: true } })
  const atual = (reg?.analiseAcademica ?? {}) as unknown as ParecerAnalise
  const aceite = { decisao, em: new Date().toISOString(), via }
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    // Desistiu: a inscrição é encerrada (Cancelada) — a pessoa pode se inscrever de novo.
    data: { analiseAcademica: { ...atual, aceite } as any, ...(decisao === 'desistiu' ? { status: 'cancelled' } : {}) },
  })
  ;(await import('./funilDaJornada.js')).sincronizarFunil(registrationId)
  return { ok: true }
}

// ─── Contrato na inscrição ───────────────────────────────────────────────

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export interface ContratoDaInscricao {
  titulo: string
  termo: string
  curso: string
  oferta: string
  aluno: string
  valorTotalCentavos: number
  numParcelas: number
  valorParcelaCentavos: number
  assinado: boolean
  assinadoEm: string | null
  assinadoPor: string | null
}

/**
 * O contrato que a pessoa lê e assina ainda na inscrição.
 *
 * É o mesmo modelo de termo do ERP (Acadêmico › Financeiro › termo), preenchido
 * com o que já se sabe na inscrição: nome, curso e o plano de pagamento da
 * oferta. Não há RA nem turma ainda — ficam como "a definir". Quem já assinou
 * vê exatamente o texto congelado no aceite.
 */
export async function contratoDaInscricao(registrationId: number): Promise<ContratoDaInscricao | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      contratoAceite: true, formData: true, lead: { select: { nome: true } },
      paymentPlan: true, paymentStatus: true,
      processRegistration: { select: { offering: { select: { id: true, nome: true, valorMatricula: true, valorMensalidade: true, course: { select: { nome: true } } } } } },
    },
  })
  const of = reg?.processRegistration?.offering
  if (!reg || !of) return null
  const aceite = (reg.contratoAceite ?? null) as any
  const plano = await prisma.acaPlanoPagamento.findFirst({
    where: { courseOfferingId: of.id, ativo: true }, orderBy: { id: 'asc' },
    select: { numParcelas: true, valorParcelaCentavos: true, taxaMatriculaCentavos: true },
  }).catch(() => null)
  // Pago pela tabela de preços do portal: o termo diz a condição aceita no
  // checkout — é ela que vira o contrato do ERP (acaFinanceiro).
  const pp = (reg.paymentStatus === 'paid' ? reg.paymentPlan : null) as Record<string, any> | null
  const pelaTabela = pp?.tabela && Number(pp.tabela.valorTotal) > 0 ? pp.tabela : null
  let numParcelas = pelaTabela ? Math.max(1, Number(pelaTabela.parcelas) || 1) : (plano?.numParcelas ?? 0)
  let valorParcela = pelaTabela
    ? Math.round(Number(pelaTabela.valorParcela) * 100)
    : (plano?.valorParcelaCentavos ?? 0)
  // Sem plano não há preço: os valores avulsos da oferta deixaram de valer.
  const matricula = pelaTabela ? 0 : (plano?.taxaMatriculaCentavos ?? 0)
  let valorTotal = pelaTabela ? Math.round(Number(pelaTabela.valorTotal) * 100) : matricula + valorParcela * numParcelas

  // Plano de pagamento da oferta (services/planoFinanceiro): o escolhido no
  // checkout; antes de pagar, o primeiro liberado.
  const { condicaoDoContrato } = await import('./planoFinanceiro.js')
  const cond = await condicaoDoContrato(of.id, pp)
  if (cond) {
    numParcelas = cond.numParcelas
    valorParcela = cond.valorParcelaCentavos
    valorTotal = cond.valorTotalCentavos
  }
  const nome = reg.lead?.nome ?? String((reg.formData as any)?.nome ?? '')
  const vars: Record<string, string> = {
    nome, ra: 'a definir na matrícula', curso: of.course?.nome ?? of.nome, turma: of.nome,
    valorTotal: money(valorTotal), numParcelas: String(numParcelas || '—'), valorParcela: money(valorParcela),
  }
  const termo = aceite?.termo ?? (await getTermoTemplate()).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`))
  return {
    titulo: 'Contrato de prestação de serviços educacionais',
    termo, curso: vars.curso, oferta: of.nome, aluno: nome,
    valorTotalCentavos: valorTotal, numParcelas, valorParcelaCentavos: valorParcela,
    assinado: !!aceite?.em, assinadoEm: aceite?.em ?? null, assinadoPor: aceite?.nome ?? null,
  }
}

/**
 * Aceite do contrato na inscrição. Idempotente: a gravação é condicional
 * (só onde ainda não há aceite) — duas abas ou clique duplo não assinam duas vezes.
 * O termo fica congelado no aceite; é ele que o contrato do ERP herda.
 */
export async function assinarContratoDaInscricao(p: { registrationId: number; nome: string; ip: string; userAgent?: string | null }):
  Promise<{ ok: true; jaAssinado: boolean } | { ok: false; erro: string }> {
  const nome = String(p.nome || '').trim()
  if (nome.length < 5 || !nome.includes(' ')) return { ok: false, erro: 'Escreva seu nome completo para assinar.' }
  const c = await contratoDaInscricao(p.registrationId)
  if (!c) return { ok: false, erro: 'Esta inscrição ainda não tem curso escolhido para gerar o contrato.' }
  if (c.assinado) return { ok: true, jaAssinado: true }
  const aceite = {
    termo: c.termo, nome: nome.slice(0, 191), ip: String(p.ip || '').slice(0, 60),
    userAgent: String(p.userAgent || '').slice(0, 300), em: new Date().toISOString(),
    plano: { valorTotalCentavos: c.valorTotalCentavos, numParcelas: c.numParcelas, valorParcelaCentavos: c.valorParcelaCentavos },
  }
  const n = await prisma.$executeRaw`UPDATE bychat_enrollment_registrations SET contratoAceite = ${JSON.stringify(aceite)} WHERE id = ${p.registrationId} AND contratoAceite IS NULL`
  if (Number(n) > 0) (await import('./funilDaJornada.js')).sincronizarFunil(p.registrationId)
  return { ok: true, jaAssinado: Number(n) === 0 }
}
