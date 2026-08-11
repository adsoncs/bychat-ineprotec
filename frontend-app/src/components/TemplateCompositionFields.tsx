import { Plus, X, Info } from 'lucide-preact'
import { Input } from '@/components/ui/Input'

interface Props {
  header: string
  setHeader: (v: string) => void
  footer: string
  setFooter: (v: string) => void
  options: string[]
  setOptions: (v: string[]) => void
  channel: string
  /** Para o preview refletir o que o contato vai ver. */
  body: string
}

const MAX_OPCOES = 10

/**
 * Composição da mensagem nos modelos comuns: cabeçalho, rodapé e opções.
 *
 * Estes modelos saem tanto por Evolution quanto por Cloud API, e a Evolution
 * NÃO envia botão — o provider lança erro em mensagem interativa. Por isso as
 * opções aqui viram lista numerada, do mesmo jeito que o chatbot já faz quando
 * o canal não é oficial. Botão de verdade é a tela WhatsApp › Modelos de
 * Mensagem, e o aviso no rodapé aponta para lá.
 */
export function TemplateCompositionFields({
  header, setHeader, footer, setFooter, options, setOptions, channel, body,
}: Props) {
  if (channel !== 'whatsapp') return null

  const preview = [
    header.trim() ? `*${header.trim()}*` : '',
    body.trim() || '(corpo da mensagem)',
    options.filter((o) => o.trim()).map((o, i) => `${i + 1}) ${o.trim()}`).join('\n'),
    footer.trim() ? `_${footer.trim()}_` : '',
  ].filter(Boolean).join('\n\n')

  return (
    <div class="mt-3 space-y-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <Input
          label="Cabeçalho"
          value={header}
          maxLength={120}
          placeholder="Ex: Proposta Comercial"
          hint="Sai em negrito, antes do corpo."
          onInput={(e) => setHeader((e.target as HTMLInputElement).value)}
        />
        <Input
          label="Rodapé"
          value={footer}
          maxLength={120}
          placeholder="Ex: Equipe Comercial · seg a sex, 9h às 18h"
          hint="Sai em itálico, no fim."
          onInput={(e) => setFooter((e.target as HTMLInputElement).value)}
        />
      </div>

      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="text-sm font-medium">Opções de resposta ({options.length}/{MAX_OPCOES})</label>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
            disabled={options.length >= MAX_OPCOES}
            onClick={() => setOptions([...options, ''])}
          >
            <Plus size={12} /> Adicionar opção
          </button>
        </div>

        {options.length === 0 ? (
          <p class="text-xs text-fg-subtle">
            Ex.: "Sim" e "Não" — viram uma lista numerada que o contato responde com o número.
          </p>
        ) : (
          <div class="space-y-2">
            {options.map((o, i) => (
              <div key={i} class="flex items-center gap-2">
                <span class="w-5 shrink-0 text-sm text-fg-subtle">{i + 1})</span>
                <Input
                  value={o}
                  maxLength={60}
                  placeholder={i === 0 ? 'Sim' : i === 1 ? 'Não' : 'Opção'}
                  onInput={(e) => {
                    const next = [...options]
                    next[i] = (e.target as HTMLInputElement).value
                    setOptions(next)
                  }}
                />
                <button
                  type="button"
                  class="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-danger"
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  aria-label={`Remover opção ${i + 1}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div class="mt-2 flex gap-2 rounded-md border border-border bg-surface-2 p-2 text-xs text-fg-muted">
          <Info size={13} class="mt-0.5 shrink-0" />
          <span>
            Botões clicáveis existem só no WhatsApp Oficial (Cloud API) e exigem modelo aprovado pela
            Meta — monte em <strong>WhatsApp › Modelos de Mensagem</strong>. Aqui as opções saem como
            lista numerada, que funciona em qualquer número.
          </span>
        </div>
      </div>

      {(header.trim() || footer.trim() || options.some((o) => o.trim())) && (
        <div class="rounded-md border border-border bg-surface-2 p-3">
          <div class="mb-1 text-xs uppercase tracking-wider text-fg-subtle">Como o contato vê</div>
          <div class="whitespace-pre-wrap rounded-md bg-surface p-3 text-sm">{preview}</div>
        </div>
      )}
    </div>
  )
}
