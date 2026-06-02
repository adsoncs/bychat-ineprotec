import { test, expect } from '@playwright/test'

test('GET /admin redireciona para /app/dashboard', async ({ page }) => {
  await page.goto('https://bychat.ia.br/admin')
  await page.waitForURL(/\/app\/(dashboard|login)/, { timeout: 10_000 })
  expect(page.url()).toContain('/app/')
})

test('GET /admin#leads redireciona para /app/leads', async ({ page }) => {
  await page.goto('https://bychat.ia.br/admin#leads')
  await page.waitForURL(/\/app\/(leads|login)/, { timeout: 10_000 })
  expect(page.url()).toMatch(/\/app\/(leads|login)/)
})

test('GET / continua servindo landing público', async ({ page }) => {
  await page.goto('https://bychat.ia.br/')
  await expect(page).toHaveTitle(/Diagnóstico Estratégico/i)
})
