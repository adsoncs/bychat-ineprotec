// src/services/portalAccount.ts
//
// Conta única do portal: a mesma credencial serve ao candidato que acabou de se
// inscrever e ao aluno matriculado, porque a pessoa é a mesma — o Lead.
//
// Antes havia duas portas e nenhuma conta: o candidato entrava com código de
// inscrição + CPF (token de 1 hora) e o aluno entrava por um link com token na
// URL, com o recado "solicite um novo acesso à secretaria" quando expirava.
// Quem se inscrevia e depois virava aluno trocava de identidade no meio do
// caminho.

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { emitirSessao } from '../lib/portalSession.js'

const MAX_TENTATIVAS = 5
const BLOQUEIO_MINUTOS = 15
const MIN_SENHA = 8
const LINK_TTL_HORAS = Number(process.env.PORTAL_LINK_TTL_HORAS || 48)

export const soDigitos = (s: string | null | undefined) => String(s || '').replace(/\D/g, '')

export function validarSenha(senha: string): string | null {
  if (!senha || senha.length < MIN_SENHA) return `A senha precisa ter ao menos ${MIN_SENHA} caracteres.`
  if (!/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha precisa misturar letras e números.'
  return null
}

const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

/**
 * Cria a conta do portal para um contato, ou devolve a que já existe.
 * O CPF vem do formulário da inscrição e é o identificador que a pessoa lembra.
 */
export async function garantirConta(leadId: number, cpf?: string | null) {
  const digitos = soDigitos(cpf) || null
  const existente = await prisma.portalAccount.findUnique({
    where: { leadId }, select: { id: true, senhaHash: true, cpf: true },
  })
  if (existente) {
    if (digitos && !existente.cpf) {
      await prisma.portalAccount.update({ where: { id: existente.id }, data: { cpf: digitos } })
    }
    return existente
  }
  return prisma.portalAccount.create({
    data: { leadId, cpf: digitos }, select: { id: true, senhaHash: true, cpf: true },
  })
}

/**
 * Define (ou troca) a senha. Trocar senha derruba as outras sessões: se a troca
 * veio de "esqueci a senha", a sessão de quem estava com o acesso indevido
 * precisa morrer junto.
 */
export async function definirSenha(accountId: number, senha: string, opts: { revogarSessoes?: boolean } = {}) {
  const erro = validarSenha(senha)
  if (erro) return { ok: false as const, erro }
  await prisma.portalAccount.update({
    where: { id: accountId },
    data: {
      senhaHash: await bcrypt.hash(senha, 10),
      senhaDefinidaEm: new Date(),
      tentativas: 0,
      bloqueadoAte: null,
    },
  })
  if (opts.revogarSessoes !== false) {
    await prisma.portalSession.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } })
  }
  return { ok: true as const }
}

/**
 * Acha a conta por CPF, e-mail ou RA. O CPF é comparado só pelos dígitos: o
 * cadastro tem gente com ponto e traço e gente sem, e exigir do aluno o formato
 * exato do banco é uma armadilha.
 */
export async function acharConta(identificador: string) {
  const bruto = String(identificador || '').trim()
  if (!bruto) return null

  if (bruto.includes('@')) {
    const lead = await prisma.lead.findFirst({
      where: { email: bruto.toLowerCase() },
      select: { id: true, portalAccount: { select: { id: true } } },
    })
    if (lead?.portalAccount) return contaPorId(lead.portalAccount.id)
  }

  const digitos = soDigitos(bruto)
  if (digitos.length >= 11) {
    // O CPF da conta cobre candidato e aluno — é gravado já na inscrição.
    const porConta = await prisma.portalAccount.findFirst({ where: { cpf: digitos }, select: { id: true } })
    if (porConta) return contaPorId(porConta.id)

    // Cadastro antigo: o CPF pode estar só no Aluno, com pontuação. Poucos
    // registros, e o MySQL não tem substituição por regex portátil no WHERE.
    const alunos = await prisma.aluno.findMany({ where: { cpf: { not: null } }, select: { leadId: true, cpf: true } })
    const achado = alunos.find((a) => soDigitos(a.cpf) === digitos)
    if (achado) {
      const c = await prisma.portalAccount.findUnique({ where: { leadId: achado.leadId }, select: { id: true } })
      if (c) return contaPorId(c.id)
    }
  }

  // RA: identidade do aluno já matriculado.
  const porRa = await prisma.aluno.findFirst({ where: { ra: bruto }, select: { leadId: true } })
  if (porRa) {
    const c = await prisma.portalAccount.findUnique({ where: { leadId: porRa.leadId }, select: { id: true } })
    if (c) return contaPorId(c.id)
  }
  return null
}

async function contaPorId(id: number) {
  return prisma.portalAccount.findUnique({
    where: { id },
    select: {
      id: true, leadId: true, cpf: true, senhaHash: true, tentativas: true, bloqueadoAte: true, ativo: true,
      lead: { select: { nome: true, email: true, whatsapp: true } },
    },
  })
}

export interface ResultadoLogin {
  ok: boolean
  raw?: string
  expiresAt?: Date
  accountId?: number
  erro?: string
  precisaDefinirSenha?: boolean
}

/** Login por CPF, e-mail ou RA + senha. Devolve a sessão a ser posta no cookie. */
export async function login(
  identificador: string,
  senha: string,
  ctx: { userAgent?: string | null; ip?: string | null } = {},
): Promise<ResultadoLogin> {
  const conta = await acharConta(identificador)
  // Mesma mensagem para "não existe" e "senha errada": diferenciar as duas
  // transformaria o login em consulta de quem estuda aqui.
  const generico = { ok: false, erro: 'CPF, e-mail ou senha incorretos.' }
  if (!conta || !conta.ativo) return generico

  if (conta.bloqueadoAte && conta.bloqueadoAte.getTime() > Date.now()) {
    const min = Math.ceil((conta.bloqueadoAte.getTime() - Date.now()) / 60000)
    return { ok: false, erro: `Muitas tentativas. Tente de novo em ${min} minuto(s) ou peça um link de acesso.` }
  }
  if (!conta.senhaHash) {
    return { ok: false, precisaDefinirSenha: true, erro: 'Você ainda não criou uma senha. Peça um link de acesso para criar a sua.' }
  }
  if (!(await bcrypt.compare(senha, conta.senhaHash))) {
    const tentativas = (conta.tentativas || 0) + 1
    await prisma.portalAccount.update({
      where: { id: conta.id },
      data: {
        tentativas,
        bloqueadoAte: tentativas >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60000) : null,
      },
    })
    return generico
  }

  await prisma.portalAccount.update({
    where: { id: conta.id },
    data: { tentativas: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
  })
  const s = await emitirSessao({ accountId: conta.id, userAgent: ctx.userAgent, ip: ctx.ip })
  return { ok: true, raw: s.raw, expiresAt: s.expiresAt, accountId: conta.id }
}

/**
 * Link de primeiro acesso / recuperação: uso único e vida curta (48h por
 * padrão). O link antigo valia 30 dias e continuava funcionando depois de usado
 * — virava chave permanente para quem o recebesse encaminhado.
 */
export async function criarLinkDeAcesso(
  accountId: number,
  finalidade: 'primeiro_acesso' | 'recuperacao' = 'primeiro_acesso',
  canal?: 'whatsapp' | 'email',
): Promise<{ raw: string; url: string; expiresAt: Date }> {
  const raw = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + LINK_TTL_HORAS * 3600_000)
  await prisma.portalAccessLink.create({
    data: { accountId, tokenHash: hashToken(raw), finalidade, canal: canal ?? null, expiresAt },
  })
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return { raw, url: `${base}/portal/entrar?c=${encodeURIComponent(raw)}`, expiresAt }
}

export type ResultadoLink =
  | { ok: true; accountId: number; finalidade: string; raw: string; expiresAt: Date }
  | { ok: false; erro: string }

/** Troca o link por uma sessão e o queima no mesmo movimento. */
export async function consumirLinkDeAcesso(
  token: string,
  ctx: { userAgent?: string | null; ip?: string | null } = {},
): Promise<ResultadoLink> {
  const link = await prisma.portalAccessLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, accountId: true, finalidade: true, expiresAt: true, usadoEm: true },
  })
  if (!link) return { ok: false, erro: 'Link inválido. Peça um novo para entrar.' }
  if (link.usadoEm) return { ok: false, erro: 'Este link já foi usado. Peça um novo para entrar.' }
  if (link.expiresAt.getTime() < Date.now()) return { ok: false, erro: 'Este link expirou. Peça um novo para entrar.' }

  await prisma.portalAccessLink.update({ where: { id: link.id }, data: { usadoEm: new Date(), ip: ctx.ip ?? null } })
  const s = await emitirSessao({ accountId: link.accountId, userAgent: ctx.userAgent, ip: ctx.ip })
  return { ok: true, accountId: link.accountId, finalidade: link.finalidade, raw: s.raw, expiresAt: s.expiresAt }
}

/** Quem é o dono da sessão: contato, e aluno quando já houver matrícula. */
export async function quemE(accountId: number) {
  const conta = await prisma.portalAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true, leadId: true, senhaHash: true,
      lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
    },
  })
  if (!conta) return null
  const aluno = await prisma.aluno.findUnique({
    where: { leadId: conta.leadId },
    select: { id: true, ra: true, cpf: true },
  })
  const inscricoes = await prisma.enrollmentRegistration.findMany({
    where: { leadId: conta.leadId },
    orderBy: { id: 'desc' },
    select: { id: true, candidateCode: true, status: true },
  })
  return {
    accountId: conta.id,
    leadId: conta.leadId,
    temSenha: !!conta.senhaHash,
    nome: conta.lead.nome,
    email: conta.lead.email,
    whatsapp: conta.lead.whatsapp,
    aluno,
    inscricoes,
  }
}
