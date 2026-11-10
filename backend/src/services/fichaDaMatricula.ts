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

export const ROTULO_DO_CRITERIO: Record<'whatsapp' | 'cpf' | 'email', string> = {
  whatsapp: 'mesmo WhatsApp', cpf: 'mesmo CPF', email: 'mesmo e-mail',
}
