import { useMemo } from 'preact/hooks'
import {
  Activity, BadgeCheck, Briefcase, Building, Building2, CalendarClock, CalendarDays, CalendarRange, CircleUser,
  ClipboardCheck, Clock, Flag, Flame, FormInput, GitBranch, Globe, GraduationCap, Hash, History, IdCard,
  Layers, ListChecks, LogIn, Mail, MapPin, Phone, Receipt, School, Sparkles, StickyNote, Tag, Ticket, Timer,
  Trophy, Wallet,
} from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { useCustomFields } from '@/hooks/useCustomFields'
import type { KanbanLead } from '@/hooks/useKanban'
import { eduCellText, useEducacionalAtivo } from '@/components/leads/eduColumns'
import { EDU_LEAD_COLUMNS, LEAD_COLUMN_LABELS, type EduColumnKey } from '@/stores/leadsColumns'
import { useKanbanCardStore, type KanbanCardBlock, type KanbanCardDado } from '@/stores/kanbanCard'

type Icone = typeof Phone

// ── Blocos que o card sempre teve ───────────────────────────────────────────

export interface BlocoInfo { id: KanbanCardBlock; label: string; descricao: string; icon: Icone }

/** Na ordem em que aparecem no card — a tela de configuração segue a mesma
 *  ordem, para o agente achar cada coisa onde ela está. */
export const GRUPOS_DE_BLOCOS: { titulo: string; blocos: BlocoInfo[] }[] = [
  {
    titulo: 'Cabeçalho',
    blocos: [
      { id: 'empresa', label: 'Empresa', descricao: 'Abaixo do nome, quando o lead tem os dois', icon: Building },
    ],
  },
  {
    titulo: 'Sinais',
    blocos: [
      { id: 'score', label: 'Score', descricao: 'Barra e número do score', icon: Activity },
      { id: 'atividades', label: 'Atividades pendentes', descricao: 'Quantas tarefas estão em aberto', icon: ListChecks },
      { id: 'situacao', label: 'Situação (resumo)', descricao: 'Código da situação atual do lead', icon: Flag },
      { id: 'resultado', label: 'Ganho / Perdido', descricao: 'O desfecho, quando já foi classificado', icon: Trophy },
      { id: 'parado', label: 'Dias parado', descricao: 'Alerta de lead sem movimento há 5 dias ou mais', icon: Timer },
    ],
  },
  {
    titulo: 'Contato e negócio',
    blocos: [
      { id: 'whatsapp', label: 'WhatsApp', descricao: 'Número do contato', icon: Phone },
      { id: 'email', label: 'E-mail', descricao: 'Clique abre o seu e-mail', icon: Mail },
      { id: 'inscricoes', label: 'Inscrições em paralelo', descricao: 'Quando há mais de uma inscrição aberta', icon: Layers },
      { id: 'negociacao', label: 'Negociação', descricao: 'Título, valor e prazo de fechamento', icon: Wallet },
      { id: 'camposDaEmpresa', label: 'Campos marcados pela empresa', descricao: 'Os campos personalizados com "mostrar no Kanban"', icon: FormInput },
    ],
  },
  {
    titulo: 'Rodapé',
    blocos: [
      { id: 'responsavel', label: 'Responsável', descricao: 'Primeiro nome de quem atende, ou "Fila"', icon: CircleUser },
      { id: 'tags', label: 'Etiquetas', descricao: 'Pontos coloridos das etiquetas', icon: Tag },
      { id: 'anotacao', label: 'Anotação', descricao: 'Marca de que o lead tem nota', icon: StickyNote },
      { id: 'formulario', label: 'Formulário de origem', descricao: 'Nome do formulário do Meta Ads', icon: Sparkles },
      { id: 'criado', label: 'Há quanto tempo chegou', descricao: '"hoje", "ontem", "3d"', icon: Clock },
    ],
  },
]

// ── Dados que o agente acrescenta ───────────────────────────────────────────

export interface DadoInfo { id: KanbanCardDado; label: string; icon: Icone; grupo: 'Lead' | 'Educacional' | 'Campos personalizados' }

const DADOS_DO_LEAD: DadoInfo[] = [
  { id: 'lead:segmento', label: 'Segmento', icon: Briefcase, grupo: 'Lead' },
  { id: 'lead:cidade', label: 'Cidade', icon: MapPin, grupo: 'Lead' },
  { id: 'lead:aiScore', label: 'Score IA', icon: Flame, grupo: 'Lead' },
  { id: 'lead:origem', label: 'Origem', icon: Globe, grupo: 'Lead' },
  { id: 'lead:uid', label: 'ID do lead', icon: Hash, grupo: 'Lead' },
  { id: 'lead:criadoEm', label: 'Data de cadastro', icon: CalendarClock, grupo: 'Lead' },
  { id: 'lead:atualizadoEm', label: 'Última movimentação', icon: History, grupo: 'Lead' },
  { id: 'lead:responsavelCompleto', label: 'Responsável (nome completo)', icon: CircleUser, grupo: 'Lead' },
]

const ICONE_EDU: Record<EduColumnKey, Icone> = {
  eduCursoInscricao: GraduationCap,
  eduStatusInscricao: ClipboardCheck,
  eduPagamento: Receipt,
  eduFormaIngresso: LogIn,
  eduPolo: Building2,
  eduPortal: Globe,
  eduProcesso: CalendarRange,
  eduDataInscricao: CalendarDays,
  eduCodigo: Ticket,
  eduCursoMatricula: School,
  eduSituacaoMatricula: BadgeCheck,
  eduRa: IdCard,
  eduPeriodo: GitBranch,
}

/** Tudo que o agente pode acrescentar — os mesmos dados da lista de Leads. */
export function useCatalogoDeDados(): DadoInfo[] {
  const eduAtivo = useEducacionalAtivo()
  const { data } = useCustomFields()
  return useMemo(() => [
    ...DADOS_DO_LEAD,
    ...(eduAtivo ? EDU_LEAD_COLUMNS.map((c): DadoInfo => ({ id: `edu:${c}`, label: LEAD_COLUMN_LABELS[c], icon: ICONE_EDU[c], grupo: 'Educacional' })) : []),
    ...(data?.fields ?? []).filter((f) => f.active).map((f): DadoInfo => ({ id: `cf:${f.key}`, label: f.label, icon: FormInput, grupo: 'Campos personalizados' })),
  ], [eduAtivo, data?.fields])
}

const ROTULO_IA: Record<string, string> = { hot: 'Quente', warm: 'Morno', cold: 'Frio' }

function textoDoCampo(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
  return String(v)
}

/** Rótulo da origem; código cru sem tradução ("inbound_webhook") vira texto. */
function origemLegivel(source: string): string {
  const l = leadSourceLabel(source)
  if (l !== source || !/[_-]/.test(l)) return l
  const t = l.replace(/[_-]+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function haQuanto(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(d)) return ''
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`
}

/** Valor de um dado para este lead. Vazio = a linha não aparece. */
export function valorDoDado(lead: KanbanLead, id: KanbanCardDado): { text: string; title: string } {
  const [tipo, chave] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
  if (tipo === 'edu') {
    const r = eduCellText(lead, chave as EduColumnKey)
    return r.text === '—' ? { text: '', title: '' } : r
  }
  if (tipo === 'cf') {
    const t = textoDoCampo((lead.customFields ?? {})[chave])
    return { text: t, title: t }
  }
  let t = ''
  switch (chave) {
    case 'segmento': t = lead.segmento ?? ''; break
    case 'cidade': t = lead.cidade ?? ''; break
    case 'uid': t = lead.uid ?? ''; break
    case 'origem': t = lead.source ? origemLegivel(lead.source) : ''; break
    case 'criadoEm': t = formatDateTime(lead.createdAt); break
    case 'atualizadoEm': t = haQuanto(lead.updatedAt); break
    case 'responsavelCompleto': t = lead.assignedUser?.name ?? ''; break
    case 'aiScore':
      t = lead.aiScore == null ? '' : [lead.aiScoreLabel ? ROTULO_IA[lead.aiScoreLabel] ?? lead.aiScoreLabel : null, Math.round(lead.aiScore)].filter((x) => x != null).join(' · ')
      break
  }
  return { text: t, title: t }
}

/**
 * As linhas de dados escolhidas pelo agente.
 *  - `card`: uma por linha, ícone + rótulo + valor (o rótulo some no modo "só ícone").
 *  - `linha`: em sequência, para a visualização em lista.
 * `mostrarVazios` é da prévia: sem ele o agente não veria onde a linha cairia
 * num lead que não tem o dado.
 */
export function KanbanCardDados({ lead, modo = 'card', mostrarVazios = false }: {
  lead: KanbanLead
  modo?: 'card' | 'linha'
  mostrarVazios?: boolean
}) {
  const dados = useKanbanCardStore((s) => s.dados)
  const rotulos = useKanbanCardStore((s) => s.rotulos)
  const catalogo = useCatalogoDeDados()
  const porId = useMemo(() => new Map(catalogo.map((d) => [d.id, d])), [catalogo])

  const linhas = dados
    .map((id) => ({ info: porId.get(id), ...valorDoDado(lead, id) }))
    .filter((l): l is { info: DadoInfo; text: string; title: string } => !!l.info && (mostrarVazios || !!l.text))
  if (linhas.length === 0) return null

  if (modo === 'linha') {
    return (
      <>
        {linhas.map(({ info, text, title }) => (
          <span key={info.id} class="inline-flex items-center gap-1 min-w-0 max-w-[12rem]" title={`${info.label}: ${title || '—'}`}>
            <info.icon size={10} class="shrink-0" />
            <span class="truncate">{text || '—'}</span>
          </span>
        ))}
      </>
    )
  }

  return (
    <div class="mt-1.5 space-y-0.5">
      {linhas.map(({ info, text, title }) => (
        <div key={info.id} class="flex items-center gap-1.5 text-2xs leading-snug min-w-0" title={`${info.label}: ${title || '—'}`}>
          <info.icon size={10} class="shrink-0 text-fg-muted" />
          {rotulos === 'texto' && <span class="shrink-0 text-fg-muted">{info.label}:</span>}
          <span class={cn('truncate', text ? 'text-fg' : 'text-fg-muted italic')}>{text || 'sem dado'}</span>
        </div>
      ))}
    </div>
  )
}
