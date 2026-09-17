import { useState } from 'preact/hooks'
import { ShieldCheck, ChevronLeft, ChevronRight } from '@/components/ui/icon-set'
import { useAuditLog, type AuditLogEntry } from '@/hooks/useAuditLog'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'

const PAGE_SIZE = 50

// Rótulo legível por tipo de alvo — cresce conforme o produto passa a
// auditar mais coisas (hoje: usuário, chatbot; amanhã: setting, cloud_api...).
const TARGET_TYPE_LABELS: Record<string, string> = {
  user: 'Usuário',
  chatbot: 'Chatbot',
  setting: 'Configuração',
  cloud_api: 'WhatsApp Oficial',
  api_key: 'Chave de API',
  module_permission: 'Permissão de módulo',
  module: 'Módulo',
  lead: 'Lead',
  form: 'Formulário',
  portal: 'Portal',
  enrollment_registration: 'Inscrição',
  routing_rule: 'Regra de roteamento',
  auth: 'Login',
  payment_provider: 'Pagamento',
}

function formatChanges(changes: Record<string, unknown> | null): string {
  if (!changes || Object.keys(changes).length === 0) return '—'
  return Object.entries(changes)
    .map(([campo, v]) => {
      const val = v as { from?: unknown; to?: unknown } | undefined
      if (val && typeof val === 'object' && ('from' in val || 'to' in val)) {
        const from = val.from === null || val.from === undefined || val.from === '' ? '(vazio)' : String(val.from)
        const to = val.to === null || val.to === undefined || val.to === '' ? '(vazio)' : String(val.to)
        return `${campo}: ${from} → ${to}`
      }
      return `${campo}: ${JSON.stringify(v)}`
    })
    .join(' · ')
}

export function AuditLogPage() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPERADMIN'

  if (!isSuperAdmin) {
    return (
      <Page title="Auditoria">
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="Acesso restrito"
          description="Apenas Super Administradores podem ver o log de auditoria."
        />
      </Page>
    )
  }

  return <AuditLogPageContent />
}

function AuditLogPageContent() {
  const [targetType, setTargetType] = useState('')
  const [offset, setOffset] = useState(0)
  const q = useAuditLog({ ...(targetType ? { targetType } : {}), limit: PAGE_SIZE, offset })

  const data = q.data?.data ?? []
  const total = q.data?.total ?? 0
  const targetTypes = q.data?.targetTypes ?? []

  return (
    <Page
      title="Auditoria"
      description="Quem mudou o quê no sistema — configurações sensíveis, chatbots, usuários e mais."
    >
      <Card class="p-4">
        <div class="mb-3 flex items-center gap-2">
          <label class="text-xs font-medium text-fg-muted">Tipo</label>
          <Select
            class="h-8 w-56 text-sm"
            value={targetType}
            onChange={(e) => { setTargetType((e.target as HTMLSelectElement).value); setOffset(0) }}
          >
            <option value="">Todos os tipos</option>
            {targetTypes.map((t) => (
              <option key={t} value={t}>{TARGET_TYPE_LABELS[t] ?? t}</option>
            ))}
          </Select>
        </div>

        {q.isLoading ? (
          <div class="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={24} />}
            title="Nada por aqui"
            description="Nenhuma ação de auditoria registrada com esse filtro."
          />
        ) : (
          <>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border text-left text-2xs uppercase tracking-wider text-fg-muted">
                    <th class="py-2 pr-3">Quando</th>
                    <th class="py-2 pr-3">Quem</th>
                    <th class="py-2 pr-3">Ação</th>
                    <th class="py-2 pr-3">Alvo</th>
                    <th class="py-2 pr-3">O que mudou</th>
                    <th class="py-2 pr-3">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((entry: AuditLogEntry) => (
                    <tr key={entry.id} class="border-b border-border/50 align-top">
                      <td class="py-2 pr-3 whitespace-nowrap text-fg-muted">
                        {new Date(entry.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td class="py-2 pr-3 whitespace-nowrap">{entry.actorName ?? '—'}</td>
                      <td class="py-2 pr-3 whitespace-nowrap font-mono text-xs">{entry.action}</td>
                      <td class="py-2 pr-3 whitespace-nowrap">
                        {entry.targetType ? (TARGET_TYPE_LABELS[entry.targetType] ?? entry.targetType) : '—'}
                        {entry.targetLabel ? <span class="text-fg-muted"> · {entry.targetLabel}</span> : null}
                      </td>
                      <td class="py-2 pr-3 max-w-md text-fg-muted">{formatChanges(entry.changes)}</td>
                      <td class="py-2 pr-3 whitespace-nowrap text-fg-muted">{entry.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div class="mt-3 flex items-center justify-between text-xs text-fg-muted">
              <span>{total} registro{total === 1 ? '' : 's'}</span>
              <div class="flex items-center gap-2">
                <Button
                  variant="ghost" size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft size={14} /> Anterior
                </Button>
                <Button
                  variant="ghost" size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Próxima <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </Page>
  )
}
