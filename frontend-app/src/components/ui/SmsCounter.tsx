import { cn } from '@/lib/cn'

const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXT = '\f^{}\\[~]|€'

function detectEncoding(text: string): 'gsm' | 'ucs2' {
  for (const ch of text) {
    if (!GSM_BASIC.includes(ch) && !GSM_EXT.includes(ch)) return 'ucs2'
  }
  return 'gsm'
}

function countGsmChars(text: string): number {
  let n = 0
  for (const ch of text) {
    n += GSM_EXT.includes(ch) ? 2 : 1
  }
  return n
}

export interface SmsStats {
  encoding: 'gsm' | 'ucs2'
  charCount: number
  perPart: number
  parts: number
  remaining: number
}

export function getSmsStats(text: string): SmsStats {
  const encoding = detectEncoding(text)
  const charCount = encoding === 'gsm' ? countGsmChars(text) : [...text].length
  const singleLimit = encoding === 'gsm' ? 160 : 70
  const multiLimit = encoding === 'gsm' ? 153 : 67
  let parts: number
  let perPart: number
  if (charCount <= singleLimit) {
    parts = charCount === 0 ? 0 : 1
    perPart = singleLimit
  } else {
    parts = Math.ceil(charCount / multiLimit)
    perPart = multiLimit
  }
  const remaining = parts <= 1 ? singleLimit - charCount : parts * multiLimit - charCount
  return { encoding, charCount, perPart, parts, remaining }
}

export function SmsCounter({ text }: { text: string }) {
  const stats = getSmsStats(text)
  const overLimit = stats.parts > 3
  const warning = stats.parts >= 2
  return (
    <div
      class={cn(
        'flex items-center justify-between gap-2 text-[0.6875rem] px-2 py-1 rounded-md',
        overLimit ? 'bg-danger/10 text-danger' : warning ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-fg-muted',
      )}
    >
      <span>
        {stats.charCount} caracteres · {stats.encoding === 'gsm' ? 'GSM-7' : 'Unicode (acento/emoji)'}
      </span>
      <span class="font-medium">
        {stats.parts === 0
          ? '0 SMS'
          : stats.parts === 1
            ? `1 SMS (${stats.remaining} restantes)`
            : `${stats.parts} SMS de ${stats.perPart} chars`}
      </span>
    </div>
  )
}
