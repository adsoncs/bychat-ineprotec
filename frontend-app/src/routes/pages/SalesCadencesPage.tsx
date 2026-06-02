import { useEffect, useState } from 'preact/hooks'
import { HelpCircle, Megaphone, Plus, Sparkles } from 'lucide-preact'
import { useLocation } from 'wouter-preact'
import {
  useSalesCadences,
  useCreateSalesCadence,
  useUpdateSalesCadence,
  useDeleteSalesCadence,
  type SalesCadence,
} from '@/hooks/useSalesCadences'
import { useTeams } from '@/hooks/useTeams'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SalesCadenceStepsEditor } from '@/components/SalesCadenceStepsEditor'
import { AiCadenceWizard } from '@/components/AiCadenceWizard'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:    { label: 'Rascunho', cls: 'bg-surface-3 text-fg-muted border-border' },
  active:   { label: 'Ativa',    cls: 'bg-accent text-fg-on-brand border-accent' },
  paused:   { label: 'Pausada',  cls: 'bg-warning text-white border-warning' },
  archived: { label: 'Arquivada', cls: 'bg-surface-3 text-fg-subtle border-border' },
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'active', label: 'Ativa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'archived', label: 'Arquivada' },
]

export function SalesCadencesPage() {
  const [, navigate] = useLocation()
  const { data, isLoading } = useSalesCadences()
  const teamsQuery = useTeams()
  const create = useCreateSalesCadence()
  const update = useUpdateSalesCadence()
  const remove = useDeleteSalesCadence()

  const [showCreate, setShowCreate] = useState(false)
  const [showAiWizard, setShowAiWizard] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [editing, setEditing] = useState<SalesCadence | null>(null)
  const [editingSteps, setEditingSteps] = useState<SalesCadence | null>(null)
  const [deleting, setDeleting] = useState<SalesCadence | null>(null)

  const items = data?.items ?? []
  const teams = teamsQuery.data?.teams ?? []

  return (
    <Page
      title="Cadências de vendas"
      description="Crie sequências de contato (WhatsApp, e-mail, SMS) que rodam sozinhas. O sistema respeita horários, evita spam, pausa quando o lead responde e te avisa quando precisa de ação humana."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAiWizard(true)}
            class="bg-gradient-to-r from-accent to-info border-0 shadow-md hover:shadow-lg"
            title="Gerar uma cadência completa via IA: você descreve o objetivo, a IA monta a sequência, escreve as mensagens e ajusta o timing."
          >
            <Sparkles size={14} /> Criar com IA
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Nova cadência
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <Card>
          <div class="text-center py-8 max-w-xl mx-auto">
            <Megaphone size={32} class="mx-auto text-fg-subtle mb-3" />
            <p class="text-base font-semibold text-fg mb-2">Nenhuma cadência ainda</p>
            <p class="text-sm text-fg-muted mb-4">
              Uma cadência é uma sequência de contatos que o sistema executa em ordem. Você define os passos uma vez; depois é só inscrever leads.
            </p>
            <div class="text-left bg-surface-3/40 rounded-md p-4 mb-4 text-xs text-fg-muted">
              <p class="font-semibold text-fg mb-1">Exemplo de cadência típica:</p>
              <ul class="space-y-0.5 list-disc list-inside">
                <li>Hoje: enviar WhatsApp de apresentação</li>
                <li>Em 2 dias: e-mail com caso de uso</li>
                <li>Em 5 dias: ligação (vai virar tarefa em "Hoje")</li>
                <li>Em 9 dias: WhatsApp com proposta</li>
                <li>Em 14 dias: WhatsApp final ("vou parar de incomodar")</li>
              </ul>
            </div>
            <div class="flex items-center justify-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAiWizard(true)}
                class="bg-gradient-to-r from-accent to-info border-0 shadow-md"
              >
                <Sparkles size={14} /> Criar com IA
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
                Criar manualmente
              </Button>
            </div>
          </div>
        </Card>
      )}

      <AiCadenceWizard
        open={showAiWizard}
        onClose={() => setShowAiWizard(false)}
      />

      {showHowItWorks && (
        <HowItWorksModal
          onClose={() => setShowHowItWorks(false)}
          onCreateWithAi={() => { setShowHowItWorks(false); setShowAiWizard(true) }}
          onCreateManual={() => { setShowHowItWorks(false); setShowCreate(true) }}
        />
      )}

      {!isLoading && items.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-3 py-2 font-medium">Nome</th>
                  <th class="text-left px-3 py-2 font-medium">Equipe</th>
                  <th class="text-center px-3 py-2 font-medium">Passos</th>
                  <th class="text-center px-3 py-2 font-medium">Inscritos</th>
                  <th class="text-center px-3 py-2 font-medium">Pausar ao responder</th>
                  <th class="text-center px-3 py-2 font-medium">Status</th>
                  <th class="text-left px-3 py-2 font-medium" style={{ width: '10rem' }}>Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {items.map((c) => {
                  const status = STATUS_LABEL[c.status] ?? STATUS_LABEL.draft!
                  return (
                    <tr key={c.id}>
                      <td class="px-3 py-2 font-medium text-fg break-words">{c.name}</td>
                      <td class="px-3 py-2">
                        {c.team
                          ? <span class="inline-flex items-center gap-1.5 text-xs">
                              <span class="w-2 h-2 rounded-full" style={{ background: c.team.color }} />
                              {c.team.name}
                            </span>
                          : <span class="text-fg-subtle text-xs">—</span>}
                      </td>
                      <td class="px-3 py-2 text-center tabular-nums">{c._count.steps}</td>
                      <td class="px-3 py-2 text-center tabular-nums">{c._count.enrollments}</td>
                      <td class="px-3 py-2 text-center">
                        {c.pauseOnReply
                          ? <span class="text-accent font-medium text-xs">Sim</span>
                          : <span class="text-fg-subtle text-xs">Não</span>}
                      </td>
                      <td class="px-3 py-2 text-center">
                        <span class={cn(
                          'inline-flex items-center px-2 h-6 rounded-md border text-[0.6875rem] font-medium',
                          status.cls,
                        )}>
                          {status.label}
                        </span>
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex flex-wrap gap-1">
                          <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Editar</Button>
                          <Button variant="primary" size="sm" onClick={() => navigate(`/sales-cadences/${c.id}/builder`)}>Abrir builder</Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditingSteps(c)}>Lista</Button>
                          <Button variant="secondary" size="sm" onClick={() => navigate(`/sales-cadences/${c.id}/dashboard`)}>Métricas</Button>
                          <Button variant="danger" size="sm" onClick={() => setDeleting(c)}>Excluir</Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CadenceFormModal
        open={showCreate}
        onOpenChange={setShowCreate}
        teams={teams}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: () => {
              toast('Cadência criada', 'success')
              setShowCreate(false)
            },
            onError: (e) => toast((e as Error).message, 'danger'),
          })
        }
        submitting={create.isPending}
        initial={{ name: '', status: 'draft' }}
        submitLabel="Criar cadência"
      />

      <CadenceFormModal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        teams={teams}
        onSubmit={(input) => {
          if (!editing) return
          update.mutate(
            { id: editing.id, ...input },
            {
              onSuccess: () => {
                toast('Cadência atualizada', 'success')
                setEditing(null)
              },
              onError: (e) => toast((e as Error).message, 'danger'),
            },
          )
        }}
        submitting={update.isPending}
        initial={
          editing
            ? {
                name: editing.name,
                description: editing.description,
                teamId: editing.teamId,
                status: editing.status,
                pauseOnReply: editing.pauseOnReply,
                exitOnConversion: editing.exitOnConversion,
              }
            : { name: '', status: 'draft' }
        }
        submitLabel="Salvar"
      />

      <SalesCadenceStepsEditor
        cadenceId={editingSteps?.id ?? null}
        cadenceName={editingSteps?.name}
        onOpenChange={(o) => !o && setEditingSteps(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Excluir "${deleting.name}"?` : ''}
        description="A cadência, todos os passos e inscrições serão removidos. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast('Cadência excluída', 'success')
              setDeleting(null)
            },
            onError: (e) => toast((e as Error).message, 'danger'),
          })
        }}
      />
    </Page>
  )
}

// ─── Form modal (criar/editar) ───────────────────────────

interface CadenceFormState {
  name: string
  description?: string | null
  teamId?: number | null
  status?: string
  pauseOnReply?: boolean
  exitOnConversion?: boolean
}

function CadenceFormModal(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teams: { id: number; name: string }[]
  initial: CadenceFormState
  submitLabel: string
  submitting: boolean
  onSubmit: (input: CadenceFormState) => void
}) {
  const [form, setForm] = useState<CadenceFormState>(props.initial)

  // Reset interno quando o modal reabre com novos initial values
  // (criar/editar usam o mesmo componente; setEditing(...) altera initial).
  useEffect(() => {
    if (props.open) setForm(props.initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (!form.name?.trim()) {
      toast('Nome é obrigatório', 'danger')
      return
    }
    props.onSubmit(form)
  }

  return (
    <Modal open={props.open} onOpenChange={props.onOpenChange} title={props.submitLabel} size="md">
      <form onSubmit={handleSubmit} class="flex flex-col gap-3">
        <div>
          <label class="text-xs font-medium text-fg">Nome *</label>
          <Input
            value={form.name}
            onInput={(e: any) => setForm({ ...form, name: e.currentTarget.value })}
            placeholder="Ex: Prospecção Q2 — quentes"
            autoFocus
          />
          <p class="text-[0.6875rem] text-fg-muted mt-1">Como você vai reconhecer esta cadência na lista.</p>
        </div>
        <div>
          <label class="text-xs font-medium text-fg">Descrição</label>
          <Textarea
            value={form.description ?? ''}
            onInput={(e: any) => setForm({ ...form, description: e.currentTarget.value })}
            rows={2}
            placeholder="Para que serve, qual público, qual objetivo"
          />
          <p class="text-[0.6875rem] text-fg-muted mt-1">Opcional — anotação interna para o time.</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg">Equipe</label>
            <Select
              value={form.teamId == null ? '' : String(form.teamId)}
              onChange={(e: any) =>
                setForm({ ...form, teamId: e.currentTarget.value ? Number(e.currentTarget.value) : null })
              }
            >
              <option value="">— Sem equipe —</option>
              {props.teams.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.name}</option>
              ))}
            </Select>
            <p class="text-[0.6875rem] text-fg-muted mt-1">Define limites de envio e quem vê.</p>
          </div>
          <div>
            <label class="text-xs font-medium text-fg">Status</label>
            <Select
              value={form.status ?? 'draft'}
              onChange={(e: any) => setForm({ ...form, status: e.currentTarget.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <p class="text-[0.6875rem] text-fg-muted mt-1">"Rascunho" não envia. "Ativa" começa a rodar.</p>
          </div>
        </div>
        <div class="flex flex-col gap-2 pt-2 border-t border-border mt-2">
          <p class="text-[0.6875rem] text-fg-muted font-medium uppercase tracking-wide">Comportamento</p>
          <label class="flex items-start gap-2 text-xs text-fg">
            <input
              type="checkbox"
              class="mt-0.5"
              checked={form.pauseOnReply ?? true}
              onChange={(e: any) => setForm({ ...form, pauseOnReply: e.currentTarget.checked })}
            />
            <span>
              <span class="font-medium">Pausar quando o lead responder</span>
              <span class="block text-fg-muted text-[0.6875rem]">Recomendado. Quando o lead manda mensagem, a cadência para e a IA classifica a resposta para te avisar o que fazer.</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-xs text-fg">
            <input
              type="checkbox"
              class="mt-0.5"
              checked={form.exitOnConversion ?? true}
              onChange={(e: any) => setForm({ ...form, exitOnConversion: e.currentTarget.checked })}
            />
            <span>
              <span class="font-medium">Remover quando virar venda</span>
              <span class="block text-fg-muted text-[0.6875rem]">Se o lead fechar negócio, ele sai da cadência automaticamente — evita continuar prospectando quem já comprou.</span>
            </span>
          </label>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => props.onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" variant="primary" size="sm" disabled={props.submitting}>
            {props.submitting ? 'Salvando…' : props.submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function HowItWorksModal({
  onClose,
  onCreateWithAi,
  onCreateManual,
}: {
  onClose: () => void
  onCreateWithAi: () => void
  onCreateManual: () => void
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funcionam as Cadências de vendas?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Lead chega e ninguém faz follow-up. Vendedor esquece de retomar. O cliente esfria e some.
            Uma <strong>cadência</strong> é uma sequência de contatos (WhatsApp, e-mail, SMS, ligação) que o sistema
            executa <strong>sozinho</strong>, na ordem e nos dias certos — sem você precisar lembrar.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="📝 Você cria a sequência uma vez">
            Define os passos da cadência: <em>"Dia 1 WhatsApp de apresentação, dia 3 e-mail com material,
            dia 5 ligação, dia 7 follow-up"</em>. Pode escrever do zero ou clicar em{' '}
            <strong>"Criar com IA"</strong> e a IA monta tudo (textos e timing) a partir do seu objetivo.
          </Step>
          <Step n={2} title="👥 Inscreve os leads na cadência">
            Manualmente (escolhendo um lead e clicando em "Inscrever") ou automaticamente
            (a cadência inscreve sozinha todo lead que cair num filtro, por exemplo "todo lead novo do funil X").
          </Step>
          <Step n={3} title="🤖 O sistema executa nos horários certos">
            A cada minuto o sistema olha quem precisa receber o próximo contato e dispara. Respeita horário
            comercial, limite de envios por dia e janelas de silêncio. <strong>Não manda em fim de semana
            ou madrugada</strong>.
          </Step>
          <Step n={4} title="💬 Lead respondeu? Pausa sozinho">
            Quando o lead responde, a cadência <strong>pausa automaticamente</strong> — pra você não ficar
            robotizando em cima de alguém que já tá conversando com você. A IA classifica a resposta
            (interesse, objeção, "não tenho dinheiro") e te avisa o que fazer.
          </Step>
          <Step n={5} title="💰 Virou venda? Sai da cadência">
            Quando o lead é marcado como Ganho (ou Perdido), ele sai automaticamente da cadência.
            Você vê no painel quantos foram contatados, quantos responderam, quantos viraram venda —
            por canal e por vendedor.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-warning/10 border border-warning/30">
          <div class="font-semibold text-fg mb-1">⚙️ Antes de ativar uma cadência, confira</div>
          <ul class="text-xs text-fg-muted leading-relaxed space-y-1 list-disc list-inside">
            <li><strong>Canais conectados</strong> (WhatsApp, e-mail ou SMS — em Canais e Integrações)</li>
            <li><strong>Modelos de mensagem</strong> criados (em Marketing › Modelos)</li>
            <li><strong>Chaves de IA</strong> se for usar o "Criar com IA" (em Configurações › APIs)</li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onCreateManual}>
            Criar manualmente
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateWithAi}
            class="bg-gradient-to-r from-accent to-info border-0 shadow-md"
          >
            <Sparkles size={14} /> Criar com IA
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
