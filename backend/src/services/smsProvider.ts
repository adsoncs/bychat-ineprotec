// src/services/smsProvider.ts
// Provider de SMS — atualmente integra com Comtele (https://docs.comtele.com.br/).
// API key e remetente padrão lidos das Settings:
//   - sms.provider             (string, "comtele" — único provider suportado por enquanto)
//   - sms.comtele.api_key      (UUID enviado no header `auth-key`)
//   - sms.comtele.default_sender (opcional; campo Sender usado como tag interna)
//
// Endpoint: POST https://sms.comtele.com.br/api/v2/send
// Body: { Sender, Receivers, Content }  — Receivers no formato DDD+numero.
// Response sucesso: { Success: true, Object: { requestUniqueId }, Message }

import { prisma } from '../lib/prisma.js'

const COMTELE_ENDPOINT = 'https://sms.comtele.com.br/api/v2/send'

export interface SmsSendInput {
  to: string         // telefone (qualquer formato; será normalizado)
  message: string    // conteúdo do SMS
  sender?: string    // override do remetente; senão usa default das Settings
}

export interface SmsSendResult {
  ok: boolean
  providerId?: string  // requestUniqueId da Comtele
  message?: string     // mensagem retornada pelo provider
  error?: string
}

// Normaliza número para o formato esperado pela Comtele: DDD + número, só dígitos.
// Aceita: "+55 (11) 99999-9999", "5511999999999", "11999999999".
// Retorna: "11999999999" (remove DDI 55 se presente em números BR de 12-13 chars).
export function normalizeBrPhone(input: string): string {
  let digits = String(input || '').replace(/\D/g, '')
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.substring(2)
  return digits
}

async function loadSettings() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['sms.provider', 'sms.comtele.api_key', 'sms.comtele.default_sender'] } },
  })
  const cfg: Record<string, string> = {}
  for (const r of rows) {
    cfg[r.key] = typeof r.value === 'string' ? r.value : JSON.stringify(r.value).replace(/^"|"$/g, '')
  }
  return cfg
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  const cfg = await loadSettings()
  const provider = cfg['sms.provider'] || 'comtele'
  if (provider !== 'comtele') {
    return { ok: false, error: `SMS provider "${provider}" não suportado` }
  }
  const apiKey = cfg['sms.comtele.api_key']
  if (!apiKey) return { ok: false, error: 'sms.comtele.api_key não configurada (Configurações → SMS)' }

  const to = normalizeBrPhone(input.to)
  if (!to || to.length < 10) return { ok: false, error: `Número inválido: "${input.to}"` }
  const content = String(input.message || '').trim()
  if (!content) return { ok: false, error: 'Mensagem vazia' }

  const sender = input.sender || cfg['sms.comtele.default_sender'] || 'bychat'

  try {
    const r = await fetch(COMTELE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'auth-key': apiKey,
      },
      body: JSON.stringify({ Sender: sender, Receivers: to, Content: content }),
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok || data?.Success !== true) {
      return { ok: false, error: data?.Message || `HTTP ${r.status}`, message: data?.Message }
    }
    return {
      ok: true,
      providerId: data?.Object?.requestUniqueId || null,
      message: data?.Message || 'enviado',
    }
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) }
  }
}
