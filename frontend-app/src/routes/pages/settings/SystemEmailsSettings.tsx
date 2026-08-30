import { useEffect, useState } from 'preact/hooks'
import { Mail, Save, RotateCcw, Send, Eye, AlertTriangle, ChevronRight } from '@/components/ui/icon-set'
import {
  useSystemEmails,
  useUpdateSystemEmail,
  useResetSystemEmail,
  usePreviewSystemEmail,
  useSendTestSystemEmail,
  type SystemEmailTemplate,
} from '@/hooks/useSystemEmails'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const CATEGORY_LABELS: Record<string, string> = {
  lifecycle: 'Ciclo de vida do lead',
  auth: 'Autenticação',
  system: 'Sistema',
  manual: 'Acionado manualmente',
}

export function SystemEmailsSettings() {
  const { user } = useAuth()
  const isSuper = user?.role === 'SUPERADMIN'

  if (!isSuper) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={20} />}
          title="Acesso restrito"
          description="Apenas Super Administradores podem editar templates de email do sistema."
        />
      </Card>
    )
  }
  return <SystemEmailsBody />
}

function SystemEmailsBody() {
  const { data, isLoading } = useSystemEmails()
  const [editing, setEditing] = useState<SystemEmailTemplate | null>(null)

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Mail size={20} />}
          title="Nenhum template carregado"
          description="Reinicie o backend para o seed inicial rodar."
        />
      </Card>
    )
  }

  const grouped = data.reduce<Record<string, SystemEmailTemplate[]>>((acc, t) => {
    const k = t.category || 'system'
    if (!acc[k]) acc[k] = []
    acc[k].push(t)
    return acc
  }, {})
  const order = ['lifecycle', 'auth', 'manual', 'system']
  const categories = order.filter((c) => grouped[c]).concat(Object.keys(grouped).filter((c) => !order.includes(c)))

  return (
    <div class="space-y-4">
      <Card class="text-xs text-fg-muted">
        <div class="flex items-start gap-2">
          <Mail size={14} class="mt-0.5 shrink-0 text-accent" />
          <div>
            <div class="text-sm font-semibold text-fg mb-1">Emails disparados pelo sistema</div>
            <p>
              Edite o assunto e o HTML de cada email transacional/sistema. Use placeholders <code>{`{{ lead.nome }}`}</code> pra
              variáveis dinâmicas (lista de variáveis disponíveis aparece em cada template). Se desativar um template, o sistema
              <strong class="text-fg"> não dispara mais aquele email automaticamente</strong> — você pode então criar um Fluxo
              equivalente no menu Fluxos pra ter controle granular (condições, atrasos, A/B).
            </p>
          </div>
        </div>
      </Card>

      {categories.map((cat) => (
        <div key={cat} class="space-y-2">
          <div class="text-2xs uppercase tracking-wider text-fg-muted font-medium">{CATEGORY_LABELS[cat] ?? cat}</div>
          <Card class="p-0 overflow-hidden">
            <ul class="divide-y divide-border">
              {grouped[cat]!.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    class="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-3 transition-colors"
                  >
                    <Mail size={16} class="mt-0.5 shrink-0 text-fg-muted" />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{t.name}</span>
                        <Badge tone={t.enabled ? 'accent' : 'neutral'}>{t.enabled ? 'Ativo' : 'Desativado'}</Badge>
                      </div>
                      {t.description && <div class="text-2xs text-fg-muted mt-0.5">{t.description}</div>}
                      <div class="text-3xs text-fg-muted mt-1 font-mono truncate">{t.key}</div>
                    </div>
                    <ChevronRight size={14} class="mt-1 text-fg-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ))}

      {editing && (
        <TemplateEditorModal template={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function TemplateEditorModal({ template, onClose }: { template: SystemEmailTemplate; onClose: () => void }) {
  const update = useUpdateSystemEmail()
  const reset = useResetSystemEmail()
  const preview = usePreviewSystemEmail()
  const sendTest = useSendTestSystemEmail()

  const [subject, setSubject] = useState(template.subject)
  const [htmlBody, setHtmlBody] = useState(template.htmlBody)
  const [enabled, setEnabled] = useState(template.enabled)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewSubject, setPreviewSubject] = useState<string>('')
  const [testEmail, setTestEmail] = useState('')

  // re-sync se trocar de template aberto
  useEffect(() => {
    setSubject(template.subject)
    setHtmlBody(template.htmlBody)
    setEnabled(template.enabled)
  }, [template.id])

  const dirty = subject !== template.subject || htmlBody !== template.htmlBody || enabled !== template.enabled

  function handleSave() {
    update.mutate(
      { key: template.key, subject, htmlBody, enabled },
      {
        onSuccess: () => toast('Template salvo', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function handleReset() {
    if (!confirm('Restaurar este template para o conteúdo padrão? Suas edições serão perdidas.')) return
    reset.mutate(template.key, {
      onSuccess: (r) => {
        setSubject(r.subject)
        setHtmlBody(r.htmlBody)
        setEnabled(r.enabled)
        toast('Template restaurado', 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  async function handlePreview() {
    if (dirty) {
      // Salva antes pra preview refletir as mudanças
      await update.mutateAsync({ key: template.key, subject, htmlBody, enabled })
    }
    preview.mutate(
      { key: template.key },
      {
        onSuccess: (r) => {
          setPreviewSubject(r.subject)
          setPreviewHtml(r.html)
          setTab('preview')
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function handleSendTest() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      toast('Email inválido', 'danger')
      return
    }
    sendTest.mutate(
      { key: template.key, to: testEmail },
      {
        onSuccess: () => toast(`Email de teste enviado pra ${testEmail}`, 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={template.name}
      description={template.description ?? undefined}
      size="full"
      footer={
        <>
          <div class="flex-1 flex items-center gap-2 text-xs text-fg-muted">
            <code class="font-mono bg-surface-3 px-1.5 py-0.5 rounded text-2xs">{template.key}</code>
            <span>·</span>
            <span>Atualizado em {new Date(template.updatedAt).toLocaleString('pt-BR')}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={handleReset} disabled={reset.isPending}>
            <RotateCcw size={12} /> Restaurar padrão
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePreview} disabled={preview.isPending}>
            <Eye size={12} /> {preview.isPending ? 'Renderizando…' : 'Preview'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
            <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        {/* Tabs Edit / Preview */}
        <div class="flex gap-1 bg-surface-3 rounded-md p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setTab('edit')}
            class={cn(
              'px-3 h-7 rounded text-xs font-medium transition-colors',
              tab === 'edit' ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg',
            )}
          >Editor</button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            disabled={!previewHtml}
            class={cn(
              'px-3 h-7 rounded text-xs font-medium transition-colors',
              tab === 'preview' ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg disabled:opacity-50',
            )}
          >Preview {!previewHtml && '(use o botão Preview)'}</button>
        </div>

        {tab === 'edit' && (
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 space-y-3">
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
                />
                <span class="font-medium text-fg">Disparo automático ativo</span>
                <span class="text-xs text-fg-muted">— se desligado, o sistema não dispara este email (use Fluxos pra controle alternativo).</span>
              </label>

              <Input
                label="Assunto"
                value={subject}
                onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
                placeholder="Assunto do email com {{ placeholders }}"
              />

              <Textarea
                label="HTML do email"
                value={htmlBody}
                onInput={(e) => setHtmlBody((e.target as HTMLTextAreaElement).value)}
                rows={20}
                class="!font-mono !text-xs"
              />

              <div class="rounded-md border border-border bg-surface-2 p-3 space-y-2">
                <div class="text-xs font-medium text-fg flex items-center gap-1.5">
                  <Send size={12} class="text-accent" /> Enviar email de teste
                </div>
                <div class="flex gap-2">
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={testEmail}
                    onInput={(e) => setTestEmail((e.target as HTMLInputElement).value)}
                    class="flex-1"
                  />
                  <Button variant="secondary" size="sm" onClick={handleSendTest} disabled={sendTest.isPending || !testEmail.trim()}>
                    {sendTest.isPending ? 'Enviando…' : 'Enviar'}
                  </Button>
                </div>
                <p class="text-2xs text-fg-muted">Renderiza com dados de exemplo realistas e envia pro seu email pra você ver no cliente real.</p>
              </div>
            </div>

            <aside class="space-y-2">
              <div class="text-xs font-medium text-fg">Variáveis disponíveis</div>
              <div class="rounded-md border border-border bg-surface-2 p-2 max-h-[28rem] overflow-y-auto">
                {(template.variables ?? []).length === 0 && (
                  <div class="text-xs text-fg-muted p-2">Nenhuma variável documentada.</div>
                )}
                <ul class="space-y-1 text-2xs">
                  {(template.variables ?? []).map((v) => (
                    <li key={v.name} class="flex flex-col gap-0.5 p-1.5 rounded hover:bg-surface-3 cursor-pointer" onClick={() => navigator.clipboard.writeText(`{{${v.name}}}`)}>
                      <code class="font-mono text-accent">{`{{${v.name}}}`}</code>
                      <span class="text-fg-muted">{v.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p class="text-2xs text-fg-muted">Clique numa variável pra copiar.</p>
            </aside>
          </div>
        )}

        {tab === 'preview' && previewHtml && (
          <div class="space-y-3">
            <div class="rounded-md border border-border bg-surface-2 p-3">
              <div class="text-2xs uppercase tracking-wider text-fg-muted">Assunto</div>
              <div class="text-sm font-semibold text-fg mt-0.5">{previewSubject}</div>
            </div>
            <div class="rounded-md border border-border bg-white overflow-hidden">
              <iframe
                title="Preview do email"
                srcDoc={previewHtml}
                class="w-full h-[60vh] block"
                sandbox=""
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
