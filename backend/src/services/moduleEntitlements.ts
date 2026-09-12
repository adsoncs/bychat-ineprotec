// src/services/moduleEntitlements.ts
//
// Direito de uso: o que a loja vendeu a esta instalação.
//
// São DUAS perguntas, e a confusão entre elas é o que impede vender módulo:
//
//   tem direito?  → esta tabela, escrita pela loja
//   está ligado?  → Module.active, escrito pelo admin
//
// O módulo funciona quando as duas respondem sim. Se a compra apenas ligasse o
// interruptor, sumiria a diferença entre "não comprou" e "comprou e desligou":
// o cancelamento não saberia o que reverter, e qualquer admin ligaria sozinho
// o que não pagou.
//
// PREÇO NÃO MORA AQUI. Cada instalação tem banco próprio e a loja é central: o
// tenant guarda o que pode usar, a loja guarda quanto custa. Preço aqui
// significaria mudar valor em doze bancos a cada promoção.

import { prisma } from '../lib/prisma.js'
import { MODULE_REGISTRY, UMBRELLA_REQUIRES, type ModuleUmbrella } from '../lib/moduleRegistry.js'

export type OrigemDireito = 'pacote' | 'avulso' | 'cortesia' | 'teste' | 'migracao'

/** Quanto tempo a resposta fica em memória. Curto: comprar precisa valer já. */
const TTL_MS = 30_000
let cache: { em: number; ids: Set<string> } | null = null

export function invalidarCacheDeDireitos(): void {
  cache = null
}

/**
 * Ids dos módulos com direito VIGENTE agora.
 *
 * Um direito vencido simplesmente não entra: não há rotina apagando linha, e
 * não deve haver — o histórico de quem teve o quê é o que permite reativar sem
 * recomprar, e responder "até quando ele teve isso?" meses depois.
 */
export async function modulosComDireito(): Promise<Set<string>> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.ids
  const agora = new Date()
  // Carência: o direito vencido ainda vale por N dias. Cortar no dia do
  // vencimento transforma um boleto atrasado em cliente sem sistema — e quem
  // paga por PIX costuma pagar depois do aviso, não antes. O dono estica o
  // prazo quando quiser, sem deploy (Setting `loja.carencia_dias`).
  const limite = new Date(agora.getTime() - (await carenciaDias()) * 864e5)
  const linhas = await prisma.moduleEntitlement.findMany({
    where: { inicioEm: { lte: agora }, OR: [{ expiraEm: null }, { expiraEm: { gt: limite } }] },
    select: { moduleId: true },
  })
  const ids = new Set(linhas.map((l) => l.moduleId))
  // Core nunca depende de compra: é a plataforma. Cobrar à parte por ele seria
  // vender ao cliente o que ele já tem — e desligá-lo derruba o produto.
  for (const m of MODULE_REGISTRY) if (m.core) ids.add(m.id)
  cache = { em: Date.now(), ids }
  return ids
}

export async function temDireito(moduleId: string): Promise<boolean> {
  return (await modulosComDireito()).has(moduleId)
}

/**
 * Concede um pacote inteiro: todo módulo do guarda-chuva, mais os pacotes que
 * ele exige.
 *
 * A recursão não é enfeite: 4 módulos do ERP dependem do Educacional, e vender
 * ERP a quem não o tem entrega telas que não abrem. Melhor conceder junto e
 * calado do que deixar o cliente descobrir na segunda-feira.
 */
/** Os módulos vendáveis de um pacote NESTA instalação (core não é produto). */
export function modulosDoPacote(pacote: ModuleUmbrella): string[] {
  return MODULE_REGISTRY.filter((m) => !m.core && m.umbrella === pacote).map((m) => m.id)
}

/**
 * Os pacotes que esta instalação realmente roda — o que a vitrine pode exibir.
 *
 * O registry diverge por instalação: medido em 11/09/2026, o beyond tem 82
 * módulos e o severiano 60, e os 22 de diferença são todos do ERP acadêmico.
 * Uma vitrine igual para todos ofereceria ERP a uma imobiliária.
 */
export function pacotesDisponiveis(): ModuleUmbrella[] {
  const vistos = new Set<ModuleUmbrella>()
  for (const m of MODULE_REGISTRY) if (!m.core) vistos.add(m.umbrella)
  return [...vistos]
}

/** Erro de catálogo: a loja deve tratar como "não vendável aqui", não como falha. */
export class PacoteIndisponivelError extends Error {
  constructor(public readonly pacotes: ModuleUmbrella[]) {
    super(
      `Esta instalação não roda ${pacotes.length > 1 ? 'os pacotes' : 'o pacote'} ` +
      `${pacotes.join(', ')} — nenhum módulo instalado. Não há o que entregar.`,
    )
    this.name = 'PacoteIndisponivelError'
  }
}

export async function concederPacote(input: {
  pacote: ModuleUmbrella
  expiraEm?: Date | null
  referencia?: string
  concedidoPor?: string
}): Promise<{ concedidos: string[]; pacotes: ModuleUmbrella[] }> {
  const pacotes: ModuleUmbrella[] = []
  const fila: ModuleUmbrella[] = [input.pacote]
  while (fila.length) {
    const p = fila.shift()!
    if (pacotes.includes(p)) continue
    pacotes.push(p)
    for (const exigido of UMBRELLA_REQUIRES[p] ?? []) fila.push(exigido)
  }

  // Recusar antes de cobrar. Sem isto, vender ERP a quem não o tem instalado
  // grava zero direitos e devolve sucesso: o cliente paga, a tela não muda, e
  // só a reclamação revela o problema. Vale para a cadeia inteira — entregar o
  // Educacional de um ERP que não existe é meia venda, que é pior que nenhuma.
  const vazios = pacotes.filter((p) => modulosDoPacote(p).length === 0)
  if (vazios.length) throw new PacoteIndisponivelError(vazios)

  const alvos = MODULE_REGISTRY.filter((m) => !m.core && pacotes.includes(m.umbrella))
  for (const m of alvos) {
    await prisma.moduleEntitlement.upsert({
      where: { moduleId_origem: { moduleId: m.id, origem: 'pacote' } },
      create: {
        moduleId: m.id, origem: 'pacote', pacote: m.umbrella,
        expiraEm: input.expiraEm ?? null,
        ...(input.referencia ? { referencia: input.referencia } : {}),
        ...(input.concedidoPor ? { concedidoPor: input.concedidoPor } : {}),
      },
      // Renovar é empurrar a data, não criar linha nova: a assinatura é a
      // mesma, e duplicar o direito quebraria a revogação por pacote.
      update: {
        pacote: m.umbrella,
        expiraEm: input.expiraEm ?? null,
        ...(input.referencia ? { referencia: input.referencia } : {}),
      },
    })
  }
  invalidarCacheDeDireitos()
  return { concedidos: alvos.map((m) => m.id), pacotes }
}

/** Um módulo solto — venda avulsa, cortesia de negociação ou teste com prazo. */
export async function concederModulo(input: {
  moduleId: string
  origem: Exclude<OrigemDireito, 'pacote'>
  expiraEm?: Date | null
  referencia?: string
  concedidoPor?: string
}): Promise<void> {
  const def = MODULE_REGISTRY.find((m) => m.id === input.moduleId)
  if (!def) throw new Error(`Módulo desconhecido: ${input.moduleId}`)
  if (def.core) return // já é da base; conceder seria registrar o óbvio

  await prisma.moduleEntitlement.upsert({
    where: { moduleId_origem: { moduleId: def.id, origem: input.origem } },
    create: {
      moduleId: def.id, origem: input.origem, expiraEm: input.expiraEm ?? null,
      ...(input.referencia ? { referencia: input.referencia } : {}),
      ...(input.concedidoPor ? { concedidoPor: input.concedidoPor } : {}),
    },
    update: { expiraEm: input.expiraEm ?? null, ...(input.referencia ? { referencia: input.referencia } : {}) },
  })
  invalidarCacheDeDireitos()
}

/**
 * Cancelamento: tira o que UM pacote concedeu, e nada mais.
 *
 * Só remove linhas de `origem: 'pacote'` daquele guarda-chuva. Um módulo que
 * também foi dado em cortesia continua de pé — quem prometeu aquilo numa
 * negociação não previa que cancelar outra coisa fosse levá-lo junto.
 */
export async function revogarPacote(pacote: ModuleUmbrella): Promise<number> {
  const { count } = await prisma.moduleEntitlement.deleteMany({ where: { origem: 'pacote', pacote } })
  invalidarCacheDeDireitos()
  return count
}

/** O que esta instalação tem, agrupado por pacote — para a tela e para a loja. */
export async function resumoDeDireitos(): Promise<{
  pacote: string
  modulos: { id: string; nome: string; origem: string; expiraEm: Date | null }[]
}[]> {
  const linhas = await prisma.moduleEntitlement.findMany({ orderBy: { moduleId: 'asc' } })
  const porId = new Map(MODULE_REGISTRY.map((m) => [m.id, m]))
  const grupos = new Map<string, { id: string; nome: string; origem: string; expiraEm: Date | null }[]>()
  for (const l of linhas) {
    const def = porId.get(l.moduleId)
    if (!def) continue // módulo removido do código: o direito sobra sem dono
    const chave = def.umbrella
    const lista = grupos.get(chave) ?? []
    lista.push({ id: def.id, nome: def.name, origem: l.origem, expiraEm: l.expiraEm })
    grupos.set(chave, lista)
  }
  return [...grupos.entries()].map(([pacote, modulos]) => ({ pacote, modulos }))
}

// ─────────────────────────────────────────────────────────────────────────
//  Teste grátis, carência e baixa manual
//
//  Regras do produto: 7 dias de teste, 15 de carência, e o dono podendo
//  esticar ou dar baixa à mão — porque parte do dinheiro entra por fora
//  (PIX, transferência) e nunca passa pelo provedor.
// ─────────────────────────────────────────────────────────────────────────

// A configuração da loja NÃO mora em `Setting`. A tela de configurações lista
// todas as chaves e aceita escrita em qualquer uma — enquanto a carência morou
// lá, o superadmin do cliente podia gravar 3650 e se dar dez anos de graça.
// Ver migration 0160.
async function numeroDaConfig(chave: string, padrao: number): Promise<number> {
  const row = await prisma.lojaConfig.findUnique({ where: { chave } }).catch(() => null)
  const v = Number(row?.valor)
  return Number.isFinite(v) && v >= 0 ? v : padrao
}

/** Dias de carência após o vencimento. O dono ajusta sem deploy. */
export async function carenciaDias(): Promise<number> {
  return numeroDaConfig('carencia_dias', 15)
}

/** Dias de teste grátis. */
export async function testeDias(): Promise<number> {
  return numeroDaConfig('teste_dias', 7)
}

export type EstadoAssinatura = 'sem_direito' | 'vigente' | 'em_carencia' | 'sem_prazo'

/**
 * Em que pé está um pacote — e, quando em carência, quantos dias faltam.
 *
 * A diferença entre `vigente` e `em_carencia` é o que a tela precisa para
 * avisar ANTES de cortar. Um cliente que descobre o corte pela tela travada
 * liga bravo; um que viu o aviso por cinco dias, paga.
 */
export async function estadoDoPacote(pacote: ModuleUmbrella): Promise<{
  estado: EstadoAssinatura
  expiraEm: Date | null
  diasRestantes: number | null
}> {
  const linha = await prisma.moduleEntitlement.findFirst({
    where: { pacote, origem: 'pacote' },
    orderBy: [{ expiraEm: 'desc' }],
  })
  if (!linha) return { estado: 'sem_direito', expiraEm: null, diasRestantes: null }
  if (!linha.expiraEm) return { estado: 'sem_prazo', expiraEm: null, diasRestantes: null }

  const agora = Date.now()
  const venc = linha.expiraEm.getTime()
  if (venc > agora) {
    return { estado: 'vigente', expiraEm: linha.expiraEm, diasRestantes: Math.ceil((venc - agora) / 864e5) }
  }
  const fimDaCarencia = venc + (await carenciaDias()) * 864e5
  if (fimDaCarencia > agora) {
    return { estado: 'em_carencia', expiraEm: linha.expiraEm, diasRestantes: Math.ceil((fimDaCarencia - agora) / 864e5) }
  }
  return { estado: 'sem_direito', expiraEm: linha.expiraEm, diasRestantes: 0 }
}

/** Teste grátis de um pacote. Vence sozinho — não vira assinatura por engano. */
export async function iniciarTeste(input: {
  pacote: ModuleUmbrella
  feitoPor?: string
}): Promise<{ expiraEm: Date; concedidos: string[] }> {
  const dias = await testeDias()
  const expiraEm = new Date(Date.now() + dias * 864e5)
  const r = await concederPacote({
    pacote: input.pacote, expiraEm,
    referencia: `teste de ${dias} dias`,
    ...(input.feitoPor ? { concedidoPor: input.feitoPor } : {}),
  })
  await prisma.assinaturaEvento.create({
    data: {
      tipo: 'teste', pacote: input.pacote, vencimentoNovo: expiraEm,
      observacao: `Teste grátis de ${dias} dias`,
      ...(input.feitoPor ? { feitoPor: input.feitoPor } : {}),
    },
  })
  invalidarCacheDeDireitos()
  return { expiraEm, concedidos: r.concedidos }
}

/**
 * Baixa manual: o dono registra que um mês foi pago por fora.
 *
 * Empurra o vencimento a partir da data que valia — não a partir de hoje.
 * Dar baixa com três dias de atraso não pode custar três dias ao cliente, e
 * também não pode presenteá-lo com um mês inteiro a mais.
 */
export async function marcarComoPago(input: {
  pacote: ModuleUmbrella
  competencia: string           // '2026-09'
  meses?: number                // default 1
  valorCentavos?: number
  meio?: 'pix' | 'transferencia' | 'dinheiro' | 'outro'
  observacao?: string
  feitoPor: string
}): Promise<{ vencimentoAnterior: Date | null; vencimentoNovo: Date }> {
  if (!/^\d{4}-\d{2}$/.test(input.competencia)) {
    throw new Error('Competência deve ser no formato AAAA-MM (ex.: 2026-09)')
  }
  const meses = input.meses ?? 1
  const linha = await prisma.moduleEntitlement.findFirst({
    where: { pacote: input.pacote, origem: 'pacote' },
    orderBy: [{ expiraEm: 'desc' }],
  })

  const base = linha?.expiraEm && linha.expiraEm.getTime() > Date.now() - (await carenciaDias()) * 864e5
    ? linha.expiraEm
    : new Date()
  const novo = new Date(base)
  novo.setMonth(novo.getMonth() + meses)

  await concederPacote({
    pacote: input.pacote, expiraEm: novo,
    referencia: `pago por fora · ${input.competencia}`,
    concedidoPor: input.feitoPor,
  })

  await prisma.assinaturaEvento.create({
    data: {
      tipo: 'pago_manual', pacote: input.pacote, competencia: input.competencia,
      vencimentoAnterior: linha?.expiraEm ?? null, vencimentoNovo: novo,
      feitoPor: input.feitoPor,
      ...(input.valorCentavos !== undefined ? { valorCentavos: input.valorCentavos } : {}),
      ...(input.meio ? { meio: input.meio } : {}),
      ...(input.observacao ? { observacao: input.observacao } : {}),
    },
  })
  invalidarCacheDeDireitos()
  return { vencimentoAnterior: linha?.expiraEm ?? null, vencimentoNovo: novo }
}

/**
 * O dono estica a carência — para todos, não só para um pacote.
 *
 * Serve ao caso real de "o cliente avisou que paga semana que vem": em vez de
 * inventar um pagamento que não houve, registra-se que o prazo foi esticado, e
 * por quem. A diferença importa quando alguém for conferir depois.
 */
export async function estenderCarencia(input: {
  dias: number
  motivo?: string
  feitoPor: string
}): Promise<number> {
  if (!Number.isFinite(input.dias) || input.dias < 0 || input.dias > 365) {
    throw new Error('Carência deve ser entre 0 e 365 dias')
  }
  await prisma.lojaConfig.upsert({
    where: { chave: 'carencia_dias' },
    create: { chave: 'carencia_dias', valor: String(input.dias) },
    update: { valor: String(input.dias), atualizadoEm: new Date() },
  })
  await prisma.assinaturaEvento.create({
    data: {
      tipo: 'carencia_estendida', feitoPor: input.feitoPor,
      observacao: `Carência ajustada para ${input.dias} dias${input.motivo ? ` · ${input.motivo}` : ''}`,
    },
  })
  invalidarCacheDeDireitos()
  return input.dias
}
