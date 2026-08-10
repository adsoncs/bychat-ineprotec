import { useState } from 'preact/hooks'
import { Sun, CheckCircle2, MessageSquare, Mail, Phone, Calendar, FileText, Megaphone, Sparkles, HelpCircle, Clock, AlertCircle, User, Users, Building2 } from 'lucide-preact'
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

// Nome do canal por extenso ao lado do ícone: só o ícone obriga a decorar o
// desenho. Mesmos rótulos da tela de Atividades.
const TYPE_LABEL: Record<ActivityType, string> = {
  whatsapp:  'WhatsApp',
  email:     'E-mail',
  sms:       'SMS',
  call:      'Ligação',
  meeting:   'Reunião',
  task:      'Tarefa',
  note:      'Nota',
  follow_up: 'Follow-up',
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

const hourFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Hora "HH:MM" do agendamento, ou null quando a data é inválida/ausente. */
function hourOf(a: Activity): string | null {
  const t = new Date(a.scheduledAt)
  return Number.isNaN(t.getTime()) ? null : hourFmt.format(t)
}

function timeOf(a: Activity): number {
  const t = new Date(a.scheduledAt).getTime()
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
}

// Três estados de urgência, para a hora se ler como semáforo: passou da hora
// (vermelho), acontece na próxima hora (âmbar), o resto do dia (neutro).
type Urgency = 'overdue' | 'now' | 'later'

function urgencyOf(a: Activity, now: number): Urgency {
  // O status vem do job de atraso (30min de tolerância); a hora cobre o intervalo
  // entre vencer e o job rodar.
  if (a.status === 'overdue') return 'overdue'
  const t = timeOf(a)
  if (t === Number.MAX_SAFE_INTEGER) return 'later'
  if (t < now) return 'overdue'
  return t - now <= 3600_000 ? 'now' : 'later'
}

const URGENCY_CLS: Record<Urgency, string> = {
  overdue: 'text-danger',
  now:     'text-warning',
  later:   'text-fg',
}

/** Quem vai executar. Só o responsável explícito — `userName` é quem CRIOU a
 *  atividade e mostrá-lo aqui faria o operador achar que a tarefa é de outro. */
function assigneeOf(a: Activity): { label: string; team: boolean } | null {
  if (a.assignedUser) return { label: a.assignedUser.name || a.assignedUser.email, team: false }
  if (a.assignedTeam) return { label: a.assignedTeam.name, team: true }
  return null
}

/** Para onde a tarefa vai: destino explícito da atividade ou, na falta, o
 *  contato do lead. Telefone para canais de voz/mensagem, e-mail para e-mail. */
function contactOf(a: Activity): { icon: 'phone' | 'mail'; value: string } | null {
  const phone = a.recipientPhone || a.lead?.whatsapp || null
  const email = a.recipientEmail || a.lead?.email || null
  if (a.type === 'email') return email ? { icon: 'mail', value: email } : null
  if (a.type === 'whatsapp' || a.type === 'sms' || a.type === 'call') {
    return phone ? { icon: 'phone', value: phone } : null
  }
  if (phone) return { icon: 'phone', value: phone }
  return email ? { icon: 'mail', value: email } : null
}

interface LeadGroup {
  leadId: number
  leadLabel: string
  leadCompany: string | null
  activities: Activity[]
  firstAt: number
  overdue: number
}

export function TodayPage() {
  // Duas consultas de propósito: um job marca pending→overdue 30min depois da
  // hora (processScheduledActivities), então filtrar só 'pending' fazia a tarefa
  // atrasada SUMIR justamente da tela que existe para mostrá-la. O status é um
  // valor único na API, daí buscar os dois e juntar.
  const pendingQ = useActivities({ view: 'today', status: 'pending', limit: 100 })
  const overdueQ = useActivities({ view: 'today', status: 'overdue', limit: 100 })
  const isLoading = pendingQ.isLoading || overdueQ.isLoading
  const update = useUpdateActivity()
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const now = Date.now()
  const activities = [...(pendingQ.data?.activities ?? []), ...(overdueQ.data?.activities ?? [])]
  const groups = groupByLead(activities, now)

  // Resumo do dia: o que o operador precisa saber antes de ler qualquer linha.
  const overdueCount = activities.filter((a) => urgencyOf(a, now) === 'overdue').length
  const nextUp = activities
    .filter((a) => timeOf(a) >= now)
    .sort((a, b) => timeOf(a) - timeOf(b))[0]

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
          <Card class="mb-3">
            <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <span class="inline-flex items-baseline gap-1.5">
                <strong class="text-lg font-semibold text-fg leading-none">{activities.length}</strong>
                <span class="text-fg-muted">{activities.length === 1 ? 'tarefa hoje' : 'tarefas hoje'}</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5">
                <strong class="text-lg font-semibold text-fg leading-none">{groups.length}</strong>
                <span class="text-fg-muted">{groups.length === 1 ? 'lead' : 'leads'}</span>
              </span>
              <span class={`inline-flex items-center gap-1.5 ${overdueCount > 0 ? 'text-danger' : 'text-fg-muted'}`}>
                <AlertCircle size={14} />
                <strong class="text-lg font-semibold leading-none">{overdueCount}</strong>
                {overdueCount === 1 ? 'passou da hora' : 'passaram da hora'}
              </span>
              {nextUp && (
                <span class="inline-flex items-center gap-1.5 text-fg-muted">
                  <Clock size={14} />
                  Próxima às <strong class="text-fg">{hourOf(nextUp) ?? '—'}</strong>
                  <span class="text-fg-subtle">· {TYPE_LABEL[nextUp.type] ?? nextUp.type} com {nextUp.lead?.nome || nextUp.lead?.empresa || `Lead #${nextUp.leadId}`}</span>
                </span>
              )}
            </div>
          </Card>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-fg-muted mb-3 px-1">
            <span class="font-semibold uppercase tracking-wide">Legenda:</span>
            <span class="inline-flex items-center gap-1">
              <span class="font-semibold text-danger tabular-nums">09:00</span>
              passou da hora
              <span class="font-semibold text-warning tabular-nums ml-1">14:00</span>
              na próxima hora
            </span>
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
              <div class="px-4 py-3 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link href={`/leads/${g.leadId}`} class="text-sm font-semibold text-fg hover:text-primary">
                  {g.leadLabel}
                </Link>
                {g.leadCompany && (
                  <span class="inline-flex items-center gap-1 text-xs text-fg-muted">
                    <Building2 size={11} /> {g.leadCompany}
                  </span>
                )}
                <span class="text-xs text-fg-muted">· {g.activities.length} {g.activities.length === 1 ? 'tarefa' : 'tarefas'}</span>
                {g.overdue > 0 && (
                  <span class="inline-flex items-center gap-1 px-1.5 h-5 rounded border border-danger/40 bg-danger/10 text-danger text-[0.6875rem] font-medium">
                    <AlertCircle size={10} /> {g.overdue} {g.overdue === 1 ? 'atrasada' : 'atrasadas'}
                  </span>
                )}
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
                  const urgency = urgencyOf(a, now)
                  const hour = hourOf(a)
                  const assignee = assigneeOf(a)
                  const contact = contactOf(a)
                  return (
                    <li key={a.id} class="px-4 py-3 flex items-start gap-3">
                      <div class="w-14 shrink-0 text-right">
                        <div class={`text-sm font-semibold tabular-nums leading-tight ${URGENCY_CLS[urgency]}`}>
                          {hour ?? '--:--'}
                        </div>
                        {urgency === 'overdue' && (
                          <div class="text-[0.625rem] font-medium text-danger uppercase tracking-wide">atrasada</div>
                        )}
                        {urgency === 'now' && (
                          <div class="text-[0.625rem] font-medium text-warning uppercase tracking-wide">agora</div>
                        )}
                      </div>
                      <Icon size={18} class="text-fg-muted mt-0.5 shrink-0" />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="inline-flex items-center px-1.5 h-5 rounded bg-surface-3 text-fg-muted text-[0.6875rem] font-medium">
                            {TYPE_LABEL[a.type] ?? a.type}
                          </span>
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
                        {(assignee || contact || a.templateCode) && (
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[0.6875rem] text-fg-muted">
                            {assignee && (
                              <span class="inline-flex items-center gap-1" title={assignee.team ? 'Setor responsável' : 'Responsável'}>
                                {assignee.team ? <Users size={11} /> : <User size={11} />}
                                {assignee.label}
                              </span>
                            )}
                            {contact && (
                              <span class="inline-flex items-center gap-1 min-w-0" title={contact.icon === 'phone' ? 'Telefone' : 'E-mail'}>
                                {contact.icon === 'phone' ? <Phone size={11} /> : <Mail size={11} />}
                                <span class="truncate">{contact.value}</span>
                              </span>
                            )}
                            {a.templateCode && (
                              <span class="text-fg-subtle" title="Código da atividade padrão">{a.templateCode}</span>
                            )}
                          </div>
                        )}
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
            title: '🕒 Hora na frente de tudo',
            body: <>Cada tarefa abre com o <strong>horário</strong> em que foi agendada, e a lista vem na ordem do relógio — blocos e tarefas. A hora fica <strong>vermelha</strong> quando já passou, <strong>âmbar</strong> quando é na próxima hora. A faixa do topo resume o dia: quantas tarefas, quantos leads, quantas passaram da hora e qual é a próxima.</>,
          },
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

/** Agrupa por lead e ordena tudo por horário: as tarefas dentro do bloco e os
 *  blocos entre si (pelo compromisso mais cedo). Trabalhar de cima para baixo
 *  passa a ser literalmente a ordem do relógio. */
function groupByLead(activities: Activity[], now: number): LeadGroup[] {
  const map = new Map<number, LeadGroup>()
  for (const a of activities) {
    const label = a.lead?.nome || a.lead?.empresa || `Lead #${a.leadId}`
    // Empresa só como linha extra quando não é ela mesma o nome exibido.
    const company = a.lead?.empresa && a.lead.empresa !== label ? a.lead.empresa : null
    const g = map.get(a.leadId)
    if (g) g.activities.push(a)
    else map.set(a.leadId, { leadId: a.leadId, leadLabel: label, leadCompany: company, activities: [a], firstAt: 0, overdue: 0 })
  }
  const groups = Array.from(map.values())
  for (const g of groups) {
    g.activities.sort((a, b) => timeOf(a) - timeOf(b))
    g.firstAt = timeOf(g.activities[0])
    g.overdue = g.activities.filter((a) => urgencyOf(a, now) === 'overdue').length
  }
  return groups.sort((a, b) => a.firstAt - b.firstAt)
}
