// Runner — executa um conector: query, mapeia rows pra leads, cria,
// atualiza cursor, salva DbConnectorRun. Idempotente via Lead.sourceId.

import { prisma } from '../../lib/prisma.js'
import { getAdapter, decryptPassword } from './index.js'
import type { ConnectorMapping, LeadFieldTarget } from './types.js'
import { generateUid } from '../dedup.js'
import { pickOperatorForTeam } from '../teamRouting.js'
import { logEvent, EVENT_TYPES } from '../leadHistory.js'

interface RunOptions {
  triggeredBy: 'cron' | 'manual' | 'test'
  triggeredByUserId?: number | null
  /** quando true, NÃO cria leads — só faz preview e devolve as primeiras N rows */
  dryRun?: boolean
  dryRunLimit?: number
}

interface RunSummary {
  runId: number | null
  rowsRead: number
  leadsCreated: number
  leadsSkipped: number
  errors: number
  cursorBefore: string | null
  cursorAfter: string | null
  preview?: Record<string, unknown>[]
}

export async function runConnector(connectorId: number, opts: RunOptions): Promise<RunSummary> {
  const connector = await prisma.dbConnector.findUnique({ where: { id: connectorId } })
  if (!connector) throw new Error(`Conector ${connectorId} não encontrado`)
  if (!connector.active && opts.triggeredBy === 'cron') {
    return { runId: null, rowsRead: 0, leadsCreated: 0, leadsSkipped: 0, errors: 0, cursorBefore: null, cursorAfter: null }
  }

  const cursorBefore = connector.lastSyncCursor
  let run = opts.dryRun ? null : await prisma.dbConnectorRun.create({
    data: {
      connectorId,
      status: 'running',
      cursorBefore,
      triggeredBy: opts.triggeredBy,
      ...(opts.triggeredByUserId ? { triggeredByUserId: opts.triggeredByUserId } : {}),
    },
  })

  if (!opts.dryRun) {
    await prisma.dbConnector.update({
      where: { id: connectorId },
      data: { lastRunStatus: 'running', lastError: null },
    })
  }

  let rowsRead = 0, leadsCreated = 0, leadsSkipped = 0, errors = 0
  let cursorAfter: string | null = cursorBefore
  let preview: Record<string, unknown>[] = []

  try {
    const adapter = getAdapter(connector.dbType as any)
    const password = decryptPassword(connector.passwordEnc)
    const result = await adapter.executeQuery(
      {
        dbType: connector.dbType as any,
        host: connector.host,
        port: connector.port,
        dbName: connector.dbName,
        dbUser: connector.dbUser,
        password,
        useTLS: connector.useTLS,
        caCert: connector.caCert,
      },
      connector.query,
      cursorBefore,
    )
    rowsRead = result.rowCount

    if (opts.dryRun) {
      preview = result.rows.slice(0, opts.dryRunLimit ?? 5)
      return { runId: null, rowsRead, leadsCreated: 0, leadsSkipped: 0, errors: 0, cursorBefore, cursorAfter, preview }
    }

    const mapping = (connector.mapping ?? {}) as ConnectorMapping
    for (const row of result.rows) {
      try {
        const mapped = mapRowToLead(row, mapping)
        if (!mapped.nome && !mapped.email && !mapped.whatsapp) {
          leadsSkipped++
          continue
        }

        // Dedup por sourceId+source (se sourceId presente)
        if (mapped.sourceId) {
          const existing = await prisma.lead.findFirst({
            where: { source: `db_connector:${connectorId}`, sourceId: String(mapped.sourceId) },
            select: { id: true },
          })
          if (existing) { leadsSkipped++; continue }
        }

        // Routing default
        let assignedUserId: number | null = null
        if (connector.defaultTeamId) {
          assignedUserId = await pickOperatorForTeam(connector.defaultTeamId)
        }

        const lead = await prisma.lead.create({
          data: {
            uid: await generateUid(),
            nome: mapped.nome || '',
            email: mapped.email || '',
            whatsapp: mapped.whatsapp || '',
            empresa: mapped.empresa || mapped.nome || 'Lead BD',
            segmento: mapped.segmento || null,
            cidade: mapped.cidade || null,
            formData: { _source: 'db_connector', _connectorId: connectorId, _row: row },
            scores: {},
            customFields: Object.keys(mapped.customFields).length > 0 ? mapped.customFields : undefined,
            status: connector.defaultStageKey || 'NOVO',
            teamId: connector.defaultTeamId ?? null,
            assignedUserId,
            assignedAt: assignedUserId ? new Date() : null,
            ...(connector.defaultFunnelId ? { funnelId: connector.defaultFunnelId } : {}),
            ...(mapped.createdAt ? { createdAt: mapped.createdAt } : {}),
            completed: false,
            source: `db_connector:${connectorId}`,
            sourceId: mapped.sourceId ? String(mapped.sourceId) : null,
            utmSource: mapped.utm.source,
            utmMedium: mapped.utm.medium,
            utmCampaign: mapped.utm.campaign,
            utmContent: mapped.utm.content,
            utmTerm: mapped.utm.term,
            gclid: mapped.gclid,
            originType: 'db_connector',
            qualifiedAt: new Date(),
            qualificationSource: 'db_connector',
          },
        })

        logEvent({
          leadId: lead.id,
          type: EVENT_TYPES.LEAD_CREATED,
          category: 'lifecycle',
          title: `Lead importado de conector BD: ${connector.name}`,
          actorType: 'integration',
          source: `db_connector:${connectorId}`,
          metadata: { connectorId, sourceId: mapped.sourceId, rawRow: row },
        })

        leadsCreated++

        // Atualiza cursor conforme strategy
        if (connector.deltaStrategy !== 'none' && connector.deltaColumn) {
          const cursorVal = row[connector.deltaColumn]
          if (cursorVal !== undefined && cursorVal !== null) {
            const asStr = cursorVal instanceof Date ? cursorVal.toISOString() : String(cursorVal)
            if (!cursorAfter || cursorIsGreater(asStr, cursorAfter, connector.deltaStrategy)) {
              cursorAfter = asStr
            }
          }
        }
      } catch (rowErr: any) {
        errors++
      }
    }

    await prisma.dbConnector.update({
      where: { id: connectorId },
      data: {
        lastSyncCursor: cursorAfter,
        lastRunAt: new Date(),
        lastRunStatus: errors > 0 && leadsCreated === 0 ? 'error' : 'ok',
        lastError: errors > 0 ? `${errors} row(s) com erro` : null,
        totalImported: { increment: leadsCreated },
      },
    })

    if (run) {
      await prisma.dbConnectorRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: errors > 0 ? (leadsCreated > 0 ? 'partial' : 'error') : 'ok',
          rowsRead, leadsCreated, leadsSkipped, errorCount: errors, cursorAfter,
        },
      })
    }

    return { runId: run?.id ?? null, rowsRead, leadsCreated, leadsSkipped, errors, cursorBefore, cursorAfter }
  } catch (err: any) {
    if (run) {
      await prisma.dbConnectorRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: 'error', error: err?.message?.slice(0, 1000) ?? 'Erro' },
      })
    }
    await prisma.dbConnector.update({
      where: { id: connectorId },
      data: { lastRunAt: new Date(), lastRunStatus: 'error', lastError: err?.message?.slice(0, 1000) ?? 'Erro' },
    })
    throw err
  }
}

// ─── helpers ───────────────────────────────────────────────────────

interface MappedLead {
  nome: string
  email: string
  whatsapp: string
  empresa: string
  cidade: string | null
  segmento: string | null
  customFields: Record<string, unknown>
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null }
  gclid: string | null
  sourceId: string | null
  createdAt: Date | null
}

function mapRowToLead(row: Record<string, unknown>, mapping: ConnectorMapping): MappedLead {
  const out: MappedLead = {
    nome: '', email: '', whatsapp: '', empresa: '',
    cidade: null, segmento: null,
    customFields: {},
    utm: { source: null, medium: null, campaign: null, content: null, term: null },
    gclid: null,
    sourceId: null, createdAt: null,
  }
  const concatParts: string[] = []

  for (const [col, target] of Object.entries(mapping)) {
    const raw = row[col]
    if (raw === undefined || raw === null || raw === '') continue
    const val = String(raw).trim()
    if (!val) continue

    if (target === 'nome')           out.nome = val
    else if (target === 'concat:nome') concatParts.push(val)
    else if (target === 'email')     out.email = val.toLowerCase()
    else if (target === 'whatsapp')  out.whatsapp = normalizePhone(val)
    else if (target === 'empresa')   out.empresa = val
    else if (target === 'cidade')    out.cidade = val
    else if (target === 'segmento')  out.segmento = val
    else if (target.startsWith('cf:')) out.customFields[target.slice(3)] = val
    else if (target === 'utm:source')   out.utm.source = val
    else if (target === 'utm:medium')   out.utm.medium = val
    else if (target === 'utm:campaign') out.utm.campaign = val
    else if (target === 'utm:content')  out.utm.content = val
    else if (target === 'utm:term')     out.utm.term = val
    else if (target === 'meta:page_url') {
      // Parseia UTMs + Google Click ID da URL automaticamente. Params extras
      // (utm_adgroup/device/matchtype/network/loc, gbraid, gad_source/_campaignid)
      // viram customFields pra ficar rastreável sem perder informação.
      try {
        const u = new URL(val)
        out.utm.source   ??= u.searchParams.get('utm_source')
        out.utm.medium   ??= u.searchParams.get('utm_medium')
        out.utm.campaign ??= u.searchParams.get('utm_campaign')
        out.utm.content  ??= u.searchParams.get('utm_content')
        out.utm.term     ??= u.searchParams.get('utm_term')
        out.gclid        ??= u.searchParams.get('gclid')
        const extrasMap: Record<string, string> = {
          utm_adgroup: 'utm_adgroup',
          utm_device: 'utm_device',
          utm_matchtype: 'utm_matchtype',
          utm_network: 'utm_network',
          utm_loc: 'utm_loc',
          gbraid: 'gbraid',
          gad_source: 'gad_source',
          gad_campaignid: 'gad_campaignid',
          fbclid: 'fbclid',
        }
        for (const [param, cfKey] of Object.entries(extrasMap)) {
          const v = u.searchParams.get(param)
          if (v && !out.customFields[cfKey]) out.customFields[cfKey] = v
        }
      } catch {}
    }
    else if (target === 'meta:source_id') out.sourceId = val
    else if (target === 'meta:created_at') {
      const d = raw instanceof Date ? raw : new Date(val)
      if (!Number.isNaN(d.getTime())) out.createdAt = d
    }
  }

  if (concatParts.length > 0) {
    out.nome = [out.nome, ...concatParts].filter(Boolean).join(' ').trim()
  }
  return out
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  // Brasil: se 10-11 dígitos, prefixa 55
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function cursorIsGreater(a: string, b: string, strategy: string): boolean {
  if (strategy === 'id') {
    const na = Number(a), nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na > nb
  }
  return a > b
}
