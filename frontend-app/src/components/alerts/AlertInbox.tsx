import { useState, useEffect } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useLocation } from 'wouter-preact'
import { Bell, AlertTriangle, AlertCircle, Info, Check, X as XIcon, ExternalLink, BellOff } from '@/components/ui/icon-set'
import { onServerEvent } from '@/lib/realtime'
import { useQueryClient } from '@tanstack/react-query'
import { playNotificationSound } from '@/lib/notificationSound'
import { showDesktopNotification } from '@/lib/desktopNotify'
import { useAccountPrefs } from '@/hooks/useAccountPrefs'
import { useT } from '@/i18n'
import {
  useAlerts, useUnreadAlertCount, useMarkAlertRead, useDismissAlert, useMarkAllAlertsRead,
  useAlertAction, useMuteAlert, useAlertBacklog, type AlertItem, type AlertSeverity,
} from '@/hooks/useAlerts'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

// Caixa de alertas — o sino da topbar.
//
// É gaveta e não página de propósito: alerta se lê de onde a pessoa está. Uma
// página exigiria navegar até o problema, e quem navega até os alertas já sabia
// que eles existiam — que é justamente quem não precisa ser avisado.
//
// Cada linha carrega o caminho de volta ao item e, quando cabe, a ação que
// encerra a condição. É a lição do desfecho de reunião: o botão existia na
// Agenda e nunca foi usado uma única vez porque ficava longe. Alerta que só
// aponta o problema repete esse erro — a pessoa lê, concorda e não faz nada,
// porque agir dá trabalho.
//
// A lista só é buscada quando a gaveta abre; o que fica de pé o tempo todo é o
// contador, que é uma linha só.

const ICONE: Record<AlertSeverity, typeof Bell> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}
const COR: Record<AlertSeverity, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-fg-muted',
}

export function AlertInbox() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const t = useT()
  const { prefs } = useAccountPrefs()
  const countQuery = useUnreadAlertCount()
  const count = countQuery.data?.count ?? 0

  // O sino toca pelo WebSocket; o refetch do contador é só rede de segurança.
  // Reusa as preferências que já existem para mensagem — som e aviso na área de
  // trabalho —, porque criar preferência nova antes de o time usar o recurso é
  // adivinhar o que vai incomodar.
  useEffect(() => {
    return onServerEvent((ev) => {
      if (ev.type !== 'alert:raised') return
      qc.invalidateQueries({ queryKey: ['alerts'] })

      const p = (ev.payload || {}) as { title?: string; severity?: AlertSeverity; id?: number }
      if (prefs.notifySound) playNotificationSound()
      if (prefs.notifyDesktop && document.visibilityState === 'hidden') {
        showDesktopNotification({
          title: p.severity === 'critical' ? t('alerts.severity.critical') : t('alerts.title'),
          body: p.title || '',
          // `tag` por alerta: a mesma condição reaparecendo substitui o aviso
          // anterior em vez de empilhar mais um na área de trabalho.
          tag: `alert:${p.id ?? ''}`,
        })
      }
    })
  }, [qc, prefs.notifySound, prefs.notifyDesktop, t])

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          class="relative inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label={count > 0 ? t('alerts.ariaUnread', { count }) : t('alerts.aria')}
          title={t('alerts.title')}
        >
          <Bell size={18} />
          {count > 0 && (
            <span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-fg-on-brand text-3xs font-bold flex items-center justify-center">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          class="flex flex-col w-[28rem] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-xl"
          style={{
            zIndex: 'var(--z-dropdown)',
            // A altura vive AQUI, e é o que torna a lista rolável: o miolo só
            // ganha barra de rolagem se algum ancestral disser onde ele acaba.
            // Antes o limite era um `max-h` com `overflow-hidden` sobre um
            // conteúdo de altura livre — o que passava de 32rem era cortado sem
            // barra nenhuma, e a caixa parecia travada em três linhas.
            // O `min` com a variável do Radix cobre a tela baixa, onde 32rem
            // já não cabem e a gaveta sairia por baixo do rodapé.
            maxHeight: 'min(32rem, var(--radix-dropdown-menu-content-available-height, 32rem))',
          }}
        >
          <ListaDeAlertas aberta={open} naoLidos={count} onFechar={() => setOpen(false)} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ListaDeAlertas(
  { aberta, naoLidos, onFechar }: { aberta: boolean; naoLidos: number; onFechar: () => void },
) {
  const t = useT()
  const query = useAlerts(aberta)
  const marcarTodos = useMarkAllAlertsRead()
  const lista = query.data?.alerts ?? []
  const { soltos, grupos } = separar(lista)

  return (
    // `min-h-0` é obrigatório nos dois níveis: sem ele um filho flex se recusa a
    // ficar menor que o próprio conteúdo, e a barra de rolagem nunca aparece.
    <div class="flex flex-col min-h-0 flex-1">
      <div class="shrink-0 p-3 border-b border-border flex items-start justify-between gap-3">
        <div>
          <div class="font-semibold text-sm">{t('alerts.title')}</div>
          <div class="text-xs text-fg-muted">{t('alerts.subtitle')}</div>
        </div>
        {naoLidos > 0 && (
          <button
            class="text-xs text-fg-muted hover:text-fg whitespace-nowrap"
            onClick={() => marcarTodos.mutate()}
            disabled={marcarTodos.isPending}
          >
            {t('alerts.markAllRead')}
          </button>
        )}
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {query.isLoading ? (
          <div class="p-6 text-xs text-fg-muted">{t('common.loading')}</div>
        ) : lista.length === 0 ? (
          <div class="p-6 text-xs text-fg-muted text-center">
            <Bell size={20} class="mx-auto mb-2 opacity-50" />
            {t('alerts.empty')}
          </div>
        ) : (
          <>
            {soltos.map((a) => <LinhaDeAlerta key={a.id} alerta={a} onNavegar={onFechar} />)}
            {grupos.map((g) => <GrupoDeAlertas key={g.kind} grupo={g} onNavegar={onFechar} />)}
          </>
        )}
      </div>
      <RodapeDoAcervo aberta={aberta} />
    </div>
  )
}

/**
 * O que a janela de corte deixou de fora.
 *
 * Existe porque a janela cria um ponto cego: as pendências antigas deixam de
 * existir para quem só olha a caixa. Fica no rodapé, discreto e sem contador
 * vermelho, porque acervo não é urgência — é uma decisão que alguém precisa
 * tomar uma vez, não um aviso que se repete.
 */
function RodapeDoAcervo({ aberta }: { aberta: boolean }) {
  const t = useT()
  const query = useAlertBacklog(aberta)
  const total = query.data?.total ?? 0
  if (!total) return null

  return (
    <div
      class="shrink-0 px-3 py-2 border-t border-border text-3xs text-fg-muted"
      title={t('alerts.backlog.hint')}
    >
      {t('alerts.backlog.line', { count: total })}
    </div>
  )
}

/**
 * Quantos itens de um tipo cabem soltos antes de valer a pena agrupar.
 *
 * Dois é o piso porque agrupar um item só é pior que não agrupar: esconde a
 * informação atrás de um clique e ainda ocupa a mesma linha.
 */
const MINIMO_PARA_AGRUPAR = 3

interface Grupo {
  kind: string
  itens: AlertItem[]
}

/**
 * Divide a lista entre o que aparece solto e o que vira grupo.
 *
 * Crítico NUNCA agrupa. É a única classe em que cada caso pede uma ação
 * diferente e imediata — esconder um atrás de "ver 4" é transformar urgência em
 * lista. O resto agrupa quando repete o bastante para atrapalhar a leitura:
 * nove propostas paradas são nove linhas que empurram tudo mais para fora da
 * tela, e quem rola até o fim de uma gaveta é quem já ia agir de qualquer jeito.
 */
function separar(lista: AlertItem[]): { soltos: AlertItem[]; grupos: Grupo[] } {
  const criticos = lista.filter((a) => a.severity === 'critical')
  const resto = lista.filter((a) => a.severity !== 'critical')

  const porKind = new Map<string, AlertItem[]>()
  for (const a of resto) {
    const atual = porKind.get(a.kind) || []
    atual.push(a)
    porKind.set(a.kind, atual)
  }

  const soltos = [...criticos]
  const grupos: Grupo[] = []
  for (const [kind, itens] of porKind) {
    if (itens.length >= MINIMO_PARA_AGRUPAR) grupos.push({ kind, itens })
    else soltos.push(...itens)
  }
  // Grupo maior primeiro: é o que mais polui a lista se ficar aberto.
  grupos.sort((a, b) => b.itens.length - a.itens.length)
  return { soltos, grupos }
}

function GrupoDeAlertas({ grupo, onNavegar }: { grupo: Grupo; onNavegar: () => void }) {
  const t = useT()
  const [aberto, setAberto] = useState(false)
  const naoLidos = grupo.itens.filter((a) => !a.readAt).length
  // O ícone do grupo segue a severidade dos itens, como nas linhas soltas.
  // Fixo em triângulo laranja, um grupo de "reunião sem desfecho" (info) se
  // anunciava como aviso — o mesmo símbolo dizendo duas coisas diferentes
  // conforme a linha, que é como se desaprende a ler um painel. Crítico não
  // chega aqui: ele nunca agrupa.
  const severidade: AlertSeverity = grupo.itens.some((a) => a.severity === 'warning') ? 'warning' : 'info'
  const IconeGrupo = ICONE[severidade]
  // O rótulo do tipo é traduzido quando conhecido; um produtor novo cai no
  // próprio `kind` em vez de sumir da tela.
  const rotulo = t(`alerts.kind.${grupo.kind}` as never) || grupo.kind
  const nome = rotulo.startsWith('alerts.kind.') ? grupo.kind : rotulo

  return (
    <div class="border-b border-border last:border-b-0">
      <button
        class="w-full flex items-center gap-3 p-3 hover:bg-surface-1 text-left"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <IconeGrupo size={16} class={cn('shrink-0', COR[severidade])} />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {nome}
            <span class="ml-1.5 text-fg-muted font-normal">· {grupo.itens.length}</span>
          </div>
          {naoLidos > 0 && (
            <div class="text-3xs text-fg-muted mt-0.5">{t('alerts.ariaUnread', { count: naoLidos })}</div>
          )}
        </div>
        <span class="text-2xs text-fg-muted shrink-0">
          {aberto ? t('alerts.group.collapse') : t('alerts.group.expand', { count: grupo.itens.length })}
        </span>
      </button>
      {aberto && (
        <div class="border-t border-border bg-surface-1/40">
          {grupo.itens.map((a) => <LinhaDeAlerta key={a.id} alerta={a} onNavegar={onNavegar} />)}
        </div>
      )}
    </div>
  )
}

/**
 * As ações que encerram a condição, na própria linha.
 *
 * Vêm do backend (`services/alertLinks.ts`) e não de um `if` aqui: quando um
 * produtor novo nascer, ele ganha as ações lá e o sino não precisa saber de
 * nada. É também o que garante que os botões oferecidos combinem com o que a
 * rota `/action` aceita de verdade.
 */
function AcoesDoAlerta({ alerta }: { alerta: AlertItem }) {
  const t = useT()
  const agir = useAlertAction()
  if (!alerta.acoes?.length) return null

  return (
    <div class="flex gap-1.5 mt-2">
      {alerta.acoes.map((a) => (
        <button
          key={a.action}
          class={cn(
            'px-2 py-1 rounded text-2xs font-medium disabled:opacity-50',
            a.tom === 'primary'
              ? 'bg-success/15 text-success hover:bg-success/25'
              : 'bg-surface-3 text-fg-muted hover:text-fg',
          )}
          onClick={() =>
            agir.mutate(
              { id: alerta.id, action: a.action },
              {
                onSuccess: () => toast(t('alerts.action.done'), 'success'),
                onError: (e: unknown) => toast((e as Error).message || t('alerts.action.failed'), 'danger'),
              },
            )
          }
          disabled={agir.isPending}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Parar de receber, sem sair da linha.
 *
 * Duas opções e não uma: silenciar só o ITEM é o que evita que a pessoa desligue
 * uma família inteira por causa de um caso chato — que é como se perde um alerta
 * que estava funcionando.
 */
function SilenciarMenu({ alerta }: { alerta: AlertItem }) {
  const t = useT()
  const silenciar = useMuteAlert()

  function pedir(input: { kind?: string; alertId?: number }) {
    silenciar.mutate(input, {
      onSuccess: () => toast(t('alerts.mute.done'), 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger asChild>
        <button
          class="p-1 rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
          title={t('alerts.mute.menu')}
          aria-label={t('alerts.mute.menu')}
          disabled={silenciar.isPending}
        >
          <BellOff size={14} />
        </button>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          class="min-w-[13rem] rounded-lg border border-border bg-surface-2 shadow-xl p-1"
          style={{ zIndex: 'var(--z-dropdown)' }}
        >
          <DropdownMenu.Item
            class="text-xs px-2 py-1.5 rounded hover:bg-surface-3 cursor-pointer outline-none"
            onSelect={() => pedir({ alertId: alerta.id })}
          >
            {t('alerts.mute.item')}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="text-xs px-2 py-1.5 rounded hover:bg-surface-3 cursor-pointer outline-none"
            onSelect={() => pedir({ kind: alerta.kind })}
          >
            {t('alerts.mute.kind')}
          </DropdownMenu.Item>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

/** "há 3 dias", "há 2h", "agora" — a idade da CONDIÇÃO, não da última checagem. */
function useDesdeQuando(): (iso: string) => string {
  const t = useT()
  return (iso: string) => {
    const ts = new Date(iso).getTime()
    if (!Number.isFinite(ts)) return ''
    const min = Math.floor((Date.now() - ts) / 60_000)
    if (min < 1) return t('alerts.time.now')
    if (min < 60) return t('alerts.time.minutes', { count: min })
    const h = Math.floor(min / 60)
    if (h < 24) return t('alerts.time.hours', { count: h })
    const d = Math.floor(h / 24)
    return d === 1 ? t('alerts.time.day') : t('alerts.time.days', { count: d })
  }
}

function LinhaDeAlerta({ alerta, onNavegar }: { alerta: AlertItem; onNavegar: () => void }) {
  const t = useT()
  const [, navigate] = useLocation()
  const marcarLido = useMarkAlertRead()
  const descartar = useDismissAlert()
  const desdeQuando = useDesdeQuando()
  const Icone = ICONE[alerta.severity] ?? AlertTriangle
  const cor = COR[alerta.severity] ?? COR.warning
  const naoLido = !alerta.readAt
  const rotuloSeveridade =
    alerta.severity === 'critical' ? t('alerts.severity.critical')
    : alerta.severity === 'info' ? t('alerts.severity.info')
    : t('alerts.severity.warning')

  function abrir() {
    if (!alerta.link) return
    // Abrir o item é tomar conhecimento: marcar lido aqui evita que a pessoa
    // resolva o problema e o contador continue cobrando.
    if (naoLido) marcarLido.mutate(alerta.id)
    onNavegar()
    navigate(alerta.link)
  }

  return (
    <div
      class={cn(
        'flex gap-3 p-3 border-b border-border last:border-b-0',
        naoLido ? 'bg-surface-1' : 'opacity-70',
      )}
    >
      <Icone size={16} class={cn('mt-0.5 shrink-0', cor)} aria-label={rotuloSeveridade} />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium truncate">{alerta.title}</div>
        {alerta.body && <div class="text-xs text-fg-muted mt-0.5 line-clamp-2">{alerta.body}</div>}
        <div class="text-3xs text-fg-muted mt-1">
          {/* A idade da condição é o que dá urgência: "atrasada há 14 dias" pesa
              diferente de "atrasada agora". */}
          {desdeQuando(alerta.firstSeenAt)}
          {alerta.occurrences > 1 && ` · ${t('alerts.checked', { count: alerta.occurrences })}`}
        </div>
        <AcoesDoAlerta alerta={alerta} />
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <SilenciarMenu alerta={alerta} />
        {alerta.link && (
          <button
            class="p-1 rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
            title={t('alerts.open')}
            aria-label={t('alerts.open')}
            onClick={abrir}
          >
            <ExternalLink size={14} />
          </button>
        )}
        {naoLido && (
          <button
            class="p-1 rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
            title={t('alerts.markRead')}
            aria-label={t('alerts.markRead')}
            onClick={() => marcarLido.mutate(alerta.id)}
            disabled={marcarLido.isPending}
          >
            <Check size={14} />
          </button>
        )}
        <button
          class="p-1 rounded text-fg-muted hover:bg-surface-3 hover:text-fg"
          title={t('alerts.dismiss')}
          aria-label={t('alerts.dismiss')}
          onClick={() => descartar.mutate(alerta.id)}
          disabled={descartar.isPending}
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  )
}
