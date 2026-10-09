// src/services/journey/eduSdr.ts
//
// Consultor educacional por IA (SDR + matrícula pelo chat) para a jornada
// `ai_journey`. Liga por formulário: `form.settings.eduSdr.enabled = true`.
// Chatbot sem essa chave não vê nada daqui — nem ferramenta, nem bloco de prompt.
//
// Duas regras de desenho:
//
// 1. O PORTAL é a fonte da verdade. Curso, nível, modalidade, polo, preço por
//    meio, forma de ingresso, documentos e a ORDEM das etapas vêm das mesmas
//    rotas públicas que o portal de matrículas usa (app.inject), não de uma
//    cópia. Inscrição, dados por etapa, cobrança, documentos e contrato passam
//    pelas mesmas rotas que a pessoa usaria no navegador — com as validações,
//    a retomada por CPF, a deduplicação e os efeitos (funil, notificação,
//    ERP) que já existem lá. O chat é só outra tela do portal.
//
// 2. CONTEXTO antes de pergunta. O que o sistema já sabe do contato — campos
//    personalizados (com rótulo), etiquetas, anotações da equipe, negociações,
//    inscrições e a etapa de cada uma, etapa do funil, origem/anúncio e anexos
//    recebidos — entra no prompt, para a IA não perguntar de novo o que o
//    contato já disse aqui ou em outro canal, nem refazer o que o time já fez.
//
// Simulação (`dryRun`): o simulador do painel lê tudo de verdade, mas não
// escreve nada — nem inscrição, nem cobrança (a conexão Asaas pode ser de
// PRODUÇÃO), nem documento. Responde como o portal responderia, marcado como
// simulação.

import type { FastifyInstance } from 'fastify'
import { readFile } from 'fs/promises'
import { join, extname } from 'path'
import crypto from 'crypto'
import { prisma } from '../../lib/prisma.js'
import { signCandidateToken } from '../../lib/candidateAuth.js'
import { isValidCpf, normalizeCpf } from '../../lib/cpf.js'
import { lerTabelaDePrecos, resumoDaTabela } from '../tabelaDePrecos.js'
import { lerJornada, etapasDaInscricao, bloqueioDaEtapa, bloqueioDoDocumento, ROTULO, CONCLUIR, type ChaveEtapa, type EtapaDaInscricao } from '../portalJornada.js'
import { dadosEfetivos, camposDaEtapa } from '../dadosCadastro.js'
import { descreverCondicao, campoCondicionalAtende } from '../docCondicional.js'

export interface EduState {
  /** Inscrição que esta conversa está conduzindo (criada aqui ou já existente). */
  registrationId?: number
  candidateCode?: string
  portalSlug?: string
  /** Mensagens (anexos) já vinculadas a um documento — não reenvia. */
  anexosUsados?: number[]
  /** Simulação: a inscrição "feita" no preview. */
  simulada?: { offeringId: number; portalSlug: string; dados: Record<string, string>; pagamento?: string }
}

export interface EduCtx {
  app: FastifyInstance
  leadId: number | null
  /** Estado da jornada; o sub-estado educacional mora em `state.edu`. */
  state: { edu?: EduState; answers: Record<string, any> }
  dryRun: boolean
}

export function eduSdrLigado(form: any): boolean {
  return !!form?.settings?.eduSdr?.enabled
}

const brl = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const limpar = (s: unknown, max = 600) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ── Chamada interna às rotas do portal ─────────────────────────────────────
// O cabeçalho marca a origem: a rota pública do portal não conta visualização
// para estas leituras (senão cada mensagem do chat inflaria o analytics).
async function portalHttp(
  app: FastifyInstance, method: 'GET' | 'POST', url: string,
  opts: { payload?: any; token?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const r = await app.inject({
    method, url,
    ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
    headers: {
      'x-attrae-interno': 'chatbot',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
  })
  let body: any = null
  try { body = r.json() } catch { body = r.body }
  return { status: r.statusCode, body }
}

// ── Catálogo do portal (cache curto) ───────────────────────────────────────

interface OfertaDoPortal {
  offeringId: number
  portalSlug: string
  portalNome: string
  curso: string
  courseId: number | null
  nivel: string | null
  modalidade: string | null
  turno: string | null
  slug: string | null
  polos: Array<{ id: number; nome: string; cidade?: string | null; estado?: string | null }>
  preco: string | null
  tabela: ReturnType<typeof lerTabelaDePrecos>
  valorMensalidade: number | null
  valorMatricula: number | null
  processo: { id: number; nome: string; taxaInscricao: number | null } | null
  ingresso: { code: string; name: string; evaluationType: string } | null
  /** Campos que a forma de ingresso acrescenta à inscrição (ENEM: nº e ano da
   *  prova; transferência: IES e curso de origem...) — o portal os mostra no
   *  formulário quando a oferta é escolhida, então o chat também pede. */
  camposDoIngresso: Array<{ name: string; label: string; required: boolean; type: string }>
  inicioCurso: string | null
}

interface PortalInfo {
  slug: string
  nome: string
  requirePayment: boolean
  paymentMethodsConfig: any
  jornadaEtapas: unknown
  camposInscricao: Array<{ name: string; label: string; required: boolean; type: string; options?: string[]; perguntarSo?: string; quando?: unknown }>
}

let cache: { em: number; ofertas: OfertaDoPortal[]; portais: Map<string, PortalInfo> } | null = null
const CACHE_MS = 60_000

async function catalogo(app: FastifyInstance): Promise<{ ofertas: OfertaDoPortal[]; portais: Map<string, PortalInfo> }> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache
  const lista = await prisma.enrollmentPortal.findMany({
    where: { active: true, formMode: { not: 'interest' } },
    select: { slug: true, nome: true, requirePayment: true, paymentMethodsConfig: true, jornadaEtapas: true },
    orderBy: { id: 'asc' },
  })
  const ofertas: OfertaDoPortal[] = []
  const portais = new Map<string, PortalInfo>()
  for (const p of lista) {
    const r = await portalHttp(app, 'GET', `/api/public/portals/${encodeURIComponent(p.slug)}`).catch(() => null)
    if (!r || r.status !== 200 || !r.body?.portal) continue
    const steps: any[] = Array.isArray(r.body.portal.formConfig?.steps) ? r.body.portal.formConfig.steps : []
    const campos = steps.flatMap((s: any) => (Array.isArray(s?.fields) ? s.fields : []))
      .filter((f: any) => f?.name && f.type !== 'offering-picker' && !String(f.type || '').startsWith('info'))
      .map((f: any) => ({
        name: String(f.name), label: limpar(f.label || f.name, 120), required: !!f.required, type: String(f.type || 'text'),
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options.map((o: any) => limpar(o?.label ?? o, 80)) } : {}),
        // Pergunta que depende de outra resposta (ex.: tipo de deficiência só se "Sim").
        ...(f.visibleWhen?.field?.name ? { perguntarSo: `se "${f.visibleWhen.field.name}" for ${(f.visibleWhen.field.values ?? []).join(' ou ')}`, quando: f.visibleWhen } : {}),
      }))
    portais.set(p.slug, {
      slug: p.slug, nome: p.nome, requirePayment: p.requirePayment,
      paymentMethodsConfig: p.paymentMethodsConfig, jornadaEtapas: p.jornadaEtapas, camposInscricao: campos,
    })
    for (const o of (r.body.offerings || []) as any[]) {
      const tabela = lerTabelaDePrecos(o.tabelaPrecos)
      ofertas.push({
        offeringId: o.id, portalSlug: p.slug, portalNome: p.nome,
        curso: o.course?.nome || o.nome, courseId: o.course?.id ?? null,
        nivel: o.level?.nome ?? null, modalidade: o.modality?.nome ?? null, turno: o.turno ?? null, slug: o.slug ?? null,
        polos: (o.campuses || []).map((c: any) => ({ id: c.campus?.id, nome: c.campus?.nome, cidade: c.campus?.cidade, estado: c.campus?.estado })).filter((c: any) => c.id),
        preco: tabela ? resumoDaTabela(tabela) : null, tabela,
        valorMensalidade: o.valorMensalidade != null ? Number(o.valorMensalidade) : null,
        valorMatricula: o.valorMatricula != null ? Number(o.valorMatricula) : null,
        processo: o.selectionProcess ? { id: o.selectionProcess.id, nome: o.selectionProcess.nome, taxaInscricao: o.selectionProcess.taxaInscricao != null ? Number(o.selectionProcess.taxaInscricao) : null } : null,
        ingresso: o.selectionProcess?.entryMode ? { code: o.selectionProcess.entryMode.code, name: o.selectionProcess.entryMode.name, evaluationType: o.selectionProcess.entryMode.evaluationType } : null,
        camposDoIngresso: (Array.isArray(o.selectionProcess?.entryMode?.defaultFormExtras) ? o.selectionProcess.entryMode.defaultFormExtras : [])
          // Campo "documento" é arquivo: no chat ele entra como documento da
          // inscrição (anexar_documento), não como dado digitado.
          .filter((f: any) => f?.name && f.type !== 'document')
          .map((f: any) => ({ name: String(f.name), label: limpar(f.label || f.name, 120), required: !!f.required, type: String(f.type || 'text') })),
        inicioCurso: o.inicioCurso ? new Date(o.inicioCurso).toLocaleDateString('pt-BR') : null,
      })
    }
  }
  cache = { em: Date.now(), ofertas, portais }
  return cache
}

function linkDoCurso(o: OfertaDoPortal): string {
  return o.slug ? `${appUrl()}/portal/${o.portalSlug}/${o.slug}` : `${appUrl()}/portal/${o.portalSlug}`
}

function precoSemTabela(o: OfertaDoPortal): string | null {
  const partes: string[] = []
  if (o.valorMatricula) partes.push(`matrícula ${brl(o.valorMatricula)}`)
  if (o.valorMensalidade) partes.push(`mensalidade ${brl(o.valorMensalidade)}`)
  return partes.length ? partes.join(' · ') : null
}

/** Meios de pagamento ligados no portal (o que a tela de pagamento oferece). */
function meiosDoPortal(p: PortalInfo | undefined): string[] {
  const cfg = (p?.paymentMethodsConfig || {}) as any
  const out: string[] = []
  if (cfg.pix?.ativo !== false) out.push('Pix')
  if (cfg.boleto?.ativo !== false) out.push('boleto')
  if (cfg.cartao?.ativo !== false) out.push('cartão de crédito')
  return out
}

/** Etapas da matrícula NA ORDEM do portal, só as que se aplicam a esta oferta. */
async function etapasDoPortal(p: PortalInfo, o: OfertaDoPortal, temDocs: boolean): Promise<string[]> {
  const cfg = lerJornada(p.jornadaEtapas)
  const dados = await dadosEfetivos({ jornadaEtapas: p.jornadaEtapas }).catch(() => null)
  const out: string[] = ['Inscrição (dados pessoais + escolha do curso)']
  for (const e of cfg.inscricao) {
    if (!e.ativo) continue
    if (e.chave === 'cadastro' && !(dados && camposDaEtapa(dados, 'cadastro').length)) continue
    if (e.chave === 'pagamento' && !p.requirePayment) continue
    if (e.chave === 'documentos' && !temDocs) continue
    if (e.chave === 'prova' && o.ingresso?.evaluationType !== 'exam_online') continue
    if (e.chave === 'analise') {
      if (!e.documentos?.length) continue
      // Só para as formas de ingresso escolhidas (vazio = todas).
      if (e.ingressos?.length) {
        const modos = await prisma.entryMode.findMany({ where: { id: { in: e.ingressos } }, select: { code: true } }).catch(() => [])
        if (!o.ingresso || !modos.some((m) => m.code === o.ingresso!.code)) continue
      }
      const tipos = await prisma.documentType.findMany({ where: { code: { in: e.documentos } }, select: { name: true } }).catch(() => [])
      out.push(`${ROTULO.analise} (TRAVA: envia ${tipos.map((t) => t.name).join(' e ') || 'os documentos da análise'}; a instituição emite o parecer — período de ingresso e aproveitamento — e só segue se o candidato aceitar; indeferida = pode trocar de forma de ingresso)`)
      continue
    }
    // Trava restrita a formas de ingresso: só conta se a desta oferta estiver na lista.
    let trava = !!e.trava
    if (trava && e.travaIngressos?.length) {
      const modos = await prisma.entryMode.findMany({ where: { id: { in: e.travaIngressos } }, select: { code: true } }).catch(() => [])
      trava = !!o.ingresso && modos.some((m) => m.code === o.ingresso!.code)
    }
    const concluir = e.chave === 'documentos' && e.liberaNoEnvio ? 'todos os documentos obrigatórios enviados' : CONCLUIR[e.chave as ChaveEtapa]
    out.push(`${ROTULO[e.chave as ChaveEtapa]}${e.obrigatoria ? ' (obrigatória na inscrição)' : ''}${trava ? ` (TRAVA: as etapas seguintes só liberam depois de ${concluir})` : ''}`)
  }
  return out
}

async function documentosDaOferta(processoId: number | null | undefined) {
  if (!processoId) return []
  const sp = await prisma.selectionProcess.findUnique({
    where: { id: processoId },
    select: {
      useCustomDocuments: true,
      documentRequirements: { orderBy: { ordem: 'asc' }, select: { required: true, helpText: true, condicao: true, documentType: { select: { code: true, name: true } } } },
      entryMode: { select: { description: true, documentRequirements: { orderBy: { ordem: 'asc' }, select: { required: true, helpText: true, condicao: true, documentType: { select: { code: true, name: true } } } } } },
    },
  }).catch(() => null)
  if (!sp) return []
  const lista = sp.useCustomDocuments && sp.documentRequirements.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? [])
  return lista.map((d) => {
    // Documento condicional (ex.: laudo só de quem declarou deficiência): o
    // chat não sabe a resposta antes da inscrição, então diz quando vale.
    const quando = descreverCondicao(d.condicao)
    return { tipo: d.documentType.code, nome: d.documentType.name, obrigatorio: d.required, ...(quando ? { exigidoApenas: quando } : {}), ...(d.helpText ? { observacao: limpar(d.helpText, 200) } : {}) }
  })
}

/** Resumo para o prompt: níveis → cursos. Só nomes (os detalhes vêm por ferramenta). */
export async function resumoDoCatalogo(app: FastifyInstance): Promise<string> {
  const { ofertas } = await catalogo(app).catch(() => ({ ofertas: [] as OfertaDoPortal[] }))
  if (!ofertas.length) return ''
  // O mesmo curso pode ter uma oferta por forma de ingresso (graduação:
  // vestibular, ENEM, segunda graduação, transferência) — aparece UMA vez, com
  // as formas juntas, senão a IA lê "quatro cursos de Teologia".
  const porNivel = new Map<string, Map<string, Set<string>>>()
  for (const o of ofertas) {
    const k = o.nivel || 'Outros'
    if (!porNivel.has(k)) porNivel.set(k, new Map())
    const nome = `${o.curso}${o.modalidade ? ` (${o.modalidade})` : ''}`
    const cursos = porNivel.get(k)!
    if (!cursos.has(nome)) cursos.set(nome, new Set())
    if (o.ingresso) cursos.get(nome)!.add(o.ingresso.name)
  }
  return [...porNivel.entries()].map(([n, cs]) => `- ${n}: ${[...cs.entries()].map(([c, ing]) => ing.size > 1 ? `${c} — ingresso por: ${[...ing].join(', ')}` : c).join('; ')}`).join('\n')
}

// ── Contexto do contato ────────────────────────────────────────────────────

const ORIGEM_LEGIVEL: Record<string, string> = {
  meta_ctwa: 'anúncio do Instagram/Facebook que abre o WhatsApp', meta_lead_ads: 'formulário de anúncio no Facebook/Instagram',
  google_ads: 'anúncio no Google', web_form: 'formulário do site', web_chat: 'chat do site', organic: 'site (orgânico)',
  enrollment_portal: 'portal de matrículas', instagram: 'Instagram direto', trackable_link: 'link rastreável',
}

export async function contextoDoLead(leadId: number | null): Promise<string> {
  if (!leadId) return ''
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      nome: true, email: true, whatsapp: true, cidade: true, customFields: true, status: true, funnelId: true,
      originType: true, source: true, campaignName: true, adName: true, utmCampaign: true, annotation: true, createdAt: true,
      assignedUser: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
      notes: { orderBy: { createdAt: 'desc' }, take: 8, select: { content: true, userName: true, createdAt: true } },
    },
  }).catch(() => null)
  if (!lead) return ''
  const linhas: string[] = []

  const dados = [
    lead.nome && !/^(lead( lp)?|webchat)$/i.test(lead.nome.trim()) ? `nome: ${lead.nome}` : '',
    lead.email ? `e-mail: ${lead.email}` : '',
    lead.whatsapp && !lead.whatsapp.startsWith('webchat:') ? `WhatsApp: ${lead.whatsapp}` : '',
    lead.cidade ? `cidade: ${lead.cidade}` : '',
  ].filter(Boolean)
  if (dados.length) linhas.push(`Cadastro: ${dados.join(' · ')}`)

  const origem = [
    lead.originType && ORIGEM_LEGIVEL[lead.originType] ? `chegou por ${ORIGEM_LEGIVEL[lead.originType]}` : (lead.source ? `origem: ${lead.source}` : ''),
    lead.campaignName ? `campanha "${lead.campaignName}"` : '',
    lead.adName ? `anúncio "${lead.adName}"` : '',
    !lead.campaignName && lead.utmCampaign ? `campanha "${lead.utmCampaign}"` : '',
  ].filter(Boolean)
  if (origem.length) linhas.push(`Origem: ${origem.join(' · ')} (cadastrado em ${lead.createdAt.toLocaleDateString('pt-BR')})`)

  if (lead.funnelId) {
    const etapa = await prisma.stage.findFirst({ where: { funnelId: lead.funnelId, key: lead.status }, select: { name: true, funnel: { select: { name: true } } } }).catch(() => null)
    if (etapa) linhas.push(`Funil: ${etapa.funnel?.name ?? ''} › etapa "${etapa.name}"`)
  }
  if (lead.assignedUser?.name) linhas.push(`Consultor(a) responsável: ${lead.assignedUser.name}`)
  if (lead.tags.length) linhas.push(`Etiquetas: ${lead.tags.map((t) => t.tag.name).join(', ')}`)
  if (lead.annotation) linhas.push(`Anotação fixa: ${limpar(lead.annotation, 400)}`)

  // Campos personalizados com o RÓTULO cadastrado (a chave crua não diz nada à
  // IA — "voce_ja_tem_2_anos_de_experiencia..." é a pergunta de um formulário).
  const cf = (lead.customFields && typeof lead.customFields === 'object') ? lead.customFields as Record<string, unknown> : {}
  const preenchidos = Object.entries(cf).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '[]')
  if (preenchidos.length) {
    const defs = await prisma.customField.findMany({ where: { key: { in: preenchidos.map(([k]) => k) } }, select: { key: true, label: true } }).catch(() => [] as Array<{ key: string; label: string }>)
    const rotulo = new Map(defs.map((d) => [d.key, d.label]))
    // Rastreamento técnico (utm, gclid...) não é assunto de conversa.
    const tecnico = /^(utm_|gclid|fbclid|ga_client_id|referrer|url_origem)/
    const itens = preenchidos.filter(([k]) => !tecnico.test(k))
      .map(([k, v]) => `- ${limpar(rotulo.get(k) || k, 140)}: ${limpar(Array.isArray(v) ? v.join(', ') : v, 300)}`)
    if (itens.length) linhas.push(`Campos personalizados já preenchidos:\n${itens.join('\n')}`)
  }

  if (lead.notes.length) {
    linhas.push(`Anotações da equipe (mais recentes primeiro):\n${lead.notes.map((n) => `- ${n.createdAt.toLocaleDateString('pt-BR')}${n.userName ? ` (${n.userName})` : ''}: ${limpar(n.content, 400)}`).join('\n')}`)
  }

  const negs = await prisma.negotiation.findMany({
    where: { leadId }, orderBy: { id: 'desc' }, take: 4,
    select: { titulo: true, status: true, valorFinal: true, pagamentoForma: true, parcelas: true, condicaoPagamento: true, observacoes: true },
  }).catch(() => [] as any[])
  if (negs.length) {
    linhas.push(`Negociações:\n${negs.map((n: any) => `- ${n.titulo} — ${n.status}${n.valorFinal != null ? `, ${brl(Number(n.valorFinal))}` : ''}${n.pagamentoForma ? `, ${n.pagamentoForma}${n.parcelas ? ` ${n.parcelas}x` : ''}` : ''}${n.condicaoPagamento ? ` (${limpar(n.condicaoPagamento, 120)})` : ''}${n.observacoes ? ` — obs: ${limpar(n.observacoes, 160)}` : ''}`).join('\n')}`)
  }

  const regs = await prisma.enrollmentRegistration.findMany({
    where: { leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 3,
    select: { id: true, candidateCode: true, status: true, createdAt: true, paymentStatus: true, processRegistration: { select: { offering: { select: { nome: true } } } } },
  }).catch(() => [] as any[])
  for (const r of regs) {
    const et = await etapasDaInscricao(r.id, 'inscricao').catch(() => null)
    const etapas = et?.etapas.map((e) => `${e.titulo}: ${situacaoTxt(e)} (${e.bloqueada ? e.bloqueada.motivo : e.detalhe})${e.trava ? ' [trava as seguintes]' : ''}`).join('; ')
    linhas.push(`Inscrição ${r.candidateCode} — ${r.processRegistration?.offering?.nome ?? 'curso não escolhido'}, criada em ${r.createdAt.toLocaleDateString('pt-BR')}, situação "${r.status}"${etapas ? `. Etapas: ${etapas}` : ''}`)
  }

  const internas = await prisma.message.findMany({
    where: { leadId, isInternal: true }, orderBy: { id: 'desc' }, take: 4, select: { body: true, timestamp: true },
  }).catch(() => [] as any[])
  if (internas.length) linhas.push(`Registros internos na conversa:\n${internas.map((m: any) => `- ${limpar(m.body, 300)}`).join('\n')}`)

  const anexos = await anexosRecentes(leadId)
  if (anexos.length) linhas.push(`Arquivos que o contato enviou no chat (últimos 7 dias):\n${anexos.map((a) => `- id ${a.id}: ${a.nome} (${a.tipo}, ${a.quando})`).join('\n')}`)

  return linhas.join('\n')
}

async function anexosRecentes(leadId: number) {
  const rows = await prisma.message.findMany({
    where: { leadId, fromMe: false, mediaType: { in: ['document', 'image'] }, mediaUrl: { not: null }, timestamp: { gte: new Date(Date.now() - 7 * 86400_000) } },
    orderBy: { id: 'desc' }, take: 10, select: { id: true, mediaType: true, mediaName: true, mediaUrl: true, body: true, timestamp: true },
  }).catch(() => [] as any[])
  return rows.map((m: any) => ({
    id: m.id as number, tipo: m.mediaType as string, url: m.mediaUrl as string,
    nome: m.mediaName || (m.body && !/^\[/.test(m.body) ? limpar(m.body, 60) : (m.mediaType === 'image' ? 'foto' : 'arquivo')),
    quando: new Date(m.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  }))
}

// ── Ferramentas ─────────────────────────────────────────────────────────────

export const EDU_TOOLS = [
  {
    name: 'consultar_cursos',
    description: 'Lista os cursos que a instituição oferece AGORA no portal de matrículas (fonte da verdade): curso, nível, modalidade, turno, polos e preço por meio de pagamento. Use quando o lead perguntar o que existe, citar um curso (para achar o offeringId certo) ou pedir preço. Busca tolerante a acento.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Parte do nome do curso, nas palavras do lead (ex.: "eletro", "enfermagem"). Opcional.' },
        nivel: { type: 'string', description: 'Nível (ex.: Técnico, Pós-graduação, Especialização Técnica, Profissionalizante, Treinamento). Opcional.' },
      },
      required: [],
    },
  },
  {
    name: 'detalhes_do_curso',
    description: 'Ficha completa de UMA oferta: descrição, carga horária, duração, perfil de conclusão, modalidade, polos, preço por meio, meios de pagamento aceitos, forma de ingresso, documentos exigidos e as ETAPAS da matrícula na ordem do portal. Chame antes de responder dúvidas específicas ou de iniciar a matrícula.',
    input_schema: { type: 'object', properties: { offeringId: { type: 'number' } }, required: ['offeringId'] },
  },
  {
    name: 'situacao_da_matricula',
    description: 'Inscrições que este contato já tem (feitas aqui, no site ou pela equipe) e a situação de cada etapa (pagamento, documentos, contrato...). Chame quando o lead falar de inscrição/pagamento/documento já feitos, ou antes de iniciar uma inscrição nova — para CONTINUAR a existente em vez de recomeçar.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'fazer_inscricao',
    description: 'Faz a inscrição no portal do curso escolhido (mesma regra do formulário do portal). Só chame depois de: curso definido (offeringId), intenção de matrícula CONFIRMADA pelo lead, todos os campos de inscrição que o portal exige (veja detalhes_do_curso › dados_da_inscricao) e o ACEITE explícito da política de privacidade. Se o CPF já tiver inscrição, o portal retoma a existente.',
    input_schema: {
      type: 'object',
      properties: {
        offeringId: { type: 'number' },
        nome: { type: 'string', description: 'Nome completo.' },
        email: { type: 'string' },
        cpf: { type: 'string' },
        whatsapp: { type: 'string', description: 'Só no chat do site (no WhatsApp o número já é conhecido).' },
        campusId: { type: 'number', description: 'Polo escolhido, só quando a oferta tiver mais de um.' },
        aceite_privacidade: { type: 'boolean', description: 'true SOMENTE se o lead aceitou a política de privacidade nesta conversa.' },
        outros: { type: 'array', description: 'Demais campos exigidos pelo portal na inscrição (chave = name do campo).', items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' } }, required: ['chave', 'valor'] } },
      },
      required: ['offeringId', 'nome', 'cpf', 'aceite_privacidade'],
    },
  },
  {
    name: 'dados_da_etapa',
    description: 'Dados que o portal pede numa etapa da matrícula (cadastro, documentos, contrato ou pagamento), com o que já está preenchido e o que falta. Chame ao chegar numa etapa.',
    input_schema: { type: 'object', properties: { etapa: { type: 'string', enum: ['cadastro', 'documentos', 'contrato', 'pagamento'] } }, required: ['etapa'] },
  },
  {
    name: 'salvar_dados_da_etapa',
    description: 'Grava na inscrição os dados de uma etapa (mesma validação do portal). Use as chaves (name) devolvidas por dados_da_etapa.',
    input_schema: {
      type: 'object',
      properties: {
        etapa: { type: 'string', enum: ['cadastro', 'documentos', 'contrato', 'pagamento'] },
        valores: { type: 'array', items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' } }, required: ['chave', 'valor'] } },
      },
      required: ['etapa', 'valores'],
    },
  },
  {
    name: 'opcoes_de_pagamento',
    description: 'Valores e condições EXATOS que o checkout desta inscrição cobra em cada meio (Pix, boleto, cartão), com cupom opcional. Use antes de gerar a cobrança.',
    input_schema: { type: 'object', properties: { cupom: { type: 'string' } }, required: [] },
  },
  {
    name: 'gerar_pagamento',
    description: 'Gera a cobrança da inscrição. Pix devolve o código copia-e-cola; boleto devolve a linha digitável e o PDF; cartão devolve o link seguro do portal (o cartão é digitado lá, nunca no chat). Só chame depois que o lead escolher o meio (e as parcelas, se houver).',
    input_schema: {
      type: 'object',
      properties: {
        metodo: { type: 'string', enum: ['pix', 'boleto', 'cartao'] },
        parcelas: { type: 'number', description: 'Boleto parcelado: exatamente as parcelas da tabela. Opcional.' },
        cupom: { type: 'string' },
      },
      required: ['metodo'],
    },
  },
  {
    name: 'anexar_documento',
    description: 'Vincula à inscrição um arquivo que o lead mandou no chat (veja "Arquivos que o contato enviou"). Informe o tipo (código do documento exigido) e o id do arquivo; sem id, usa o arquivo mais recente ainda não usado. NUNCA peça para o lead digitar dados de documento no lugar do arquivo.',
    input_schema: {
      type: 'object',
      properties: { tipo: { type: 'string', description: 'Código do documento (ex.: rg, cpf, comprovante_residencia).' }, arquivoId: { type: 'number' } },
      required: ['tipo'],
    },
  },
  {
    name: 'assinar_contrato',
    description: 'Prepara a assinatura do contrato da inscrição e devolve o link para o lead ler e assinar (eletrônica) — ou o link do portal quando a assinatura é pelo aceite na página.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'responder_parecer',
    description: 'Registra a resposta do candidato ao PARECER da análise acadêmica (ex.: transferência: período de ingresso e disciplinas aproveitadas). Só chame depois de apresentar o parecer completo (período, aproveitamento, observações) e ele CONFIRMAR com clareza que concorda e quer continuar ("aceito") ou que NÃO quer continuar ("desistiu" — encerra a inscrição). Na dúvida, pergunte de novo; nunca decida por ele.',
    input_schema: {
      type: 'object',
      properties: { decisao: { type: 'string', enum: ['aceito', 'desistiu'] } },
      required: ['decisao'],
    },
  },
  {
    name: 'link_do_portal',
    description: 'Gera o link de acesso (uso único, 48h) à área do candidato no portal, onde ele acompanha a inscrição, paga com cartão, envia documentos pelo celular e assina o contrato. Use quando algo precisar ser feito na tela.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'pre_inscricao_curso_indisponivel',
    description: 'Pré-inscrição de quem quer um curso que NÃO existe no portal: grava no contato o curso pedido, a etiqueta "Curso fora do portfólio" e uma anotação para a equipe (o que as suas instruções mandarem anotar vai em observacao). Chame uma vez por curso, só depois de confirmar o nome do curso com o lead.',
    input_schema: {
      type: 'object',
      properties: {
        curso: { type: 'string', description: 'Curso que o lead pediu, nas palavras dele (ex.: "Técnico em Radiologia").' },
        nome: { type: 'string', description: 'Nome completo, se o lead informou.' },
        email: { type: 'string', description: 'E-mail, se o lead informou.' },
        observacao: { type: 'string', description: 'Anotação para a equipe: o que as suas instruções pedirem + contexto útil (objetivo, urgência, cidade). Opcional.' },
      },
      required: ['curso'],
    },
  },
  {
    name: 'registrar_anotacao',
    description: 'Grava uma anotação no atendimento, visível para a equipe. Texto curto e objetivo.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
]
export const EDU_TOOL_NAMES = new Set(EDU_TOOLS.map((t) => t.name))

const ok = (o: Record<string, unknown>) => JSON.stringify({ ok: true, ...o })
const erro = (msg: string, instrucao?: string) => JSON.stringify({ ok: false, erro: msg, ...(instrucao ? { instrucao } : {}) })

/** Inscrição em foco: a desta conversa, ou a mais recente do contato. */
async function inscricaoAtual(ctx: EduCtx): Promise<{ id: number; candidateCode: string; portalSlug: string; leadId: number | null } | null> {
  const edu = (ctx.state.edu ||= {})
  if (edu.registrationId) {
    const r = await prisma.enrollmentRegistration.findUnique({ where: { id: edu.registrationId }, select: { id: true, candidateCode: true, status: true, leadId: true, portal: { select: { slug: true } } } }).catch(() => null)
    if (r && r.status !== 'merged') return { id: r.id, candidateCode: r.candidateCode, portalSlug: r.portal.slug, leadId: r.leadId }
  }
  if (!ctx.leadId) return null
  const r = await prisma.enrollmentRegistration.findFirst({
    where: { leadId: ctx.leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' },
    select: { id: true, candidateCode: true, leadId: true, portal: { select: { slug: true } } },
  }).catch(() => null)
  if (!r) return null
  edu.registrationId = r.id; edu.candidateCode = r.candidateCode; edu.portalSlug = r.portal.slug
  return { id: r.id, candidateCode: r.candidateCode, portalSlug: r.portal.slug, leadId: r.leadId }
}

const SEM_INSCRICAO = 'Ainda não há inscrição deste contato. Primeiro conclua a inscrição (fazer_inscricao).'

// Trava de etapa (Portal › Etapas): a etapa seguinte só libera quando a travada
// estiver concluída. O servidor recusa de qualquer jeito; aqui o bot fica
// sabendo antes e conduz a etapa que segura a fila.
const INSTRUCAO_TRAVA = 'Esta etapa ainda está TRAVADA pela etapa indicada. Não ofereça nem tente fazê-la agora: explique em uma frase o que precisa ser concluído antes e conduza essa etapa. Se ela depende da equipe (documentos em análise, redação em correção), diga que a equipe está analisando e que você avisa/ele recebe a confirmação assim que liberar.'
const situacaoTxt = (e: EtapaDaInscricao) =>
  e.bloqueada ? 'travada' : e.situacao === 'feito' ? 'feito' : e.situacao === 'aguardando' ? 'em análise' : 'pendente'
const etapaParaBot = (e: EtapaDaInscricao) => ({
  etapa: e.titulo, chave: e.chave, situacao: situacaoTxt(e), detalhe: e.detalhe,
  ...(e.trava ? { trava: `as seguintes só liberam depois de ${CONCLUIR[e.chave]}` } : {}),
  ...(e.bloqueada ? { travadaPor: e.bloqueada.titulo, motivo: e.bloqueada.motivo } : {}),
  ...(e.analise ? {
    documentosDaAnalise: e.analise.documentos.map((d) => ({ tipo: d.code, nome: d.nome, situacao: d.status === 'faltando' ? 'falta enviar' : d.status === 'pending' ? 'em análise' : d.status === 'approved' ? 'aprovado' : `recusado: ${d.reviewNote ?? ''}` })),
    parecer: e.analise.parecer ? {
      resultado: e.analise.parecer.resultado, periodo: e.analise.parecer.periodo, aproveitamento: e.analise.parecer.aproveitamento,
      observacao: e.analise.parecer.observacao, respostaDoCandidato: e.analise.parecer.aceite?.decisao ?? 'aguardando',
    } : 'ainda em análise pela instituição',
  } : {}),
})

export async function executarFerramentaEdu(name: string, input: any, ctx: EduCtx): Promise<string> {
  const { app } = ctx
  const edu = (ctx.state.edu ||= {})
  try {
    if (name === 'consultar_cursos') {
      const { ofertas } = await catalogo(app)
      const busca = semAcento(String(input?.busca || '').trim())
      const nivel = semAcento(String(input?.nivel || '').trim())
      const palavras = busca.split(/\s+/).filter((w) => w.length >= 3 && !['curso', 'tecnico', 'em', 'de'].includes(w))
      let lista = ofertas.filter((o) => !nivel || semAcento(o.nivel || '').includes(nivel))
      if (palavras.length) {
        // Quem casa mais palavras vem primeiro: "pós em teologia arminiana" tem de
        // trazer a pós antes da extensão de mesmo tema.
        const pontos = (o: OfertaDoPortal) => palavras.filter((w) => semAcento(`${o.curso} ${o.nivel || ''}`).includes(w)).length
        lista = lista.filter((o) => pontos(o) > 0).sort((a, b) => pontos(b) - pontos(a))
      }
      const cursos = lista.slice(0, 15).map((o) => ({
        offeringId: o.offeringId, curso: o.curso, nivel: o.nivel, modalidade: o.modalidade, turno: o.turno || undefined,
        formaDeIngresso: o.ingresso?.name,
        inicio: o.inicioCurso || undefined,
        polos: o.polos.length > 1 ? o.polos.map((p) => p.nome) : undefined,
        preco: o.preco || precoSemTabela(o) || 'sem preço cadastrado no portal',
      }))
      const variasFormas = new Set(cursos.filter((c) => c.formaDeIngresso).map((c) => `${c.curso}|${c.formaDeIngresso}`)).size > new Set(cursos.map((c) => c.curso)).size
      return ok({
        total: cursos.length, cursos,
        instrucao: cursos.length
          ? `Cite SOMENTE cursos desta lista, com nome e preço exatos. Se houver mais de um parecido (mesmo tema em níveis diferentes, ou nomes próximos), confirme qual o lead quer — nunca assuma.${variasFormas ? ' O MESMO curso aparece com formas de ingresso diferentes (uma oferta para cada): o offeringId certo depende de como a pessoa vai ingressar — descubra pela conversa (já tem graduação? vem de outra faculdade? fez ENEM?) antes de inscrever.' : ''}`
          : 'Nenhum curso com esse nome no portal. Confirme o nome com o lead (pode ser outro nome para um curso que existe — busque de novo por outra palavra). Se de fato não oferecemos, diga com clareza e siga as suas instruções para curso não oferecido (se pedirem pré-inscrição, use pre_inscricao_curso_indisponivel). Sem instrução: ofereça só alternativas reais e relacionadas (consultar_cursos pelo nível), explicando a diferença.',
      })
    }

    if (name === 'detalhes_do_curso') {
      const { ofertas, portais } = await catalogo(app)
      const o = ofertas.find((x) => x.offeringId === Number(input?.offeringId))
      if (!o) return erro('Oferta não encontrada no portal.', 'Chame consultar_cursos para achar o offeringId certo.')
      const p = portais.get(o.portalSlug)
      const curso = o.courseId ? await prisma.course.findUnique({
        where: { id: o.courseId },
        select: { descricao: true, cargaHoraria: true, duracaoMeses: true, perfilConclusao: true, eixoTecnologico: true, grau: true },
      }).catch(() => null) : null
      const docs = await documentosDaOferta(o.processo?.id)
      const sp = o.processo?.id
        ? await prisma.selectionProcess.findUnique({ where: { id: o.processo.id }, select: { inicioInscricao: true, terminoInscricao: true, entryMode: { select: { description: true } } } }).catch(() => null)
        : null
      const ingressoDesc = sp?.entryMode?.description
      const dia = (d: Date | null | undefined) => d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null
      const periodoDeInscricao = sp && (sp.inicioInscricao || sp.terminoInscricao)
        ? [dia(sp.inicioInscricao) && `de ${dia(sp.inicioInscricao)}`, dia(sp.terminoInscricao) && `até ${dia(sp.terminoInscricao)}`].filter(Boolean).join(' ')
          + (sp.inicioInscricao && sp.inicioInscricao > new Date() ? ' (AINDA NÃO ABERTAS — não dá para inscrever antes do início)' : '')
        : undefined
      const condicoes: string[] = []
      if (o.tabela) {
        condicoes.push(`À vista no Pix ou boleto: ${brl(o.tabela.aVista)}`)
        if (o.tabela.cartao) condicoes.push(`Cartão: ${o.tabela.cartao.parcelas}x de ${brl(o.tabela.cartao.valorParcela)} sem juros`)
        if (o.tabela.boleto && o.tabela.boleto.parcelas > 1) condicoes.push(`Boleto parcelado: ${o.tabela.boleto.parcelas}x de ${brl(o.tabela.boleto.valorParcela)}`)
      } else {
        const s = precoSemTabela(o)
        if (s) condicoes.push(s)
      }
      return ok({
        offeringId: o.offeringId, curso: o.curso, nivel: o.nivel, modalidade: o.modalidade, turno: o.turno || undefined,
        cargaHoraria: curso?.cargaHoraria ? `${curso.cargaHoraria} horas` : undefined,
        duracao: curso?.duracaoMeses ? `${curso.duracaoMeses} meses` : undefined,
        eixoTecnologico: curso?.eixoTecnologico || undefined,
        descricao: curso?.descricao ? limpar(curso.descricao, 900) : undefined,
        perfilDeConclusao: curso?.perfilConclusao ? limpar(curso.perfilConclusao, 700) : undefined,
        inicio: o.inicioCurso || undefined,
        polos: o.polos.map((x) => ({ id: x.id, nome: x.nome, cidade: x.cidade || undefined })),
        precos: condicoes.length ? condicoes : ['sem preço cadastrado no portal'],
        meiosDePagamentoAceitos: meiosDoPortal(p),
        taxaDeInscricao: o.processo?.taxaInscricao ? brl(o.processo.taxaInscricao) : undefined,
        formaDeIngresso: o.ingresso ? { nome: o.ingresso.name, descricao: ingressoDesc ? limpar(ingressoDesc, 300) : undefined } : undefined,
        processoSeletivo: o.processo?.nome,
        periodoDeInscricao,
        documentosExigidos: docs,
        etapasDaMatricula: p ? await etapasDoPortal(p, o, docs.length > 0) : [],
        dados_da_inscricao: [...(p?.camposInscricao ?? []).map(({ quando: _q, ...c }) => c), ...o.camposDoIngresso],
        linkDoCurso: linkDoCurso(o),
        instrucao: 'Use apenas o que for relevante para a dúvida atual — não despeje a ficha. O que NÃO estiver aqui você não sabe: diga que vai confirmar com a equipe.',
      })
    }

    if (name === 'situacao_da_matricula') {
      if (ctx.dryRun && edu.simulada) {
        return ok({
          simulacao: true,
          inscricoes: [{ codigo: 'SIMULACAO', offeringId: edu.simulada.offeringId, situacao: 'inscrição simulada no teste — nada foi gravado', pagamento: edu.simulada.pagamento ? `cobrança ${edu.simulada.pagamento} simulada` : 'ainda não gerado' }],
          instrucao: edu.simulada.pagamento ? 'SIMULAÇÃO: considere o pagamento confirmado para seguir testando as próximas etapas, na ordem.' : 'Siga para a próxima etapa pendente, na ordem.',
        })
      }
      if (!ctx.leadId) return ok({ inscricoes: [], instrucao: 'Nenhuma inscrição deste contato.' })
      const regs = await prisma.enrollmentRegistration.findMany({
        where: { leadId: ctx.leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 3,
        select: { id: true, candidateCode: true, status: true, paymentStatus: true, portal: { select: { slug: true, nome: true } }, processRegistration: { select: { offering: { select: { id: true, nome: true } } } } },
      })
      const out = []
      for (const r of regs) {
        const et = await etapasDaInscricao(r.id, 'inscricao').catch(() => null)
        out.push({
          codigo: r.candidateCode, portal: r.portal.nome, curso: r.processRegistration?.offering?.nome ?? null, offeringId: r.processRegistration?.offering?.id ?? null,
          situacao: r.status, etapas: (et?.etapas ?? []).map(etapaParaBot),
        })
      }
      if (regs[0]) { edu.registrationId = regs[0].id; edu.candidateCode = regs[0].candidateCode; edu.portalSlug = regs[0].portal.slug }
      return ok({ inscricoes: out, instrucao: out.length ? 'Continue a partir da PRIMEIRA etapa pendente, na ordem acima — ou na ordem de documentos que as suas instruções definirem. Não refaça o que já está feito. Etapa "travada" NÃO pode ser feita agora: conduza a etapa que a trava (travadaPor) até ser concluída; se essa depende da equipe (em análise), diga que está em análise e que a próxima etapa libera assim que for aprovada.' : 'Nenhuma inscrição deste contato.' })
    }

    if (name === 'fazer_inscricao') {
      const { ofertas, portais } = await catalogo(app)
      const o = ofertas.find((x) => x.offeringId === Number(input?.offeringId))
      if (!o) return erro('Oferta não encontrada no portal.', 'Chame consultar_cursos e confirme o curso com o lead.')
      if (input?.aceite_privacidade !== true) return erro('Falta o aceite da política de privacidade.', 'Peça ao lead, em uma frase, o aceite para usar os dados dele na inscrição, conforme a política de privacidade. Só prossiga com um "sim" claro.')
      const cpf = normalizeCpf(String(input?.cpf || ''))
      if (!isValidCpf(cpf)) return erro('CPF inválido.', 'Diga que o CPF não confere e peça para conferir os números.')
      const email = String(input?.email || '').trim()
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('E-mail inválido.', 'Peça para conferir o e-mail.')
      const lead = ctx.leadId ? await prisma.lead.findUnique({ where: { id: ctx.leadId }, select: { whatsapp: true, email: true } }) : null
      const whatsapp = lead?.whatsapp && !lead.whatsapp.startsWith('webchat:') ? lead.whatsapp : String(input?.whatsapp || '').trim()
      const formData: Record<string, any> = {
        nome: String(input?.nome || '').trim(), email: email || lead?.email || '', whatsapp, cpf,
        offeringId: o.offeringId, lgpdConsent: true,
        ...(input?.campusId ? { campusId: Number(input.campusId) } : {}),
      }
      for (const c of (Array.isArray(input?.outros) ? input.outros : [])) {
        // Campo já preenchido acima não é sobrescrito; vazio (ex.: WhatsApp no chat
        // do site, onde o número não é conhecido) recebe o que a pessoa informou.
        if (c?.chave && !String(formData[c.chave] ?? '').trim()) formData[String(c.chave)] = String(c.valor ?? '')
      }
      const p = portais.get(o.portalSlug)
      const faltando = [...(p?.camposInscricao ?? []), ...o.camposDoIngresso].filter((c) => c.required && campoCondicionalAtende((c as any).quando, formData) && !String(formData[c.name] ?? '').trim()).map((c) => c.label)
      if (!formData.email && !formData.whatsapp) faltando.push('E-mail')
      if (o.polos.length > 1 && !o.polos.some((x) => x.id === formData.campusId)) faltando.push(`Polo (${o.polos.map((x) => `${x.nome} = ${x.id}`).join(', ')})`)
      if (faltando.length) return erro(`Faltam dados da inscrição: ${faltando.join(', ')}.`, 'Peça só o que falta, um dado por vez, sem repetir o que já foi dito.')

      if (ctx.dryRun) {
        edu.simulada = { offeringId: o.offeringId, portalSlug: o.portalSlug, dados: Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, String(v)])) }
        const docs = await documentosDaOferta(o.processo?.id)
        return ok({ simulacao: true, codigo: 'SIMULACAO', curso: o.curso, proximasEtapas: p ? (await etapasDoPortal(p, o, docs.length > 0)).slice(1) : [], instrucao: 'Inscrição SIMULADA (teste — nada foi gravado). Siga para a próxima etapa, na ordem.' })
      }
      const r = await portalHttp(app, 'POST', `/api/public/portals/${encodeURIComponent(o.portalSlug)}/register`, {
        payload: { formData },
      })
      if (r.status !== 201 || !r.body?.ok) return erro(String(r.body?.error || `Falha na inscrição (${r.status}).`), 'Explique o problema ao lead com naturalidade; se não for algo que ele resolva, chame transferir_humano.')
      edu.registrationId = r.body.enrollmentId; edu.candidateCode = r.body.candidateCode; edu.portalSlug = o.portalSlug
      // A inscrição pode ter nascido (ou sido retomada) noutro lead — o do CPF.
      // A conversa segue com o lead deste chat; a inscrição fica ligada a ele.
      const et = await etapasDaInscricao(r.body.enrollmentId, 'inscricao').catch(() => null)
      return ok({
        codigo: r.body.candidateCode, curso: o.curso,
        proximasEtapas: (et?.etapas ?? []).filter((e) => e.situacao !== 'feito').map((e) => ({ ...etapaParaBot(e), obrigatoria: e.obrigatoria })),
        instrucao: 'Inscrição feita. Informe o código e conduza a PRÓXIMA etapa pendente, na ordem — uma de cada vez. Etapa "travada" só libera quando a que a trava estiver concluída.',
      })
    }

    if (name === 'dados_da_etapa') {
      const etapa = String(input?.etapa || 'cadastro')
      if (ctx.dryRun && edu.simulada) {
        const { portais } = await catalogo(app)
        const p = portais.get(edu.simulada.portalSlug)
        const cfg = p ? await dadosEfetivos({ jornadaEtapas: p.jornadaEtapas }).catch(() => null) : null
        const campos = cfg ? camposDaEtapa(cfg, etapa as any) : []
        return ok({ simulacao: true, etapa, campos, faltando: campos.filter((c) => c.required).map((c) => c.name), instrucao: campos.length ? 'Peça só os dados que faltam, um por vez.' : 'Esta etapa não pede dados — siga para a ação dela.' })
      }
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const r = await portalHttp(app, 'GET', `/api/public/registrations/${reg.candidateCode}/dados?etapa=${encodeURIComponent(etapa)}`, { token })
      if (r.status !== 200) return erro(String(r.body?.error || 'Falha ao ler os dados da etapa.'))
      return ok({ etapa, campos: r.body.campos, valores: r.body.valores, faltando: r.body.faltando, instrucao: (r.body.campos || []).length ? 'Peça só os dados que faltam, um por vez; os já preenchidos não se perguntam de novo.' : 'Esta etapa não pede dados — siga para a ação dela.' })
    }

    if (name === 'salvar_dados_da_etapa') {
      const etapa = String(input?.etapa || 'cadastro')
      const valores: Record<string, string> = {}
      for (const v of (Array.isArray(input?.valores) ? input.valores : [])) if (v?.chave) valores[String(v.chave)] = String(v.valor ?? '')
      if (ctx.dryRun && (edu.simulada || !ctx.leadId)) return ok({ simulacao: true, salvos: Object.keys(valores) })
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      if (ctx.dryRun) return ok({ simulacao: true, salvos: Object.keys(valores) })
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const r = await portalHttp(app, 'POST', `/api/public/registrations/${reg.candidateCode}/dados`, { token, payload: { etapa, valores } })
      if (r.body?.travada) return erro(String(r.body.error), INSTRUCAO_TRAVA)
      if (r.status !== 200) return erro(String(r.body?.error || 'Não foi possível salvar.'), 'Explique qual dado não passou e peça para corrigir.')
      return ok({ salvos: Object.keys(valores) })
    }

    if (name === 'opcoes_de_pagamento') {
      const cupom = String(input?.cupom || '').trim()
      if (ctx.dryRun && edu.simulada) {
        const { ofertas, portais } = await catalogo(app)
        const o = ofertas.find((x) => x.offeringId === edu.simulada!.offeringId)
        return ok({ simulacao: true, meios: meiosDoPortal(o ? portais.get(o.portalSlug) : undefined), precos: o?.preco || (o ? precoSemTabela(o) : null), cupom: cupom ? 'cupom não é validado na simulação' : undefined })
      }
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const r = await portalHttp(app, 'GET', `/api/public/registrations/${reg.candidateCode}/payment-options${cupom ? `?cupom=${encodeURIComponent(cupom)}` : ''}`, { token })
      if (r.status !== 200) return erro(String(r.body?.error || 'Não foi possível consultar as opções de pagamento.'))
      return ok({ ...r.body, instrucao: 'Apresente só os meios ativos, com valores exatos. Pergunte qual meio o lead prefere (e parcelas, quando houver).' })
    }

    if (name === 'gerar_pagamento') {
      const metodo = String(input?.metodo || '')
      if (!['pix', 'boleto', 'cartao'].includes(metodo)) return erro('Meio inválido.')
      if (ctx.dryRun) {
        if (edu.simulada) edu.simulada.pagamento = metodo
        return ok({ simulacao: true, metodo, instrucao: metodo === 'cartao'
          ? 'SIMULAÇÃO: no WhatsApp real o lead recebe o link seguro do portal para pagar com cartão. Diga isso.'
          : `SIMULAÇÃO: no WhatsApp real o lead recebe ${metodo === 'pix' ? 'o código Pix copia-e-cola' : 'a linha digitável e o PDF do boleto'}. Nenhuma cobrança foi gerada.` })
      }
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const travaPag = await bloqueioDaEtapa(reg.id, 'pagamento', 'inscricao').catch(() => null)
      if (travaPag) return erro(travaPag, INSTRUCAO_TRAVA)
      if (metodo === 'cartao') {
        const link = await linkDeAcesso(reg.leadId)
        return link
          ? ok({ link: link.url, validoAte: link.expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), instrucao: 'O cartão é digitado só no portal (ambiente seguro). Envie o link e diga que vale por 48h e para um único acesso. NUNCA peça número de cartão no chat.' })
          : erro('Não foi possível gerar o link do portal.', 'Chame transferir_humano.')
      }
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const body: any = { method: metodo }
      if (input?.parcelas) body.parcelas = Number(input.parcelas)
      if (input?.cupom) body.cupom = String(input.cupom)
      const r = await portalHttp(app, 'POST', `/api/public/registrations/${reg.candidateCode}/payment-init`, { token, payload: body })
      if (r.status !== 200 || !r.body?.ok) return erro(String(r.body?.error || 'Não foi possível gerar a cobrança.'), 'Explique com naturalidade; se persistir, chame transferir_humano.')
      const m = r.body.method || {}
      return ok({
        metodo, valor: brl(m.amount), vence: m.boletoDueAt ? new Date(m.boletoDueAt).toLocaleDateString('pt-BR') : (m.expiresAt ? new Date(m.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : undefined),
        pixCopiaECola: m.qrCode || undefined, boletoLinha: m.boletoLine || undefined, boletoPdf: m.boletoPdfUrl || undefined, paginaDePagamento: r.body.checkoutUrl || undefined,
        instrucao: metodo === 'pix'
          ? 'Envie o código Pix copia-e-cola SOZINHO numa mensagem (sem texto junto, para ele copiar fácil), depois diga o valor e a validade. A confirmação é automática.'
          : 'Envie a linha digitável sozinha numa mensagem e o link do PDF; diga valor e vencimento. A confirmação é automática.',
      })
    }

    if (name === 'anexar_documento') {
      const tipo = String(input?.tipo || '').trim()
      if (!tipo) return erro('Informe o tipo do documento.')
      if (!ctx.leadId) return ctx.dryRun ? ok({ simulacao: true, tipo, instrucao: 'SIMULAÇÃO: no WhatsApp real o arquivo enviado pelo lead é vinculado à inscrição.' }) : erro('Sem contato.')
      const anexos = await anexosRecentes(ctx.leadId)
      const usados = new Set(edu.anexosUsados || [])
      const anexo = input?.arquivoId ? anexos.find((a) => a.id === Number(input.arquivoId)) : anexos.find((a) => !usados.has(a.id))
      if (!anexo) return erro('Nenhum arquivo novo do lead no chat.', 'Peça para ele enviar a FOTO ou o PDF do documento aqui mesmo, e avisar quando enviar.')
      if (ctx.dryRun) return ok({ simulacao: true, tipo, arquivo: anexo.nome, instrucao: 'SIMULAÇÃO: nada foi vinculado.' })
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const travaDocs = await bloqueioDoDocumento(reg.id, tipo, 'inscricao').catch(() => null)
      if (travaDocs) return erro(travaDocs, INSTRUCAO_TRAVA)
      const arquivo = await lerArquivo(anexo.url)
      if (!arquivo) return erro('Não consegui abrir o arquivo enviado.', 'Peça para reenviar o arquivo.')
      const ext = (extname(anexo.url).replace('.', '') || (anexo.tipo === 'image' ? 'jpg' : 'pdf')).toLowerCase()
      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const b = `----attrae${crypto.randomBytes(8).toString('hex')}`
      const parte = (n: string, v: string) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`
      const payload = Buffer.concat([
        Buffer.from(parte('type', tipo) + parte('label', anexo.nome) + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${tipo}.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
        arquivo, Buffer.from(`\r\n--${b}--\r\n`),
      ])
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const r = await portalHttp(app, 'POST', '/api/candidate/documents', { token, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } })
      if (r.status !== 200 || !r.body?.ok) return erro(String(r.body?.error || 'Falha ao anexar.'), 'Explique e peça para reenviar, se for o caso.')
      edu.anexosUsados = [...usados, anexo.id]
      const et = await etapasDaInscricao(reg.id, 'inscricao').catch(() => null)
      // Documento da análise acadêmica: a situação que interessa é a da análise.
      const docs = et?.etapas.find((e) => e.analise?.documentos.some((d) => d.code === tipo)) ?? et?.etapas.find((e) => e.chave === 'documentos')
      return ok({ tipo, arquivo: anexo.nome, situacaoDosDocumentos: docs?.detalhe, instrucao: 'Confirme o recebimento em uma frase e peça o PRÓXIMO documento que falta, um por vez — se as suas instruções definirem outra ordem para os documentos (ex.: parte agora, o resto no final), siga as instruções. Os documentos passam por análise da equipe.' })
    }

    if (name === 'responder_parecer') {
      const decisao = input?.decisao === 'aceito' ? 'aceito' : input?.decisao === 'desistiu' ? 'desistiu' : null
      if (!decisao) return erro('Decisão inválida.')
      if (ctx.dryRun) return ok({ simulacao: true, decisao, instrucao: 'SIMULAÇÃO: nada foi registrado.' })
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const r = await portalHttp(app, 'POST', `/api/public/registrations/${reg.candidateCode}/analise/decisao`, { token, payload: { decisao, via: 'chatbot' } })
      if (r.status !== 200 || !r.body?.ok) return erro(String(r.body?.error || 'Não foi possível registrar.'))
      return ok(decisao === 'aceito'
        ? { decisao, instrucao: 'Confirme que a resposta foi registrada e conduza a PRÓXIMA etapa (chame situacao_da_matricula para ver o que liberou).' }
        : { decisao, instrucao: 'Confirme com respeito que a inscrição foi encerrada; diga que, se mudar de ideia, pode se inscrever de novo pelo portal.' })
    }

    if (name === 'assinar_contrato') {
      if (ctx.dryRun) return ok({ simulacao: true, instrucao: 'SIMULAÇÃO: no WhatsApp real o lead recebe o link para ler e assinar o contrato.' })
      const reg = await inscricaoAtual(ctx)
      if (!reg) return erro(SEM_INSCRICAO)
      const travaContrato = await bloqueioDaEtapa(reg.id, 'contrato', 'inscricao').catch(() => null)
      if (travaContrato) return erro(travaContrato, INSTRUCAO_TRAVA)
      const token = signCandidateToken(reg.id, reg.candidateCode)
      const c = await portalHttp(app, 'GET', `/api/public/registrations/${reg.candidateCode}/contrato`, { token })
      if (c.status !== 200) return erro(String(c.body?.error || 'Contrato indisponível.'), 'Diga que a equipe vai enviar o contrato e chame transferir_humano.')
      if (c.body?.word?.eletronica) {
        const r = await portalHttp(app, 'POST', `/api/public/registrations/${reg.candidateCode}/contrato/iniciar`, { token, payload: {} })
        if (r.status !== 200) return erro(String(r.body?.error || 'Não foi possível preparar a assinatura.'))
        const sig = (r.body?.assinatura?.signatarios || []).find((s: any) => s.papel !== 'contratada' && s.link) || (r.body?.assinatura?.signatarios || []).find((s: any) => s.link)
        if (sig?.link) return ok({ link: sig.link, instrucao: 'Envie o link: ele lê o contrato e assina ali mesmo, pelo celular. A confirmação chega sozinha.' })
        // Clicksign não devolve link: sem widget no portal, o convite sai pela
        // própria Clicksign (WhatsApp/e-mail do aluno); com widget, assina no portal.
        if (c.body?.word?.provedor === 'CLICKSIGN' && !c.body?.word?.widget) {
          return ok({ instrucao: 'O convite para ler e assinar o contrato foi enviado pela plataforma de assinatura (Clicksign) para o WhatsApp/e-mail dele. Peça para procurar essa mensagem e assinar; a confirmação chega sozinha.' })
        }
      }
      const link = await linkDeAcesso(reg.leadId)
      return link
        ? ok({ link: link.url, instrucao: 'O contrato é lido e aceito na área do candidato. Envie o link (uso único, 48h).' })
        : erro('Não foi possível gerar o link.', 'Chame transferir_humano.')
    }

    if (name === 'link_do_portal') {
      if (ctx.dryRun) return ok({ simulacao: true, instrucao: 'SIMULAÇÃO: no WhatsApp real o lead recebe o link de acesso à área do candidato (uso único, 48h).' })
      const reg = await inscricaoAtual(ctx)
      const link = await linkDeAcesso(reg?.leadId ?? ctx.leadId)
      return link ? ok({ link: link.url, instrucao: 'Envie o link e diga que é de uso único e vale por 48h.' }) : erro('Sem inscrição/cadastro para gerar acesso.', SEM_INSCRICAO)
    }

    if (name === 'pre_inscricao_curso_indisponivel') {
      const curso = limpar(input?.curso, 150)
      if (!curso) return erro('Informe o curso pedido.')
      const email = String(input?.email || '').trim()
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro('E-mail inválido.', 'Peça para conferir o e-mail.')
      const instrucao = 'Diga que registrou o interesse dele nesse curso e que hoje ainda não o oferecemos; o que dizer a seguir vem das suas instruções para curso não oferecido. Não prometa prazo.'
      if (ctx.dryRun) return ok({ simulacao: true, curso, instrucao: `SIMULAÇÃO: nada foi gravado. ${instrucao}` })
      if (!ctx.leadId) return erro('Sem contato.')
      const nome = limpar(input?.nome, 120)
      const obs = limpar(input?.observacao, 400)
      await prisma.leadNote.create({
        data: {
          leadId: ctx.leadId, userName: 'Consultor IA',
          content: [
            `PRÉ-INSCRIÇÃO — curso fora do portfólio: "${curso}".`,
            'O candidato pediu um curso que não oferecemos hoje.',
            obs, nome ? `Nome: ${nome}` : '', email ? `E-mail: ${email}` : '',
          ].filter(Boolean).join('\n'),
        },
      })
      const tag = await prisma.tag.upsert({ where: { name: 'Curso fora do portfólio' }, create: { name: 'Curso fora do portfólio', color: '#f59e0b' }, update: {} })
      await prisma.leadTag.upsert({ where: { leadId_tagId: { leadId: ctx.leadId, tagId: tag.id } }, create: { leadId: ctx.leadId, tagId: tag.id }, update: {} })
      const lead = await prisma.lead.findUnique({ where: { id: ctx.leadId }, select: { nome: true, email: true } })
      const upd: Record<string, string> = {}
      if (nome && (!lead?.nome || /^(lead( lp)?|webchat)$/i.test(lead.nome.trim()))) upd.nome = nome
      if (email && !lead?.email) upd.email = email
      if (Object.keys(upd).length) await prisma.lead.update({ where: { id: ctx.leadId }, data: upd })
      return ok({ curso, registrado: true, instrucao })
    }

    if (name === 'registrar_anotacao') {
      const texto = limpar(input?.texto, 600)
      if (!texto) return erro('Anotação vazia.')
      if (ctx.dryRun) return ok({ simulacao: true, instrucao: 'SIMULAÇÃO: anotação não gravada. Siga a conversa.' })
      if (!ctx.leadId) return erro('Sem contato.')
      await prisma.leadNote.create({ data: { leadId: ctx.leadId, userName: 'Consultor IA', content: texto } })
      return ok({ registrado: true, instrucao: 'Siga a conversa — não comente a anotação com o lead.' })
    }

    return erro('ferramenta desconhecida')
  } catch (e: any) {
    app.log.warn(`[eduSdr] ${name}: ${e?.message || e}`)
    return erro('falha ao executar a ação')
  }
}

async function linkDeAcesso(leadId: number | null | undefined) {
  if (!leadId) return null
  const { garantirConta, criarLinkDeAcesso } = await import('../portalAccount.js')
  const conta: any = await garantirConta(leadId).catch(() => null)
  if (!conta?.id) return null
  return criarLinkDeAcesso(conta.id, 'primeiro_acesso', 'whatsapp').catch(() => null)
}

async function lerArquivo(url: string): Promise<Buffer | null> {
  if (/^https?:\/\//.test(url)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
    return r?.ok ? Buffer.from(await r.arrayBuffer()) : null
  }
  if (!url.startsWith('/uploads/') || url.includes('..')) return null
  return readFile(join(process.cwd(), '..', url)).catch(() => null)
}

/**
 * Texto que o modelo escreve JUNTO de uma consulta ("Sim, temos! Deixa eu ver
 * o preço…") — no consultor ele não vai ao lead nem fica no histórico: a
 * resposta final, escrita depois da consulta, já sai completa. Entregar os dois
 * fazia o lead receber "Sim, temos o NR 10" e logo depois "Temos sim! Veja:".
 */
export function semTextoDeEspera(blocos: any): any {
  return Array.isArray(blocos) ? blocos.filter((b: any) => b?.type !== 'text') : blocos
}

// ── Bloco de prompt ─────────────────────────────────────────────────────────

export function protocoloEdu(catalogoResumo: string, contexto: string, simulacao: boolean): string {
  return [
    contexto ? `\n## O QUE O SISTEMA JÁ SABE DESTE CONTATO (leia antes de qualquer pergunta)\n${contexto}\n\nRegras: nada do que está aqui se pergunta de novo — use para personalizar. Anotações e negociações são da equipe: respeite o que já foi combinado e não contradiga. Se houver inscrição em andamento, a conversa CONTINUA dela.
Mas isto é HISTÓRICO, não catálogo: valor que aparece em campo personalizado ou anotação antiga NÃO é o preço vigente, e curso citado em anotação pode não existir mais — preço e curso só valem se vierem das ferramentas agora. Se uma negociação em aberto tiver condição combinada diferente da tabela e a pessoa cobrar essa condição, transfira para a equipe.` : '',
    catalogoResumo ? `\n## Cursos no portal hoje (só nomes — detalhes, preços e regras SEMPRE por ferramenta)\n${catalogoResumo}` : '',
    `\n## Fonte da verdade e ferramentas
- Curso, nível, modalidade, polo, carga horária, preço, condições de pagamento, forma de ingresso, documentos e etapas da matrícula: SOMENTE o que **consultar_cursos** / **detalhes_do_curso** devolverem nesta conversa. Nunca de memória.
- Antes de iniciar matrícula ou de falar de etapas pendentes, chame **situacao_da_matricula**: se já existe inscrição, continue dela, na ORDEM que ela devolver — nunca ofereça à pessoa escolher a ordem das etapas, e não monte a lista de pendências só pela ficha do contato. A ordem ORIENTA, não bloqueia: se a pessoa pedir para fazer outra etapa antes (ex.: pagar agora e assinar depois) e a etapa pulada não estiver marcada como obrigatória, faça a que ela pediu e depois retome a que ficou.

## Matrícula pelo chat (quando o lead CONFIRMAR que quer se matricular)
1. Pare de vender. Resposta operacional.
2. Siga as etapasDaMatricula da oferta, na ordem: inscrição → (completar cadastro) → pagamento → documentos → contrato, conforme o portal daquele curso. Se as suas instruções definirem uma ordem própria para os documentos (ex.: parte agora, o resto no final), ela vale.
3. Inscrição: peça só os dados_da_inscricao que faltam (nome completo, CPF, e-mail...), um por vez — no WhatsApp o número já é conhecido e não se pede; no chat do site, peça. Antes de inscrever, peça o aceite da política de privacidade numa frase curta e direta (ex.: "Para fazer sua inscrição, preciso do seu ok para usarmos esses dados conforme nossa política de privacidade. Posso seguir?"). Depois **fazer_inscricao**.
4. Etapas seguintes: **dados_da_etapa** quando a etapa pedir dados; pagamento com **opcoes_de_pagamento** → lead escolhe → **gerar_pagamento**; documentos um por vez (ou na ordem das suas instruções): peça a foto/PDF aqui no chat e, quando ele mandar, **anexar_documento**; contrato com **assinar_contrato**. Análise acadêmica (ex.: transferência): peça os documentos da análise (documentosDaAnalise) e anexe com **anexar_documento**; enquanto não houver parecer, diga que a instituição está analisando e que ele recebe o resultado; com parecer deferido, apresente período, aproveitamento e observações e pergunte se concorda em continuar — só então **responder_parecer**; indeferido: explique o motivo e ofereça outra forma de ingresso (nova inscrição pelo portal ou **fazer_inscricao** com outra oferta). Redação online (vestibular): é escrita na área do candidato, com tempo e regras próprias — nunca peça o texto no chat; mande **link_do_portal** e explique que a redação é feita lá.
5. NUNCA confirme inscrição, pagamento, documento ou contrato sem a ferramenta ter confirmado. Se a pessoa disser "paguei"/"enviei", confira com **situacao_da_matricula** antes de responder (a confirmação do pagamento é automática; boleto depende da compensação bancária).
6. Erro de ferramenta: diga o que de fato faltou ou falhou (ex.: "o CPF não conferiu") — nunca invente "instabilidade". Só transfira se não for algo que a pessoa resolva.
7. Se o lead quiser fazer algo pela tela (ou o meio exigir, como cartão), **link_do_portal**.
8. Cartão de crédito: NUNCA peça número de cartão no chat.
9. Valor, vencimento e validade de cobrança ou link: só o que a ferramenta devolveu. Se ela não trouxe prazo, não cite prazo nenhum (nada de "expira em 24h").

## Transferir para a equipe (**transferir_humano**)
Pedido explícito de pessoa (sem tentar segurar); desconto/condição fora da tabela; informação que as ferramentas não trazem; erro que se repete; caso sensível. Avise uma vez, sem repetir.

## Sem fonte, sem afirmação
Certificado, diploma, reconhecimento/credenciamento, estágio, prazo de início, conselho, aproveitamento de disciplinas ou de experiência: só afirme o que veio da ferramenta ou da base institucional. Se não veio, diga que confirma com a equipe — mesmo que pareça óbvio.`,
    simulacao ? `\n## MODO TESTE (simulador)\nVocê está num teste interno. Ferramentas de escrita respondem "simulacao": siga a conversa como se tivesse funcionado e, quando relevante, diga entre colchetes o que aconteceria de verdade (ex.: "[no WhatsApp real: código Pix enviado aqui]").` : '',
  ].filter(Boolean).join('\n')
}

// ── Matrícula pelo chat (liga/desliga) ─────────────────────────────────────
// `form.settings.eduSdr.matriculaPeloChat === false` deixa a IA só informando:
// ela segue consultando cursos, preços e a situação de inscrições já feitas,
// mas não inscreve, não cobra, não recebe documento, não manda contrato nem
// link do portal. Quem quer se matricular vai para a equipe (rotear_setor).
// Ausente = ligada, que é o comportamento de sempre.
export function matriculaPeloChatLigada(form: any): boolean {
  return form?.settings?.eduSdr?.matriculaPeloChat !== false
}

export const EDU_TOOLS_MATRICULA = new Set([
  'fazer_inscricao', 'dados_da_etapa', 'salvar_dados_da_etapa', 'opcoes_de_pagamento', 'gerar_pagamento',
  'anexar_documento', 'assinar_contrato', 'responder_parecer', 'link_do_portal',
])

/** Tira do protocolo a seção "Matrícula pelo chat" (o passo a passo de
 *  inscrição, cobrança, documentos e contrato). Só avisar por cima não basta:
 *  com as duas versões no prompt, a IA seguia coletando dados de inscrição. */
export function semSecaoDeMatricula(protocolo: string): string {
  return protocolo.replace(/\n## Matrícula pelo chat[^\n]*\n[\s\S]*?(?=\n## )/, '\n')
}

export const PROTOCOLO_SEM_MATRICULA = `
## MATRÍCULA PELO CHAT DESLIGADA (vale acima de qualquer instrução anterior sobre inscrição, pagamento, documentos, contrato ou link do portal)
Neste momento a matrícula não é feita por esta conversa: a equipe de matrículas conclui com a pessoa.
- Continue tirando dúvidas de cursos, valores, polos, formas de ingresso e documentos com consultar_cursos e detalhes_do_curso.
- Assim que a pessoa disser que quer se matricular ou se inscrever, ou pedir link, boleto, Pix, contrato ou envio de documentos para a matrícula, encaminhe NA MESMA RESPOSTA com rotear_setor para o departamento que cuida de matrículas (se não houver, transferir_humano). Não faça perguntas de qualificação antes (forma de ingresso, graduação concluída, ENEM, polo): isso fica com a equipe. Registre com registrar_anotacao o que já souber (ex.: "Quer se matricular: curso X, polo Y"). Depois de encaminhar, peça no máximo o nome completo, se ainda não souber, e diga que um consultor de matrículas continua o atendimento por aqui, nesta conversa.
- Dúvida sobre curso, preço, duração ou forma de ingresso sem pedido de matrícula: só responda (não encaminhe).
- Por aqui, não mande link do portal nem prometa gerar cobrança. Se a pessoa perguntar se pode se inscrever pelo site, não negue: diga que a equipe de matrículas ajuda com isso.
- Quem já tem inscrição e pergunta dela: consulte situacao_da_matricula e informe; para concluir qualquer etapa, encaminhe para matrículas.`
