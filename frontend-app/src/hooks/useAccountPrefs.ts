import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useUserStore } from '@/stores/user'
import { DEFAULT_SOUND_ID, type SoundId } from '@/lib/notificationSound'

/**
 * Preferências pessoais da conta — guardadas no usuário, não no navegador.
 *
 * Antes o único controle era `bh_atd_notif` no localStorage: quem silenciava o
 * som numa máquina voltava a ouvi-lo na outra, e a preferência sumia ao limpar
 * o navegador. Aqui a escolha acompanha a pessoa.
 *
 * O localStorage continua servindo de espelho para o primeiro render — a
 * resposta do servidor chega alguns ms depois do app montar, e sem o espelho o
 * som poderia tocar uma vez para quem o desligou.
 */

export type NotifyVolume = 'low' | 'medium' | 'high'
export type { SoundId } from '@/lib/notificationSound'
/** 'always' = som mesmo com o painel na frente · 'away' = só com a aba fora de foco. */
export type NotifyWhen = 'always' | 'away'
/** 'incoming' = som só quando chega · 'both' = também ao enviar. */
export type NotifyEvents = 'incoming' | 'both'
export type SidebarModePref = 'auto' | 'rail' | 'expanded'

export interface AccountPrefs {
  /** Bipe ao chegar mensagem. */
  notifySound: boolean
  /** Timbre do aviso — catálogo em lib/notificationSound.ts. */
  notifySoundId: SoundId
  notifyVolume: NotifyVolume
  notifyWhen: NotifyWhen
  /** Tocar também ao enviar (confirmação), ou só ao receber. */
  notifyEvents: NotifyEvents
  /** Som para mensagem vinda de grupo do WhatsApp. */
  notifyGroups: boolean
  /** Aviso na área de trabalho (exige permissão do navegador). */
  notifyDesktop: boolean
  /** Mostrar trecho da mensagem no aviso. Desligue em tela compartilhada. */
  notifyPreview: boolean
  /** Contador de conversas esperando no menu lateral. */
  showUnreadBadge: boolean
  /** "(N) Nova mensagem!" na aba do navegador. */
  flashTitle: boolean
  /** Menu lateral: automático pelo tamanho da tela, ou fixo. */
  sidebarMode: SidebarModePref
}

export const DEFAULT_ACCOUNT_PREFS: AccountPrefs = {
  notifySound: true,
  notifySoundId: DEFAULT_SOUND_ID,
  notifyVolume: 'medium',
  notifyWhen: 'always',
  notifyEvents: 'incoming',
  notifyGroups: true,
  notifyDesktop: false, // exige permissão: só liga quando a pessoa pede
  notifyPreview: true,
  showUnreadBadge: true,
  flashTitle: true,
  sidebarMode: 'auto',
}

const MIRROR_KEY = 'bh:account-prefs'
/** Chave do controle antigo, só de som, por navegador. */
const LEGACY_SOUND_KEY = 'bh_atd_notif'

export function readMirror(): AccountPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_ACCOUNT_PREFS
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (raw) return { ...DEFAULT_ACCOUNT_PREFS, ...(JSON.parse(raw) as Partial<AccountPrefs>) }
    // Migração das escolhas que viviam por navegador, para quem já usava:
    // o som silenciado e o modo do menu lateral.
    const migrado: Partial<AccountPrefs> = {}
    const legacySound = localStorage.getItem(LEGACY_SOUND_KEY)
    if (legacySound !== null) migrado.notifySound = legacySound !== '0'
    try {
      const rawSidebar = localStorage.getItem('bh:sidebar')
      const mode = rawSidebar ? JSON.parse(rawSidebar)?.state?.mode : null
      if (mode === 'rail' || mode === 'expanded' || mode === 'auto') migrado.sidebarMode = mode
    } catch { /* json inválido no storage */ }
    if (Object.keys(migrado).length) return { ...DEFAULT_ACCOUNT_PREFS, ...migrado }
  } catch { /* modo privado */ }
  return DEFAULT_ACCOUNT_PREFS
}

function writeMirror(prefs: AccountPrefs): void {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(prefs)) } catch { /* modo privado */ }
}

interface PrefsResponse { preferences: Partial<AccountPrefs> }

export function useAccountPrefs() {
  const qc = useQueryClient()
  const userId = useUserStore((s) => s.user?.id ?? null)

  const query = useQuery({
    queryKey: ['me-preferences', userId],
    queryFn: async () => {
      const r = await api.get<PrefsResponse>('/admin/me/preferences')
      // O espelho entra ANTES da resposta na ordem de mesclagem: o servidor só
      // guarda o que a pessoa mudou, então uma chave ausente lá significa "não
      // decidiu", não "quer o padrão". Sem isto, a escolha migrada do navegador
      // (menu recolhido, som silenciado) era desfeita no primeiro carregamento.
      const merged = { ...DEFAULT_ACCOUNT_PREFS, ...readMirror(), ...(r.preferences ?? {}) }
      writeMirror(merged)
      return merged
    },
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  })

  const mutation = useMutation({
    mutationFn: async (patch: Partial<AccountPrefs>): Promise<AccountPrefs> => {
      const next = { ...(query.data ?? readMirror()), ...patch }
      // Espelho ANTES da resposta: o efeito do toggle é imediato para quem
      // clicou, e o servidor confirma em seguida.
      writeMirror(next)
      qc.setQueryData(['me-preferences', userId], next)
      const r = await api.put<PrefsResponse>('/admin/me/preferences', { preferences: patch })
      // A resposta é mesclada SOBRE o que acabou de ser escolhido, nunca no
      // lugar dele: uma resposta parcial (ou vazia) reverteria a escolha que o
      // usuário viu acontecer na tela.
      return { ...next, ...(r.preferences ?? {}) }
    },
    onSuccess: (server) => {
      writeMirror(server)
      qc.setQueryData(['me-preferences', userId], server)
    },
  })

  return {
    prefs: query.data ?? readMirror(),
    isLoading: query.isLoading,
    /** true quando a resposta do servidor já chegou. Quem age uma única vez a
     *  partir da preferência (o shell aplica o modo do menu assim) precisa
     *  esperar por isto: antes disso o valor é só o espelho local, e numa
     *  máquina nova ele é o padrão — o que apagaria a escolha da conta. */
    loaded: query.isSuccess,
    setPref: (patch: Partial<AccountPrefs>) => mutation.mutate(patch),
  }
}
