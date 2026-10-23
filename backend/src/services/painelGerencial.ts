// Painel Gerencial (fechamento mensal) — camada de dados.
//
// Recria, a partir do BANCO do próprio tenant (bychat-ineprotec), os números
// que o painel externo (Supabase/Kommo) mostrava. Escopo "só ineprotec" = o
// funil comercial INE (default funnelId=4, "INE - FUNIL DE VENDAS"). Nada é
// hardcode de regra de negócio: as etapas ganha/perdida são DETECTADAS da
// própria tabela de etapas (por padrão de chave), e o funil é parâmetro.
//
// Âncora de data: COORTE (lead.createdAt dentro do período). É a visão que o
// painel externo usa no "visão geral" e nos rankings de vendedor (validado:
// Jessica Alves = 39 matrículas / R$94.688, idêntico ao painel original).
// "Matrículas efetivadas por data do evento" fica para a página de Matrículas.

import { prisma } from '../lib/prisma.js'

// Empresas do tenant. O CRM do ineprotec hospeda DUAS operações: o próprio
// INEPROTEC (funil INE, 4) e a MATRÍCULA EAD (funil MAT importado do Kommo, 1,
// e o "Comercial – Matrícula EAD" criado em ago/26, 7). O painel separa as
// empresas pelo FUNIL. `funis` = vendas (leads, etapas, pipeline); `posVenda` =
// Sucesso do Aluno / Redes da mesma empresa: depois da venda o card do aluno vai
// para lá (com o Ganho marcado) e a matrícula NÃO pode sumir do painel.
// Um funnelId explícito (>0) ainda permite inspecionar outro funil pontualmente.
export const EMPRESAS = {
  ine: { nome: 'INEPROTEC', funis: [4], posVenda: [5, 6], comissao: true },
  mat: { nome: 'MATRÍCULA EAD', funis: [1, 7], posVenda: [2, 3], comissao: false },
} as const
export type EmpresaKey = keyof typeof EMPRESAS
export function empresaDe(v: unknown): EmpresaKey { return v === 'mat' ? 'mat' : 'ine' }

// Tabela de comissão do ineprotec (comissão POR MATRÍCULA, escalonada pela qtd
// de matrículas do vendedor no mês e pela forma de pagamento). Config do tenant
// — editar aqui (painel não é replicado). Ordenar por `min` DESC.
const COMISSAO_FAIXAS = [
  { nome: 'Super Meta', min: 45, boleto: 25, cartao: 42, pix: 47 },
  { nome: 'Meta 2', min: 35, boleto: 20, cartao: 37, pix: 42 },
  { nome: 'Meta 1', min: 25, boleto: 15, cartao: 25, pix: 30 },
  { nome: 'Base', min: 0, boleto: 10, cartao: 15, pix: 20 },
]
const fnList = (funnelId?: number, empresa: EmpresaKey = 'ine'): string =>
  (funnelId && funnelId > 0 ? [funnelId] : [...EMPRESAS[empresa].funis])
    .map((f) => Number(f)).filter(Number.isFinite).join(',') || '0'
/** Funis de pós-venda da empresa (vazio quando um funnelId explícito foi pedido). */
const posList = (funnelId?: number, empresa: EmpresaKey = 'ine'): string =>
  (funnelId && funnelId > 0 ? [] : [...EMPRESAS[empresa].posVenda]).join(',') || '0'

// DDD → [UF, estado]. O campo `cidade` do lead é esparso; o DDD do telefone é
// o sinal de região mais confiável que temos.
const DDD_UF: Record<string, [string, string]> = (() => {
  const m: Record<string, [string, string]> = {}
  const put = (ufEstado: [string, string], ...ddds: number[]) => ddds.forEach((d) => { m[String(d)] = ufEstado })
  put(['SP', 'São Paulo'], 11, 12, 13, 14, 15, 16, 17, 18, 19)
  put(['RJ', 'Rio de Janeiro'], 21, 22, 24)
  put(['ES', 'Espírito Santo'], 27, 28)
  put(['MG', 'Minas Gerais'], 31, 32, 33, 34, 35, 37, 38)
  put(['PR', 'Paraná'], 41, 42, 43, 44, 45, 46)
  put(['SC', 'Santa Catarina'], 47, 48, 49)
  put(['RS', 'Rio Grande do Sul'], 51, 53, 54, 55)
  put(['DF', 'Distrito Federal'], 61)
  put(['GO', 'Goiás'], 62, 64)
  put(['TO', 'Tocantins'], 63)
  put(['MT', 'Mato Grosso'], 65, 66)
  put(['MS', 'Mato Grosso do Sul'], 67)
  put(['AC', 'Acre'], 68)
  put(['RO', 'Rondônia'], 69)
  put(['BA', 'Bahia'], 71, 73, 74, 75, 77)
  put(['SE', 'Sergipe'], 79)
  put(['PE', 'Pernambuco'], 81, 87)
  put(['AL', 'Alagoas'], 82)
  put(['PB', 'Paraíba'], 83)
  put(['RN', 'Rio Grande do Norte'], 84)
  put(['CE', 'Ceará'], 85, 88)
  put(['PI', 'Piauí'], 86, 89)
  put(['PA', 'Pará'], 91, 93, 94)
  put(['AM', 'Amazonas'], 92, 97)
  put(['RR', 'Roraima'], 95)
  put(['AP', 'Amapá'], 96)
  put(['MA', 'Maranhão'], 98, 99)
  return m
})()

/** 'YYYY-MM-DD HH:mm:ss' em UTC (as datas do banco são gravadas em UTC). */
function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function n(v: any): number {
  const x = typeof v === 'bigint' ? Number(v) : Number(v)
  return Number.isFinite(x) ? x : 0
}
/** Classifica a etapa pela chave: ganha / perdida / aberta. */
function tipoEtapa(key: string): 'won' | 'lost' | 'open' {
  // `matriculado`/`desqualificado` = chaves do funil "Comercial – Matrícula EAD" (7).
  if (/matricula_realizada|venda_ganha|_ganha$|^matriculado$/.test(key)) return 'won'
  if (/matricula_perdida|venda_perdida|_perdida$|^desqualificado$/.test(key)) return 'lost'
  return 'open'
}
function inList(keys: string[]): string {
  // keys vêm do nosso banco (só [a-z0-9_]) — sanitiza por garantia.
  const safe = keys.map((k) => `'${String(k).replace(/[^a-z0-9_]/gi, '')}'`)
  return safe.length ? safe.join(',') : `''`
}

export interface PeriodoIn { from: Date; to: Date; days: number }

// ── Matrícula = NEGOCIAÇÃO ACEITA ─────────────────────────────────────────
// Um lead pode fechar DOIS cursos (duas negociações aceitas no mesmo card). O
// time conta matrícula por curso, então a unidade do painel é a negociação
// aceita de um lead que está na etapa ganha; o lead ganho sem negociação vale 1.
//
// Data de FECHAMENTO: data de pagamento lançada (`data_pagamento_matricula`,
// que é o que o fechamento da secretaria usa) > data do ganho (`outcomeAt`, que
// o modal de Ganho permite retroagir — é a data da Visão Geral do Attrae) >
// detecção da venda. Com 2+ negociações, cada curso usa o fechamento da própria
// negociação. Datas do banco em UTC; o dia é o de Brasília (UTC-3).
//
// Valor: com UMA negociação vale o `saleValue` do lead (o mesmo da "Receita
// ganha" da Visão Geral, e o que a reconciliação corrigiu); com 2+ cada curso
// vale o `valorFinal` da sua negociação — o `saleValue` só guarda uma delas.
const J = (p: string) => `JSON_UNQUOTE(JSON_EXTRACT(l.customFields,'$.${p}'))`
const PAG_LANCADA = `STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y')`
const PAG = `COALESCE(${PAG_LANCADA}, DATE(DATE_SUB(COALESCE(l.outcomeAt, l.saleDetectedAt), INTERVAL 3 HOUR)))`
const FORMA_NEG = `CASE n.pagamentoForma WHEN 'boleto' THEN 'BOLETO' WHEN 'cartao' THEN 'CARTÃO DE CRÉDITO' WHEN 'pix' THEN 'PIX' ELSE NULLIF(UPPER(n.pagamentoForma),'') END`
const FORMA_LEAD = `NULLIF(${J('forma_pagamento')},'')`
// Curso pelo título da negociação ("Proposta – AGRIMENSURA" → "AGRIMENSURA"; "Proposta" sozinho = sem curso).
const CURSO_NEG = `NULLIF(TRIM(REGEXP_REPLACE(n.titulo, '^Proposta[[:space:]]*[–—-]?[[:space:]]*', '')), '')`

/**
 * Subconsulta `u`: uma linha por matrícula (negociação aceita). Leads do funil de
 * vendas na etapa ganha + leads do pós-venda com o Ganho marcado.
 */
function unidadesSql(FN: string, WON: string, POS = '0'): string {
  return `(SELECT l.id AS leadId, l.nome, l.assignedUserId, l.createdAt, l.outcome, l.outcomeAt, l.originType,
        COALESCE(NULLIF(l.source,''), l.originType, '(sem origem)') AS origem,
        REGEXP_REPLACE(COALESCE(l.whatsapp, l.phoneKey, ''), '[^0-9]', '') AS ph,
        COALESCE(k.qtd, 0) AS negs, n.id AS negId,
        CASE WHEN k.qtd > 1 THEN n.valorFinal ELSE l.saleValue END AS valor,
        CASE WHEN k.qtd > 1 THEN COALESCE(DATE(DATE_SUB(n.fechadaEm, INTERVAL 3 HOUR)), ${PAG}) ELSE ${PAG} END AS dt,
        (${PAG_LANCADA} IS NULL) AS pelo_ganho,
        CASE WHEN k.qtd > 1 THEN COALESCE(${FORMA_NEG}, ${FORMA_LEAD}) ELSE COALESCE(${FORMA_LEAD}, ${FORMA_NEG}) END AS forma,
        CASE WHEN k.qtd > 1 THEN COALESCE(${CURSO_NEG}, '(sem curso)') ELSE COALESCE(${J('curso_de_interesse_1')}, ${CURSO_NEG}, '(sem curso)') END AS curso,
        ${J('registro_atendimento')} AS registro,
        DATE_FORMAT(DATE_SUB(l.outcomeAt, INTERVAL 3 HOUR),'%d/%m/%Y') AS data_ganho
      FROM bychat_leads l
      LEFT JOIN (SELECT leadId, COUNT(*) AS qtd FROM bychat_negotiations WHERE status='aceita' GROUP BY leadId) k ON k.leadId=l.id
      LEFT JOIN bychat_negotiations n ON n.leadId=l.id AND n.status='aceita'
     WHERE (l.funnelId IN (${FN}) AND l.status IN (${WON})) OR (l.funnelId IN (${POS}) AND l.outcome='won')) u`
}

/** Junta duas listas pela chave (leads do período × matrículas do período). */
function juntar<A extends Record<string, any>, B extends Record<string, any>>(
  chave: string, a: A[], b: B[],
): Array<Record<string, any>> {
  const m = new Map<string, Record<string, any>>()
  for (const r of a) m.set(String(r[chave]), { ...r })
  for (const r of b) m.set(String(r[chave]), { ...(m.get(String(r[chave])) || { [chave]: r[chave] }), ...r })
  return [...m.values()]
}

export async function painelComercial(periodo: PeriodoIn, funnelId?: number, empresa: EmpresaKey = 'ine') {
  const { from, to, days } = periodo
  const FN = fnList(funnelId, empresa)
  const POS = posList(funnelId, empresa)
  const ALL = `${FN},${POS}`
  const F = fmt(from), T = fmt(to)
  // período anterior de mesmo tamanho, para o delta
  const prevTo = new Date(from.getTime())
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))

  // Etapas dos funis (nome, ordem) + classificação ganha/perdida/aberta.
  const stages = await prisma.$queryRawUnsafe<Array<{ key: string; name: string; position: number }>>(
    `SELECT \`key\`, name, position FROM bychat_stages WHERE funnelId IN (${FN}) ORDER BY position`,
  )
  const wonKeys = stages.filter((s) => tipoEtapa(s.key) === 'won').map((s) => s.key)
  const lostKeys = stages.filter((s) => tipoEtapa(s.key) === 'lost').map((s) => s.key)
  const WON = inList(wonKeys)
  const LOST = inList(lostKeys)
  const U = unidadesSql(FN, WON, POS)
  const NO_PERIODO = 'u.dt >= ? AND u.dt < ?'

  // ── Totais. Leads e "em aberto": pela ENTRADA do lead. Matrículas e
  // faturamento: pelo FECHAMENTO (acima). Perdas: pelo clique em Perdido
  // (outcomeAt), igual à Visão Geral do Attrae. ──
  const totais = async (fd: Date, td: Date) => {
    const f = fmt(fd), t = fmt(td)
    const [lr, mr, pr] = await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(
        `SELECT COUNT(*) AS leads, SUM(l.status NOT IN (${WON}) AND l.status NOT IN (${LOST})) AS em_aberto
           FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?`, f, t),
      prisma.$queryRawUnsafe<Array<any>>(
        `SELECT COUNT(*) AS q, ROUND(SUM(u.valor)) AS fat FROM ${U} WHERE ${NO_PERIODO}`, f, t),
      prisma.$queryRawUnsafe<Array<any>>(
        `SELECT COUNT(*) AS q FROM bychat_leads l
          WHERE l.funnelId IN (${FN}) AND l.outcome='lost' AND l.outcomeAt>=? AND l.outcomeAt<?`, f, t),
    ])
    const leads = n(lr[0]?.leads), matriculas = n(mr[0]?.q), faturamento = n(mr[0]?.fat)
    return {
      leads, matriculas, perdas: n(pr[0]?.q), em_aberto: n(lr[0]?.em_aberto), faturamento,
      ticket_medio: matriculas > 0 ? Math.round(faturamento / matriculas) : 0,
      conversao: leads > 0 ? matriculas / leads : 0,
    }
  }
  const visao_geral = await totais(from, to)
  const visao_ant = await totais(prevFrom, prevTo)

  // ── Funil (coorte): onde estão hoje os leads que entraram no período ──
  const funilRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.status AS \`key\`, COUNT(*) AS qtd
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY l.status`,
    F, T,
  )
  const qtdPorKey = new Map(funilRows.map((r) => [r.key, n(r.qtd)]))
  const funil = stages.map((s) => ({
    key: s.key, name: s.name, position: n(s.position), tipo: tipoEtapa(s.key), qtd: qtdPorKey.get(s.key) || 0,
  }))

  // ── Série diária: leads por dia de entrada × matrículas por dia de fechamento ──
  const [serieL, serieM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DATE_FORMAT(l.createdAt,'%Y-%m-%d') AS dia, COUNT(*) AS leads FROM bychat_leads l
        WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<? GROUP BY dia`, F, T),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DATE_FORMAT(u.dt,'%Y-%m-%d') AS dia, COUNT(*) AS matriculas FROM ${U} WHERE ${NO_PERIODO} GROUP BY dia`, F, T),
  ])
  const serie_diaria = juntar('dia', serieL, serieM)
    .map((r) => ({ dia: r.dia, leads: n(r.leads), matriculas: n(r.matriculas) }))
    .sort((a, b) => a.dia.localeCompare(b.dia))

  // ── Cursos ──
  const [cursoL, cursoM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT COALESCE(${J('curso_de_interesse_1')}, '(sem curso)') AS curso, COUNT(*) AS leads FROM bychat_leads l
        WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<? GROUP BY curso`, F, T),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT u.curso, COUNT(*) AS matriculas, ROUND(SUM(u.valor)) AS faturamento FROM ${U}
        WHERE ${NO_PERIODO} GROUP BY u.curso`, F, T),
  ])
  const cursos = juntar('curso', cursoL, cursoM).map((r) => ({
    curso: r.curso, leads: n(r.leads), matriculas: n(r.matriculas), faturamento: n(r.faturamento),
    ticket_medio: n(r.matriculas) > 0 ? Math.round(n(r.faturamento) / n(r.matriculas)) : 0,
  })).sort((a, b) => b.matriculas - a.matriculas || b.leads - a.leads).slice(0, 30)

  // ── Vendedores (responsável do lead) ──
  const VEND = `COALESCE(NULLIF(uu.displayName,''), uu.name, '(SEM RESPONSÁVEL)')`
  const [vendL, vendM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT ${VEND} AS vendedor, COUNT(*) AS leads_atribuidos,
              SUM(l.status NOT IN (${WON}) AND l.status NOT IN (${LOST}) AND l.lastActivityAt < NOW() - INTERVAL 7 DAY) AS parados_7d
         FROM bychat_leads l LEFT JOIN bychat_users uu ON uu.id=l.assignedUserId
        WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<? GROUP BY vendedor`, F, T),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT ${VEND} AS vendedor, COUNT(*) AS matriculas, ROUND(SUM(u.valor)) AS faturamento
         FROM ${U} LEFT JOIN bychat_users uu ON uu.id=u.assignedUserId
        WHERE ${NO_PERIODO} GROUP BY vendedor`, F, T),
  ])
  const vendedores = juntar('vendedor', vendL, vendM).map((r) => ({
    vendedor: r.vendedor, leads_atribuidos: n(r.leads_atribuidos), matriculas: n(r.matriculas),
    faturamento: n(r.faturamento), parados_7d: n(r.parados_7d),
    ticket_medio: n(r.matriculas) > 0 ? Math.round(n(r.faturamento) / n(r.matriculas)) : 0,
  })).sort((a, b) => b.matriculas - a.matriculas || b.faturamento - a.faturamento)

  // ── Origem: usa source/originType; normaliza vazio ──
  const [origL, origM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT COALESCE(NULLIF(l.source,''), l.originType, '(sem origem)') AS origem, COUNT(*) AS leads FROM bychat_leads l
        WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<? GROUP BY origem`, F, T),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT u.origem, COUNT(*) AS matriculas FROM ${U} WHERE ${NO_PERIODO} GROUP BY u.origem`, F, T),
  ])
  const origens = juntar('origem', origL, origM)
    .map((r) => ({ origem: r.origem, leads: n(r.leads), matriculas: n(r.matriculas) } as any))
    .sort((a, b) => b.leads - a.leads || b.matriculas - a.matriculas).slice(0, 20)
  const totLeads = origens.reduce((a, b) => a + b.leads, 0) || 1
  origens.forEach((o: any) => { o.pct = o.leads / totLeads })

  // ── Região: por DDD do telefone → UF/estado ──
  // DDD extraído do número (55 + DDD + assinante, ou DDD + assinante). `cidade`
  // é esparso demais; o DDD cobre quase todos os leads.
  const DDD = (ph: string) => `CASE WHEN ${ph} LIKE '55%' AND LENGTH(${ph})>=12 THEN SUBSTRING(${ph},3,2)
                 WHEN LENGTH(${ph}) IN (10,11) THEN SUBSTRING(${ph},1,2) ELSE NULL END`
  const [regL, regM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT COALESCE(${DDD('a.ph')}, '—') AS ddd, COUNT(*) AS leads FROM (
          SELECT REGEXP_REPLACE(COALESCE(l.whatsapp, l.phoneKey, ''), '[^0-9]', '') AS ph FROM bychat_leads l
           WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?) a GROUP BY ddd`, F, T),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT COALESCE(${DDD('u.ph')}, '—') AS ddd, COUNT(*) AS matriculas, ROUND(SUM(u.valor)) AS faturamento
         FROM ${U} WHERE ${NO_PERIODO} GROUP BY ddd`, F, T),
  ])
  const regioes = juntar('ddd', regL, regM).map((r) => {
    const ddd = r.ddd && r.ddd !== '—' ? String(r.ddd) : null
    const uf = ddd && DDD_UF[ddd] ? DDD_UF[ddd] : null
    return {
      ddd: ddd || '—',
      uf: uf ? uf[0] : '?',
      estado: uf ? uf[1] : (ddd ? 'DDD ' + ddd : 'Não identificado'),
      leads: n(r.leads), matriculas: n(r.matriculas), faturamento: n(r.faturamento),
    }
  }).sort((a, b) =>
    // "Não identificado" sempre por último; o resto por matrículas, depois leads.
    (a.ddd === '—' ? 1 : 0) - (b.ddd === '—' ? 1 : 0) || b.matriculas - a.matriculas || b.leads - a.leads,
  ).slice(0, 30)

  // ── Motivos de perda (perdidos no período, pelo clique em Perdido) ──
  const motivos_perda = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(lr.name, '(sem motivo)') AS motivo, COUNT(*) AS qtd
       FROM bychat_leads l LEFT JOIN bychat_loss_reasons lr ON lr.id=l.lostReasonId
      WHERE l.funnelId IN (${FN}) AND l.outcome='lost' AND l.outcomeAt>=? AND l.outcomeAt<?
      GROUP BY motivo ORDER BY qtd DESC`,
    F, T,
  )).map((r) => ({ motivo: r.motivo, qtd: n(r.qtd) }))

  const nameByKey = new Map(stages.map((s) => [s.key, s.name]))

  // ── Pipeline (SNAPSHOT: leads ABERTOS no funil agora, não coorte) ──
  const pipeRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.status AS \`key\`, COUNT(*) AS qtd,
            ROUND(AVG(DATEDIFF(NOW(), l.lastActivityAt)),1) AS dias_medio,
            SUM(DATEDIFF(NOW(), l.lastActivityAt) > 7) AS parados_7d
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.status NOT IN (${WON}) AND l.status NOT IN (${LOST})
      GROUP BY l.status`,
  )
  const pipeline = {
    abertos: pipeRows.reduce((a, r) => a + n(r.qtd), 0),
    parados_7d: pipeRows.reduce((a, r) => a + n(r.parados_7d), 0),
    por_etapa: stages.filter((s) => tipoEtapa(s.key) === 'open').map((s) => {
      const r = pipeRows.find((x) => x.key === s.key)
      return { etapa: s.name, qtd: r ? n(r.qtd) : 0, dias_medio: r ? n(r.dias_medio) : 0, parados_7d: r ? n(r.parados_7d) : 0 }
    }).filter((e) => e.qtd > 0),
  }

  // ── Jornada ──
  // Ciclo = dias da entrada do lead até o fechamento, das matrículas fechadas no
  // período. Só conta diffs >= 0: leads vindos do Kommo têm createdAt = data da
  // sincronização (às vezes posterior ao pagamento).
  const cicloRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT ROUND(AVG(d),1) AS dias FROM (
        SELECT DATEDIFF(u.dt, DATE(u.createdAt)) AS d FROM ${U} WHERE ${NO_PERIODO}
       ) t WHERE d >= 0`,
    F, T,
  )
  const preRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT SUM(COALESCE(NULLIF(l.source,''), l.originType) IS NOT NULL) AS com, COUNT(*) AS tot
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?`,
    F, T,
  )
  const movRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT m.toStageKey AS k, COUNT(*) AS movs FROM bychat_lead_stage_movements m
      WHERE m.toFunnelId IN (${FN}) AND m.movedAt>=? AND m.movedAt<? GROUP BY m.toStageKey ORDER BY movs DESC`,
    F, T,
  )
  const origMatRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT u.origem, COUNT(*) AS qtd FROM ${U} WHERE ${NO_PERIODO} GROUP BY u.origem ORDER BY qtd DESC`,
    F, T,
  )
  const jornada = {
    ciclo_medio_dias: n(cicloRow[0]?.dias),
    preenchimento_origem: n(preRow[0]?.tot) > 0 ? n(preRow[0]?.com) / n(preRow[0]?.tot) : 0,
    movimentos_por_etapa: movRows.map((r) => ({ etapa: nameByKey.get(r.k) || r.k, movs: n(r.movs) })),
    origem_matricula: origMatRows.map((r) => ({ origem: r.origem, qtd: n(r.qtd) })),
  }

  // ── Matrículas & Auditoria ──
  const listaMat = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT u.leadId, u.negId, u.negs, u.nome, u.curso, ${VEND} AS vendedor, u.valor, u.forma,
            u.data_ganho, DATE_FORMAT(u.dt,'%d/%m/%Y') AS data_pgto, u.pelo_ganho
       FROM ${U} LEFT JOIN bychat_users uu ON uu.id=u.assignedUserId
      WHERE ${NO_PERIODO} ORDER BY u.dt ASC, u.valor DESC LIMIT 500`,
    F, T,
  )
  const porForma = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(u.forma, '(sem forma)') AS forma, COUNT(*) AS qtd, ROUND(SUM(u.valor)) AS valor
       FROM ${U} WHERE ${NO_PERIODO} GROUP BY forma ORDER BY qtd DESC`,
    F, T,
  )
  const pendRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COUNT(*) AS tot, SUM(u.forma IS NULL) AS sem_forma, SUM(u.pelo_ganho) AS sem_data,
            SUM(u.registro IS NULL OR u.registro='') AS sem_registro, SUM(u.negs > 1) AS multi,
            COUNT(DISTINCT u.leadId) AS alunos
       FROM ${U} WHERE ${NO_PERIODO}`,
    F, T,
  )
  const coorteRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COUNT(*) AS q FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND l.createdAt>=? AND l.createdAt<?`,
    F, T,
  )

  // ── Conferência com a Visão Geral do Attrae ──
  // A Visão Geral conta LEADS com clique em Ganho (outcome='won') pela data do
  // clique, em todos os funis. Aqui: por que o número do painel é diferente.
  const vgEmp = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COUNT(*) AS q FROM bychat_leads l
      WHERE l.funnelId IN (${ALL}) AND l.outcome='won' AND l.outcomeAt>=? AND l.outcomeAt<?`, F, T)
  const vgTodos = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(l.funnelId, 0) AS fn, COUNT(*) AS q FROM bychat_leads l
      WHERE l.outcome='won' AND l.outcomeAt>=? AND l.outcomeAt<? GROUP BY fn`, F, T)
  // ganhos no período que NÃO são matrícula fechada no período (pagos em outro mês / card fora da etapa ganha)
  const ganhoForaRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.id, l.nome, ${VEND} AS vendedor, (l.status IN (${WON}) OR l.funnelId IN (${POS})) AS na_etapa,
            DATE_FORMAT(${PAG},'%d/%m/%Y') AS data_pgto
       FROM bychat_leads l LEFT JOIN bychat_users uu ON uu.id=l.assignedUserId
      WHERE l.funnelId IN (${ALL}) AND l.outcome='won' AND l.outcomeAt>=? AND l.outcomeAt<?
        AND l.id NOT IN (SELECT u.leadId FROM ${U} WHERE ${NO_PERIODO})
      ORDER BY vendedor, l.nome`,
    F, T, F, T,
  )
  // matrículas fechadas no período cujo clique em Ganho caiu em outro mês (ou não houve)
  const pagoForaRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT u.leadId AS id, MAX(u.nome) AS nome, MAX(${VEND}) AS vendedor, MAX(u.data_ganho) AS data_ganho, COUNT(*) AS q
       FROM ${U} LEFT JOIN bychat_users uu ON uu.id=u.assignedUserId
      WHERE ${NO_PERIODO} AND NOT (COALESCE(u.outcome,'')='won' AND COALESCE(u.outcomeAt,'1970-01-01')>=? AND COALESCE(u.outcomeAt,'1970-01-01')<?)
      GROUP BY u.leadId ORDER BY vendedor, nome`,
    F, T, F, T,
  )
  const empDeFn = (fn: number) => (Object.keys(EMPRESAS) as EmpresaKey[])
    .find((k) => ([...EMPRESAS[k].funis, ...EMPRESAS[k].posVenda] as number[]).includes(fn))
  const vgPorEmpresa: Record<string, number> = {}
  for (const r of vgTodos) {
    const k = empDeFn(n(r.fn)); const nome = k ? EMPRESAS[k].nome : (n(r.fn) ? 'Outros funis' : 'Sem funil')
    vgPorEmpresa[nome] = (vgPorEmpresa[nome] || 0) + n(r.q)
  }
  const extras = n(pendRow[0]?.tot) - n(pendRow[0]?.alunos)
  const conferencia = {
    visao_geral_empresa: n(vgEmp[0]?.q),
    visao_geral_todos: vgTodos.reduce((a, r) => a + n(r.q), 0),
    visao_geral_por_empresa: Object.entries(vgPorEmpresa).map(([empresa, q]) => ({ empresa, q })),
    cursos_extras: extras,
    ganho_fora: ganhoForaRows.map((r) => ({
      id: n(r.id), nome: r.nome, vendedor: r.vendedor, data_pgto: r.data_pgto,
      motivo: n(r.na_etapa) ? 'pago em ' + (r.data_pgto || 'outra data') : 'card fora da etapa ganha',
    })),
    pago_fora: pagoForaRows.map((r) => ({
      id: n(r.id), nome: r.nome, vendedor: r.vendedor, q: n(r.q),
      motivo: r.data_ganho ? 'Ganho clicado em ' + r.data_ganho : 'card na etapa ganha sem clique em Ganho',
    })),
  }

  const matriculas = {
    coorte: n(coorteRow[0]?.q),
    efetivadas_evento: visao_geral.matriculas,
    faturamento_pago: visao_geral.faturamento,
    alunos: n(pendRow[0]?.alunos),
    por_forma: porForma.map((r) => ({ forma: r.forma, qtd: n(r.qtd), valor: n(r.valor) })),
    pendencias: {
      sem_data: n(pendRow[0]?.sem_data), sem_forma: n(pendRow[0]?.sem_forma),
      sem_registro: n(pendRow[0]?.sem_registro), total: n(pendRow[0]?.tot), multi: n(pendRow[0]?.multi),
    },
    lista: listaMat.map((r) => ({
      lead_id: n(r.leadId), nome: r.nome, curso: r.curso, vendedor: r.vendedor, valor: n(r.valor), forma: r.forma,
      data_ganho: r.data_ganho, data_pgto: r.data_pgto, pgto_pelo_ganho: n(r.pelo_ganho) > 0, multi: n(r.negs) > 1,
    })),
    conferencia,
  }

  // ── Metas & Comissões (tabela COMISSAO_FAIXAS acima) ──────────────────────
  // Base: as MESMAS matrículas fechadas no período (unidade = negociação). Conta
  // por vendedor, separa por forma (boleto/cartão/pix), define a faixa pela qtd
  // total e aplica a taxa da faixa.
  let metas: any = {
    disponivel: false,
    nota: `Tabela de metas e comissões da ${EMPRESAS[empresa].nome} não configurada.`,
  }
  if (EMPRESAS[empresa].comissao) {
    const comiRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT ${VEND} AS vendedor,
              SUM(UPPER(u.forma) LIKE 'BOLETO%') AS boleto,
              SUM(UPPER(u.forma) LIKE '%CART%') AS cartao,
              SUM(UPPER(u.forma) LIKE 'PIX%') AS pix,
              SUM(u.forma IS NULL OR (UPPER(u.forma) NOT LIKE 'BOLETO%' AND UPPER(u.forma) NOT LIKE '%CART%' AND UPPER(u.forma) NOT LIKE 'PIX%')) AS outros,
              COUNT(*) AS total
         FROM ${U} LEFT JOIN bychat_users uu ON uu.id=u.assignedUserId
        WHERE ${NO_PERIODO}
        GROUP BY vendedor HAVING total > 0 ORDER BY total DESC`,
      F, T,
    )
    const faixaDe = (tot: number) => COMISSAO_FAIXAS.find((f) => tot >= f.min) || COMISSAO_FAIXAS[COMISSAO_FAIXAS.length - 1]
    const idxFaixa = (tot: number) => COMISSAO_FAIXAS.findIndex((f) => tot >= f.min)
    const comissaoVendedores = comiRows.map((r) => {
      const boleto = n(r.boleto), cartao = n(r.cartao), pix = n(r.pix), outros = n(r.outros), total = n(r.total)
      const fx = faixaDe(total)
      const idx = idxFaixa(total)
      const prox = idx > 0 ? COMISSAO_FAIXAS[idx - 1] : null
      return {
        vendedor: r.vendedor, total, boleto, cartao, pix, outros,
        faixa: fx.nome, taxa: { boleto: fx.boleto, cartao: fx.cartao, pix: fx.pix },
        comissao: boleto * fx.boleto + cartao * fx.cartao + pix * fx.pix,
        proxima: prox ? { nome: prox.nome, faltam: prox.min - total } : null,
      }
    })
    metas = {
      disponivel: true,
      base: 'data_fechamento',
      faixas: COMISSAO_FAIXAS,
      vendedores: comissaoVendedores,
      totais: {
        matriculas: comissaoVendedores.reduce((a, b) => a + b.total, 0),
        comissao: comissaoVendedores.reduce((a, b) => a + b.comissao, 0),
        sem_forma: comissaoVendedores.reduce((a, b) => a + b.outros, 0),
      },
    }
  }

  return {
    periodo: { from: from.toISOString(), to: to.toISOString(), days },
    empresa: { key: empresa, nome: EMPRESAS[empresa].nome },
    funnelId: FN.split(',').map(Number),
    visao_geral, visao_ant,
    funil, serie_diaria, cursos, vendedores, origens, regioes, motivos_perda,
    pipeline, jornada, matriculas, metas,
  }
}

// ── Marketing ──────────────────────────────────────────────────────────
// Realidade do tenant: Meta tem CUSTO (campaign_costs source=meta_api) mas os
// leads NÃO carregam campaignId (0 atribuídos); Google tem leads (originType=
// google_ads) mas SEM custo. Por isso entregamos entrega de mídia (Meta) +
// leads de mídia (por originType) e deixamos CPL/CAC/ROAS como "não atribuído".
const DAY = 86_400_000
function dayStr(d: Date): string { return d.toISOString().slice(0, 10) }

export async function painelMarketing(periodo: PeriodoIn, funnelId?: number, empresa: EmpresaKey = 'ine') {
  const { from, to, days } = periodo
  const FN = fnList(funnelId, empresa)
  const f = dayStr(from), t = dayStr(to)

  // Totais Meta (só level='campaign' para não multiplicar o gasto por adset/ad).
  const totMeta = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT ROUND(SUM(spend)) AS spend, SUM(impressions) AS impr, SUM(clicks) AS clicks,
            SUM(inlineLinkClicks) AS link_clicks
       FROM bychat_campaign_costs
      WHERE source='meta_api' AND level='campaign' AND date>=? AND date<=?`,
    f, t,
  )
  const m = totMeta[0] || {}
  const spend = n(m.spend), impr = n(m.impr), clicks = n(m.clicks)
  const meta = {
    investimento: spend, impressoes: impr, cliques: clicks,
    ctr: impr > 0 ? clicks / impr : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impr > 0 ? (spend / impr) * 1000 : 0,
    campanhas: (await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT campaignName AS campanha, ROUND(SUM(spend)) AS spend, SUM(impressions) AS impr, SUM(clicks) AS clicks
         FROM bychat_campaign_costs
        WHERE source='meta_api' AND level='campaign' AND date>=? AND date<=?
        GROUP BY campaignName ORDER BY spend DESC LIMIT 30`,
      f, t,
    )).map((r) => ({
      campanha: r.campanha || '(sem nome)', spend: n(r.spend), impr: n(r.impr), clicks: n(r.clicks),
      ctr: n(r.impr) > 0 ? n(r.clicks) / n(r.impr) : 0,
      cpc: n(r.clicks) > 0 ? n(r.spend) / n(r.clicks) : 0,
    })),
  }

  // Leads de mídia (por originType) no funil comercial, no período.
  const AD = `l.originType IN ('google_ads','meta','meta_ads','facebook','instagram','facebook_ads')`
  // Matrículas de mídia = matrículas FECHADAS no período (mesma base do comercial).
  const U = unidadesSql(FN, inList(await wonKeysDe(funnelId, empresa)), posList(funnelId, empresa))
  const [midiaL, midiaM] = await Promise.all([
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT l.originType AS canal, COUNT(*) AS leads
         FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND ${AD} AND l.createdAt>=? AND l.createdAt<?
        GROUP BY l.originType`, fmt(from), fmt(to)),
    prisma.$queryRawUnsafe<Array<any>>(
      `SELECT u.originType AS canal, COUNT(*) AS matriculas FROM ${U}
        WHERE ${AD.replace(/l\./g, 'u.')} AND u.dt >= ? AND u.dt < ? GROUP BY u.originType`, fmt(from), fmt(to)),
  ])
  const midiaRows = juntar('canal', midiaL, midiaM).sort((a, b) => n(b.leads) - n(a.leads))
  const leads_midia = midiaRows.reduce((a, r) => a + n(r.leads), 0)
  const matriculas_midia = midiaRows.reduce((a, r) => a + n(r.matriculas), 0)

  return {
    periodo: { from: from.toISOString(), to: to.toISOString(), days },
    meta,
    leads_midia, matriculas_midia,
    por_canal: midiaRows.map((r) => ({ canal: r.canal, leads: n(r.leads), matriculas: n(r.matriculas) })),
    // Lacunas honestas:
    google: { disponivel: false, nota: 'Sem dado de custo do Google Ads neste tenant.' },
    organico: { disponivel: false, nota: 'Fonte de redes orgânicas ainda não conectada.' },
    cpl_cac_nota: 'CPL/CAC/ROAS não calculados: Meta tem custo sem atribuição de lead, e os leads de Google não têm custo associado.',
  }
}

/** chaves de etapa ganha de um funil (para o bloco de mídia). */
async function wonKeysDe(funnelId?: number, empresa: EmpresaKey = 'ine'): Promise<string[]> {
  const stages = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
    `SELECT \`key\` FROM bychat_stages WHERE funnelId IN (${fnList(funnelId, empresa)})`,
  )
  return stages.map((s) => s.key).filter((k) => tipoEtapa(k) === 'won')
}

/**
 * "Versão" dos dados do painel: muda a cada lead criado/editado ou movimento de
 * etapa nos funis comerciais. A página consulta isto a cada poucos segundos e
 * só recarrega os números (consultas pesadas) quando a versão muda.
 */
export async function painelVersao(funnelId?: number, empresa: EmpresaKey = 'ine'): Promise<string> {
  const FN = fnList(funnelId, empresa)
  const r = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT (SELECT MAX(updatedAt) FROM bychat_leads WHERE funnelId IN (${FN})) AS lu,
            (SELECT COUNT(*) FROM bychat_leads WHERE funnelId IN (${FN})) AS lc,
            (SELECT MAX(id) FROM bychat_lead_stage_movements) AS mv,
            (SELECT MAX(updatedAt) FROM bychat_negotiations) AS nu`,
  )
  const x = r[0] || {}
  return [x.lu ? new Date(x.lu).getTime() : 0, n(x.lc), n(x.mv), x.nu ? new Date(x.nu).getTime() : 0].join('.')
}
