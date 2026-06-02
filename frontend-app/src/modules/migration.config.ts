/**
 * Migration registry — single source of truth da estratégia strangler.
 *
 * Cada entrada declara que uma feature do legado já tem versão no /app/*.
 * Usado pelos dois lados:
 *   - Legado (frontend/modules/migration-config.js, espelho deste): redireciona
 *     /admin#<feature> → /app/<feature> quando o usuário tenta acessar.
 *   - Novo app: detecta o que ainda NÃO migrou para oferecer fallback "Voltar
 *     ao app antigo" no Cmd+K e na sidebar.
 *
 * Após Fase 20 + entregas dos 🔴 críticos (#1-#7), TODAS as 25 features
 * principais têm MVP funcional no /app, incluindo:
 *   - Editor visual de Landing Pages (#1)
 *   - Editor de steps de Workflows (#2)
 *   - OAuth Meta Ads via Facebook JS SDK (#3)
 *   - Cloud API Embedded Signup (#4)
 *   - Mídia + emoji + áudio no chat (#5)
 *   - Logo + custom HEAD/BODY code (#6)
 *   - Editor de campos de Forms (#7)
 *
 * ──────────────────────────────────────────────────────────────────────
 * 📋 PROCEDIMENTO DE CUTOVER (executar quando o usuário aprovar)
 * ──────────────────────────────────────────────────────────────────────
 *
 * Pré-requisitos:
 *   ✓ Smoke manual em todas as 25 telas no /app (golden path + edge cases)
 *   ✓ Testes Playwright (`npm run test:e2e`) verdes nos 6 viewports
 *   ✓ Backup do diretório `/var/www/bychat-beyond/frontend/`
 *   ✓ Janela de manutenção comunicada (downtime ~5 min para mover assets)
 *
 * Passos:
 *   1. Ajustar `vite.config.ts`: trocar `base: '/app/'` por `base: '/'`
 *   2. Mover `frontend-app/dist/*` para o root servido pelo Nginx
 *   3. Ajustar Nginx para servir o /app na raiz e remover o location de /admin
 *   4. Renomear `frontend/` para `frontend-legacy-archive/` (não deletar
 *      imediatamente — manter como referência durante 30 dias)
 *   5. Remover `useAuth.ts` o `window.location.assign('/admin')` no logout/expirado
 *      → trocar por rota interna `/login` no Preact (criar nova LoginPage)
 *   6. Remover este `migrationRegistry` (não é mais necessário)
 *   7. Remover do `Topbar.tsx` o item "Voltar ao app antigo" do menu do usuário
 *
 * Reversão (se algo der errado):
 *   - Restaurar Nginx de antes
 *   - Tudo em `frontend-legacy-archive/` continua intacto
 *   - O backend não muda em nada
 *
 * Mantenha este arquivo e frontend/modules/migration-config.js sincronizados
 * até o cutover acontecer.
 */

export interface MigrationEntry {
  /** id estável (não mudar — ex.: 'leads', 'kanban') */
  id: string
  /** path no app novo (sem o prefixo /app — ex.: '/leads') */
  appPath: string
  /** padrões de rota legacy que devem redirecionar (regex string match em location.pathname + hash) */
  legacyPatterns: string[]
  /** fase em que migrou (auditoria) */
  migratedInPhase: number
}

export const migrationRegistry: MigrationEntry[] = [
  // Fase 3 — Telas básicas
  { id: 'dashboard', appPath: '/dashboard', legacyPatterns: ['#dashboard'], migratedInPhase: 3 },
  { id: 'leads', appPath: '/leads', legacyPatterns: ['#leads'], migratedInPhase: 3 },
  { id: 'kanban', appPath: '/kanban', legacyPatterns: ['#kanban'], migratedInPhase: 3 },
  { id: 'funnels', appPath: '/funnels', legacyPatterns: ['#funnels'], migratedInPhase: 3 },
  { id: 'activities', appPath: '/activities', legacyPatterns: ['#activities'], migratedInPhase: 3 },
  { id: 'tags', appPath: '/tags', legacyPatterns: ['#tags'], migratedInPhase: 3 },
  { id: 'conversations', appPath: '/conversations', legacyPatterns: ['#conversations', '#atendimento'], migratedInPhase: 3 },

  // Fase 20.3 — Captação
  { id: 'forms', appPath: '/forms', legacyPatterns: ['#forms'], migratedInPhase: 20.3 },
  { id: 'chatbots', appPath: '/chatbots', legacyPatterns: ['#chatbots'], migratedInPhase: 20.3 },
  { id: 'templates', appPath: '/templates', legacyPatterns: ['#templates'], migratedInPhase: 20.3 },
  { id: 'pages', appPath: '/pages', legacyPatterns: ['#pages', '#landing-pages'], migratedInPhase: 20.3 },

  // Fase 20.5 — BI & Analytics
  { id: 'tracking', appPath: '/tracking', legacyPatterns: ['#tracking'], migratedInPhase: 20.5 },
  { id: 'sources', appPath: '/sources', legacyPatterns: ['#sources', '#origens'], migratedInPhase: 20.5 },
  { id: 'meta-ads-report', appPath: '/meta-ads-report', legacyPatterns: ['#meta-ads-report', '#roi'], migratedInPhase: 20.5 },
  { id: 'conversions', appPath: '/conversions', legacyPatterns: ['#conversions', '#capi'], migratedInPhase: 20.6 },
  { id: 'links', appPath: '/links', legacyPatterns: ['#links', '#trackable-links'], migratedInPhase: 20.5 },
  { id: 'intelligence', appPath: '/intelligence', legacyPatterns: ['#intelligence', '#inteligencia'], migratedInPhase: 20.5 },

  // Fase 20.6 — Marketing & Ads (após #3 e #4)
  { id: 'meta-ads', appPath: '/meta-ads', legacyPatterns: ['#meta-ads', '#meta'], migratedInPhase: 20.6 },
  { id: 'google-ads', appPath: '/google-ads', legacyPatterns: ['#google-ads'], migratedInPhase: 20.6 },
  { id: 'sales-ai', appPath: '/sales-ai', legacyPatterns: ['#sales-ai', '#vendas-ai'], migratedInPhase: 20.6 },

  // Fase 20.7 — Automação (após #2)
  { id: 'jobs', appPath: '/jobs', legacyPatterns: ['#jobs', '#queues', '#filas'], migratedInPhase: 20.7 },
  { id: 'workflows', appPath: '/workflows', legacyPatterns: ['#workflows'], migratedInPhase: 20.7 },

  // Fase 20.8 — Canais (após #4 e #5)
  { id: 'whatsapp', appPath: '/whatsapp', legacyPatterns: ['#whatsapp'], migratedInPhase: 20.8 },
  { id: 'cloud-api', appPath: '/cloud-api', legacyPatterns: ['#cloud-api', '#whatsapp-cloud'], migratedInPhase: 20.8 },

  // Fase 20.9 — Configurações (após #6)
  { id: 'settings', appPath: '/settings', legacyPatterns: ['#settings', '#configuracoes', '#aparencia', '#appearance'], migratedInPhase: 20.9 },

  // Fase 20.10 — Placeholders honestos (#21) — backend ainda em construção
  { id: 'telegram', appPath: '/telegram', legacyPatterns: ['#telegram'], migratedInPhase: 20.10 },
  { id: 'instagram', appPath: '/instagram', legacyPatterns: ['#instagram'], migratedInPhase: 20.10 },
  { id: 'integrations', appPath: '/integrations', legacyPatterns: ['#integrations', '#integracoes'], migratedInPhase: 20.10 },
]

export function isMigrated(featureId: string): boolean {
  return migrationRegistry.some((m) => m.id === featureId)
}

export function findMigrationByLegacyPath(pathOrHash: string): MigrationEntry | undefined {
  return migrationRegistry.find((m) =>
    m.legacyPatterns.some((p) => pathOrHash.includes(p)),
  )
}
