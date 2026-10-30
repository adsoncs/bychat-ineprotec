import { useState } from 'preact/hooks'
import { AlertTriangle, LayoutTemplate, X } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Select, Switch } from '@/components/ui/Input'
import { HsmTemplatePicker } from '@/components/HsmTemplatePicker'
import { nomeDoCanal } from '@/lib/channelColors'
import { useSenderChannels, type SenderChannelsResponse } from '@/hooks/useChat'

/** Modelo aprovado escolhido para sair no horário marcado. */
export interface ModeloEscolhido {
  name: string
  language: string
  components: unknown[] | undefined
  preview: string
}

export interface EnvioWhatsappValor {
  /** null = ainda não escolhido (contato sem conversa). */
  channelId: string | null
  cancelIfReplied: boolean
  modelo: ModeloEscolhido | null
}

export const ENVIO_WHATSAPP_INICIAL: EnvioWhatsappValor = { channelId: null, cancelIfReplied: true, modelo: null }

/**
 * Número de saída efetivo: o da conversa quando há conversa (travado); senão o
 * que a pessoa escolheu — sem padrão, de propósito.
 */
export function canalEfetivo(sc: SenderChannelsResponse | undefined, valor: EnvioWhatsappValor): string | null {
  return sc?.lockedChannelId ?? valor.channelId
}

/** Cloud API com a janela de 24h fechada no horário escolhido: só modelo aprovado sai. */
export function precisaDeModelo(sc: SenderChannelsResponse | undefined, valor: EnvioWhatsappValor, quando: Date): { precisa: boolean; jaFechada: boolean; fechaEm: Date | null } {
  const canal = sc?.channels.find((c) => c.id === canalEfetivo(sc, valor)) ?? null
  if (canal?.provider !== 'cloud_api') return { precisa: false, jaFechada: false, fechaEm: null }
  const jaFechada = !canal.window || !canal.window.open
  const fechaEm = canal.window?.expiresAt ? new Date(canal.window.expiresAt) : null
  const fechaAntes = !!fechaEm && !isNaN(quando.getTime()) && quando.getTime() > fechaEm.getTime()
  return { precisa: jaFechada || fechaAntes, jaFechada, fechaEm }
}

/**
 * O envio vai como modelo aprovado? Só na Cloud API, e só se houver um
 * escolhido — fora da janela ele é obrigatório; dentro, é opção de quem agenda.
 */
export function usaModelo(sc: SenderChannelsResponse | undefined, valor: EnvioWhatsappValor): boolean {
  const canal = sc?.channels.find((c) => c.id === canalEfetivo(sc, valor)) ?? null
  return !!valor.modelo && canal?.provider === 'cloud_api'
}

/**
 * Os campos de um envio de WhatsApp agendado — os mesmos no Conversas e no
 * Atividades: número, janela de 24h (com modelo aprovado quando ela estiver
 * fechada) e "cancelar se o contato responder antes".
 */
export function EnvioWhatsappCampos({ leadId, valor, onChange, quando, nomeDoContato }: {
  leadId: number
  valor: EnvioWhatsappValor
  onChange: (v: EnvioWhatsappValor) => void
  quando: Date
  nomeDoContato?: string | null | undefined
}) {
  const { data: sc, isLoading } = useSenderChannels(leadId)
  const [pickerAberto, setPickerAberto] = useState(false)
  const canais = sc?.channels ?? []
  const travado = sc?.lockedChannelId ?? null
  const canalId = canalEfetivo(sc, valor)
  const canal = canais.find((c) => c.id === canalId) ?? null
  const janela = precisaDeModelo(sc, valor, quando)
  const set = (p: Partial<EnvioWhatsappValor>) => onChange({ ...valor, ...p })

  return (
    <div class="space-y-3">
      <div>
        <label class="mb-1 block text-sm font-medium">Enviar pelo número</label>
        {isLoading ? (
          <div class="h-9 rounded-md bg-surface-3 animate-pulse" />
        ) : travado ? (
          <div class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
            <span class="font-medium">{canal ? nomeDoCanal(canal) : travado}</span>
            {canal?.number && nomeDoCanal(canal) !== canal.number && (
              <span class="ml-2 text-xs text-fg-muted">{canal.number}</span>
            )}
            {sc?.lockedChannelActive === false ? (
              <span class="mt-0.5 block text-xs text-danger">
                Este número está desconectado. Reconecte-o em Canais: a conversa é por ele, e a mensagem não pode sair por outro.
              </span>
            ) : (
              <span class="mt-0.5 block text-xs text-fg-muted">
                Número principal: a conversa com este contato já é por ele.
              </span>
            )}
          </div>
        ) : (
          <>
            <Select
              value={valor.channelId ?? ''}
              onChange={(e) => set({ channelId: (e.target as HTMLSelectElement).value || null, modelo: null })}
              aria-label="Número de envio"
            >
              <option value="">Escolha o número…</option>
              {canais.map((c) => (
                <option key={c.id} value={c.id}>
                  {nomeDoCanal(c)}{c.number && nomeDoCanal(c) !== c.number ? ` — ${c.number}` : ''}
                </option>
              ))}
            </Select>
            <span class="mt-1 block text-xs text-fg-muted">
              Este contato ainda não conversou pelo WhatsApp — o número escolhido passa a ser o da conversa.
            </span>
          </>
        )}
      </div>

      {canal?.provider === 'cloud_api' && (janela.precisa || valor.modelo) && (
        valor.modelo ? (
          <div class="rounded-md border border-border bg-surface-2 p-3 text-sm">
            <div class="flex items-center gap-2">
              <LayoutTemplate size={14} class="shrink-0 text-accent" />
              <span class="font-medium">Modelo: {valor.modelo.name}</span>
              <button type="button" class="ml-auto text-xs text-fg-muted hover:text-fg underline" onClick={() => setPickerAberto(true)}>Trocar</button>
              <button type="button" class="rounded p-0.5 text-fg-muted hover:text-danger" aria-label="Remover modelo" onClick={() => set({ modelo: null })}>
                <X size={13} />
              </button>
            </div>
            <p class="mt-1.5 whitespace-pre-wrap text-xs text-fg-muted">{valor.modelo.preview}</p>
          </div>
        ) : (
          <div class="flex gap-2 rounded-md border border-warning bg-warning/10 p-3 text-xs text-fg">
            <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
            <div class="space-y-2">
              <p>
                {janela.jaFechada
                  ? <>A janela de 24h deste número está <strong>fechada</strong>: o contato não escreveu nas últimas 24h.</>
                  : <>A janela de 24h fecha em <strong>{janela.fechaEm?.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>, antes do horário escolhido.</>}
                {' '}Pelo WhatsApp Oficial só sai <strong>modelo aprovado</strong>.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setPickerAberto(true)}>
                <LayoutTemplate size={13} /> Escolher modelo aprovado
              </Button>
            </div>
          </div>
        )
      )}
      {canal?.provider === 'cloud_api' && !janela.precisa && !valor.modelo && (
        <button type="button" class="text-xs text-fg-muted hover:text-fg underline" onClick={() => setPickerAberto(true)}>
          Enviar um modelo aprovado em vez de texto
        </button>
      )}

      <Switch
        checked={valor.cancelIfReplied}
        onChange={(v) => set({ cancelIfReplied: v })}
        label="Cancelar se o contato responder antes"
        hint="Desligado, a mensagem sai no horário mesmo que o contato tenha escrito nesse meio-tempo."
      />

      <HsmTemplatePicker
        open={pickerAberto}
        onOpenChange={setPickerAberto}
        wabaId={canal?.wabaId ?? null}
        numero={canal ? (canal.label || canal.number) : null}
        nomeDoContato={nomeDoContato ?? null}
        rotuloAcao="Usar este modelo"
        onSend={(m) => { set({ modelo: m }); setPickerAberto(false) }}
      />
    </div>
  )
}
