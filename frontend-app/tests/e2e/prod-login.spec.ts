import { test, expect } from '@playwright/test'

/**
 * Validação contra PRODUÇÃO REAL (sem mock). Confirma que:
 *   - LoginPage carrega
 *   - Submit com credenciais inválidas mostra mensagem ESPECÍFICA do novo bundle
 *     ("Email ou senha incorretos" — não a genérica do bundle antigo)
 *   - URL não vira /app/app/login (loop do bug antigo)
 */

test.use({ baseURL: 'https://bychat.ia.br' })

test('prod: LoginPage carrega', async ({ page }) => {
  await page.goto('/app/login')
  await expect(page.getByRole('heading', { name: /Entrar/i })).toBeVisible({ timeout: 10_000 })
  // novo bundle mostra rótulo "Senha" — versão antiga não tinha
  await expect(page.getByLabel(/Senha/i)).toBeVisible()
})

test('prod: credenciais inválidas → mensagem específica do novo bundle', async ({ page }) => {
  await page.goto('/app/login')
  // Email único pra evitar bater no rate limit por email
  const uniqueEmail = `test-${Date.now()}@invalid.example`
  await page.getByLabel(/Email/i).fill(uniqueEmail)
  await page.getByLabel(/Senha/i).fill('senha-errada-de-teste')
  await page.getByRole('button', { name: /Entrar/i }).click()

  // Aguarda erro aparecer
  const errorBox = page.getByRole('alert')
  await expect(errorBox).toBeVisible({ timeout: 10_000 })
  const text = await errorBox.textContent()
  // eslint-disable-next-line no-console -- diagnóstico de teste prod
  console.log('Mensagem de erro mostrada:', text)

  // O novo bundle mostra UMA destas mensagens dependendo do status:
  //  - 401: "Email ou senha incorretos."
  //  - 429/503 (rate limit): "Muitas tentativas..."
  expect(text).toMatch(/Email ou senha incorretos|Muitas tentativas/)
})

test('prod: URL não vira /app/app/login (regressão do bug do next)', async ({ page }) => {
  await page.goto('/app/login')
  // Após o load, AuthGate roda. Se houvesse bug, URL viraria /app/login?next=/app/login
  await page.waitForTimeout(2000)
  expect(page.url()).not.toContain('next=%2Fapp')
  expect(page.url()).not.toContain('/app/app/')
})
