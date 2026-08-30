import { useMemo, useState } from 'preact/hooks'
import {
  Link2, Plus, Copy, Check, Archive, ArchiveRestore, Pencil, Trash2,
  Settings as SettingsIcon, Tag, HelpCircle,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useUtms,
  useUtmSuggestions,
  useCreateUtm,
  useUpdateUtm,
  useArchiveUtm,
  useDeleteUtm,
  type UtmLink,
  type UtmInput,
} from '@/hooks/useUtms'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SearchInput } from '@/components/ui/SearchInput'
import { toast } from '@/lib/toast'

// Convenções salvas em localStorage (front-only — preferência do operador).
interface UtmConventions {
  lowercase: boolean
  spaceReplacement: '-' | '_' | 'none'
}
const CONV_KEY = 'utm-builder-conventions'
function loadConventions(): UtmConventions {
  try {
    const raw = localStorage.getItem(CONV_KEY)
    if (raw) return { ...{ lowercase: true, spaceReplacement: '-' as const }, ...JSON.parse(raw) }
  } catch { /* fallback */ }
  return { lowercase: true, spaceReplacement: '-' }
}
function saveConventions(c: UtmConventions) {
  try { localStorage.setItem(CONV_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

function normalize(value: string, conv: UtmConventions): string {
  let v = value
  if (conv.spaceReplacement !== 'none') {
    v = v.replace(/\s+/g, conv.spaceReplacement)
  }
  if (conv.lowercase) v = v.toLowerCase()
  return v
}

// Sugestões fixas de medium (UTM padrão do Google Analytics)
const STANDARD_MEDIUMS = ['cpc', 'cpm', 'social', 'email', 'organic', 'referral', 'display', 'video', 'affiliate', 'qr']
const STANDARD_SOURCES = ['google', 'facebook', 'instagram', 'whatsapp', 'linkedin', 'youtube', 'tiktok', 'newsletter', 'sms']

interface BuilderState {
  name: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  utmId: string
  notes: string
}

function emptyBuilder(): BuilderState {
  return { name: '', baseUrl: 'https://', utmSource: '', utmMedium: '', utmCampaign: '', utmTerm: '', utmContent: '', utmId: '', notes: '' }
}

function buildFullUrl(b: BuilderState, conv: UtmConventions): string {
  if (!b.baseUrl) return ''
  let url: URL
  try { url = new URL(b.baseUrl) } catch { return '' }
  const setOrDelete = (k: string, v: string) => {
    const normalized = v ? normalize(v, conv) : ''
    if (normalized) url.searchParams.set(k, normalized)
    else url.searchParams.delete(k)
  }
  setOrDelete('utm_source', b.utmSource)
  setOrDelete('utm_medium', b.utmMedium)
  setOrDelete('utm_campaign', b.utmCampaign)
  setOrDelete('utm_term', b.utmTerm)
  setOrDelete('utm_content', b.utmContent)
  setOrDelete('utm_id', b.utmId)
  return url.toString()
}

export function UtmsPage() {
  const [conv, setConv] = useState<UtmConventions>(loadConventions)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<UtmLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<UtmLink | null>(null)
  const [showConventions, setShowConventions] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const utmsQ = useUtms({ search, archived: showArchived })
  const suggestionsQ = useUtmSuggestions()
  const archive = useArchiveUtm()
  const del = useDeleteUtm()

  function persistConv(next: UtmConventions) {
    setConv(next)
    saveConventions(next)
  }

  return (
    <Page
      title="UTMs"
      description="Construa, organize e copie URLs taggeadas pra atribuir leads às suas campanhas. Padronize o tagueamento entre as equipes."
      actions={
        <div class="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowConventions(true)}>
            <SettingsIcon size={12} /> Convenções
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova UTM
          </Button>
        </div>
      }
    >
      <Card class="p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex-1 min-w-[16rem]">
            <SearchInput
              value={search}
              onChange={(v: string) => setSearch(v)}
              placeholder="Buscar por nome, campanha, source, medium ou URL…"
            />
          </div>
          <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)}
            />
            Mostrar arquivadas
          </label>
        </div>
      </Card>

      <div class="mt-3 space-y-2">
        {utmsQ.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}
        {!utmsQ.isLoading && (!utmsQ.data || utmsQ.data.data.length === 0) && (
          <EmptyState
            icon={<Link2 size={20} />}
            title={search ? 'Nenhuma UTM encontrada' : (showArchived ? 'Sem UTMs arquivadas' : 'Comece criando sua primeira UTM')}
            description={search ? 'Ajuste o termo de busca.' : 'Construa URLs taggeadas para suas campanhas de Meta Ads, Google Ads, WhatsApp, email — e copie/compartilhe direto daqui.'}
            action={!search && !showArchived ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> Nova UTM
              </Button>
            ) : undefined}
          />
        )}
        {!utmsQ.isLoading && utmsQ.data && utmsQ.data.data.map(u => (
          <UtmRow
            key={u.id}
            utm={u}
            onEdit={() => setEditing(u)}
            onDelete={() => setDeleting(u)}
            onArchive={() => archive.mutate(
              { id: u.id, archived: !u.archived },
              {
                onSuccess: () => toast(u.archived ? 'UTM restaurada' : 'UTM arquivada', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              },
            )}
          />
        ))}
      </div>

      {(creating || editing) && (
        <UtmFormModal
          utm={editing}
          conv={conv}
          suggestions={{
            sources: [...new Set([...(suggestionsQ.data?.sources ?? []), ...STANDARD_SOURCES])],
            mediums: [...new Set([...(suggestionsQ.data?.mediums ?? []), ...STANDARD_MEDIUMS])],
            campaigns: suggestionsQ.data?.campaigns ?? [],
          }}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.name}"`}
          description="Esta ação não pode ser desfeita. Se quiser preservar o histórico, prefira arquivar."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('UTM excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {showConventions && (
        <ConventionsModal
          conv={conv}
          onSave={(next) => { persistConv(next); setShowConventions(false); toast('Convenções salvas', 'success') }}
          onClose={() => setShowConventions(false)}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as UTMs?"
        problem={<>
          UTM é a maneira padrão de marcar de onde veio um clique: <code>?utm_source=instagram&utm_campaign=black-friday</code>.
          Sem isso, todo tráfego pago vira "direto" no Google Analytics e você perde a origem. O problema:
          cada vendedor escreve UTM do seu jeito ("Instagram" vs "instagram" vs "IG") e os relatórios
          ficam fragmentados. Aqui você <strong>monta, padroniza e organiza</strong>.
        </>}
        steps={[
          {
            title: '✍️ Construa a URL com UTM',
            body: <>Botão <strong>Nova UTM</strong>: URL base + source (instagram, google), medium (cpc, organic), campaign (black-friday-2026), content (anuncio-a) e term opcional. O sistema gera a URL pronta pra copiar.</>,
          },
          {
            title: '📐 Defina convenções',
            body: <>Em <strong>Convenções</strong> você diz: "tudo minúsculo", "trocar espaço por hífen", "usar apenas estes sources predefinidos". A partir daí, todo mundo da equipe segue o mesmo padrão automaticamente.</>,
          },
          {
            title: '💡 Sugestões com base nas suas UTMs',
            body: <>Conforme você cria UTMs, o sistema sugere reuso (mesmo campaign de antes, source que você sempre usa). Evita digitar errado e fragmentar relatório.</>,
          },
          {
            title: '📋 Biblioteca pra reusar',
            body: <>Todas as UTMs ficam guardadas. Pesquise, copie de novo, arquive as antigas. Útil pra equipe de mídia: ninguém precisa lembrar nem digitar do zero.</>,
          },
          {
            title: '📊 Análise nos Relatórios',
            body: <>Quando o lead clicar e virar lead/venda, a UTM gruda no histórico do lead. Em Rastreamento › Origens e nos Relatórios de Ads, você vê <em>"campanha X gerou 50 leads e R$ 30k"</em> automaticamente.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica',
          body: <>Combine UTMs com <strong>Links Rastreáveis</strong>. Links rastreáveis dão URLs curtas (bychat.ia.br/l/x) + UTM padrão por baixo + integração com Pixel. Pra anúncios pagos, prefira Links Rastreáveis; pra posts orgânicos longos, UTM direto.</>,
        }}
      />
    </Page>
  )
}

function UtmRow({ utm, onEdit, onDelete, onArchive }: {
  utm: UtmLink
  onEdit: () => void
  onDelete: () => void
  onArchive: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(utm.fullUrl).then(() => {
      setCopied(true)
      toast('URL copiada', 'success')
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => toast('Não foi possível copiar', 'danger'))
  }

  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="text-sm font-semibold text-fg truncate">{utm.name}</span>
            <Badge tone="accent">{utm.utmCampaign}</Badge>
            <Badge tone="neutral">{utm.utmSource} / {utm.utmMedium}</Badge>
            {utm.archived && <Badge tone="warning">arquivada</Badge>}
            {!utm.active && <Badge tone="danger">inativa</Badge>}
          </div>
          <code class="block text-2xs font-mono text-fg-muted break-all bg-surface-2 rounded px-2 py-1 mt-1">
            {utm.fullUrl}
          </code>
          {utm.notes && <div class="text-xs text-fg-muted mt-1">{utm.notes}</div>}
          {Array.isArray(utm.tags) && utm.tags.length > 0 && (
            <div class="flex items-center gap-1 mt-1 flex-wrap">
              <Tag size={10} class="text-fg-muted" />
              {utm.tags.map(t => <Badge key={t} tone="neutral">{t}</Badge>)}
            </div>
          )}
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <Button variant="primary" size="sm" onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <div class="flex gap-1">
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onEdit}
              title="Editar"
              aria-label="Editar"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onArchive}
              title={utm.archived ? 'Restaurar' : 'Arquivar'}
              aria-label={utm.archived ? 'Restaurar' : 'Arquivar'}
            >
              {utm.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
            <button
              type="button"
              class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
              onClick={onDelete}
              title="Excluir"
              aria-label="Excluir"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function UtmFormModal({ utm, conv, suggestions, onClose }: {
  utm: UtmLink | null
  conv: UtmConventions
  suggestions: { sources: string[]; mediums: string[]; campaigns: string[] }
  onClose: () => void
}) {
  const isEdit = !!utm
  const [b, setB] = useState<BuilderState>(() => utm ? {
    name: utm.name,
    baseUrl: utm.baseUrl,
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmTerm: utm.utmTerm ?? '',
    utmContent: utm.utmContent ?? '',
    utmId: utm.utmId ?? '',
    notes: utm.notes ?? '',
  } : emptyBuilder())
  const [tagsInput, setTagsInput] = useState((utm?.tags ?? []).join(', '))
  const [copied, setCopied] = useState(false)

  const create = useCreateUtm()
  const update = useUpdateUtm()
  const isPending = create.isPending || update.isPending

  const fullUrl = useMemo(() => buildFullUrl(b, conv), [b, conv])

  function update_<K extends keyof BuilderState>(key: K, value: BuilderState[K]) {
    setB(prev => ({ ...prev, [key]: value }))
  }

  function copyUrl() {
    if (!fullUrl) { toast('URL inválida — preencha base + UTMs obrigatórios', 'danger'); return }
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true)
      toast('URL copiada', 'success')
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => toast('Falha ao copiar', 'danger'))
  }

  function handleSave() {
    if (!b.name.trim()) { toast('Dê um nome interno à UTM', 'danger'); return }
    if (!b.baseUrl.trim() || b.baseUrl === 'https://') { toast('Informe a URL base', 'danger'); return }
    try { new URL(b.baseUrl) } catch { toast('URL base inválida', 'danger'); return }
    if (!b.utmSource.trim()) { toast('utm_source é obrigatório', 'danger'); return }
    if (!b.utmMedium.trim()) { toast('utm_medium é obrigatório', 'danger'); return }
    if (!b.utmCampaign.trim()) { toast('utm_campaign é obrigatório', 'danger'); return }

    const tags = tagsInput.split(',').map(s => s.trim()).filter(Boolean)
    const input: UtmInput = {
      name: b.name.trim(),
      baseUrl: b.baseUrl.trim(),
      utmSource: normalize(b.utmSource, conv),
      utmMedium: normalize(b.utmMedium, conv),
      utmCampaign: normalize(b.utmCampaign, conv),
      utmTerm: b.utmTerm ? normalize(b.utmTerm, conv) : null,
      utmContent: b.utmContent ? normalize(b.utmContent, conv) : null,
      utmId: b.utmId.trim() || null,
      notes: b.notes.trim() || null,
      tags: tags.length > 0 ? tags : null,
      active: true,
    }
    if (isEdit && utm) {
      update.mutate({ id: utm.id, ...input }, {
        onSuccess: () => { toast('UTM atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(input, {
        onSuccess: () => { toast('UTM criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar UTM' : 'Nova UTM'}
      description="Os 3 primeiros (source, medium, campaign) são obrigatórios. As convenções aplicadas vêm do botão 'Convenções' no topo."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={copyUrl} disabled={!fullUrl}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar URL'}
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome interno *"
          value={b.name}
          onInput={(e) => update_('name', (e.target as HTMLInputElement).value)}
          placeholder="Ex.: Black Friday – post WhatsApp"
        />
        <Input
          label="URL base *"
          value={b.baseUrl}
          onInput={(e) => update_('baseUrl', (e.target as HTMLInputElement).value)}
          placeholder="https://site.com/pagina"
        />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AutocompleteInput
            label="utm_source * (origem)"
            hint="De onde vem o tráfego. Ex.: google, facebook, whatsapp, newsletter."
            value={b.utmSource}
            onInput={(v) => update_('utmSource', v)}
            options={suggestions.sources}
          />
          <AutocompleteInput
            label="utm_medium * (tipo)"
            hint="Tipo de mídia. Padrão: cpc, social, email, organic, referral."
            value={b.utmMedium}
            onInput={(v) => update_('utmMedium', v)}
            options={suggestions.mediums}
          />
        </div>

        <AutocompleteInput
          label="utm_campaign * (nome da campanha)"
          hint="Nome da campanha de marketing. Use uma convenção consistente: ano-mes-canal-objetivo."
          value={b.utmCampaign}
          onInput={(v) => update_('utmCampaign', v)}
          options={suggestions.campaigns}
        />

        <details class="rounded-md border border-border bg-surface-2 p-2">
          <summary class="text-xs font-medium text-fg cursor-pointer">Parâmetros opcionais (term, content, id)</summary>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <Input
              label="utm_term"
              value={b.utmTerm}
              onInput={(e) => update_('utmTerm', (e.target as HTMLInputElement).value)}
              placeholder="palavra-chave (Google Ads)"
              hint="Palavra-chave paga (search). Não usado em mídias display/social."
            />
            <Input
              label="utm_content"
              value={b.utmContent}
              onInput={(e) => update_('utmContent', (e.target as HTMLInputElement).value)}
              placeholder="banner-azul-cta1"
              hint="Variação criativa (A/B test). Diferencia anúncios da mesma campanha."
            />
            <Input
              label="utm_id"
              value={b.utmId}
              onInput={(e) => update_('utmId', (e.target as HTMLInputElement).value)}
              placeholder="ID da campanha no Meta/Google"
              hint="ID interno do anúncio (Meta Ads usa pra cross-device attribution). Não normalizado."
            />
          </div>
        </details>

        <Input
          label="Tags (separadas por vírgula)"
          value={tagsInput}
          onInput={(e) => setTagsInput((e.target as HTMLInputElement).value)}
          placeholder="Q4, lançamento, performance"
        />

        <div>
          <label class="text-xs text-fg-muted block mb-1">Notas</label>
          <textarea
            value={b.notes}
            onInput={(e) => update_('notes', (e.target as HTMLTextAreaElement).value)}
            placeholder="Contexto, briefing, validações…"
            rows={2}
            class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
          />
        </div>

        {/* Preview da URL final */}
        <div class="rounded-md border border-accent/30 bg-accent/10 p-3">
          <div class="text-2xs uppercase tracking-wider text-accent font-semibold mb-1 flex items-center gap-1">
            <Link2 size={11} /> URL final (preview)
          </div>
          {fullUrl ? (
            <code class="text-xs font-mono text-fg break-all">{fullUrl}</code>
          ) : (
            <div class="text-xs text-fg-muted">Preencha URL base e os 3 UTMs obrigatórios pra ver o preview.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function AutocompleteInput({ label, hint, value, onInput, options }: {
  label: string
  hint?: string
  value: string
  onInput: (v: string) => void
  options: string[]
}) {
  const listId = useMemo(() => `dl-${label.replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`, [label])
  return (
    <div>
      <label class="text-xs text-fg-muted block mb-1">{label}</label>
      <input
        type="text"
        list={listId}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
      />
      <datalist id={listId}>
        {options.slice(0, 100).map(o => <option key={o} value={o} />)}
      </datalist>
      {hint && <div class="text-2xs text-fg-muted mt-0.5">{hint}</div>}
    </div>
  )
}

function ConventionsModal({ conv, onSave, onClose }: {
  conv: UtmConventions
  onSave: (c: UtmConventions) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState<UtmConventions>(conv)
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Convenções de tagueamento"
      description="Padronização aplicada automaticamente aos UTMs. Salva no seu navegador (preferência do operador)."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => onSave(local)}>Salvar</Button>
        </>
      }
    >
      <div class="space-y-3">
        <label class="flex items-start gap-2 cursor-pointer rounded-md border border-border bg-surface-2 p-2.5">
          <input
            type="checkbox"
            checked={local.lowercase}
            onChange={(e) => setLocal(c => ({ ...c, lowercase: (e.target as HTMLInputElement).checked }))}
          />
          <div>
            <div class="text-sm font-medium text-fg">Forçar minúsculas</div>
            <div class="text-xs text-fg-muted">UTMs são case-sensitive nos relatórios. "Facebook" ≠ "facebook" no Google Analytics — manter sempre minúsculo evita fragmentação.</div>
          </div>
        </label>

        <Select
          label="Substituir espaços por"
          value={local.spaceReplacement}
          onChange={(e) => setLocal(c => ({ ...c, spaceReplacement: (e.target as HTMLSelectElement).value as any }))}
        >
          <option value="-">Hífen ( - ) — padrão Google</option>
          <option value="_">Underscore ( _ )</option>
          <option value="none">Não substituir (mantém espaço como %20)</option>
        </Select>
      </div>
    </Modal>
  )
}
