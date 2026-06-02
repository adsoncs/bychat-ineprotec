import { cn } from '@/lib/cn'

interface SkeletonProps {
  class?: string
}

/** Bloco animado para placeholder de carregamento. Use w-/h- para dimensionar. */
export function Skeleton({ class: className }: SkeletonProps) {
  return <span class={cn('block rounded bg-surface-3 animate-pulse', className)} aria-hidden="true" />
}
