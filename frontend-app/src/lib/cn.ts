import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge condicional de classes Tailwind, resolvendo conflitos.
 * Uso: cn('px-2 py-1', isActive && 'bg-accent', props.class)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
