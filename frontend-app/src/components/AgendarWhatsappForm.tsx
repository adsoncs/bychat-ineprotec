import { AlertTriangle } from '@/components/ui/icon-set'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { useTemplates } from '@/hooks/useTemplates'
import { type SenderChannelsResponse } from '@/hooks/useChat'
import {
  EnvioWhatsappCampos, ENVIO_WHATSAPP_INICIAL, canalEfetivo, precisaDeModelo, usaModelo,
  type EnvioWhatsappValor, type ModeloEscolhido,
} from '@/components/EnvioWhatsappCampos'

/**
 * O formulário de um WhatsApp agendado — o MESMO no Conversas ("Agendar
 * envio"), em Nova atividade e em Editar atividade. Antes cada tela tinha um
 * pedaço: o Conversas tinha atalhos de horário e número; o Atividades tinha
 * modelos internos e variáveis, mas espalhava horário e número em abas
 * diferentes e não tinha nada disso na edição.
 */
export interface AgendamentoWhatsapp {
  texto: string
  /** Valor de <input type="datetime-local">, no fuso de quem usa. */
  quando: string
  envio: EnvioWhatsappValor
  /** Modelo interno (Modelos de mensagem) que originou o texto. */
  templateId: number | null
}

const VARIAVEIS = ['nome', 'empresa', 'operador', 'data_hoje', 'whatsapp', 'email']

/** Date → datetime-local no fuso LOCAL. O toISOString() daria UTC e o
 *  operador veria 3h a menos. */
export function paraInputLocal(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

/** Atalhos de horário — cobrem a maioria dos casos sem abrir o calendário. */
function atalhos(): { label: string; date: Date }[] {
  const agora = new Date()
  const em1h = new Date(agora.getTime() + 3600_000)
  const amanhaCedo = new Date(agora)
  amanhaCedo.setDate(amanhaCedo.getDate() + 1)
  amanhaCedo.setHours(9, 0, 0, 0)
  const segunda = new Date(agora)
  // 1 = segunda; se hoje já é segunda, joga para a próxima.
  const diasAteSegunda = ((8 - segunda.getDay()) % 7) || 7
  segunda.setDate(segunda.getDate() + diasAteSegunda)
  segunda.setHours(9, 0, 0, 0)
  return [
    { label: 'Em 1 hora', date: em1h },
    { label: 'Amanhã, 9h', date: amanhaCedo },
    { label: 'Segunda, 9h', date: segunda },
  ]
}

export function agendamentoNovo(texto = ''): AgendamentoWhatsapp {
  return { texto, quando: paraInputLocal(new Date(Date.now() + 3600_000)), envio: ENVIO_WHATSAPP_INICIAL, templateId: null }
}

/** Atividade já gravada → formulário (para Editar atividade). */
export function agendamentoDaAtividade(a: { messageBody: string | null; scheduledAt: string; templateId: number | null; metadata: Record<string, unknown> | null }): AgendamentoWhatsapp {
  const meta = (a.metadata ?? {}) as { channelId?: string | null; cancelIfReplied?: boolean; kind?: string; hsmPayload?: { name: string; language: string; components?: unknown[] } }
  const modelo: ModeloEscolhido | null = meta.kind === 'template_hsm' && meta.hsmPayload
    ? { name: meta.hsmPayload.name, language: meta.hsmPayload.language, components: meta.hsmPayload.components, preview: a.messageBody ?? '' }
    : null
  return {
    texto: modelo ? '' : (a.messageBody ?? ''),
    quando: paraInputLocal(new Date(a.scheduledAt)),
    envio: { channelId: meta.channelId ?? null, cancelIfReplied: meta.cancelIfReplied !== false, modelo },
    templateId: a.templateId,
  }
}

/** Mesmas regras nas três telas. Devolve o motivo, ou null se dá para salvar. */
export function validarAgendamento(v: AgendamentoWhatsapp, sc: SenderChannelsResponse | undefined): string | null {
  const data = new Date(v.quando)
  if (!canalEfetivo(sc, v.envio)) return 'Escolha por qual número a mensagem vai sair'
  if (sc?.lockedChannelId && sc.lockedChannelActive === false) return 'O número desta conversa está desconectado — reconecte-o em Canais'
  if (isNaN(data.getTime())) return 'Data ou hora inválida'
  if (data.getTime() - Date.now() < 60_000) return 'Escolha um horário pelo menos 1 minuto à frente'
  if (precisaDeModelo(sc, v.envio, data).precisa && !v.envio.modelo) return 'Fora da janela de 24h: escolha um modelo aprovado'
  if (!usaModelo(sc, v.envio) && !v.texto.trim()) return 'Escreva a mensagem que deve ser enviada'
  return null
}

/** Campos de envio para a API (rota de agendamento ou de atividades). */
export function payloadDoAgendamento(v: AgendamentoWhatsapp, sc: SenderChannelsResponse | undefined) {
  const modelo = usaModelo(sc, v.envio) ? v.envio.modelo! : null
  return {
    scheduledAt: new Date(v.quando).toISOString(),
    channelId: canalEfetivo(sc, v.envio),
    cancelIfReplied: v.envio.cancelIfReplied,
    ...(modelo
      ? {
          kind: 'template_hsm' as const,
          body: modelo.preview,
          hsmPayload: { name: modelo.name, language: modelo.language, ...(modelo.components ? { components: modelo.components } : {}) },
          templateId: null,
        }
      : { kind: 'text' as const, body: v.texto.trim(), templateId: v.templateId }),
  }
}

export function AgendarWhatsappForm({ leadId, valor, onChange, sc, nomeDoContato, desabilitado }: {
  leadId: number
  valor: AgendamentoWhatsapp
  onChange: (v: AgendamentoWhatsapp) => void
  sc: SenderChannelsResponse | undefined
  nomeDoContato?: string | null | undefined
  /** Já enviada: só leitura. */
  desabilitado?: boolean | undefined
}) {
  const templatesQ = useTemplates({ channel: 'whatsapp' })
  const set = (p: Partial<AgendamentoWhatsapp>) => onChange({ ...valor, ...p })
  const comModelo = usaModelo(sc, valor.envio)

  return (
    <fieldset class="space-y-4" disabled={desabilitado}>
      {!comModelo && (
        <div class="space-y-2">
          {(templatesQ.data?.templates ?? []).length > 0 && (
            <Select
              label="Modelo de mensagem (opcional)"
              value={valor.templateId ? String(valor.templateId) : ''}
              onChange={(e) => {
                const id = Number((e.target as HTMLSelectElement).value) || null
                const tpl = templatesQ.data?.templates.find((t) => t.id === id)
                set({ templateId: id, ...(tpl ? { texto: tpl.body } : {}) })
              }}
            >
              <option value="">— sem modelo —</option>
              {templatesQ.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          <Textarea
            label="Mensagem"
            rows={4}
            value={valor.texto}
            onInput={(e) => set({ texto: (e.target as HTMLTextAreaElement).value })}
            placeholder="O que deve ser enviado no horário marcado…"
            hint="As variáveis são preenchidas com os dados do lead na hora do envio"
          />
          <div class="flex flex-wrap gap-1.5">
            <span class="text-xs text-fg-muted self-center">Inserir:</span>
            {VARIAVEIS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set({ texto: `${valor.texto}{{${v}}}` })}
                class="h-6 px-2 rounded-full text-2xs font-mono bg-surface text-fg-muted border border-border hover:bg-surface-3 hover:text-fg"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label class="mb-1 block text-sm font-medium">Quando enviar</label>
        <div class="mb-2 flex flex-wrap gap-2">
          {atalhos().map((a) => (
            <button
              key={a.label}
              type="button"
              class="rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
              onClick={() => set({ quando: paraInputLocal(a.date) })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <Input type="datetime-local" value={valor.quando} onInput={(e) => set({ quando: (e.target as HTMLInputElement).value })} />
      </div>

      <EnvioWhatsappCampos
        leadId={leadId}
        valor={valor.envio}
        onChange={(envio) => set({ envio })}
        quando={new Date(valor.quando)}
        nomeDoContato={nomeDoContato}
      />

      <div class="flex gap-2 rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
        <AlertTriangle size={14} class="mt-0.5 shrink-0" />
        <span>
          No horário do envio a mensagem passa pelas mesmas regras de uma mensagem digitada agora:
          número da conversa, opt-out e bloqueios de envio. Ela fica em Atividades, onde dá para editar,
          enviar antes ou cancelar.
        </span>
      </div>
    </fieldset>
  )
}
