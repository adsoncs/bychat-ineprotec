import { cn } from '@/lib/cn'

interface ScoreBarProps {
  /** 0 a 100. Fora da faixa é aparado — um score de 140 não desenha barra maior. */
  value: number | null | undefined
  /** Texto do tooltip nativo; sem ele, mostra o número. */
  title?: string | undefined
  /**
   * Cor da barra, para quem JÁ tem o veredito por outra régua (o Lead Score da
   * IA, por exemplo, classifica em quente/morno/frio por conta própria). Sem
   * isto a barra coloriria pela faixa numérica e poderia contradizer, na mesma
   * célula, o rótulo que a IA deu.
   */
  color?: string | undefined
  class?: string | undefined
}

/**
 * Faixas do score. Os cortes são os terços — não há ciência nisso, e é
 * justamente por isso que ficam declarados aqui em vez de espalhados: quando o
 * produto tiver uma régua real de qualificação, muda-se este array e pronto.
 */
const BANDS = [
  { min: 67, color: 'var(--data-success)', label: 'quente' },
  { min: 34, color: 'var(--data-warning)', label: 'morno' },
  { min: 0, color: 'var(--data-danger)', label: 'frio' },
] as const

/**
 * Barra de intensidade (score do lead, engajamento, progresso de meta).
 *
 * A cor é UMA SÓ, escolhida pela faixa — não um degradê de vermelho a verde.
 * A primeira versão era degradê e virava lama: numa barra de 36×6px as três
 * cores não têm pixels para se separar, e no tema claro o amarelo é marrom
 * escuro, então vermelho→marrom→verde saía como uma tira suja. Cor sólida diz
 * o veredito de relance, que é o trabalho da barra.
 *
 * O comprimento continua carregando o valor exato; a cor carrega o julgamento.
 */
export function ScoreBar({ value, title, color, class: className }: ScoreBarProps) {
  const pct = value == null ? null : Math.max(0, Math.min(100, value))
  const band = pct == null ? null : (BANDS.find((b) => pct >= b.min) ?? BANDS[BANDS.length - 1])
  const label =
    title ?? (pct == null ? 'Sem score' : `${Math.round(pct)}/100 — ${band?.label ?? ''}`.trim())

  return (
    <span
      class={cn('inline-block h-1.5 w-9 shrink-0 overflow-hidden rounded-full bg-surface-3', className)}
      title={label}
      role="img"
      aria-label={pct == null ? 'Sem score' : `Score ${Math.round(pct)} de 100`}
    >
      {pct != null && band && (
        <span
          class="block h-full rounded-full"
          style={{ width: `${Math.max(pct, 4)}%`, background: color ?? band.color }}
        />
      )}
    </span>
  )
}
