// src/services/clinicaExperts/sync.ts
//
// Espelho do agendamento daqui para a agenda da clínica.
//
// A direção é: **o bychat decide o horário e empurra**. O motor de slots local
// continua sendo quem manda; a clínica recebe o agendamento já fechado. Quem
// faz o caminho de volta é `ocupacao.ts`, que traz o que foi marcado direto lá
// como bloqueio — sem ele, a recepção marcando no sistema da clínica não
// apareceria aqui e dois pacientes cairiam no mesmo horário.
//
// Regras que valem para tudo neste arquivo:
//
//  · **Nunca derruba o agendamento local.** Se a clínica estiver fora do ar ou
//    recusar, a reserva daqui continua valendo e o erro vai para o log. Perder
//    o agendamento do paciente porque uma API de terceiro caiu seria pior que
//    ficar dessincronizado.
//  · **Idempotente.** Toda ligação passa por `ClinicaExpertsMapping`; repetir a
//    chamada não cria agendamento duplicado lá.

import { prisma } from '../../lib/prisma.js'
import { chamar, normalizarPagina, ClinicaExpertsError } from './client.js'
import { getConfig, integracaoAtiva } from './config.js'
import { isoComOffset } from './tempo.js'

const LOG = '[clinicaExperts]'

// ── Mapeamento ──────────────────────────────────────────────────────────────

type Entidade = 'booking' | 'patient' | 'professional'

/**
 * UUID atual do registro na clínica.
 *
 * Ordena pelo mais recente porque remarcar cria um agendamento NOVO lá (ver
 * `espelharRemarcacao`): a mesma reserva daqui acumula mais de uma linha, e a
 * que vale é a última. Pegar a primeira mandaria cancelamento para o
 * agendamento velho, deixando o novo de pé na agenda da clínica.
 */
async function uuidDe(entityType: Entidade, localId: number): Promise<string | null> {
  const m = await prisma.clinicaExpertsMapping.findFirst({
    where: { entityType, localId, NOT: { meta: { path: '$.substituido', equals: true } } },
    orderBy: { syncedAt: 'desc' },
    select: { ceUuid: true },
  }).catch(() => null)
  return m?.ceUuid ?? null
}

async function ligar(entityType: Entidade, ceUuid: string, localId: number, meta?: unknown): Promise<void> {
  await prisma.clinicaExpertsMapping.upsert({
    where: { entityType_ceUuid: { entityType, ceUuid } },
    create: { entityType, ceUuid, localId, meta: (meta ?? null) as never },
    update: { localId, meta: (meta ?? null) as never, syncedAt: new Date() },
  }).catch((e) => console.warn(`${LOG} falha ao gravar mapeamento ${entityType}/${ceUuid}: ${e?.message ?? e}`))
}

// ── Paciente ────────────────────────────────────────────────────────────────

/** Telefone no formato que a clínica usa nos exemplos: +55DDNNNNNNNNN. */
function telefoneE164(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D+/g, '')
  if (d.length < 10) return null
  return `+${d.startsWith('55') ? d : `55${d}`}`
}

/**
 * Encontra o paciente na clínica ou cria. A ordem importa: procurar primeiro
 * evita duplicar quem a recepção já cadastrou — a base da clínica é a que o
 * faturamento usa, e paciente repetido lá dá dor de cabeça de verdade.
 *
 * A busca é por telefone e depois por e-mail, que são os dois campos que o
 * agendamento sempre tem (o formulário exige um dos dois).
 */
export async function acharOuCriarPaciente(leadId: number): Promise<string | null> {
  const jaLigado = await uuidDe('patient', leadId)
  if (jaLigado) return jaLigado

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, nome: true, whatsapp: true, email: true },
  })
  if (!lead) return null

  const telefone = telefoneE164(lead.whatsapp)
  const email = (lead.email || '').trim().toLowerCase()
  const nome = (lead.nome || '').trim()

  // 1) Já existe lá?
  for (const filtro of [telefone ? { phone: telefone } : null, email ? { email } : null]) {
    if (!filtro) continue
    try {
      const r = await chamar<any>('/patients', { query: { ...filtro, per_page: 5 } })
      const { itens } = normalizarPagina<any>(r)
      const achado = itens.find((p) => p?.uuid)
      if (achado?.uuid) {
        await ligar('patient', achado.uuid, lead.id, { nome: achado.name ?? null, via: 'busca' })
        console.log(`${LOG} lead ${lead.id} ligado ao paciente ${achado.uuid} (já existia)`)
        return achado.uuid
      }
    } catch (e: any) {
      console.warn(`${LOG} busca de paciente falhou (${JSON.stringify(filtro)}): ${e?.message ?? e}`)
    }
  }

  // 2) Criar.
  if (!nome) {
    console.warn(`${LOG} lead ${lead.id} sem nome — a clínica exige nome para criar paciente`)
    return null
  }
  try {
    const r = await chamar<any>('/patients', {
      metodo: 'POST',
      corpo: {
        name: nome,
        ...(email ? { email } : {}),
        ...(telefone ? { phone: telefone } : {}),
        active: true,
      },
    })
    const uuid = r?.data?.uuid ?? r?.uuid ?? null
    if (!uuid) {
      console.warn(`${LOG} criação de paciente não devolveu uuid: ${JSON.stringify(r).slice(0, 200)}`)
      return null
    }
    await ligar('patient', uuid, lead.id, { nome, via: 'criado' })
    console.log(`${LOG} lead ${lead.id} → paciente ${uuid} criado`)
    return uuid
  } catch (e: any) {
    console.error(`${LOG} não consegui criar o paciente do lead ${lead.id}: ${e?.message ?? e}`)
    return null
  }
}

// ── Agendamento ─────────────────────────────────────────────────────────────

/** Profissional da clínica que atende este tipo de reunião. */
async function profissionalDoTipo(meetingTypeId: number): Promise<string | null> {
  const cfg = await getConfig()
  return cfg.profissionalPorTipo[String(meetingTypeId)] ?? null
}

/**
 * Cria o agendamento na clínica a partir de uma reserva local.
 *
 * `check_availability: true` é deliberado: sem ele a API aceita marcar em cima
 * de outro agendamento sem reclamar, e o conflito só apareceria na recepção no
 * dia. Preferimos falhar aqui, com log, a criar sobreposição lá.
 */
export async function espelharCriacao(bookingId: number): Promise<void> {
  if (!(await integracaoAtiva())) return

  const jaEspelhado = await uuidDe('booking', bookingId)
  if (jaEspelhado) return

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, leadId: true, meetingTypeId: true, startAt: true, endAt: true,
      inviteeName: true, answers: true, timezone: true, operatorUserId: true,
    },
  })
  if (!booking?.leadId) return

  // Quem atende: o que o paciente escolheu (fluxo em três passos) tem
  // precedência sobre o profissional fixo do tipo. Quando a reserva não veio
  // daquele fluxo, `_ceProfissionalUuid` não existe e vale a configuração.
  const { lerEscolha, profissionalDoUsuario } = await import('./linhaServico.js')
  const escolhido = lerEscolha(booking.answers)
  // Ordem de precedência, do mais específico para o mais genérico:
  //  1. o profissional que o paciente pediu;
  //  2. quem REALMENTE ficou com a reserva — é o caso do "não tenho
  //     preferência", em que o profissional só é decidido ao fechar e o
  //     gravado em `answers` é nulo. Sem este degrau o agendamento chegaria
  //     na clínica no nome de outra pessoa;
  //  3. o profissional fixo do tipo, para as reservas que não vieram do fluxo
  //     de procedimentos.
  const profissional = escolhido._ceProfissionalUuid
    || (booking.operatorUserId ? await profissionalDoUsuario(booking.operatorUserId) : null)
    || await profissionalDoTipo(booking.meetingTypeId)
  if (!profissional) {
    console.warn(`${LOG} reserva ${bookingId}: sem profissional (nem escolhido pelo paciente, nem configurado no tipo ${booking.meetingTypeId}) — nada espelhado`)
    return
  }

  const paciente = await acharOuCriarPaciente(booking.leadId)
  if (!paciente) {
    console.warn(`${LOG} reserva ${bookingId}: sem paciente na clínica — nada espelhado`)
    return
  }

  const cfg = await getConfig()
  const fuso = booking.timezone || 'America/Sao_Paulo'
  try {
    const r = await chamar<any>('/bookings', {
      metodo: 'POST',
      corpo: {
        starts_at: isoComOffset(booking.startAt, fuso),
        ends_at: isoComOffset(booking.endAt, fuso),
        status: 'scheduled',
        patient: paciente,
        professional: profissional,
        annotation: `Agendado pelo Attrae (reserva ${booking.id})`,
        // Procedimento escolhido pelo paciente; na falta dele, o padrão da
        // configuração. É o que faz o agendamento chegar na clínica já com o
        // serviço certo, e não como uma consulta genérica.
        ...(escolhido._ceProcedimentoId
          ? { procedures: [escolhido._ceProcedimentoId] }
          : cfg.procedimentoPadraoId ? { procedures: [cfg.procedimentoPadraoId] } : {}),
        ...(cfg.salaPadraoId ? { rooms: [cfg.salaPadraoId] } : {}),
        check_availability: true,
      },
    })
    // A documentação descreve o 200 como objeto vazio; na prática pode vir com
    // o registro. Aceita as duas formas e só desiste se não houver uuid.
    const uuid = r?.data?.uuid ?? r?.uuid ?? null
    if (!uuid) {
      console.warn(`${LOG} reserva ${bookingId}: clínica aceitou mas não devolveu uuid — sem mapeamento, cancelar/remarcar não vai propagar. Resposta: ${JSON.stringify(r).slice(0, 200)}`)
      return
    }
    await ligar('booking', uuid, booking.id, { startAt: isoComOffset(booking.startAt, fuso), status: 'scheduled' })
    console.log(`${LOG} reserva ${bookingId} → agendamento ${uuid} na clínica`)
  } catch (e: any) {
    const conflito = e instanceof ClinicaExpertsError && e.status === 422
    console.error(`${LOG} reserva ${bookingId} NÃO foi espelhada${conflito ? ' (horário recusado pela clínica)' : ''}: ${e?.message ?? e}`)
  }
}

/** Cancela na clínica o agendamento correspondente. */
export async function espelharCancelamento(bookingId: number, motivo?: string | null): Promise<void> {
  if (!(await integracaoAtiva())) return
  const uuid = await uuidDe('booking', bookingId)
  if (!uuid) return

  try {
    // PATCH sem corpo — a documentação não declara campos aqui. O motivo do
    // cancelamento fica no registro daqui; se um dia a API aceitar, passa a ir
    // junto (`annotation`).
    void motivo
    await chamar(`/bookings/${uuid}/cancel`, { metodo: 'PATCH' })
    await ligar('booking', uuid, bookingId, { status: 'canceled' })
    console.log(`${LOG} reserva ${bookingId} cancelada na clínica (${uuid})`)
  } catch (e: any) {
    console.error(`${LOG} falha ao cancelar ${uuid} na clínica: ${e?.message ?? e}`)
  }
}

/**
 * Remarca na clínica.
 *
 * ⚠️ `PATCH /bookings/{uuid}/reschedule` **não muda horário**. Testado contra a
 * API real com quatro corpos diferentes (`starts_at`/`ends_at`,
 * `new_starts_at`, `date`+`start`, e só `starts_at`): todos responderam 200 e
 * mantiveram o horário original — o endpoint só troca o status para
 * `rescheduled`, como `cancel` e `confirm` fazem com os deles.
 *
 * O fluxo certo, então, é o que a própria clínica usa: marcar o antigo como
 * remarcado (preserva o histórico do paciente) e **criar um agendamento novo**
 * no horário novo. Por isso a reserva local passa a ter mais de um uuid ligado,
 * e `uuidDe()` devolve sempre o mais recente.
 */
export async function espelharRemarcacao(bookingId: number): Promise<void> {
  if (!(await integracaoAtiva())) return
  const uuidAntigo = await uuidDe('booking', bookingId)
  if (!uuidAntigo) {
    // Reserva que nunca chegou lá (integração ligada depois, ou falha antes):
    // remarcar vira criar, senão ela nunca aparece na agenda da clínica.
    await espelharCriacao(bookingId)
    return
  }

  // 1) Marca o antigo como remarcado e o tira de circulação, para o próximo
  //    cancelamento não mirar nele.
  try {
    await chamar(`/bookings/${uuidAntigo}/reschedule`, { metodo: 'PATCH' })
  } catch (e: any) {
    console.warn(`${LOG} não consegui marcar ${uuidAntigo} como remarcado: ${e?.message ?? e}`)
  }
  await prisma.clinicaExpertsMapping.updateMany({
    where: { entityType: 'booking', ceUuid: uuidAntigo },
    data: { meta: { substituido: true, status: 'rescheduled' } as never },
  }).catch(() => {})

  // 2) Cria o agendamento no horário novo. Sem isto a clínica ficaria só com um
  //    registro remarcado e nenhum horário marcado — pior que não ter mexido.
  await espelharCriacao(bookingId)
}

/** Confirmação do paciente (status scheduled → confirmed daqui). */
export async function espelharConfirmacao(bookingId: number): Promise<void> {
  if (!(await integracaoAtiva())) return
  const uuid = await uuidDe('booking', bookingId)
  if (!uuid) return
  try {
    await chamar(`/bookings/${uuid}/confirm`, { metodo: 'PATCH' })
    await ligar('booking', uuid, bookingId, { status: 'confirmed' })
  } catch (e: any) {
    console.warn(`${LOG} falha ao confirmar ${uuid} na clínica: ${e?.message ?? e}`)
  }
}

/** Falta do paciente. */
export async function espelharNoShow(bookingId: number): Promise<void> {
  if (!(await integracaoAtiva())) return
  const uuid = await uuidDe('booking', bookingId)
  if (!uuid) return
  try {
    // `/no-show`, com hífen — diferente do valor `noshow` usado no campo status.
    await chamar(`/bookings/${uuid}/no-show`, { metodo: 'PATCH' })
    await ligar('booking', uuid, bookingId, { status: 'noshow' })
  } catch (e: any) {
    console.warn(`${LOG} falha ao marcar falta em ${uuid}: ${e?.message ?? e}`)
  }
}

// ── Disparo em segundo plano ────────────────────────────────────────────────

/**
 * Envolve o espelho para nunca bloquear nem derrubar quem chamou. Todos os
 * ganchos no fluxo de agendamento usam esta função: o paciente não pode ficar
 * esperando a API da clínica responder para ver a tela de confirmação.
 */
export function emSegundoPlano(fn: () => Promise<void>, contexto: string): void {
  void fn().catch((e) => console.error(`${LOG} ${contexto}: ${e?.message ?? e}`))
}
