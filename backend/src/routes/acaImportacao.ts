// src/routes/acaImportacao.ts
// Importadores com dry-run (RN-105) — a etapa que decide se uma migração de
// sistema legado dá certo ou deixa a base inconsistente.

import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { analisar, importar, modeloCsv, type TipoImport } from '../services/acaImportador.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const TIPOS: TipoImport[] = ['disciplinas', 'alunos', 'notas_historico', 'titulos']

export async function acaImportacaoRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/importacao/modelo', { preHandler: authMiddleware }, async (req, reply) => {
    const tipo = String((req.query as any)?.tipo || '') as TipoImport
    if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: `tipo deve ser um de: ${TIPOS.join(', ')}` })
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="modelo-${tipo}.csv"`)
      .send(modeloCsv(tipo))
  })

  /** Simulação: valida linha a linha e devolve os erros SEM gravar nada. */
  app.post('/api/admin/aca/importacao/analisar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const tipo = String(b.tipo || '') as TipoImport
    if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: `tipo deve ser um de: ${TIPOS.join(', ')}` })
    if (!b.csv) return reply.code(400).send({ error: 'Envie o conteúdo do arquivo em "csv".' })
    try {
      return await analisar(tipo, String(b.csv))
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  /** Gravação — só depois de o operador ver o relatório da simulação. */
  app.post('/api/admin/aca/importacao/executar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const tipo = String(b.tipo || '') as TipoImport
    if (!TIPOS.includes(tipo)) return reply.code(400).send({ error: `tipo deve ser um de: ${TIPOS.join(', ')}` })
    if (!b.csv) return reply.code(400).send({ error: 'Envie o conteúdo do arquivo em "csv".' })
    if (b.confirmado !== true) return reply.code(400).send({ error: 'Confirme a importação depois de revisar a simulação.' })
    const actor = auditActor(req)
    try {
      const r = await importar(tipo, String(b.csv))
      void logUserAudit({
        action: 'aca.importacao', targetType: 'importacao', targetUserId: null,
        targetLabel: `Importação de ${tipo}: ${r.gravadas} gravada(s)`,
        changes: { tipo, gravadas: r.gravadas, puladas: r.puladas, invalidas: r.invalidas }, ...actor,
      })
      return r
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })
}
