// src/services/meetingOutcome.ts
//
// O desfecho da reunião: aconteceu, não aconteceu, ou ninguém sabe.
//
// O problema que isto resolve: em 03/09/2026 havia 34 reuniões passadas ainda
// como "agendada", e o status `completed` NUNCA tinha sido usado — nenhuma vez,
// em toda a história do sistema. Não por falta de botão: a tela de Agenda já
// oferece "Concluída" e "Não compareceu" no modal da reunião, e o "Cancelar" do
// MESMO modal foi usado 53 vezes.
//
// A diferença entre 53 e 0 não é o botão, é o momento. Cancelar acontece ANTES,
// quando a pessoa está olhando a agenda da semana e vê o compromisso que vai
// cair. O desfecho acontece DEPOIS — e ninguém volta à agenda para olhar o
// passado. O caminho existia e não passava ninguém por ele.
//
// Daí as duas frentes aqui:
//   1. `fecharPelaGravacao` — quando o bot gravou a reunião, ela aconteceu.
//      Ninguém precisa responder nada. É o único caminho que não pede trabalho.
//   2. `varrerReunioesSemDesfecho` — para o que o bot não cobre, um alerta que
//      leva a pergunta até onde a pessoa está, em vez de esperar que ela volte.

import { prisma } from '../lib/prisma.js'
import { raiseAlert, resolverAusentes, produtorDesligado } from './alertService.js'

/** Status de reunião que ainda esperam desfecho. */
const SEM_DESFECHO = ['scheduled', 'confirmed'] as const

/** Família dos alertas de reunião pendente — usada para fechar em lote. */
export const KIND_REUNIAO = 'meeting.no_outcome'

/**
 * Só reuniões recentes viram alerta.
 *
 * As 34 pendentes de hoje são passivo — algumas de agosto — e despejá-las de
 * uma vez transformaria o sino em ruído no primeiro dia, que é exatamente como
 * se perde a confiança num alerta. O passivo antigo precisa de uma decisão
 * humana, não de uma enxurrada.
 */
const JANELA_DIAS = 7

/** Tolerância depois do fim da reunião antes de cobrar o desfecho. */
const CARENCIA_MIN = 30

/**
 * Encontra o agendamento de uma reunião a partir do link do Meet.
 *
 * O vigia da agenda Google dispara o bot a partir do evento do calendário e não
 * conhece lead nem reserva — o link é o único fio comum. O casamento é
 * restringido por tempo porque sala de Meet se repete: uma sala fixa usada toda
 * semana casaria com a reserva errada sem essa trava.
 */
export async function resolverBookingPorLink(
  meetUrl: string,
  quando: Date,
  toleranciaHoras = 3,
): Promise<number | null> {
  if (!meetUrl?.trim()) return null
  const ms = toleranciaHoras * 3600_000
  const b = await prisma.booking.findFirst({
    where: {
      meetLink: meetUrl,
      startAt: { gte: new Date(quando.getTime() - ms), lte: new Date(quando.getTime() + ms) },
    },
    orderBy: { startAt: 'desc' },
    select: { id: true },
  })
  return b?.id ?? null
}

/**
 * A gravação terminou, logo a reunião aconteceu.
 *
 * Nunca sobrescreve um desfecho que uma pessoa já deu: cancelada, não
 * compareceu e concluída ficam como estão. O `updateMany` com o filtro de
 * status é o que garante isso mesmo se dois caminhos rodarem ao mesmo tempo.
 */
export async function fecharPelaGravacao(recordingId: number): Promise<boolean> {
  const rec = await prisma.meetingRecording.findUnique({
    where: { id: recordingId },
    select: { id: true, bookingId: true, meetingUrl: true, startedAt: true, createdAt: true, status: true },
  })
  if (!rec || rec.status !== 'completed') return false

  let bookingId = rec.bookingId
  if (!bookingId) {
    // Gravação disparada pelo vigia da agenda não traz a reserva; tenta o link.
    bookingId = await resolverBookingPorLink(rec.meetingUrl, rec.startedAt || rec.createdAt)
    if (bookingId) {
      await prisma.meetingRecording.update({ where: { id: rec.id }, data: { bookingId } })
    }
  }
  if (!bookingId) return false

  const r = await prisma.booking.updateMany({
    where: { id: bookingId, status: { in: SEM_DESFECHO as unknown as string[] } },
    data: { status: 'completed' },
  })
  if (r.count === 0) return false

  // A atividade da timeline anda junto — é o mesmo compromisso visto do lado do
  // lead, e deixá-la "pendente" faria o lead parecer com pendência aberta.
  const bk = await prisma.booking.findUnique({ where: { id: bookingId }, select: { activityId: true } })
  if (bk?.activityId) {
    await prisma.activity.updateMany({
      where: { id: bk.activityId, status: { notIn: ['completed', 'cancelled'] } },
      data: { status: 'completed', completedAt: new Date() },
    })
  }

  // O alerta some sozinho: a condição que o gerou deixou de existir.
  await resolverAusentesDaReuniao(bookingId)
  console.log(`[reuniao] booking ${bookingId} concluído pela gravação #${recordingId}`)
  return true
}

/** Fecha o alerta de uma reserva específica. */
async function resolverAusentesDaReuniao(bookingId: number): Promise<void> {
  await prisma.alert.updateMany({
    where: { dedupeKey: chaveDoAlerta(bookingId), status: 'open' },
    data: { status: 'resolved', resolvedAt: new Date() },
  })
}

export function chaveDoAlerta(bookingId: number): string {
  return `meeting:no_outcome:${bookingId}`
}

/**
 * Varre as reuniões que já passaram e ainda não têm desfecho.
 *
 * Alerta de severidade `info` e audiência `owner`: é trabalho de quem conduziu a
 * reunião, com a gestão junto para enxergar a fila. `resolverAusentes` fecha
 * sozinho tudo que saiu da lista — a reunião que ganhou desfecho por qualquer
 * caminho (botão na agenda, gravação, ação no alerta) some do sino sem que
 * ninguém precise limpar nada.
 */
export async function varrerReunioesSemDesfecho(): Promise<{ abertos: number; fechados: number }> {
  const desligado = await produtorDesligado(KIND_REUNIAO)
  if (desligado) return desligado

  const agora = Date.now()
  const limite = new Date(agora - CARENCIA_MIN * 60_000)
  const desde = new Date(agora - JANELA_DIAS * 86400_000)

  const pendentes = await prisma.booking.findMany({
    where: {
      status: { in: SEM_DESFECHO as unknown as string[] },
      endAt: { lt: limite, gte: desde },
    },
    select: {
      id: true, startAt: true, operatorUserId: true, inviteeName: true,
      meetingTypeId: true, leadId: true,
    },
    orderBy: { startAt: 'asc' },
    take: 100,
  })

  if (!pendentes.length) return { abertos: 0, fechados: await resolverAusentes(KIND_REUNIAO, []) }

  // Nomes resolvidos em duas consultas, não uma por reunião: `Booking` não
  // declara relação com MeetingType (só guarda o id), e o laço abaixo roda para
  // cada pendência.
  const nomesLead = new Map(
    (await prisma.lead.findMany({
      where: { id: { in: [...new Set(pendentes.map((b) => b.leadId).filter((x): x is number => !!x))] } },
      select: { id: true, nome: true },
    })).map((l) => [l.id, l.nome]),
  )
  const nomesTipo = new Map(
    (await prisma.meetingType.findMany({
      where: { id: { in: [...new Set(pendentes.map((b) => b.meetingTypeId))] } },
      select: { id: true, name: true },
    })).map((t) => [t.id, t.name]),
  )

  const vivas: string[] = []
  for (const b of pendentes) {
    const quem = (b.leadId ? nomesLead.get(b.leadId) : null) || b.inviteeName || 'sem nome'
    const quando = b.startAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const chave = chaveDoAlerta(b.id)
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave,
      kind: KIND_REUNIAO,
      severity: 'info',
      audience: 'owner',
      ownerUserId: b.operatorUserId,
      title: `Reunião sem desfecho: ${quem}`,
      body: `${nomesTipo.get(b.meetingTypeId) || 'Reunião'} de ${quando}. Aconteceu ou o contato não veio?`,
      entityType: 'booking',
      entityId: b.id,
      metadata: { startAt: b.startAt.toISOString(), contato: quem },
    })
  }

  const fechados = await resolverAusentes(KIND_REUNIAO, vivas)
  return { abertos: vivas.length, fechados }
}

/**
 * Desfecho dado por uma pessoa — é o que os botões do alerta chamam.
 *
 * Aceita só os dois desfechos que a pergunta admite. Cancelamento continua onde
 * sempre esteve (a agenda), porque cancelar é decisão de antes da reunião e
 * misturar as duas coisas no mesmo lugar convida ao clique errado.
 */
export async function registrarDesfecho(
  bookingId: number,
  desfecho: 'completed' | 'no_show',
): Promise<boolean> {
  const r = await prisma.booking.updateMany({
    where: { id: bookingId, status: { in: SEM_DESFECHO as unknown as string[] } },
    data: { status: desfecho },
  })
  if (r.count === 0) return false

  const bk = await prisma.booking.findUnique({ where: { id: bookingId }, select: { activityId: true } })
  if (bk?.activityId) {
    await prisma.activity.updateMany({
      where: { id: bk.activityId, status: { notIn: ['completed', 'cancelled'] } },
      // "Não veio" não é conclusão: a atividade tem de sair da fila, não virar
      // registro de reunião realizada. Se ficasse pendente, venceria e viraria
      // um alerta de atraso cobrando uma reunião que já falhou.
      data:
        desfecho === 'completed'
          ? { status: 'completed', completedAt: new Date() }
          : { status: 'cancelled' },
    })
  }
  await resolverAusentesDaReuniao(bookingId)
  return true
}

/** Família dos alertas de bot que não conseguiu gravar. */
export const KIND_BOT = 'meeting.bot_failed'

/** Só falhas recentes: bot que falhou semana passada não tem mais o que salvar. */
const JANELA_BOT_H = 48

/**
 * O bot tentou gravar e não conseguiu.
 *
 * Motivo de existir: das 21 gravações do beyond, **14 falharam** — dois terços —
 * e ninguém nunca soube. É também a explicação de a cobertura automática de
 * desfecho ser tão baixa: o caminho que fecharia a reunião sozinha é justamente
 * o que está quebrando calado.
 *
 * Vai para a gestão, não para o dono da reunião: bot que não entra é problema de
 * configuração ou de licença, e não há nada que o vendedor possa fazer com esse
 * aviso.
 */
export async function varrerBotsQueFalharam(): Promise<{ abertos: number; fechados: number }> {
  const desligado = await produtorDesligado(KIND_BOT)
  if (desligado) return desligado

  const desde = new Date(Date.now() - JANELA_BOT_H * 3600_000)
  const falhas = await prisma.meetingRecording.findMany({
    where: { status: 'failed', createdAt: { gte: desde } },
    select: { id: true, title: true, errorReason: true, createdAt: true, userId: true, meetingUrl: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  const vivas: string[] = []
  for (const f of falhas) {
    const chave = `meeting:bot_failed:${f.id}`
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave,
      kind: KIND_BOT,
      severity: 'warning',
      audience: 'management',
      title: `Gravação falhou: ${f.title || 'reunião'}`,
      body: `${f.errorReason ? `${String(f.errorReason).slice(0, 240)}. ` : 'O bot não conseguiu entrar na sala. '}`
        + 'Sem gravação, a reunião não se fecha sozinha e alguém precisa dar o desfecho à mão.',
      entityType: 'meeting_recording',
      entityId: f.id,
      metadata: { quando: f.createdAt.toISOString(), url: f.meetingUrl },
    })
  }

  const fechados = await resolverAusentes(KIND_BOT, vivas)
  return { abertos: vivas.length, fechados }
}

// ── Vigilante ───────────────────────────────────────────────────────────────
//
// Roda de hora em hora, não a cada minuto: reunião sem desfecho não é urgência,
// é pendência. Um tick por minuto só gastaria banco para reencontrar exatamente
// a mesma lista.

let handle: ReturnType<typeof setInterval> | null = null
const INTERVALO_MS = 60 * 60 * 1000

export function startMeetingOutcomeWatch(): void {
  // A primeira volta espera o servidor terminar de subir; sem isso ela disputa
  // banco com todo o resto da inicialização para produzir uma lista que ninguém
  // vai ler nos primeiros segundos.
  setTimeout(async () => {
    await rodar()
    handle = setInterval(rodar, INTERVALO_MS)
    console.log('[reuniao] vigia de desfecho iniciado — a cada 60min')
  }, 90_000)
}

async function rodar(): Promise<void> {
  // As duas varreduras são independentes de propósito: uma falhar não pode
  // impedir a outra de rodar.
  try {
    const r = await varrerReunioesSemDesfecho()
    if (r.abertos || r.fechados) {
      console.log(`[reuniao] ${r.abertos} sem desfecho, ${r.fechados} alerta(s) fechado(s)`)
    }
  } catch (e: any) {
    console.error('[reuniao] varredura de desfecho falhou:', e?.message)
  }
  try {
    const b = await varrerBotsQueFalharam()
    if (b.abertos || b.fechados) {
      console.log(`[reuniao] ${b.abertos} bot(s) com falha, ${b.fechados} alerta(s) fechado(s)`)
    }
  } catch (e: any) {
    console.error('[reuniao] varredura de bot falhou:', e?.message)
  }
}

export function stopMeetingOutcomeWatch(): void {
  if (handle) { clearInterval(handle); handle = null }
}
