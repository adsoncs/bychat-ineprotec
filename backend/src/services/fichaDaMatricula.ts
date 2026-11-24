// src/services/fichaDaMatricula.ts
//
// Matrícula feita pela equipe (painel ou portal em modo atendimento) SEM a ficha
// escolhida: o agente digita os dados de quem já está conversando com ele. Antes
// a inscrição criava uma ficha nova, marcada como duplicada, e alguém precisava
// mesclar depois (ineprotec, 09/11: Valdeci 42129 → 42132). Agora a matrícula vai
// para a ficha que já existe — com as mesmas travas fixas da junção automática
// (services/regrasDuplicidade.ts):
//
//   · CPF diferente nunca junta (celular da família);
//   · sem CPF igual, primeiro nome claramente diferente não junta;
//   · mais de uma ficha possível = ninguém escolhe sozinho (fica a sinalização);
//   · só ficha que o agente enxerga;
//   · grupo de WhatsApp nunca.
//
// O agente vê antes de salvar qual ficha será usada e pode marcar "é outra
// pessoa" (fichaSeparada), que volta ao comportamento antigo.

import { prisma } from '../lib/prisma.js'
import { phoneKey } from '../lib/phone.js'
import { normalizeCpf } from '../lib/cpf.js'
import { canUserAccessLead } from '../lib/teamAccess.js'
import { primeiroNome } from './regrasDuplicidade.js'

export interface DadosDigitados {
  nome?: string | null
  whatsapp?: string | null
  email?: string | null
  cpf?: string | null
}

export type FichaDaMatricula =
  | { tipo: 'ficha'; lead: { id: number; nome: string | null; whatsapp: string | null }; por: 'whatsapp' | 'cpf' | 'email' }
  | { tipo: 'outra_pessoa'; lead: { id: number; nome: string | null }; motivo: string }
  | { tipo: 'varias'; leads: Array<{ id: number; nome: string | null }> }
  | { tipo: 'nenhuma' }

const SELECT = { id: true, nome: true, whatsapp: true, formData: true } as const

async function cpfsDa(leadId: number, formData: unknown): Promise<Set<string>> {
  const regs = await prisma.enrollmentRegistration.findMany({ where: { leadId }, select: { formData: true } }).catch(() => [] as any[])
  return new Set([formData, ...regs.map((r: any) => r.formData)]
    .map((fd: any) => normalizeCpf(String(fd?.cpf ?? '')))
    .filter((c) => c.length === 11))
}

/** Qual ficha recebe a matrícula digitada pelo agente (sem escrever nada). */
export async function fichaParaMatricula(
  dados: DadosDigitados,
  quem: { userId: number; role: string },
  /** Portal da matrícula: só serve ficha da mesma empresa (unidade) dele. */
  portalId?: number | null,
): Promise<FichaDaMatricula> {
  const pk = phoneKey(dados.whatsapp ?? '')
  const cpf = normalizeCpf(String(dados.cpf ?? ''))
  const email = String(dados.email ?? '').trim().toLowerCase()

  // 1) WhatsApp (chave canônica), 2) CPF da ficha ou de uma inscrição, 3) e-mail.
  let por: 'whatsapp' | 'cpf' | 'email' = 'whatsapp'
  let achadas: any[] = pk
    ? await prisma.lead.findMany({ where: { phoneKey: pk, isGroup: false }, select: SELECT, orderBy: { id: 'asc' }, take: 5 })
    : []
  if (!achadas.length && cpf.length === 11) {
    por = 'cpf'
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT id FROM bychat_leads WHERE REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '[^0-9]', '') = ?
       UNION SELECT leadId AS id FROM bychat_enrollment_registrations WHERE leadId IS NOT NULL AND REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '[^0-9]', '') = ?
       LIMIT 5`, cpf, cpf,
    ).catch(() => [] as Array<{ id: number }>)
    const ids = [...new Set(rows.map((r) => Number(r.id)))]
    achadas = ids.length ? await prisma.lead.findMany({ where: { id: { in: ids }, isGroup: false }, select: SELECT, orderBy: { id: 'asc' } }) : []
  }
  if (!achadas.length && email.includes('@')) {
    por = 'email'
    achadas = await prisma.lead.findMany({ where: { email, isGroup: false }, select: SELECT, orderBy: { id: 'asc' }, take: 5 })
  }
  // Duas empresas no mesmo ambiente: a ficha de outra empresa não recebe esta
  // matrícula (cada empresa tem a sua conversa, o seu número e o seu funil).
  if (achadas.length && portalId) achadas = await daMesmaEmpresa(achadas, portalId)
  if (!achadas.length) return { tipo: 'nenhuma' }

  // Travas fixas: quem claramente é outra pessoa sai da lista.
  const nomeNovo = primeiroNome(dados.nome)
  const compativeis: any[] = []
  let barrada: { id: number; nome: string | null; motivo: string } | null = null
  for (const l of achadas) {
    const cpfs = await cpfsDa(l.id, l.formData)
    const cpfIgual = cpf.length === 11 && cpfs.has(cpf)
    if (cpf.length === 11 && cpfs.size && !cpfIgual) { barrada ??= { id: l.id, nome: l.nome, motivo: 'CPF diferente' }; continue }
    const nomeFicha = primeiroNome(l.nome)
    if (!cpfIgual && nomeNovo && nomeFicha && nomeNovo !== nomeFicha) { barrada ??= { id: l.id, nome: l.nome, motivo: `nome diferente ("${l.nome}")` }; continue }
    if (!(await canUserAccessLead(quem.userId, quem.role as any, l.id).catch(() => false))) continue
    compativeis.push(l)
  }
  if (compativeis.length === 1) {
    const l = compativeis[0]
    return { tipo: 'ficha', lead: { id: l.id, nome: l.nome, whatsapp: l.whatsapp }, por }
  }
  if (compativeis.length > 1) return { tipo: 'varias', leads: compativeis.map((l) => ({ id: l.id, nome: l.nome })) }
  if (barrada) return { tipo: 'outra_pessoa', lead: { id: barrada.id, nome: barrada.nome }, motivo: barrada.motivo }
  return { tipo: 'nenhuma' }
}

/**
 * Ficha de quem se inscreve pelo portal sem login (uma pessoa, uma ficha —
 * 24/11/2026). Só pelo CPF, o único dado que identifica a pessoa: celular e
 * e-mail podem ser da família. A ficha principal ganha da duplicata marcada;
 * mais de uma pessoa possível = nenhuma (fica o comportamento antigo).
 */
export async function fichaDoCpf(cpfDigitado: string, portalId?: number | null): Promise<number | null> {
  const cpf = normalizeCpf(String(cpfDigitado ?? ''))
  if (cpf.length !== 11) return null
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM bychat_leads WHERE REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '[^0-9]', '') = ?
     UNION SELECT leadId AS id FROM bychat_enrollment_registrations WHERE leadId IS NOT NULL AND mergedIntoId IS NULL AND REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '[^0-9]', '') = ?
     LIMIT 20`, cpf, cpf,
  ).catch(() => [] as Array<{ id: number }>)
  let fichas = await prisma.lead.findMany({
    where: { id: { in: [...new Set(rows.map((r) => Number(r.id)))] }, isGroup: false },
    select: { id: true, possibleDuplicateOfId: true, duplicateStatus: true },
  })
  if (portalId && fichas.length) fichas = await daMesmaEmpresa(fichas, portalId)
  // Duplicata já ligada à principal conta como a principal.
  const raizes = new Set<number>()
  for (const f of fichas) {
    const ehCopia = f.possibleDuplicateOfId && ['pending_review', 'linked'].includes(String(f.duplicateStatus ?? ''))
      && fichas.some((o) => o.id === f.possibleDuplicateOfId)
    raizes.add(ehCopia ? f.possibleDuplicateOfId! : f.id)
  }
  return raizes.size === 1 ? [...raizes][0]! : null
}

/**
 * Fichas que pertencem à empresa (unidade) do portal: a unidade da ficha é a do
 * portal da última inscrição ou a do número da conversa (lib/identidadeDaUnidade).
 * Ficha sem unidade só serve a unidade sem número próprio — a empresa "padrão"
 * do ambiente. Num ambiente de uma empresa só, nada é filtrado.
 */
async function daMesmaEmpresa<T extends { id: number }>(fichas: T[], portalId: number): Promise<T[]> {
  const { unidadeDoPortal, unidadeDoLead, identidadeDaUnidade } = await import('../lib/identidadeDaUnidade.js')
  const alvo = await unidadeDoPortal(portalId)
  if (!alvo) return fichas
  const outras = await prisma.educationalUnit.count({ where: { id: { not: alvo } } })
  if (!outras) return fichas
  const alvoTemNumero = !!(await identidadeDaUnidade(alvo))?.whatsappConexaoId
  const out: T[] = []
  for (const f of fichas) {
    const u = await unidadeDoLead(f.id)
    if (u === alvo || (u == null && !alvoTemNumero)) out.push(f)
  }
  return out
}

export const ROTULO_DO_CRITERIO: Record<'whatsapp' | 'cpf' | 'email', string> = {
  whatsapp: 'mesmo WhatsApp', cpf: 'mesmo CPF', email: 'mesmo e-mail',
}
