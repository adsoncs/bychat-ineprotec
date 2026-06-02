import { test, expect } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Testes do sidebar nos 6 viewports.
 * Esses testes são a barreira que impede a regressão do problema relatado
 * (sidebar quebrando em notebooks 1024–1366px).
 *
 * Premissas:
 *   - <1024px → drawer (oculto por padrão, hamburger abre)
 *   - 1024–1279px → rail (icon-only)
 *   - ≥1280px → expanded (com labels)
 *
 * Nota: a auth do legado é exigida para acessar /app/. Estes testes assumem
 * um token válido injetado via localStorage no setup. Quando o login Preact
 * vier, refatorar para ir direto.
 */

test.describe('sidebar — modo correto por breakpoint', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  test('mobile (375): drawer fechado por padrão, hamburger abre', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width >= 1024, 'só em mobile')
    await page.goto('/app/')
    const sidebar = page.locator('.app-sidebar')
    await expect(sidebar).toHaveCount(0) // drawer só renderiza no portal quando aberto
    await page.getByLabel('Abrir menu').click()
    await expect(page.locator('.app-sidebar[data-mode="drawer"]')).toBeVisible()
  })

  test('laptop (1024-1279): sidebar em modo rail (icon-only)', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1024 || viewport.width >= 1280, 'só em laptop')
    await page.goto('/app/')
    await expect(page.locator('.app-sidebar[data-mode="rail"]')).toBeVisible()
    // labels invisíveis no rail
    await expect(page.locator('.app-sidebar .app-sidebar-item-label').first()).toBeHidden()
  })

  test('desktop (≥1280): sidebar expanded com labels', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, 'só em desktop')
    await page.goto('/app/')
    await expect(page.locator('.app-sidebar[data-mode="expanded"]')).toBeVisible()
    await expect(page.locator('.app-sidebar .app-sidebar-item-label').first()).toBeVisible()
  })
})

test.describe('sidebar — scroll interno', () => {
  test('com 30+ itens, lista rola sem cobrir conteúdo', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1024, 'apenas onde sidebar fica visível')
    await setupAuthenticatedApp(page)
    await page.goto('/app/')
    const nav = page.locator('.app-sidebar-nav')
    await expect(nav).toBeVisible()
    const overflow = await nav.evaluate((el) => getComputedStyle(el).overflowY)
    expect(['auto', 'scroll']).toContain(overflow)
  })
})

test.describe('sidebar — Cmd+K abre paleta', () => {
  test('atalho global abre o command palette', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 768)
    await setupAuthenticatedApp(page)
    await page.goto('/app/')
    // Garantir que o foco está no documento antes de disparar o atalho.
    await page.locator('main').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('ControlOrMeta+K')
    await expect(page.getByPlaceholder('Buscar páginas, ações…')).toBeVisible()
  })
})
