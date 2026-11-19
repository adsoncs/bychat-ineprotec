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
export const LINK_TTL_HORAS = Number(process.env.PORTAL_LINK_TTL_HORAS || 48)

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
export async function acharConta(identificador: string, unitId?: number | null) {
  const bruto = String(identificador || '').trim()
  if (!bruto) return null

  if (bruto.includes('@')) {
    // O lead QUE TEM conta no portal: o mesmo e-mail pode estar em outros leads
    // do CRM (duplicatas, importação) e, sem este filtro, o primeiro achado
    // podia ser um deles — e o login falhava para quem tem a conta.
    const leads = await prisma.lead.findMany({
      where: { email: bruto.toLowerCase(), portalAccount: { isNot: null } },
      select: { id: true, portalAccount: { select: { id: true } } }, orderBy: { id: 'asc' }, take: 20,
    })
    const contas = leads.flatMap((l) => (l.portalAccount ? [{ id: l.portalAccount.id, leadId: l.id }] : []))
    const escolhida = await daMesmaEmpresa(contas, unitId)
    if (escolhida) return contaPorId(escolhida)
  }

  const digitos = soDigitos(bruto)
  if (digitos.length >= 11) {
    // O CPF da conta cobre candidato e aluno — é gravado já na inscrição.
    const porCpf = await prisma.portalAccount.findMany({ where: { cpf: digitos }, select: { id: true, leadId: true }, orderBy: { id: 'asc' }, take: 20 })
    const escolhida = await daMesmaEmpresa(porCpf, unitId)
    if (escolhida) return contaPorId(escolhida)

    // Cadastro antigo: o CPF pode estar só no Aluno, com pontuação. Poucos
    // registros, e o MySQL não tem substituição por regex portátil no WHERE.
    const alunos = await prisma.aluno.findMany({ where: { cpf: { not: null } }, select: { leadId: true, cpf: true } })
    const achado = alunos.find((a) => soDigitos(a.cpf) === digitos)
    if (achado) {
      const c = await prisma.portalAccount.findUnique({ where: { leadId: achado.leadId }, select: { id: true } })
      if (c) return contaPorId(c.id)
    }
  }

  // Código da inscrição (MAT-26-000004-LKGW): o mesmo dado do /candidato.
  if (/^[A-Za-z]{2,5}-\d{2}-\d{3,}-[A-Za-z0-9]{3,}$/.test(bruto)) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { candidateCode: bruto.toUpperCase() }, select: { leadId: true } })
    if (reg?.leadId) {
      const c = await prisma.portalAccount.findUnique({ where: { leadId: reg.leadId }, select: { id: true } })
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

/**
 * Duas empresas no mesmo ambiente: a mesma pessoa pode ter uma conta em cada
 * (um lead por empresa). Entre as contas achadas, vale a que tem inscrição num
 * portal da unidade de onde a pessoa está entrando; sem unidade, ou sem nenhuma
 * dela, a primeira — o comportamento de antes.
 */
async function daMesmaEmpresa(contas: Array<{ id: number; leadId: number }>, unitId?: number | null): Promise<number | null> {
  if (!contas.length) return null
  if (contas.length === 1 || !unitId) return contas[0].id
  const comInscricao = await prisma.enrollmentRegistration.findFirst({
    where: { leadId: { in: contas.map((c) => c.leadId) }, portal: { unitId } },
    orderBy: { id: 'desc' }, select: { leadId: true },
  })
  return contas.find((c) => c.leadId === comInscricao?.leadId)?.id ?? contas[0].id
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
  /** Entrou com a senha padrão (CPF): a tela seguinte oferece criar a própria. */
  senhaPadrao?: boolean
}

/** CPF da pessoa (dígitos): o da conta, o do aluno ou o da inscrição mais recente. */
async function cpfDaConta(conta: { leadId: number; cpf: string | null }): Promise<string | null> {
  if (soDigitos(conta.cpf).length === 11) return soDigitos(conta.cpf)
  const aluno = await prisma.aluno.findUnique({ where: { leadId: conta.leadId }, select: { cpf: true } }).catch(() => null)
  if (soDigitos(aluno?.cpf).length === 11) return soDigitos(aluno?.cpf)
  const reg = await prisma.enrollmentRegistration.findFirst({ where: { leadId: conta.leadId }, orderBy: { id: 'desc' }, select: { formData: true } }).catch(() => null)
  const doForm = soDigitos(String((reg?.formData as any)?.cpf ?? ''))
  return doForm.length === 11 ? doForm : null
}

/** Login por CPF, e-mail ou RA + senha. Devolve a sessão a ser posta no cookie. */
export async function login(
  identificador: string,
  senha: string,
  ctx: { userAgent?: string | null; ip?: string | null; unitId?: number | null } = {},
): Promise<ResultadoLogin> {
  const conta = await acharConta(identificador, ctx.unitId)
  // Mesma mensagem para "não existe" e "senha errada": diferenciar as duas
  // transformaria o login em consulta de quem estuda aqui.
  const generico = { ok: false, erro: 'Usuário ou senha incorretos.' }
  if (!conta || !conta.ativo) return generico

  if (conta.bloqueadoAte && conta.bloqueadoAte.getTime() > Date.now()) {
    const min = Math.ceil((conta.bloqueadoAte.getTime() - Date.now()) / 60000)
    return { ok: false, erro: `Muitas tentativas. Tente de novo em ${min} minuto(s) ou peça um link de acesso.` }
  }
  // Primeiro acesso, sem senha própria: a senha padrão é o CPF — o mesmo par
  // do /candidato (código da inscrição + CPF). Só vale com e-mail, código da
  // inscrição ou RA no usuário: CPF no usuário E na senha seria entrar sabendo
  // só o CPF, dado que circula demais para proteger documentos e contrato.
  let senhaPadrao = false
  if (!conta.senhaHash) {
    const cpf = await cpfDaConta(conta)
    const usuarioEhCpf = soDigitos(identificador).length === 11 && soDigitos(identificador) === cpf
    if (!cpf) return { ok: false, precisaDefinirSenha: true, erro: 'Você ainda não criou uma senha. Peça um link de acesso para criar a sua.' }
    if (usuarioEhCpf) {
      return { ok: false, erro: 'Por segurança, o CPF não serve como usuário e senha ao mesmo tempo. No usuário, use o seu e-mail ou o código da inscrição.' }
    }
    senhaPadrao = soDigitos(senha) === cpf && soDigitos(senha).length === String(senha).replace(/[.\-\s]/g, '').length
  }
  if (!senhaPadrao && (!conta.senhaHash || !(await bcrypt.compare(senha, conta.senhaHash)))) {
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
  return { ok: true, raw: s.raw, expiresAt: s.expiresAt, accountId: conta.id, senhaPadrao }
}

/**
 * Link de primeiro acesso / recuperação: uso único e vida curta (48h por
 * padrão). O link antigo valia 30 dias e continuava funcionando depois de usado
 * — virava chave permanente para quem o recebesse encaminhado.
 */
export async function criarLinkDeAcesso(
  accountId: number,
  // acesso_direto: gerado pela equipe, abre o portal logado sem pedir para criar senha.
  finalidade: 'primeiro_acesso' | 'recuperacao' | 'acesso_direto' = 'primeiro_acesso',
  canal?: 'whatsapp' | 'email',
): Promise<{ raw: string; url: string; expiresAt: Date }> {
  const raw = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + LINK_TTL_HORAS * 3600_000)
  await prisma.portalAccessLink.create({
    data: { accountId, tokenHash: hashToken(raw), finalidade, canal: canal ?? null, expiresAt },
  })
  const base = await enderecoDoPortal(accountId)
  return { raw, url: `${base}/portal/entrar?c=${encodeURIComponent(raw)}`, expiresAt }
}

/**
 * Endereço do portal desta conta: o da inscrição mais recente — o domínio
 * próprio da instituição, quando houver. A sessão é um cookie do endereço, e
 * entrar pelo domínio do painel não valeria no da instituição.
 */
export async function enderecoDoPortal(accountId: number): Promise<string> {
  const ultima = await prisma.enrollmentRegistration.findFirst({
    where: { status: { not: 'merged' }, lead: { portalAccount: { id: accountId } } },
    orderBy: { id: 'desc' },
    select: { portal: { select: { customDomain: true } } },
  }).catch(() => null)
  const { baseDoPortal } = await import('../lib/appUrl.js')
  return baseDoPortal(ultima?.portal?.customDomain) ?? (process.env.APP_URL || '').replace(/\/$/, '')
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
/** Inscrição que não está mais valendo: só aparece se a pessoa escolher. */
export const INSCRICAO_ENCERRADA = ['cancelled', 'transferred', 'expired']

/**
 * Qual inscrição o portal logado abre: a do código pedido (se for da pessoa);
 * senão a mais recente que ainda vale; só sem nenhuma, a mais recente.
 * Antes abria sempre a mais recente — inclusive cancelada — e a ativa ficava
 * sem acesso (fabad, Fabricio: Pós cancelada por cima do Bacharel pago).
 */
export async function inscricaoDoPortal(leadId: number, codigo?: string | null) {
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { leadId: { in: await fichasDaConta(leadId) }, status: { not: 'merged' } }, orderBy: { id: 'desc' },
    select: { id: true, candidateCode: true, status: true },
  })
  const pedida = codigo ? regs.find((r) => r.candidateCode === codigo) : undefined
  return pedida ?? regs.find((r) => !INSCRICAO_ENCERRADA.includes(r.status)) ?? regs[0] ?? null
}

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
    select: {
      id: true, candidateCode: true, status: true,
      portal: { select: { nome: true } },
      processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
    },
  })
  return {
    accountId: conta.id,
    leadId: conta.leadId,
    temSenha: !!conta.senhaHash,
    nome: conta.lead.nome,
    email: conta.lead.email,
    whatsapp: conta.lead.whatsapp,
    aluno,
    inscricoes: inscricoes.map((i) => ({
      id: i.id, candidateCode: i.candidateCode, status: i.status,
      curso: i.processRegistration?.offering?.course?.nome || i.processRegistration?.offering?.nome || i.portal?.nome || null,
    })),
  }
}

/**
 * Fichas da MESMA PESSOA que a conta do portal enxerga: a da conta e as ligadas
 * a ela como "mesma pessoa, outro curso" (duplicateStatus 'linked', nos dois
 * sentidos) — só as que têm o MESMO CPF da conta (numa conta ou numa inscrição).
 * Cada curso tem a sua ficha (o seu funil), mas o aluno é um só: antes cada conta
 * via só a ficha dela e o login pelo CPF abria sempre a primeira (ineprotec,
 * Samara 19/11: EJA Médio numa ficha, Fundamental na outra).
 */
export async function fichasDaConta(leadId: number): Promise<number[]> {
  const conta = await prisma.portalAccount.findUnique({ where: { leadId }, select: { cpf: true } }).catch(() => null)
  const cpf = soDigitos(conta?.cpf ?? '')
  if (cpf.length !== 11) return [leadId]
  const vistas = new Set<number>([leadId])
  let fila = [leadId]
  for (let passo = 0; passo < 3 && fila.length; passo++) {
    const atuais = await prisma.lead.findMany({ where: { id: { in: fila } }, select: { id: true, possibleDuplicateOfId: true, duplicateStatus: true } })
    const vizinhas = await prisma.lead.findMany({ where: { possibleDuplicateOfId: { in: fila }, duplicateStatus: 'linked' }, select: { id: true } })
    const novas = [
      ...atuais.filter((l) => l.duplicateStatus === 'linked' && l.possibleDuplicateOfId).map((l) => l.possibleDuplicateOfId!),
      ...vizinhas.map((l) => l.id),
    ].filter((id) => !vistas.has(id))
    fila = []
    for (const id of new Set(novas)) {
      const [c, regs] = await Promise.all([
        prisma.portalAccount.findUnique({ where: { leadId: id }, select: { cpf: true } }).catch(() => null),
        prisma.enrollmentRegistration.findMany({ where: { leadId: id }, select: { formData: true } }).catch(() => [] as any[]),
      ])
      const mesmoCpf = soDigitos(c?.cpf ?? '') === cpf || regs.some((r: any) => soDigitos(String(r.formData?.cpf ?? '')) === cpf)
      if (mesmoCpf) { vistas.add(id); fila.push(id) }
    }
  }
  return [...vistas]
}
