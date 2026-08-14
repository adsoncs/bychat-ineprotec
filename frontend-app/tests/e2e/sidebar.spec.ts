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

test.describe('sidebar — recolher/expandir (preferência do usuário)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  test('botão recolhe, o conteúdo acompanha e a escolha sobrevive ao reload', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, 'só em desktop, onde o padrão é expanded')
    await page.goto('/app/')
    const shell = page.locator('.app-shell')
    const main = page.locator('.app-main')
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'expanded')

    // O recuo do conteúdo tem que seguir a barra: era o defeito que deixava uma
    // faixa vazia quando a preferência divergia do breakpoint.
    const offsetExpandido = await main.evaluate((el) => getComputedStyle(el).marginLeft)

    await page.getByLabel('Recolher menu').click()
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'rail')
    await expect(page.locator('.app-sidebar[data-mode="rail"]')).toBeVisible()
    await expect(page.locator('.app-sidebar .app-sidebar-item-label').first()).toBeHidden()
    await expect
      .poll(async () => main.evaluate((el) => getComputedStyle(el).marginLeft))
      .not.toBe(offsetExpandido)

    // Preferência persistida (localStorage bh:sidebar).
    await page.reload()
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'rail')

    // E dá para voltar pelo botão do rodapé, sem depender do atalho.
    await page.getByLabel('Expandir menu').click()
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'expanded')
    await expect
      .poll(async () => main.evaluate((el) => getComputedStyle(el).marginLeft))
      .toBe(offsetExpandido)
  })

  test('Ctrl+B alterna o menu', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, 'só em desktop')
    await page.goto('/app/')
    const shell = page.locator('.app-shell')
    await page.locator('main').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('ControlOrMeta+B')
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'rail')
    await page.keyboard.press('ControlOrMeta+B')
    await expect(shell).toHaveAttribute('data-sidebar-mode', 'expanded')
  })

  test('no mobile a preferência não vale: continua drawer', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width >= 1024, 'só em mobile')
    // Simula quem recolheu o menu no desktop e depois abriu no celular.
    await page.addInitScript(() => {
      localStorage.setItem('bh:sidebar', JSON.stringify({ state: { mode: 'rail' }, version: 0 }))
    })
    await page.goto('/app/')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-mode', 'drawer')
    await expect(page.locator('.app-sidebar')).toHaveCount(0)
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

test.describe('preferências da conta', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
  })

  // O painel "Minhas preferências" abre pelo menu do usuário, e esse dropdown
  // não renderiza itens no E2E (o store de usuário fica vazio com o mock de
  // /api/admin/me). O que dá para garantir aqui é o efeito das preferências:
  // elas chegam do servidor e mandam no shell.
  test('preferência vinda do servidor manda no menu lateral', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, 'só em desktop, onde o padrão é expanded')
    await page.route('**/api/admin/me/preferences', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: { sidebarMode: 'rail' } }) }),
    )
    await page.goto('/app/')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-mode', 'rail')
  })

  test('contador de não lidas aparece no menu e some quando desligado', async ({ page, viewport }) => {
    test.skip(viewport === null || viewport.width < 1280, 'só em desktop, onde o rótulo e o número aparecem')
    await page.route('**/api/atendimento/unread-count', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unread: 7 }) }),
    )
    await page.goto('/app/')
    await expect(page.locator('.app-sidebar-item[data-id="conversations"] .app-sidebar-item-badge')).toHaveText('7')

    // Com a preferência desligada, o número não aparece.
    await page.route('**/api/admin/me/preferences', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: { showUnreadBadge: false } }) }),
    )
    await page.reload()
    await expect(page.locator('.app-sidebar-item[data-id="conversations"] .app-sidebar-item-badge')).toHaveCount(0)
  })
})
