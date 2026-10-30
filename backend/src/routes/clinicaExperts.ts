// src/routes/clinicaExperts.ts
//
// Configuração da integração com a agenda da Clinica Experts.
//
// A tela precisa de três coisas: guardar o token, dizer qual profissional de lá
// atende cada tipo de reunião daqui, e provar que a ligação funciona antes de o
// primeiro paciente descobrir que não funciona.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { chamar, normalizarPagina } from '../services/clinicaExperts/client.js'
import { getConfig, salvarConfig } from '../services/clinicaExperts/config.js'
import { importarOcupacao } from '../services/clinicaExperts/ocupacao.js'
import { processarWebhook, segredoConfere, urlDoWebhook } from '../services/clinicaExperts/webhook.js'
import { esquecerCatalogo } from '../services/clinicaExperts/linhaServico.js'

/** O token nunca volta inteiro para a tela — só o suficiente para o operador
 *  reconhecer qual está gravado. */
function mascarar(token: string): string {
  if (!token) return ''
  if (token.length <= 8) return '••••'
  return `${token.slice(0, 4)}••••${token.slice(-4)}`
}

export async function clinicaExpertsRoutes(app: FastifyInstance) {
  // ── Ler a configuração ──
  app.get('/api/admin/clinica-experts/config', { preHandler: adminOnly }, async () => {
    const cfg = await getConfig()
    return {
      ok: true,
      config: { ...cfg, token: mascarar(cfg.token), tokenConfigurado: !!cfg.token },
    }
  })

  // ── Gravar ──
  app.put('/api/admin/clinica-experts/config', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const parcial: Record<string, unknown> = {}

    // Token só é gravado quando vem preenchido: a tela devolve o valor
    // mascarado ao salvar outros campos, e gravá-lo apagaria o token real.
    if (typeof b.token === 'string' && b.token.trim() && !b.token.includes('••')) {
      parcial.token = b.token.trim()
    }
    if (typeof b.ativo === 'boolean') parcial.ativo = b.ativo
    if (typeof b.importarOcupacao === 'boolean') parcial.importarOcupacao = b.importarOcupacao
    // Quem é quem: usuário daqui → profissional da clínica.
    if (b.profissionalPorUsuario && typeof b.profissionalPorUsuario === 'object') {
      parcial.profissionalPorUsuario = Object.fromEntries(
        Object.entries(b.profissionalPorUsuario)
          .filter(([k, v]) => /^\d+$/.test(String(k)) && typeof v === 'string' && v)
          .map(([k, v]) => [String(k), String(v)]),
      )
    }
    // Linhas de serviço: o que cada tipo oferece e quem atende.
    if (b.linhas && typeof b.linhas === 'object') {
      const limpas: Record<string, unknown> = {}
      for (const [tipoId, valor] of Object.entries(b.linhas as Record<string, any>)) {
        if (!/^\d+$/.test(String(tipoId)) || !valor || typeof valor !== 'object') continue
        const procedimentos = Array.isArray(valor.procedimentos)
          ? [...new Set(valor.procedimentos.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
          : []
        const usuarios = Array.isArray(valor.usuarios)
          ? [...new Set(valor.usuarios.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
          : []
        limpas[String(tipoId)] = {
          procedimentos,
          usuarios,
          deixarEscolherProfissional: valor.deixarEscolherProfissional !== false,
        }
      }
      parcial.linhas = limpas
    }
    if (b.profissionalPorTipo && typeof b.profissionalPorTipo === 'object') {
      parcial.profissionalPorTipo = Object.fromEntries(
        Object.entries(b.profissionalPorTipo)
          .filter(([k, v]) => /^\d+$/.test(String(k)) && typeof v === 'string' && v)
          .map(([k, v]) => [String(k), String(v)]),
      )
    }
    for (const campo of ['procedimentoPadraoId', 'salaPadraoId'] as const) {
      if (campo in b) parcial[campo] = b[campo] === null || b[campo] === '' ? null : Number(b[campo])
    }
    if (b.diasDeOcupacao !== undefined) {
      const d = Number(b.diasDeOcupacao)
      if (!Number.isFinite(d) || d < 1 || d > 180) {
        return reply.code(400).send({ error: 'A janela de ocupação precisa estar entre 1 e 180 dias' })
      }
      parcial.diasDeOcupacao = Math.round(d)
    }

    const cfg = await salvarConfig(parcial)
    // O catálogo de procedimentos fica em memória por 10 minutos; salvar a
    // configuração é justamente quando alguém quer ver o efeito na hora.
    esquecerCatalogo()
    return { ok: true, config: { ...cfg, token: mascarar(cfg.token), tokenConfigurado: !!cfg.token } }
  })

  // ── Testar a conexão ──
  // Bate num endpoint barato e devolve o que a clínica respondeu. É o que
  // separa "token errado" de "integração desligada" de "clínica fora do ar".
  app.post('/api/admin/clinica-experts/testar', { preHandler: adminOnly }, async () => {
    try {
      const r = await chamar<any>('/professionals', { query: { per_page: 1 } })
      const { meta } = normalizarPagina<any>(r)
      return { ok: true, mensagem: `Conexão certa — a clínica tem ${meta?.of ?? '?'} profissional(is) cadastrado(s).` }
    } catch (e: any) {
      return { ok: false, erro: e?.message ?? String(e), status: e?.status ?? 0 }
    }
  })

  // ── Listas de apoio para a tela de configuração ──
  app.get('/api/admin/clinica-experts/profissionais', { preHandler: adminOnly }, async () => {
    try {
      const r = await chamar<any>('/professionals', { query: { per_page: 100, active: true } })
      const { itens } = normalizarPagina<any>(r)
      return { ok: true, itens: itens.map((p) => ({ uuid: p.uuid, nome: p.name, email: p.email ?? null })) }
    } catch (e: any) {
      return { ok: false, erro: e?.message ?? String(e), itens: [] }
    }
  })

  app.get('/api/admin/clinica-experts/procedimentos', { preHandler: adminOnly }, async () => {
    try {
      const r = await chamar<any>('/procedures', { query: { per_page: 100 } })
      const { itens } = normalizarPagina<any>(r)
      return { ok: true, itens: itens.map((p) => ({ id: p.id, nome: p.name, duracao: p.duration ?? null })) }
    } catch (e: any) {
      return { ok: false, erro: e?.message ?? String(e), itens: [] }
    }
  })

  // Tipos de reunião daqui, para montar o de-para na tela.
  app.get('/api/admin/clinica-experts/tipos', { preHandler: adminOnly }, async () => {
    const tipos = await prisma.meetingType.findMany({
      where: { active: true },
      select: { id: true, name: true, durationMin: true, ownerUserId: true },
      orderBy: { id: 'asc' },
    })
    return { ok: true, itens: tipos }
  })

  // ── Reimportar a ocupação agora ──
  app.post('/api/admin/clinica-experts/importar-ocupacao', { preHandler: adminOnly }, async () => {
    const r = await importarOcupacao()
    return { ok: !r.erro, ...r }
  })

  // ── Usuários daqui, para o de-para com os profissionais da clínica ──
  app.get('/api/admin/clinica-experts/usuarios', { preHandler: adminOnly }, async () => {
    const itens = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    return { ok: true, itens }
  })

  // ── Sugestão de quem atende o quê, vinda da clínica ──
  //
  // Devolvido como SUGESTÃO, nunca aplicado sozinho. Medido no cadastro real:
  // dos 100 procedimentos ativos, 57 não têm profissional nenhum, e o mais
  // vinculado (20 procedimentos) está inativo lá. Além disso, a clínica
  // identifica o profissional por id numérico dentro do procedimento e por uuid
  // na listagem — sem chave comum, o casamento é por nome e pode falhar.
  app.get('/api/admin/clinica-experts/sugestao-vinculos', { preHandler: adminOnly }, async () => {
    try {
      const profs = normalizarPagina<any>(await chamar<any>('/professionals', { query: { per_page: 100 } })).itens
      const porNome = new Map(profs.map((p) => [String(p.name || '').trim().toLowerCase(), p]))

      const procedimentos: Array<{ id: number; nome: string; duracao: number | null; profissionais: Array<{ nome: string; uuid: string | null; ativo: boolean | null }> }> = []
      let page = 1
      while (page <= 6) {
        const r = await chamar<any>('/procedures', { query: { per_page: 100, page } })
        const { itens, meta } = normalizarPagina<any>(r)
        for (const p of itens) {
          if (!p?.id || p.active === false) continue
          procedimentos.push({
            id: Number(p.id),
            nome: String(p.name ?? ''),
            duracao: p.duration ?? null,
            profissionais: (p.professionals ?? []).map((pr: any) => {
              const achado = porNome.get(String(pr?.name || '').trim().toLowerCase())
              return { nome: String(pr?.name ?? ''), uuid: achado?.uuid ?? null, ativo: achado ? !!achado.active : null }
            }),
          })
        }
        if (!meta || page >= (meta.last_page ?? 1)) break
        page++
      }
      const semProfissional = procedimentos.filter((p) => !p.profissionais.length).length
      return { ok: true, procedimentos, semProfissional, total: procedimentos.length }
    } catch (e: any) {
      return { ok: false, erro: e?.message ?? String(e), procedimentos: [] }
    }
  })

  // ── Webhook ──
  // A URL carrega o segredo: a API deles não assina os avisos, então não há o
  // que conferir no corpo. Vale como as URLs de webhook do Stripe/Meta antes da
  // assinatura: quem tem a URL, fala.
  app.get('/api/admin/clinica-experts/webhook-url', { preHandler: adminOnly }, async (req) => {
    const base = process.env.APP_URL || `${req.protocol}://${req.hostname}`
    return { ok: true, url: await urlDoWebhook(base), eventos: 'Assine os eventos de booking (created, updated, rescheduled, cancelled, noshow, confirmed, deleted).' }
  })

  // Rota pública, chamada pela clínica.
  app.post('/api/public/clinica-experts/webhook/:segredo', async (req, reply) => {
    const segredo = String((req.params as any).segredo || '')
    if (!(await segredoConfere(segredo))) {
      // 404 em vez de 401: não confirma que a URL existe para quem está tentando adivinhar.
      return reply.code(404).send({ error: 'Not found' })
    }
    // Sempre 200. Erro aqui vira reentrega em laço do lado deles, e o payload
    // não é documentado — não dá para tratar formato inesperado como falha.
    const r = await processarWebhook(req.body).catch((e) => {
      req.log.warn(`[clinicaExperts/webhook] falhou: ${e?.message ?? e}`)
      return { aceito: true, evento: null, acao: 'erro registrado' }
    })
    return reply.code(200).send({ ok: true, ...r })
  })

  // ── Estado do espelho ──
  app.get('/api/admin/clinica-experts/status', { preHandler: adminOnly }, async () => {
    const [agendamentos, pacientes, bloqueios] = await Promise.all([
      prisma.clinicaExpertsMapping.count({ where: { entityType: 'booking' } }),
      prisma.clinicaExpertsMapping.count({ where: { entityType: 'patient' } }),
      prisma.calendarBlock.count({ where: { source: 'clinica_experts', endAt: { gt: new Date() } } }),
    ])
    return { ok: true, agendamentosEspelhados: agendamentos, pacientesLigados: pacientes, horariosBloqueados: bloqueios }
  })
}
