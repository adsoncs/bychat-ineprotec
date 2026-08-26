// src/routes/kommoWebhook.ts
//
// Recebe o webhook `add_message` da Kommo e importa a conversa na hora.
//
// Enquanto o time atende pela Kommo, este é o caminho que mantém o bychat como
// espelho vivo: a Kommo avisa em segundos, e a rede de segurança de
// kommoTalksLive.ts só existe para o dia em que o aviso não vier.
//
// Duas decisões que o formato do payload impõe:
//
// A Kommo manda `application/x-www-form-urlencoded` com chaves aninhadas
// (`message[add][0][talk_id]`), e o formato varia entre tipos de hook. Em vez
// de casar a estrutura exata, varremos as chaves atrás de `talk_id` — e, quando
// nenhuma aparece, caímos no ciclo por `/events`, que descobre sozinho o que
// mudou. Assim uma mudança de formato do lado deles degrada para "um pouco mais
// lento", não para "parou de funcionar em silêncio".
//
// E responde 200 imediatamente, importando depois: a Kommo desativa o webhook
// que demora ou devolve erro, e importar uma conversa com mídia leva segundos.

import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { sincronizarTalk, cicloTalksLive } from '../services/kommoTalksLive.js'

const CHAVE_TOKEN = 'kommo.webhook_token'

/** Token do endereço público do hook. Criado na primeira chamada. */
export async function getKommoWebhookToken(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: CHAVE_TOKEN } })
  const atual = typeof row?.value === 'string' ? row.value : null
  if (atual) return atual
  const token = randomBytes(24).toString('hex')
  await prisma.setting.upsert({
    where: { key: CHAVE_TOKEN },
    create: {
      key: CHAVE_TOKEN,
      value: token,
      label: 'Kommo — token do webhook de mensagens',
      grp: 'kommo',
      fieldType: 'text',
    },
    update: { value: token },
  })
  return token
}

/** Todo talk_id que aparecer no corpo, seja qual for o aninhamento. */
function talkIdsDo(body: unknown): number[] {
  const ids = new Set<number>()
  if (!body || typeof body !== 'object') return []
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    // A chave vem aninhada e TERMINA EM COLCHETE — `message[add][0][talk_id]`.
    // Ancorar em `talk_id$` não casa nada e o webhook silenciosamente não
    // acha conversa nenhuma, deixando tudo para o ciclo de 5 min: parece que
    // funciona, só que sempre atrasado.
    if (!/talk_id/.test(k)) continue
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) ids.add(n)
  }
  // `add_talk`/`update_talk` identificam a conversa pelo próprio id.
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!/^talk\[(add|update)\]\[\d+\]\[id\]$/.test(k)) continue
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) ids.add(n)
  }
  return Array.from(ids)
}

/** Um ciclo de varredura no máximo a cada 10s, por mais hooks que cheguem. */
let ultimoCicloEm = 0
function cicloComFreio(): void {
  const agora = Date.now()
  if (agora - ultimoCicloEm < 10_000) return
  ultimoCicloEm = agora
  void cicloTalksLive().catch((e) => console.warn('[kommo-webhook] ciclo falhou:', e?.message || e))
}

export async function kommoWebhookRoutes(app: FastifyInstance) {
  // No escopo do plugin, para não mudar como o resto do app lê corpo.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(body as string)
      const obj: Record<string, string> = {}
      for (const [k, v] of params) obj[k] = v
      done(null, obj)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post('/api/kommo/webhook/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const esperado = await getKommoWebhookToken()
    // Compara antes de olhar o corpo: endereço público recebe varredura.
    if (!token || token !== esperado) return reply.code(404).send({ ok: false })

    const ids = talkIdsDo(req.body)
    // Devolve já; a importação segue depois da resposta.
    reply.send({ ok: true, talks: ids.length })

    if (ids.length) {
      for (const id of ids) {
        void sincronizarTalk(id).catch((e) => console.warn(`[kommo-webhook] talk ${id}: ${e?.message || e}`))
      }
    } else {
      // Hook sem talk_id reconhecível: o ciclo descobre pelo /events.
      cicloComFreio()
    }
  })
}
