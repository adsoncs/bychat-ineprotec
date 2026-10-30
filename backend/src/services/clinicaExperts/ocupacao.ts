// src/services/clinicaExperts/ocupacao.ts
//
// Traz para cá o que foi marcado DIRETO na clínica.
//
// Por que isto existe: quem decide os horários é o motor de slots daqui, mas a
// recepção continua marcando pelo sistema da clínica. Sem trazer essa ocupação,
// o bychat ofereceria um horário que lá já está tomado e dois pacientes cairiam
// na mesma hora — o único jeito de errar feio numa agenda de clínica.
//
// A ocupação entra como `CalendarBlock` porque `operatorBusy()` (o que alimenta
// o cálculo de slots) já lê essa tabela. Nenhuma linha do motor de agenda
// precisou mudar: o horário ocupado lá simplesmente deixa de ser oferecido aqui.
//
// Agendamento que NÓS criamos é ignorado na importação — ele já existe como
// Booking local e viraria um bloqueio em cima da própria reserva.

import { prisma } from '../../lib/prisma.js'
import { chamar, normalizarPagina } from './client.js'
import { getConfig, integracaoAtiva } from './config.js'
import { inicioDoDia, fimDoDia } from './tempo.js'

const LOG = '[clinicaExperts/ocupacao]'

/** Marca dos bloqueios criados por esta importação, para poder substituí-los
 *  sem tocar nos bloqueios manuais do operador. */
const ORIGEM = 'clinica_experts'

/** Status que ocupam a agenda de verdade. Cancelado e falta liberam o horário. */
const STATUS_OCUPAM = new Set(['scheduled', 'confirmed', 'waiting', 'progress', 'done', 'rescheduled'])

interface Resultado {
  importados: number
  removidos: number
  profissionais: number
  erro?: string
}

/**
 * Varre a agenda da clínica na janela configurada e reescreve os bloqueios de
 * origem `clinica_experts`.
 *
 * A varredura é por profissional configurado, porque é assim que sabemos em
 * qual agenda local o horário ocupa — o vínculo é
 * `MeetingType → profissional da clínica → operador dono do tipo`.
 */
export async function importarOcupacao(): Promise<Resultado> {
  if (!(await integracaoAtiva())) return { importados: 0, removidos: 0, profissionais: 0, erro: 'integração inativa' }

  const cfg = await getConfig()
  if (!cfg.importarOcupacao) return { importados: 0, removidos: 0, profissionais: 0, erro: 'importação desligada' }

  const inicio = new Date()
  const fim = new Date(Date.now() + cfg.diasDeOcupacao * 86400000)

  // Quem observar, e em qual agenda daqui o horário ocupado entra.
  //
  // Duas fontes, porque há dois jeitos de ligar gente:
  //   · `profissionalPorUsuario` — o de-para pessoa a pessoa, usado pelo fluxo
  //     de procedimentos. É o mais direto: o horário ocupado do profissional lá
  //     bloqueia a agenda do usuário correspondente aqui.
  //   · `profissionalPorTipo` — o tipo simples, com um profissional fixo; ali a
  //     agenda que ocupa é a do operador dono do tipo.
  //
  // Sem a primeira fonte a proteção não cobria o fluxo novo, e a página oferecia
  // horário que a clínica recusava com 409 na hora de espelhar.
  const operadorPorProfissional = new Map<string, Set<number>>()
  const ligar = (uuid: string, usuarioId: number) => {
    const set = operadorPorProfissional.get(uuid) ?? new Set<number>()
    set.add(usuarioId)
    operadorPorProfissional.set(uuid, set)
  }

  for (const [usuarioId, uuid] of Object.entries(cfg.profissionalPorUsuario)) {
    if (uuid && Number(usuarioId) > 0) ligar(uuid, Number(usuarioId))
  }

  for (const [meetingTypeId, uuid] of Object.entries(cfg.profissionalPorTipo)) {
    if (!uuid) continue
    const mt = await prisma.meetingType.findUnique({
      where: { id: Number(meetingTypeId) },
      select: { ownerUserId: true },
    }).catch(() => null)
    if (mt?.ownerUserId) ligar(uuid, mt.ownerUserId)
  }

  if (!operadorPorProfissional.size) {
    return {
      importados: 0, removidos: 0, profissionais: 0,
      erro: 'nenhum profissional ligado a um usuário daqui — configure o de-para, ou o responsável do tipo',
    }
  }

  // UUIDs que nós mesmos criamos: não viram bloqueio.
  const nossos = new Set(
    (await prisma.clinicaExpertsMapping.findMany({
      where: { entityType: 'booking' },
      select: { ceUuid: true },
    }).catch(() => [])).map((m) => m.ceUuid),
  )

  const blocos: Array<{ operatorUserId: number; startAt: Date; endAt: Date; title: string; ceUuid: string }> = []
  let erro: string | undefined

  for (const [profissionalUuid, operadores] of operadorPorProfissional) {
    let page = 1
    // Teto de páginas: a janela é de dias, não de anos — se passar disso, é
    // sinal de filtro errado, e varrer sem limite queimaria a cota de 120/min.
    const MAX_PAGINAS = 20
    while (page <= MAX_PAGINAS) {
      try {
        const r = await chamar<any>('/bookings', {
          query: {
            // Dia inteiro, das 00:00 às 23:59: a API cruza data COM hora do
            // dia, e uma janela que começa no horário atual devolve zero.
            starts_at: inicioDoDia(inicio),
            ends_at: fimDoDia(fim),
            professional: profissionalUuid,
            page,
          },
        })
        const { itens, meta } = normalizarPagina<any>(r)
        for (const b of itens) {
          if (!b?.uuid || nossos.has(b.uuid)) continue
          if (b.status && !STATUS_OCUPAM.has(String(b.status))) continue
          const startAt = new Date(b.starts_at)
          const endAt = new Date(b.ends_at)
          if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) continue
          const nomePaciente = b.patient?.name ? String(b.patient.name) : 'Paciente'
          for (const operatorUserId of operadores) {
            blocos.push({
              operatorUserId,
              startAt,
              endAt,
              title: `Clínica: ${nomePaciente}`.slice(0, 191),
              ceUuid: b.uuid,
            })
          }
        }
        if (!meta || page >= (meta.last_page ?? 1)) break
        page++
      } catch (e: any) {
        erro = e?.message ?? String(e)
        console.error(`${LOG} falha ao ler a agenda do profissional ${profissionalUuid}: ${erro}`)
        // Interrompe SÓ este profissional. Abortar tudo por causa de um deixaria
        // a agenda dos outros sem atualização nenhuma.
        break
      }
    }
  }

  // Se a leitura falhou e não veio nada, não apaga o que já existe: a agenda
  // ficaria artificialmente livre e o bychat passaria a oferecer horário
  // ocupado — exatamente o que esta importação evita.
  if (erro && !blocos.length) {
    return { importados: 0, removidos: 0, profissionais: operadorPorProfissional.size, erro }
  }

  const operadoresTocados = [...new Set([...operadorPorProfissional.values()].flatMap((s) => [...s]))]

  const removidos = await prisma.calendarBlock.deleteMany({
    where: {
      source: ORIGEM,
      operatorUserId: { in: operadoresTocados },
      startAt: { lt: fim },
      endAt: { gt: inicio },
    },
  }).then((r) => r.count).catch(() => 0)

  let importados = 0
  if (blocos.length) {
    importados = await prisma.calendarBlock.createMany({
      data: blocos.map((b) => ({
        operatorUserId: b.operatorUserId,
        title: b.title,
        kind: 'busy',
        startAt: b.startAt,
        endAt: b.endAt,
        allDay: false,
        source: ORIGEM,
        note: `Agendamento da Clinica Experts (${b.ceUuid})`,
      })),
    }).then((r) => r.count).catch((e) => {
      console.error(`${LOG} falha ao gravar bloqueios: ${e?.message ?? e}`)
      return 0
    })
  }

  console.log(`${LOG} ${importados} horário(s) da clínica bloqueados aqui (${removidos} substituídos, ${operadorPorProfissional.size} profissional(is))`)
  return { importados, removidos, profissionais: operadorPorProfissional.size, erro }
}

// ── Agendamento periódico ───────────────────────────────────────────────────

/** De quanto em quanto tempo a agenda da clínica é relida. */
const INTERVALO_MS = 15 * 60_000

let timer: NodeJS.Timeout | null = null

export function startOcupacaoClinicaExperts(): void {
  if (timer) return
  const rodar = () => { void importarOcupacao().catch(() => {}) }
  // Primeira passada alguns minutos após subir: no boot o processo já tem
  // migration, cache e workers competindo, e a agenda não muda em 3 minutos.
  setTimeout(rodar, 3 * 60_000)
  timer = setInterval(rodar, INTERVALO_MS)
  console.log(`${LOG} importação de ocupação agendada (a cada ${INTERVALO_MS / 60000} min; só roda com a integração ativa)`)
}
