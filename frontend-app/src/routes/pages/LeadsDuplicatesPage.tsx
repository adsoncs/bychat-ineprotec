// /app/leads/duplicates — tela de revisão de leads duplicados (Fase 24, Categoria A).
// Cada submissão de Form/Meta/EnrollmentPortal/API/Make cria um Lead novo. Quando o
// novo casa com um existente (whatsapp/email), o sistema sinaliza pending_review.
// Aqui o operador decide: Mesclar (absorve) ou Manter separados.

import { useMemo, useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import { Copy, GitMerge, Split, Mail, Phone, ExternalLink, HelpCircle } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  useDuplicatesGroups,
  useMergeLeads,
  useKeepDuplicatesSeparate,
  type DuplicateGroup,
  type DuplicateLeadSummary,
  type DuplicatesGroupsFilters,
} from '@/hooks/useLeads'
import { useFunnels } from '@/hooks/useFunnels'
import { formatDateTime } from '@/lib/format'
import { LeadStatusBadge } from '@/components/LeadStatusBadge'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

export function LeadsDuplicatesPage() {
  const [filters, setFilters] = useState<DuplicatesGroupsFilters>({})
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const { data, isLoading } = useDuplicatesGroups(filters)
  const { data: funnelsData } = useFunnels()
  const funnels = funnelsData?.funnels ?? []
  const groups = data?.groups ?? []

  return (
    <Page
      title="Leads duplicados"
      description="Inscrições recentes que casaram com leads existentes. Decida mesclar ou manter separados."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Badge tone="info">
            <Copy size={12} class="mr-1" />
            {isLoading ? '—' : `${groups.length} grupo${groups.length === 1 ? '' : 's'}`}
          </Badge>
        </div>
      }
    >
      <Card>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1 min-w-44">
            <span class="text-xs font-medium text-fg-muted">Casou por</span>
            <Select
              value={filters.matchedBy ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFilters(f => ({ ...f, matchedBy: v ? (v as 'whatsapp' | 'email') : undefined }))
              }}
            >
              <option value="">Qualquer chave</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </Select>
          </div>
          <div class="flex flex-col gap-1 min-w-48">
            <span class="text-xs font-medium text-fg-muted">Funil</span>
            <Select
              value={filters.funnelId !== undefined ? String(filters.funnelId) : ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFilters(f => ({ ...f, funnelId: v ? parseInt(v, 10) : undefined }))
              }}
            >
              <option value="">Todos os funis</option>
              {funnels.filter(f => f.active).map(f => (
                <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
              ))}
            </Select>
          </div>
          <div class="flex flex-col gap-1 min-w-48">
            <span class="text-xs font-medium text-fg-muted">Canal</span>
            <Select
              value={filters.channel ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setFilters(f => ({ ...f, channel: v || undefined }))
              }}
            >
              <option value="">Todos os canais</option>
              <option value="meta_lead_ads">Meta Lead Ads</option>
              <option value="enrollment_portal">Portal Matrículas</option>
              <option value="landing_page">Landing Page</option>
              <option value="api">API Pública</option>
              <option value="make">Make.com</option>
            </Select>
          </div>
          {(filters.matchedBy || filters.funnelId !== undefined || filters.channel) && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
              Limpar filtros
            </Button>
          )}
        </div>
      </Card>

      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-40 w-full" />)}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <Card>
          <EmptyState
            title="Nenhum duplicado pendente"
            description="Quando uma nova inscrição casar com um lead existente (por WhatsApp ou e-mail), ela vai aparecer aqui pra decisão."
          />
        </Card>
      )}

      {!isLoading && groups.length > 0 && (
        <div class="flex flex-col gap-4">
          {groups.map((g) => (
            <DuplicateGroupCard key={g.masterId} group={g} />
          ))}
        </div>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Leads Duplicados?"
        problem={<>
          O mesmo cliente pode chegar pelo Instagram hoje, pelo formulário do site amanhã, e pelo
          Meta Lead Ads na semana que vem. Sem controle, viram <strong>3 leads diferentes</strong> com
          informações fragmentadas. Esta tela junta os duplicados (por WhatsApp ou e-mail) e deixa
          você decidir o que fazer.
        </>}
        steps={[
          {
            title: '🔍 O sistema detecta sozinho',
            body: <>Sempre que entra uma inscrição nova (formulário, Meta Lead Ads, portal de matrículas, API, Make.com), o sistema compara WhatsApp e e-mail com os leads já existentes. Se bater, vira um <strong>grupo de duplicados</strong>.</>,
          },
          {
            title: '👁️ Você revisa cada grupo',
            body: <>Cada caixa mostra: o lead <strong>mestre</strong> (o original) e as <strong>cópias</strong> que apareceram. Você vê nome, e-mail, WhatsApp, origem, etapa, e por onde cada um entrou.</>,
          },
          {
            title: '🔀 Mesclar — junta tudo em um lead só',
            body: <>Se for a mesma pessoa, clique em <strong>Mesclar</strong>. As inscrições viram histórico do lead mestre, as conversas se unificam, as etiquetas se somam. Os duplicados somem.</>,
          },
          {
            title: '✂️ Manter separados — são pessoas diferentes',
            body: <>Casaram por coincidência (mesma família, número errado, e-mail trocado)? Clique em <strong>Manter separados</strong> — saem da lista e continuam como leads independentes.</>,
          },
          {
            title: '⚙️ Configurar a regra de dedup',
            body: <>Em Configurações › Dedup você decide quando o sistema deve criar grupo: só por WhatsApp, só por e-mail, ambos, e qual canal entra na lista. Padrão recomendado: ambos, todos os canais.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Importante',
          body: <>O sistema <strong>nunca mescla automaticamente</strong> — sempre espera sua decisão, porque mesclar é irreversível. Inscrições novas continuam virando leads próprios e ficam aqui aguardando.</>,
        }}
      />
    </Page>
  )
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const merge = useMergeLeads()
  const keepSeparate = useKeepDuplicatesSeparate()
  const [confirmKeep, setConfirmKeep] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(() => new Set(group.duplicates.map(d => d.id)))
  const [masterId, setMasterId] = useState<number>(group.masterId)

  const allLeads = useMemo(() => [
    { ...group.master, _isMasterDefault: true },
    ...group.duplicates,
  ], [group])

  function togglePick(id: number) {
    setPicked(p => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function handleMerge() {
    const mergeIds = Array.from(picked).filter(id => id !== masterId)
    if (mergeIds.length === 0) {
      toast('Selecione ao menos 1 lead duplicado', 'danger')
      return
    }
    merge.mutate({ masterId, mergeIds }, {
      onSuccess: (r) => toast(`${r.merged} lead(s) absorvido(s) em #${masterId}`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleKeepSeparate() {
    keepSeparate.mutate(group.masterId, {
      onSuccess: (r) => toast(`${r.resolved} duplicado(s) mantidos separados`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
    setConfirmKeep(false)
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 py-3 border-b border-border bg-surface-3 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold text-fg">Grupo de {group.totalLeads} leads</span>
          <span class="text-xs text-fg-muted">
            Master inicial:{' '}
            <Link href={`/app/leads/${group.master.id}`} class="text-info hover:underline">
              #{group.master.id}{group.master.uid ? ` (${group.master.uid})` : ''} — {group.master.nome || group.master.empresa || '(sem nome)'}
            </Link>
          </span>
          {group.latestFlaggedAt && (
            <span class="text-2xs text-fg-muted">
              · sinalizado {formatDateTime(group.latestFlaggedAt)}
            </span>
          )}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary" size="sm"
            onClick={handleMerge}
            disabled={merge.isPending || keepSeparate.isPending || picked.size === 0}
          >
            <GitMerge size={14} />
            {merge.isPending ? 'Mesclando…' : `Mesclar ${picked.size === 0 ? '' : `${picked.size}`} em #${masterId}`}
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => setConfirmKeep(true)}
            disabled={merge.isPending || keepSeparate.isPending}
          >
            <Split size={14} /> Manter separados
          </Button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-fg-muted text-2xs uppercase tracking-wider">
            <tr class="border-b border-border">
              <th class="text-left px-3 py-2 font-medium w-10">Master</th>
              <th class="text-left px-3 py-2 font-medium w-10">Mesclar</th>
              <th class="text-left px-3 py-2 font-medium">Lead</th>
              <th class="text-left px-3 py-2 font-medium">Contato</th>
              <th class="text-left px-3 py-2 font-medium">Origem / Campanha</th>
              <th class="text-left px-3 py-2 font-medium">Etapa</th>
              <th class="text-left px-3 py-2 font-medium">Criado em</th>
              <th class="text-right px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {allLeads.map(lead => (
              <DuplicateLeadRow
                key={lead.id}
                lead={lead}
                isMaster={lead.id === masterId}
                isMergePicked={picked.has(lead.id) && lead.id !== masterId}
                onSetMaster={() => {
                  setMasterId(lead.id)
                  // Se virou master, tira do picked (master não pode ser absorvido)
                  setPicked(p => { const n = new Set(p); n.delete(lead.id); return n })
                }}
                onTogglePick={() => togglePick(lead.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmKeep}
        onOpenChange={(o) => setConfirmKeep(o)}
        title="Manter como leads separados?"
        description={`Os ${group.duplicates.length} lead(s) duplicado(s) deste grupo deixarão de aparecer como pendentes. Eles continuam existindo separadamente — mensagens, atividades, cadência seguem em cada um.`}
        confirmLabel="Manter separados"
        loading={keepSeparate.isPending}
        onConfirm={handleKeepSeparate}
      />
    </Card>
  )
}

function DuplicateLeadRow({
  lead, isMaster, isMergePicked, onSetMaster, onTogglePick,
}: {
  lead: DuplicateLeadSummary & { _isMasterDefault?: boolean }
  isMaster: boolean
  isMergePicked: boolean
  onSetMaster: () => void
  onTogglePick: () => void
}) {
  const matchedByLabel = lead.duplicateMatchedBy
    ? lead.duplicateMatchedBy === 'whatsapp' ? 'WhatsApp' : 'E-mail'
    : null
  return (
    <tr class={cn('hover:bg-surface-3/40', isMaster && 'bg-info/5')}>
      <td class="px-3 py-2">
        <input
          type="radio"
          name={`master-${lead.possibleDuplicateOfId ?? lead.id}`}
          checked={isMaster}
          onChange={onSetMaster}
          aria-label={`Definir #${lead.id} como master`}
        />
      </td>
      <td class="px-3 py-2">
        <input
          type="checkbox"
          checked={isMergePicked}
          disabled={isMaster}
          onChange={onTogglePick}
          aria-label={`Selecionar #${lead.id} para merge`}
        />
      </td>
      <td class="px-3 py-2 max-w-[18rem]">
        <div class="flex items-center gap-2 flex-wrap">
          <Link href={`/app/leads/${lead.id}`} class="text-fg hover:text-info hover:underline font-medium truncate">
            {lead.nome || lead.empresa || `Lead #${lead.id}`}
          </Link>
          {isMaster && <Badge tone="info">Master</Badge>}
          {matchedByLabel && !isMaster && <Badge tone="warning">Casou por {matchedByLabel}</Badge>}
        </div>
        <div class="text-3xs text-fg-muted font-mono truncate">
          #{lead.id}{lead.uid ? ` · ${lead.uid}` : ''}
        </div>
      </td>
      <td class="px-3 py-2 text-xs">
        {lead.whatsapp && (
          <div class="flex items-center gap-1 text-fg-muted truncate">
            <Phone size={11} class="shrink-0" /> {lead.whatsapp}
          </div>
        )}
        {lead.email && (
          <div class="flex items-center gap-1 text-fg-muted truncate">
            <Mail size={11} class="shrink-0" /> {lead.email}
          </div>
        )}
      </td>
      <td class="px-3 py-2 text-xs">
        <div class="text-fg-muted truncate">{lead.source || lead.originType || '—'}</div>
        {lead.campaignName && (
          <div class="text-3xs text-fg-muted truncate" title={lead.campaignName}>
            {lead.campaignName}
          </div>
        )}
        {lead.utmSource && (
          <div class="text-3xs text-fg-muted truncate">
            utm: {lead.utmSource}{lead.utmCampaign ? ` / ${lead.utmCampaign}` : ''}
          </div>
        )}
      </td>
      <td class="px-3 py-2">
        {lead.status && <LeadStatusBadge status={lead.status} label={lead.statusLabel} />}
      </td>
      <td class="px-3 py-2 text-2xs text-fg-muted whitespace-nowrap">
        {formatDateTime(lead.createdAt)}
      </td>
      <td class="px-3 py-2 text-right">
        <Link href={`/app/leads/${lead.id}`} class="inline-flex items-center gap-1 text-xs text-info hover:underline">
          Abrir <ExternalLink size={11} />
        </Link>
      </td>
    </tr>
  )
}
