import { useEffect } from 'preact/hooks'
import { Mail, Plug, Unplug, Calendar, ListTodo, Send, Folder, Sheet } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { useMyGoogleStatus, useMyGoogleAuthUrl, useDisconnectMyGoogle } from '@/hooks/useGoogle'
import { useQueryClient } from '@tanstack/react-query'

export function GoogleAccountSettings() {
  const qc = useQueryClient()
  const { data, isLoading } = useMyGoogleStatus()
  const auth = useMyGoogleAuthUrl()
  const disconnect = useDisconnectMyGoogle()

  useEffect(() => {
    function handler(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return
      const d = ev.data as { type?: string; email?: string; kind?: string; error?: string }
      if (d.type === 'google-auth-success') {
        toast(`${d.email} conectado à sua conta`, 'success')
        void qc.invalidateQueries({ queryKey: ['my-google'] })
      } else if (d.type === 'google-auth-error') {
        toast(`Erro OAuth: ${d.error ?? 'desconhecido'}`, 'danger')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [qc])

  function handleConnect() {
    auth.mutate(undefined, {
      onSuccess: ({ url }) => {
        const popup = window.open(url, 'google-oauth', 'width=600,height=700')
        if (!popup) toast('Pop-up bloqueado pelo navegador', 'danger')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDisconnect() {
    if (!confirm('Desconectar sua conta Google? Reuniões e tarefas futuras criadas pelo bychat passarão a usar a conexão da empresa como fallback.')) return
    disconnect.mutate(undefined, {
      onSuccess: () => toast('Conta Google desconectada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (isLoading) {
    return (
      <Card>
        <Skeleton class="h-32 w-full" />
      </Card>
    )
  }

  const conn = data?.connection
  const company = data?.companyFallback
  const configured = data?.configured

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-sm font-semibold text-fg">Minha conta Google</div>
            <div class="text-xs text-fg-muted mt-0.5">
              Quando você conecta sua conta, agendamentos, tarefas e e-mails do bychat passam a usar SEU Google — não o da empresa.
            </div>
          </div>
          {conn?.active ? (
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnect.isPending}>
              <Unplug size={14} /> {disconnect.isPending ? 'Desconectando…' : 'Desconectar'}
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={handleConnect} disabled={auth.isPending || !configured}>
              <Plug size={14} /> {auth.isPending ? 'Abrindo…' : 'Conectar minha conta Google'}
            </Button>
          )}
        </div>

        {!configured && (
          <div class="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200 mb-3">
            O administrador ainda não configurou as credenciais Google OAuth. Peça ao admin para preencher em <strong>Google Suite → Configuração</strong>.
          </div>
        )}

        {conn?.active ? (
          <div class="flex items-center gap-3 text-sm">
            <Mail size={14} class="text-fg-muted" />
            <span class="text-fg flex-1 truncate">{conn.email}</span>
            <Badge tone="accent">Conectada</Badge>
          </div>
        ) : (
          <div class="text-sm text-fg-muted">
            Nenhuma conta conectada ainda. Sem conexão pessoal, suas atividades caem na conta da empresa
            {company ? <> (<span class="font-mono">{company.email}</span>)</> : null}.
          </div>
        )}
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-3">O que muda quando você conecta?</div>
        <ul class="space-y-2 text-sm text-fg-muted">
          <li class="flex items-start gap-2">
            <Calendar size={14} class="mt-0.5 text-emerald-500 shrink-0" />
            <span><strong class="text-fg">Reuniões e ligações</strong> — eventos vão direto para a sua agenda Google (calendário <em>primary</em>) com link do Meet automático.</span>
          </li>
          <li class="flex items-start gap-2">
            <ListTodo size={14} class="mt-0.5 text-blue-500 shrink-0" />
            <span><strong class="text-fg">Tarefas e follow-ups</strong> — entram na sua lista padrão do Google Tasks.</span>
          </li>
          <li class="flex items-start gap-2">
            <Send size={14} class="mt-0.5 text-purple-500 shrink-0" />
            <span><strong class="text-fg">E-mails enviados pelo bychat</strong> — saem do seu Gmail, com a sua assinatura, mantendo a thread no seu histórico.</span>
          </li>
        </ul>

        <div class="border-t border-border my-4" />

        <div class="text-sm font-semibold text-fg mb-3">O que continua na conta da empresa?</div>
        <ul class="space-y-2 text-sm text-fg-muted">
          <li class="flex items-start gap-2">
            <Folder size={14} class="mt-0.5 text-amber-500 shrink-0" />
            <span><strong class="text-fg">Drive</strong> — pasta "ByChat CRM" e arquivos por lead permanecem na conta da empresa, garantindo audit trail e acesso compartilhado.</span>
          </li>
          <li class="flex items-start gap-2">
            <Sheet size={14} class="mt-0.5 text-emerald-500 shrink-0" />
            <span><strong class="text-fg">Planilhas de log</strong> — relatórios e logs de leads são gravados em planilhas centrais da empresa.</span>
          </li>
        </ul>

        {company && (
          <div class="mt-4 text-xs text-fg-muted">
            Conta da empresa: <span class="font-mono">{company.email}</span>
          </div>
        )}
      </Card>
    </div>
  )
}
