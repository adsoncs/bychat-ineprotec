import { test, expect } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Smoke tests: ao menos cada rota principal deve renderizar sem crash
 * com um backend mockado. Os asserts usam o título/heading da Page para
 * provar que o lazy chunk carregou e o conteúdo apareceu.
 */

test.describe('smoke — rotas migradas', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  test('dashboard carrega', async ({ page }) => {
    await page.goto('/app/dashboard')
    await expect(page.getByRole('heading', { name: /Dashboard/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  test('leads carrega', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'leads precisa de espaço para tabela')
    await page.goto('/app/leads')
    await expect(page.getByRole('heading', { name: /Leads/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  test('conversations carrega', async ({ page }) => {
    await page.goto('/app/conversations')
    await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  test('settings carrega', async ({ page }) => {
    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { name: /Configurações/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  test('forms carrega', async ({ page }) => {
    await page.goto('/app/forms')
    await expect(page.getByRole('heading', { name: /Formulários/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  test('workflows carrega', async ({ page }) => {
    await page.goto('/app/workflows')
    await expect(page.getByRole('heading', { name: /Workflows/i, level: 1 })).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('a11y — skip link e aria-current', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  test('skip link aparece ao tabular do início', async ({ page }) => {
    await page.goto('/app/dashboard')
    await page.keyboard.press('Tab')
    const skip = page.locator('.skip-link')
    await expect(skip).toBeFocused()
  })

  test('item ativo do sidebar tem aria-current=page', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 1024, 'sidebar visível só ≥1024')
    await page.goto('/app/leads')
    const active = page.locator('.app-sidebar-item[aria-current="page"]')
    await expect(active).toHaveCount(1)
  })
})

test.describe('tema — toggle alterna data-theme', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  test('escolher tema claro define data-theme=light', async ({ page }) => {
    await page.goto('/app/dashboard')
    await page.getByRole('button', { name: /Tema|Theme|Tema/ }).first().click()
    await page.getByRole('menuitem', { name: /Claro|Light/i }).click()
    await expect(page.locator('html[data-theme="light"]')).toHaveCount(1)
  })

  test('escolher tema escuro remove data-theme', async ({ page }) => {
    await page.goto('/app/dashboard')
    // 1º muda para light, 2º volta para dark
    await page.getByRole('button', { name: /Tema|Theme/ }).first().click()
    await page.getByRole('menuitem', { name: /Claro|Light/i }).click()
    await page.getByRole('button', { name: /Tema|Theme/ }).first().click()
    await page.getByRole('menuitem', { name: /Escuro|Dark/i }).click()
    await expect(page.locator('html[data-theme="light"]')).toHaveCount(0)
  })
})
