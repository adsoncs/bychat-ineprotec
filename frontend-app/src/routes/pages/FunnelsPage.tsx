import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { GitFork, Plus, Pencil, Trash2, ListTree, Users, MessageSquare, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useFunnels,
  useDeleteFunnel,
  type FunnelListItem,
} from '@/hooks/useFunnels'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FunnelFormModal } from '@/components/FunnelFormModal'
import { toast } from '@/lib/toast'

export function FunnelsPage() {
  const { data, isLoading } = useFunnels()
  const [, navigate] = useLocation()
  const [editing, setEditing] = useState<FunnelListItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<FunnelListItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Funis"
      description="Funis de vendas. Clique em um funil para gerenciar suas etapas."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo funil
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}
      {!isLoading && data?.funnels.length === 0 && (
        <EmptyState
          icon={<GitFork size={24} />}
          title="Nenhum funil criado"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeiro funil</Button>}
        />
      )}
      {!isLoading && data && data.funnels.length > 0 && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.funnels.map((f) => (
            <FunnelCard
              key={f.id}
              funnel={f}
              onManage={() => navigate(`/funnels/${f.id}`)}
              onEdit={() => setEditing(f)}
              onDelete={() => setDeleting(f)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <FunnelFormModal
          funnel={editing}
          funnels={data?.funnels ?? []}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {deleting && <DeleteFunnelDialog funnel={deleting} onClose={() => setDeleting(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Funis?"
        problem={<>
          Cada negócio tem seu jeito de vender: lead chega, é contatado, qualificado, recebe proposta,
          fecha (ou não). Um <strong>funil</strong> é a representação desse processo em etapas. Ele é a
          espinha dorsal do CRM — todo lead vive dentro de um funil, em uma das etapas.
        </>}
        steps={[
          {
            title: '🏗️ Crie um funil pra cada processo',
            body: <>Vendas, pós-venda, recuperação, matrículas — cada um pode ter seu funil. O <strong>funil padrão</strong> é onde caem os leads novos automaticamente.</>,
          },
          {
            title: '📋 Defina as etapas',
            body: <>Clique no funil pra entrar e adicionar etapas (Novo, Contato, Qualificado, Proposta, Fechado…). Cada etapa tem nome, cor e uma <strong>chave</strong> (ex.: NOVO) usada por APIs e automações.</>,
          },
          {
            title: '🎯 Marque etapas terminais',
            body: <>Etapas como "Fechado" ou "Perdido" são <strong>terminais</strong> — o lead saiu do processo. Isso conta certo nos relatórios de conversão e desativa cadências em cima do lead.</>,
          },
          {
            title: '🔗 Use o funil em todo o sistema',
            body: <>Funil aparece no Kanban (uma coluna por etapa), nos filtros de Leads, nos gatilhos de Fluxos ("lead mudou pra etapa X"), nos chatbots (envia lead pra etapa Y ao terminar), no Portal de Matrículas, etc.</>,
          },
          {
            title: '🗑️ Excluir com cuidado',
            body: <>Não dá pra excluir funil com leads dentro — primeiro mova os leads pra outro funil. Só se exclui funis vazios ou inativos.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica de organização',
          body: <>Começa simples: 1 funil com 4-5 etapas. À medida que o time crescer e os processos se diferenciarem, você cria funis adicionais (ex.: um para Vendas B2C e outro para B2B).</>,
        }}
      />
    </Page>
  )
}

function FunnelCard({
  funnel, onManage, onEdit, onDelete,
}: {
  funnel: FunnelListItem
  onManage: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card class="group flex flex-col gap-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <span class="size-10 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
            <GitFork size={18} />
          </span>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg truncate">{funnel.name}</div>
            <div class="text-xs text-fg-subtle truncate">{funnel.description ?? 'Sem descrição'}</div>
          </div>
        </div>
        {funnel.isDefault && (
          <span class="text-[0.625rem] font-bold tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent shrink-0">
            PADRÃO
          </span>
        )}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Pill icon={<ListTree size={12} />}>{funnel._count.stages} etapas</Pill>
        <Pill icon={<Users size={12} />}>{funnel._count.leads} leads</Pill>
        {funnel._count.chatbots > 0 && (
          <Pill icon={<MessageSquare size={12} />}>
            {funnel._count.chatbots} chatbot{funnel._count.chatbots > 1 ? 's' : ''}
          </Pill>
        )}
        {!funnel.active && <Pill tone="muted">Inativo</Pill>}
      </div>
      <div class="flex gap-2 mt-auto">
        <Button variant="primary" size="sm" class="flex-1" onClick={onManage}>
          <ListTree size={12} /> Gerenciar etapas
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit} aria-label="Editar funil" title="Editar funil">
          <Pencil size={12} />
        </Button>
        {!funnel.isDefault && (
          <Button variant="secondary" size="sm" onClick={onDelete} aria-label="Excluir funil" title="Excluir funil">
            <Trash2 size={12} />
          </Button>
        )}
      </div>
    </Card>
  )
}

function Pill({ icon, children, tone = 'default' }: { icon?: preact.ComponentChildren; children: preact.ComponentChildren; tone?: 'default' | 'muted' }) {
  const cls = tone === 'muted'
    ? 'bg-surface-3 text-fg-subtle'
    : 'bg-surface-3 text-fg-muted'
  return (
    <span class={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[0.6875rem] font-medium ${cls}`}>
      {icon}
      {children}
    </span>
  )
}

function DeleteFunnelDialog({ funnel, onClose }: { funnel: FunnelListItem; onClose: () => void }) {
  const del = useDeleteFunnel()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${funnel.name}"`}
      description={
        funnel._count.leads > 0
          ? `Não é possível excluir: ${funnel._count.leads} lead(s) estão neste funil. Mova-os antes.`
          : 'O funil vai para a lixeira e pode ser restaurado.'
      }
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(funnel.id, {
        onSuccess: () => { toast('Funil movido para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
