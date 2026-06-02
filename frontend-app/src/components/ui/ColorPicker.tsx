// Pick Colors — picker de cor unificado de toda a UI editável (Landing Pages,
// Forms, Painel admin, Aparência, Funis, Tags, Notificações, etc).
//
// Logica:
//   - Trigger compacto: chip da cor + hex visível (clicável)
//   - Click → Popover (Radix) com:
//       · Saturation/Hue picker (HsvaColorPicker) — gradient + slider de matiz
//       · Slider de transparência (alpha)
//       · Input hex com validação
//       · Sliders RGB (controle fino)
//       · Presets de marca + atalho "Pegar do navegador" (eyedropper nativo
//         via <input type="color">)
//
// API mantida (compat com 30+ chamadas existentes):
//   <ColorPicker value onChange label hint />
// `value` aceita "#RRGGBB" ou "#RRGGBBAA" — saída segue o mesmo formato.

import { useState, useEffect, useId } from 'preact/hooks'
import * as Popover from '@radix-ui/react-popover'
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful'
import { Pipette } from 'lucide-preact'
import { cn } from '@/lib/cn'

const PRESET_COLORS = [
  '#1a73e8', '#4285f4', '#9334e6', '#7c4dff',
  '#34a853', '#22c55e', '#fbbc04', '#f59e0b',
  '#ea4335', '#dc2626', '#f06292', '#ec4899',
  '#26c6da', '#0ea5e9', '#26a69a', '#10b981',
  '#5f6368', '#1f2937', '#ffffff', '#000000',
]

interface ColorPickerProps {
  value: string
  onChange: (v: string) => void
  label?: string
  hint?: string
  /** Permitir alpha (RRGGBBAA). Default: detecta automaticamente do value. */
  alpha?: boolean
  /** Posição da pop. Default 'bottom'. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}

function isHex6(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}
function isHex8(v: string): boolean {
  return /^#[0-9a-fA-F]{8}$/.test(v)
}
function isValidHex(v: string): boolean {
  return isHex6(v) || isHex8(v)
}
function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } | null {
  const v = hex.startsWith('#') ? hex.slice(1) : hex
  if (v.length === 6) {
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 255 }
  }
  if (v.length === 8) {
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: parseInt(v.slice(6, 8), 16) }
  }
  return null
}
function rgbToHex(r: number, g: number, b: number, a?: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  const base = `#${c(r)}${c(g)}${c(b)}`
  return a !== undefined && a < 255 ? `${base}${c(a)}` : base
}

export function ColorPicker({ value, onChange, label = 'Cor', hint, alpha, side = 'bottom' }: ColorPickerProps) {
  const useAlpha = alpha ?? isHex8(value)
  const [open, setOpen] = useState(false)
  const [hexDraft, setHexDraft] = useState(value)
  const fieldId = useId()

  useEffect(() => { setHexDraft(value) }, [value])

  function commit(v: string) {
    if (!isValidHex(v)) return
    onChange(v.toLowerCase())
  }
  function commitHexInput() {
    let v = hexDraft.trim()
    if (!v.startsWith('#')) v = `#${v}`
    if (isValidHex(v)) commit(v)
    else setHexDraft(value) // reverte se inválido
  }

  // RGB sliders trabalham sobre os 3 canais (alfa preservado)
  const rgb = hexToRgb(value)
  function setChannel(ch: 'r' | 'g' | 'b', n: number) {
    if (!rgb) return
    const next = { ...rgb, [ch]: n }
    commit(rgbToHex(next.r, next.g, next.b, useAlpha ? next.a : undefined))
  }

  const swatchBg = isValidHex(value) ? value : '#ffffff'

  return (
    <div class="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} class="text-xs font-medium text-fg-muted">{label}</label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={fieldId}
            type="button"
            class={cn(
              'inline-flex items-center gap-2 h-8 px-2 rounded-md border border-border bg-surface',
              'hover:border-accent focus:border-accent focus:outline-none transition-colors',
              'text-xs font-mono text-fg w-full',
            )}
            aria-label={`${label}: ${value}`}
          >
            <span
              class="size-5 rounded-sm border border-border shrink-0"
              style={{
                background: swatchBg,
                // checkered bg pra revelar transparência
                backgroundImage: useAlpha
                  ? 'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)'
                  : undefined,
                backgroundSize: useAlpha ? '8px 8px' : undefined,
                backgroundPosition: useAlpha ? '0 0, 4px 4px' : undefined,
              }}
            >
              <span
                class="block size-full rounded-sm"
                style={{ background: swatchBg }}
              />
            </span>
            <span class="flex-1 text-left truncate">{value}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={side}
            align="start"
            sideOffset={6}
            class="z-50 w-[18rem] rounded-lg border border-border bg-surface-2 shadow-xl p-3 space-y-3"
            style={{ zIndex: 'var(--z-popover)' }}
          >
            {useAlpha
              ? <HexAlphaColorPicker color={value} onChange={commit} style={{ width: '100%' }} />
              : <HexColorPicker color={isHex8(value) ? value.slice(0, 7) : value} onChange={commit} style={{ width: '100%' }} />}

            {/* Hex input + eyedropper nativo */}
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={hexDraft}
                spellcheck={false}
                maxLength={9}
                onInput={(e) => setHexDraft((e.target as HTMLInputElement).value)}
                onBlur={commitHexInput}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHexInput() } }}
                class="flex-1 h-8 rounded-md border border-border bg-surface px-2 text-xs font-mono text-fg focus:border-accent focus:outline-none"
                placeholder="#RRGGBB"
              />
              <label
                class="size-8 grid place-items-center rounded-md border border-border bg-surface hover:border-accent cursor-pointer text-fg-muted hover:text-fg overflow-hidden relative"
                title="Pegar do navegador / eyedropper"
              >
                <Pipette size={14} />
                <input
                  type="color"
                  value={isHex8(value) ? value.slice(0, 7) : value}
                  onInput={(e) => commit((e.target as HTMLInputElement).value)}
                  class="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Selecionar cor com eyedropper do navegador"
                />
              </label>
            </div>

            {/* RGB sliders (controle fino) */}
            {rgb && (
              <div class="space-y-1.5">
                <RgbSlider channel="r" value={rgb.r} onChange={(n) => setChannel('r', n)} />
                <RgbSlider channel="g" value={rgb.g} onChange={(n) => setChannel('g', n)} />
                <RgbSlider channel="b" value={rgb.b} onChange={(n) => setChannel('b', n)} />
              </div>
            )}

            {/* Presets */}
            <div>
              <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mb-1.5">Presets</div>
              <div class="grid grid-cols-10 gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    class={cn(
                      'size-5 rounded-sm border transition-all',
                      value.toLowerCase().slice(0, 7) === c.toLowerCase()
                        ? 'border-fg ring-1 ring-fg ring-offset-1 ring-offset-surface-2'
                        : 'border-border hover:scale-110',
                    )}
                    style={{ background: c }}
                    onClick={() => commit(c)}
                    aria-label={c}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {hint && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
    </div>
  )
}

function RgbSlider({ channel, value, onChange }: { channel: 'r' | 'g' | 'b'; value: number; onChange: (v: number) => void }) {
  const labelMap = { r: 'R', g: 'G', b: 'B' }
  const colorMap = { r: 'var(--color-danger,#dc2626)', g: 'var(--color-success,#16a34a)', b: 'var(--color-info,#2563eb)' }
  return (
    <div class="flex items-center gap-2">
      <span class="text-[0.625rem] font-mono text-fg-muted w-3 shrink-0" style={{ color: colorMap[channel] }}>
        {labelMap[channel]}
      </span>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value))}
        class="flex-1 accent-accent"
        aria-label={`Canal ${labelMap[channel]}`}
      />
      <span class="text-[0.625rem] font-mono text-fg-muted tabular-nums w-7 text-right">{value}</span>
    </div>
  )
}
