import { test, expect, devices, type Page } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Ações da mensagem em aparelho SEM mouse.
 *
 * No celular não existe o momento "passar o mouse", então o menu de ações era
 * inalcançável: os botões ficavam em `opacity: 0` esperando um `:hover` que
 * nunca vem — e, pior, continuavam clicáveis, então um toque perto da borda da
 * bolha disparava "Responder" sem nada visível ali.
 *
 * Este teste roda com `hasTouch` e emulação de mídia `hover: none`, que é o que
 * um telefone de verdade reporta, e cobre as duas portas de entrada: o botão
 * sempre visível e o pressionar-e-segurar.
 */

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

/** Nossa, recém-enviada: cai dentro da janela de 15 min, então pode ser editada. */
const MINHA = {
  id: 10, fromMe: true, body: 'Segue o orçamento combinado', mediaType: 'text', mediaUrl: null, mediaName: null,
  ack: 2, isDeleted: false, isInternal: false, senderName: null, externalId: 'b1',
  quotedMsgId: null, timestamp: new Date().toISOString(),
  editedAt: null, deletedForAll: false, isForwarded: false, reactions: [],
}

async function abrirConversaNoCelular(page: Page) {
  // O navegador só reporta `hover: none` sob emulação — sem isto o CSS acha
  // que há mouse e o teste passaria por engano.
  await page.emulateMedia({ media: 'screen', forcedColors: null })
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (q: string) => (
      q.includes('hover: none') || q.includes('pointer: coarse')
        ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
        : original(q)
    )
  })

  await setupAuthenticatedApp(page, {
    '/api/admin/me': { id: 1, name: 'Tester', email: 't@e.com', role: 'ADMIN' },
    '/api/atendimento/tickets': (req: { url: () => string }) => {
      const path = new URL(req.url()).pathname
      if (path.endsWith('/messages')) return { messages: [MINHA], hasMore: false }
      if (path.endsWith('/info')) return { lead: { ...TICKET, tags: [], funnelId: null } }
      return {
        tickets: [TICKET], total: 1, limit: 50, offset: 0,
        counters: { inbox: 1, raw: 0, resolved: 0, snoozed: 0, mine: 1, teamQueue: 0, waiting: 0, attending: 1, groups: 0 },
      }
    },
  })

  await page.goto('/app/conversations')
  await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
  await page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first().click()
  await expect(page.getByText('Segue o orçamento combinado')).toBeVisible()
}

test.use({ ...devices['Pixel 5'], hasTouch: true, isMobile: true })

test('sem mouse, o botão de ações fica visível e abre a folha inferior', async ({ page }) => {
  await abrirConversaNoCelular(page)

  const botao = page.getByRole('button', { name: 'Mais ações', exact: true })
  await expect(botao).toBeVisible()
  // Visível de verdade, não só presente: era exatamente o `opacity: 0` que
  // deixava o botão inalcançável no celular.
  await expect(botao).toHaveCSS('opacity', '1')

  await botao.tap()
  const folha = page.getByRole('dialog', { name: 'Mensagem' })
  await expect(folha).toBeVisible()
  await expect(folha.getByRole('button', { name: 'Encaminhar' })).toBeVisible()
  await expect(folha.getByRole('button', { name: 'Apagar para todos' })).toBeVisible()
  await expect(folha.getByRole('button', { name: 'Editar' })).toBeVisible()

  // Alvo de toque: o mínimo que o app adota é 44px.
  const caixa = await folha.getByRole('button', { name: 'Encaminhar' }).boundingBox()
  expect(caixa!.height).toBeGreaterThanOrEqual(44)
})

test('pressionar e segurar a bolha abre o mesmo menu', async ({ page }) => {
  await abrirConversaNoCelular(page)

  const bolha = page.getByText('Segue o orçamento combinado')
  const box = (await bolha.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Toque mantido: sem mover o dedo, por mais que os 450ms do gesto.
  await page.touchscreen.tap(x, y)
  await bolha.dispatchEvent('touchstart')
  await page.waitForTimeout(600)

  await expect(page.getByRole('dialog', { name: 'Mensagem' })).toBeVisible()
})

test('tocar fora fecha a folha sem executar nada', async ({ page }) => {
  await abrirConversaNoCelular(page)

  await page.getByRole('button', { name: 'Mais ações', exact: true }).tap()
  const folha = page.getByRole('dialog', { name: 'Mensagem' })
  await expect(folha).toBeVisible()

  // Toca no alto da tela: o fundo escurecido cobre tudo, mas a parte alcançável
  // pelo dedo é a que sobra acima da folha.
  await page.touchscreen.tap(180, 60)
  await expect(folha).toBeHidden()
})
