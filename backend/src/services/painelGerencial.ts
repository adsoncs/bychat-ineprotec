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

// Escopo comercial do ineprotec: APENAS o funil INE (4). O funil 1 ("MAT") é da
// operação Matrícula EAD (outra empresa) e NÃO entra aqui. As matrículas do
// ineprotec que ficaram no funil 1 (pré-migração) foram consolidadas no 4.
// Um funnelId explícito (>0) ainda permite inspecionar outro funil pontualmente.
const FUNIS_COMERCIAIS = [4]

// Tabela de comissão do ineprotec (comissão POR MATRÍCULA, escalonada pela qtd
// de matrículas do vendedor no mês e pela forma de pagamento). Config do tenant
// — editar aqui (painel não é replicado). Ordenar por `min` DESC.
const COMISSAO_FAIXAS = [
  { nome: 'Super Meta', min: 45, boleto: 25, cartao: 42, pix: 47 },
  { nome: 'Meta 2', min: 35, boleto: 20, cartao: 37, pix: 42 },
  { nome: 'Meta 1', min: 25, boleto: 15, cartao: 25, pix: 30 },
  { nome: 'Base', min: 0, boleto: 10, cartao: 15, pix: 20 },
]
const fnList = (funnelId?: number): string =>
  (funnelId && funnelId > 0 ? [funnelId] : FUNIS_COMERCIAIS)
    .map((f) => Number(f)).filter(Number.isFinite).join(',') || '0'

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
  if (/matricula_realizada|venda_ganha|_ganha$/.test(key)) return 'won'
  if (/matricula_perdida|venda_perdida|_perdida$/.test(key)) return 'lost'
  return 'open'
}
function inList(keys: string[]): string {
  // keys vêm do nosso banco (só [a-z0-9_]) — sanitiza por garantia.
  const safe = keys.map((k) => `'${String(k).replace(/[^a-z0-9_]/gi, '')}'`)
  return safe.length ? safe.join(',') : `''`
}

export interface PeriodoIn { from: Date; to: Date; days: number }

export async function painelComercial(periodo: PeriodoIn, funnelId?: number) {
  const { from, to, days } = periodo
  const FN = fnList(funnelId)
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

  // ── Bloco de totais (coorte) para um intervalo ──
  const totais = async (f: Date, t: Date) => {
    const r = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT
         COUNT(*) AS leads,
         SUM(l.status IN (${WON})) AS matriculas,
         SUM(l.status IN (${LOST})) AS perdas,
         SUM(l.status NOT IN (${WON}) AND l.status NOT IN (${LOST})) AS em_aberto,
         ROUND(SUM(CASE WHEN l.status IN (${WON}) THEN l.saleValue ELSE 0 END)) AS faturamento
       FROM bychat_leads l
       WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?`,
      fmt(f), fmt(t),
    )
    const x = r[0] || {}
    const leads = n(x.leads), matriculas = n(x.matriculas), faturamento = n(x.faturamento)
    return {
      leads,
      matriculas,
      perdas: n(x.perdas),
      em_aberto: n(x.em_aberto),
      faturamento,
      ticket_medio: matriculas > 0 ? Math.round(faturamento / matriculas) : 0,
      conversao: leads > 0 ? matriculas / leads : 0,
    }
  }
  const visao_geral = await totais(from, to)
  const visao_ant = await totais(prevFrom, prevTo)

  // ── Funil (coorte): quantidade por etapa ──
  const funilRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.status AS \`key\`, COUNT(*) AS qtd
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY l.status`,
    fmt(from), fmt(to),
  )
  const qtdPorKey = new Map(funilRows.map((r) => [r.key, n(r.qtd)]))
  const funil = stages.map((s) => ({
    key: s.key, name: s.name, position: n(s.position), tipo: tipoEtapa(s.key), qtd: qtdPorKey.get(s.key) || 0,
  }))

  // ── Série diária (coorte): leads e matrículas por dia de criação ──
  const serieRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT DATE(l.createdAt) AS dia,
            COUNT(*) AS leads,
            SUM(l.status IN (${WON})) AS matriculas
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY DATE(l.createdAt) ORDER BY dia`,
    fmt(from), fmt(to),
  )
  const serie_diaria = serieRows.map((r) => ({
    dia: typeof r.dia === 'string' ? r.dia : new Date(r.dia).toISOString().slice(0, 10),
    leads: n(r.leads), matriculas: n(r.matriculas),
  }))

  // ── Cursos (coorte) ──
  const cursos = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.customFields,'$.curso_de_interesse_1')), '(sem curso)') AS curso,
            COUNT(*) AS leads,
            SUM(l.status IN (${WON})) AS matriculas,
            ROUND(SUM(CASE WHEN l.status IN (${WON}) THEN l.saleValue ELSE 0 END)) AS faturamento
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY curso ORDER BY matriculas DESC, leads DESC LIMIT 30`,
    fmt(from), fmt(to),
  )).map((r) => ({
    curso: r.curso, leads: n(r.leads), matriculas: n(r.matriculas), faturamento: n(r.faturamento),
    ticket_medio: n(r.matriculas) > 0 ? Math.round(n(r.faturamento) / n(r.matriculas)) : 0,
  }))

  // ── Vendedores (coorte) ──
  const vendedores = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(NULLIF(u.displayName,''), u.name, '(SEM RESPONSÁVEL)') AS vendedor,
            COUNT(*) AS leads_atribuidos,
            SUM(l.status IN (${WON})) AS matriculas,
            ROUND(SUM(CASE WHEN l.status IN (${WON}) THEN l.saleValue ELSE 0 END)) AS faturamento,
            SUM(l.status NOT IN (${WON}) AND l.status NOT IN (${LOST}) AND l.lastActivityAt < NOW() - INTERVAL 7 DAY) AS parados_7d
       FROM bychat_leads l LEFT JOIN bychat_users u ON u.id=l.assignedUserId
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY vendedor ORDER BY matriculas DESC, faturamento DESC`,
    fmt(from), fmt(to),
  )).map((r) => ({
    vendedor: r.vendedor, leads_atribuidos: n(r.leads_atribuidos), matriculas: n(r.matriculas),
    faturamento: n(r.faturamento), parados_7d: n(r.parados_7d),
    ticket_medio: n(r.matriculas) > 0 ? Math.round(n(r.faturamento) / n(r.matriculas)) : 0,
  }))

  // ── Origem (coorte): usa source/originType; normaliza vazio ──
  const origens = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(NULLIF(l.source,''), l.originType, '(sem origem)') AS origem,
            COUNT(*) AS leads,
            SUM(l.status IN (${WON})) AS matriculas
       FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY origem ORDER BY leads DESC LIMIT 20`,
    fmt(from), fmt(to),
  )).map((r) => ({ origem: r.origem, leads: n(r.leads), matriculas: n(r.matriculas) }))
  const totLeads = origens.reduce((a, b) => a + b.leads, 0) || 1
  origens.forEach((o: any) => { o.pct = o.leads / totLeads })

  // ── Região (coorte): por DDD do telefone → UF/estado ──
  // DDD extraído do número (55 + DDD + assinante, ou DDD + assinante). `cidade`
  // é esparso demais; o DDD cobre quase todos os leads.
  const regioes = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT ddd, COUNT(*) AS leads, SUM(won) AS matriculas,
            ROUND(SUM(CASE WHEN won THEN val ELSE 0 END)) AS faturamento
       FROM (
         SELECT CASE WHEN ph LIKE '55%' AND LENGTH(ph)>=12 THEN SUBSTRING(ph,3,2)
                     WHEN LENGTH(ph) IN (10,11) THEN SUBSTRING(ph,1,2) ELSE NULL END AS ddd,
                won, val
           FROM (
             SELECT REGEXP_REPLACE(COALESCE(l.whatsapp, l.phoneKey, ''), '[^0-9]', '') AS ph,
                    (l.status IN (${WON})) AS won, l.saleValue AS val
               FROM bychat_leads l
              WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?
           ) a
       ) b
      GROUP BY ddd ORDER BY matriculas DESC, leads DESC LIMIT 30`,
    fmt(from), fmt(to),
  )).map((r) => {
    const ddd = r.ddd ? String(r.ddd) : null
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
  )

  // ── Motivos de perda (coorte dos perdidos) ──
  const motivos_perda = (await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(lr.name, '(sem motivo)') AS motivo, COUNT(*) AS qtd
       FROM bychat_leads l LEFT JOIN bychat_loss_reasons lr ON lr.id=l.lostReasonId
      WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<? AND l.status IN (${LOST})
      GROUP BY motivo ORDER BY qtd DESC`,
    fmt(from), fmt(to),
  )).map((r) => ({ motivo: r.motivo, qtd: n(r.qtd) }))

  const nameByKey = new Map(stages.map((s) => [s.key, s.name]))
  const J = (p: string) => `JSON_UNQUOTE(JSON_EXTRACT(l.customFields,'$.${p}'))`

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
  // Ciclo = dias de createdAt até a data de pagamento. Só conta diffs >= 0:
  // leads vindos do Kommo têm createdAt = data da sincronização (às vezes
  // posterior ao pagamento), o que geraria ciclo negativo/sem sentido.
  const cicloRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT ROUND(AVG(d),1) AS dias FROM (
        SELECT DATEDIFF(STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y'), DATE(l.createdAt)) AS d
          FROM bychat_leads l
         WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND l.createdAt>=? AND l.createdAt<?
           AND STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y') IS NOT NULL
       ) t WHERE d >= 0`,
    fmt(from), fmt(to),
  )
  const preRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT SUM(COALESCE(NULLIF(l.source,''), l.originType) IS NOT NULL) AS com, COUNT(*) AS tot
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.createdAt>=? AND l.createdAt<?`,
    fmt(from), fmt(to),
  )
  const movRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT m.toStageKey AS k, COUNT(*) AS movs FROM bychat_lead_stage_movements m
      WHERE m.toFunnelId IN (${FN}) AND m.movedAt>=? AND m.movedAt<? GROUP BY m.toStageKey ORDER BY movs DESC`,
    fmt(from), fmt(to),
  )
  const origMatRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(NULLIF(l.source,''), l.originType, '(sem origem)') AS origem, COUNT(*) AS qtd
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND l.createdAt>=? AND l.createdAt<?
      GROUP BY origem ORDER BY qtd DESC`,
    fmt(from), fmt(to),
  )
  const jornada = {
    ciclo_medio_dias: n(cicloRow[0]?.dias),
    preenchimento_origem: n(preRow[0]?.tot) > 0 ? n(preRow[0]?.com) / n(preRow[0]?.tot) : 0,
    movimentos_por_etapa: movRows.map((r) => ({ etapa: nameByKey.get(r.k) || r.k, movs: n(r.movs) })),
    origem_matricula: origMatRows.map((r) => ({ origem: r.origem, qtd: n(r.qtd) })),
  }

  // ── Matrículas & Auditoria (coorte won; + efetivadas por data do evento) ──
  // Efetivadas POR DATA DE PAGAMENTO (customField data_pagamento_matricula),
  // que é a âncora usada pela secretaria/planilha de fechamento — diferente da
  // coorte (createdAt). Conta os ganhos cujo pagamento caiu no período.
  const efetRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COUNT(*) AS q, ROUND(SUM(l.saleValue)) AS fat FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.status IN (${WON})
        AND STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y') >= ?
        AND STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y') < ?`,
    fmt(from), fmt(to),
  )
  // Página de Matrículas = o que o empresário lê como "fechadas no mês":
  // tudo POR DATA DE PAGAMENTO (não por createdAt). PAG = a data de pagamento.
  const PAG = `STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y')`
  const listaMat = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.nome AS nome, ${J('curso_de_interesse_1')} AS curso,
            COALESCE(NULLIF(u.displayName,''), u.name) AS vendedor, l.saleValue AS valor,
            ${J('forma_pagamento')} AS forma,
            DATE_FORMAT(l.saleDetectedAt,'%d/%m/%Y') AS data_ganho,
            ${J('data_pagamento_matricula')} AS data_pgto
       FROM bychat_leads l LEFT JOIN bychat_users u ON u.id=l.assignedUserId
      WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND ${PAG} >= ? AND ${PAG} < ?
      ORDER BY ${PAG} ASC, l.saleValue DESC LIMIT 500`,
    fmt(from), fmt(to),
  )
  const porForma = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(NULLIF(${J('forma_pagamento')},''), '(sem forma)') AS forma, COUNT(*) AS qtd,
            ROUND(SUM(l.saleValue)) AS valor
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND ${PAG} >= ? AND ${PAG} < ?
      GROUP BY forma ORDER BY qtd DESC`,
    fmt(from), fmt(to),
  )
  const pendRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT SUM(${J('forma_pagamento')} IS NULL OR ${J('forma_pagamento')}='') AS sem_forma,
            SUM(${J('registro_atendimento')} IS NULL OR ${J('registro_atendimento')}='') AS sem_registro,
            COUNT(*) AS tot
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND ${PAG} >= ? AND ${PAG} < ?`,
    fmt(from), fmt(to),
  )
  // Alerta: matrículas ganhas (lead criado no período) SEM data de pagamento —
  // aconteceram mas não entram na contagem do mês até a data ser lançada.
  const semDataRow = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COUNT(*) AS q FROM bychat_leads l
      WHERE l.funnelId IN (${FN}) AND l.status IN (${WON}) AND l.createdAt>=? AND l.createdAt<?
        AND (${J('data_pagamento_matricula')} IS NULL OR ${J('data_pagamento_matricula')}='')`,
    fmt(from), fmt(to),
  )
  const matriculas = {
    coorte: visao_geral.matriculas,
    efetivadas_evento: n(efetRow[0]?.q),
    faturamento_pago: n(efetRow[0]?.fat),
    por_forma: porForma.map((r) => ({ forma: r.forma, qtd: n(r.qtd), valor: n(r.valor) })),
    pendencias: {
      sem_data: n(semDataRow[0]?.q), sem_forma: n(pendRow[0]?.sem_forma),
      sem_registro: n(pendRow[0]?.sem_registro), total: n(pendRow[0]?.tot),
    },
    lista: listaMat.map((r) => ({
      nome: r.nome, curso: r.curso, vendedor: r.vendedor, valor: n(r.valor), forma: r.forma,
      data_ganho: r.data_ganho, data_pgto: r.data_pgto,
    })),
  }

  // ── Metas & Comissões (tabela COMISSAO_FAIXAS acima) ──────────────────────
  // Base: matrículas EFETIVADAS no período por DATA DE PAGAMENTO (o mesmo
  // critério que o time usa no fechamento). Conta por vendedor, separa por forma
  // (boleto/cartão/pix), define a faixa pela qtd total e aplica a taxa da faixa.
  const FP = J('forma_pagamento')
  const comiRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT COALESCE(NULLIF(u.displayName,''), u.name, '(SEM RESPONSÁVEL)') AS vendedor,
            SUM(UPPER(${FP}) LIKE 'BOLETO%') AS boleto,
            SUM(UPPER(${FP}) LIKE '%CART%') AS cartao,
            SUM(UPPER(${FP}) LIKE 'PIX%') AS pix,
            SUM(${FP} IS NULL OR (UPPER(${FP}) NOT LIKE 'BOLETO%' AND UPPER(${FP}) NOT LIKE '%CART%' AND UPPER(${FP}) NOT LIKE 'PIX%')) AS outros,
            COUNT(*) AS total
       FROM bychat_leads l LEFT JOIN bychat_users u ON u.id=l.assignedUserId
      WHERE l.funnelId IN (${FN}) AND l.status IN (${WON})
        AND STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y') >= ?
        AND STR_TO_DATE(${J('data_pagamento_matricula')},'%d/%m/%Y') < ?
      GROUP BY vendedor HAVING total > 0 ORDER BY total DESC`,
    fmt(from), fmt(to),
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
  const metas = {
    disponivel: true,
    base: 'data_pagamento',
    faixas: COMISSAO_FAIXAS,
    vendedores: comissaoVendedores,
    totais: {
      matriculas: comissaoVendedores.reduce((a, b) => a + b.total, 0),
      comissao: comissaoVendedores.reduce((a, b) => a + b.comissao, 0),
      sem_forma: comissaoVendedores.reduce((a, b) => a + b.outros, 0),
    },
  }

  return {
    periodo: { from: from.toISOString(), to: to.toISOString(), days },
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

export async function painelMarketing(periodo: PeriodoIn, funnelId?: number) {
  const { from, to, days } = periodo
  const FN = fnList(funnelId)
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
  const midiaRows = await prisma.$queryRawUnsafe<Array<any>>(
    `SELECT l.originType AS canal, COUNT(*) AS leads,
            SUM(l.status IN (${inList(await wonKeysDe(funnelId))})) AS matriculas
       FROM bychat_leads l WHERE l.funnelId IN (${FN}) AND ${AD} AND l.createdAt>=? AND l.createdAt<?
      GROUP BY l.originType ORDER BY leads DESC`,
    fmt(from), fmt(to),
  )
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
async function wonKeysDe(funnelId?: number): Promise<string[]> {
  const stages = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
    `SELECT \`key\` FROM bychat_stages WHERE funnelId IN (${fnList(funnelId)})`,
  )
  return stages.map((s) => s.key).filter((k) => tipoEtapa(k) === 'won')
}
