// src/services/chatImportRunner.ts
//
// Traz o histórico de uma conversa do aparelho para o painel.
//
// Cuidados que definem o resultado:
//  - dedup por externalId: reimportar o mesmo chat não duplica mensagem
//  - NÃO mexe em unreadMessages: histórico antigo não é "não lido"
//  - `lastMessageAt` sobe até a mensagem mais NOVA da conversa, nunca desce —
//    ver `tornarVisivelNoConversas()`, que é o que faz a importação aparecer
//  - mídia entra com o tipo certo e sem arquivo; o download vem depois (fase 4),
//    porque baixar tudo de antemão é o que trava a importação

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { bullmqJobsTotal, captureException } from '../lib/observability.js'
import { phoneKey, onlyDigits } from '../lib/phone.js'
import { generateUid } from './dedup.js'
import { telefoneComoNome } from './leadDisplayName.js'
import { resolveGroupLead, groupSenderName } from './whatsappGroups.js'

const QUEUE_NAME = 'wf-chat-import'
/** Teto por chat. Eram 40 páginas (~2.000 mensagens) e isso ESCONDIA o resto:
 *  grupo com 5.281 mensagens lia as 2.000 primeiras, via que todas já existiam
 *  e encerrava com "concluído, 0 importadas" — para sempre. Quem usava concluía
 *  que a importação "às vezes funciona, às vezes não"; na verdade conversa curta
 *  completava e grupo grande nunca completava.
 *
 *  O teto continua existindo (um chat gigante não pode prender o worker), mas
 *  agora é alto o bastante para caber a conversa inteira, e quem interrompe de
 *  verdade é o LIMITE DE TEMPO — que protege sem depender do tamanho. */
const MAX_PAGINAS = 400
/** Tempo máximo varrendo UM chat. Protege o worker sem cortar histórico: um
 *  chat que não termina em 3 minutos volta na próxima sincronização de onde
 *  parou, porque o dedup por externalId pula o que já entrou. */
const LIMITE_MS_POR_CHAT = 3 * 60 * 1000

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

/**
 * Sob QUAIS JIDs a Evolution pode ter guardado esta mesma conversa.
 *
 * `findMessages` casa `key.remoteJid` por igualdade exata, e o mesmo contato
 * costuma existir em MAIS DE UM JID no banco da Evolution: o `@lid` (o
 * identificador de privacidade, sob o qual fica o histórico antigo) e o
 * `<telefone>@s.whatsapp.net`. Importar só o JID que a lista de chats devolveu
 * traz um dos dois e deixa o outro para trás — foi o "importei e a mensagem de
 * hoje não veio": o histórico antigo estava no `@lid` e as mensagens recentes
 * no JID de telefone.
 *
 * O telefone entra nas duas formas do Brasil, com e sem o 9º dígito: o número
 * gravado no job vem de `key.remoteJidAlt`, que a Evolution entrega no formato
 * antigo (`556291138484`), enquanto a conversa pode estar sob o formato novo.
 *
 * Varrer um JID inexistente custa uma consulta que volta vazia — barato perto
 * de perder metade da conversa.
 */
export function jidsDoMesmoChat(remoteJid: string, telefone: string | null | undefined): string[] {
  const jids = new Set<string>()
  if (remoteJid) jids.add(remoteJid)
  // Grupo tem um JID só e não tem telefone: nada a expandir.
  if (remoteJid.endsWith('@g.us')) return [...jids]

  const numeros = new Set<string>()
  const chave = phoneKey(telefone)
  if (chave) {
    numeros.add(chave)
    // "55 DD 9 XXXXXXXX" → "55 DD XXXXXXXX" (formato sem o 9º dígito).
    const br = /^55([1-9][1-9])9(\d{8})$/.exec(chave)
    if (br) numeros.add(`55${br[1]}${br[2]}`)
  }
  const cru = onlyDigits(telefone)
  // Só um telefone plausível; `cru` pode ser lixo curto ou um LID de 15 dígitos.
  if (cru.length >= 10 && cru.length <= 13) numeros.add(cru)

  for (const n of numeros) jids.add(`${n}@s.whatsapp.net`)
  return [...jids]
}

/**
 * Faz a conversa importada APARECER no Conversas.
 *
 * As abas são decididas por dois campos do lead (ver `condicaoDaCaixa` em
 * routes/atendimento.ts): "Atendimento" exige `conversationOpenedAt`, "Caixa"
 * exige `lastMessageAt`. Um lead criado pela importação não tinha nenhum dos
 * dois — então a importação gravava tudo no banco e a conversa não caía em aba
 * NENHUMA, nem na "Todos". É o "importou e não reflete no Conversas": 634
 * conversas mudas na kobogo, 347 delas vindas da própria importação.
 *
 * `lastMessageAt` recebe a data da mensagem mais nova da conversa e só SOBE:
 * histórico de meses atrás não ressuscita a conversa no topo da caixa — o
 * cuidado original continua valendo. A conversa entra na posição da sua última
 * atividade de verdade.
 *
 * Roda a cada sincronização, e não só quando trouxe mensagem nova: assim uma
 * conversa que já ficou muda é consertada no próximo "sincronizar" sem que
 * ninguém precise mexer no banco.
 */
async function tornarVisivelNoConversas(leadId: number): Promise<void> {
  const [lead, ultima] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { lastMessageAt: true } }),
    prisma.message.findFirst({
      where: { leadId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    }),
  ])
  if (!lead || !ultima) return
  if (lead.lastMessageAt && lead.lastMessageAt >= ultima.timestamp) return
  await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: ultima.timestamp } })
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

    // Conversa de GRUPO tem outra identidade: não tem telefone, o lead é achado
    // (ou criado) pelo `groupJid` e cada mensagem guarda QUEM falou dentro dele.
    const ehGrupo = job.remoteJid.endsWith('@g.us')

    // 1. Lead: reaproveita pelo telefone canônico; só cria se não houver.
    let leadId = job.leadId
    if (!leadId && ehGrupo) {
      // Mesma porta de entrada do inbound de grupo: assunto do grupo, dedup por
      // groupJid e roteamento pelo dono da conexão. Sem isso a importação criaria
      // um lead "pessoa" com o JID no lugar do telefone.
      const grupo = await resolveGroupLead({ groupJid: job.remoteJid, instanceName: job.instanceName })
      leadId = grupo.id
      await prisma.chatImportJob.update({ where: { id: jobId }, data: { leadId } })
    }
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
    //
    // Só mensagens da EVOLUTION entram no conjunto. O `externalId` não é único
    // entre provedores: o id que a Evolution dá a uma mensagem (`3A…`, gerado
    // pelo aparelho) pode ser igual ao que a Cloud API deu a OUTRA mensagem, na
    // mesma conversa. Quando isso acontece, a mensagem verdadeira era descartada
    // como "já existia" e nunca aparecia — foi o que engoliu o teste do contato
    // 62991138484: a mensagem "Esse é um teste de importação" tinha o mesmo id
    // de uma confirmação de agendamento enviada dias antes pela Cloud API.
    const jaTem = new Set(
      (await prisma.message.findMany({
        where: { leadId, externalId: { not: null }, provider: 'evolution' },
        select: { externalId: true },
      })).map((m) => m.externalId!),
    )

    let importadas = 0
    let jaExistiam = 0
    let midiasPendentes = 0
    let totalNaOrigem = 0
    let cancelado = false

    // O mesmo contato mora em mais de um JID na Evolution (@lid e telefone) —
    // varre todos e deixa o dedup por externalId juntar as duas pontas.
    for (const jid of jidsDoMesmoChat(job.remoteJid, job.telefone)) {
      if (cancelado) break
      let pagina = 1
      let paginas = 1
      const inicioDoChat = Date.now()

      while (pagina <= Math.min(paginas, MAX_PAGINAS)) {
        if (Date.now() - inicioDoChat > LIMITE_MS_POR_CHAT) {
          // Não é erro: o que faltou entra na próxima sincronização, e o dedup
          // por externalId garante que nada seja relido à toa.
          break
        }

        const atual = await prisma.chatImportJob.findUnique({ where: { id: jobId }, select: { status: true } })
        if (atual?.status === 'canceled') { cancelado = true; break }

        const { registros, total, paginas: p } = await (provider as any).findMessages(jid, pagina)
        paginas = p || 1
        if (pagina === 1) {
          // Soma dos JIDs: o progresso da tela precisa refletir a conversa
          // inteira, não só o pedaço que estava sob o primeiro identificador.
          totalNaOrigem += total || registros.length
          await prisma.chatImportJob.update({ where: { id: jobId }, data: { totalNaOrigem } })
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

          // Em grupo, `pushName` é de QUEM FALOU (não do grupo) e o JID do
          // participante é o que o WhatsApp exige depois para reagir ou apagar.
          const participante: string = r?.key?.participant || r?.participant || ''

          novas.push({
            leadId,
            fromMe: !!r?.key?.fromMe,
            body,
            mediaType,
            mediaUrl: null,
            isInternal: false,
            provider: 'evolution',
            evolutionInstance: job.instanceName,
            senderName: r?.key?.fromMe
              ? 'Importado'
              : ehGrupo
                ? groupSenderName(r?.pushName, participante)
                : (r?.pushName || job.nome || null),
            senderJid: ehGrupo ? (participante || null) : null,
            externalId,
            ack: 1,
            timestamp: ts,
          })
        }

        if (novas.length) {
          // Reconferência no banco imediatamente antes de gravar.
          //
          // O `jaTem` é uma foto tirada no início do job, e agora DOIS jobs
          // podem estar olhando para as mesmas mensagens: a lista do aparelho
          // mostra o `@lid` e o `<telefone>@s.whatsapp.net` como duas linhas, e
          // desde que a varredura passou a cobrir as duas pontas, sincronizar
          // ambas cai no mesmo lead com o mesmo conteúdo. Sem esta conferência
          // a conversa fica com tudo em dobro (e não há índice único que
          // segure: `externalId` é só indexado).
          const ids = novas.map((n) => n.externalId as string)
          const existentes = new Set(
            (await prisma.message.findMany({
              where: { leadId, provider: 'evolution', externalId: { in: ids } },
              select: { externalId: true },
            })).map((m) => m.externalId!),
          )
          const paraGravar = novas.filter((n) => !existentes.has(n.externalId as string))
          jaExistiam += novas.length - paraGravar.length
          if (paraGravar.length) {
            await prisma.message.createMany({ data: paraGravar, skipDuplicates: true })
            importadas += paraGravar.length
          }
        }

        await prisma.chatImportJob.update({
          where: { id: jobId },
          data: { importadas, jaExistiam, midiasPendentes },
        })
        pagina++
      }
    }

    if (cancelado) return

    // Sem isto a conversa fica no banco e fora de todas as abas do Conversas.
    await tornarVisivelNoConversas(leadId)

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
  chats: Array<{ remoteJid: string; telefone?: string | null; nome?: string | null; leadId?: number | null }>,
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
    // Grupo não tem telefone: guarda os dígitos do próprio JID, do mesmo jeito
    // que `resolveGroupLead` faz no campo `whatsapp` do lead. O que identifica a
    // conversa é o `remoteJid`, e é por ele que o runner reconhece o grupo.
    const ehGrupo = c.remoteJid.endsWith('@g.us')
    const telefone = ehGrupo ? onlyDigits(c.remoteJid).slice(0, 20) : onlyDigits(c.telefone)
    if (!telefone) continue
    // Mesmo chat já na fila: não duplica o trabalho.
    const emAndamento = jaNaFila.get(c.remoteJid)
    if (emAndamento) { criados.push({ id: emAndamento, remoteJid: c.remoteJid, jaEstava: true }); continue }

    const job = await prisma.chatImportJob.create({
      data: {
        instanceName,
        remoteJid: c.remoteJid,
        telefone,
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
