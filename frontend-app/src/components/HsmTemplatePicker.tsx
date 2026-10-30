import { useMemo, useState } from 'preact/hooks'
import { LayoutTemplate, Send } from '@/components/ui/icon-set'
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
  /**
   * Conta (WABA) do número por onde a conversa sai — só os modelos dela são
   * oferecidos. O modelo pertence à conta: oferecer o da outra empresa faz a
   * Meta recusar o envio e, quando passasse, falaria com o contato em nome de
   * quem ele não procurou.
   */
  wabaId?: string | null | undefined
  /** Nome/número do canal, para a tela dizer de quem são os modelos listados. */
  numero?: string | null | undefined
  /** Nome do lead: preenche a variável de nome do modelo ("Olá, {{1}}!"). */
  nomeDoContato?: string | null | undefined
  /** Rótulo do botão de confirmar. Agendamento usa "Usar este modelo": nada
   *  sai agora, o modelo só fica escolhido para o horário marcado. */
  rotuloAcao?: string | undefined
}

/** Primeiro nome legível: sem emoji nem pontuação, com a 1ª letra maiúscula.
 *  "GENEZIO \"NETO\" DURANS" → "Genezio"; "👊🏻" → "" (fica para o atendente). */
export function primeiroNome(nome: string | null | undefined): string {
  const palavra = String(nome ?? '').match(/\p{L}[\p{L}'’-]*/u)?.[0] ?? ''
  if (palavra.length < 2) return ''
  return palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1).toLocaleLowerCase('pt-BR')
}

/** A variável é o nome do contato? Nomeada ({{nome}}, {{aluno}}…) ou logo
 *  depois de uma saudação ("Olá, {{1}}", "Oi {{1}}", "Bom dia, {{1}}"). */
function ehVariavelDeNome(variavel: string, corpo: string): boolean {
  const chave = variavel.replace(/^\{\{\s*|\s*\}\}$/g, '')
  if (/^(nome|primeiro_?nome|first_?name|name|aluno|cliente|contato|lead)$/i.test(chave)) return true
  const token = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<!\\p{L})(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad[oa]|car[oa])[\\s,!]*\\{\\{\\s*${token}\\s*\\}\\}`, 'iu').test(corpo)
}

/** Valor que não diz nada (".", "-", "  "): a Meta aceita, o contato estranha. */
const semConteudo = (v: string) => !/[\p{L}\p{N}]/u.test(v)

/** Substitui {{1}}, {{2}}… ou {{nome}}, {{aluno}}… pelos valores digitados,
 *  para o preview e para o corpo que fica registrado no histórico da conversa. */
function interpolar(texto: string, variables: string[], vars: string[]): string {
  return texto.replace(/\{\{\s*[^}\s]+\s*\}\}/g, (m) => {
    const idx = variables.indexOf(m)
    return idx >= 0 && vars[idx] ? vars[idx] : m
  })
}

/**
 * Modelos aprovados pela Meta, para usar DENTRO da conversa.
 *
 * Só estes têm cabeçalho, mídia, rodapé e botões de verdade — a Evolution não
 * envia mensagem interativa (o provider lança erro explícito). Por isso o botão
 * que abre este seletor só aparece quando a conversa sai por um número Cloud API.
 */
export function HsmTemplatePicker({ open, onOpenChange, onSend, enviando, wabaId, numero, nomeDoContato, rotuloAcao }: Props) {
  // Pede ao backend só os modelos da conta deste número; o filtro repetido
  // abaixo cobre a lista que já estava em cache de outro número.
  const { data, isLoading } = useCloudApiTemplates(wabaId ? { wabaId } : undefined)
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<CloudApiTemplate | null>(null)
  const [vars, setVars] = useState<string[]>([])

  const aprovados = useMemo(() => {
    const todos = (data?.templates ?? []).filter((t) =>
      String(t.status).toUpperCase() === 'APPROVED' && (!wabaId || t.wabaId === wabaId))
    const q = busca.trim().toLowerCase()
    return q ? todos.filter((t) => t.name.toLowerCase().includes(q)) : todos
  }, [data, busca, wabaId])

  const parsed = useMemo(() => (escolhido ? parseTemplateComponents(escolhido.components) : null), [escolhido])

  function escolher(t: CloudApiTemplate) {
    setEscolhido(t)
    const p = parseTemplateComponents(t.components)
    // O nome já vem do lead: sem isso o atendente digitava "." para passar.
    const nome = primeiroNome(nomeDoContato)
    setVars(p.variables.map((v) => (nome && ehVariavelDeNome(v, p.body) ? nome : '')))
  }

  function enviar() {
    if (!escolhido || !parsed) return
    if (parsed.variables.length && vars.some((v) => !v.trim())) {
      toast('Preencha todas as variáveis do modelo', 'warning')
      return
    }
    const vazia = parsed.variables.find((_, i) => semConteudo(vars[i] ?? ''))
    if (vazia) {
      toast(`${vazia} está sem conteúdo. Escreva o nome do contato ou o texto certo — "." chega como "Olá ., tudo bem?".`, 'warning')
      return
    }
    const components = parsed.variables.length
      ? [{
          type: 'body',
          parameters: vars.map((v, i) => {
            const p: Record<string, string> = { type: 'text', text: v.trim() }
            // Template nomeado exige parameter_name (o token sem as chaves) — sem
            // isso a Meta recusa com #132000 mesmo com a quantidade certa de params.
            if (parsed.named) p.parameter_name = parsed.variables[i]!.replace(/^\{\{\s*|\s*\}\}$/g, '')
            return p
          }),
        }]
      : undefined
    onSend({
      name: escolhido.name,
      language: escolhido.language,
      components,
      // O histórico guarda o texto já preenchido — sem isso a conversa mostraria
      // "{{1}}"/"{{nome}}" no lugar do nome do cliente.
      preview: interpolar(parsed.body, parsed.variables, vars),
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
      title={rotuloAcao ? 'Escolher modelo aprovado' : 'Enviar modelo aprovado'}
      description={
        numero
          ? `Modelos do número ${numero} — aprovados pela Meta e entregues mesmo fora da janela de 24h. Modelo de outro número a Meta recusa.`
          : 'Modelos com cabeçalho, mídia e botões — aprovados pela Meta e entregues mesmo fora da janela de 24h.'
      }
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
              {enviando ? 'Enviando…' : (rotuloAcao ?? 'Enviar')}
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
              title={numero ? `Nenhum modelo aprovado para ${numero}` : 'Nenhum modelo aprovado'}
              description={
                numero
                  ? `Os modelos são da conta do número ${numero} — os de outro número não servem aqui. Crie e envie para aprovação em WhatsApp › Modelos de Mensagem, escolhendo este número.`
                  : 'Crie e envie para aprovação em WhatsApp › Modelos de Mensagem. A Meta costuma responder em algumas horas.'
              }
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
                    hint={parsed && ehVariavelDeNome(v, parsed.body) ? 'Nome do contato — confira antes de enviar' : undefined}
                    error={vars[i] && semConteudo(vars[i]!) ? 'Sem conteúdo: escreva o nome ou o texto' : undefined}
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
                <div class="mb-1 font-semibold">{interpolar(parsed.header.text, parsed.variables, vars)}</div>
              )}
              {parsed?.header?.format && !['NONE', 'TEXT'].includes(parsed.header.format) && (
                <div class="mb-2 grid h-20 place-items-center rounded bg-surface-3 text-xs text-fg-muted">
                  [{parsed.header.format}]
                </div>
              )}
              <div class="whitespace-pre-wrap">{interpolar(parsed?.body ?? '', parsed?.variables ?? [], vars)}</div>
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
