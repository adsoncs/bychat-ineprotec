import { cn } from '@/lib/cn'

interface SkeletonProps {
  class?: string
}

/** Bloco animado para placeholder de carregamento. Use w-/h- para dimensionar. */
export function Skeleton({ class: className }: SkeletonProps) {
  /* Raio um degrau acima para casar com os controles da pele; `prefers-reduced-
     motion` já neutraliza o pulse globalmente (styles/global.css). */
  return <span class={cn('block rounded-md bg-surface-3 animate-pulse', className)} aria-hidden="true" />
}
