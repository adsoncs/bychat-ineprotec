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
import {
  CAIXAS, ESCOPOS, LABELS_PADRAO, TEMAS, useTabLabels, useUpdateTabLabels,
  useConversationTheme, useUpdateConversationTheme, type TabLabels, type TemaConversas,
} from '@/hooks/useTabLabels'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Input } from '@/components/ui/Input'
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

        {isAdmin && <NumeroPadraoSemWhatsapp />}
        {isAdmin && <TemaDoConversas />}

        {isAdmin && <NomesDasAbas />}

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

// ── Tema do módulo (toda a equipe) ─────────────────────────────────────

/**
 * O visual da tela de atendimento.
 *
 * Quem vem do WhatsApp Web sente cada diferença de cor como atrito — e é nesta
 * tela que o operador passa o dia. A escolha vale para a equipe inteira: um
 * time que combina "clica no verde ali em cima" precisa estar olhando a mesma
 * tela.
 *
 * Só o módulo Conversas muda; o resto do painel segue o design do sistema.
 */
function TemaDoConversas() {
  const { theme } = useConversationTheme()
  const salvar = useUpdateConversationTheme()

  function escolher(id: TemaConversas) {
    if (id === theme || salvar.isPending) return
    salvar.mutate(id, {
      onSuccess: () => toast('Tema do Conversas atualizado para toda a equipe', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Section
      title="Tema do Conversas"
      hint="Vale para TODA a equipe e só para esta tela — o restante do painel mantém o visual do sistema."
    >
      <div class="rounded-md border border-border bg-surface-3/50 p-3">
        <div class="mb-2 flex items-center gap-2">
          <span class="rounded bg-accent/10 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wider text-accent">
            Toda a equipe
          </span>
          {salvar.isPending && <Loader2 size={12} class="animate-spin text-fg-muted" />}
        </div>

        <div class="grid gap-2 sm:grid-cols-3">
          {TEMAS.map((t) => {
            const ativo = t.id === theme
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={ativo}
                disabled={salvar.isPending}
                onClick={() => escolher(t.id)}
                class={cn(
                  'cursor-pointer rounded-md border p-2 text-left transition-colors duration-200',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  ativo ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-accent/60',
                  salvar.isPending && 'cursor-not-allowed opacity-60',
                )}
              >
                {/* Prévia: papel de parede, bolha recebida e bolha enviada — os
                    três elementos que definem a cara da conversa. */}
                <span
                  class="mb-1.5 flex h-12 w-full flex-col justify-center gap-1 rounded border border-border px-1.5"
                  style={{ background: t.amostra.fundo }}
                  aria-hidden="true"
                >
                  <span class="h-2.5 w-3/5 rounded-sm" style={{ background: t.amostra.entrada }} />
                  <span class="h-2.5 w-2/5 self-end rounded-sm" style={{ background: t.amostra.saida }} />
                </span>
                <span class="flex items-center gap-1 text-xs font-medium text-fg">
                  {t.nome}
                  {ativo && <span class="text-[0.625rem] font-normal text-accent">· em uso</span>}
                </span>
                <span class="mt-0.5 block text-[0.6875rem] leading-snug text-fg-subtle">{t.resumo}</span>
              </button>
            )
          })}
        </div>
      </div>
    </Section>
  )
}

// ── Nomes das abas (toda a equipe) ─────────────────────────────────────

/**
 * O vocabulário da tela, definido pela empresa.
 *
 * "Caixa", "Atendimento", "Setor" descrevem UM jeito de trabalhar. Escola fala
 * em "Secretaria", clínica em "Recepção", agência em "Prospecção" — e a equipe
 * passa o dia relendo um rótulo que não é o dela. Aqui o administrador troca a
 * palavra; nenhuma regra muda junto.
 */
function NomesDasAbas() {
  const { labels } = useTabLabels()
  const salvar = useUpdateTabLabels()
  const [rascunho, setRascunho] = useState<TabLabels | null>(null)

  const atual = rascunho ?? labels
  const mudou = JSON.stringify(atual) !== JSON.stringify(labels)

  function editar(grupo: 'scope' | 'bucket', id: string, valor: string) {
    setRascunho({ ...atual, [grupo]: { ...atual[grupo], [id]: valor } } as TabLabels)
  }

  function aplicar(valores: TabLabels) {
    salvar.mutate(valores, {
      onSuccess: () => { setRascunho(null); toast('Nomes das abas atualizados para toda a equipe', 'success') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const campos: Array<{ grupo: 'scope' | 'bucket'; id: string; ajuda: string }> = [
    ...ESCOPOS.map((id) => ({ grupo: 'scope' as const, id, ajuda: {
      mine: 'Conversas atribuídas ao próprio operador.',
      team: 'Fila dos setores de que ele participa.',
      all: 'Tudo que o acesso dele alcança.',
    }[id] })),
    ...CAIXAS.map((id) => ({ grupo: 'bucket' as const, id, ajuda: {
      inbox: 'Conversa aberta e em andamento.',
      raw: 'Chegou mensagem e ninguém assumiu.',
      snoozed: 'Adormecida ou atribuída sem atendimento iniciado.',
      resolved: 'Atendimento encerrado.',
      all: 'Ignora a situação e mostra todas juntas.',
    }[id] })),
  ]

  return (
    <Section
      title="Nomes das abas"
      hint="Como o Conversas chama cada aba para TODA a equipe. Só os nomes mudam — o que cada aba mostra continua igual."
    >
      <div class="rounded-md border border-border bg-surface-3/50 p-3">
        <div class="mb-2 flex items-center gap-2">
          <span class="rounded bg-accent/10 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wider text-accent">
            Toda a equipe
          </span>
          {salvar.isPending && <Loader2 size={12} class="animate-spin text-fg-muted" />}
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          {campos.map((c) => {
            const padrao = (LABELS_PADRAO as any)[c.grupo][c.id] as string
            return (
              <label key={`${c.grupo}.${c.id}`} class="block">
                <span class="mb-0.5 block text-[0.6875rem] text-fg-muted">
                  {padrao}
                  <span class="ml-1 text-fg-subtle">· {c.ajuda}</span>
                </span>
                <Input
                  value={(atual as any)[c.grupo][c.id]}
                  maxLength={24}
                  placeholder={padrao}
                  aria-label={`Nome da aba ${padrao}`}
                  onInput={(e) => editar(c.grupo, c.id, (e.target as HTMLInputElement).value)}
                />
              </label>
            )
          })}
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span class="text-[0.6875rem] text-fg-subtle">
            {mudou ? 'Alterações ainda não salvas.' : 'Em dia com o que a equipe vê.'}
          </span>
          <div class="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={salvar.isPending}
              onClick={() => aplicar(LABELS_PADRAO)}
            >
              <RotateCcw size={13} /> Nomes padrão
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!mudou || salvar.isPending}
              onClick={() => aplicar(atual)}
            >
              Salvar nomes
            </Button>
          </div>
        </div>
      </div>
    </Section>
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
/** Número padrão para leads que NÃO entraram por WhatsApp.
 *
 *  Lead vindo de instância ou Cloud API já tem número próprio: o de entrada,
 *  que é o único que o contato conhece. Os outros (formulário, importação, API)
 *  não têm nenhum — antes o operador escolhia na mão em cada conversa. Aqui o
 *  administrador define uma vez qual número atende esses casos. */
function NumeroPadraoSemWhatsapp() {
  const qc = useQueryClient()
  const canais = useQuery({
    queryKey: ['sender-channels-prefs'],
    queryFn: () => api.get<{ channels: Array<{ id: string; name?: string; number?: string; provider?: string }> }>('/atendimento/sender-channels'),
  })
  const atual = useQuery({
    queryKey: ['canal-padrao'],
    queryFn: () => api.get<{ channelId: string | null }>('/atendimento/canal-padrao'),
  })
  const salvar = useMutation({
    mutationFn: (channelId: string | null) => api.put<{ ok: boolean }>('/atendimento/canal-padrao', { channelId }),
    onSuccess: () => {
      toast('Número padrão salvo', 'success')
      void qc.invalidateQueries({ queryKey: ['canal-padrao'] })
      void qc.invalidateQueries({ queryKey: ['sender-channels'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const lista = canais.data?.channels ?? []
  return (
    <div class="space-y-1.5 rounded-md border border-border bg-surface-2 p-3">
      <span class="text-sm font-medium text-fg">Número padrão para leads sem WhatsApp</span>
      <p class="text-[0.6875rem] text-fg-subtle">
        Vale para lead que entrou por formulário, importação ou API. Quem chegou por
        WhatsApp continua atendido pelo número por onde escreveu. Qualquer pessoa pode
        trocar o número na hora de enviar.
      </p>
      <select
        class="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg"
        value={atual.data?.channelId ?? ''}
        disabled={salvar.isPending || canais.isLoading}
        onChange={(e) => salvar.mutate((e.target as HTMLSelectElement).value || null)}
      >
        <option value="">Sem padrão (o operador escolhe)</option>
        {lista.map((c) => (
          <option key={c.id} value={c.id}>
            {[c.name, c.number].filter(Boolean).join(' · ') || c.id}
            {c.provider === 'cloud_api' ? ' (Cloud API)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
