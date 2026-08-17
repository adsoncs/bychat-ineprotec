import { test, expect, type Page } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Citação recebida e conversa fixada.
 *
 * A resposta do CLIENTE chegava como mensagem solta: o webhook não guardava a
 * citação, então a bolha não tinha como mostrar a que ele respondeu — em grupo,
 * onde falam vários, isso deixava a conversa ilegível. Aqui a citação vem
 * pronta do servidor (`quoted`), inclusive quando a mensagem original é antiga
 * demais para estar carregada na tela.
 */

const TICKET_BASE = {
  empresa: 'Habitat', email: null, segmento: null, status: 'ATENDENDO', source: 'whatsapp',
  profilePicUrl: null, unreadMessages: 0, lastMessagePreview: 'Oi',
  conversationOpenedAt: new Date('2026-08-16T11:00:00Z').toISOString(), conversationClosedAt: null,
  snoozedUntil: null, assignedUserId: 1, assignedUser: { id: 1, name: 'Tester', email: 't@e.com' },
  teamId: null, team: null, qualifiedAt: new Date().toISOString(), qualificationSource: null, isGroup: false,
  channel: { provider: 'evolution', label: 'Comercial', number: '5511888887777', name: 'Comercial', color: '#25D366' },
}
const RECENTE = {
  ...TICKET_BASE, id: 1, nome: 'Bruno Recente', whatsapp: '5511999990001',
  lastMessageAt: new Date('2026-08-16T18:00:00Z').toISOString(),
  lastMessage: { body: 'Oi', fromMe: false, timestamp: new Date('2026-08-16T18:00:00Z').toISOString() },
  pinned: false,
}
const FIXADA = {
  ...TICKET_BASE, id: 2, nome: 'Ana Fixada', whatsapp: '5511999990002',
  lastMessageAt: new Date('2026-07-01T10:00:00Z').toISOString(),
  lastMessage: { body: 'Combinado', fromMe: false, timestamp: new Date('2026-07-01T10:00:00Z').toISOString() },
  pinned: true,
}

/** Resposta do CLIENTE citando algo nosso que NÃO está na página carregada. */
const RESPOSTA_CITANDO = {
  id: 90, fromMe: false, body: 'Pode fechar por esse valor', mediaType: 'text', mediaUrl: null, mediaName: null,
  ack: 3, isDeleted: false, isInternal: false, senderName: 'Bruno Recente', externalId: 'r1',
  quotedMsgId: 55, timestamp: new Date('2026-08-16T18:00:00Z').toISOString(),
  editedAt: null, deletedForAll: false, isForwarded: false,
  reactions: [{ emoji: '👍', fromMe: false, senderName: 'Bruno Recente', at: new Date().toISOString() }],
  quoted: {
    id: 55, body: 'Segue a proposta com o valor combinado', fromMe: true,
    senderName: null, mediaType: 'text', deleted: false,
  },
}

async function abrir(page: Page, opts: { pins?: string[] } = {}) {
  const pinsChamados: string[] = opts.pins ?? []
  await setupAuthenticatedApp(page, {
    '/api/admin/me': { id: 1, name: 'Tester', email: 't@e.com', role: 'ADMIN' },
    '/api/atendimento/tickets': (req: { url: () => string }) => {
      const p = new URL(req.url()).pathname
      if (p.endsWith('/messages')) return { messages: [RESPOSTA_CITANDO], hasMore: false }
      if (p.endsWith('/info')) return { lead: { ...RECENTE, tags: [], funnelId: null } }
      // Fixada primeiro, como o servidor devolve.
      return {
        tickets: [FIXADA, RECENTE], total: 2, limit: 50, offset: 0,
        counters: { inbox: 2, raw: 0, resolved: 0, snoozed: 0, mine: 2, teamQueue: 0, waiting: 0, attending: 2, groups: 0 },
      }
    },
  })
  await page.route('**/api/atendimento/tickets/*/pin', async (route) => {
    pinsChamados.push(route.request().method())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.goto('/app/conversations')
  await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
}

test('a resposta do cliente mostra o trecho citado', async ({ page }) => {
  await abrir(page)
  // Clique no TEXTO: o alvo clicável é o botão interno do item, e o centro do
  // <li> pode cair no botão de fixar, que fica sobreposto no canto.
  await page.locator('li').getByText('Bruno Recente - Habitat').first().click()

  const bolha = page.getByText('Pode fechar por esse valor')
  await expect(bolha).toBeVisible()

  // O trecho citado aparece mesmo não estando entre as mensagens carregadas.
  await expect(page.getByText('Segue a proposta com o valor combinado')).toBeVisible()
  await expect(page.getByText('Você', { exact: true })).toBeVisible()
})

test('a reação do cliente aparece na bolha', async ({ page }) => {
  await abrir(page)
  // Clique no TEXTO: o alvo clicável é o botão interno do item, e o centro do
  // <li> pode cair no botão de fixar, que fica sobreposto no canto.
  await page.locator('li').getByText('Bruno Recente - Habitat').first().click()
  await expect(page.getByTitle('Reação de Bruno Recente')).toBeVisible()
})

test('conversa fixada sobe ao topo com o alfinete', async ({ page }) => {
  await abrir(page)
  const itens = page.locator('li')
  // A fixada é de julho e a outra é de agosto: só o alfinete explica a ordem.
  await expect(itens.first()).toContainText('Ana Fixada')
  await expect(itens.first().getByLabel('Conversa fixada')).toBeVisible()
})

test('fixar e desafixar pela lista', async ({ page }) => {
  const chamadas: string[] = []
  await abrir(page, { pins: chamadas })

  const naoFixada = page.locator('li').filter({ hasText: 'Bruno Recente' }).first()
  await naoFixada.hover()
  await naoFixada.getByRole('button', { name: 'Fixar conversa no topo' }).click()
  await expect.poll(() => chamadas).toContain('POST')

  const fixada = page.locator('li').filter({ hasText: 'Ana Fixada' }).first()
  await fixada.hover()
  await fixada.getByRole('button', { name: 'Desafixar conversa' }).click()
  await expect.poll(() => chamadas).toContain('DELETE')
})

test('a busca avisa que procura no texto das mensagens', async ({ page }) => {
  await abrir(page)
  await expect(page.getByPlaceholder(/texto das mensagens/i)).toBeVisible()
})
