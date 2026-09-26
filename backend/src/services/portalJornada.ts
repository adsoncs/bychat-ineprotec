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

export type ChaveEtapa = 'cadastro' | 'pagamento' | 'documentos' | 'contrato' | 'prova'
export const CHAVES: ChaveEtapa[] = ['cadastro', 'pagamento', 'documentos', 'contrato', 'prova']

export interface EtapaConfig {
  chave: ChaveEtapa
  ativo: boolean
  /** Na inscrição: a pessoa não pode deixar para depois. */
  obrigatoria: boolean
}

export interface JornadaConfig {
  inscricao: EtapaConfig[]
  /** null = mesma ordem da inscrição. */
  painel: EtapaConfig[] | null
  /** Dados pedidos em cada etapa, ajustados para este portal (services/dadosCadastro).
   *  null = usa o padrão da instituição. */
  dados?: unknown
}

export const ROTULO: Record<ChaveEtapa, string> = {
  cadastro: 'Completar cadastro',
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
    { chave: 'pagamento', ativo: true, obrigatoria: false },
    { chave: 'documentos', ativo: false, obrigatoria: false },
    { chave: 'contrato', ativo: false, obrigatoria: false },
    { chave: 'prova', ativo: false, obrigatoria: false },
  ],
  painel: [
    { chave: 'cadastro', ativo: true, obrigatoria: false },
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
    out.push({ chave, ativo: (x as any)?.ativo !== false, obrigatoria: !!(x as any)?.obrigatoria })
  }
  // Chave que faltou na config entra no fim, desligada — a lista tem sempre todas.
  // "Completar cadastro" é a exceção: veio depois das outras e entra LIGADA e na
  // frente, porque só aparece quando há dado configurado para ela.
  for (const c of CHAVES) {
    if (vistos.has(c)) continue
    if (c === 'cadastro') out.unshift({ chave: c, ativo: true, obrigatoria: false })
    else out.push({ chave: c, ativo: false, obrigatoria: false })
  }
  return out
}

export function lerJornada(bruto: unknown): JornadaConfig {
  const b = (bruto && typeof bruto === 'object' ? bruto : null) as any
  if (!b) return { inscricao: normalizarLista(null, PADRAO.inscricao), painel: normalizarLista(null, PADRAO.painel!) }
  const inscricao = normalizarLista(b.inscricao, PADRAO.inscricao)
  return {
    inscricao,
    painel: b.painel === null || b.painel === undefined ? null : normalizarLista(b.painel, PADRAO.painel!),
    dados: b.dados ?? null,
  }
}

/** O que gravar: normalizado, com todas as chaves, a ordem recebida e os dados do portal. */
export function jornadaParaGravar(bruto: unknown): JornadaConfig {
  const j = lerJornada(bruto)
  return { inscricao: j.inscricao, painel: j.painel, dados: normalizarDados(j.dados) }
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
}

async function contexto(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, leadId: true, paymentStatus: true, paymentPaidAt: true, contratoAceite: true, formData: true,
      lead: { select: { nome: true } },
      portal: { select: { id: true, slug: true, nome: true, requirePayment: true, jornadaEtapas: true } },
      documents: { select: { typeCode: true, status: true } },
      processRegistration: {
        select: {
          offering: { select: { id: true, nome: true, course: { select: { nome: true } } } },
          selectionProcess: {
            select: {
              useCustomDocuments: true,
              documentRequirements: { select: { required: true, documentType: { select: { code: true } } } },
              entryMode: { select: { evaluationType: true, documentRequirements: { select: { required: true, documentType: { select: { code: true } } } } } },
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
  const exigidos: Array<{ required: boolean; documentType: { code: string } }> = sp
    ? (sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? []))
    : []
  const obrigatorios = exigidos.filter((e) => e.required)
  const porTipo = new Map(reg.documents.map((d) => [d.typeCode, d.status]))

  // Contrato do ERP (já matriculado) vale sobre o aceite da inscrição.
  const matricula = await prisma.acaMatricula.findFirst({
    where: { enrollmentRegistrationId: reg.id },
    select: { contrato: { select: { aceiteEm: true } } },
  }).catch(() => null)

  // Dados pedidos em cada etapa (Educacional › Dados por etapa / ajuste do portal)
  const cfgDados = await dadosEfetivos(reg.portal)
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
      etapas.push({
        chave: 'documentos', titulo: ROTULO.documentos, obrigatoria: e.obrigatoria,
        situacao: recusados ? 'pendente' : tudo ? (aprovados >= obrigatorios.length ? 'feito' : 'aguardando') : 'pendente',
        detalhe: recusados ? `${recusados} recusado(s) — reenvie` : tudo ? (aprovados >= obrigatorios.length ? 'Todos aprovados' : 'Enviados, em análise') : `${entregues} de ${obrigatorios.length} enviados`,
      })
    } else if (e.chave === 'contrato') {
      if (!reg.processRegistration?.offering) continue
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
    if (et.chave === 'cadastro' || et.chave === 'prova') continue
    const falta = faltandoPorEtapa.get(et.chave) ?? -1
    if (falta > 0) {
      et.dadosFaltando = falta
      if (et.situacao !== 'feito') { et.situacao = 'pendente'; et.detalhe = `Faltam ${falta} dado(s) · ${et.detalhe}` }
    } else if (falta === 0) et.dadosFaltando = 0
  }
  return { portal: reg.portal ? { id: reg.portal.id, slug: reg.portal.slug, nome: reg.portal.nome } : null, etapas }
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
  const numParcelas = plano?.numParcelas ?? 0
  const valorParcela = plano?.valorParcelaCentavos ?? Math.round(Number(of.valorMensalidade ?? 0) * 100)
  const matricula = plano?.taxaMatriculaCentavos ?? Math.round(Number(of.valorMatricula ?? 0) * 100)
  const valorTotal = matricula + valorParcela * numParcelas
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
  return { ok: true, jaAssinado: Number(n) === 0 }
}
