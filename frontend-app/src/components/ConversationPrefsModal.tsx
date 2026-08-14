// Painel de preferências da tela de Conversas.
//
// Reúne o que cada operador ajusta para trabalhar (tamanho de fonte, densidade,
// velocidade do áudio, o que aparece na lista) e — só para administrador — o
// único item que vale para a instalação inteira: a transcrição dos áudios.

import { useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Loader2, RotateCcw } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { Section, Segmented, Switch } from '@/components/ui/PrefControls'
import { useAccountPrefs } from '@/hooks/useAccountPrefs'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useUserStore } from '@/stores/user'
import {
  AUDIO_SPEEDS,
  FONT_STEPS,
  META_FONT_STEPS,
  NAME_COLORS,
  useConversationPrefs,
  type FontStep,
} from '@/hooks/useConversationPrefs'
import { cn } from '@/lib/cn'

export const TRANSCRIBE_SETTING_KEY = 'conversations.transcribe_audio'

/** Aceita true/'true'/1/'1' — a Setting é Json e já chegou nos dois formatos. */
export function settingIsOn(value: unknown, fallback = true): boolean {
  if (value == null) return fallback
  const v = typeof value === 'string' ? value.replace(/^"|"$/g, '') : value
  if (v === '') return fallback
  return v === true || v === 'true' || v === 1 || v === '1'
}

export function ConversationPrefsModal({
  open,
  onOpenChange,
  notifEnabled,
  onToggleNotif,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  notifEnabled: boolean
  onToggleNotif: () => void
}) {
  const { prefs, setPref, reset } = useConversationPrefs()
  const { prefs: notif, setPref: setNotifPref } = useAccountPrefs()
  const role = useUserStore((s) => s.user?.role)
  const isAdmin = role === 'ADMIN' || role === 'SUPERADMIN'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Preferências das conversas"
      description="Valem só para você. Os sons acompanham a sua conta; o resto vale neste navegador. Os itens marcados como “toda a equipe” mudam a instalação inteira."
      size="xl"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { reset(); toast('Preferências restauradas', 'success') }}
          >
            <RotateCcw size={13} /> Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
        </>
      }
    >
      <div class="space-y-5">
        {/* Sons vêm primeiro: é o que a pessoa abre este painel para ajustar, e
          * no fim de um painel longo ficavam abaixo da dobra — quem procurou não
          * achou. */}
        <Section title="Sons" hint="Valem para a sua conta, em qualquer computador.">
          <Switch
            checked={notifEnabled}
            onChange={onToggleNotif}
            label="Som nas conversas"
            help="Mesmo controle do sino no topo da lista."
          />
          {notifEnabled && (
            <>
              <Segmented
                label="Quando emitir som"
                help="Confirmar o envio ajuda quem manda muita mensagem seguida; para a maioria, só o que chega basta."
                value={notif.notifyEvents}
                options={[
                  { id: 'incoming', label: 'Apenas ao receber' },
                  { id: 'both', label: 'Ao enviar e receber' },
                ]}
                onChange={(v) => setNotifPref({ notifyEvents: v as 'incoming' | 'both' })}
              />
              <p class="text-[0.6875rem] text-fg-subtle">
                Timbre, volume e aviso na área de trabalho ficam em “Minhas preferências”, no menu do seu usuário.
              </p>
            </>
          )}
          <Switch
            checked={notif.notifyGroups}
            onChange={(v) => setNotifPref({ notifyGroups: v })}
            label="Avisar sobre mensagens de grupos"
            help="Vale para o som e para o aviso na área de trabalho. Grupo costuma ter muito mais volume que conversa individual — desligue se atrapalhar."
          />
        </Section>

        <Section title="Leitura" hint="Ajuste o tamanho do texto sem mexer no zoom do navegador.">
          <Segmented
            label="Tamanho da fonte das mensagens"
            help="Vale para o texto dentro das bolhas da conversa."
            value={prefs.messageFont}
            options={FONT_STEPS.map((f) => ({ id: f.id, label: f.label }))}
            onChange={(v) => setPref('messageFont', v as FontStep)}
          />
          <Segmented
            label="Tamanho do nome e da hora na mensagem"
            help="O nome de quem enviou e o horário dentro da bolha — nascem bem menores que o texto e não acompanhavam o tamanho da mensagem."
            value={prefs.bubbleMetaFont}
            options={META_FONT_STEPS.map((f) => ({ id: f.id, label: f.label }))}
            onChange={(v) => setPref('bubbleMetaFont', v as FontStep)}
          />
          <Switch
            checked={prefs.nameBold}
            onChange={(v) => setPref('nameBold', v)}
            label="Nomes em negrito na conversa"
            help="Vale para o nome do contato e o do agente dentro das bolhas — não muda a lista nem o que o cliente recebe."
          />
          <Swatches
            label="Cor dos nomes na conversa"
            help="A mesma cor cai sobre a bolha do contato e a sua; confira na amostra abaixo se ficou legível nas duas."
            value={prefs.nameColor}
            onChange={(v) => setPref('nameColor', v)}
          />
          <Segmented
            label="Tamanho do nome do contato na lista"
            help="Vale para o nome na lista de conversas e no topo do atendimento."
            value={prefs.contactFont}
            options={FONT_STEPS.map((f) => ({ id: f.id, label: f.label }))}
            onChange={(v) => setPref('contactFont', v as FontStep)}
          />
          <Preview
            messageFont={prefs.messageFont}
            contactFont={prefs.contactFont}
            bubbleMetaFont={prefs.bubbleMetaFont}
            nameBold={prefs.nameBold}
            nameColor={prefs.nameColor}
          />
        </Section>

        <Section title="Lista de conversas">
          <Segmented
            label="Densidade da lista"
            help="Compacta reduz a altura das linhas e esconde os selos (canal, setor, responsável) — cabe mais conversa na tela em fila grande."
            value={prefs.density}
            options={[{ id: 'comfortable', label: 'Confortável' }, { id: 'compact', label: 'Compacta' }]}
            onChange={(v) => setPref('density', v as 'comfortable' | 'compact')}
          />
          <Switch
            checked={prefs.showAvatars}
            onChange={(v) => setPref('showAvatars', v)}
            label="Mostrar foto do contato"
            help="Desligado, a lista fica mais enxuta e carrega menos imagens."
          />
          <Switch
            checked={prefs.showPreview}
            onChange={(v) => setPref('showPreview', v)}
            label="Mostrar prévia da última mensagem"
            help="Desligue quando a tela ficar visível para outras pessoas na sala."
          />
        </Section>

        <Section title="Áudio">
          {isAdmin && <TranscriptionSetting />}
          <Switch
            checked={prefs.showTranscript}
            onChange={(v) => setPref('showTranscript', v)}
            label="Mostrar o texto transcrito junto do áudio"
            help="Só esconde o texto na sua tela — a transcrição continua gravada e pesquisável."
          />
          <Segmented
            label="Velocidade inicial dos áudios"
            help="Cada player começa nesta velocidade; dá para mudar no player durante a escuta."
            value={String(prefs.audioSpeed)}
            options={AUDIO_SPEEDS.map((s) => ({ id: String(s), label: `${String(s).replace('.', ',')}×` }))}
            onChange={(v) => setPref('audioSpeed', Number(v))}
          />
        </Section>

        <Section title="Escrita e alertas">
          <Segmented
            label="Tecla de envio"
            help="Em respostas longas, “Ctrl+Enter envia” evita mandar mensagem pela metade."
            value={prefs.sendOnEnter ? 'enter' : 'ctrl'}
            options={[{ id: 'enter', label: 'Enter envia' }, { id: 'ctrl', label: 'Ctrl+Enter envia' }]}
            onChange={(v) => setPref('sendOnEnter', v === 'enter')}
          />
          <Switch
            checked={prefs.blurMedia}
            onChange={(v) => setPref('blurMedia', v)}
            label="Desfocar imagens e vídeos até passar o mouse"
            help="Protege o conteúdo enviado pelo cliente em ambiente aberto."
          />
        </Section>
      </div>
    </Modal>
  )
}

// ── Transcrição (toda a equipe) ────────────────────────────────────────

function TranscriptionSetting() {
  const settingsQ = useSettings()
  const update = useUpdateSettings()
  const [pending, setPending] = useState(false)

  const enabled = useMemo(() => {
    const row = (settingsQ.data?.settings ?? []).find((s) => s.key === TRANSCRIBE_SETTING_KEY)
    return settingIsOn(row?.value, true)
  }, [settingsQ.data])

  function toggle(next: boolean) {
    setPending(true)
    update.mutate({ [TRANSCRIBE_SETTING_KEY]: next ? 'true' : 'false' }, {
      onSuccess: () => toast(
        next ? 'Transcrição de áudios ativada' : 'Transcrição de áudios desativada',
        'success',
      ),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setPending(false),
    })
  }

  return (
    <div class="rounded-md border border-border bg-surface-3/50 p-3">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-[0.625rem] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-accent/10 text-accent">
          Toda a equipe
        </span>
        {(settingsQ.isLoading || pending) && <Loader2 size={12} class="animate-spin text-fg-muted" />}
      </div>
      <Switch
        checked={enabled}
        onChange={toggle}
        disabled={settingsQ.isLoading || pending}
        label="Transcrever os áudios recebidos"
        help="O servidor converte cada áudio em texto e grava junto da mensagem — é o que permite ler a conversa sem ouvir e buscar pelo conteúdo do áudio. Desligar vale para todos os operadores e para os áudios que chegarem daqui em diante; os já transcritos continuam com o texto."
      />
    </div>
  )
}

// ── Peças ──────────────────────────────────────────────────────────────




/** Amostra ao vivo: mostra fontes, negrito e cor sem fechar o painel. */
function Preview({ messageFont, contactFont, bubbleMetaFont, nameBold, nameColor }: {
  messageFont: FontStep
  contactFont: FontStep
  bubbleMetaFont: FontStep
  nameBold: boolean
  nameColor: string
}) {
  const msg = FONT_STEPS.find((f) => f.id === messageFont)?.size
  const name = FONT_STEPS.find((f) => f.id === contactFont)?.size
  const meta = META_FONT_STEPS.find((f) => f.id === bubbleMetaFont)?.size
  const cor = NAME_COLORS.find((c) => c.id === nameColor)?.value
  const destaque = { ...(cor ? { color: cor } : {}), ...(nameBold ? { fontWeight: 700 } : {}) }
  return (
    <div class="rounded-md border border-border bg-surface p-3 space-y-2">
      <div class="text-fg truncate" style={{ fontSize: name }}>Maria Fernandes — Habitat Imóveis</div>
      <div class="flex justify-start">
        <div class="max-w-[75%] rounded-lg rounded-bl-sm border border-border bg-surface-2 px-3 py-2 text-fg" style={{ fontSize: msg }}>
          <div class="font-medium text-fg-muted mb-0.5" style={{ fontSize: meta, ...destaque }}>Maria Fernandes</div>
          Bom dia! Ainda dá tempo de visitar o apartamento hoje?
          <div class="text-fg-subtle mt-1" style={{ fontSize: meta }}>09:12</div>
        </div>
      </div>
      <div class="flex justify-end">
        <div class="max-w-[75%] rounded-lg rounded-br-sm bg-accent px-3 py-2 text-fg-on-brand" style={{ fontSize: msg }}>
          <strong style={destaque}>Rafael</strong><br />
          Dá sim — consigo às 15h. Confirmo para você?
          <div class="opacity-80 mt-1" style={{ fontSize: meta }}>09:14</div>
        </div>
      </div>
    </div>
  )
}

/** Paleta curta em bolinhas — mais direta que um seletor de cor livre. */
function Swatches({ label, help, value, onChange }: {
  label: string
  help?: string
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div>
      <div class="text-sm text-fg mb-1">{label}</div>
      <div class="flex gap-1.5 flex-wrap" role="group" aria-label={label}>
        {NAME_COLORS.map((c) => {
          const active = c.id === value
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              aria-pressed={active}
              title={c.label}
              aria-label={c.label}
              class={cn(
                'size-7 rounded-full border grid place-items-center text-[0.5625rem] font-semibold',
                active ? 'border-accent ring-2 ring-accent/40' : 'border-border',
                c.value ? '' : 'bg-surface-3 text-fg-muted',
              )}
              style={c.value ? { background: c.value } : undefined}
            >
              {c.value ? '' : 'A'}
            </button>
          )
        })}
      </div>
      {help && <p class="text-[0.6875rem] text-fg-subtle mt-1">{help}</p>}
    </div>
  )
}
