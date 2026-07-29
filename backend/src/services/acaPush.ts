// src/services/acaPush.ts
//
// Notificações push do portal do aluno (G6 / RF-701).
//
// Push aqui é canal COMPLEMENTAR, não substituto: no Brasil o WhatsApp alcança
// mais gente do que notificação de navegador, e o ERP já avisa por lá. O que o
// push resolve é o aviso que não justifica uma mensagem — nota lançada,
// documento pronto — e o aluno que bloqueou o número da instituição.
//
// A criptografia é do protocolo (RFC 8291): payload cifrado ponta a ponta com
// chave da assinatura, para o serviço de push do navegador não conseguir ler o
// conteúdo. É por isso que se usa a biblioteca em vez de implementar à mão.

import { prisma } from '../lib/prisma.js'

const CHAVE_PUB = 'aca.push.vapid_public'
const CHAVE_PRIV = 'aca.push.vapid_private'
const CHAVE_SUB = 'aca.push.subject'

export interface ConfigPush {
  publicKey: string | null
  configurado: boolean
  subject: string
}

async function lerSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findFirst({ where: { key }, select: { value: true } })
  const v = s?.value as unknown
  return typeof v === 'string' && v.trim() ? v : null
}

async function gravarSetting(key: string, value: string, label: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as any, grp: 'academico', label, fieldType: 'text' },
    update: { value: value as any },
  })
}

export async function getConfig(): Promise<ConfigPush> {
  const [pub, priv, sub] = await Promise.all([lerSetting(CHAVE_PUB), lerSetting(CHAVE_PRIV), lerSetting(CHAVE_SUB)])
  return {
    publicKey: pub,
    configurado: !!pub && !!priv,
    subject: sub || `mailto:${process.env.SMTP_FROM || 'secretaria@localhost'}`,
  }
}

/**
 * Gera o par VAPID uma única vez.
 *
 * Regerar invalida TODAS as assinaturas existentes — os navegadores já
 * assinaram com a chave antiga. Por isso a função recusa sobrescrever sem
 * confirmação explícita.
 */
export async function garantirChaves(forcar = false): Promise<ConfigPush> {
  const atual = await getConfig()
  if (atual.configurado && !forcar) return atual
  // web-push não traz tipos próprios; o módulo entra como any de propósito.
  const webpush = ((await import('web-push' as any)) as any).default
  const par = webpush.generateVAPIDKeys()
  await gravarSetting(CHAVE_PUB, par.publicKey, 'Push · chave pública VAPID')
  await gravarSetting(CHAVE_PRIV, par.privateKey, 'Push · chave privada VAPID')
  if (forcar) {
    // Assinatura feita com a chave antiga nunca mais recebe nada — desativar é
    // mais honesto do que deixar o painel contando inscritos que não existem.
    await prisma.acaPushInscricao.updateMany({
      where: { ativa: true },
      data: { ativa: false, ultimoErro: 'Chaves VAPID regeradas — é preciso assinar de novo.' },
    })
  }
  return getConfig()
}

export async function inscrever(params: {
  alunoId: number
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}) {
  const dados = {
    alunoId: params.alunoId,
    p256dh: params.p256dh,
    auth: params.auth,
    userAgent: params.userAgent?.substring(0, 255) ?? null,
    ativa: true,
    ultimoErro: null,
  }
  // O mesmo endpoint pode trocar de dono: aparelho compartilhado, aluno que
  // saiu do próprio login. Reassinar sobrescreve o vínculo.
  return prisma.acaPushInscricao.upsert({
    where: { endpoint: params.endpoint },
    create: { endpoint: params.endpoint, ...dados },
    update: dados,
  })
}

export async function desinscrever(endpoint: string) {
  await prisma.acaPushInscricao.deleteMany({ where: { endpoint } })
}

export interface ResultadoEnvio { enviadas: number; falhas: number; desativadas: number }

/**
 * Envia para todas as assinaturas ativas de um aluno.
 *
 * 404/410 do serviço de push significa assinatura morta (app desinstalado,
 * permissão revogada): desativamos em vez de tentar para sempre.
 */
export async function enviarParaAluno(alunoId: number, msg: {
  titulo: string
  corpo: string
  url?: string
}): Promise<ResultadoEnvio> {
  const cfg = await getConfig()
  if (!cfg.configurado) return { enviadas: 0, falhas: 0, desativadas: 0 }

  const inscricoes = await prisma.acaPushInscricao.findMany({ where: { alunoId, ativa: true } })
  if (inscricoes.length === 0) return { enviadas: 0, falhas: 0, desativadas: 0 }

  // web-push não traz tipos próprios; o módulo entra como any de propósito.
  const webpush = ((await import('web-push' as any)) as any).default
  const priv = await lerSetting(CHAVE_PRIV)
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, priv)

  const payload = JSON.stringify({
    titulo: msg.titulo,
    corpo: msg.corpo,
    url: msg.url || '/portal/aca/login',
  })

  let enviadas = 0, falhas = 0, desativadas = 0
  for (const i of inscricoes) {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        payload,
      )
      enviadas++
    } catch (e: any) {
      falhas++
      const status = Number(e?.statusCode)
      if (status === 404 || status === 410) {
        await prisma.acaPushInscricao.update({
          where: { id: i.id },
          data: { ativa: false, ultimoErro: `Assinatura expirada (HTTP ${status})` },
        })
        desativadas++
      } else {
        await prisma.acaPushInscricao.update({
          where: { id: i.id },
          data: { ultimoErro: String(e?.message || 'falha desconhecida').substring(0, 255) },
        })
      }
    }
  }
  return { enviadas, falhas, desativadas }
}
