// services/inadimplencia.ts
//
// INADIMPLÊNCIA E ACORDOS (06/11/2026). Junta o que está vencido nas três fontes:
//   - títulos do pagamento combinado e dos acordos;
//   - parcelas do boleto parcelado do portal (paymentPlan.parcelasPortal + previstas);
//   - parcelas do acadêmico (AcaParcela), em quem usa o ERP.
// Multa e juros seguem a configuração de encargos do Financeiro. Nada aqui envia
// mensagem: a cobrança parte do agente, com o texto levado à conversa.

import { prisma } from '../lib/prisma.js'
import { calcularEncargos, getEncargosConfig, type EncargosConfig } from './acaEncargos.js'
import { lerCondicaoNegociada } from './planoFinanceiro.js'
import { mesesDepois, vencimentoPrevisto } from './areaDoAluno.js'
import {
  cancelarNoGateway, cancelarTitulosAbertos, gerarCobrancaDoTitulo, hojeBr, MEIOS, registrarPagamentoDoTitulo, TITULO_EM_ABERTO, type MeioDoTitulo, type Operador,
} from './pagamentoCombinado.js'
import { cancelarCobrancaAsaas, type AsaasConfig } from './paymentAsaas.js'
import { decryptToken } from './cloudApi.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { logEvent } from './leadHistory.js'
import { efetivar as efetivarAcordoAca, simular as simularAcordoAca } from './acaAcordo.js'
import { darBaixaManual } from './acaFinanceiro.js'

export type FonteDoItem = 'titulo' | 'parcela_portal' | 'aca'
export interface ItemDevido {
  chave: string
  fonte: FonteDoItem
  leadId: number
  registrationId: number | null
  codigo: string | null
  titulo: string
  curso: string | null
  portal: string | null
  portalId: number | null
  meio: string | null
  vencimento: string
  diasAtraso: number
  valor: number
  multa: number
  juros: number
  atualizado: number
  link: string | null
  acordoId: number | null
}

const FECHADAS = ['cancelled', 'transferred', 'merged', 'expired']
const NOME_DO_MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)

export const FAIXAS = [
  { id: '1-30', rotulo: '1 a 30 dias', min: 1, max: 30 },
  { id: '31-60', rotulo: '31 a 60 dias', min: 31, max: 60 },
  { id: '61-90', rotulo: '61 a 90 dias', min: 61, max: 90 },
  { id: '91-180', rotulo: '91 a 180 dias', min: 91, max: 180 },
  { id: '180+', rotulo: 'Mais de 180 dias', min: 181, max: Infinity },
] as const

function comEncargos(valorCentavos: number, vencimento: string, cfg: EncargosConfig, hoje: string) {
  const e = calcularEncargos({ valorBrutoCentavos: valorCentavos, dataVencimento: `${vencimento}T12:00:00`, situacao: 'ABERTA' }, cfg, new Date(`${hoje}T12:00:00`))
  return { multa: e.vencida ? e.multa : 0, juros: e.vencida ? e.juros : 0, atualizado: e.vencida ? e.valorCobranca : valorCentavos }
}

const cursoDe = (r: any): string | null => r?.processRegistration?.offering?.nome ?? r?.processRegistration?.offering?.course?.nome ?? null
const SELECAO_REG = {
  id: true, leadId: true, candidateCode: true, paymentPlan: true, paymentPaidAt: true, createdAt: true, portalId: true,
  portal: { select: { nome: true } },
  processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
} as const

/** Parcelas do boleto parcelado que ainda não foram pagas, com a data de cada uma. */
export function parcelasEmAbertoDoBoleto(plano: any, base: Date, diaDoPlano: number | null): Array<{ numero: number; vencimento: string; valorCentavos: number; link: string | null; gerada: boolean }> {
  const n = Number(plano?.parcelas) || 1
  if (plano?.meio !== 'boleto' || n <= 1 || plano?.installmentId || plano?.combinado) return []
  const valorCentavos = Math.round((Number(plano.valorParcela) || 0) * 100)
  if (valorCentavos <= 0) return []
  const cn = lerCondicaoNegociada(plano.condicaoNegociada)
  const dia = cn?.diaVencimento ?? diaDoPlano
  const geradas = (plano.parcelasPortal ?? {}) as Record<string, any>
  const out = []
  for (let i = 2; i <= n; i++) {
    const g = geradas[String(i)]
    if (g && ['paga', 'estornada', 'renegociada'].includes(g.situacao)) continue
    const ativa = g?.id && g.situacao !== 'cancelada'
    const vencimento: string | null = ativa && g.vencimento ? g.vencimento
      : cn?.primeiraSeguinte ? mesesDepois(cn.primeiraSeguinte, i - 2)
        : dia ? vencimentoPrevisto(base, i - 1, dia) : null
    if (!vencimento) continue
    out.push({ numero: i, vencimento, valorCentavos: ativa && g.valor ? Math.round(Number(g.valor) * 100) : valorCentavos, link: ativa ? g.invoiceUrl ?? null : null, gerada: !!ativa })
  }
  return out
}

/** Todo o devido, vencido ou não, da instituição ou de um lead. */
export async function carregarItens(opts: { leadId?: number; incluirAVencer?: boolean } = {}): Promise<ItemDevido[]> {
  const hoje = hojeBr()
  const cfg = await getEncargosConfig()
  const out: ItemDevido[] = []
  const vale = (venc: string) => opts.incluirAVencer || venc < hoje
  const regValida = { status: { notIn: FECHADAS }, mergedIntoId: null, paymentStatus: 'paid', ...(opts.leadId ? { leadId: opts.leadId } : { leadId: { not: null } }) }

  const titulos = await prisma.enrollmentTitulo.findMany({
    where: { status: { in: TITULO_EM_ABERTO }, ...(opts.incluirAVencer ? {} : { vencimento: { lt: hoje } }), registration: regValida as any },
    include: { registration: { select: SELECAO_REG } },
  })
  // A parcela do acadêmico ligada a um título é a mesma dívida: conta uma vez só.
  const ligadas = await prisma.enrollmentTitulo.findMany({ where: { externalId: { not: null } }, select: { externalId: true } })
  const cobrancasDeTitulo = new Set(ligadas.map((t) => t.externalId!))
  for (const t of titulos) {
    const r = t.registration as any
    const e = comEncargos(t.valorCentavos, t.vencimento, cfg, hoje)
    out.push({
      chave: `t:${t.id}`, fonte: 'titulo', leadId: r.leadId, registrationId: r.id, codigo: r.candidateCode,
      titulo: t.origem === 'acordo' ? `Acordo nº ${t.acordoId} · pagamento ${t.ordem}` : `Pagamento combinado ${t.ordem}`,
      curso: cursoDe(r), portal: r.portal?.nome ?? null, portalId: r.portalId, meio: NOME_DO_MEIO[t.meio] ?? t.meio,
      vencimento: t.vencimento, diasAtraso: Math.max(0, diasEntre(t.vencimento, hoje)), valor: t.valorCentavos, ...e,
      link: t.invoiceUrl ?? null, acordoId: t.acordoId,
    })
  }

  const regs = await prisma.enrollmentRegistration.findMany({
    where: { ...regValida, paymentPlan: { path: '$.meio', equals: 'boleto' } } as any,
    select: SELECAO_REG,
  })
  const planoIds = [...new Set(regs.map((r) => Number((r.paymentPlan as any)?.planoFinanceiro?.planoId)).filter((x) => x > 0))]
  const dias = new Map((await prisma.acaPlanoPagamento.findMany({ where: { id: { in: planoIds } }, select: { id: true, diaVencimento: true } })).map((p) => [p.id, p.diaVencimento]))
  for (const r of regs as any[]) {
    const plano = r.paymentPlan
    const n = Number(plano?.parcelas) || 1
    for (const p of parcelasEmAbertoDoBoleto(plano, r.paymentPaidAt ?? r.createdAt, dias.get(Number(plano?.planoFinanceiro?.planoId)) ?? null)) {
      if (!vale(p.vencimento)) continue
      const e = comEncargos(p.valorCentavos, p.vencimento, cfg, hoje)
      out.push({
        chave: `p:${r.id}:${p.numero}`, fonte: 'parcela_portal', leadId: r.leadId, registrationId: r.id, codigo: r.candidateCode,
        titulo: `Parcela ${p.numero} de ${n}${p.gerada ? '' : ' (boleto não gerado)'}`, curso: cursoDe(r), portal: r.portal?.nome ?? null, portalId: r.portalId,
        meio: 'Boleto', vencimento: p.vencimento, diasAtraso: Math.max(0, diasEntre(p.vencimento, hoje)), valor: p.valorCentavos, ...e, link: p.link, acordoId: null,
      })
    }
  }

  const parcelas = await prisma.acaParcela.findMany({
    where: {
      situacao: { in: ['ABERTA', 'VENCIDA'] },
      ...(opts.incluirAVencer ? {} : { dataVencimento: { lt: new Date(`${hoje}T00:00:00-03:00`) } }),
      ...(opts.leadId ? { contrato: { matricula: { aluno: { leadId: opts.leadId } } } } : {}),
    },
    include: { contrato: { select: { matricula: { select: { aluno: { select: { leadId: true } }, turma: { select: { nome: true } } } } } } },
  }).catch(() => [] as any[])
  for (const p of parcelas as any[]) {
    if (p.asaasChargeId && cobrancasDeTitulo.has(p.asaasChargeId)) continue
    const leadId = p.contrato.matricula.aluno.leadId
    if (!leadId) continue
    const venc = hojeBr(new Date(p.dataVencimento))
    const e = comEncargos(p.valorBrutoCentavos, venc, cfg, hoje)
    out.push({
      chave: `a:${p.id}`, fonte: 'aca', leadId, registrationId: null, codigo: null,
      titulo: `${p.tipo === 'ACORDO' ? 'Acordo' : p.tipo === 'MATRICULA' ? 'Matrícula' : 'Mensalidade'} ${p.nroParcela}`,
      curso: p.contrato.matricula.turma?.nome ?? null, portal: null, portalId: null, meio: null,
      vencimento: venc, diasAtraso: Math.max(0, diasEntre(venc, hoje)), valor: p.valorBrutoCentavos, ...e, link: null, acordoId: p.acordoId ?? null,
    })
  }
  return out.sort((a, b) => a.vencimento.localeCompare(b.vencimento))
}

export interface Devedor {
  leadId: number; nome: string; whatsapp: string | null; email: string | null
  cursos: string[]; portais: string[]; portalIds: number[]
  qtd: number; valor: number; atualizado: number; maiorAtraso: number; vencimentoMaisAntigo: string
  ultimoContato: { em: string; canal: string; resultado: string; por: string | null } | null
  promessa: { para: string; quebrada: boolean } | null
  acordoAtivo: boolean
}

async function agrupar(itens: ItemDevido[]): Promise<Devedor[]> {
  const ids = [...new Set(itens.map((i) => i.leadId))]
  if (!ids.length) return []
  const hoje = hojeBr()
  const [leads, contatos, acordos] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, whatsapp: true, email: true } }),
    prisma.cobrancaContato.findMany({ where: { leadId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
    prisma.enrollmentAcordo.findMany({ where: { leadId: { in: ids }, status: 'ATIVO' }, select: { leadId: true } }),
  ])
  const lead = new Map(leads.map((l) => [l.id, l]))
  const ultimo = new Map<number, (typeof contatos)[number]>()
  const promessa = new Map<number, string>()
  for (const c of contatos) {
    if (!ultimo.has(c.leadId)) ultimo.set(c.leadId, c)
    if (c.promessaPara && !promessa.has(c.leadId)) promessa.set(c.leadId, c.promessaPara)
  }
  const comAcordo = new Set(acordos.map((a) => a.leadId))
  const grupos = new Map<number, ItemDevido[]>()
  for (const i of itens) (grupos.get(i.leadId) ?? grupos.set(i.leadId, []).get(i.leadId)!).push(i)
  return [...grupos.entries()].map(([id, g]) => {
    const l = lead.get(id), u = ultimo.get(id), p = promessa.get(id)
    return {
      leadId: id, nome: l?.nome || 'Sem nome', whatsapp: l?.whatsapp ?? null, email: l?.email ?? null,
      cursos: [...new Set(g.map((i) => i.curso).filter(Boolean) as string[])],
      portais: [...new Set(g.map((i) => i.portal).filter(Boolean) as string[])],
      portalIds: [...new Set(g.map((i) => i.portalId).filter(Boolean) as number[])],
      qtd: g.length, valor: g.reduce((s, i) => s + i.valor, 0), atualizado: g.reduce((s, i) => s + i.atualizado, 0),
      maiorAtraso: Math.max(...g.map((i) => i.diasAtraso)), vencimentoMaisAntigo: g[0]!.vencimento,
      ultimoContato: u ? { em: u.createdAt.toISOString(), canal: u.canal, resultado: u.resultado, por: u.userNome } : null,
      promessa: p ? { para: p, quebrada: p < hoje } : null,
      acordoAtivo: comAcordo.has(id),
    }
  })
}

// ─── Painel e lista ───────────────────────────────────

export async function resumo() {
  const hoje = hojeBr()
  const itens = await carregarItens()
  const devedores = await agrupar(itens)
  const trintaDias = new Date(Date.now() - 30 * 86_400_000)
  const [acordosAtivos, totalAcordos, recuperados, aVencerTitulos] = await Promise.all([
    prisma.enrollmentAcordo.findMany({ where: { status: 'ATIVO' }, select: { id: true, valorTotalCentavos: true } }),
    prisma.enrollmentAcordo.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.enrollmentTitulo.aggregate({ where: { origem: 'acordo', status: 'paga', paidAt: { gte: trintaDias } }, _sum: { valorPagoCentavos: true }, _count: { _all: true } }),
    carregarItens({ incluirAVencer: true }),
  ])
  const emSete = new Date(Date.parse(`${hoje}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)
  const proximos = aVencerTitulos.filter((i) => i.vencimento >= hoje && i.vencimento <= emSete)
  const acordosEmAtraso = new Set(itens.filter((i) => i.acordoId && i.fonte === 'titulo').map((i) => i.acordoId))
  const contagem = (s: string) => totalAcordos.find((x) => x.status === s)?._count._all ?? 0
  return {
    totalVencido: itens.reduce((s, i) => s + i.valor, 0),
    totalAtualizado: itens.reduce((s, i) => s + i.atualizado, 0),
    encargos: itens.reduce((s, i) => s + i.multa + i.juros, 0),
    titulos: itens.length,
    devedores: devedores.length,
    ticketMedio: devedores.length ? Math.round(itens.reduce((s, i) => s + i.valor, 0) / devedores.length) : 0,
    aging: FAIXAS.map((f) => {
      const g = itens.filter((i) => i.diasAtraso >= f.min && i.diasAtraso <= f.max)
      return { id: f.id, rotulo: f.rotulo, qtd: g.length, valor: g.reduce((s, i) => s + i.valor, 0), devedores: new Set(g.map((i) => i.leadId)).size }
    }),
    porPortal: [...itens.reduce((m, i) => {
      const k = i.portal ?? 'Acadêmico'
      const a = m.get(k) ?? { portal: k, valor: 0, qtd: 0 }
      a.valor += i.valor; a.qtd += 1; m.set(k, a); return m
    }, new Map<string, { portal: string; valor: number; qtd: number }>()).values()].sort((a, b) => b.valor - a.valor),
    aVencer7Dias: { valor: proximos.reduce((s, i) => s + i.valor, 0), qtd: proximos.length },
    acordos: {
      ativos: acordosAtivos.length, valorAtivo: acordosAtivos.reduce((s, a) => s + a.valorTotalCentavos, 0),
      quitados: contagem('QUITADO'), cancelados: contagem('CANCELADO'), emAtraso: acordosEmAtraso.size,
      recuperado30d: recuperados._sum.valorPagoCentavos ?? 0, pagamentos30d: recuperados._count._all,
    },
    aConferir: await pagamentosAConferir(),
    promessasVencidas: devedores.filter((d) => d.promessa?.quebrada).length,
    semContato: devedores.filter((d) => !d.ultimoContato).length,
  }
}

/** Dinheiro em título substituído ou cancelamento que falhou: a equipe trata e marca. */
async function pagamentosAConferir() {
  const ts = await prisma.enrollmentTitulo.findMany({
    where: { conferirEm: { not: null }, conferidoEm: null }, orderBy: { conferirEm: 'desc' }, take: 50,
    include: { registration: { select: { candidateCode: true, leadId: true, lead: { select: { nome: true } } } } },
  })
  return ts.map((t) => ({ id: t.id, nome: t.registration.lead?.nome ?? 'Sem nome', leadId: t.registration.leadId, codigo: t.registration.candidateCode, valor: t.valorPagoCentavos || t.valorCentavos, motivo: t.lastError, em: t.conferirEm!.toISOString() }))
}

export async function marcarConferido(id: number, nota: string, op: Operador) {
  if (nota.trim().length < 3) return { ok: false as const, status: 400, erro: 'Informe como foi tratado.' }
  const r = await prisma.enrollmentTitulo.updateMany({ where: { id, conferirEm: { not: null }, conferidoEm: null }, data: { conferidoEm: new Date(), conferidoNota: `${nota.trim()} (por ${op.nome})`.slice(0, 1000) } })
  if (r.count !== 1) return { ok: false as const, status: 409, erro: 'Este item já foi conferido.' }
  const t = await prisma.enrollmentTitulo.findUnique({ where: { id }, select: { registrationId: true } })
  await registrarEventoDaInscricao({ registrationId: t!.registrationId, etapa: 'pagamento', acao: 'pagamento_conferido', ator: 'atendente', userId: op.userId, userName: op.nome, dados: { titulo: id, nota } })
  return { ok: true as const }
}

export async function listarDevedores(f: { q?: string; faixa?: string; portal?: string; situacao?: string; ordem?: string }) {
  let lista = await agrupar(await carregarItens())
  const q = (f.q ?? '').trim().toLowerCase()
  if (q) {
    // Só busca por telefone quando o texto é um telefone: "Turma 51" não acha quem tem 51 no número.
    const digitos = /[a-zà-ú@]/i.test(q) ? '' : q.replace(/\D/g, '')
    lista = lista.filter((d) => d.nome.toLowerCase().includes(q) || (digitos.length >= 4 && (d.whatsapp ?? '').replace(/\D/g, '').includes(digitos)) || (d.email ?? '').toLowerCase().includes(q) || d.cursos.some((c) => c.toLowerCase().includes(q)))
  }
  const faixa = FAIXAS.find((x) => x.id === f.faixa)
  if (faixa) lista = lista.filter((d) => d.maiorAtraso >= faixa.min && d.maiorAtraso <= faixa.max)
  if (f.portal) lista = lista.filter((d) => d.portais.includes(f.portal!) || (f.portal === 'Acadêmico' && !d.portais.length))
  if (f.situacao === 'sem_contato') lista = lista.filter((d) => !d.ultimoContato)
  if (f.situacao === 'promessa_quebrada') lista = lista.filter((d) => d.promessa?.quebrada)
  if (f.situacao === 'promessa') lista = lista.filter((d) => d.promessa && !d.promessa.quebrada)
  if (f.situacao === 'acordo') lista = lista.filter((d) => d.acordoAtivo)
  const ordens: Record<string, (a: Devedor, b: Devedor) => number> = {
    valor: (a, b) => b.atualizado - a.atualizado,
    atraso: (a, b) => b.maiorAtraso - a.maiorAtraso,
    nome: (a, b) => a.nome.localeCompare(b.nome),
  }
  return lista.sort(ordens[f.ordem ?? ''] ?? ordens.atraso!)
}

export function csvDosDevedores(lista: Devedor[]): string {
  const c = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`
  const n = (x: number) => (x / 100).toFixed(2).replace('.', ',')
  const linhas = [['Nome', 'WhatsApp', 'E-mail', 'Curso', 'Portal', 'Títulos', 'Valor', 'Valor atualizado', 'Maior atraso (dias)', 'Vencimento mais antigo', 'Último contato', 'Resultado', 'Promessa', 'Acordo ativo'].map(c).join(';')]
  for (const d of lista) {
    linhas.push([d.nome, d.whatsapp, d.email, d.cursos.join(' / '), d.portais.join(' / '), d.qtd].map(c).join(';') + `;${n(d.valor)};${n(d.atualizado)};${d.maiorAtraso};` +
      [d.vencimentoMaisAntigo, d.ultimoContato?.em?.slice(0, 10), d.ultimoContato?.resultado, d.promessa?.para, d.acordoAtivo ? 'Sim' : 'Não'].map(c).join(';'))
  }
  return '﻿' + linhas.join('\r\n')
}

export async function detalheDoDevedor(leadId: number) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, nome: true, whatsapp: true, email: true } })
  if (!lead) return null
  const hoje = hojeBr()
  const [itens, contatos, acordos, regs] = await Promise.all([
    carregarItens({ leadId, incluirAVencer: true }),
    prisma.cobrancaContato.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.enrollmentAcordo.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
    prisma.enrollmentRegistration.findMany({ where: { leadId, mergedIntoId: null }, select: { id: true, candidateCode: true, portalId: true }, orderBy: { id: 'desc' } }),
  ])
  const titulosDosAcordos = await prisma.enrollmentTitulo.findMany({ where: { acordoId: { in: acordos.map((a) => a.id) }, origem: 'acordo' }, orderBy: { ordem: 'asc' } })
  return {
    lead,
    vencidos: itens.filter((i) => i.vencimento < hoje),
    aVencer: itens.filter((i) => i.vencimento >= hoje),
    contatos: contatos.map((c) => ({ id: c.id, canal: c.canal, resultado: c.resultado, promessaPara: c.promessaPara, nota: c.nota, por: c.userNome, em: c.createdAt.toISOString() })),
    acordos: acordos.map((a) => {
      const t = titulosDosAcordos.filter((x) => x.acordoId === a.id)
      return { ...resumoDoAcordo(a), pagamentos: t.map((x) => ({ id: x.id, ordem: x.ordem, meio: NOME_DO_MEIO[x.meio] ?? x.meio, valor: x.valorCentavos, vencimento: x.vencimento, status: x.status, link: x.invoiceUrl, erro: x.lastError })) }
    }),
    inscricoes: regs,
  }
}

function resumoDoAcordo(a: any) {
  return {
    id: a.id, registrationId: a.registrationId, leadId: a.leadId, status: a.status, original: a.valorOriginalCentavos, encargos: a.encargosCentavos,
    desconto: a.descontoCentavos, total: a.valorTotalCentavos, entrada: a.entradaCentavos, numParcelas: a.numParcelas, observacao: a.observacao,
    por: a.criadoPorNome, em: a.createdAt.toISOString(),
  }
}

export async function listarAcordos(status?: string) {
  const [portal, aca] = await Promise.all([
    prisma.enrollmentAcordo.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.acaAcordo.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 500 }),
  ])
  const hoje = hojeBr()
  const titulos = await prisma.enrollmentTitulo.findMany({ where: { acordoId: { in: portal.map((a) => a.id) }, origem: 'acordo' }, select: { acordoId: true, status: true, vencimento: true, valorCentavos: true, valorPagoCentavos: true } })
  const alunos = await prisma.aluno.findMany({ where: { id: { in: aca.map((a) => a.alunoId) } }, select: { id: true, leadId: true } }).catch(() => [] as Array<{ id: number; leadId: number | null }>)
  const leadDoAluno = new Map(alunos.map((a) => [a.id, a.leadId]))
  const ids = [...new Set([...portal.map((a) => a.leadId), ...alunos.map((a) => a.leadId)].filter(Boolean) as number[])]
  const leads = new Map((await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((l) => [l.id, l.nome]))
  return [
    ...portal.map((a) => {
      const t = titulos.filter((x) => x.acordoId === a.id)
      return {
        ...resumoDoAcordo(a), fonte: 'portal' as const, nome: a.leadId ? leads.get(a.leadId) ?? 'Sem nome' : 'Sem nome',
        pago: t.reduce((s, x) => s + (x.status === 'paga' ? x.valorPagoCentavos : 0), 0),
        emAtraso: a.status === 'ATIVO' && t.some((x) => TITULO_EM_ABERTO.includes(x.status as any) && x.vencimento < hoje),
        podeCancelar: a.status === 'ATIVO' && !t.some((x) => x.status === 'paga'),
      }
    }),
    ...aca.map((a) => {
      const leadId = leadDoAluno.get(a.alunoId) ?? null
      return {
        id: a.id, registrationId: null, leadId, status: a.status, original: a.valorOriginalCentavos, encargos: a.valorEncargosCentavos,
        desconto: a.descontoEncargosCentavos, total: a.valorTotalCentavos, entrada: a.entradaCentavos, numParcelas: a.numParcelas, observacao: a.observacao,
        por: a.origem, em: a.createdAt.toISOString(), fonte: 'academico' as const, nome: leadId ? leads.get(leadId) ?? 'Sem nome' : 'Sem nome',
        pago: 0, emAtraso: false, podeCancelar: false,
      }
    }),
  ].sort((a, b) => b.em.localeCompare(a.em))
}

// ─── Contato de cobrança ──────────────────────────────

export const CANAIS = ['whatsapp', 'telefone', 'email', 'presencial', 'outro'] as const
export const RESULTADOS = ['promessa_pagamento', 'sem_resposta', 'recado', 'negociando', 'recusou', 'numero_errado', 'pagou', 'outro'] as const

export async function registrarContato(b: any, op: Operador) {
  const leadId = Number(b?.leadId)
  if (!CANAIS.includes(b?.canal)) return { ok: false as const, status: 400, erro: 'Escolha o canal do contato.' }
  if (!RESULTADOS.includes(b?.resultado)) return { ok: false as const, status: 400, erro: 'Escolha o resultado do contato.' }
  const promessaPara = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.promessaPara ?? '')) ? String(b.promessaPara) : null
  if (b?.resultado === 'promessa_pagamento' && (!promessaPara || promessaPara < hojeBr())) return { ok: false as const, status: 400, erro: 'Informe a data prometida, de hoje em diante.' }
  if (!(await prisma.lead.count({ where: { id: leadId } }))) return { ok: false as const, status: 404, erro: 'Lead não encontrado.' }
  const nota = String(b?.nota ?? '').trim().slice(0, 2000) || null
  const c = await prisma.cobrancaContato.create({ data: { leadId, canal: b.canal, resultado: b.resultado, promessaPara, nota, userId: op.userId, userNome: op.nome } })
  logEvent({
    leadId, type: 'note_added', category: 'operator', title: `Contato de cobrança: ${String(b.resultado).replace(/_/g, ' ')}`, channel: b.canal,
    source: 'inadimplencia', actorType: 'operator', userId: op.userId, userName: op.nome, description: nota, metadata: { promessaPara },
  } as any)
  return { ok: true as const, id: c.id }
}

// ─── Acordo ───────────────────────────────────────────

const cfgDaInscricao = async (registrationId: number): Promise<AsaasConfig | null> => {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portal: { select: { paymentConnection: { select: { provider: true, environment: true, apiKey: true } } } } } })
  const c = r?.portal?.paymentConnection
  if (!c || c.provider !== 'asaas') return null
  try { return { apiKey: decryptToken(c.apiKey), environment: c.environment === 'production' ? 'production' : 'sandbox' } } catch { return null }
}

/** A conta do acordo. Pura: é o que a simulação e os testes usam. */
export function calcularAcordo(p: { original: number; encargos: number; desconto: number; entrada: number; numParcelas: number }) {
  if (!Number.isInteger(p.numParcelas) || p.numParcelas < 1 || p.numParcelas > 48) return { erro: 'As parcelas devem ser de 1 a 48.' }
  if (p.desconto < 0 || p.entrada < 0) return { erro: 'Desconto e entrada não podem ser negativos.' }
  const total = p.original + p.encargos - p.desconto
  if (total <= 0) return { erro: 'O desconto não pode zerar a dívida: use a baixa manual.' }
  if (p.entrada >= total) return { erro: 'A entrada precisa ser menor que o total do acordo.' }
  const restante = total - p.entrada
  const parcela = Math.floor(restante / p.numParcelas)
  if (parcela < 500) return { erro: `Cada parcela precisa ser de pelo menos ${brl(500)}.` }
  if (p.entrada > 0 && p.entrada < 500) return { erro: `A entrada precisa ser de pelo menos ${brl(500)}.` }
  const parcelas = Array.from({ length: p.numParcelas }, (_, i) => (i === p.numParcelas - 1 ? parcela + (restante - parcela * p.numParcelas) : parcela))
  return { total, entrada: p.entrada, parcelas }
}

async function itensEscolhidos(leadId: number, chaves: unknown) {
  const lista = Array.isArray(chaves) ? chaves.map(String) : []
  const itens = (await carregarItens({ leadId })).filter((i) => lista.includes(i.chave))
  if (!itens.length || itens.length !== new Set(lista).size) return { erro: 'Alguns títulos não estão mais vencidos. Atualize a página.' }
  const aca = itens.filter((i) => i.fonte === 'aca')
  if (aca.length && aca.length !== itens.length) return { erro: 'Títulos do acadêmico e do portal entram em acordos separados.' }
  if (!aca.length && new Set(itens.map((i) => i.registrationId)).size > 1) return { erro: 'Selecione títulos de uma única inscrição.' }
  return { itens, academico: aca.length > 0 }
}

const centavos = (v: unknown) => { const n = Number(String(v ?? '0').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : NaN }

export async function simularAcordo(b: any) {
  const leadId = Number(b?.leadId)
  const e = await itensEscolhidos(leadId, b?.itens)
  if ('erro' in e) return { erro: e.erro }
  const original = e.itens.reduce((s, i) => s + i.valor, 0)
  const encargos = b?.semEncargos ? 0 : e.itens.reduce((s, i) => s + i.multa + i.juros, 0)
  if (e.academico) {
    if (centavos(b?.desconto) > 0 || b?.semEncargos) return { erro: 'No acadêmico o desconto segue a política de acordos, e não vale nesta tela.' }
    const s = await simularAcordoAca({ parcelaIds: e.itens.map((i) => Number(i.chave.slice(2))), numParcelas: Number(b?.numParcelas), entradaCentavos: centavos(b?.entrada) }).catch((x: any) => ({ erro: String(x?.message) }))
    if ('erro' in s) return { erro: (s as any).erro }
    return { original: s.valorOriginalCentavos, encargos: s.encargosCentavos, desconto: s.descontoEncargosCentavos, total: s.totalCentavos, entrada: s.entradaCentavos, parcelas: Array.from({ length: s.numParcelas }, () => s.valorParcelaCentavos) }
  }
  const desconto = centavos(b?.desconto), entrada = centavos(b?.entrada)
  if (Number.isNaN(desconto) || Number.isNaN(entrada)) return { erro: 'Valor inválido.' }
  const c = calcularAcordo({ original, encargos, desconto, entrada, numParcelas: Number(b?.numParcelas) })
  if ('erro' in c) return { erro: c.erro as string }
  return { original, encargos, desconto, total: c.total, entrada: c.entrada, parcelas: c.parcelas }
}

export async function efetivarAcordo(b: any, op: Operador) {
  const leadId = Number(b?.leadId)
  const motivo = String(b?.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false as const, status: 400, erro: 'Informe o motivo ou a observação do acordo.' }
  const primeiro = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.primeiroVencimento ?? '')) ? String(b.primeiroVencimento) : null
  const hoje = hojeBr()
  if (!primeiro || primeiro < hoje) return { ok: false as const, status: 400, erro: 'Informe o vencimento da 1ª parcela, de hoje em diante.' }
  const e = await itensEscolhidos(leadId, b?.itens)
  if ('erro' in e) return { ok: false as const, status: 409, erro: e.erro }
  const regDoItem = e.itens[0]!.registrationId
  if (regDoItem && await prisma.enrollmentTroca.count({ where: { registrationId: regDoItem, status: 'PENDENTE' } })) {
    return { ok: false as const, status: 409, erro: 'Há uma troca de forma de pagamento aguardando o cartão. Cancele a troca antes do acordo.' }
  }
  const sim = await simularAcordo(b)
  if ('erro' in sim) return { ok: false as const, status: 400, erro: sim.erro as string }
  // Acordo abaixo do valor original (desconto além dos encargos) = parte da dívida
  // deixa de existir. Só com o motivo da redução escrito.
  if (sim.total < sim.original && motivo.length < 15) {
    return { ok: false as const, status: 400, erro: `O acordo (${brl(sim.total)}) fica abaixo do valor original (${brl(sim.original)}): a diferença deixa de ser cobrada. Escreva o motivo da redução e quem autorizou.` }
  }

  if (e.academico) {
    const r = await efetivarAcordoAca({
      parcelaIds: e.itens.map((i) => Number(i.chave.slice(2))), numParcelas: Number(b.numParcelas), entradaCentavos: sim.entrada,
      primeiroVencimento: new Date(`${primeiro}T12:00:00-03:00`), observacao: `${motivo} (por ${op.nome})`, origem: 'SECRETARIA',
    }).catch((x: any) => ({ erro: String(x?.message) }))
    if ('erro' in r) return { ok: false as const, status: 400, erro: (r as any).erro as string }
    logEvent({ leadId, type: 'note_added', category: 'operator', title: `Acordo nº ${r.acordo.id} no acadêmico`, channel: 'payment', source: 'inadimplencia', actorType: 'operator', userId: op.userId, userName: op.nome, description: motivo } as any)
    return { ok: true as const, acordoId: r.acordo.id, falhas: [] as string[] }
  }

  const meioEntrada: MeioDoTitulo = MEIOS.includes(b?.meioEntrada) ? b.meioEntrada : 'pix'
  const meioParcelas: MeioDoTitulo = b?.meioParcelas === 'pix' ? 'pix' : 'boleto'
  const dataEntrada = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.dataEntrada ?? '')) && String(b.dataEntrada) >= hoje ? String(b.dataEntrada) : hoje
  if (sim.entrada > 0 && primeiro <= dataEntrada) return { ok: false as const, status: 400, erro: 'A 1ª parcela precisa vencer depois da entrada.' }

  const registrationId = e.itens[0]!.registrationId!
  const titulosIds = e.itens.filter((i) => i.fonte === 'titulo').map((i) => Number(i.chave.slice(2)))
  const numeros = e.itens.filter((i) => i.fonte === 'parcela_portal').map((i) => Number(i.chave.split(':')[2]))

  // 1) Tira do gateway o que será substituído. Se algo não cancelar, nada muda
  //    no acordo: a cobrança antiga continuaria pagável e a dívida contaria duas vezes.
  const cfg = await cfgDaInscricao(registrationId)
  const titulosAntigos = await prisma.enrollmentTitulo.findMany({ where: { id: { in: titulosIds } } })
  for (const t of titulosAntigos) {
    const r = await cancelarNoGateway(cfg, t)
    if (!r.ok) return { ok: false as const, status: 502, erro: `Não foi possível cancelar a cobrança ${t.externalId}: ${r.message}. Cancele no Asaas e tente de novo.` }
    if (t.externalId) await prisma.acaParcela.updateMany({ where: { asaasChargeId: t.externalId, situacao: { in: ['ABERTA', 'VENCIDA'] } }, data: { situacao: 'RENEGOCIADA' } }).catch(() => {})
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { externalId: null, invoiceUrl: null, boletoPdfUrl: null, boletoLinha: null, pixCopiaCola: null, installmentId: null, status: 'prevista' } })
  }
  const reg0 = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const geradas = ((reg0?.paymentPlan as any)?.parcelasPortal ?? {}) as Record<string, any>
  for (const n of numeros) {
    const g = geradas[String(n)]
    if (g?.id) {
      const r = cfg ? await cancelarCobrancaAsaas(cfg, g.id) : { ok: false, message: 'conexão Asaas indisponível' }
      if (!r.ok) return { ok: false as const, status: 502, erro: `Não foi possível cancelar o boleto da parcela ${n}: ${(r as any).message}. Cancele no Asaas e tente de novo.` }
    }
  }

  // 2) Registra tudo junto.
  const criados = await prisma.$transaction(async (tx) => {
    const acordo = await tx.enrollmentAcordo.create({
      data: {
        registrationId, leadId, valorOriginalCentavos: sim.original, encargosCentavos: sim.encargos, descontoCentavos: sim.desconto,
        valorTotalCentavos: sim.total, entradaCentavos: sim.entrada, numParcelas: sim.parcelas.length,
        itens: e.itens.map((i) => ({ chave: i.chave, titulo: i.titulo, valor: i.valor, vencimento: i.vencimento })) as any,
        observacao: motivo.slice(0, 1000), criadoPorUserId: op.userId, criadoPorNome: op.nome,
      },
    })
    await tx.enrollmentTitulo.updateMany({ where: { id: { in: titulosIds } }, data: { status: 'renegociada', acordoId: acordo.id } })
    const atual = await tx.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
    const plano = (atual?.paymentPlan ?? {}) as Record<string, any>
    if (numeros.length) {
      const pp = { ...(plano.parcelasPortal ?? {}) }
      for (const n of numeros) pp[String(n)] = { situacao: 'renegociada', acordoId: acordo.id }
      await tx.enrollmentRegistration.update({ where: { id: registrationId }, data: { paymentPlan: { ...plano, parcelasPortal: pp } as any } })
    }
    const novos = []
    let ordem = 1
    if (sim.entrada > 0) {
      novos.push(await tx.enrollmentTitulo.create({ data: { registrationId, origem: 'acordo', acordoId: acordo.id, ordem: ordem++, meio: meioEntrada, valorCentavos: sim.entrada, vencimento: dataEntrada } }))
    }
    for (const [i, valorCentavos] of sim.parcelas.entries()) {
      const venc = mesesDepois(primeiro, i)
      novos.push(await tx.enrollmentTitulo.create({ data: { registrationId, origem: 'acordo', acordoId: acordo.id, ordem: ordem++, meio: meioParcelas, valorCentavos, vencimento: venc } }))
    }
    return { acordo, novos }
  })

  // 3) Gera as cobranças novas. Falha aqui fica à mostra, com "Gerar de novo".
  const falhas: string[] = []
  for (const t of criados.novos) {
    const r = await gerarCobrancaDoTitulo(t.id)
    if (!r.ok) falhas.push(`Pagamento ${t.ordem}: ${r.erro}`)
    else if (r.aviso && !falhas.includes(r.aviso)) falhas.push(r.aviso)
  }
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'acordo_criado', ator: 'atendente', userId: op.userId, userName: op.nome,
    dados: { acordo: criados.acordo.id, total: sim.total / 100, entrada: sim.entrada / 100, parcelas: sim.parcelas.length, motivo },
  })
  logEvent({ leadId, type: 'note_added', category: 'operator', title: `Acordo nº ${criados.acordo.id}: ${brl(sim.total)}`, channel: 'payment', source: 'inadimplencia', actorType: 'operator', userId: op.userId, userName: op.nome, description: motivo } as any)
  return { ok: true as const, acordoId: criados.acordo.id, falhas }
}

/** Só sem pagamento recebido. Os títulos renegociados voltam a ser dívida. */
export async function cancelarAcordo(id: number, motivo: string, op: Operador) {
  const a = await prisma.enrollmentAcordo.findUnique({ where: { id } })
  if (!a) return { ok: false as const, status: 404, erro: 'Acordo não encontrado.' }
  if (a.status !== 'ATIVO') return { ok: false as const, status: 409, erro: 'Só um acordo ativo pode ser cancelado.' }
  if (motivo.trim().length < 3) return { ok: false as const, status: 400, erro: 'Informe o motivo do cancelamento.' }
  if (await prisma.enrollmentTitulo.count({ where: { acordoId: id, origem: 'acordo', status: 'paga' } })) {
    return { ok: false as const, status: 409, erro: 'Este acordo já tem pagamento recebido. Renegocie o saldo em um novo acordo.' }
  }
  const avisos = await cancelarTitulosAbertos(a.registrationId, `Acordo nº ${id} cancelado`, { origem: 'acordo', acordoId: id })
  if (avisos.length) return { ok: false as const, status: 502, erro: avisos.join('; ') }
  await prisma.enrollmentTitulo.updateMany({ where: { acordoId: id, status: 'renegociada' }, data: { status: 'prevista', acordoId: null } })
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: a.registrationId }, select: { paymentPlan: true } })
  const plano = (reg?.paymentPlan ?? {}) as Record<string, any>
  const pp = { ...(plano.parcelasPortal ?? {}) } as Record<string, any>
  for (const [n, g] of Object.entries(pp)) if (g?.situacao === 'renegociada' && g.acordoId === id) delete pp[n]
  await prisma.enrollmentRegistration.update({ where: { id: a.registrationId }, data: { paymentPlan: { ...plano, parcelasPortal: pp } as any } })
  await prisma.enrollmentAcordo.update({ where: { id }, data: { status: 'CANCELADO', canceladoEm: new Date(), observacao: `${a.observacao ?? ''}\nCancelado: ${motivo.trim()}`.slice(0, 2000) } })
  await registrarEventoDaInscricao({ registrationId: a.registrationId, etapa: 'pagamento', acao: 'acordo_cancelado', ator: 'atendente', userId: op.userId, userName: op.nome, dados: { acordo: id, motivo } })
  return { ok: true as const }
}

// ─── Ações por título ─────────────────────────────────

/** Nova cobrança de um título vencido, com outra data. Só para títulos desta tabela. */
export async function segundaVia(tituloId: number, vencimento: string, op: Operador) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || vencimento < hojeBr()) return { ok: false as const, status: 400, erro: 'Informe a nova data, de hoje em diante.' }
  const t = await prisma.enrollmentTitulo.findUnique({ where: { id: tituloId } })
  if (!t || !TITULO_EM_ABERTO.includes(t.status as any)) return { ok: false as const, status: 409, erro: 'Este título não está em aberto.' }
  const cancelada = await cancelarNoGateway(await cfgDaInscricao(t.registrationId), t)
  if (!cancelada.ok) return { ok: false as const, status: 502, erro: `Não foi possível cancelar a cobrança anterior: ${cancelada.message}` }
  await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'prevista', externalId: null, invoiceUrl: null, boletoPdfUrl: null, boletoLinha: null, pixCopiaCola: null, installmentId: null, vencimento } })
  const g = await gerarCobrancaDoTitulo(t.id)
  // A parcela do acadêmico acompanha a cobrança nova, para a baixa continuar chegando nela.
  const novo = await prisma.enrollmentTitulo.findUnique({ where: { id: t.id }, select: { externalId: true } })
  if (t.externalId && novo?.externalId) await prisma.acaParcela.updateMany({ where: { asaasChargeId: t.externalId }, data: { asaasChargeId: novo.externalId, dataVencimento: new Date(`${vencimento}T12:00:00-03:00`) } }).catch(() => {})
  await registrarEventoDaInscricao({ registrationId: t.registrationId, etapa: 'pagamento', acao: 'titulo_segunda_via', ator: 'atendente', userId: op.userId, userName: op.nome, dados: { titulo: t.id, vencimento } })
  return g.ok ? { ok: true as const } : { ok: false as const, status: 502, erro: g.erro ?? 'Falha ao gerar a cobrança.' }
}

/** Pago fora do gateway. Cancela a cobrança aberta, para não ser paga de novo. */
export async function baixaManual(chave: string, nota: string, op: Operador) {
  const r = await baixaManualSemAviso(chave, nota, op)
  if (r.ok) {
    // Trilha do Financeiro: baixa manual vira evento de fluxo (o fluxo decide se
    // a de alguém de fora do Financeiro precisa ser conferida).
    let registrationId: number | null = null
    let leadId: number | null = null
    if (chave.startsWith('t:')) registrationId = (await prisma.enrollmentTitulo.findUnique({ where: { id: Number(chave.slice(2)) }, select: { registrationId: true } }))?.registrationId ?? null
    else if (chave.startsWith('p:')) registrationId = Number(chave.split(':')[1]) || null
    else if (chave.startsWith('a:')) leadId = (await prisma.acaParcela.findUnique({ where: { id: Number(chave.slice(2)) }, select: { contrato: { select: { matricula: { select: { aluno: { select: { leadId: true } } } } } } } }).catch(() => null) as any)?.contrato?.matricula?.aluno?.leadId ?? null
    const { avisarBaixaManual } = await import('./trilhaTarefas.js')
    void avisarBaixaManual({ registrationId, leadId, userId: op.userId, userName: op.nome, oQue: 'Baixa manual na Inadimplência', nota: nota.trim() })
  }
  return r
}

async function baixaManualSemAviso(chave: string, nota: string, op: Operador) {
  if (nota.trim().length < 3) return { ok: false as const, status: 400, erro: 'Informe como foi pago.' }
  const texto = `${nota.trim()} (por ${op.nome})`
  if (chave.startsWith('a:')) {
    await darBaixaManual(Number(chave.slice(2)))
    return { ok: true as const }
  }
  if (chave.startsWith('t:')) {
    const t = await prisma.enrollmentTitulo.findUnique({ where: { id: Number(chave.slice(2)) } })
    if (!t || !TITULO_EM_ABERTO.includes(t.status as any)) return { ok: false as const, status: 409, erro: 'Este título não está em aberto.' }
    const r = await cancelarNoGateway(await cfgDaInscricao(t.registrationId), t)
    if (!r.ok) return { ok: false as const, status: 502, erro: `Cancele a cobrança no Asaas antes da baixa: ${r.message}` }
    await registrarPagamentoDoTitulo(t.id, { fonte: 'manual', baixaManual: texto, ator: 'atendente', userId: op.userId, userName: op.nome })
    return { ok: true as const }
  }
  const m = chave.match(/^p:(\d+):(\d+)$/)
  if (!m) return { ok: false as const, status: 400, erro: 'Título inválido.' }
  const registrationId = Number(m[1])
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const plano = (reg?.paymentPlan ?? {}) as Record<string, any>
  const g = plano.parcelasPortal?.[m[2]!]
  if (g?.id) {
    const cfg = await cfgDaInscricao(registrationId)
    const r = cfg ? await cancelarCobrancaAsaas(cfg, g.id) : { ok: false, message: 'conexão Asaas indisponível' }
    if (!r.ok) return { ok: false as const, status: 502, erro: `Cancele o boleto no Asaas antes da baixa: ${(r as any).message}` }
  }
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentPlan: { ...plano, parcelasPortal: { ...(plano.parcelasPortal ?? {}), [m[2]!]: { ...(g ?? {}), id: null, situacao: 'paga', pagaEm: hojeBr(), baixaManual: texto } } } as any },
  })
  await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: 'parcela_baixa_manual', ator: 'atendente', userId: op.userId, userName: op.nome, dados: { parcela: Number(m[2]), nota: texto } })
  return { ok: true as const }
}
