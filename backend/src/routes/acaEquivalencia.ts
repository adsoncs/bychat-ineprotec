// src/routes/acaEquivalencia.ts
//
// Equivalências N:1 e 1:N (RF-502). A tabela antiga (AcaEquivalencia) resolve
// pares 1:1; casos compostos precisam de grupo, porque a dispensa só vale se
// TODOS os componentes de origem estiverem cumpridos — "Cálculo A + Cálculo B
// equivalem a Cálculo Único" não pode dispensar com metade cursada.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Anexa nome da disciplina a cada item, para a tela não fazer N consultas. */
async function comNomes(grupos: Array<{ itens: Array<{ componenteId: number }> }>) {
  const ids = [...new Set(grupos.flatMap((g) => g.itens.map((i) => i.componenteId)))]
  if (ids.length === 0) return new Map<number, string>()
  const comps = await prisma.acaComponente.findMany({
    where: { id: { in: ids } },
    select: { id: true, disciplina: { select: { nome: true } }, matriz: { select: { versao: true } } },
  })
  return new Map(comps.map((c) => [c.id, `${c.disciplina?.nome ?? `#${c.id}`} (matriz ${c.matriz?.versao ?? '—'})`]))
}

export async function acaEquivalenciaRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/equivalencia-grupos', { preHandler: authMiddleware }, async () => {
    const grupos = await prisma.acaEquivalenciaGrupo.findMany({
      where: { ativo: true },
      orderBy: { id: 'desc' },
      include: { itens: true },
    })
    const nomes = await comNomes(grupos)
    return {
      grupos: grupos.map((g) => ({
        ...g,
        origem: g.itens.filter((i) => i.lado === 'ORIGEM').map((i) => ({ ...i, nome: nomes.get(i.componenteId) ?? `#${i.componenteId}` })),
        destino: g.itens.filter((i) => i.lado === 'DESTINO').map((i) => ({ ...i, nome: nomes.get(i.componenteId) ?? `#${i.componenteId}` })),
      })),
    }
  })

  app.post('/api/admin/aca/equivalencia-grupos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const origem: number[] = Array.isArray(b.origem) ? b.origem.map(Number).filter(Boolean) : []
    const destino: number[] = Array.isArray(b.destino) ? b.destino.map(Number).filter(Boolean) : []
    if (!b.nome) return reply.code(400).send({ error: 'nome é obrigatório' })
    if (origem.length === 0 || destino.length === 0) {
      return reply.code(400).send({ error: 'informe ao menos um componente de origem e um de destino' })
    }
    const repetido = origem.filter((id) => destino.includes(id))
    if (repetido.length > 0) {
      return reply.code(400).send({ error: 'um mesmo componente não pode estar na origem e no destino' })
    }
    const grupo = await prisma.acaEquivalenciaGrupo.create({
      data: {
        nome: String(b.nome).substring(0, 191),
        observacao: b.observacao ?? null,
        bidirecional: !!b.bidirecional,
        itens: {
          create: [
            ...origem.map((componenteId) => ({ componenteId, lado: 'ORIGEM' as const })),
            ...destino.map((componenteId) => ({ componenteId, lado: 'DESTINO' as const })),
          ],
        },
      },
      include: { itens: true },
    })
    return reply.code(201).send({ grupo })
  })

  app.delete('/api/admin/aca/equivalencia-grupos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    await prisma.acaEquivalenciaGrupo.update({ where: { id }, data: { ativo: false } })
    return { ok: true }
  })

  /**
   * O que o aluno pode dispensar por equivalência, dado o que já cumpriu.
   * Só devolve o grupo quando TODOS os componentes de origem estão cumpridos —
   * é a regra que diferencia N:1 de uma soma de pares 1:1.
   */
  app.get('/api/admin/aca/vinculos/:id/equivalencias-aplicaveis', { preHandler: authMiddleware }, async (req, reply) => {
    const vinculoId = num((req.params as any).id)
    if (!vinculoId) return reply.code(400).send({ error: 'id inválido' })

    const { calcular } = await import('../services/acaIntegralizacao.js')
    const integ = await calcular(vinculoId).catch(() => null)
    if (!integ) return reply.code(404).send({ error: 'Vínculo não encontrado' })

    const cumpridos = new Set(
      integ.componentes.filter((c) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO').map((c) => c.componenteId),
    )
    const pendentes = new Set(
      integ.componentes.filter((c) => c.status === 'PENDENTE' || c.status === 'BLOQUEADO' || c.status === 'REPROVADO').map((c) => c.componenteId),
    )

    const grupos = await prisma.acaEquivalenciaGrupo.findMany({ where: { ativo: true }, include: { itens: true } })
    const nomes = await comNomes(grupos)
    const aplicaveis: any[] = []

    for (const g of grupos) {
      const origem = g.itens.filter((i) => i.lado === 'ORIGEM').map((i) => i.componenteId)
      const destino = g.itens.filter((i) => i.lado === 'DESTINO').map((i) => i.componenteId)

      const testar = (de: number[], para: number[]) =>
        de.length > 0 && de.every((id) => cumpridos.has(id)) && para.some((id) => pendentes.has(id))

      if (testar(origem, destino)) {
        aplicaveis.push({
          grupoId: g.id, nome: g.nome, sentido: 'origem→destino',
          cumpriu: origem.map((id) => nomes.get(id) ?? `#${id}`),
          dispensa: destino.filter((id) => pendentes.has(id)).map((id) => ({ componenteId: id, nome: nomes.get(id) ?? `#${id}` })),
        })
      } else if (g.bidirecional && testar(destino, origem)) {
        aplicaveis.push({
          grupoId: g.id, nome: g.nome, sentido: 'destino→origem',
          cumpriu: destino.map((id) => nomes.get(id) ?? `#${id}`),
          dispensa: origem.filter((id) => pendentes.has(id)).map((id) => ({ componenteId: id, nome: nomes.get(id) ?? `#${id}` })),
        })
      }
    }
    return { aplicaveis, total: aplicaveis.length }
  })
}
