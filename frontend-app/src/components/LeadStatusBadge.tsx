// Pílula colorida pra etapa do lead. Cada etapa do funil ganha uma cor própria
// que reflete a posição do lead na jornada (entrada → engajamento → ação →
// conversão → perda) e o texto sempre é forçado pra branco/preto pra garantir
// contraste de leitura.
//
// Etapas customizadas (que não estão no mapa) caem num fallback determinístico
// por hash — assim o mesmo nome sempre ganha a mesma cor entre sessões.

import { cn } from '@/lib/cn'

// Cada classe é uma string literal pra que o scanner do Tailwind v4 consiga
// gerar as utilities no build.
const STATUS_CLASSES: Record<string, string> = {
  // Entrada do funil — leads novos e aguardando
  novo: 'bg-blue-500 text-white',
  lead: 'bg-blue-500 text-white',
  new: 'bg-blue-500 text-white',
  aguardando: 'bg-slate-400 text-white',
  pending: 'bg-slate-400 text-white',
  pendente: 'bg-slate-400 text-white',

  // Engajamento — primeiro contato e qualificação
  contatado: 'bg-sky-500 text-white',
  contato: 'bg-sky-500 text-white',
  contacted: 'bg-sky-500 text-white',
  qualificado: 'bg-indigo-500 text-white',
  qualified: 'bg-indigo-500 text-white',

  // Reunião / agendamento
  reuniao: 'bg-cyan-500 text-white',
  'reunião': 'bg-cyan-500 text-white',
  reuniao_agendada: 'bg-cyan-500 text-white',
  meeting: 'bg-cyan-500 text-white',
  agendado: 'bg-cyan-600 text-white',

  // Acionável — chamada / convocação / próxima ação
  convocado: 'bg-amber-400 text-black',
  convocacao: 'bg-amber-400 text-black',
  'convocação': 'bg-amber-400 text-black',
  prova: 'bg-amber-500 text-black',

  // Negociação
  proposta: 'bg-violet-500 text-white',
  proposal: 'bg-violet-500 text-white',
  negociacao: 'bg-orange-500 text-white',
  'negociação': 'bg-orange-500 text-white',
  negotiation: 'bg-orange-500 text-white',

  // Conversão / sucesso
  inscrito: 'bg-emerald-500 text-white',
  inscricao: 'bg-emerald-500 text-white',
  'inscrição': 'bg-emerald-500 text-white',
  matriculado: 'bg-emerald-600 text-white',
  enrolled: 'bg-emerald-500 text-white',
  aprovado: 'bg-teal-600 text-white',
  approved: 'bg-teal-600 text-white',
  fechado: 'bg-green-600 text-white',
  ganho: 'bg-green-600 text-white',
  won: 'bg-green-600 text-white',
  convertido: 'bg-green-600 text-white',
  completed: 'bg-green-600 text-white',
  completo: 'bg-green-600 text-white',
  sent: 'bg-emerald-500 text-white',

  // Perda / cancelamento
  perdido: 'bg-rose-500 text-white',
  lost: 'bg-rose-500 text-white',
  cancelled: 'bg-rose-500 text-white',
  cancelado: 'bg-rose-500 text-white',
  failed: 'bg-rose-600 text-white',
  reprovado: 'bg-red-600 text-white',
}

// Paleta de fallback pra etapas customizadas — escolhida por hash determinístico.
// Listadas literalmente pro Tailwind detectar.
const FALLBACK_PALETTE: string[] = [
  'bg-fuchsia-500 text-white',
  'bg-pink-500 text-white',
  'bg-lime-600 text-white',
  'bg-stone-500 text-white',
  'bg-yellow-400 text-black',
  'bg-purple-500 text-white',
  'bg-zinc-600 text-white',
  'bg-emerald-700 text-white',
]

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return h >>> 0
}

function normalize(status: string): string {
  return status.toLowerCase().trim().replace(/[\s-]+/g, '_')
}

export function leadStatusClass(status: string | null | undefined): string {
  if (!status) return 'bg-surface-3 text-fg-muted'
  const k = normalize(status)
  if (STATUS_CLASSES[k]) return STATUS_CLASSES[k]
  // Tenta também sem normalização (cobre chaves que usam acento "reunião")
  const raw = status.toLowerCase().trim()
  if (STATUS_CLASSES[raw]) return STATUS_CLASSES[raw]
  return FALLBACK_PALETTE[djb2(k) % FALLBACK_PALETTE.length]!
}

interface Props {
  status: string
  class?: string
}

export function LeadStatusBadge({ status, class: className }: Props) {
  return (
    <span
      class={cn(
        'inline-flex items-center h-5 px-2 rounded-full text-[0.6875rem] font-medium tabular-nums whitespace-nowrap',
        leadStatusClass(status),
        className,
      )}
    >
      {status}
    </span>
  )
}
