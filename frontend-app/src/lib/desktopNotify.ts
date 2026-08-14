/**
 * Aviso na área de trabalho (Notification API).
 *
 * Cobre o buraco que o som não cobre: com o navegador minimizado ou atrás de
 * outra janela, o operador não ouve nem vê a aba piscando. Aqui o sistema
 * operacional mostra o aviso mesmo assim.
 *
 * Sem service worker de propósito — nada de Web Push. Isto só funciona com o
 * painel aberto em alguma aba, que é a situação real de quem está atendendo, e
 * evita chave VAPID, backend de push e um SW para manter.
 */

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export function notificationSupport(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as NotifyPermission
}

/**
 * Pede permissão. Só chame a partir de um gesto do usuário (clique no switch):
 * navegadores ignoram — ou punem — pedidos automáticos no carregamento.
 */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission as NotifyPermission
  try {
    return (await Notification.requestPermission()) as NotifyPermission
  } catch {
    return 'denied'
  }
}

// Uma notificação por conversa: rajada de 5 mensagens do mesmo contato vira um
// aviso que se atualiza, não cinco empilhados. É o que a `tag` faz.
export interface DesktopNotifyInput {
  title: string
  body?: string
  /** Agrupa avisos da mesma origem (ex.: `lead-42`). */
  tag?: string
  /** Rota do painel aberta ao clicar. */
  href?: string
}

export function showDesktopNotification({ title, body, tag, href }: DesktopNotifyInput): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false
  try {
    const n = new Notification(title, {
      body,
      tag,
      // `renotify` sem `tag` é erro em alguns navegadores; com tag, faz o aviso
      // repetido chamar atenção de novo em vez de trocar em silêncio.
      ...(tag ? { renotify: true } : {}),
      icon: '/favicon.ico',
      silent: true, // o som é nosso, senão toca dois
    } as NotificationOptions)
    n.onclick = () => {
      window.focus()
      if (href) {
        // Navegação por history: o app é SPA e um location.href recarregaria
        // tudo, perdendo o estado de quem está no meio de um atendimento.
        window.history.pushState({}, '', href)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
      n.close()
    }
    return true
  } catch {
    return false
  }
}
