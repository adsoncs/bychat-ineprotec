import { test, expect, type Page } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Envio no painel: a mensagem tem que sair da caixa e aparecer na conversa no
 * clique, e o cursor tem que continuar na caixa para a próxima. O POST real
 * espera a Evolution entregar (mediana ~1s, p90 ~2,4s), então aqui ele é
 * mockado com atraso — é justamente esse intervalo que estava travando a tela.
 */

const ATRASO_ENVIO_MS = 1500

const TICKET = {
  id: 1, nome: 'Maria Fernandes', empresa: 'Habitat Imóveis', whatsapp: '5511999990000', email: null,
  segmento: null, status: 'NOVO', source: 'whatsapp', profilePicUrl: null, unreadMessages: 0,
  lastMessageAt: new Date('2026-08-12T12:00:00Z').toISOString(), lastMessagePreview: 'Oi',
  lastMessage: { body: 'Oi', fromMe: false, mediaType: null, timestamp: new Date('2026-08-12T12:00:00Z').toISOString() },
  conversationOpenedAt: new Date('2026-08-12T11:00:00Z').toISOString(), conversationClosedAt: null,
  snoozedUntil: null, assignedUserId: 1, assignedUser: { id: 1, name: 'Tester', email: 't@e.com' },
  teamId: null, team: null, qualifiedAt: null, qualificationSource: null, isGroup: false,
  channel: { provider: 'evolution', label: 'Comercial', number: '5511888887777', name: 'Comercial', color: '#25D366' },
}

const MENSAGEM_EXISTENTE = {
  id: 1, fromMe: false, body: 'Oi, tudo bem?', mediaType: null, mediaUrl: null, mediaName: null,
  ack: 3, isDeleted: false, isInternal: false, senderName: 'Maria Fernandes', externalId: 'a1',
  quotedMsgId: null, timestamp: new Date('2026-08-12T12:00:00Z').toISOString(),
}

/** Abre a conversa com o POST de envio atrasado (ou falhando, se `falhar`). */
async function abrirConversa(page: Page, opts: { falhar?: boolean } = {}) {
  await setupAuthenticatedApp(page, {
    '/api/admin/me': { id: 1, name: 'Tester', email: 't@e.com', role: 'ADMIN' },
    '/api/atendimento/tickets': (req: { url: () => string }) => {
      const path = new URL(req.url()).pathname
      if (path.endsWith('/messages')) return { messages: [MENSAGEM_EXISTENTE], hasMore: false }
      if (path.endsWith('/info')) return { lead: { ...TICKET, tags: [], funnelId: null } }
      return {
        tickets: [TICKET], total: 1, limit: 50, offset: 0,
        counters: { inbox: 1, raw: 0, resolved: 0, snoozed: 0, mine: 1, teamQueue: 0, waiting: 0, attending: 1, groups: 0 },
      }
    },
  })

  // Registrada depois do helper → tem precedência sobre o mock genérico.
  await page.route('**/api/atendimento/tickets/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise((r) => setTimeout(r, ATRASO_ENVIO_MS))
    if (opts.falhar) {
      return route.fulfill({
        status: 502, contentType: 'application/json',
        body: JSON.stringify({ error: 'O número 5511999990000 não tem WhatsApp.' }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  await page.goto('/app/conversations')
  await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
  await page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first().click()
  await expect(page.getByText('Oi, tudo bem?')).toBeVisible({ timeout: 10_000 })
}

const caixa = (page: Page) => page.getByPlaceholder('Digite uma mensagem…')

test.describe('Conversas — resposta do envio', () => {
  test.skip(({ viewport }) => viewport !== null && viewport.width < 1024, 'conversa aberta precisa de espaço')

  test('a mensagem aparece e a caixa esvazia sem esperar o servidor', async ({ page }) => {
    await abrirConversa(page)
    await caixa(page).fill('Bom dia, consigo às 15h')
    const inicio = Date.now()
    await page.getByRole('button', { name: 'Enviar mensagem' }).click()

    // Sem waitFor de rede: o efeito tem que ser imediato.
    await expect(page.getByText('Bom dia, consigo às 15h')).toBeVisible({ timeout: 400 })
    await expect(caixa(page)).toHaveValue('', { timeout: 400 })
    expect(Date.now() - inicio).toBeLessThan(ATRASO_ENVIO_MS)
  })

  test('o cursor continua na caixa depois de enviar', async ({ page }) => {
    await abrirConversa(page)
    await caixa(page).click()
    await caixa(page).fill('Primeira')
    await page.keyboard.press('Enter')

    await expect(caixa(page)).toBeFocused({ timeout: 1000 })
    // …e dá para escrever a segunda enquanto a primeira ainda está voando.
    await page.keyboard.type('Segunda')
    await expect(caixa(page)).toHaveValue('Segunda')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Primeira')).toBeVisible()
    await expect(page.getByText('Segunda')).toBeVisible()
    await expect(caixa(page)).toBeFocused()
  })

  test('envio que falha devolve o texto e retira a bolha', async ({ page }) => {
    await abrirConversa(page, { falhar: true })
    await caixa(page).click()
    await caixa(page).fill('Mensagem que vai falhar')
    await page.keyboard.press('Enter')

    await expect(page.getByText('Mensagem que vai falhar')).toBeVisible({ timeout: 400 })
    // Depois da resposta de erro: bolha some, texto volta, aviso aparece.
    await expect(page.getByText('não tem WhatsApp')).toBeVisible({ timeout: 5000 })
    await expect(caixa(page)).toHaveValue('Mensagem que vai falhar')
    await expect(page.locator('.whitespace-pre-wrap', { hasText: 'Mensagem que vai falhar' })).toHaveCount(0)
  })
})
