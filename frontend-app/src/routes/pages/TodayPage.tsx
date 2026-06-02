import { useState } from 'preact/hooks'
import { Sun, CheckCircle2, MessageSquare, Mail, Phone, Calendar, FileText, Megaphone, Sparkles, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useActivities,
  useUpdateActivity,
  type Activity,
  type ActivityType,
} from '@/hooks/useActivities'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { Link } from 'wouter-preact'
import { cadenceReplyClassLabel } from '@/lib/cadenceLabels'

const ICONS: Record<ActivityType, any> = {
  whatsapp:  MessageSquare,
  email:     Mail,
  sms:       MessageSquare,
  call:      Phone,
  meeting:   Calendar,
  task:      FileText,
  note:      FileText,
  follow_up: Sparkles,
}

// Labels de classe de resposta compartilhados em `@/lib/cadenceLabels`.
// Aqui apenas mapeamos a cor da badge por classe; o texto vem do label central.
const REPLY_CLASS_BADGE_CLS: Record<string, string> = {
  positiva:     'bg-success/15 text-success border-success/40',
  duvida:       'bg-info/15 text-info border-info/40',
  objecao:      'bg-warning/15 text-warning border-warning/40',
  desinteresse: 'bg-danger/15 text-danger border-danger/40',
  fora_fit:     'bg-surface-3 text-fg-subtle border-border',
}

interface LeadGroup {
  leadId: number
  leadLabel: string
  activities: Activity[]
}

export function TodayPage() {
  const { data, isLoading } = useActivities({ view: 'today', status: 'pending', limit: 100 })
  const update = useUpdateActivity()
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const groups = groupByLead(data?.activities ?? [])

  function handleComplete(activity: Activity) {
    update.mutate(
      { id: activity.id, status: 'completed' },
      {
        onSuccess: () => toast('Tarefa concluída', 'success'),
        onError: (e) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title="Hoje"
      description="Tudo que precisa da sua atenção hoje: ligações que cadências marcaram como manuais, follow-ups que a IA criou quando o lead respondeu, e atividades agendadas. Trabalhe a lista de cima pra baixo."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <Card>
          <div class="text-center py-8">
            <Sun size={32} class="mx-auto text-fg-subtle mb-3" />
            <p class="text-sm text-fg mb-1">Nada pendente para hoje</p>
            <p class="text-xs text-fg-muted max-w-md mx-auto">
              Quando uma cadência criar uma tarefa manual, ou a IA gerar um follow-up depois de uma resposta, ela aparece aqui.
            </p>
          </div>
        </Card>
      )}

      {!isLoading && groups.length > 0 && (
        <>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-fg-muted mb-3 px-1">
            <span class="font-semibold uppercase tracking-wide">Legenda:</span>
            <span class="inline-flex items-center gap-1">
              <span class="inline-flex items-center px-1.5 h-4 rounded border border-info/40 bg-info/10 text-info">cadência</span>
              gerada por uma cadência
            </span>
            <span class="inline-flex items-center gap-1">
              <span class="inline-flex items-center px-1.5 h-4 rounded border border-success/40 bg-success/15 text-success">positiva</span>
              <span class="inline-flex items-center px-1.5 h-4 rounded border border-warning/40 bg-warning/15 text-warning">objeção</span>
              IA classificou a resposta do lead
            </span>
          </div>
        <div class="flex flex-col gap-3">
          {groups.map((g) => (
            <Card key={g.leadId} class="p-0">
              <div class="px-4 py-3 border-b border-border">
                <Link href={`/leads/${g.leadId}`} class="text-sm font-semibold text-fg hover:text-primary">
                  {g.leadLabel}
                </Link>
                <span class="ml-2 text-xs text-fg-muted">{g.activities.length} {g.activities.length === 1 ? 'tarefa' : 'tarefas'}</span>
              </div>
              <ul class="divide-y divide-border">
                {g.activities.map((a) => {
                  const Icon = ICONS[a.type] ?? FileText
                  const meta = (a.metadata ?? {}) as Record<string, unknown>
                  const fromCadence = typeof meta.cadenceEnrollmentId === 'number'
                  const replyClass = typeof meta.replyClass === 'string' ? meta.replyClass : null
                  const replyBadge = replyClass
                    ? { label: cadenceReplyClassLabel(replyClass), cls: REPLY_CLASS_BADGE_CLS[replyClass] ?? 'bg-surface-3 text-fg-subtle border-border' }
                    : null
                  return (
                    <li key={a.id} class="px-4 py-3 flex items-start gap-3">
                      <Icon size={18} class="text-fg-muted mt-0.5 shrink-0" />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm font-medium text-fg">{a.title}</span>
                          {fromCadence && (
                            <span class="inline-flex items-center gap-1 px-1.5 h-5 rounded border border-info/40 bg-info/10 text-info text-[0.6875rem]">
                              <Megaphone size={10} /> cadência
                            </span>
                          )}
                          {replyBadge && (
                            <span class={`inline-flex items-center px-1.5 h-5 rounded border text-[0.6875rem] ${replyBadge.cls}`}>
                              {replyBadge.label}
                            </span>
                          )}
                        </div>
                        {a.description && (
                          <p class="text-xs text-fg-muted mt-0.5 break-words">{a.description}</p>
                        )}
                        {a.messageBody && (
                          <p class="text-xs text-fg-subtle mt-1 line-clamp-2 italic">"{a.messageBody}"</p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleComplete(a)}
                        disabled={update.isPending}
                        title="Marcar como concluída"
                      >
                        <CheckCircle2 size={12} /> Concluir
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
        </>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o painel Hoje?"
        problem={<>
          Vendedor entra no sistema de manhã e precisa saber <strong>o que fazer primeiro</strong>. Em
          vez de varrer lista de leads e tentar adivinhar prioridade, esta tela já entrega a lista de
          tarefas do dia, agrupada por lead, na ordem que faz sentido.
        </>}
        steps={[
          {
            title: '👤 Agrupado por lead',
            body: <>Várias tarefas com o mesmo lead viram um <strong>bloco único</strong>. Em vez de mandar WhatsApp, fazer ligação e enviar e-mail em momentos separados, você abre o lead uma vez e resolve tudo de uma vez.</>,
          },
          {
            title: '📌 De onde vêm as tarefas',
            body: <>Três fontes principais: <strong>atividades agendadas</strong> (você ou outro operador criou), <strong>passos manuais de cadência</strong> (cadência marcou "ligar pro lead"), <strong>follow-ups da IA</strong> (quando lead respondeu algo que precisa de resposta humana).</>,
          },
          {
            title: '⚡ Execute direto da tela',
            body: <>Para mensagens (WhatsApp/e-mail/SMS), o botão "Executar" envia direto. Para ligações e reuniões, você marca como concluída depois de fazer.</>,
          },
          {
            title: '✅ Marcar como concluída',
            body: <>Botão de check na atividade. Some daqui e libera o lead pra próxima etapa da cadência (se houver). Histórico fica no detalhe do lead.</>,
          },
          {
            title: '🏷️ Etiquetas de resposta',
            body: <>Quando a IA classifica a resposta do lead (Positiva, Dúvida, Objeção, Desinteresse), aparece a badge colorida — bata o olho e priorize as positivas/dúvidas, que estão mais perto de fechar.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Rotina sugerida',
          body: <>Comece o dia abrindo esta tela. Trabalhe de cima pra baixo. <strong>Não pule</strong> — se uma atividade está aqui, é porque o sistema (ou um colega) decidiu que ela precisa acontecer hoje. Lista vazia = dia limpo, vai cuidar de pipeline.</>,
        }}
      />
    </Page>
  )
}

function groupByLead(activities: Activity[]): LeadGroup[] {
  const map = new Map<number, LeadGroup>()
  for (const a of activities) {
    const label = a.lead?.nome || a.lead?.empresa || `Lead #${a.leadId}`
    const g = map.get(a.leadId)
    if (g) g.activities.push(a)
    else map.set(a.leadId, { leadId: a.leadId, leadLabel: label, activities: [a] })
  }
  return Array.from(map.values())
}
