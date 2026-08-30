import { useMemo, useState } from 'preact/hooks'
import { LayoutTemplate, Search, Send } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { useCloudApiTemplates, parseTemplateComponents, type CloudApiTemplate } from '@/hooks/useCloudApi'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Envia o modelo pela mesma rota do compositor (mediaType 'template'). */
  onSend: (payload: { name: string; language: string; components: unknown[] | undefined; preview: string }) => void
  enviando?: boolean
}

/** Substitui {{1}}, {{2}}… pelos valores digitados, para o preview e para o
 *  corpo que fica registrado no histórico da conversa. */
function interpolar(texto: string, vars: string[]): string {
  return texto.replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[Number(n) - 1] || `{{${n}}}`)
}

/**
 * Modelos aprovados pela Meta, para usar DENTRO da conversa.
 *
 * Só estes têm cabeçalho, mídia, rodapé e botões de verdade — a Evolution não
 * envia mensagem interativa (o provider lança erro explícito). Por isso o botão
 * que abre este seletor só aparece quando a conversa sai por um número Cloud API.
 */
export function HsmTemplatePicker({ open, onOpenChange, onSend, enviando }: Props) {
  const { data, isLoading } = useCloudApiTemplates()
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<CloudApiTemplate | null>(null)
  const [vars, setVars] = useState<string[]>([])

  const aprovados = useMemo(() => {
    const todos = (data?.templates ?? []).filter((t) => String(t.status).toUpperCase() === 'APPROVED')
    const q = busca.trim().toLowerCase()
    return q ? todos.filter((t) => t.name.toLowerCase().includes(q)) : todos
  }, [data, busca])

  const parsed = useMemo(() => (escolhido ? parseTemplateComponents(escolhido.components) : null), [escolhido])

  function escolher(t: CloudApiTemplate) {
    setEscolhido(t)
    const p = parseTemplateComponents(t.components)
    setVars(p.variables.map(() => ''))
  }

  function enviar() {
    if (!escolhido || !parsed) return
    if (parsed.variables.length && vars.some((v) => !v.trim())) {
      toast('Preencha todas as variáveis do modelo', 'warning')
      return
    }
    const components = parsed.variables.length
      ? [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v.trim() })) }]
      : undefined
    onSend({
      name: escolhido.name,
      language: escolhido.language,
      components,
      // O histórico guarda o texto já preenchido — sem isso a conversa mostraria
      // "{{1}}" no lugar do nome do cliente.
      preview: interpolar(parsed.body, vars),
    })
  }

  function fechar(v: boolean) {
    if (!v) { setEscolhido(null); setVars([]); setBusca('') }
    onOpenChange(v)
  }

  return (
    <Modal
      open={open}
      onOpenChange={fechar}
      title="Enviar modelo aprovado"
      description="Modelos com cabeçalho, mídia e botões — aprovados pela Meta e entregues mesmo fora da janela de 24h."
      size="xl"
      footer={
        <div class="flex justify-between gap-2">
          {escolhido ? (
            <Button variant="ghost" size="md" onClick={() => setEscolhido(null)}>Voltar</Button>
          ) : <span />}
          <div class="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => fechar(false)}>Cancelar</Button>
            <Button variant="primary" size="md" onClick={enviar} disabled={!escolhido || enviando}>
              <Send size={14} />
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : !escolhido ? (
        <div class="space-y-3">
          <Input
            placeholder="Buscar modelo…"
            value={busca}
            onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
          />
          {aprovados.length === 0 ? (
            <EmptyState
              icon={<LayoutTemplate size={24} />}
              title="Nenhum modelo aprovado"
              description="Crie e envie para aprovação em WhatsApp › Modelos de Mensagem. A Meta costuma responder em algumas horas."
            />
          ) : (
            <ul class="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {aprovados.map((t) => {
                const p = parseTemplateComponents(t.components)
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      class="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-2"
                      onClick={() => escolher(t)}
                    >
                      <span class="text-sm font-medium">{t.name}</span>
                      <span class="truncate text-xs text-fg-muted">{p.body.slice(0, 90)}</span>
                      <span class="text-2xs text-fg-muted">
                        {p.header?.format && p.header.format !== 'NONE' ? `${p.header.format} · ` : ''}
                        {p.buttons.length ? `${p.buttons.length} botão(ões) · ` : ''}
                        {t.language}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-3">
            <div>
              <div class="text-sm font-medium">{escolhido.name}</div>
              <div class="text-xs text-fg-muted">{escolhido.language}</div>
            </div>
            {parsed?.variables.length ? (
              <div class="space-y-2">
                <div class="text-xs uppercase tracking-wider text-fg-muted">Variáveis</div>
                {parsed.variables.map((v, i) => (
                  <Input
                    key={v}
                    label={v}
                    value={vars[i] ?? ''}
                    placeholder={`Valor de ${v}`}
                    onInput={(e) => {
                      const next = [...vars]
                      next[i] = (e.target as HTMLInputElement).value
                      setVars(next)
                    }}
                  />
                ))}
              </div>
            ) : (
              <p class="text-xs text-fg-muted">Este modelo não tem variáveis para preencher.</p>
            )}
          </div>

          <div class="rounded-md border border-border bg-surface-2 p-3">
            <div class="mb-2 text-xs uppercase tracking-wider text-fg-muted">Como o contato vê</div>
            <div class="rounded-md bg-surface p-3 text-sm">
              {parsed?.header?.format === 'TEXT' && parsed.header.text && (
                <div class="mb-1 font-semibold">{interpolar(parsed.header.text, vars)}</div>
              )}
              {parsed?.header?.format && !['NONE', 'TEXT'].includes(parsed.header.format) && (
                <div class="mb-2 grid h-20 place-items-center rounded bg-surface-3 text-xs text-fg-muted">
                  [{parsed.header.format}]
                </div>
              )}
              <div class="whitespace-pre-wrap">{interpolar(parsed?.body ?? '', vars)}</div>
              {parsed?.footer && <div class="mt-2 text-xs text-fg-muted">{parsed.footer}</div>}
              {!!parsed?.buttons.length && (
                <div class="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
                  {parsed.buttons.map((b, i) => (
                    <span key={i} class="rounded border border-border px-2 py-1 text-xs text-accent">
                      {b.text || '(botão)'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
