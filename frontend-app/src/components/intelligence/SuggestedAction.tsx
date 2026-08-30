import { MessageCircle, Mail, RefreshCw, MessageSquareDashed } from '@/components/ui/icon-set'
import type { IntelLead, ScanMode } from '@/hooks/useIntelligence'

interface Suggestion {
  label: string
  tone: 'success' | 'info' | 'warning' | 'neutral'
  icon: typeof MessageCircle
  onClick: () => void
  title: string
}

interface SuggestedActionProps {
  lead: IntelLead
  onRun: (mode: ScanMode, force?: boolean) => void
}

const STALE_DAYS = 30
const COLD_CONVERSATION_DAYS = 7

function digits(s: string) { return s.replace(/\D/g, '') }
function isValidEmail(s: string | null | undefined): s is string {
  if (!s) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}
function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

function pickSuggestion(lead: IntelLead, onRun: SuggestedActionProps['onRun']): Suggestion | null {
  const lgpd = lead.lgpdConsent
  const hasWhats = !!(lead.whatsapp && digits(lead.whatsapp).length >= 10)
  const hasEmail = isValidEmail(lead.email)
  const conversationOpen = !!lead.conversationOpenedAt &&
    (!lead.conversationClosedAt || new Date(lead.conversationOpenedAt) > new Date(lead.conversationClosedAt))

  const enrichedDays = daysSince(lead.enrichedAt)
  const lastActivityDays = daysSince(lead.updatedAt ?? lead.createdAt)

  // Já em conversa aberta — operador deve continuar lá, não sugerir nada novo
  if (conversationOpen) return null

  // Lead enriquecido + WhatsApp + sem conversa recente → iniciar conversa é o golpe certo
  if (lgpd && hasWhats && (lead.enrichmentStatus === 'done' || lead.enrichmentStatus === 'partial')) {
    if (lastActivityDays > COLD_CONVERSATION_DAYS) {
      return {
        label: 'Iniciar conversa',
        tone: 'success',
        icon: MessageCircle,
        title: `Sem atividade há ${Math.round(lastActivityDays)}d. Iniciar conversa pelo WhatsApp.`,
        onClick: () => window.open(`https://wa.me/${digits(lead.whatsapp!)}`, '_blank', 'noopener'),
      }
    }
  }

  // Sem WhatsApp mas tem email → sugerir email
  if (lgpd && !hasWhats && hasEmail) {
    return {
      label: 'Enviar email',
      tone: 'info',
      icon: Mail,
      title: `Sem WhatsApp validado. Enviar email para ${lead.email}.`,
      onClick: () => window.open(`mailto:${lead.email}`, '_self'),
    }
  }

  // Enriquecido há muito tempo → sugerir reenriquecer (dados públicos podem ter mudado)
  if (lgpd && enrichedDays > STALE_DAYS && lead.enrichmentStatus !== 'running') {
    return {
      label: 'Reenriquecer',
      tone: 'warning',
      icon: RefreshCw,
      title: `Última coleta há ${Math.round(enrichedDays)}d. Dados podem estar desatualizados.`,
      onClick: () => onRun('quick', true),
    }
  }

  // Lead novo com WhatsApp mas sem nenhum contato registrado
  if (lgpd && hasWhats && lastActivityDays < 1 && !lead.conversationOpenedAt) {
    return {
      label: 'Iniciar conversa',
      tone: 'success',
      icon: MessageCircle,
      title: 'Lead novo. Iniciar conversa pelo WhatsApp.',
      onClick: () => window.open(`https://wa.me/${digits(lead.whatsapp!)}`, '_blank', 'noopener'),
    }
  }

  // Lead sem dados acionáveis
  if (lgpd && !lead.enrichedAt) {
    return {
      label: 'Enriquecer',
      tone: 'neutral',
      icon: RefreshCw,
      title: 'Lead nunca foi enriquecido. Coletar dados públicos.',
      onClick: () => onRun('full'),
    }
  }

  return null
}

const TONE_CLASSES: Record<Suggestion['tone'], string> = {
  success: 'bg-success/15 text-success hover:bg-success/25 border-success/30',
  info: 'bg-info/15 text-info hover:bg-info/25 border-info/30',
  warning: 'bg-warning/15 text-warning hover:bg-warning/25 border-warning/30',
  neutral: 'bg-surface-3 text-fg-muted hover:bg-surface-3 hover:text-fg border-border',
}

export function SuggestedAction({ lead, onRun }: SuggestedActionProps) {
  const suggestion = pickSuggestion(lead, onRun)
  if (!suggestion) {
    return (
      <span class="inline-flex items-center gap-1 text-2xs text-fg-muted">
        <MessageSquareDashed size={10} /> —
      </span>
    )
  }
  const Icon = suggestion.icon
  return (
    <button
      type="button"
      onClick={suggestion.onClick}
      title={suggestion.title}
      class={`inline-flex items-center gap-1 h-6 px-2 rounded text-2xs font-medium border transition-colors ${TONE_CLASSES[suggestion.tone]}`}
    >
      <Icon size={10} /> {suggestion.label}
    </button>
  )
}
