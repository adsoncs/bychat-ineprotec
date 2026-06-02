import type { ComponentChildren } from 'preact'
import { Modal } from './Modal'
import { Button } from './Button'

export interface HowItWorksStep {
  title: string
  body: ComponentChildren
}

export interface HowItWorksTip {
  tone?: 'info' | 'warning' | 'success'
  title: string
  body: ComponentChildren
}

export interface HowItWorksModalProps {
  open: boolean
  onClose: () => void
  /** Título exibido no header. Ex: "Como funciona o Kanban?" */
  title: string
  /** Bloco azul de abertura: contexto/problema que o módulo resolve. */
  problem: ComponentChildren
  /** Passos numerados (geralmente 3 a 6). */
  steps: HowItWorksStep[]
  /** Caixa final colorida com dicas, pré-requisitos ou observações. */
  tip?: HowItWorksTip | undefined
  /** Botões extras renderizados antes do "Fechar" no footer (ex.: "Criar agora"). */
  actions?: ComponentChildren
}

const tipToneClass: Record<NonNullable<HowItWorksTip['tone']>, string> = {
  info: 'bg-info/10 border-info/30',
  warning: 'bg-warning/10 border-warning/30',
  success: 'bg-success/10 border-success/30',
}

export function HowItWorksModal({
  open,
  onClose,
  title,
  problem,
  steps,
  tip,
  actions,
}: HowItWorksModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={title}
      size="lg"
      footer={
        <>
          {actions}
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">{problem}</div>
        </div>

        <div class="space-y-3">
          {steps.map((s, i) => (
            <Step key={i} n={i + 1} title={s.title}>{s.body}</Step>
          ))}
        </div>

        {tip && (
          <div class={`rounded-lg p-4 border ${tipToneClass[tip.tone ?? 'info']}`}>
            <div class="font-semibold text-fg mb-1">{tip.title}</div>
            <div class="text-xs text-fg-muted leading-relaxed">{tip.body}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
