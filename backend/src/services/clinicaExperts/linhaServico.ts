// src/services/clinicaExperts/linhaServico.ts
//
// O agendamento em três passos: procedimento → profissional → horário.
//
// Toda a lógica nova mora aqui, e não no motor de agendamento, de propósito:
// `schedulingService.ts` e `schedulingPublic.ts` são iguais nos 13 tenants, e
// customizá-los quebraria as âncoras de replicação. O que eles ganham é um
// gancho curto que só faz alguma coisa quando o tipo TEM linha configurada —
// tipo sem linha segue pelo caminho de sempre, byte por byte.
//
// Por que o procedimento vem antes do horário: cada procedimento tem a própria
// duração na clínica (5 min para "Depilação LED - Nariz", 60 para "Limpeza de
// Pele Rosto"). Escolhendo primeiro, a duração certa entra no cálculo dos
// horários sem o motor precisar saber que existe procedimento nenhum.

import { prisma } from '../../lib/prisma.js'
import { computeSlots, type DaySlots } from '../schedulingSlots.js'
import { operatorBusy, resolveScheduleForType } from '../schedulingService.js'
import { chamar, normalizarPagina } from './client.js'
import { getConfig, type LinhaDeServico } from './config.js'
import { filtrarPelaClinica } from './disponibilidade.js'

const LOG = '[clinicaExperts/linha]'

/** Procedimento como o paciente vê. */
export interface ProcedimentoOferecido {
  id: number
  nome: string
  duracaoMin: number
}

/** Profissional como o paciente vê. Sem uuid: o que vai para a tela é o
 *  usuário daqui, e o uuid da clínica é resolvido no servidor. */
export interface ProfissionalOferecido {
  usuarioId: number
  nome: string
}

/** Cache curto do catálogo. São 108 procedimentos e o limite lá é de 120
 *  chamadas por minuto — reler a cada visita da página pública seria desperdício
 *  (e a lista muda de mês em mês, não de minuto em minuto). */
let catalogo: { em: number; porId: Map<number, ProcedimentoOferecido> } | null = null
const CACHE_MS = 10 * 60_000

async function carregarCatalogo(): Promise<Map<number, ProcedimentoOferecido>> {
  if (catalogo && Date.now() - catalogo.em < CACHE_MS) return catalogo.porId

  const porId = new Map<number, ProcedimentoOferecido>()
  let page = 1
  while (page <= 6) {
    const r = await chamar<any>('/procedures', { query: { per_page: 100, page } })
    const { itens, meta } = normalizarPagina<any>(r)
    for (const p of itens) {
      if (!p?.id || p.active === false) continue
      porId.set(Number(p.id), {
        id: Number(p.id),
        nome: String(p.name ?? '').trim(),
        duracaoMin: Number(p.duration) > 0 ? Number(p.duration) : 30,
      })
    }
    if (!meta || page >= (meta.last_page ?? 1)) break
    page++
  }
  catalogo = { em: Date.now(), porId }
  return porId
}

/** Descarta o catálogo — usado pela tela de configuração ao salvar. */
export function esquecerCatalogo(): void {
  catalogo = null
}

/** A linha de serviço de um tipo, se houver. */
export async function linhaDoTipo(meetingTypeId: number): Promise<LinhaDeServico | null> {
  const cfg = await getConfig()
  const linha = cfg.linhas[String(meetingTypeId)]
  if (!linha) return null
  // Linha sem procedimento ou sem gente não é linha: o tipo cai no caminho
  // antigo em vez de mostrar uma tela de escolha vazia ao paciente.
  if (!linha.procedimentos?.length || !linha.usuarios?.length) return null
  return linha
}

/** O tipo pergunta procedimento e profissional antes do horário? */
export async function tipoTemLinha(meetingTypeId: number): Promise<boolean> {
  return (await linhaDoTipo(meetingTypeId)) !== null
}

/** Procedimentos que este tipo oferece, com a duração de cada um. */
export async function procedimentosDoTipo(meetingTypeId: number): Promise<ProcedimentoOferecido[]> {
  const linha = await linhaDoTipo(meetingTypeId)
  if (!linha) return []
  const cat = await carregarCatalogo().catch((e) => {
    console.warn(`${LOG} catálogo indisponível: ${e?.message ?? e}`)
    return new Map<number, ProcedimentoOferecido>()
  })
  return linha.procedimentos
    .map((id) => cat.get(Number(id)))
    .filter((p): p is ProcedimentoOferecido => !!p)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Duração do procedimento escolhido; `null` quando não é da linha (o que
 *  também serve de validação: procedimento forjado não passa). */
export async function duracaoDoProcedimento(meetingTypeId: number, procedimentoId: number): Promise<number | null> {
  const oferecidos = await procedimentosDoTipo(meetingTypeId)
  return oferecidos.find((p) => p.id === Number(procedimentoId))?.duracaoMin ?? null
}

/**
 * Quem atende esta linha.
 *
 * Só entra quem tem vínculo com um profissional da clínica **e** está ativo
 * aqui: um usuário desligado no meio do caminho não pode continuar sendo
 * oferecido ao paciente.
 *
 * O vínculo procedimento→profissional que a clínica mantém NÃO é usado como
 * filtro. Motivo medido: dos 100 procedimentos ativos, 57 não têm profissional
 * nenhum, e o mais vinculado (20 procedimentos) está inativo lá. Seguir aquele
 * cadastro mandaria o paciente para quem não atende mais. Ele serve como
 * sugestão na tela de configuração; quem decide é a configuração daqui.
 */
export async function profissionaisDaLinha(meetingTypeId: number): Promise<ProfissionalOferecido[]> {
  const linha = await linhaDoTipo(meetingTypeId)
  if (!linha) return []
  const cfg = await getConfig()

  const usuarios = await prisma.user.findMany({
    where: { id: { in: linha.usuarios.map(Number) }, active: true },
    select: { id: true, name: true, email: true },
  }).catch(() => [])

  return usuarios
    .filter((u) => !!cfg.profissionalPorUsuario[String(u.id)])
    .map((u) => ({ usuarioId: u.id, nome: (u.name || u.email || `Usuário ${u.id}`).trim() }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** O uuid da clínica para um usuário daqui. */
export async function profissionalDoUsuario(usuarioId: number): Promise<string | null> {
  const cfg = await getConfig()
  return cfg.profissionalPorUsuario[String(usuarioId)] ?? null
}

/**
 * Confere o que o paciente escolheu e devolve pronto para uso.
 *
 * `usuarioId` nulo é "sem preferência" — legítimo, e resolvido na hora de
 * fechar, entre quem estiver livre no horário.
 */
export interface EscolhaValidada {
  procedimentoId: number
  duracaoMin: number
  usuarioId: number | null
}

export async function validarEscolha(
  meetingTypeId: number,
  procedimentoId: unknown,
  usuarioId: unknown,
): Promise<{ ok: true; escolha: EscolhaValidada } | { ok: false; erro: string }> {
  const pid = Number(procedimentoId)
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, erro: 'Escolha o procedimento.' }

  const duracao = await duracaoDoProcedimento(meetingTypeId, pid)
  if (!duracao) return { ok: false, erro: 'Esse procedimento não está mais disponível. Escolha outro.' }

  if (usuarioId === null || usuarioId === undefined || usuarioId === '' || usuarioId === 'any') {
    return { ok: true, escolha: { procedimentoId: pid, duracaoMin: duracao, usuarioId: null } }
  }

  const uid = Number(usuarioId)
  const disponiveis = await profissionaisDaLinha(meetingTypeId)
  if (!disponiveis.some((p) => p.usuarioId === uid)) {
    return { ok: false, erro: 'Esse profissional não atende esse procedimento. Escolha outro.' }
  }
  return { ok: true, escolha: { procedimentoId: pid, duracaoMin: duracao, usuarioId: uid } }
}

/** O que fica gravado na reserva para o espelho usar depois. Vai dentro de
 *  `booking.answers`, com prefixo `_ce`, junto das respostas do formulário. */
export interface EscolhaGravada {
  _ceProcedimentoId: number
  _ceDuracaoMin: number
  _ceProfissionalUuid: string | null
}

export async function escolhaParaGravar(escolha: EscolhaValidada): Promise<EscolhaGravada> {
  return {
    _ceProcedimentoId: escolha.procedimentoId,
    _ceDuracaoMin: escolha.duracaoMin,
    _ceProfissionalUuid: escolha.usuarioId ? await profissionalDoUsuario(escolha.usuarioId) : null,
  }
}

/** Lê de volta o que foi gravado na reserva. */
export function lerEscolha(answers: unknown): Partial<EscolhaGravada> {
  const a = (answers ?? {}) as Record<string, unknown>
  return {
    _ceProcedimentoId: typeof a._ceProcedimentoId === 'number' ? a._ceProcedimentoId : undefined,
    _ceDuracaoMin: typeof a._ceDuracaoMin === 'number' ? a._ceDuracaoMin : undefined,
    _ceProfissionalUuid: typeof a._ceProfissionalUuid === 'string' ? a._ceProfissionalUuid : null,
  }
}

// ── Horários de um profissional ─────────────────────────────────────────────

type TipoDeAgendamento = {
  id: number; timezone: string; slotIncrementMin: number
  bufferBeforeMin: number; bufferAfterMin: number; minNoticeMin: number
  bookingWindowDays: number; maxPerDay: number | null; visibleSlotsPerDay: number | null
}

/**
 * A grade de um profissional para este tipo, com a duração do procedimento.
 *
 * **Fonte única de verdade**, usada tanto para oferecer os horários quanto para
 * decidir quem atende. Precisa bater exatamente com o que `getMeetingTypeSlots`
 * produz para o mesmo profissional, senão a página oferece um horário que o
 * motor recusa ao fechar — foi o que aconteceu com `visibleSlotsPerDay`: o tipo
 * mostra só os 3 primeiros horários de cada dia, e ignorar esse teto aqui fazia
 * o 4º horário aparecer na tela e ser negado na confirmação.
 *
 * Por isso TODOS os limites do tipo são repassados. O único ponto em que somos
 * mais rigorosos é a ocupação (`operatorBusy` inclui os compromissos do CRM):
 * oferecer de menos é seguro; de mais, não.
 */
export async function slotsDoProfissional(
  mt: TipoDeAgendamento,
  usuarioId: number,
  duracaoMin: number,
  opts: { from?: string; to?: string } = {},
): Promise<DaySlots[]> {
  const { rules, exceptions } = await resolveScheduleForType({ id: mt.id, ownerUserId: usuarioId })
  const fim = new Date(Date.now() + mt.bookingWindowDays * 86400000)
  const ocupado = await operatorBusy(usuarioId, new Date(), fim)
  const dias = computeSlots({
    timezone: mt.timezone,
    durationMin: duracaoMin,
    slotIncrementMin: mt.slotIncrementMin,
    bufferBeforeMin: mt.bufferBeforeMin,
    bufferAfterMin: mt.bufferAfterMin,
    minNoticeMin: mt.minNoticeMin,
    bookingWindowDays: mt.bookingWindowDays,
    maxPerDay: mt.maxPerDay,
    visibleSlotsPerDay: mt.visibleSlotsPerDay,
    rules: rules as never,
    exceptions: (exceptions as any[]).map((e) => ({
      date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date).slice(0, 10),
      unavailable: !!e.unavailable,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
    })),
    bookings: ocupado,
    fromDate: opts.from,
    toDate: opts.to,
  })

  // Último crivo: a clínica aceita esses horários?
  //
  // Os bloqueios importados cobrem os agendamentos de lá, mas não a jornada do
  // profissional na clínica. Sem este cruzamento, um profissional que só atende
  // à tarde lá aparecia livre de manhã aqui — a reserva era aceita, o paciente
  // via a confirmação, e o espelho falhava com 409 sem ninguém perceber.
  const uuid = await profissionalDoUsuario(usuarioId)
  if (!uuid) return dias
  return filtrarPelaClinica(dias, uuid, mt.timezone)
}

/** Este profissional tem exatamente este horário livre para este procedimento? */
export async function profissionalTemHorario(
  mt: TipoDeAgendamento, usuarioId: number, duracaoMin: number, inicioISO: string,
): Promise<boolean> {
  const dias = await slotsDoProfissional(mt, usuarioId, duracaoMin)
  return dias.some((d) => d.slots.some((s) => s.startAt === inicioISO))
}
