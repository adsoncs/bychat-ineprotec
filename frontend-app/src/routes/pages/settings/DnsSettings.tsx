import { useState, useMemo } from 'preact/hooks'
import { Globe, Plus, Pencil, Trash2, Copy, Check, Info } from 'lucide-preact'
import {
  useSettings, useCreateDns, useUpdateDns, useDeleteDns,
  type DnsRecord,
} from '@/hooks/useSettings'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface DnsEntry {
  key: string
  label: string
  value: DnsRecord
}

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'] as const

const TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  A:     { bg: 'bg-info',    fg: 'text-white' },
  AAAA:  { bg: 'bg-info',    fg: 'text-white' },
  CNAME: { bg: 'bg-warning', fg: 'text-white' },
  TXT:   { bg: 'bg-success', fg: 'text-white' },
  MX:    { bg: 'bg-danger',  fg: 'text-white' },
  NS:    { bg: 'bg-accent',  fg: 'text-fg-on-brand' },
  SRV:   { bg: 'bg-surface-3', fg: 'text-fg-muted' },
  CAA:   { bg: 'bg-surface-3', fg: 'text-fg-muted' },
}

interface DnsTemplate {
  id: string
  label: string
  type: string
  host: string
  value: string
  description: string
}

const DNS_TEMPLATES: DnsTemplate[] = [
  {
    id: 'spf',
    label: 'SPF',
    type: 'TXT',
    host: '@',
    value: 'v=spf1 include:_spf.google.com include:resend.com ~all',
    description: 'Autoriza servidores de envio (Google + Resend, ajuste conforme provedores).',
  },
  {
    id: 'dkim-resend',
    label: 'DKIM (Resend)',
    type: 'TXT',
    host: 'resend._domainkey',
    value: 'p=COLE_AQUI_A_PUBLIC_KEY_DO_RESEND',
    description: 'Cópia da chave pública DKIM gerada no painel do Resend.',
  },
  {
    id: 'dmarc',
    label: 'DMARC',
    type: 'TXT',
    host: '_dmarc',
    value: 'v=DMARC1; p=quarantine; rua=mailto:postmaster@SEU_DOMINIO; pct=100',
    description: 'Política de autenticação. Comece com p=quarantine, suba para reject quando estiver estável.',
  },
  {
    id: 'mx-resend',
    label: 'MX Resend',
    type: 'MX',
    host: 'send',
    value: 'feedback-smtp.us-east-1.amazonses.com',
    description: 'Recebimento de bounces/complaints no Resend (prioridade 10).',
  },
  {
    id: 'mx-google',
    label: 'MX Google Workspace',
    type: 'MX',
    host: '@',
    value: 'smtp.google.com',
    description: 'Servidor MX do Google Workspace (prioridade 1). Único registro necessário desde 2023.',
  },
]

export function DnsSettings() {
  const { data, isLoading } = useSettings()
  const [editing, setEditing] = useState<DnsEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DnsEntry | null>(null)

  const entries: DnsEntry[] = useMemo(() => {
    if (!data) return []
    const dnsRows = data.settings.filter((s) => s.grp === 'dns')
    return dnsRows.map((row) => ({
      key: row.key,
      label: row.label ?? row.key,
      value: parseDnsValue(row.value),
    }))
  }, [data])

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo registro DNS
        </Button>
      </div>

      <div class="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0 text-info" />
        <div class="flex-1 leading-relaxed">
          Registros DNS para email e domínio. Configure no painel do seu provedor de domínio
          (<strong class="text-fg">Cloudflare</strong>, <strong class="text-fg">Registro.br</strong>,{' '}
          <strong class="text-fg">GoDaddy</strong>, etc). Esta tela serve para documentar e
          copiar os valores — não publica DNS automaticamente.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span class="inline-flex items-center gap-2">
              <Globe size={16} class="text-fg-subtle" /> Registros publicáveis
            </span>
          </CardTitle>
          <span class="text-xs text-fg-subtle">{entries.length} registro(s)</span>
        </CardHeader>

        {isLoading && <Skeleton class="h-32 w-full" />}

        {!isLoading && entries.length === 0 && (
          <EmptyState
            icon={<Globe size={20} />}
            title="Nenhum registro DNS cadastrado ainda"
            description="Use esta tela para guardar os registros DNS necessários para o seu domínio (SPF, DKIM, DMARC, MX, A, etc)."
            action={
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Adicionar primeiro
              </Button>
            }
          />
        )}

        {!isLoading && entries.length > 0 && (
          <div class="grid gap-2.5 grid-cols-1 lg:grid-cols-2">
            {entries.map((e) => (
              <DnsCard
                key={e.key}
                entry={e}
                onEdit={() => setEditing(e)}
                onDelete={() => setDeleting(e)}
              />
            ))}
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <DnsFormModal
          entry={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteDnsDialog entry={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}

function DnsCard({
  entry, onEdit, onDelete,
}: {
  entry: DnsEntry
  onEdit: () => void
  onDelete: () => void
}) {
  const rec = entry.value
  const type = String(rec.type ?? '?')
  const host = readHost(rec)
  const value = readValue(rec)
  const desc = typeof rec.desc === 'string' ? rec.desc : ''
  const priority = toStr(rec.priority)
  const tone = TYPE_TONE[type] ?? TYPE_TONE.SRV

  return (
    <div class="rounded-md border border-border bg-surface overflow-hidden">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span class={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[0.625rem] font-bold tracking-wide ${tone?.bg} ${tone?.fg}`}>
          {type}
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-fg truncate">{entry.label}</div>
          {desc && <div class="text-[0.6875rem] text-fg-subtle truncate">{desc}</div>}
        </div>
        <div class="flex gap-1.5 shrink-0 flex-wrap">
          <Button variant="secondary" size="sm" onClick={onEdit} aria-label="Editar registro DNS" title="Editar">
            <Pencil size={12} /> Editar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDelete}
            aria-label="Excluir registro DNS"
            title="Excluir"
            class="!text-danger border-danger/30 hover:bg-danger/10"
          >
            <Trash2 size={12} /> Excluir
          </Button>
        </div>
      </div>

      <div class="px-3 py-2.5 space-y-2">
        <CopyField label="Host / Nome" value={host} />
        <CopyField
          label={priority !== '' ? `Valor (prioridade: ${priority})` : 'Valor'}
          value={value}
          mono
        />
      </div>
    </div>
  )
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    if (!value) return
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const display = value !== '' ? value : '—'
  return (
    <div>
      <div class="text-[0.625rem] uppercase tracking-wide text-fg-subtle font-semibold mb-0.5">{label}</div>
      <div class="flex items-stretch gap-1.5">
        <code class={`flex-1 min-w-0 rounded border border-border bg-surface-2 px-2 py-1 text-xs text-fg break-all ${mono ? 'font-mono' : ''}`}>
          {display}
        </code>
        <button
          type="button"
          class="size-7 shrink-0 rounded border border-border bg-surface text-fg-muted grid place-items-center hover:bg-surface-2 hover:text-fg"
          onClick={copy}
          disabled={!value}
          aria-label="Copiar"
          title={copied ? 'Copiado!' : 'Copiar'}
        >
          {copied ? <Check size={12} class="text-success" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  )
}

function DnsFormModal({ entry, onClose }: { entry: DnsEntry | null; onClose: () => void }) {
  const isEdit = !!entry
  const initial = entry?.value
  const [key, setKey] = useState(entry?.key ?? '')
  const [label, setLabel] = useState(entry?.label ?? '')
  const [type, setType] = useState<string>(String(initial?.type ?? 'TXT'))
  const [host, setHost] = useState(readHost(initial ?? {}))
  const [value, setValue] = useState(readValue(initial ?? {}))
  const [desc, setDesc] = useState(typeof initial?.desc === 'string' ? initial.desc : '')
  const [priority, setPriority] = useState(toStr(initial?.priority))
  const [ttl, setTtl] = useState(toStr(initial?.ttl) || '3600')

  const create = useCreateDns()
  const update = useUpdateDns()
  const loading = create.isPending || update.isPending
  const showPriority = type === 'MX' || type === 'SRV'

  function applyTemplate(tpl: DnsTemplate) {
    setType(tpl.type)
    setHost(tpl.host)
    setValue(tpl.value)
    if (!desc.trim()) setDesc(tpl.description)
    if (!label.trim()) setLabel(`${tpl.label} (${tpl.type})`)
    if (tpl.id === 'mx-resend' && !priority) setPriority('10')
    if (tpl.id === 'mx-google' && !priority) setPriority('1')
  }

  function handleSubmit() {
    if (!label.trim()) { toast('Rótulo obrigatório', 'danger'); return }
    if (!type) { toast('Tipo obrigatório', 'danger'); return }
    if (!value.trim()) { toast('Valor obrigatório', 'danger'); return }

    const finalKey = (
      isEdit
        ? key
        : key.trim() !== ''
          ? key.trim()
          : `dns.${(host || '@').replace(/[^a-zA-Z0-9_.-]/g, '_')}_${type.toLowerCase()}`
    ).toLowerCase().replace(/[^a-z0-9_.-]/g, '_')

    const rec: Record<string, unknown> = {
      type,
      host: host.trim() !== '' ? host.trim() : '@',
      value: value.trim(),
    }
    const trimmedDesc = desc.trim()
    if (trimmedDesc !== '') rec.desc = trimmedDesc
    if (showPriority && priority.trim() !== '') rec.priority = priority.trim()
    const ttlNum = parseInt(ttl, 10)
    if (!Number.isNaN(ttlNum) && ttlNum > 0) rec.ttl = ttlNum

    const payload = {
      key: finalKey,
      label: label.trim(),
      value: rec as DnsRecord,
    }

    const onErr = (e: unknown) => toast((e as Error).message, 'danger')
    if (isEdit) {
      update.mutate(payload, {
        onSuccess: () => { toast('Registro atualizado', 'success'); onClose() },
        onError: onErr,
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Registro criado', 'success'); onClose() },
        onError: onErr,
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${entry?.label ?? ''}"` : 'Novo registro DNS'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar')}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
          <Input
            label="Chave (slug)"
            value={key}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            placeholder="dns.exemplo_txt"
            hint="Auto-gerada se vazia"
            disabled={isEdit}
          />
          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              Rótulo <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <input
              type="text"
              value={label}
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
              placeholder="Ex: SPF (TXT)"
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
          <Select
            label="Tipo"
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value)}
          >
            {DNS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Input
            label="Host / Nome"
            value={host}
            onInput={(e) => setHost((e.target as HTMLInputElement).value)}
            placeholder="@ ou subdomínio"
            hint="Use @ para o apex (raiz do domínio)."
          />
        </div>

        <div class="rounded-md border border-border bg-surface-2 p-2.5">
          <div class="text-[0.6875rem] font-medium text-fg-muted mb-1.5">Modelos rápidos</div>
          <div class="flex flex-wrap gap-1.5">
            {DNS_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                class="px-2 py-1 rounded-md border border-border bg-surface text-[0.6875rem] hover:bg-surface-3 hover:border-accent text-fg-muted hover:text-fg"
                title={tpl.description}
                onClick={() => applyTemplate(tpl)}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">
            Valor <span class="text-danger" aria-label="obrigatório">*</span>
          </div>
          <Textarea
            value={value}
            onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
            rows={2}
            placeholder={
              type === 'A' ? '192.0.2.1'
                : type === 'AAAA' ? '2001:db8::1'
                : type === 'CNAME' ? 'destino.exemplo.com.'
                : type === 'TXT' ? 'v=spf1 include:_spf.google.com ~all'
                : type === 'MX' ? 'mail.exemplo.com.'
                : type === 'CAA' ? '0 issue "letsencrypt.org"'
                : 'valor do registro'
            }
            class="font-mono"
          />
        </div>

        {showPriority && (
          <Input
            label={`Prioridade (apenas ${type})`}
            type="number"
            value={priority}
            onInput={(e) => setPriority((e.target as HTMLInputElement).value)}
            placeholder={type === 'MX' ? '10' : '0'}
          />
        )}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Descrição (opcional)"
            value={desc}
            onInput={(e) => setDesc((e.target as HTMLInputElement).value)}
            placeholder="Para que serve este registro"
          />
          <Input
            label="TTL (segundos)"
            type="number"
            value={ttl}
            onInput={(e) => setTtl((e.target as HTMLInputElement).value)}
            placeholder="3600"
          />
        </div>
      </div>
    </Modal>
  )
}

function DeleteDnsDialog({ entry, onClose }: { entry: DnsEntry; onClose: () => void }) {
  const del = useDeleteDns()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${entry.label}"`}
      description="O registro é removido apenas desta listagem (não afeta o DNS publicado no provedor)."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(entry.key, {
        onSuccess: () => { toast('Registro excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function readHost(rec: DnsRecord): string {
  return toStr(rec.host) || toStr(rec.name)
}

function readValue(rec: DnsRecord): string {
  return toStr(rec.value) || toStr(rec.content)
}

function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function parseDnsValue(raw: unknown): DnsRecord {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'object') return raw as DnsRecord
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as DnsRecord
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}
