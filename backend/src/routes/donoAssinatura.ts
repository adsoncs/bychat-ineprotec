// src/routes/donoAssinatura.ts
//
// O painel do dono: o que está pago, o que está vencendo, e o que ele pode
// fazer à mão.
//
// Existe porque parte do dinheiro entra por fora — PIX, transferência — e nunca
// passa pelo provedor. Sem uma tela, "marcar setembro como pago" dependia de
// alguém abrir o banco, e esticar a carência de um cliente que avisou que paga
// na sexta era editar SQL em produção.
//
// ⚠️ Toda rota aqui responde 404 para quem não é dono, não 403. O superadmin do
// cliente não precisa saber que existe uma loja do outro lado — e descrever a
// tranca ajuda quem tenta abri-la. Ver lib/dono.ts.
//
// ⚠️ Nada aqui lê ou escreve `Setting`: a configuração da loja mora em
// `bychat_loja_config`, fora do alcance da tela de configurações. Ver 0160.

import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { exigirDono } from '../lib/dono.js'
import { prisma } from '../lib/prisma.js'
import {
  MODULE_REGISTRY, UMBRELLA_LABELS, UMBRELLA_ORDER, UMBRELLA_REQUIRES,
  type ModuleUmbrella,
} from '../lib/moduleRegistry.js'
import {
  estadoDoPacote, assinaturaDoPacote, carenciaDias, testeDias, modulosComDireito,
  marcarComoPago, estenderCarencia, iniciarTeste,
  pacotesDisponiveis, modulosDoPacote, PacoteIndisponivelError,
} from '../services/moduleEntitlements.js'

const MEIOS = ['pix', 'transferencia', 'dinheiro', 'outro'] as const
type Meio = (typeof MEIOS)[number]

function ehPacote(v: unknown): v is ModuleUmbrella {
  return typeof v === 'string' && (UMBRELLA_ORDER as string[]).includes(v)
}

/** E-mail de quem está fazendo — é o que fica no registro do dinheiro. */
function quem(req: unknown): string {
  const u = (req as { user?: { email?: string; userId?: number } }).user
  return u?.email ?? `usuario:${u?.userId ?? '?'}`
}

export async function donoAssinaturaRoutes(app: FastifyInstance) {
  const soDono = { preHandler: [authMiddleware, exigirDono] }

  // ── O retrato ───────────────────────────────────────────────────────────
  app.get('/api/dono/assinatura', soDono, async () => {
    const disponiveis = pacotesDisponiveis()
    const comDireito = await modulosComDireito()

    const pacotes = await Promise.all(
      UMBRELLA_ORDER.map(async (p) => {
        const ids = modulosDoPacote(p)
        const st = await estadoDoPacote(p)
        // Acesso e assinatura são perguntas diferentes — ver assinaturaDoPacote.
        const ass = await assinaturaDoPacote(p)
        return {
          id: p,
          rotulo: UMBRELLA_LABELS[p],
          // Um pacote que a instalação não roda não é "sem direito": é algo que
          // não existe aqui. Misturar os dois faria a tela oferecer ERP a uma
          // imobiliária.
          instalado: disponiveis.includes(p),
          modulos: ids.length,
          modulosComDireito: ids.filter((id) => comDireito.has(id)).length,
          exige: (UMBRELLA_REQUIRES[p] ?? []).map((e) => ({ id: e, rotulo: UMBRELLA_LABELS[e] })),
          estado: st.estado,
          expiraEm: st.expiraEm,
          diasRestantes: st.diasRestantes,
          assinatura: ass,
        }
      }),
    )

    const eventos = await prisma.assinaturaEvento.findMany({
      orderBy: { id: 'desc' }, take: 50,
    })

    return {
      pacotes,
      eventos,
      config: { carenciaDias: await carenciaDias(), testeDias: await testeDias() },
      // O total de módulos que a instalação roda, para a tela poder dizer
      // "60 de 81" sem recontar do seu lado.
      instalacao: {
        modulos: MODULE_REGISTRY.length,
        vendaveis: MODULE_REGISTRY.filter((m) => !m.core).length,
      },
    }
  })

  // ── Baixa manual ────────────────────────────────────────────────────────
  app.post('/api/dono/assinatura/pago', soDono, async (req, reply) => {
    const b = req.body as {
      pacote?: unknown; competencia?: unknown; meses?: unknown
      valorCentavos?: unknown; meio?: unknown; observacao?: unknown
    }
    if (!ehPacote(b.pacote)) return reply.code(400).send({ error: 'Pacote inválido' })
    if (typeof b.competencia !== 'string' || !/^\d{4}-\d{2}$/.test(b.competencia)) {
      return reply.code(400).send({ error: 'Competência deve ser AAAA-MM (ex.: 2026-09)' })
    }
    const meses = Number(b.meses ?? 1)
    if (!Number.isInteger(meses) || meses < 1 || meses > 36) {
      return reply.code(400).send({ error: 'Meses deve ser um número inteiro de 1 a 36' })
    }
    // Valor em centavos, sempre: guardar reais como decimal é como se perde
    // centavo em conferência de caixa.
    let valorCentavos: number | undefined
    if (b.valorCentavos !== undefined && b.valorCentavos !== null && b.valorCentavos !== '') {
      valorCentavos = Number(b.valorCentavos)
      if (!Number.isInteger(valorCentavos) || valorCentavos < 0) {
        return reply.code(400).send({ error: 'Valor inválido' })
      }
    }
    const meio = b.meio as Meio | undefined
    if (meio && !MEIOS.includes(meio)) return reply.code(400).send({ error: 'Meio de pagamento inválido' })

    try {
      const r = await marcarComoPago({
        pacote: b.pacote, competencia: b.competencia, meses,
        ...(valorCentavos !== undefined ? { valorCentavos } : {}),
        ...(meio ? { meio } : {}),
        ...(typeof b.observacao === 'string' && b.observacao ? { observacao: b.observacao.slice(0, 500) } : {}),
        feitoPor: quem(req),
      })
      return { ok: true, ...r }
    } catch (e) {
      if (e instanceof PacoteIndisponivelError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })

  // ── Esticar a carência ──────────────────────────────────────────────────
  app.post('/api/dono/assinatura/carencia', soDono, async (req, reply) => {
    const b = req.body as { dias?: unknown; motivo?: unknown }
    const dias = Number(b.dias)
    if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
      return reply.code(400).send({ error: 'Carência deve ser um número inteiro de 0 a 365 dias' })
    }
    await estenderCarencia({
      dias,
      ...(typeof b.motivo === 'string' && b.motivo ? { motivo: b.motivo.slice(0, 300) } : {}),
      feitoPor: quem(req),
    })
    return { ok: true, dias }
  })

  // ── Teste grátis ────────────────────────────────────────────────────────
  app.post('/api/dono/assinatura/teste', soDono, async (req, reply) => {
    const b = req.body as { pacote?: unknown }
    if (!ehPacote(b.pacote)) return reply.code(400).send({ error: 'Pacote inválido' })
    try {
      const r = await iniciarTeste({ pacote: b.pacote, feitoPor: quem(req) })
      return { ok: true, ...r }
    } catch (e) {
      if (e instanceof PacoteIndisponivelError) return reply.code(409).send({ error: e.message })
      throw e
    }
  })
}
