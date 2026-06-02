import type { Page, Route } from '@playwright/test'

/**
 * Mocks utilitários para os smoke tests. O backend não roda nos testes E2E
 * — interceptamos as rotas que cada página usa e devolvemos payloads
 * mínimos suficientes para o React Query parar de carregar.
 *
 * Quando uma nova rota for tocada por um teste novo, adicione um mock
 * default aqui em vez de duplicar em cada spec.
 */

type MockValue = unknown
type MockMap = Record<string, MockValue>

const DEFAULT_MOCKS: MockMap = {
  // Backend retorna o user direto (sem envelope { user }). O mock segue o
  // contrato real para evitar reincidência do bug que travava o login.
  '/api/admin/me': { id: 1, name: 'Tester', email: 'tester@example.com', role: 'admin' },
  '/api/admin/settings': { settings: [], grouped: {} },
  '/api/admin/appearance': { appearance: {}, defaults: {} },
  '/api/dashboard': {
    kpis: {
      totalLeads: 0,
      newLeadsToday: 0,
      activeConversations: 0,
      revenueThisMonth: 0,
    },
  },
  '/api/leads': { leads: [], total: 0, limit: 50, offset: 0 },
  '/api/atendimento/tickets': { tickets: [], total: 0, limit: 50, offset: 0 },
  '/api/funnels': { funnels: [] },
  '/api/forms': { forms: [] },
  '/api/admin/workflows': { workflows: [] },
  '/api/pages': { pages: [] },
  '/api/tags': { tags: [] },
  '/api/chatbots': { chatbots: [] },
  '/api/meta/status': { integrations: [], pollerActive: false },
  '/api/cloud-api/connection': { connections: [] },
  '/api/cloud-api/templates': { templates: [] },
  '/api/whatsapp/instances': { instances: [] },
  '/api/teams': { teams: [] },
  '/api/custom-fields': { customFields: [] },
}

/**
 * Instala token de teste + intercepta `/api/**` com mocks.
 * Use no `test.beforeEach`.
 */
export async function setupAuthenticatedApp(page: Page, extra: MockMap = {}): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('bh_token', 'TEST_TOKEN_PLACEHOLDER')
    // Forçar locale pt para os testes — o navegador do Playwright muitas
    // vezes vem com en-US e quebraria os asserts de texto em português.
    localStorage.setItem(
      'bh:locale',
      JSON.stringify({ state: { locale: 'pt' }, version: 0 }),
    )
  })

  const mocks: MockMap = { ...DEFAULT_MOCKS, ...extra }

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    // procura match exato; se não houver, devolve {} 200 para não vazar 404
    let body: unknown = undefined
    if (path in mocks) {
      const v = mocks[path]
      body = typeof v === 'function' ? (v as (r: Route['request']) => unknown)(route.request()) : v
    } else {
      // tenta com prefixo (ex.: /api/forms/123 → /api/forms)
      const fallback = Object.keys(mocks).find((p) => path.startsWith(p))
      if (fallback) {
        const v = mocks[fallback]
        body = typeof v === 'function' ? (v as (r: Route['request']) => unknown)(route.request()) : v
      } else {
        body = {}
      }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}
