import { test, expect, type Page } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Cabeçalho da conversa em todas as larguras.
 *
 * O problema que este teste tranca: as sete ações ficavam numa barra com
 * `flex-wrap`, então em qualquer largura apertada elas quebravam em duas ou
 * três fileiras, o cabeçalho crescia e a identidade do contato era empurrada —
 * "encavalado". A verificação é geométrica, não visual: mede a altura do
 * cabeçalho e confere que nenhuma ação escorregou para uma segunda linha.
 */

const NOME_LONGO = 'Maria Fernanda Albuquerque de Souza Rodrigues'

const TICKET = {
  id: 1, nome: NOME_LONGO, empresa: 'Habitat Incorporações e Participações', whatsapp: '5562991114444',
  email: null, segmento: null, status: 'ATENDENDO', source: 'whatsapp', profilePicUrl: null, unreadMessages: 0,
  lastMessageAt: new Date('2026-08-16T12:00:00Z').toISOString(), lastMessagePreview: 'Oi',
  lastMessage: { body: 'Oi', fromMe: false, mediaType: null, timestamp: new Date('2026-08-16T12:00:00Z').toISOString() },
  conversationOpenedAt: new Date('2026-08-16T11:00:00Z').toISOString(), conversationClosedAt: null,
  snoozedUntil: null, assignedUserId: 1,
  assignedUser: { id: 1, name: 'João Pedro Nascimento', email: 'joao@e.com' },
  teamId: 3, team: { id: 3, name: 'Comercial Premium', color: '#7C3AED', slug: 'comercial' },
  qualifiedAt: new Date().toISOString(), qualificationSource: null, isGroup: false,
  channel: { provider: 'evolution', label: 'Vendas Goiânia', number: '5562988887777', name: 'Vendas', color: '#25D366' },
}

const MENSAGEM = {
  id: 1, fromMe: false, body: 'Bom dia, gostaria de saber sobre o apartamento', mediaType: null,
  mediaUrl: null, mediaName: null, ack: 3, isDeleted: false, isInternal: false,
  senderName: NOME_LONGO, externalId: 'a1', quotedMsgId: null,
  timestamp: new Date('2026-08-16T12:00:00Z').toISOString(),
  editedAt: null, deletedForAll: false, isForwarded: false, reactions: [],
}

async function abrirConversa(page: Page) {
  await setupAuthenticatedApp(page, {
    '/api/admin/me': { id: 1, name: 'João Pedro Nascimento', email: 'joao@e.com', role: 'ADMIN' },
    '/api/atendimento/tickets': (req: { url: () => string }) => {
      const path = new URL(req.url()).pathname
      if (path.endsWith('/messages')) return { messages: [MENSAGEM], hasMore: false }
      if (path.endsWith('/info')) return { lead: { ...TICKET, tags: [], funnelId: null } }
      return {
        tickets: [TICKET], total: 1, limit: 50, offset: 0,
        counters: { inbox: 1, raw: 0, resolved: 0, snoozed: 0, mine: 1, teamQueue: 0, waiting: 0, attending: 1, groups: 0 },
      }
    },
  })
  await page.goto('/app/conversations')
  await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
  await page.locator('li').filter({ hasText: NOME_LONGO }).first().click()
  await expect(page.getByText('Bom dia, gostaria de saber sobre o apartamento')).toBeVisible()
}

/** O cabeçalho é o `header` da conversa (o primeiro é o da página). */
function cabecalho(page: Page) {
  return page.locator('header').filter({ hasText: NOME_LONGO }).first()
}

const LARGURAS = [
  { nome: 'celular pequeno', w: 360, h: 740 },
  { nome: 'celular', w: 414, h: 896 },
  { nome: 'tablet', w: 768, h: 1024 },
  { nome: 'notebook', w: 1280, h: 800 },
  { nome: 'desktop', w: 1920, h: 1080 },
]

for (const { nome, w, h } of LARGURAS) {
  test(`cabeçalho em uma linha só — ${nome} (${w}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await abrirConversa(page)

    const header = cabecalho(page)
    const caixa = (await header.boundingBox())!

    // Duas linhas de conteúdo (nome + dados) com respiro cabem em ~72px. Acima
    // disso alguma coisa quebrou para uma fileira extra.
    expect(caixa.height, `altura do cabeçalho em ${w}px`).toBeLessThanOrEqual(80)

    // Nada pode ultrapassar a largura da tela.
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(w + 1)

    // Todas as ações visíveis compartilham a MESMA linha. A comparação é pelo
    // CENTRO vertical: os botões têm alturas diferentes (ícone de 36px x botão
    // com rótulo) e ficam centralizados, então os topos divergem sem que nada
    // tenha quebrado — o centro é o que denuncia a segunda fileira.
    const acoes = header.getByTestId('acoes-conversa').getByRole('button')
    const centros: number[] = []
    for (const b of await acoes.all()) {
      const bb = await b.boundingBox()
      if (bb) centros.push(Math.round(bb.y + bb.height / 2))
    }
    const distintos = [...new Set(centros)]
    expect(distintos.length, `linhas ocupadas pelas ações em ${w}px: ${distintos.join(', ')}`).toBe(1)
  })
}

test('as ações de exceção vivem no menu, não na barra', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await abrirConversa(page)
  const header = cabecalho(page)

  // Fora da barra: só aparecem depois de abrir o "⋯".
  await expect(header.getByRole('button', { name: /Transferir/i })).toHaveCount(0)

  await header.getByRole('button', { name: 'Mais ações da conversa' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('Transferir para operador ou setor')).toBeVisible()
  await expect(menu.getByText('Devolver à fila')).toBeVisible()
  await expect(menu.getByText('Excluir conversa')).toBeVisible()
  // Adormecer com as opções abertas, sem submenu.
  await expect(menu.getByText('Amanhã às 9h')).toBeVisible()
})

test('nome comprido é truncado em vez de empurrar as ações', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 })
  await abrirConversa(page)
  const header = cabecalho(page)

  const nome = header.getByTitle(NOME_LONGO).first()
  const bnome = (await nome.boundingBox())!
  const bmenu = (await header.getByRole('button', { name: 'Mais ações da conversa' }).boundingBox())!

  // O nome termina antes de onde as ações começam — não há sobreposição.
  expect(bnome.x + bnome.width).toBeLessThanOrEqual(bmenu.x + 1)
  // E o botão continua dentro da tela.
  expect(bmenu.x + bmenu.width).toBeLessThanOrEqual(414 + 1)
})
