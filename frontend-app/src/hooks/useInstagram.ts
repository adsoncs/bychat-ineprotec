import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface InstagramConnectionStatus {
  connected: boolean
  /** 'instagram_business_login' = fluxo novo (Login API for Business);
   *  'facebook_login' = fluxo antigo via Pages. */
  flow?: 'instagram_business_login' | 'facebook_login'
  pageId?: string
  pageName?: string
  igUserId?: string
  igUsername?: string
  igName?: string | null
  accountType?: string | null
  profilePictureUrl?: string | null
  active?: boolean
  connectedAt?: string
  /** Unix ms; 0/null = nunca expira (System User token). */
  tokenExpiresAt?: number | null
  tokenType?: string | null
  scopes?: string[]
}

export function useInstagramConnection() {
  return useQuery({
    queryKey: ['instagram-connection'],
    queryFn: () => api.get<InstagramConnectionStatus>('/instagram/connection'),
    staleTime: 60_000,
  })
}

export interface InstagramWebhookInfo {
  webhookUrl: string
  verifyToken: string
}

export function useInstagramWebhookInfo() {
  return useQuery({
    queryKey: ['instagram-webhook-info'],
    queryFn: () => api.get<InstagramWebhookInfo>('/instagram/webhook-info'),
    staleTime: 5 * 60_000,
  })
}

export function useConnectInstagram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { pageAccessToken: string; pageId: string }) =>
      api.post<{ ok: true; pageName: string; igUsername: string }>('/instagram/connect', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-connection'] }),
  })
}

export function useDisconnectInstagram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/instagram/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-connection'] }),
  })
}

export interface InstagramOAuthConfig {
  appId: string | null
  hasSecret: boolean
  redirectUri: string
  isConfigured: boolean
  deauthorizeUrl: string
  dataDeletionUrl: string
}

export function useInstagramOAuthConfig() {
  return useQuery({
    queryKey: ['instagram-oauth-config'],
    queryFn: () => api.get<InstagramOAuthConfig>('/instagram/oauth-config'),
    staleTime: 60_000,
  })
}

export function useSaveInstagramOAuthConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { appId: string; appSecret?: string | undefined; redirectUri: string }) =>
      api.post<{ ok: true }>('/instagram/oauth-config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-oauth-config'] }),
  })
}

/** Pede ao backend a URL de consent do IG (com state CSRF) e devolve. */
export function useInstagramOAuthStartUrl() {
  return useMutation({
    mutationFn: () => api.get<{ url: string }>('/oauth/instagram/start'),
  })
}

/** Desconecta a conexão v2 (fluxo Instagram Business Login). */
export function useDisconnectInstagramBusinessLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/oauth/instagram/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-connection'] }),
  })
}

export function useInstagramSendTest() {
  return useMutation({
    mutationFn: (input: { recipientId: string; text?: string }) =>
      api.post<{ ok: true; messageId: string }>('/instagram/send-test', input),
  })
}

export interface InstagramConfig {
  appId: string | null
  configId: string | null
}

export function useInstagramConfig() {
  return useQuery({
    queryKey: ['instagram-config'],
    queryFn: () => api.get<InstagramConfig>('/instagram/config'),
    staleTime: 5 * 60_000,
  })
}

export interface InstagramSignupPage {
  pageId: string
  pageName: string
  igUsername: string
  igUserId: string
}

export type InstagramSignupResponse =
  | {
      ok: true
      needsPageSelection: true
      accessToken: string
      pages: InstagramSignupPage[]
    }
  | {
      ok: true
      connected: true
      pageName: string
      igUsername: string
      tokenExpiresAt: number
    }

export function useInstagramEmbeddedSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { code?: string; accessToken?: string; pageId?: string }) =>
      api.post<InstagramSignupResponse>('/instagram/embedded-signup', input),
    onSuccess: (resp) => {
      if ('connected' in resp) void qc.invalidateQueries({ queryKey: ['instagram-connection'] })
    },
  })
}

export interface InstagramRecipient {
  leadId: number
  name: string
  igsid: string
  updatedAt: string
}

export function useInstagramRecentRecipients(enabled: boolean) {
  return useQuery({
    queryKey: ['instagram-recent-recipients'],
    queryFn: () => api.get<{ recipients: InstagramRecipient[] }>('/instagram/recent-recipients'),
    enabled,
    staleTime: 30_000,
  })
}
