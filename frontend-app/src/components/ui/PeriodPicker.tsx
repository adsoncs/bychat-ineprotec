import { useState } from 'preact/hooks'
import { cn } from '@/lib/cn'

/**
 * Seletor de período único de todas as telas com indicador: 7 / 30 / 90 dias e
 * intervalo livre. Existia uma variação por tela (umas só com presets, outras
 * com `days` num <select>), e o resultado é que trocar de tela mudava o que
 * "últimos 30 dias" queria dizer. Aqui a conta é uma só.
 */
export type RangePreset = '7d' | '30d' | '90d' | 'custom'

export interface PeriodRange {
  preset: RangePreset
  /** YYYY-MM-DD — sempre preenchido; em 'custom' incompleto cai no padrão. */
  dateFrom: string
  dateTo: string
  /** true enquanto o operador escolheu 'custom' mas não fechou as duas datas. */
  incomplete: boolean
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', custom: 'Personalizado',
}

export const fmtDate = (d: Date) => d.toISOString().split('T')[0] ?? ''
export const hoje = () => {
  const n = new Date()
  return fmtDate(new Date(n.getFullYear(), n.getMonth(), n.getDate()))
}

const isPreset = (v: unknown): v is RangePreset =>
  v === '7d' || v === '30d' || v === '90d' || v === 'custom'

/**
 * Datas de um preset. Em 'custom' vale o intervalo escolhido — datas invertidas
 * são corrigidas em vez de rejeitadas, e um intervalo ainda pela metade cai no
 * padrão de 30 dias para a tela nunca ficar sem dados enquanto se digita.
 */
export function presetRange(
  preset: RangePreset,
  custom?: { from: string; to: string },
): { dateFrom: string; dateTo: string } {
  if (preset === 'custom') {
    const { from, to } = custom ?? { from: '', to: '' }
    if (from && to) return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from }
    preset = '30d'
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return { dateFrom: fmtDate(new Date(today.getTime() - days * 86400_000)), dateTo: fmtDate(today) }
}

/**
 * Estado do período. `storageKey` liga a persistência em localStorage — quem
 * trabalha um mês fechado não quer reconfigurar a cada visita. Sem chave, o
 * período vale só enquanto a tela está aberta.
 */
export function usePeriod(storageKey?: string, initial: RangePreset = '30d') {
  const key = (suffix: string) => (storageKey ? `${storageKey}.${suffix}` : '')
  const read = (suffix: string) => {
    if (!storageKey) return ''
    try { return localStorage.getItem(key(suffix)) ?? '' } catch { return '' }
  }
  const write = (suffix: string, value: string) => {
    if (!storageKey) return
    try { localStorage.setItem(key(suffix), value) } catch { /* modo privado/quota */ }
  }

  const [preset, setPresetState] = useState<RangePreset>(() => {
    const stored = read('preset')
    return isPreset(stored) ? stored : initial
  })
  const [customFrom, setCustomFrom] = useState(() => read('customFrom'))
  const [customTo, setCustomTo] = useState(() => read('customTo'))

  const setPreset = (p: RangePreset) => { setPresetState(p); write('preset', p) }
  const setCustom = (campo: 'from' | 'to', valor: string) => {
    if (campo === 'from') { setCustomFrom(valor); write('customFrom', valor) }
    else { setCustomTo(valor); write('customTo', valor) }
  }

  const { dateFrom, dateTo } = presetRange(preset, { from: customFrom, to: customTo })
  const range: PeriodRange = {
    preset, dateFrom, dateTo,
    incomplete: preset === 'custom' && !(customFrom && customTo),
  }
  return { range, preset, customFrom, customTo, setPreset, setCustom }
}

interface PeriodPickerProps {
  preset: RangePreset
  customFrom: string
  customTo: string
  onPreset: (p: RangePreset) => void
  onCustom: (campo: 'from' | 'to', valor: string) => void
  /** rótulo lido por leitores de tela quando há mais de um seletor na página */
  label?: string | undefined
}

export function PeriodPicker({ preset, customFrom, customTo, onPreset, onCustom, label }: PeriodPickerProps) {
  return (
    <div class="flex items-center gap-2 flex-wrap" role="group" aria-label={label ?? 'Período'}>
      <div class="flex items-center gap-1 p-0.5 rounded-md bg-surface-3">
        {(['7d', '30d', '90d', 'custom'] as RangePreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            aria-pressed={preset === p}
            class={cn(
              'h-7 px-3 rounded text-xs font-medium transition-colors',
              preset === p ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div class="flex items-center gap-1.5">
          <input
            type="date"
            class="h-7 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent"
            value={customFrom}
            max={customTo || hoje()}
            onInput={(e) => onCustom('from', (e.target as HTMLInputElement).value)}
            aria-label="Data inicial"
          />
          <span class="text-xs text-fg-subtle">até</span>
          <input
            type="date"
            class="h-7 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent"
            value={customTo}
            min={customFrom || undefined}
            max={hoje()}
            onInput={(e) => onCustom('to', (e.target as HTMLInputElement).value)}
            aria-label="Data final"
          />
        </div>
      )}
    </div>
  )
}

/**
 * Querystring das rotas que aceitam `range` + `from`/`to`. Manda sempre as duas
 * datas: o backend prefere o intervalo explícito, então até os presets ficam
 * exatos (o servidor não precisa recalcular "7 dias" com o relógio dele).
 */
export function periodQuery(r: PeriodRange): string {
  const preset = r.preset === 'custom' ? '30d' : r.preset
  return `range=${preset}&from=${r.dateFrom}&to=${r.dateTo}`
}

/** Rótulo do período para textos corridos ("nos últimos 30 dias", "de … a …"). */
export function periodLabel(r: PeriodRange): string {
  if (r.preset !== 'custom' || r.incomplete) {
    return `nos últimos ${r.preset === 'custom' ? '30' : r.preset.replace('d', '')} dias`
  }
  const br = (iso: string) => iso.split('-').reverse().join('/')
  return `de ${br(r.dateFrom)} a ${br(r.dateTo)}`
}

/** Aviso padrão de intervalo personalizado ainda incompleto. */
export function PeriodIncompleteHint({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p class="text-[11px] text-fg-subtle -mt-1">
      Escolha as duas datas para aplicar o período personalizado — exibindo os últimos 30 dias.
    </p>
  )
}
