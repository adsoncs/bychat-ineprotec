// src/services/alertService.ts
//
// O núcleo dos alertas. Quem detecta uma condição — token vencido, atividade
// atrasada, negociação parada — chama `raiseAlert`; quando a condição some,
// chama `resolveAlert`. Nada mais.
//
// A regra que sustenta o resto: ALERTA É ESTADO, NÃO EVENTO.
//
// O produtor típico é um scheduler que roda a cada minuto e reencontra a mesma
// condição centenas de vezes. Tratando cada encontro como um aviso novo, uma
// negociação parada há 31 dias renderia 31 avisos e o time desligaria o recurso
// na primeira semana. Por isso a chave é `dedupeKey`: chamar `raiseAlert` de
// novo com a mesma chave ATUALIZA (lastSeenAt, occurrences) em vez de duplicar.
// O produtor pode ser burro e chamar sempre — é o comportamento esperado.
//
// Quem recebe (decisão do produto):
//   audience 'management' -> gestão (SUPERADMIN, ADMIN, MANAGER) ativa
//   audience 'owner'      -> o dono do item E a gestão
// A caixa é individual: ler e descartar são de cada um (AlertRecipient). A
// resolução é do mundo: a condição acabou, o alerta fecha para todos juntos.

import { prisma } from '../lib/prisma.js'

/** Papéis que enxergam tudo. Ver `resolverDestinatarios`. */
const PAPEIS_DE_GESTAO = ['SUPERADMIN', 'ADMIN', 'MANAGER'] as const

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertAudience = 'management' | 'owner'

export interface RaiseAlertInput {
  /** Identidade da CONDIÇÃO: "token:google:3", "activity:overdue:1842". */
  dedupeKey: string
  /** Família do alerta, para filtro e configuração futura. */
  kind: string
  title: string
  body?: string | null
  severity?: AlertSeverity
  /** 'owner' exige `ownerUserId`; sem ele o alerta sobra só para a gestão. */
  audience?: AlertAudience
  entityType?: string | null
  entityId?: number | null
  ownerUserId?: number | null
  teamId?: number | null
  metadata?: Record<string, unknown> | null
}

export interface RaiseAlertResult {
  alertId: number
  /** true na primeira vez que esta condição aparece (ou quando ela volta). */
  novo: boolean
  /** Quantas voltas do relógio já confirmaram a condição. */
  ocorrencias: number
  /** Quem passou a ter o alerta na caixa AGORA (vazio quando nada mudou). */
  novosDestinatarios: number[]
}

/**
 * Quem deve ver este alerta.
 *
 * A gestão entra sempre — é o "itens de usuário ficam com gestão+usuário" da
 * decisão de produto. O dono entra quando a audiência é dele. Usuário inativo
 * fica de fora: alerta na caixa de quem não abre o painel é alerta perdido.
 */
export async function resolverDestinatarios(
  audience: AlertAudience,
  ownerUserId?: number | null,
): Promise<number[]> {
  const gestao = await prisma.user.findMany({
    where: { active: true, role: { in: PAPEIS_DE_GESTAO as unknown as any[] } },
    select: { id: true },
  })
  const ids = new Set(gestao.map((u) => u.id))

  if (audience === 'owner' && ownerUserId) {
    // O dono pode ser o próprio gestor (o Set resolve) ou estar inativo — neste
    // caso o alerta não some, fica só com a gestão, que é quem redistribui.
    const dono = await prisma.user.findFirst({
      where: { id: ownerUserId, active: true },
      select: { id: true },
    })
    if (dono) ids.add(dono.id)
  }
  return [...ids]
}

/**
 * Registra (ou reencontra) uma condição que merece atenção.
 *
 * Idempotente por `dedupeKey`. Seguro para chamar a cada volta do relógio.
 */
export async function raiseAlert(input: RaiseAlertInput): Promise<RaiseAlertResult> {
  const agora = new Date()
  const audience: AlertAudience = input.audience || 'management'

  const existente = await prisma.alert.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true, status: true },
  })

  const dados = {
    kind: input.kind,
    severity: input.severity || 'warning',
    audience,
    title: input.title,
    body: input.body ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    teamId: input.teamId ?? null,
    metadata: (input.metadata ?? null) as any,
    lastSeenAt: agora,
  }

  let alertId: number
  let ocorrencias: number
  let novo = false

  if (!existente) {
    const criado = await prisma.alert.create({
      data: { ...dados, dedupeKey: input.dedupeKey, status: 'open', firstSeenAt: agora },
      select: { id: true, occurrences: true },
    })
    alertId = criado.id
    ocorrencias = criado.occurrences
    novo = true
  } else {
    // Condição que volta depois de resolvida reabre na MESMA linha: o registro
    // de quando ela apareceu pela primeira vez é o que mostra que é recorrente,
    // e uma linha nova esconderia isso. O contador de envio externo zera, senão
    // a volta do problema passaria calada por já ter sido notificada um dia.
    const reabrindo = existente.status === 'resolved'
    const atualizado = await prisma.alert.update({
      where: { id: existente.id },
      data: {
        ...dados,
        status: 'open',
        resolvedAt: null,
        occurrences: { increment: 1 },
        ...(reabrindo ? { notifiedAt: null, notifyCount: 0 } : {}),
      },
      select: { id: true, occurrences: true },
    })
    alertId = atualizado.id
    ocorrencias = atualizado.occurrences
    novo = reabrindo
  }

  const novosDestinatarios = await reconciliarDestinatarios(alertId, audience, input.ownerUserId)
  await avisarEmTempoReal(alertId, novosDestinatarios, input)
  return { alertId, novo, ocorrencias, novosDestinatarios }
}

/**
 * Acende o sino de quem ACABOU de receber o alerta.
 *
 * Um evento por pessoa, com `scope.userId`, nunca broadcast: alerta de gestão
 * chegando na tela de um agente é exatamente o vazamento que a audiência existe
 * para impedir.
 *
 * Só os novos entram. A condição que segue de pé é reencontrada a cada volta do
 * relógio, e avisar de novo quem já tem o alerta na caixa faria o sino tocar a
 * cada minuto pelo mesmo problema — a versão em tempo real do spam que o
 * `dedupeKey` evita no banco.
 *
 * O envio é best-effort: sino que falha não pode derrubar quem produziu o
 * alerta, porque o registro no banco (que é o que importa) já está feito.
 */
async function avisarEmTempoReal(
  alertId: number,
  destinatarios: number[],
  input: RaiseAlertInput,
): Promise<void> {
  if (!destinatarios.length) return
  try {
    const { broadcastRealtimeEvent } = await import('../routes/realtime.js')
    for (const userId of destinatarios) {
      // Silêncio também cala o som e o aviso na área de trabalho. Filtrar só a
      // lista deixaria o pior dos mundos: o alerta não aparece e o sino toca.
      const { kinds, chaves } = await silenciosDoUsuario(userId)
      if (kinds.includes(input.kind) || chaves.includes(input.dedupeKey)) continue
      broadcastRealtimeEvent({
        type: 'alert:raised',
        payload: {
          id: alertId,
          kind: input.kind,
          severity: input.severity || 'warning',
          title: input.title,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
        scope: { userId },
      })
    }
  } catch (e: any) {
    console.warn('[alertas] sino não tocou:', e?.message)
  }
}

/**
 * Acerta a lista de quem tem o alerta na caixa.
 *
 * Roda a cada `raiseAlert` porque o conjunto muda com o tempo: entra gente na
 * gestão, o dono do item é trocado. Quem saiu do conjunto perde o alerta da
 * caixa — mas só se ainda não leu. Apagar o que a pessoa já viu reescreveria o
 * que aconteceu com ela, e é justamente o registro de quem foi avisado que
 * importa depois.
 */
async function reconciliarDestinatarios(
  alertId: number,
  audience: AlertAudience,
  ownerUserId?: number | null,
): Promise<number[]> {
  const devem = await resolverDestinatarios(audience, ownerUserId)
  const atuais = await prisma.alertRecipient.findMany({
    where: { alertId },
    select: { userId: true, readAt: true },
  })
  const jaTem = new Set(atuais.map((r) => r.userId))
  const faltam = devem.filter((id) => !jaTem.has(id))

  if (faltam.length) {
    await prisma.alertRecipient.createMany({
      data: faltam.map((userId) => ({ alertId, userId })),
      skipDuplicates: true,
    })
  }

  const sobrando = atuais.filter((r) => !devem.includes(r.userId) && !r.readAt).map((r) => r.userId)
  if (sobrando.length) {
    await prisma.alertRecipient.deleteMany({ where: { alertId, userId: { in: sobrando } } })
  }
  return faltam
}

/**
 * A condição acabou. Fecha para todos — é estado do mundo, não da caixa de
 * ninguém. Idempotente e barato: pode ser chamado sempre que o produtor
 * verificar e não encontrar mais o problema.
 */
export async function resolveAlert(dedupeKey: string): Promise<boolean> {
  const r = await prisma.alert.updateMany({
    where: { dedupeKey, status: 'open' },
    data: { status: 'resolved', resolvedAt: new Date() },
  })
  return r.count > 0
}

/**
 * Fecha em lote as condições de uma família que não foram reencontradas nesta
 * volta — o "some sozinho" de quem varre tudo a cada ciclo.
 *
 * O produtor levanta o que achou e passa as chaves vivas; o resto se resolve.
 * Sem isso cada produtor precisaria lembrar de chamar `resolveAlert` para cada
 * item que deixou de ter problema, que é exatamente o que ninguém faz.
 *
 * Lista vazia é um caso real e importante: significa "varri e não achei mais
 * nada desta família", e tem de fechar tudo. Por isso o `notIn` recebe um valor
 * impossível em vez de uma lista vazia — `notIn: []` no MySQL não casa com
 * linha nenhuma e deixaria todos os alertas abertos justamente quando o
 * problema acabou.
 */
export async function resolverAusentes(kind: string, chavesVivas: string[]): Promise<number> {
  const r = await prisma.alert.updateMany({
    where: {
      kind,
      status: 'open',
      dedupeKey: { notIn: chavesVivas.length ? chavesVivas : [' sem-chave-viva'] },
    },
    data: { status: 'resolved', resolvedAt: new Date() },
  })
  return r.count
}

/**
 * O que esta pessoa pediu para não ver.
 *
 * Silêncio expirado é ignorado aqui em vez de apagado: a linha vencida não
 * atrapalha e apagá-la exigiria uma varredura só para isso. Quem religa o
 * alerta remove a linha explicitamente.
 */
async function silenciosDoUsuario(userId: number): Promise<{ kinds: string[]; chaves: string[] }> {
  const agora = new Date()
  const linhas = await prisma.alertMute.findMany({
    where: { userId, OR: [{ until: null }, { until: { gt: agora } }] },
    select: { kind: true, dedupeKey: true },
  })
  return {
    kinds: linhas.map((l) => l.kind).filter((k): k is string => !!k),
    chaves: linhas.map((l) => l.dedupeKey).filter((k): k is string => !!k),
  }
}

/**
 * Cláusula de exclusão do que está silenciado.
 *
 * Vive numa função só porque a lista e o CONTADOR precisam concordar: badge
 * mostrando 3 e a gaveta abrindo com 1 é a forma mais rápida de a pessoa
 * desconfiar do sino inteiro.
 */
async function filtroDeSilencio(userId: number) {
  const { kinds, chaves } = await silenciosDoUsuario(userId)
  if (!kinds.length && !chaves.length) return {}
  return {
    alert: {
      ...(kinds.length ? { kind: { notIn: kinds } } : {}),
      ...(chaves.length ? { dedupeKey: { notIn: chaves } } : {}),
    },
  }
}

/** Silencia uma família ou uma condição para esta pessoa. */
export async function silenciar(
  userId: number,
  alvo: { kind?: string; dedupeKey?: string },
  until?: Date | null,
): Promise<boolean> {
  if (!alvo.kind && !alvo.dedupeKey) return false
  // Um dos dois, nunca os dois: o `upsert` precisa de chave única definida, e
  // silenciar "o tipo X mas só neste item" não é um pedido que exista.
  const where = alvo.kind
    ? { userId_kind: { userId, kind: alvo.kind } }
    : { userId_dedupeKey: { userId, dedupeKey: alvo.dedupeKey! } }
  await prisma.alertMute.upsert({
    where: where as any,
    update: { until: until ?? null },
    create: { userId, kind: alvo.kind ?? null, dedupeKey: alvo.dedupeKey ?? null, until: until ?? null },
  })
  return true
}

/** Volta a receber. */
export async function dessilenciar(
  userId: number,
  alvo: { kind?: string; dedupeKey?: string },
): Promise<boolean> {
  const r = await prisma.alertMute.deleteMany({
    where: {
      userId,
      ...(alvo.kind ? { kind: alvo.kind } : {}),
      ...(alvo.dedupeKey ? { dedupeKey: alvo.dedupeKey } : {}),
    },
  })
  return r.count > 0
}

/** O que esta pessoa silenciou, para a tela poder desfazer. */
export async function listarSilencios(userId: number) {
  return prisma.alertMute.findMany({
    where: { userId },
    select: { id: true, kind: true, dedupeKey: true, until: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

/** A caixa de uma pessoa: aberto, não descartado, mais recente primeiro. */
export async function listarAlertasDoUsuario(
  userId: number,
  opts?: { apenasNaoLidos?: boolean; limite?: number },
) {
  const silencio = await filtroDeSilencio(userId)
  return prisma.alertRecipient.findMany({
    where: {
      userId,
      dismissedAt: null,
      ...(opts?.apenasNaoLidos ? { readAt: null } : {}),
      alert: { status: 'open', ...(silencio.alert || {}) },
    },
    include: { alert: true },
    orderBy: { alert: { lastSeenAt: 'desc' } },
    take: opts?.limite ?? 50,
  })
}

/** Quantos alertas abertos e não lidos esta pessoa tem — o número do sino. */
export async function contarNaoLidos(userId: number): Promise<number> {
  const silencio = await filtroDeSilencio(userId)
  return prisma.alertRecipient.count({
    where: {
      userId, readAt: null, dismissedAt: null,
      alert: { status: 'open', ...(silencio.alert || {}) },
    },
  })
}

/** Marca como lido na caixa de quem leu. Não mexe na condição. */
export async function marcarLido(alertId: number, userId: number): Promise<boolean> {
  const r = await prisma.alertRecipient.updateMany({
    where: { alertId, userId, readAt: null },
    data: { readAt: new Date() },
  })
  return r.count > 0
}

/** Tira da própria caixa. O alerta continua de pé para os outros. */
export async function descartar(alertId: number, userId: number): Promise<boolean> {
  const agora = new Date()
  const r = await prisma.alertRecipient.updateMany({
    where: { alertId, userId, dismissedAt: null },
    data: { dismissedAt: agora, readAt: agora },
  })
  return r.count > 0
}

// ── Retenção ────────────────────────────────────────────────────────────────
//
// Alerta resolvido não serve para nada depois de um tempo: o problema foi
// arrumado e o registro só ocupa espaço, junto com uma linha de destinatário
// por pessoa que o recebeu. Sem poda, `bychat_alerts` e
// `bychat_alert_recipients` crescem para sempre.
//
// Mesmo padrão do `meetingRetentionPurge` e do `trash.ts`: uma volta no boot e
// a cada 24h, com o prazo em Setting.
//
// Só RESOLVIDO é apagado. Alerta aberto fica, por antigo que seja — condição de
// pé há três meses é exatamente a que não deveria desaparecer sozinha.

const RETENCAO_PADRAO_DIAS = 60
let handlePurga: ReturnType<typeof setInterval> | null = null

async function diasDeRetencao(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'alertas.retencao_dias' } }).catch(() => null)
  const n = parseInt(String(row?.value ?? '').replace(/"/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : RETENCAO_PADRAO_DIAS
}

/** Apaga alertas resolvidos além do prazo. Os destinatários vão em cascata. */
export async function purgarAlertasAntigos(): Promise<number> {
  const dias = await diasDeRetencao()
  const limite = new Date(Date.now() - dias * 86400_000)
  const r = await prisma.alert.deleteMany({
    where: { status: 'resolved', resolvedAt: { lt: limite } },
  })
  return r.count
}

export function startAlertRetention(): void {
  const rodar = async () => {
    try {
      const n = await purgarAlertasAntigos()
      if (n > 0) console.log(`[alertas] ${n} alerta(s) resolvido(s) expurgado(s) por retenção`)
    } catch (e: any) {
      console.error('[alertas] retenção falhou:', e?.message)
    }
  }
  setTimeout(async () => {
    await rodar()
    handlePurga = setInterval(rodar, 24 * 60 * 60 * 1000)
    console.log('[alertas] retenção iniciada — a cada 24h')
  }, 210_000)
}

export function stopAlertRetention(): void {
  if (handlePurga) { clearInterval(handlePurga); handlePurga = null }
}
