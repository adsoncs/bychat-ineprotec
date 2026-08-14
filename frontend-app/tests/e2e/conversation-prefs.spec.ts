import { test, expect, type Page } from '@playwright/test'
import { setupAuthenticatedApp } from './_helpers'

/**
 * Preferências das Conversas: o painel existe, e cada item realmente muda a
 * tela (fonte da mensagem, fonte do nome, prévia, densidade, transcrição).
 * Backend mockado — o que se testa aqui é o comportamento da interface.
 */

const TICKET = {
  id: 1,
  nome: 'Maria Fernandes',
  empresa: 'Habitat Imóveis',
  whatsapp: '5511999990000',
  email: null,
  segmento: null,
  status: 'NOVO',
  source: 'whatsapp',
  profilePicUrl: null,
  unreadMessages: 2,
  lastMessageAt: new Date('2026-08-12T12:00:00Z').toISOString(),
  lastMessagePreview: 'Ainda dá tempo de visitar hoje?',
  lastMessage: { body: 'Ainda dá tempo de visitar hoje?', fromMe: false, mediaType: null, timestamp: new Date('2026-08-12T12:00:00Z').toISOString() },
  conversationOpenedAt: new Date('2026-08-12T11:00:00Z').toISOString(),
  conversationClosedAt: null,
  snoozedUntil: null,
  assignedUserId: 1,
  assignedUser: { id: 1, name: 'Tester', email: 'tester@example.com' },
  teamId: null,
  team: null,
  qualifiedAt: null,
  qualificationSource: null,
  isGroup: false,
  channel: { provider: 'evolution', label: 'Comercial', number: '5511888887777', name: 'Comercial', color: '#25D366' },
}

const MESSAGES = [
  {
    id: 1, fromMe: false, body: 'Ainda dá tempo de visitar o apartamento hoje?',
    mediaType: null, mediaUrl: null, mediaName: null, ack: 3, isDeleted: false,
    isInternal: false, senderName: 'Maria Fernandes', externalId: 'a1', quotedMsgId: null,
    timestamp: new Date('2026-08-12T12:00:00Z').toISOString(),
  },
  {
    id: 2, fromMe: false, body: 'Bom dia, gostaria de saber sobre a garagem também',
    mediaType: 'audio', mediaUrl: '/uploads/nao-existe.ogg', mediaName: null, ack: 3,
    isDeleted: false, isInternal: false, senderName: 'Maria Fernandes', externalId: 'a2',
    quotedMsgId: null, timestamp: new Date('2026-08-12T12:01:00Z').toISOString(),
  },
  {
    // Mensagem nossa com a identificação do operador ligada: o nome vai como
    // primeira linha do corpo (`*Nome*`), não como rótulo.
    id: 3, fromMe: true, body: '*Rafael*\nConsigo às 15h — confirmo para você?',
    mediaType: null, mediaUrl: null, mediaName: null, ack: 3, isDeleted: false,
    isInternal: false, senderName: 'Rafael', externalId: 'a3', quotedMsgId: null,
    timestamp: new Date('2026-08-12T12:02:00Z').toISOString(),
  },
]

async function abrirConversas(page: Page) {
  await setupAuthenticatedApp(page, {
    '/api/admin/me': { id: 1, name: 'Tester', email: 'tester@example.com', role: 'ADMIN' },
    '/api/atendimento/tickets': (req: { url: () => string }) => {
      const path = new URL(req.url()).pathname
      if (path.endsWith('/messages')) return { messages: MESSAGES, hasMore: false }
      if (path.endsWith('/info')) return { lead: { ...TICKET, tags: [], funnelId: null } }
      return {
        tickets: [TICKET], total: 1, limit: 50, offset: 0,
        counters: { inbox: 1, raw: 0, resolved: 0, snoozed: 0, mine: 1, teamQueue: 0, waiting: 0, attending: 1, groups: 0 },
      }
    },
  })
  await page.goto('/app/conversations')
  await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
}

async function fecharPainel(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function abrirPainel(page: Page) {
  await page.getByRole('button', { name: /Preferências/i }).first().click()
  await expect(page.getByRole('dialog').getByText('Preferências das conversas')).toBeVisible()
}

/** px do font-size aplicado ao nome do contato na lista. */
async function tamanhoDoNome(page: Page): Promise<number> {
  const el = page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first()
  return el.evaluate((n) => parseFloat(getComputedStyle(n.parentElement as HTMLElement).fontSize))
}

test.describe('Conversas — painel de preferências', () => {
  test('abre o painel com as seções esperadas', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'painel pensado para telas de trabalho')
    await abrirConversas(page)
    await abrirPainel(page)

    const dialog = page.getByRole('dialog')
    for (const secao of ['Leitura', 'Lista de conversas', 'Áudio', 'Escrita e alertas']) {
      await expect(dialog.getByRole('heading', { name: secao })).toBeVisible()
    }
    await expect(dialog.getByText('Transcrever os áudios recebidos')).toBeVisible()
    // O selo aparece no bloco e no rótulo interno — basta um estar visível.
    await expect(dialog.getByText('Toda a equipe').first()).toBeVisible()
  })

  test('tamanho do nome do contato muda a lista', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'painel pensado para telas de trabalho')
    await abrirConversas(page)
    const antes = await tamanhoDoNome(page)

    await abrirPainel(page)
    const grupoNome = page.getByRole('group', { name: 'Tamanho do nome do contato' })
    await grupoNome.getByRole('button', { name: 'Maior' }).click()
    await fecharPainel(page)

    const depois = await tamanhoDoNome(page)
    expect(depois).toBeGreaterThan(antes)
  })

  test('prévia da última mensagem pode ser escondida', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'painel pensado para telas de trabalho')
    await abrirConversas(page)
    await expect(page.getByText('Ainda dá tempo de visitar hoje?').first()).toBeVisible()

    await abrirPainel(page)
    await page.getByRole('dialog').getByText('Mostrar prévia da última mensagem').click()
    await fecharPainel(page)

    await expect(page.getByText('Ainda dá tempo de visitar hoje?')).toHaveCount(0)
  })

  test('fonte das mensagens e transcrição valem dentro da conversa', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 1024, 'conversa aberta precisa de espaço')
    await abrirConversas(page)
    await page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first().click()

    const bolha = page.getByText('Ainda dá tempo de visitar o apartamento hoje?').first()
    await expect(bolha).toBeVisible({ timeout: 10_000 })
    const antes = await bolha.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))

    // Transcrição do áudio aparece por padrão…
    const transcricao = page.getByText('Bom dia, gostaria de saber sobre a garagem também')
    await expect(transcricao).toBeVisible()

    await abrirPainel(page)
    await page.getByRole('group', { name: 'Tamanho da fonte das mensagens' }).getByRole('button', { name: 'Maior' }).click()
    await page.getByRole('dialog').getByText('Mostrar o texto transcrito junto do áudio').click()
    await fecharPainel(page)

    const depois = await bolha.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    expect(depois).toBeGreaterThan(antes)
    // …e some quando o operador desliga (o player continua na tela).
    await expect(transcricao).toHaveCount(0)
    await expect(page.locator('audio')).toHaveCount(1)
  })

  test('nome de quem enviou e hora dentro da bolha têm tamanho próprio', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 1024, 'conversa aberta precisa de espaço')
    await abrirConversas(page)
    await page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first().click()

    // O nome "Maria Fernandes" também aparece na lista e no topo do
    // atendimento: ancora no corpo da mensagem e pega os irmãos dentro da
    // bolha — o rótulo de quem enviou (antes) e a hora (depois).
    const corpo = page.getByText('Ainda dá tempo de visitar o apartamento hoje?').first()
    await expect(corpo).toBeVisible({ timeout: 10_000 })
    const remetente = corpo.locator('xpath=preceding-sibling::div[1]')
    const hora = corpo.locator('xpath=following-sibling::div[1]')
    await expect(remetente).toHaveText('Maria Fernandes')

    const antesNome = await remetente.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    const antesHora = await hora.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    const antesCorpo = await corpo.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    expect(antesNome).toBeLessThan(antesCorpo)

    await abrirPainel(page)
    await page.getByRole('group', { name: 'Tamanho do nome e da hora na mensagem' })
      .getByRole('button', { name: 'Maior' }).click()
    await fecharPainel(page)

    const depoisNome = await remetente.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    const depoisHora = await hora.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    const depoisCorpo = await corpo.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))
    expect(depoisNome).toBeGreaterThan(antesNome)
    expect(depoisHora).toBeGreaterThan(antesHora)
    // …e o corpo da mensagem não é arrastado junto.
    expect(depoisCorpo).toBe(antesCorpo)
  })

  test('negrito e cor destacam os dois nomes dentro da conversa', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 1024, 'conversa aberta precisa de espaço')
    await abrirConversas(page)
    await page.locator('li').getByText('Maria Fernandes - Habitat Imóveis').first().click()

    const corpoContato = page.getByText('Ainda dá tempo de visitar o apartamento hoje?').first()
    await expect(corpoContato).toBeVisible({ timeout: 10_000 })
    const nomeContato = corpoContato.locator('xpath=preceding-sibling::div[1]')
    // Nome do agente: primeira linha do corpo da mensagem enviada (`*Rafael*`).
    const nomeAgente = page.locator('.conv-operator-body strong').first()
    await expect(nomeAgente).toHaveText('Rafael')

    const antes = {
      pesoContato: await nomeContato.evaluate((n) => getComputedStyle(n).fontWeight),
      corContato: await nomeContato.evaluate((n) => getComputedStyle(n).color),
      corAgente: await nomeAgente.evaluate((n) => getComputedStyle(n).color),
    }

    await abrirPainel(page)
    await page.getByRole('dialog').getByText('Nomes em negrito na conversa').click()
    await page.getByRole('group', { name: 'Cor dos nomes na conversa' })
      .getByRole('button', { name: 'Âmbar' }).click()
    await fecharPainel(page)

    const depois = {
      pesoContato: await nomeContato.evaluate((n) => getComputedStyle(n).fontWeight),
      corContato: await nomeContato.evaluate((n) => getComputedStyle(n).color),
      corAgente: await nomeAgente.evaluate((n) => getComputedStyle(n).color),
    }

    expect(Number(depois.pesoContato)).toBeGreaterThan(Number(antes.pesoContato))
    expect(depois.corContato).not.toBe(antes.corContato)
    expect(depois.corAgente).not.toBe(antes.corAgente)
    // Âmbar #fbbf24 nos dois nomes.
    expect(depois.corContato).toBe('rgb(251, 191, 36)')
    expect(depois.corAgente).toBe('rgb(251, 191, 36)')
  })

  test('preferências sobrevivem ao recarregar a página', async ({ page, viewport }) => {
    test.skip(viewport !== null && viewport.width < 768, 'painel pensado para telas de trabalho')
    await abrirConversas(page)
    await abrirPainel(page)
    await page.getByRole('group', { name: 'Densidade da lista' }).getByRole('button', { name: 'Compacta' }).click()
    await fecharPainel(page)

    await page.reload()
    await expect(page.getByRole('heading', { name: /Conversas/i, level: 1 })).toBeVisible({ timeout: 15_000 })
    await abrirPainel(page)
    await expect(
      page.getByRole('group', { name: 'Densidade da lista' }).getByRole('button', { name: 'Compacta' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('sons das conversas', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedApp(page)
    await page.goto('/app/conversations')
  })

  test('escolher "ao enviar e receber" e desligar grupos grava na conta', async ({ page }) => {
    const salvos: Record<string, unknown>[] = []
    await page.route('**/api/admin/me/preferences', async (route) => {
      if (route.request().method() === 'PUT') {
        salvos.push(route.request().postDataJSON()?.preferences ?? {})
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: {} }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: {} }) })
    })

    await abrirPainel(page)
    // Os controles só aparecem com o som ligado (padrão).
    await page.getByRole('group', { name: 'Quando emitir som' }).getByRole('button', { name: 'Ao enviar e receber' }).click()
    await page.getByText('Avisar sobre mensagens de grupos').click()

    await expect.poll(() => salvos.length).toBeGreaterThanOrEqual(2)
    expect(salvos.some((p) => p.notifyEvents === 'both')).toBe(true)
    expect(salvos.some((p) => p.notifyGroups === false)).toBe(true)
  })

  test('o controle de grupos continua acessível com o som desligado', async ({ page }) => {
    await page.route('**/api/admin/me/preferences', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: { notifySound: false } }) }),
    )
    await abrirPainel(page)
    // Ele vale também para o aviso na área de trabalho — sem isto, quem usa só
    // o aviso do sistema ficaria sem como silenciar grupo.
    await expect(page.getByText('Avisar sobre mensagens de grupos')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Quando emitir som' })).toHaveCount(0)
  })

  test('desligar o som esconde os controles dependentes', async ({ page }) => {
    await page.route('**/api/admin/me/preferences', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: {} }) }),
    )
    await abrirPainel(page)
    await expect(page.getByRole('group', { name: 'Quando emitir som' })).toBeVisible()
    await page.getByText('Som nas conversas').click()
    await expect(page.getByRole('group', { name: 'Quando emitir som' })).toHaveCount(0)
  })
})
