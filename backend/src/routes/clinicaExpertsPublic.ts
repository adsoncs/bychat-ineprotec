// src/routes/clinicaExpertsPublic.ts
//
// As rotas públicas do agendamento em três passos (procedimento → profissional
// → horário).
//
// Ficam em arquivo próprio, e não em `schedulingPublic.ts`, porque aquele
// arquivo é igual nos 13 tenants: qualquer linha nova ali vira conflito na
// próxima replicação. Aqui a superfície compartilhada é zero.
//
// Sem autenticação, como o resto do agendamento público — e por isso tudo é
// validado no servidor: procedimento que não é da linha, profissional que não
// atende, e horário fora da grade são recusados aqui, não na tela.

import { FastifyInstance } from 'fastify'
import { getActiveMeetingType } from '../services/schedulingService.js'
import {
  tipoTemLinha, procedimentosDoTipo, profissionaisDaLinha, validarEscolha, linhaDoTipo,
  slotsDoProfissional,
} from '../services/clinicaExperts/linhaServico.js'
import { scriptDosPassos } from '../services/clinicaExperts/passosScript.js'

export async function clinicaExpertsPublicRoutes(app: FastifyInstance) {
  // ── O script dos passos ──
  // A página pública de agendamento carrega este arquivo sempre; ele só assume
  // o controle quando o tipo tem linha configurada (a própria função verifica).
  // Conteúdo fixo, então pode ser guardado pelo navegador por um tempo.
  app.get('/api/public/clinica-experts/passos.js', async (_req, reply) => {
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(scriptDosPassos())
  })

  // ── O tipo pergunta procedimento/profissional? ──
  // A página pública chama isto antes de desenhar: quem responde `false` segue
  // direto para o calendário, exatamente como antes.
  app.get('/api/public/clinica-experts/:slug/passos', async (req, reply) => {
    const mt = await getActiveMeetingType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const linha = await linhaDoTipo(mt.id)
    if (!linha) return { temLinha: false }
    return {
      temLinha: true,
      escolherProfissional: linha.deixarEscolherProfissional !== false,
    }
  })

  // ── Passo 1: o que a pessoa quer fazer ──
  app.get('/api/public/clinica-experts/:slug/procedimentos', async (req, reply) => {
    const mt = await getActiveMeetingType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const itens = await procedimentosDoTipo(mt.id)
    if (!itens.length) {
      // Catálogo fora do ar não pode deixar o paciente numa tela vazia sem
      // explicação — a página cai para o fluxo simples quando vê isto.
      return reply.code(503).send({ error: 'Não consegui carregar os procedimentos agora.' })
    }
    return { itens }
  })

  // ── Passo 2: com quem ──
  app.get('/api/public/clinica-experts/:slug/profissionais', async (req, reply) => {
    const mt = await getActiveMeetingType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const linha = await linhaDoTipo(mt.id)
    if (!linha) return { itens: [], escolherProfissional: false }
    const itens = await profissionaisDaLinha(mt.id)
    return { itens, escolherProfissional: linha.deixarEscolherProfissional !== false }
  })

  // ── Passo 3: quando ──
  //
  // Com profissional escolhido, os horários são os dele. Sem escolha ("sem
  // preferência"), é a união de quem atende a linha — quem de fato atende só é
  // decidido ao fechar, entre os livres.
  //
  // A duração vem do PROCEDIMENTO, não do tipo: é o que faz "Depilação LED -
  // Nariz" ocupar 5 minutos e "Limpeza de Pele Rosto" ocupar 60, na mesma linha.
  app.get('/api/public/clinica-experts/:slug/horarios', async (req, reply) => {
    const mt = await getActiveMeetingType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const q = (req.query as any) || {}

    const v = await validarEscolha(mt.id, q.procedimento, q.profissional ?? null)
    if (!v.ok) return reply.code(400).send({ error: v.erro })
    const { duracaoMin, usuarioId } = v.escolha

    const alvos = usuarioId
      ? [usuarioId]
      : (await profissionaisDaLinha(mt.id)).map((p) => p.usuarioId)
    if (!alvos.length) return reply.code(503).send({ error: 'Nenhum profissional disponível no momento.' })

    // Um mapa data → horários, para a união entre profissionais não repetir o
    // mesmo horário quando os dois estão livres.
    const porDia = new Map<string, Map<string, { startAt: string; endAt: string; label: string }>>()

    for (const uid of alvos) {
      const dias = await slotsDoProfissional(mt, uid, duracaoMin, { from: q.from || undefined, to: q.to || undefined })
      for (const d of dias) {
        const mapa = porDia.get(d.date) ?? new Map()
        for (const s of d.slots) mapa.set(s.startAt, s)
        porDia.set(d.date, mapa)
      }
    }

    const days = [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, mapa]) => ({
        date,
        weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
        slots: [...mapa.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)),
      }))
      .filter((d) => d.slots.length > 0)

    return { timezone: mt.timezone, durationMin: duracaoMin, days }
  })

  // ── Fechar ──
  //
  // Reaproveita `createBooking` do motor de sempre — o que muda é o que vai
  // gravado junto (procedimento, duração e profissional escolhidos), lido
  // depois pelo espelho. Assim o fluxo novo não duplica nada do que já existe:
  // dedup de lead, trava anti-corrida, atividade, notificação e funil continuam
  // sendo os mesmos.
  app.post('/api/public/clinica-experts/:slug/reservar', async (req, reply) => {
    const mt = await getActiveMeetingType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    if (!(await tipoTemLinha(mt.id))) return reply.code(400).send({ error: 'Este agendamento não usa procedimentos.' })

    const b = (req.body as any) || {}
    const v = await validarEscolha(mt.id, b.procedimento, b.profissional ?? null)
    if (!v.ok) return reply.code(400).send({ error: v.erro })

    const { escolhaParaGravar } = await import('../services/clinicaExperts/linhaServico.js')
    const marcas = await escolhaParaGravar(v.escolha)

    const { criarReservaComEscolha } = await import('../services/clinicaExperts/reserva.js')
    const r = await criarReservaComEscolha(mt, {
      name: b.name, email: b.email, phone: b.phone, startAt: b.startAt,
      answers: { ...(b.answers ?? {}), ...marcas },
      timezone: b.timezone, visitorId: b.visitorId, utm: b.utm,
      escolha: v.escolha,
    })
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return r
  })
}
