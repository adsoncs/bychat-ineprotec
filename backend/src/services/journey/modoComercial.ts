// Modo comercial da jornada de IA (pedido da FABAD, 01/11/2026).
//
// O chatbot pode atender 100% do tempo (padrão: `chatbot.modoComercial` nulo ou
// modo 'integral') ou deixar a venda com a equipe comercial quando ela está
// disponível ('fora_do_horario'):
//
//   equipe ON  = dentro do horário da equipe (Equipes › Horário) E pelo menos
//                uma pessoa dela online agora (painel aberto + "Disponível").
//                A IA só faz a triagem, sorteia 2–3 perguntas de qualificação,
//                registra e passa para a equipe. Não inscreve, não manda link,
//                não cobra e não fala de valores.
//   equipe OFF = fora do horário, fim de semana, feriado ou ninguém online:
//                a IA atende completa, como no modo integral.
//
// A presença real substitui uma lista de feriados: em feriado ou ponto
// facultativo ninguém está online e a IA assume sozinha.
//
// O modo é decidido quando o ATENDIMENTO começa e não muda no meio dele:
// conversa iniciada termina como começou. Conta como atendimento novo a
// conversa que nasce agora, a que volta depois de NOVO_ATENDIMENTO_HORAS de
// silêncio e a que foi devolvida à IA.

import { prisma } from '../../lib/prisma.js'
import { isTeamOpen } from '../routing/workingHours.js'

export interface ModoComercialCfg {
  modo: 'integral' | 'fora_do_horario'
  teamId: number | null
  perguntas: string[]
  minPerguntas: number
  maxPerguntas: number
  presencaMinutos: number
}

export interface DecisaoComercial {
  modo: 'qualifica' | 'completo'
  em: string
  motivo: string
  perguntas?: string[]
  online?: number
}

export const NOVO_ATENDIMENTO_HORAS = 12
const PRESENCA_PADRAO_MIN = 5

/** Lê e saneia `chatbot.modoComercial`. Sem config ou modo integral → null. */
export function lerModoComercial(raw: unknown): ModoComercialCfg | null {
  const c = (raw && typeof raw === 'object' ? raw : null) as any
  if (!c || c.modo !== 'fora_do_horario') return null
  const teamId = Number(c.teamId)
  const perguntas = (Array.isArray(c.perguntas) ? c.perguntas : [])
    .map((p: unknown) => String(p ?? '').trim()).filter(Boolean).slice(0, 30)
  const min = Math.max(0, Math.min(10, Math.round(Number(c.minPerguntas ?? 2)) || 0))
  const max = Math.max(min, Math.min(10, Math.round(Number(c.maxPerguntas ?? 3)) || min))
  const presenca = Math.max(1, Math.min(120, Math.round(Number(c.presencaMinutos ?? PRESENCA_PADRAO_MIN)) || PRESENCA_PADRAO_MIN))
  return {
    modo: 'fora_do_horario',
    teamId: Number.isInteger(teamId) && teamId > 0 ? teamId : null,
    perguntas, minPerguntas: min, maxPerguntas: max, presencaMinutos: presenca,
  }
}

/** Normaliza o que chega do painel antes de gravar (null = modo integral). */
export function normalizarModoComercial(raw: unknown): Record<string, unknown> | null {
  const c = (raw && typeof raw === 'object' ? raw : null) as any
  if (!c) return null
  const lido = lerModoComercial({ ...c, modo: 'fora_do_horario' })!
  return {
    modo: c.modo === 'fora_do_horario' ? 'fora_do_horario' : 'integral',
    teamId: lido.teamId, perguntas: lido.perguntas,
    minPerguntas: lido.minPerguntas, maxPerguntas: lido.maxPerguntas, presencaMinutos: lido.presencaMinutos,
  }
}

/** Quem da equipe está online agora (painel aberto há pouco + "Disponível"). */
export async function equipeOnline(teamId: number, presencaMinutos: number, agora = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - presencaMinutos * 60_000)
  return prisma.teamMember.count({
    where: {
      teamId,
      user: {
        active: true, lockedAt: null, workStatus: 'available',
        role: { not: 'VIEWER' },
        lastSeenAt: { gte: desde },
        OR: [{ agentProfile: { is: null } }, { agentProfile: { is: { active: true, OR: [{ vacationUntil: null }, { vacationUntil: { lte: agora } }] } } }],
      },
    },
  }).catch(() => 0)
}

/** Sorteia de `min` a `max` perguntas, sem repetir. */
export function sortearPerguntas(lista: string[], min: number, max: number, rnd: () => number = Math.random): string[] {
  const n = Math.min(lista.length, min + Math.floor(rnd() * (max - min + 1)))
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j] as string, copia[i] as string]
  }
  return copia.slice(0, n)
}

/** Decide o modo deste atendimento. Sem config → sempre 'completo'. */
export async function decidirModoComercial(cfg: ModoComercialCfg | null, agora = new Date()): Promise<DecisaoComercial> {
  const em = agora.toISOString()
  if (!cfg || !cfg.teamId) return { modo: 'completo', em, motivo: 'modo integral' }
  // Horário da equipe (Equipes › Horário). Lido mesmo com o filtro de horário
  // do roteamento desligado: aqui ele só diz se a equipe trabalha agora.
  const noHorario = await isTeamOpen(cfg.teamId, agora).catch(() => false)
  if (!noHorario) return { modo: 'completo', em, motivo: 'fora do horário da equipe' }
  const online = await equipeOnline(cfg.teamId, cfg.presencaMinutos, agora)
  if (online < 1) return { modo: 'completo', em, motivo: 'ninguém da equipe online', online }
  return { modo: 'qualifica', em, motivo: 'equipe no horário e online', online, perguntas: sortearPerguntas(cfg.perguntas, cfg.minPerguntas, cfg.maxPerguntas) }
}

/**
 * Este turno começa um atendimento novo? Sim quando a conversa ficou parada
 * por mais de NOVO_ATENDIMENTO_HORAS antes da mensagem que acabou de chegar.
 * Chamado DEPOIS de gravar a mensagem recebida: a penúltima é a referência.
 */
export async function eNovoAtendimento(leadId: number, agora = new Date()): Promise<boolean> {
  const ultimas = await prisma.message.findMany({
    where: { leadId, isInternal: false }, orderBy: { id: 'desc' }, take: 2, select: { createdAt: true },
  }).catch(() => [] as Array<{ createdAt: Date }>)
  const anterior = ultimas[1]
  if (!anterior) return true
  return agora.getTime() - anterior.createdAt.getTime() > NOVO_ATENDIMENTO_HORAS * 3600_000
}

/**
 * Lembrete por turno do modo qualificação, junto da mensagem da pessoa (cópia:
 * não vai para o histórico). Só o bloco no prompt não basta: num prompt longo
 * que manda apresentar preço e inscrever, o modelo seguia o roteiro de venda.
 */
export const LEMBRETE_QUALIFICACAO = '[aviso interno do sistema, não é a pessoa] MODO QUALIFICAÇÃO ATIVO (a equipe comercial está online): neste atendimento você NÃO fala valores, preços, bolsas ou condições, NÃO faz inscrição, NÃO manda link e NÃO oferece fazer a inscrição. Siga só a seção "MODO QUALIFICAÇÃO": entenda o interesse, faça a próxima pergunta de qualificação que ainda falta e, quando acabarem (ou se a pessoa quiser se inscrever, pedir valores ou pedir alguém), chame salvar_dados e transferir_humano. Aluno ou outro assunto: departamentos, como sempre.'
export function comLembreteDeQualificacao<T extends { role: string; content: any }>(messages: T[]): T[] {
  const i = messages.length - 1
  const ultima = messages[i]
  if (!ultima || ultima.role !== 'user' || typeof ultima.content !== 'string') return messages
  const copia = [...messages]
  copia[i] = { ...ultima, content: `${ultima.content}\n\n${LEMBRETE_QUALIFICACAO}` }
  return copia
}

/** Instruções do modo qualificação (abrem e fecham o prompt e valem acima dele). */
export function blocoDeQualificacao(perguntas: string[], equipe: string | null): string {
  const lista = perguntas.length
    ? perguntas.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(nenhuma pergunta configurada: só entenda o interesse)'
  const quem = equipe ? `a equipe ${equipe}` : 'a equipe comercial'
  return `
## MODO QUALIFICAÇÃO: a equipe comercial está online agora (vale ACIMA de qualquer instrução anterior sobre inscrição, matrícula, valores, link ou pagamento)
Neste atendimento, quem conclui a inscrição e a matrícula é ${quem}. O seu papel é acolher, entender o interesse e qualificar, e então passar para uma pessoa da equipe.
- Primeiro entenda o interesse (qual curso ou nível). Pode tirar dúvidas rápidas sobre o curso, sem valores.
- Depois que a pessoa disser o interesse, faça estas perguntas, UMA por mensagem, com as suas palavras, pulando a que a ficha ou a conversa já responderam:
${lista}
- NÃO faça inscrição, não ofereça fazer a inscrição, não mande link do portal, não gere pagamento e não fale de valores, preços, bolsas ou condições, mesmo que outra parte destas instruções mande apresentar o investimento, mandar o link ou inscrever: neste atendimento isso é da equipe. Se perguntarem valores, diga que a pessoa da equipe que vai atender passa os valores e as condições. Se a pessoa quiser se inscrever ou pedir o link, transfira na hora.
- Terminadas as perguntas, ou se a pessoa pedir para falar com alguém, quiser se inscrever agora ou não quiser responder: chame salvar_dados com um resumo (interesse + respostas) e, em seguida, transferir_humano (motivo: "qualificado: " + o curso + as respostas). Depois escreva UMA mensagem curta dizendo que uma pessoa da equipe continua com ela por aqui, neste mesmo WhatsApp. Essa é a sua última mensagem.
- Aluno ou outro assunto que não é estudar na instituição: siga as regras de departamentos normalmente.`
}
