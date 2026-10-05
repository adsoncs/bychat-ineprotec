/**
 * Tráfego do WhatsApp (Evolution) — o painel de volumetria para o dono do
 * negócio: quanto entra, quanto sai, quando os clientes falam, quem responde,
 * em quanto tempo e quem está esperando agora.
 *
 *  • GET /api/whatsapp/trafego?de=AAAA-MM-DD&ate=AAAA-MM-DD&instancia=&tipo=
 *
 * É o par da tela "Disparos & Custos" (que cobre a API oficial). Aqui não há
 * custo por mensagem; o que importa é volume, resposta e capacidade.
 *
 * Decisões que mudam o número — e por isso estão escritas:
 *  • Datas e horas no fuso de Brasília (-03:00). O banco grava em UTC.
 *  • Nota interna não conta: o contato nunca a viu.
 *  • Número reservado que a pessoa não pode ver fica FORA de tudo — inclusive
 *    dos totais. Volume de uma linha pessoal também é dado dela.
 *  • Tempo de resposta é medido em conversas individuais (em grupo ninguém
 *    "espera resposta" de um jeito mensurável), em horas corridas — não
 *    desconta o fora do expediente.
 *  • "Resposta de uma pessoa" é a primeira mensagem enviada por atendente ou
 *    pelo celular depois que o cliente escreveu. Robô e automação respondem em
 *    segundos e esconderiam a espera real; contam à parte.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'

const FUSO = '-03:00'
const DIA = 86_400_000

type Tipo = 'individual' | 'grupo' | 'todos'
type Autor = 'atendente' | 'celular' | 'robo' | 'automacao' | 'nao_identificado'

/** Datas do filtro (dia local) → instantes UTC [início, fim). */
function intervalo(de: string, ate: string): { ini: Date; fim: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return null
  const ini = new Date(`${de}T00:00:00${FUSO}`)
  const fim = new Date(new Date(`${ate}T00:00:00${FUSO}`).getTime() + DIA)
  if (isNaN(ini.getTime()) || isNaN(fim.getTime()) || fim <= ini) return null
  if (fim.getTime() - ini.getTime() > 400 * DIA) return null
  return { ini, fim }
}

const n = (v: unknown) => Number(v ?? 0)

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
function percentil(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!
}

export async function whatsappTrafegoRoutes(app: FastifyInstance) {
  app.get('/api/whatsapp/trafego', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as Record<string, string | undefined>
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const padraoDe = new Date(Date.now() - 3 * 3600_000 - 29 * DIA).toISOString().slice(0, 10)
    const de = q.de || padraoDe
    const ate = q.ate || hoje
    const per = intervalo(de, ate)
    if (!per) return reply.code(400).send({ error: 'Período inválido (use AAAA-MM-DD, até 400 dias).' })
    const tipo: Tipo = q.tipo === 'grupo' || q.tipo === 'todos' ? q.tipo : 'individual'
    const instancia = q.instancia ? String(q.instancia) : null

    // Números reservados que esta pessoa não vê: fora de tudo, inclusive do filtro.
    const { canaisOcultosPara } = await import('../services/channelVisibility.js')
    const ocultas = (await canaisOcultosPara(user.userId, user.role)).instancias
    if (instancia && ocultas.includes(instancia)) return reply.code(403).send({ error: 'Número reservado.' })

    const todasInstancias = await prisma.whatsAppInstance.findMany({
      select: { instanceName: true, name: true, phone: true, active: true, color: true },
      orderBy: { createdAt: 'asc' },
    })
    const instancias = todasInstancias.filter((i) => !ocultas.includes(i.instanceName))

    // ── Filtro comum (SQL + parâmetros) ─────────────────────────────────
    const filtro = (opts: { semTipo?: boolean } = {}) => {
      const w: string[] = [`m.provider = 'evolution'`, `m.isInternal = 0`]
      const p: unknown[] = []
      if (instancia) { w.push('m.evolutionInstance = ?'); p.push(instancia) }
      if (ocultas.length) {
        w.push(`(m.evolutionInstance IS NULL OR m.evolutionInstance NOT IN (${ocultas.map(() => '?').join(',')}))`)
        p.push(...ocultas)
      }
      if (!opts.semTipo && tipo !== 'todos') w.push(`l.isGroup = ${tipo === 'grupo' ? 1 : 0}`)
      return { sql: w.join(' AND '), p }
    }
    const f = filtro()
    const noPeriodo = (ini: Date, fim: Date) => ({ sql: `${f.sql} AND m.timestamp >= ? AND m.timestamp < ?`, p: [...f.p, ini, fim] })
    // Período de comparação: o que a tela mandar (o seletor padrão compara mês
    // com mês); sem ele, o mesmo número de dias imediatamente antes.
    const duracao = per.fim.getTime() - per.ini.getTime()
    const antInformado = q.antDe && q.antAte ? intervalo(q.antDe, q.antAte) : null
    const anterior = antInformado ?? { ini: new Date(per.ini.getTime() - duracao), fim: per.ini }
    const tz = `CONVERT_TZ(m.timestamp, '+00:00', '${FUSO}')`

    const totaisDe = async (ini: Date, fim: Date) => {
      const w = noPeriodo(ini, fim)
      const [r] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT SUM(m.fromMe = 0) recebidas, SUM(m.fromMe = 1) enviadas,
                COUNT(DISTINCT m.leadId) conversas,
                COUNT(DISTINCT CASE WHEN m.fromMe = 0 THEN m.leadId END) conversasComCliente
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql}`, ...w.p)
      return { recebidas: n(r?.recebidas), enviadas: n(r?.enviadas), conversas: n(r?.conversas), conversasComCliente: n(r?.conversasComCliente) }
    }

    // Contatos novos: a PRIMEIRA mensagem da conversa (no recorte de número e
    // tipo) caiu no período. Quem mandou a primeira diz se o contato chegou
    // sozinho ou se foi a empresa que abordou.
    const primeiras = await prisma.$queryRawUnsafe<any[]>(
      `SELECT x.leadId, x.f, x.primeiroFromMe, x.primeiraInst FROM (
         SELECT m.leadId, MIN(m.timestamp) f,
                SUBSTRING_INDEX(GROUP_CONCAT(m.fromMe ORDER BY m.timestamp, m.id), ',', 1) primeiroFromMe,
                SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(m.evolutionInstance, '') ORDER BY m.timestamp, m.id), ',', 1) primeiraInst
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${f.sql}
          GROUP BY m.leadId) x
        WHERE x.f >= ? AND x.f < ?`, ...f.p, new Date(Math.min(anterior.ini.getTime(), per.ini.getTime())), per.fim)
    const novos = { total: 0, chegaram: 0, abordados: 0, anterior: 0 }
    const novosPorDia = new Map<string, number>()
    const novosPorInst = new Map<string, number>()
    for (const r of primeiras) {
      const t = new Date(r.f)
      if (t >= per.ini && t < per.fim) {
        novos.total++
        const ni = String(r.primeiraInst ?? '')
        novosPorInst.set(ni, (novosPorInst.get(ni) ?? 0) + 1)
        if (String(r.primeiroFromMe) === '1') novos.abordados++; else novos.chegaram++
        const dia = new Date(t.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
        novosPorDia.set(dia, (novosPorDia.get(dia) ?? 0) + 1)
      } else if (t >= anterior.ini && t < anterior.fim) novos.anterior++
    }

    const w = noPeriodo(per.ini, per.fim)
    const [totais, totaisAnt, porDia, mapaCalor, porAutor, porInstancia, entrega, midia, porDiaInst, comTrafego] = await Promise.all([
      totaisDe(per.ini, per.fim),
      totaisDe(anterior.ini, anterior.fim),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT DATE(${tz}) dia, SUM(m.fromMe = 0) recebidas, SUM(m.fromMe = 1) enviadas, COUNT(DISTINCT m.leadId) conversas
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} GROUP BY dia ORDER BY dia`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT WEEKDAY(${tz}) dow, HOUR(${tz}) hora, COUNT(*) qtd
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} AND m.fromMe = 0 GROUP BY dow, hora`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT m.senderName nome, COUNT(*) qtd, COUNT(DISTINCT m.leadId) conversas
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} AND m.fromMe = 1 GROUP BY m.senderName`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT m.evolutionInstance inst, SUM(m.fromMe = 0) recebidas, SUM(m.fromMe = 1) enviadas, COUNT(DISTINCT m.leadId) conversas
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} GROUP BY m.evolutionInstance`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT CASE WHEN m.ack < 0 THEN 'falha' WHEN m.ack = 0 THEN 'pendente' WHEN m.ack = 1 THEN 'enviada'
                     WHEN m.ack = 2 THEN 'entregue' ELSE 'lida' END estado, COUNT(*) qtd
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} AND m.fromMe = 1 GROUP BY estado`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(NULLIF(m.mediaType, ''), 'text') tipo, SUM(m.fromMe = 0) recebidas, SUM(m.fromMe = 1) enviadas
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} GROUP BY tipo ORDER BY COUNT(*) DESC`, ...w.p),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT DATE(${tz}) dia, m.evolutionInstance inst, SUM(m.fromMe = 0) recebidas, SUM(m.fromMe = 1) enviadas
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${w.sql} GROUP BY dia, inst`, ...w.p),
      // Números que já trocaram mensagem, cadastrados ou não — o seletor
      // mostra todos (um número apagado do cadastro continua tendo histórico).
      prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT m.evolutionInstance inst FROM bychat_messages m
          WHERE m.provider = 'evolution' AND m.evolutionInstance IS NOT NULL`),
    ])

    // ── Quem envia: atendente, celular, robô, automação ─────────────────
    const [usuarios, robos] = await Promise.all([
      prisma.user.findMany({ select: { name: true, email: true } }),
      prisma.chatbot.findMany({ select: { name: true } }).catch(() => [] as { name: string }[]),
    ])
    const nomesUsuarios = new Set(usuarios.flatMap((u) => [u.name, u.email]).filter(Boolean).map((s) => String(s).trim().toLowerCase()))
    const nomesRobos = new Set(robos.map((r) => r.name.trim().toLowerCase()))
    const autorDe = (nome: string | null): Autor => {
      const s = (nome ?? '').trim().toLowerCase()
      if (!s) return 'nao_identificado'
      if (s === 'equipe (pelo celular)' || s === 'celular') return 'celular'
      if (nomesUsuarios.has(s)) return 'atendente'
      if (nomesRobos.has(s) || s === 'ia' || s === 'chatbot') return 'robo'
      return 'automacao'
    }
    const humano = (a: Autor) => a === 'atendente' || a === 'celular' || a === 'nao_identificado'

    const composicao: Record<Autor, number> = { atendente: 0, celular: 0, robo: 0, automacao: 0, nao_identificado: 0 }
    const atendentes = new Map<string, { nome: string; enviadas: number; conversas: number; respondidas: number; tempos: number[] }>()
    for (const r of porAutor) {
      const a = autorDe(r.nome)
      composicao[a] += n(r.qtd)
      if (a === 'atendente') {
        atendentes.set(String(r.nome).trim().toLowerCase(), { nome: String(r.nome), enviadas: n(r.qtd), conversas: n(r.conversas), respondidas: 0, tempos: [] })
      }
    }

    // ── Resposta: quem escreveu, quanto esperou, quem respondeu ─────────
    // Só conversas individuais. Uma "espera" começa na mensagem do cliente
    // depois de uma nossa (ou a primeira do período) e termina na primeira
    // resposta de uma pessoa. Robô no meio não encerra a espera — o cliente
    // continua esperando gente — mas fica registrado.
    const resposta = { esperas: 0, respondidasPorPessoa: 0, soRobo: 0, semResposta: 0, tempos: [] as number[] }
    const faixas = { ate5min: 0, ate15min: 0, ate1h: 0, ate4h: 0, ate24h: 0, mais24h: 0 }
    const respostaPorInstancia = new Map<string, { esperas: number; respondidas: number; tempos: number[] }>()
    if (tipo !== 'grupo') {
      const fi = filtro({ semTipo: true })
      const linhas = await prisma.$queryRawUnsafe<any[]>(
        `SELECT m.leadId, m.fromMe, m.timestamp, m.senderName, m.evolutionInstance inst
           FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
          WHERE ${fi.sql} AND l.isGroup = 0 AND m.timestamp >= ? AND m.timestamp < ?
          ORDER BY m.leadId, m.timestamp, m.id`, ...fi.p, per.ini, per.fim)
      let lead = -1
      let espera: { desde: number; inst: string; robo: boolean } | null = null
      const fecharSemResposta = () => {
        if (!espera) return
        if (espera.robo) resposta.soRobo++; else resposta.semResposta++
        const pi = respostaPorInstancia.get(espera.inst) ?? { esperas: 0, respondidas: 0, tempos: [] }
        pi.esperas++
        respostaPorInstancia.set(espera.inst, pi)
        espera = null
      }
      for (const r of linhas) {
        const id = n(r.leadId)
        if (id !== lead) { fecharSemResposta(); lead = id }
        const t = new Date(r.timestamp).getTime()
        if (String(r.fromMe) === '0' || r.fromMe === false) {
          if (!espera) { espera = { desde: t, inst: String(r.inst ?? ''), robo: false }; resposta.esperas++ }
          continue
        }
        if (!espera) continue
        const autor = autorDe(r.senderName)
        if (!humano(autor)) { espera.robo = true; continue }
        const seg = Math.max(0, (t - espera.desde) / 1000)
        resposta.respondidasPorPessoa++
        resposta.tempos.push(seg)
        if (seg <= 300) faixas.ate5min++
        else if (seg <= 900) faixas.ate15min++
        else if (seg <= 3600) faixas.ate1h++
        else if (seg <= 4 * 3600) faixas.ate4h++
        else if (seg <= 86_400) faixas.ate24h++
        else faixas.mais24h++
        const pi = respostaPorInstancia.get(espera.inst) ?? { esperas: 0, respondidas: 0, tempos: [] }
        pi.esperas++; pi.respondidas++; pi.tempos.push(seg)
        respostaPorInstancia.set(espera.inst, pi)
        if (autor === 'atendente') {
          const at = atendentes.get(String(r.senderName).trim().toLowerCase())
          if (at) { at.respondidas++; at.tempos.push(seg) }
        }
        espera = null
      }
      fecharSemResposta()
    }

    // ── Esperando agora (independe do período) ──────────────────────────
    // Conversa individual cuja última mensagem (nos últimos 7 dias) é do
    // cliente e que não foi encerrada depois dela.
    const fa = filtro({ semTipo: true })
    const esperando = await prisma.$queryRawUnsafe<any[]>(
      `SELECT m.timestamp, m.evolutionInstance inst FROM bychat_messages m
         JOIN (SELECT m.leadId, MAX(m.id) mid FROM bychat_messages m JOIN bychat_leads l ON l.id = m.leadId
                WHERE ${fa.sql} AND l.isGroup = 0 AND m.timestamp >= ? GROUP BY m.leadId) u ON u.mid = m.id
         JOIN bychat_leads l ON l.id = m.leadId
        WHERE m.fromMe = 0 AND (l.conversationClosedAt IS NULL OR l.conversationClosedAt < m.timestamp)`,
      ...fa.p, new Date(Date.now() - 7 * DIA))
    const agora = Date.now()
    const esperaAgora = { total: esperando.length, ate1h: 0, ate4h: 0, ate24h: 0, mais24h: 0, maisAntigaMin: 0 }
    const esperandoPorInst = new Map<string, number>()
    for (const r of esperando) {
      const ei = String(r.inst ?? '')
      esperandoPorInst.set(ei, (esperandoPorInst.get(ei) ?? 0) + 1)
      const min = (agora - new Date(r.timestamp).getTime()) / 60_000
      esperaAgora.maisAntigaMin = Math.max(esperaAgora.maisAntigaMin, Math.round(min))
      if (min <= 60) esperaAgora.ate1h++
      else if (min <= 240) esperaAgora.ate4h++
      else if (min <= 1440) esperaAgora.ate24h++
      else esperaAgora.mais24h++
    }

    // ── Série diária completa (dias sem mensagem entram com zero) ───────
    const porDiaMap = new Map(porDia.map((r) => [new Date(r.dia).toISOString().slice(0, 10), r]))
    const serie: Array<{ dia: string; recebidas: number; enviadas: number; conversas: number; novos: number }> = []
    for (let t = new Date(`${de}T12:00:00Z`).getTime(); t <= new Date(`${ate}T12:00:00Z`).getTime(); t += DIA) {
      const dia = new Date(t).toISOString().slice(0, 10)
      const r = porDiaMap.get(dia)
      serie.push({ dia, recebidas: n(r?.recebidas), enviadas: n(r?.enviadas), conversas: n(r?.conversas), novos: novosPorDia.get(dia) ?? 0 })
    }

    const nomeInst = new Map(todasInstancias.map((i) => [i.instanceName, i]))
    const diasDaSerie = serie.map((x) => x.dia)
    const seriePorInst = new Map<string, Map<string, { recebidas: number; enviadas: number }>>()
    for (const r of porDiaInst) {
      const k = String(r.inst ?? '')
      const m = seriePorInst.get(k) ?? new Map()
      m.set(new Date(r.dia).toISOString().slice(0, 10), { recebidas: n(r.recebidas), enviadas: n(r.enviadas) })
      seriePorInst.set(k, m)
    }
    const cadastradas = new Set(instancias.map((i) => i.instanceName))
    const listaNumeros = [
      ...instancias.map((i) => ({ instanceName: i.instanceName, nome: i.name || i.instanceName, telefone: i.phone, ativo: i.active, cor: i.color, cadastrado: true })),
      ...comTrafego
        .map((r) => String(r.inst))
        .filter((nm) => !cadastradas.has(nm) && !ocultas.includes(nm))
        .map((nm) => ({ instanceName: nm, nome: nm, telefone: null, ativo: false, cor: null, cadastrado: false })),
    ]
    return {
      periodo: {
        de, ate,
        anteriorDe: new Date(anterior.ini.getTime() - 3 * 3600_000).toISOString().slice(0, 10),
        anteriorAte: new Date(anterior.fim.getTime() - 3 * 3600_000 - 1).toISOString().slice(0, 10),
      },
      filtros: { tipo, instancia },
      instancias: listaNumeros,
      totais: { ...totais, novos: novos.total },
      anterior: { ...totaisAnt, novos: novos.anterior },
      novos,
      resposta: {
        esperas: resposta.esperas,
        respondidasPorPessoa: resposta.respondidasPorPessoa,
        soRobo: resposta.soRobo,
        semResposta: resposta.semResposta,
        medianaSeg: mediana(resposta.tempos),
        p90Seg: percentil(resposta.tempos, 90),
        faixas,
        aplica: tipo !== 'grupo',
      },
      esperaAgora,
      serie,
      mapaCalor: mapaCalor.map((r) => ({ dow: n(r.dow), hora: n(r.hora), qtd: n(r.qtd) })),
      composicao,
      atendentes: [...atendentes.values()]
        .map((a) => ({ nome: a.nome, enviadas: a.enviadas, conversas: a.conversas, respondidas: a.respondidas, medianaSeg: mediana(a.tempos) }))
        .sort((a, b) => b.enviadas - a.enviadas),
      porInstancia: porInstancia.map((r) => {
        const inst = r.inst ? String(r.inst) : null
        const ri = respostaPorInstancia.get(inst ?? '')
        const cad = inst ? nomeInst.get(inst) : undefined
        const porDiaDele = seriePorInst.get(inst ?? '')
        return {
          instanceName: inst,
          nome: inst ? (cad?.name || inst) : 'Sem número identificado',
          telefone: cad?.phone ?? null,
          ativo: cad?.active ?? null,
          cadastrado: !!cad,
          recebidas: n(r.recebidas), enviadas: n(r.enviadas), conversas: n(r.conversas),
          novos: novosPorInst.get(inst ?? '') ?? 0,
          esperandoAgora: esperandoPorInst.get(inst ?? '') ?? 0,
          esperas: ri?.esperas ?? 0, respondidas: ri?.respondidas ?? 0, medianaSeg: mediana(ri?.tempos ?? []),
          serie: diasDaSerie.map((dia) => porDiaDele?.get(dia) ?? { recebidas: 0, enviadas: 0 }),
        }
      }).sort((a, b) => (b.recebidas + b.enviadas) - (a.recebidas + a.enviadas)),
      entrega: Object.fromEntries(entrega.map((r) => [String(r.estado), n(r.qtd)])),
      midia: midia.map((r) => ({ tipo: String(r.tipo), recebidas: n(r.recebidas), enviadas: n(r.enviadas) })),
    }
  })
}
