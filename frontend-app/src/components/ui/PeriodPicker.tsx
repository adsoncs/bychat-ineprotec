import { useState } from 'preact/hooks'
import { cn } from '@/lib/cn'

/**
 * Seletor de período único de todas as telas com indicador: os 4 meses
 * anteriores, o mês atual e um intervalo livre.
 *
 * Era 7/30/90 dias — janelas móveis que mudavam de significado a cada dia e não
 * casavam com o jeito como o time fecha resultado (por mês). "Julho" quer dizer
 * julho para todo mundo; "últimos 30 dias" quer dizer coisas diferentes conforme
 * a hora em que se abre a tela.
 */

/** m0 = mês atual · m1..m4 = meses anteriores · custom = intervalo livre. */
export type RangePreset = 'm0' | 'm1' | 'm2' | 'm3' | 'm4' | 'custom'

export interface PeriodRange {
  preset: RangePreset
  /** YYYY-MM-DD — sempre preenchido; em 'custom' incompleto cai no mês atual. */
  dateFrom: string
  dateTo: string
  /** true enquanto o operador escolheu 'custom' mas não fechou as duas datas. */
  incomplete: boolean
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export const fmtDate = (d: Date) => {
  // Local, não UTC: toISOString() converte para GMT e no Brasil joga a data um
  // dia para trás na virada — o dia 1º do mês vira o último do anterior.
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
export const hoje = () => fmtDate(new Date())

const PRESETS: RangePreset[] = ['m4', 'm3', 'm2', 'm1', 'm0', 'custom']
const isPreset = (v: unknown): v is RangePreset =>
  typeof v === 'string' && (PRESETS as string[]).includes(v)

/** Quantos meses atrás o preset representa (m0 = 0, m3 = 3). */
function mesesAtras(p: RangePreset): number {
  return p === 'custom' ? 0 : Number(p.slice(1))
}

/** Primeiro dia do mês, N meses atrás do atual. */
function inicioDoMes(n: number, base = new Date()): Date {
  return new Date(base.getFullYear(), base.getMonth() - n, 1)
}

/**
 * Rótulo do preset. Mostra o ano quando o mês é de outro ano — em janeiro os
 * quatro anteriores são do ano passado, e "Dezembro" sem ano fica ambíguo.
 */
export function presetLabel(p: RangePreset, curto = false): string {
  if (p === 'custom') return 'Personalizado'
  const d = inicioDoMes(mesesAtras(p))
  const nome = (curto ? MESES_CURTOS : MESES)[d.getMonth()] ?? ''
  const anoAtual = new Date().getFullYear()
  return d.getFullYear() === anoAtual ? nome : `${nome}/${String(d.getFullYear()).slice(2)}`
}

/**
 * Datas do preset.
 *
 * O mês ATUAL termina hoje, não no último dia do mês: pedir dados até o fim de
 * agosto no dia 11 seria buscar o futuro, e alguns relatórios projetam a média
 * pelo tamanho da janela — daria número diluído por 20 dias que ainda não
 * aconteceram.
 */
export function presetRange(
  preset: RangePreset,
  custom?: { from: string; to: string },
): { dateFrom: string; dateTo: string } {
  if (preset === 'custom') {
    const { from, to } = custom ?? { from: '', to: '' }
    if (from && to) return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from }
    preset = 'm0'
  }
  const n = mesesAtras(preset)
  const inicio = inicioDoMes(n)
  if (n === 0) return { dateFrom: fmtDate(inicio), dateTo: hoje() }
  // Dia 0 do mês seguinte = último dia deste mês (cobre 28/29/30/31).
  const fim = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0)
  return { dateFrom: fmtDate(inicio), dateTo: fmtDate(fim) }
}

/**
 * Intervalo equivalente no mês anterior, para a comparação Δ%.
 *
 * No mês corrente compara o MESMO trecho: 1–11 de agosto contra 1–11 de julho.
 * Comparar 11 dias contra os 31 do mês fechado mostraria uma queda de ~65% que
 * não existe.
 */
export function previousRange(r: PeriodRange): { dateFrom: string; dateTo: string } {
  const de = new Date(`${r.dateFrom}T00:00:00`)
  const ate = new Date(`${r.dateTo}T00:00:00`)
  const inicioAnterior = new Date(de.getFullYear(), de.getMonth() - 1, 1)
  const ultimoDiaAnterior = new Date(inicioAnterior.getFullYear(), inicioAnterior.getMonth() + 1, 0).getDate()
  const diaFim = Math.min(ate.getDate(), ultimoDiaAnterior)
  return {
    dateFrom: fmtDate(inicioAnterior),
    dateTo: fmtDate(new Date(inicioAnterior.getFullYear(), inicioAnterior.getMonth(), diaFim)),
  }
}

/**
 * Estado do período. `storageKey` liga a persistência em localStorage — quem
 * trabalha um mês fechado não quer reconfigurar a cada visita.
 */
export function usePeriod(storageKey?: string, initial: RangePreset = 'm0') {
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
    // Preset salvo no formato antigo (7d/30d/90d) vira mês atual em vez de
    // deixar a tela sem período — a troca de formato não pode quebrar quem já
    // tinha preferência gravada.
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
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label={label ?? 'Período'}>
      {/* max-w-full + overflow-x-auto: em tela estreita a barra ROLA em vez de
          quebrar linha e empurrar o resto do cabeçalho. */}
      <div class="flex max-w-full items-center gap-1 overflow-x-auto rounded-md bg-surface-3 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPreset(p)}
            aria-pressed={preset === p}
            title={p === 'm0' ? 'Do dia 1º até hoje' : undefined}
            class={cn(
              'h-7 shrink-0 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors',
              // O mês atual é o padrão e o mais usado: fica com o rótulo
              // completo, os anteriores abreviam para a barra caber no notebook.
              preset === p ? 'bg-surface-2 text-fg surface-raised' : 'text-fg-muted hover:text-fg',
            )}
          >
            {p === 'custom' ? (
              <>
                <span class="hidden sm:inline">Personalizado</span>
                <span class="sm:hidden">Livre</span>
              </>
            ) : p === 'm0' ? (
              <>
                <span class="hidden sm:inline" title={`1 a ${new Date().getDate()} de ${presetLabel('m0')}`}>{presetLabel(p)}</span>
                <span class="sm:hidden">{presetLabel(p, true)}</span>
              </>
            ) : presetLabel(p, true)}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div class="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            class="h-7 rounded-md border border-border bg-surface-inset surface-inset px-2 text-xs text-fg focus:border-accent focus:outline-none"
            value={customFrom}
            max={customTo || hoje()}
            onInput={(e) => onCustom('from', (e.target as HTMLInputElement).value)}
            aria-label="Data inicial"
          />
          <span class="text-xs text-fg-muted">até</span>
          <input
            type="date"
            class="h-7 rounded-md border border-border bg-surface-inset surface-inset px-2 text-xs text-fg focus:border-accent focus:outline-none"
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
 * Querystring das rotas que aceitam `range` + `from`/`to`.
 *
 * O que vale são as DATAS: o backend prioriza `from`/`to` e só cai no `range`
 * quando elas faltam (lib/period.ts). Por isso os presets de mês não exigiram
 * mudança de servidor — ele recebe o intervalo pronto.
 */
export function periodQuery(r: PeriodRange): string {
  return `range=custom&from=${r.dateFrom}&to=${r.dateTo}`
}

/** Rótulo do período para textos corridos ("em Agosto", "de … a …"). */
export function periodLabel(r: PeriodRange): string {
  if (r.preset !== 'custom' || r.incomplete) {
    const p = r.preset === 'custom' ? 'm0' : r.preset
    return `em ${presetLabel(p)}`
  }
  const br = (iso: string) => iso.split('-').reverse().join('/')
  return `de ${br(r.dateFrom)} a ${br(r.dateTo)}`
}

/** Aviso padrão de intervalo personalizado ainda incompleto. */
export function PeriodIncompleteHint({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p class="-mt-1 text-2xs text-fg-muted">
      Escolha as duas datas para aplicar o período personalizado — exibindo o mês atual.
    </p>
  )
}

/** Compatibilidade: telas que importavam o mapa de rótulos. */
export const PRESET_LABELS: Record<RangePreset, string> = {
  m0: presetLabel('m0'), m1: presetLabel('m1'), m2: presetLabel('m2'),
  m3: presetLabel('m3'), m4: presetLabel('m4'), custom: 'Personalizado',
}
