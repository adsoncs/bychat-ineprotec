// Avisos da Equipe (chat interno): som, notificação do navegador e um aviso
// discreto na tela — SÓ para conversa direta e @menção, nunca em conversa
// silenciada, e sem som para quem está ocupado/ausente/offline (o contador do
// ícone continua). Quem já está com aquela conversa aberta na frente não é
// avisado. Usa as preferências de som/notificação que a pessoa já tem.
import { useEffect, useRef } from 'preact/hooks'
import { onServerEvent } from '@/lib/realtime'
import { playNotificationSound } from '@/lib/notificationSound'
import { showDesktopNotification } from '@/lib/desktopNotify'
import { useAccountPrefs } from '@/hooks/useAccountPrefs'
import { useUserStore } from '@/stores/user'
import { useEquipeStore } from '@/stores/equipe'
import { toast } from '@/lib/toast'

export function useAvisosDaEquipe(ligado: boolean) {
  const { prefs } = useAccountPrefs()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    if (!ligado) return
    return onServerEvent((ev) => {
      if (ev.type !== 'equipe:mensagem') return
      const p = (ev.payload ?? {}) as Record<string, any>
      if (p.silenciada) return
      if (!p.direta && !p.mencionado) return

      const painel = useEquipeStore.getState()
      const naFrente = !document.hidden
      const naPagina = /\/chat-interno(\/|$)/.test(window.location.pathname)
      if (naFrente && (painel.aberto || naPagina) && painel.tela === 'conversa' && painel.conversaId === p.conversaId) return

      const status = useUserStore.getState().user?.workStatus ?? 'available'
      const disponivel = status === 'available'
      const titulo = p.direta ? `💬 ${p.autor || 'Equipe'}` : `💬 ${p.autor || 'Alguém'} mencionou você${p.conversaNome ? ` em ${p.conversaNome}` : ''}`
      const { notifySound, notifyDesktop, notifyPreview, notifyVolume, notifySoundId } = prefsRef.current as any

      if (disponivel && notifySound !== false) playNotificationSound(notifySoundId, notifyVolume)
      if (document.hidden) {
        if (disponivel && notifyDesktop) {
          showDesktopNotification({
            title: titulo,
            body: notifyPreview !== false ? String(p.previa ?? '') : undefined,
            tag: `equipe-${p.conversaId}`,
            href: `/app/chat-interno?c=${p.conversaId}`,
          })
        }
      } else if (!painel.aberto && !naPagina) {
        toast(`${titulo}${p.previa ? `: ${String(p.previa).slice(0, 80)}` : ''}`, 'info', 4500)
      }
    })
  }, [ligado])
}
