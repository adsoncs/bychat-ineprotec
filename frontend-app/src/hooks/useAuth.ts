import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'preact/hooks'
import { api, apiRequest, setToken } from '@/lib/apiClient'
import { startTokenWatcher, stopTokenWatcher } from '@/lib/tokenWatcher'
import { useUserStore, type CurrentUser, type WorkStatus } from '@/stores/user'

export interface UpdateProfileInput {
  name?: string
  email?: string
  currentPassword?: string
  password?: string
}

// Backend retorna o user direto (id, email, name, role, ...). Versões antigas
// do contrato envelopavam em { user }, então aceitamos ambos por segurança.
type MeResponse = CurrentUser | { user: CurrentUser }

export function useAuth() {
  const user = useUserStore((s) => s.user)
  const setUser = useUserStore((s) => s.setUser)
  const clearUser = useUserStore((s) => s.clear)
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await api.get<MeResponse>('/admin/me')
      return 'user' in res && res.user ? res.user : (res as CurrentUser)
    },
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (query.data) setUser(query.data)
  }, [query.data, setUser])

  useEffect(() => {
    startTokenWatcher()
    return () => {
      // Não paramos no unmount — o hook é montado em qualquer rota autenticada
      // e queremos o watcher ativo enquanto o app estiver vivo.
    }
  }, [])

  useEffect(() => {
    function onExpired() {
      setToken(null)
      clearUser()
      stopTokenWatcher()
      // Zera o cache do React Query para que `query.data` não mantenha o usuário
      // "logado" no AuthGate enquanto a sessão já expirou no servidor.
      qc.setQueryData(['auth', 'me'], null)
      qc.clear()
      const pathname = window.location.pathname
      if (pathname !== '/app/login') {
        const relative = pathname.startsWith('/app') ? pathname.slice(4) || '/' : pathname
        const next = relative && relative !== '/' ? `?next=${encodeURIComponent(relative)}` : ''
        window.location.assign(`/app/login${next}`)
      }
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== 'bh_token') return
      if (e.newValue === null) {
        clearUser()
        qc.setQueryData(['auth', 'me'], null)
        qc.clear()
        window.location.assign('/app/login')
      }
    }
    window.addEventListener('bh:auth:expired', onExpired)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('bh:auth:expired', onExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [clearUser, qc])

  // O store é atualizado num useEffect (após o render que recebe query.data),
  // então existe um frame onde a query terminou mas user ainda é null.
  // Considerar query.data evita um redirect espúrio para /admin nesse intervalo.
  const resolvedUser = user ?? query.data ?? null

  return {
    user: resolvedUser,
    isLoading: query.isLoading,
    isAuthenticated: !!resolvedUser,
    error: query.error,
    refetch: query.refetch,
    logout: async () => {
      // Revoga refresh + JWT no servidor. skipAuthExpired pra não disparar
      // o handler de expired (que faz a mesma limpeza local).
      try {
        await apiRequest('/admin/logout', { method: 'POST', skipAuthExpired: true })
      } catch {
        // se falhar (offline, etc) seguimos com a limpeza local mesmo assim
      }
      setToken(null)
      clearUser()
      stopTokenWatcher()
      window.location.assign('/app/login')
    },
  }
}

// Atualiza o status de trabalho do operador (available/away/busy/offline).
// Refresha a query 'auth/me' pra que outros componentes que dependem do
// status (badge no avatar, listagens) refletem imediatamente.
export function useUpdateWorkStatus() {
  const qc = useQueryClient()
  const setUser = useUserStore((s) => s.setUser)
  const user = useUserStore((s) => s.user)
  return useMutation({
    mutationFn: (status: WorkStatus) =>
      api.put<{ ok: true; workStatus: WorkStatus; workStatusUpdatedAt: string | null }>(
        '/admin/me/work-status',
        { status },
      ),
    onSuccess: (data) => {
      if (user) setUser({ ...user, workStatus: data.workStatus, workStatusUpdatedAt: data.workStatusUpdatedAt })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

// Atualiza nome/email/senha do usuário logado. Usa `skipAuthExpired` porque
// 401 aqui = "Senha atual incorreta" (não sessão expirada).
export function useUpdateProfile() {
  const qc = useQueryClient()
  const setUser = useUserStore((s) => s.setUser)
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiRequest<CurrentUser>('/admin/me', {
        method: 'PUT',
        body: input,
        skipAuthExpired: true,
      }),
    onSuccess: (data) => {
      setUser(data)
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
