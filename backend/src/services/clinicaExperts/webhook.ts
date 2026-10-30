// src/services/clinicaExperts/webhook.ts
//
// Recebe os avisos da Clinica Experts.
//
// A importação de ocupação (`ocupacao.ts`) roda de 15 em 15 minutos; o webhook
// é o mesmo trabalho feito na hora. Não substitui a varredura — aviso se perde,
// chega fora de ordem, e a clínica pode ficar sem internet no meio. A varredura
// continua sendo a rede de segurança; o webhook só encurta a janela.
//
// ⚠️ A documentação lista os 26 eventos, mas **não publica o formato do payload
// nem forma de validar assinatura**. Por isso aqui:
//   · o payload cru é registrado nas primeiras vezes, para descobrirmos o
//     formato de verdade em vez de supor;
//   · a leitura dos campos é tolerante (aceita vários nomes prováveis);
//   · a autenticação é por um segredo na própria URL, que é o que dá para
//     fazer sem assinatura do lado deles.

import { prisma } from '../../lib/prisma.js'
import { getConfig, salvarConfig } from './config.js'
import { importarOcupacao } from './ocupacao.js'

const LOG = '[clinicaExperts/webhook]'

/** Quantos payloads são registrados por inteiro antes de o log ficar resumido.
 *  O objetivo é descobrir o formato, não encher o disco. */
const AMOSTRAS = 20

export interface ResultadoWebhook {
  aceito: boolean
  evento: string | null
  acao: string
}

/**
 * Segredo da URL do webhook. Fica na configuração, criado na primeira leitura —
 * assim a tela consegue mostrar a URL pronta para colar no painel da clínica.
 */
export async function urlDoWebhook(baseUrl: string): Promise<string> {
  const cfg = await getConfig()
  let segredo = cfg.webhookSegredo
  if (!segredo) {
    segredo = (await import('node:crypto')).randomBytes(24).toString('hex')
    await salvarConfig({ webhookSegredo: segredo })
  }
  return `${baseUrl.replace(/\/+$/, '')}/api/public/clinica-experts/webhook/${segredo}`
}

export async function segredoConfere(candidato: string): Promise<boolean> {
  const cfg = await getConfig()
  const segredo = cfg.webhookSegredo
  if (!segredo || !candidato) return false
  // Comparação de tempo constante: o segredo está na URL e um atacante pode
  // tentar adivinhá-lo byte a byte medindo o tempo de resposta.
  const { timingSafeEqual } = await import('node:crypto')
  const a = Buffer.from(segredo)
  const b = Buffer.from(candidato)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Nome do evento, aceitando os formatos mais prováveis. */
function nomeDoEvento(corpo: any): string | null {
  const bruto = corpo?.event ?? corpo?.type ?? corpo?.event_type ?? corpo?.action ?? null
  return bruto ? String(bruto) : null
}

/** Uuid do agendamento dentro do payload, onde quer que ele esteja. */
function uuidDoAgendamento(corpo: any): string | null {
  const c = corpo?.data ?? corpo?.booking ?? corpo ?? {}
  const u = c?.uuid ?? c?.booking_uuid ?? c?.id ?? corpo?.uuid ?? null
  return typeof u === 'string' && u.length >= 10 ? u : null
}

/**
 * Processa um aviso. Nunca lança: webhook que responde erro vira reentrega em
 * laço do lado deles, e um payload inesperado não é motivo para isso.
 */
export async function processarWebhook(corpo: unknown): Promise<ResultadoWebhook> {
  const evento = nomeDoEvento(corpo)

  // Amostragem do payload cru — é assim que o formato real vai ser descoberto.
  const cfg = await getConfig()
  const vistos = Number(cfg.webhookAmostrasVistas ?? 0)
  if (vistos < AMOSTRAS) {
    console.log(`${LOG} payload #${vistos + 1} (${evento ?? 'evento não identificado'}): ${JSON.stringify(corpo).slice(0, 1500)}`)
    await salvarConfig({ webhookAmostrasVistas: vistos + 1 }).catch(() => {})
  }

  if (!evento) return { aceito: true, evento: null, acao: 'ignorado (sem nome de evento)' }

  // Só agenda interessa aqui. Paciente/profissional/procedimento mudam pouco e
  // não afetam disponibilidade — se um dia precisarem, entram por aqui.
  if (!/booking/i.test(evento)) {
    return { aceito: true, evento, acao: 'ignorado (não é de agendamento)' }
  }

  const uuid = uuidDoAgendamento(corpo)

  // Agendamento que NÓS criamos: o estado daqui é a origem, não o destino.
  // Reagir ao próprio eco criaria bloqueio em cima da própria reserva.
  if (uuid) {
    const nosso = await prisma.clinicaExpertsMapping.findFirst({
      where: { entityType: 'booking', ceUuid: uuid },
      select: { id: true },
    }).catch(() => null)
    if (nosso) return { aceito: true, evento, acao: 'ignorado (agendamento criado por nós)' }
  }

  // Qualquer mudança de agenda feita lá muda a ocupação daqui. Em vez de aplicar
  // o payload campo a campo — que exigiria confiar num formato não documentado —,
  // o aviso dispara a releitura da janela, que é a fonte confiável.
  agendarReleitura()
  return { aceito: true, evento, acao: 'releitura da ocupação agendada' }
}

// ── Agrupamento ─────────────────────────────────────────────────────────────
// A recepção remarcando a agenda do dia gera uma rajada de avisos. Uma
// varredura por aviso queimaria a cota de 120 req/min e faria o mesmo trabalho
// dezenas de vezes: os avisos são agrupados numa releitura só.

const ESPERA_MS = 20_000
let pendente: NodeJS.Timeout | null = null

function agendarReleitura(): void {
  if (pendente) return
  pendente = setTimeout(() => {
    pendente = null
    void importarOcupacao().catch((e) => console.warn(`${LOG} releitura falhou: ${e?.message ?? e}`))
  }, ESPERA_MS)
  // Não segura o processo no encerramento por causa de uma releitura pendente.
  pendente.unref?.()
}
