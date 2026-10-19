// src/routes/volumetria.ts
//
// Volumetria — Relatórios › Volumetrias. Quem vê é decidido pelo módulo
// `volumetria` (core) em Permissões: nasce para SUPERADMIN e ADMIN.
//
// A tela é a visão do CLIENTE: volumes e o valor final cobrado. Custo real,
// câmbio, margem, regra de preço e o uso de IA por funcionalidade/modelo ficam
// na loja central — e saem daqui antes de chegar ao navegador, não só da tela.

import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { competenciaAtual, volumetriaDoMes } from '../services/volumetria.js'
import { prisma } from '../lib/prisma.js'

export async function volumetriaRoutes(app: FastifyInstance) {
  // O gate do módulo (modulePermissionHook, prefixo /api/volumetria) decide quem
  // passa; aqui só a autenticação.
  app.get('/api/volumetria', { preHandler: [authMiddleware] }, async (req, reply) => {
    const competencia = String((req.query as any)?.competencia ?? competenciaAtual())
    try {
      const volumetria = await volumetriaDoMes(competencia)
      // A cobrança calculada pela loja (se já calculou este mês).
      const cobranca = (await prisma.setting.findUnique({ where: { key: `consumo.cobranca.${competencia}` } }))?.value ?? null
      return paraOCliente(volumetria, cobranca)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
}

/** Só volumes e valores finais — nada de custo, câmbio, margem ou regra. */
function paraOCliente(v: Awaited<ReturnType<typeof volumetriaDoMes>>, cobranca: unknown) {
  const { ia, whatsappCloud, evolution, ...resto } = v
  const c = cobranca as Record<string, any> | null
  return {
    ...resto,
    ia: {
      medindoDesde: ia.medindoDesde,
      chamadas: ia.chamadas,
      tokens: ia.porFuncionalidade.reduce((s, f) => s + f.tokens, 0),
      // O cliente precisa saber O QUE consome IA e QUANTO cada recurso gastou.
      // Vai so VOLUME (chamadas e tokens, abertos por tipo): `custoUsd` fica de
      // fora como todo custo real — ele e da loja central, nao do cliente.
      porFuncionalidade: ia.porFuncionalidade.map((f) => ({
        funcionalidade: f.funcionalidade, chamadas: f.chamadas, tokens: f.tokens,
        entrada: f.entrada, saida: f.saida, cacheEscrita: f.cacheEscrita, cacheLeitura: f.cacheLeitura,
      })),
    },
    whatsappCloud: {
      enviadas: whatsappCloud.enviadas,
      recebidas: whatsappCloud.recebidas,
      leadsUnicos: whatsappCloud.leadsUnicos,
      porCategoria: whatsappCloud.porCategoria.map((x) => ({ categoria: x.categoria, enviadas: x.enviadas, cobraveis: x.cobraveis })),
      porNumero: whatsappCloud.porNumero,
    },
    evolution: { enviadas: evolution.enviadas, recebidas: evolution.recebidas, leadsUnicos: evolution.leadsUnicos, porNumero: evolution.porNumero },
    cobranca: c && {
      competencia: c.competencia, situacao: c.situacao ?? null, parcial: !!c.parcial, calculadoEm: c.calculadoEm ?? null,
      impostoPct: c.impostoPct ?? null, subtotalCentavos: c.subtotalCentavos ?? 0, impostosCentavos: c.impostosCentavos ?? 0,
      totalCentavos: c.totalCentavos ?? 0, vencimento: c.vencimento ?? null, linkPagamento: c.linkPagamento ?? null,
      // "Incluído no plano" só existe quando o item tem franquia.
      plano: (Array.isArray(c.plano) ? c.plano : []).map((p: any) => ({
        codigo: p.codigo, nome: p.nome, unidade: p.unidade, cobrar: !!p.cobrar,
        incluido: p.cobrar && p.modo === 'franquia' ? (p.franquia ?? 0) : null,
      })),
      itens: (Array.isArray(c.itens) ? c.itens : []).map((i: any) => ({
        codigo: i.codigo, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, valorCentavos: i.valorCentavos ?? 0,
      })),
    },
  }
}
