// src/services/chatImportRunner.ts
//
// Traz o histórico de uma conversa do aparelho para o painel.
//
// Cuidados que definem o resultado:
//  - dedup por externalId: reimportar o mesmo chat não duplica mensagem
//  - NÃO mexe em lastMessageAt nem em unreadMessages: mensagem de meses atrás
//    não pode ressuscitar a conversa no topo da caixa como se fosse nova
//  - mídia entra com o tipo certo e sem arquivo; o download vem depois (fase 4),
//    porque baixar tudo de antemão é o que trava a importação

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { bullmqJobsTotal, captureException } from '../lib/observability.js'
import { phoneKey, onlyDigits } from '../lib/phone.js'
import { generateUid } from './dedup.js'
import { telefoneComoNome } from './leadDisplayName.js'

const QUEUE_NAME = 'wf-chat-import'
/** Teto por chat. 7 mil mensagens numa conversa antiga é volume real, e
 *  importar tudo raramente ajuda — o que interessa é o histórico recente. */
const MAX_PAGINAS = 40

let worker: Worker | null = null

export async function startChatImportWorker(): Promise<void> {
  if (worker) return
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => { await importarChat(Number(job.data?.jobId)) },
    { connection: redisConnection, concurrency: 2 },
  )
  worker.on('failed', (job, err) => {
    console.error('[chatImport] job falhou:', err.message)
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' })
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })
  worker.on('completed', () => bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' }))
  console.log('[chatImport] worker iniciado (2 chats em paralelo)')
}

/** Tipo interno da mensagem a partir do formato da Evolution. */
function tipoDe(messageType: string | undefined, message: any): { mediaType: string; body: string } {
  const m = message || {}
  if (m.conversation) return { mediaType: 'text', body: String(m.conversation) }
  if (m.extendedTextMessage?.text) return { mediaType: 'text', body: String(m.extendedTextMessage.text) }
  const mapa: Record<string, string> = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    stickerMessage: 'sticker',
    documentMessage: 'document',
  }
  const t = mapa[messageType || ''] || ''
  if (t) {
    const inner = m[messageType!] || {}
    return { mediaType: t, body: String(inner.caption || '') }
  }
  if (messageType === 'locationMessage') return { mediaType: 'text', body: '📍 Localização' }
  if (messageType === 'contactMessage') return { mediaType: 'text', body: '👤 Contato compartilhado' }
  return { mediaType: 'text', body: '' }
}

export async function importarChat(jobId: number): Promise<void> {
  const job = await prisma.chatImportJob.findUnique({ where: { id: jobId } })
  if (!job || job.status === 'canceled') return

  await prisma.chatImportJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date(), erro: null },
  })

  try {
    const { getProviderForChannel } = await import('./whatsappProvider.js')
    const { provider } = await getProviderForChannel(`evolution:${job.instanceName}`)
    if (provider.providerName !== 'evolution') throw new Error('A instância não é Evolution.')

    // 1. Lead: reaproveita pelo telefone canônico; só cria se não houver.
    let leadId = job.leadId
    if (!leadId) {
      const chave = phoneKey(job.telefone)
      if (!chave) throw new Error('Telefone do chat não é válido.')
      const existente = await prisma.lead.findFirst({
        where: { phoneKey: chave }, orderBy: { createdAt: 'desc' }, select: { id: true },
      })
      if (existente) {
        leadId = existente.id
      } else {
        const { resolveDefaultTeamId } = await import('./teamRouting.js')
        const novo = await prisma.lead.create({
          data: {
            uid: await generateUid(),
            // O nome vem da lista de chats do APARELHO (contatos da Evolution),
            // que é a agenda da empresa — é o nome que o operador viu na tela
            // ao escolher a conversa. Sem nome, o telefone formatado.
            nome: job.nome || telefoneComoNome(job.telefone),
            nomeOrigem: job.nome ? 'import' : 'telefone',
            nomeWhatsappAgenda: job.nome || null,
            whatsapp: onlyDigits(job.telefone),
            phoneKey: chave,
            email: '', empresa: '', scores: {},
            status: 'NOVO',
            source: 'whatsapp_import',
            teamId: await resolveDefaultTeamId().catch(() => null),
            formData: { origem: 'importacao_aparelho', instancia: job.instanceName },
          },
          select: { id: true },
        })
        leadId = novo.id
      }
      await prisma.chatImportJob.update({ where: { id: jobId }, data: { leadId } })
    }

    // 2. O que já existe, para não duplicar. Um Set na memória evita um SELECT
    //    por mensagem — são milhares.
    const jaTem = new Set(
      (await prisma.message.findMany({
        where: { leadId, externalId: { not: null } },
        select: { externalId: true },
      })).map((m) => m.externalId!),
    )

    let importadas = 0
    let jaExistiam = 0
    let midiasPendentes = 0
    let pagina = 1
    let paginas = 1

    while (pagina <= Math.min(paginas, MAX_PAGINAS)) {
      const atual = await prisma.chatImportJob.findUnique({ where: { id: jobId }, select: { status: true } })
      if (atual?.status === 'canceled') return

      const { registros, total, paginas: p } = await (provider as any).findMessages(job.remoteJid, pagina)
      paginas = p || 1
      if (pagina === 1) {
        await prisma.chatImportJob.update({ where: { id: jobId }, data: { totalNaOrigem: total || registros.length } })
      }
      if (!registros.length) break

      const novas: any[] = []
      for (const r of registros) {
        const externalId = r?.key?.id ? String(r.key.id) : null
        if (!externalId || jaTem.has(externalId)) { jaExistiam++; continue }
        jaTem.add(externalId)

        const { mediaType, body } = tipoDe(r?.messageType, r?.message)
        const ehMidia = mediaType !== 'text'
        if (ehMidia) midiasPendentes++

        // messageTimestamp vem em segundos.
        const ts = r?.messageTimestamp ? new Date(Number(r.messageTimestamp) * 1000) : new Date()

        novas.push({
          leadId,
          fromMe: !!r?.key?.fromMe,
          body,
          mediaType,
          mediaUrl: null,
          isInternal: false,
          provider: 'evolution',
          evolutionInstance: job.instanceName,
          senderName: r?.key?.fromMe ? 'Importado' : (r?.pushName || job.nome || null),
          externalId,
          ack: 1,
          timestamp: ts,
        })
      }

      if (novas.length) {
        await prisma.message.createMany({ data: novas, skipDuplicates: true })
        importadas += novas.length
      }

      await prisma.chatImportJob.update({
        where: { id: jobId },
        data: { importadas, jaExistiam, midiasPendentes },
      })
      pagina++
    }

    await prisma.chatImportJob.update({
      where: { id: jobId },
      data: { status: 'done', finishedAt: new Date(), importadas, jaExistiam, midiasPendentes },
    })
  } catch (e: any) {
    await prisma.chatImportJob.update({
      where: { id: jobId },
      data: { status: 'failed', finishedAt: new Date(), erro: String(e?.message || e).slice(0, 500) },
    }).catch(() => {})
    throw e
  }
}

/**
 * Enfileira os chats escolhidos. Devolve os jobs criados.
 *
 * `prioridade` menor fura a fila: a sincronização pedida dentro de uma conversa
 * não pode ficar atrás de um "sincronizar tudo" de mil conversas — o operador
 * está com o cliente na linha.
 */
export async function enfileirarImportacao(
  instanceName: string,
  chats: Array<{ remoteJid: string; telefone: string; nome?: string | null; leadId?: number | null }>,
  createdByUserId: number,
  prioridade = 5,
): Promise<Array<{ id: number; remoteJid: string; jaEstava: boolean }>> {
  // Uma consulta só para toda a seleção: com "sincronizar tudo" isto passou a
  // receber milhares de chats, e um SELECT por chat travava a requisição.
  const jids = [...new Set(chats.map((c) => c.remoteJid))]
  const abertos = jids.length
    ? await prisma.chatImportJob.findMany({
        where: { instanceName, remoteJid: { in: jids }, status: { in: ['pending', 'running'] } },
        select: { id: true, remoteJid: true },
      })
    : []
  const jaNaFila = new Map(abertos.map((j) => [j.remoteJid, j.id]))

  const criados: Array<{ id: number; remoteJid: string; jaEstava: boolean }> = []
  for (const c of chats) {
    if (!c.telefone) continue
    // Mesmo chat já na fila: não duplica o trabalho.
    const emAndamento = jaNaFila.get(c.remoteJid)
    if (emAndamento) { criados.push({ id: emAndamento, remoteJid: c.remoteJid, jaEstava: true }); continue }

    const job = await prisma.chatImportJob.create({
      data: {
        instanceName,
        remoteJid: c.remoteJid,
        telefone: onlyDigits(c.telefone),
        nome: c.nome || null,
        leadId: c.leadId ?? null,
        createdByUserId,
      },
      select: { id: true },
    })
    jaNaFila.set(c.remoteJid, job.id)
    await queues.chatImport.add('import', { jobId: job.id }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 200,
      removeOnFail: 100,
      priority: prioridade,
    })
    criados.push({ id: job.id, remoteJid: c.remoteJid, jaEstava: false })
  }
  return criados
}
