// src/lib/meta.ts
// Helpers compartilhados para integracoes Meta (Lead Ads + WhatsApp Cloud API)

import { prisma } from './prisma.js'

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0'

export { META_GRAPH_URL }

export async function getMetaAppId(): Promise<string> {
  if (process.env.META_APP_ID) return process.env.META_APP_ID
  const row = await prisma.setting.findUnique({ where: { key: 'meta.app_id' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  if (!val) throw new Error('META_APP_ID nao configurado.')
  return val.replace(/"/g, '')
}

export async function getMetaAppSecret(): Promise<string> {
  if (process.env.META_APP_SECRET) return process.env.META_APP_SECRET
  const row = await prisma.setting.findUnique({ where: { key: 'meta.app_secret' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  return val.replace(/"/g, '')
}

export async function getMetaConfigId(): Promise<string> {
  if (process.env.META_CONFIG_ID) return process.env.META_CONFIG_ID
  const row = await prisma.setting.findUnique({ where: { key: 'meta.config_id' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  return val.replace(/"/g, '')
}

/**
 * Config ID separado para o produto Instagram messaging do Facebook Login for
 * Business. Cada Configuration no Meta App tem seus próprios scopes — o do
 * WhatsApp não inclui as permissões de IG, então precisamos de um ID dedicado.
 */
export async function getMetaIgConfigId(): Promise<string> {
  if (process.env.META_IG_CONFIG_ID) return process.env.META_IG_CONFIG_ID
  const row = await prisma.setting.findUnique({ where: { key: 'meta.ig_config_id' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  return val.replace(/"/g, '')
}

/**
 * Config ID dedicado do WhatsApp Embedded Signup. A Configuration de Lead Ads
 * (meta.config_id) pede pages_show_list/leads_retrieval/pages_manage_ads,
 * enquanto a do WhatsApp pede whatsapp_business_management/_messaging + asset
 * WABA — são Configurations incompatíveis no Meta App. Sem ID próprio, "Conectar
 * Meta Ads" acabava abrindo o assistente do WhatsApp (e vice-versa).
 * Fallback para meta.config_id mantém instalações antigas funcionando até que
 * o admin preencha o ID dedicado.
 */
export async function getMetaWaConfigId(): Promise<string> {
  if (process.env.META_WA_CONFIG_ID) return process.env.META_WA_CONFIG_ID
  const row = await prisma.setting.findUnique({ where: { key: 'meta.wa_config_id' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  const wa = val.replace(/"/g, '')
  return wa || getMetaConfigId()
}

export async function metaFetch(path: string, token: string, method = 'GET', body?: any) {
  const url = `${META_GRAPH_URL}${path}${path.includes('?') ? '&' : '?'}access_token=${token}`
  const opts: any = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const resp = await fetch(url, opts)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Meta API ${resp.status}: ${err}`)
  }
  return resp.json() as any
}

/**
 * Igual ao metaFetch, mas segue paging.next até esgotar a coleção.
 *
 * O Graph pagina em 25 itens por padrão. Quem chamava metaFetch direto em
 * edges como /leadgen_forms enxergava só os 25 primeiros e achava que tinha
 * a lista inteira — página com 62 formulários sincronizava 25.
 */
export async function metaFetchAll(path: string, token: string, maxPages = 50): Promise<any[]> {
  const out: any[] = []
  let next: string | null = path
  for (let i = 0; next && i < maxPages; i++) {
    const resp: any = await metaFetch(next, token)
    out.push(...(resp.data || []))
    const nextUrl: string | undefined = resp.paging?.next
    // paging.next já vem com access_token embutido; recorta para path relativo
    // e deixa o metaFetch reanexar o token.
    next = nextUrl
      ? nextUrl.replace(/^https?:\/\/graph\.facebook\.com\/v[\d.]+/, '').replace(/([?&])access_token=[^&]*&?/, '$1').replace(/[?&]$/, '')
      : null
  }
  return out
}

