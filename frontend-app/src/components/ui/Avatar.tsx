import { cn } from '@/lib/cn'

/**
 * Paleta de avatares — fechada de propósito, pelo mesmo motivo de
 * `lib/channelColors.ts`: com cor livre saem tons que somem num dos temas.
 *
 * Todos os oito pares foram medidos contra TEXTO BRANCO nas duas pontas do
 * degradê; o pior caso é 4,63:1 (verde, ponta clara), acima do mínimo de 4,5:1.
 * As iniciais têm ~10px em negrito, o que NÃO conta como "texto grande" na
 * WCAG — por isso o piso é 4,5:1 e não 3:1. Ao acrescentar um par novo, meça.
 *
 * A cor é fixa em hexadecimal e não vem de token: o avatar é a mesma pessoa nos
 * dois temas, e trocar a cor dela junto com o tema desfaria justamente o que ele
 * serve para fazer — ser reconhecido de relance.
 */
const GRADIENTS: readonly (readonly [string, string])[] = [
  ['#396BCC', '#1548AD'], // índigo
  ['#8055BE', '#62309E'], // violeta
  ['#B0407D', '#8F115E'], // rosa
  ['#BB3F3D', '#990B19'], // coral
  ['#A35C00', '#784200'], // âmbar
  ['#1A872B', '#006414'], // verde
  ['#01817C', '#005E5A'], // teal
  ['#007BA3', '#005978'], // azul
] as const

/** FNV-1a: espalha bem para strings curtas e é estável entre sessões —
 *  o mesmo contato precisa ter a mesma cor hoje e amanhã. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Iniciais do nome.
 *
 * Contato sem nome cadastrado costuma chegar com o telefone no lugar do nome
 * (ver a regra de identidade do lead: pushName nunca é nome). Extrair "62" de
 * "62 99811-4423" não identifica ninguém, então palavras sem letra são
 * descartadas e o avatar cai no traço neutro.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '')
    .split(/[\s.]+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0] as string
  const last = words.length > 1 ? (words[words.length - 1] as string) : ''
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase()
}

const sizeClasses = {
  xs: 'size-4.5 rounded text-[0.5rem]',
  sm: 'size-6 rounded-md text-3xs',
  md: 'size-7 rounded-md text-2xs',
  lg: 'size-10 rounded-lg text-sm',
} as const

interface AvatarProps {
  /** Nome exibido — de onde saem as iniciais. */
  name?: string | null | undefined
  /**
   * Chave estável para a cor. Use o id do lead/usuário sempre que houver: o
   * nome muda (o contato se identifica depois) e a cor mudaria junto.
   */
  seed?: string | number | undefined
  /** Foto, quando existir. Substitui iniciais e degradê. */
  src?: string | null | undefined
  size?: keyof typeof sizeClasses | undefined
  /** Círculo em vez de quadrado arredondado. */
  round?: boolean | undefined
  class?: string | undefined
}

/**
 * Identidade visual de uma pessoa em uma célula.
 *
 * O painel tinha 118 lugares desenhando um círculo cinza com iniciais à mão.
 * Cinza não identifica: numa lista de vinte linhas todos os círculos são iguais
 * e o olho tem de ler cada nome. Com cor derivada do id, a mesma pessoa vira
 * reconhecível de relance — que é o trabalho que um avatar existe para fazer.
 */
export function Avatar({ name, seed, src, size = 'sm', round = false, class: className }: AvatarProps) {
  const ini = initials(name)
  const key = String(seed ?? name ?? '')
  const [from, to] = GRADIENTS[hash(key) % GRADIENTS.length] as readonly [string, string]
  const label = name || 'Sem nome'

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        class={cn('shrink-0 object-cover bg-surface-3', sizeClasses[size], round && 'rounded-full', className)}
      />
    )
  }

  return (
    <span
      class={cn(
        'shrink-0 grid place-items-center font-bold text-white select-none',
        sizeClasses[size],
        round && 'rounded-full',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: 'var(--hairline-fill), var(--shadow-sm)',
      }}
      title={label}
      aria-hidden="true"
    >
      {ini || <span class="opacity-70">·</span>}
    </span>
  )
}
