/* eslint-disable no-console -- arquivo de debug, console.log é o output */
import { test, expect } from '@playwright/test'

/**
 * Debug do fluxo de login completo, capturando:
 *   - errors de console
 *   - 4xx/5xx no network
 *   - estado do localStorage antes e depois
 *   - URL final após submit
 *
 * Usa backend MOCKADO para isolar problemas do frontend.
 */
test('login flow ponta-a-ponta (mockado): salva token e redireciona', async ({ page }) => {
  const consoleErrors: string[] = []
  const allRequests: { url: string; status: number; auth: string | undefined }[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`)
    }
  })
  page.on('response', (resp) => {
    const url = resp.url()
    if (!url.includes('/api/')) return
    const auth = resp.request().headers().authorization
    allRequests.push({ url: url.replace(/^.*\/api/, '/api'), status: resp.status(), auth })
  })

  // ⚠️ Em Playwright, route handlers registrados DEPOIS têm PRIORIDADE.
  // Fallback genérico tem que ser registrado PRIMEIRO; rotas específicas DEPOIS.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.route('**/api/admin/me', async (route) => {
    const auth = route.request().headers().authorization
    if (auth === 'Bearer FAKE_TOKEN_TEST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 1, email: 'test@test.com', name: 'Test', role: 'admin' } }),
      })
    } else {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauth"}' })
    }
  })

  await page.route('**/api/admin/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'FAKE_TOKEN_TEST',
        user: { id: 1, email: 'test@test.com', name: 'Test', role: 'admin' },
      }),
    })
  })

  // Instrumenta a página: rastreia setItem/removeItem em bh_token
  await page.addInitScript(() => {
    const orig = { set: localStorage.setItem.bind(localStorage), rm: localStorage.removeItem.bind(localStorage) }
    ;(window as unknown as { __tokenLog: string[] }).__tokenLog = []
    localStorage.setItem = function (k: string, v: string) {
      if (k === 'bh_token') {
        ;(window as unknown as { __tokenLog: string[] }).__tokenLog.push(`SET bh_token=${v.slice(0, 20)}... at ${location.pathname}`)
      }
      return orig.set(k, v)
    }
    localStorage.removeItem = function (k: string) {
      if (k === 'bh_token') {
        ;(window as unknown as { __tokenLog: string[] }).__tokenLog.push(`REMOVE bh_token at ${location.pathname}`)
      }
      return orig.rm(k)
    }
    window.addEventListener('bh:auth:expired', () => {
      ;(window as unknown as { __tokenLog: string[] }).__tokenLog.push(`EVENT bh:auth:expired at ${location.pathname}`)
    })
  })

  // 1. Vai pra /app/ sem token → deve mostrar LoginPage
  await page.goto('/app/')

  // Confirma que LoginPage apareceu
  await expect(page.getByRole('heading', { name: /Entrar/i })).toBeVisible({ timeout: 10_000 })

  // 2. localStorage começa vazio
  const tokenBefore = await page.evaluate(() => localStorage.getItem('bh_token'))
  expect(tokenBefore).toBeNull()

  // 3. Preenche e submete
  await page.getByLabel(/Email/i).fill('test@test.com')
  await page.getByLabel(/Senha/i).fill('senha-correta')
  await page.getByRole('button', { name: /Entrar/i }).click()

  // 4. Pequena espera pra fluxo estabilizar
  await page.waitForTimeout(3000)

  // 5. Token e log
  const tokenAfter = await page.evaluate(() => localStorage.getItem('bh_token'))
  const tokenLog = await page.evaluate(() => (window as unknown as { __tokenLog?: string[] }).__tokenLog ?? [])
  console.log('\n=== TOKEN LIFECYCLE ===')
  tokenLog.forEach((l) => console.log(' -', l))
  console.log('Final URL:', page.url())
  console.log('Token final:', tokenAfter)

  expect(tokenAfter).toBe('FAKE_TOKEN_TEST')
  expect(page.url()).not.toContain('/app/login')

  // Diagnostics
  if (consoleErrors.length > 0) {
    console.log('\n=== CONSOLE ERRORS/WARNINGS ===')
    consoleErrors.forEach((e) => console.log(' -', e))
  }
  console.log('\n=== ALL API REQUESTS ===')
  allRequests.forEach((r) =>
    console.log(` - ${r.status} ${r.url}  ${r.auth ? '[Bearer ' + r.auth.slice(7, 20) + '...]' : '[no-auth]'}`),
  )
})

test('login com next= preservado redireciona para o destino', async ({ page }) => {
  // Catch-all PRIMEIRO; específicos depois (ordem importa em Playwright).
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  // /me só autentica com token correto — caso contrário 401, evita o
  // AuthGate considerar logado e pular o LoginPage no carregamento inicial.
  await page.route('**/api/admin/me', async (route) => {
    const auth = route.request().headers().authorization
    if (auth === 'Bearer FAKE_TOKEN_TEST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 1, email: 'a@b.c', name: 'X', role: 'admin' } }),
      })
    } else {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauth"}' })
    }
  })
  await page.route('**/api/admin/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'FAKE_TOKEN_TEST',
        user: { id: 1, email: 'a@b.c', name: 'X', role: 'admin' },
      }),
    })
  })

  await page.goto('/app/login?next=/leads')
  await page.getByLabel(/Email/i).fill('a@b.c')
  await page.getByLabel(/Senha/i).fill('x')
  await page.getByRole('button', { name: /Entrar/i }).click()

  await page.waitForURL(/\/app\/leads/, { timeout: 15_000 })
  expect(page.url()).toMatch(/\/app\/leads$/)
})
