// src/lib/capacidadesRotas.ts
//
// Papéis e Permissões — o que cada rota exige, para as rotas que o registro de
// módulos e as telas do Educacional NÃO cobrem (grupo C do inventário de
// 21/10/2026). As demais saem sozinhas de `getModuleForRoute` + `telaDaRota`.
//
// Destinos:
//   'conta'    — o próprio usuário logado (perfil, 2FA, preferências, sair,
//                tela inicial, catálogos que outras telas usam em seletores).
//   'sistema'  — só Superadmin ou o dono do produto (auditoria geral,
//                assinatura do produto, inventário de rotas).
//   capacidade — `<recurso>.<ação>` do catálogo (lib/capacidades.ts).
//
// A primeira linha que casa vence. Rota autenticada sem módulo, sem tela e sem
// linha aqui = lacuna: o inventário reprova (meta da fase 0 = zero).

export type ExigenciaRota = 'conta' | 'sistema' | string

const EDITA = 'POST,PUT,PATCH,DELETE'

export const EXIGENCIAS_SEM_MODULO: Array<[RegExp, string, ExigenciaRota]> = [
  // Conta do próprio usuário
  [/^\/api\/admin\/(me|2fa|logout|heartbeat|my-permissions)(\/|$)/, '*', 'conta'],
  [/^\/api\/home-screen\/(me|my-day|leaderboard)$/, '*', 'conta'],
  [/^\/api\/home-screen\/educacional$/, '*', 'educacional.view'],
  [/^\/api\/admin\/modules$/, 'GET', 'conta'],
  [/^\/api\/admin\/modules\/:id\/usage$/, 'GET', 'settings.view'],
  [/^\/api\/admin\/modules\/:id\/toggle$/, '*', 'settings.edit'],
  [/^\/api\/admin\/aca\/refs$/, 'GET', 'conta'],
  [/^\/api\/db-connectors\/names$/, 'GET', 'conta'],
  [/^\/api\/ws\/stats$/, 'GET', 'conta'],

  // Chamadas de WhatsApp: parte do atendimento
  [/^\/api\/wa-calls\//, '*', 'atendimento.edit'],

  // Empresa, identidade, LGPD
  [/^\/api\/admin\/(company|company-identity|conversation-identity|legal)(\/|$)/, 'GET', 'settings.view'],
  [/^\/api\/admin\/(company|company-identity|conversation-identity|legal)(\/|$)/, EDITA, 'settings.edit'],
  [/^\/api\/admin\/dsar(\/|$)/, 'GET', 'settings.view'],
  [/^\/api\/admin\/dsar(\/|$)/, EDITA, 'settings.edit'],

  // Integrações configuradas por admin
  [/^\/api\/admin\/(kommo|crmedu|sei)(\/|$)/, '*', 'integracoes.configurar'],

  // Papéis e acessos (tela nova) e Permissões (a tela antiga; some na fase 3)
  [/^\/api\/admin\/papeis(\/|$)/, '*', 'papeis.gerenciar'],
  [/^\/api\/admin\/module-permissions$/, '*', 'papeis.gerenciar'],

  // Relatório de funil: leitura de quem vê o painel; configuração é do sistema
  [/^\/api\/admin\/funnel-report$/, 'GET', 'dashboard.view'],
  [/^\/api\/admin\/funnel-report\/config$/, '*', 'sistema'],

  // Só sistema
  [/^\/api\/admin\/(audit-log|_rotas)$/, '*', 'sistema'],
  [/^\/api\/dono\//, '*', 'sistema'],
]

export function exigenciaSemModulo(metodo: string, rota: string): ExigenciaRota | null {
  const m = metodo.toUpperCase()
  for (const [re, metodos, ex] of EXIGENCIAS_SEM_MODULO) {
    if ((metodos === '*' || metodos.split(',').includes(m)) && re.test(rota)) return ex
  }
  return null
}
