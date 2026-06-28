/**
 * Configuração de ambiente — single source para URLs de API.
 *
 * Em dev: Vite proxy redireciona /api para o backend Fastify (porta 3005).
 * Em produção: backend serve o app, então /api é mesmo origin.
 */
export const env = {
  apiBase: '/api',
  /** chave do localStorage onde o legado já guarda o token JWT */
  authTokenKey: 'bh_token',
  /** prefixo da rota do app novo no backend */
  appBasePath: '/app',
  /**
   * Chamadas de voz WhatsApp (WebRTC). DESLIGADO por padrão — só exibe a UI
   * (botão "Ligar") depois que a Calling API for habilitada na Meta + backend
   * reiniciado. Habilitar com VITE_WA_CALLING=true no .env do frontend-app.
   */
  waCalling: (import.meta.env as Record<string, string | undefined>).VITE_WA_CALLING === 'true',
} as const
