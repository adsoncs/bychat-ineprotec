import { useEffect, useRef } from 'preact/hooks'
import { onServerEvent } from '@/lib/realtime'
import { playNotificationSound } from '@/lib/notificationSound'
import { showDesktopNotification } from '@/lib/desktopNotify'
import { useAccountPrefs } from '@/hooks/useAccountPrefs'
import { useActiveConversationStore } from '@/stores/activeConversation'

/**
 * Aviso de mensagem nova — vale em QUALQUER tela do painel.
 *
 * Antes isto vivia dentro da tela de Conversas e só disparava quando um
 * atendimento NOVO entrava na lista, com a aba em segundo plano. Quem estava em
 * Leads, no Kanban ou num relatório não era avisado de nada, e resposta em
 * conversa já aberta — o caso mais comum do dia — passava em silêncio.
 *
 * Regra de quando avisar, em ordem:
 *   - aba oculta                          → som + aviso na área de trabalho
 *   - aba visível, outra conversa/tela    → só som (a menos que a pessoa peça
 *                                           silêncio enquanto usa o painel)
 *   - aba visível, conversa aberta na tela → nada (a mensagem apareceu na frente)
 *
 * Roda uma vez, no AppShell.
 */
export function useGlobalNotifications(): void {
  const { prefs } = useAccountPrefs()
  // Refs porque o listener do WebSocket é registrado uma vez: sem elas, ele
  // congelaria a preferência do primeiro render e ignoraria o toggle.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const titleRef = useRef<{ original: string; interval: number | null; count: number } | null>(null)

  useEffect(() => {
    function restoreTitle() {
      const ref = titleRef.current
      if (!ref) return
      if (ref.interval) clearInterval(ref.interval)
      document.title = ref.original
      titleRef.current = null
    }

    function flashTitle() {
      if (titleRef.current) {
        titleRef.current.count += 1
        return
      }
      const original = document.title
      const ref = { original, interval: null as number | null, count: 1 }
      titleRef.current = ref
      let toggle = false
      ref.interval = window.setInterval(() => {
        document.title = toggle ? original : `(${ref.count}) Nova mensagem!`
        toggle = !toggle
      }, 1000)
    }

    const offEvent = onServerEvent((ev) => {
      if (ev.type !== 'message:received') return
      const p = (ev.payload ?? {}) as Record<string, unknown>
      // Coexistência: mensagem que o próprio operador mandou pelo celular chega
      // como "recebida" no webhook. Avisar seria avisar a pessoa dela mesma.
      if (p.fromPhone === true) return

      // Grupo do WhatsApp: costuma ter muito mais volume que conversa 1:1, e
      // quem atende o grupo raramente precisa de um bipe por mensagem.
      const ehGrupo = p.channel === 'whatsapp_group' || p.isGroup === true
      if (ehGrupo && !prefsRef.current.notifyGroups) return

      const leadId = typeof p.leadId === 'number' ? p.leadId : null
      const aberta = useActiveConversationStore.getState().leadId
      const naFrente = !document.hidden
      if (naFrente && leadId !== null && leadId === aberta) return

      const { notifySound, notifyDesktop, notifyPreview, notifyVolume, notifySoundId, notifyWhen, flashTitle: piscar } = prefsRef.current
      // 'away': quem está com o painel na frente não quer bipe a cada mensagem
      // de outra conversa — vê o contador no menu e basta.
      if (notifySound && (notifyWhen === 'always' || document.hidden)) playNotificationSound(notifySoundId, notifyVolume)

      if (document.hidden) {
        if (piscar) flashTitle()
        if (notifyDesktop) {
          const from = typeof p.from === 'string' && p.from.trim() ? p.from.trim() : 'Contato'
          const preview = notifyPreview && typeof p.preview === 'string' ? p.preview : undefined
          showDesktopNotification({
            title: `Nova mensagem de ${from}`,
            body: preview,
            tag: leadId !== null ? `lead-${leadId}` : undefined,
            href: '/app/atendimento',
          })
        }
      }
    })

    const onVisible = () => { if (!document.hidden) restoreTitle() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      offEvent()
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      restoreTitle()
    }
  }, [])
}
