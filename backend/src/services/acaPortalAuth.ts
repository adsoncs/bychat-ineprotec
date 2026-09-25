// src/services/acaPortalAuth.ts
//
// Login próprio do portal do aluno (G6 / RF-701, RN-702).
//
// Até aqui o acesso era só por link com token na URL. Isso funciona para o
// aviso de vencimento, mas não como porta de entrada: link vaza em print, em
// encaminhamento de WhatsApp e no histórico do navegador do laboratório. O
// aluno passa a ter CPF ou RA + senha; o link continua existindo — é ele que
// permite definir a primeira senha e recuperar a esquecida.

import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { mintPortalToken } from '../lib/acaPortalToken.js'
import { getProviderForLeadOwner } from './whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from './notify.js'

const MAX_TENTATIVAS = 5
const BLOQUEIO_MINUTOS = 15
const MIN_SENHA = 8

export const soDigitos = (s: string) => String(s || '').replace(/\D/g, '')

export function validarSenha(senha: string): string | null {
  if (!senha || senha.length < MIN_SENHA) return `A senha precisa ter ao menos ${MIN_SENHA} caracteres.`
  if (!/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) return 'A senha precisa misturar letras e números.'
  return null
}

/**
 * Localiza o aluno por CPF ou RA.
 *
 * O CPF é comparado só pelos dígitos: o cadastro tem gente com ponto e traço e
 * gente sem, e exigir do aluno o formato exato do banco é uma armadilha.
 */
export async function acharPorIdentificador(identificador: string) {
  const bruto = String(identificador || '').trim()
  if (!bruto) return null

  const porRa = await prisma.aluno.findFirst({
    where: { ra: bruto },
    select: { id: true, ra: true, cpf: true, leadId: true, portalSenhaHash: true, portalTentativas: true, portalBloqueadoAte: true, ativo: true },
  })
  if (porRa) return porRa

  const digitos = soDigitos(bruto)
  if (digitos.length < 11) return null
  // MySQL não tem regex de substituição em WHERE portátil aqui; o conjunto de
  // alunos com CPF é pequeno o bastante para comparar em memória.
  const candidatos = await prisma.aluno.findMany({
    where: { cpf: { not: null } },
    select: { id: true, ra: true, cpf: true, leadId: true, portalSenhaHash: true, portalTentativas: true, portalBloqueadoAte: true, ativo: true },
  })
  return candidatos.find((a) => soDigitos(a.cpf ?? '') === digitos) ?? null
}

export interface ResultadoLogin {
  ok: boolean
  token?: string
  alunoId?: number
  erro?: string
  precisaDefinirSenha?: boolean
}

/**
 * A conta única do portal serve também ao painel do aluno.
 *
 * Antes, a mesma pessoa tinha duas senhas: a da conta que criou para se
 * inscrever (`PortalAccount`) e a do aluno (`Aluno.portalSenhaHash`). Quem
 * passou de candidato a aluno descobria isso do pior jeito — tentando entrar
 * com a senha que sempre usou e sendo recusado.
 *
 * Agora a conta do portal é conferida primeiro. Se ela abrir, o painel do ERP
 * aceita: a pessoa é a mesma, ligada pelo lead ou pelo CPF.
 */
type TentativaConta = 'ok' | 'senha_errada' | 'bloqueada' | 'sem_conta'

async function tentarContaDoPortal(alunoId: number, leadId: number | null, senha: string): Promise<TentativaConta> {
  // SÓ pelo lead, nunca pelo CPF.
  //
  // A primeira versão aceitava `OR: [{ leadId }, { cpf }]` e isso abriu um
  // buraco grave: com o mesmo CPF em mais de uma conta — dado sujo, cadastro
  // repetido, CPF de teste — o login do aluno casava com a conta de OUTRA
  // pessoa. O teste pegou exatamente isso: aluno do lead 974 recebendo a conta
  // do lead 924. `Aluno.leadId` e `PortalAccount.leadId` são únicos e é a
  // efetivação que os liga; é o único elo em que dá para confiar aqui.
  if (!leadId) return 'sem_conta'
  const conta = await prisma.portalAccount.findFirst({
    where: { leadId, ativo: true, senhaHash: { not: null } },
    select: { id: true, senhaHash: true, bloqueadoAte: true, tentativas: true },
  })
  if (!conta?.senhaHash) return 'sem_conta'
  if (conta.bloqueadoAte && conta.bloqueadoAte.getTime() > Date.now()) return 'bloqueada'

  if (await bcrypt.compare(senha, conta.senhaHash)) {
    await prisma.portalAccount.update({
      where: { id: conta.id },
      data: { tentativas: 0, bloqueadoAte: null, ultimoLoginEm: new Date() },
    }).catch(() => {})
    return 'ok'
  }

  // Errar a senha da conta conta como tentativa NA CONTA: senão o portal do
  // aluno vira uma porta sem tranca para tentar senha da mesma pessoa.
  const tentativas = (conta.tentativas || 0) + 1
  await prisma.portalAccount.update({
    where: { id: conta.id },
    data: {
      tentativas,
      ...(tentativas >= MAX_TENTATIVAS ? { bloqueadoAte: new Date(Date.now() + BLOQUEIO_MINUTOS * 60000) } : {}),
    },
  }).catch(() => {})
  return 'senha_errada'
}

/**
 * Quem entrou com a senha antiga passa a ter conta única, em silêncio.
 *
 * O hash é o mesmo algoritmo dos dois lados (bcrypt, custo 10), então dá para
 * copiar sem pedir nada à pessoa. Ela entra como sempre entrou e, da próxima
 * vez, a mesma senha já abre os dois lugares — a base se unifica sozinha,
 * conforme cada um aparece, sem migração em massa de credencial.
 */
async function migrarParaContaUnica(alunoId: number, hashAntigo: string): Promise<void> {
  try {
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { leadId: true, cpf: true } })
    if (!aluno?.leadId) return
    const conta = await prisma.portalAccount.findUnique({ where: { leadId: aluno.leadId }, select: { id: true, senhaHash: true } })
    if (conta?.senhaHash) return // já tem conta com senha: nada a fazer
    if (conta) {
      await prisma.portalAccount.update({
        where: { id: conta.id },
        data: { senhaHash: hashAntigo, senhaDefinidaEm: new Date(), ...(aluno.cpf ? { cpf: soDigitos(aluno.cpf) } : {}) },
      })
    } else {
      await prisma.portalAccount.create({
        data: {
          leadId: aluno.leadId,
          cpf: aluno.cpf ? soDigitos(aluno.cpf) : null,
          senhaHash: hashAntigo,
          senhaDefinidaEm: new Date(),
        },
      })
    }
    console.log(`[acaPortalAuth] aluno ${alunoId} migrado para a conta única do portal`)
  } catch (e: any) {
    // Migrar é conveniência: falhar aqui não pode impedir alguém de entrar.
    console.warn('[acaPortalAuth] falha ao migrar para conta única:', e?.message || e)
  }
}

export async function login(identificador: string, senha: string): Promise<ResultadoLogin> {
  const aluno = await acharPorIdentificador(identificador)
  // Mensagem única para "não existe" e "senha errada": diferenciar as duas
  // transformaria o login em consulta de quem estuda aqui.
  const generico = { ok: false, erro: 'CPF/RA ou senha incorretos.' }
  if (!aluno || !aluno.ativo) return generico

  if (aluno.portalBloqueadoAte && aluno.portalBloqueadoAte.getTime() > Date.now()) {
    const min = Math.ceil((aluno.portalBloqueadoAte.getTime() - Date.now()) / 60000)
    return { ok: false, erro: `Muitas tentativas. Tente novamente em ${min} minuto(s) ou acesse pelo link enviado no WhatsApp.` }
  }

  // 1) A conta única primeiro. É a senha que a pessoa criou para se inscrever e
  //    a que ela lembra.
  const pelaConta = await tentarContaDoPortal(aluno.id, aluno.leadId ?? null, senha)
  if (pelaConta === 'ok') {
    await prisma.aluno.update({
      where: { id: aluno.id },
      data: { portalTentativas: 0, portalBloqueadoAte: null, portalUltimoLoginEm: new Date() },
    }).catch(() => {})
    return { ok: true, token: mintPortalToken('aca-aluno', aluno.id, 7), alunoId: aluno.id }
  }
  if (pelaConta === 'bloqueada') {
    return { ok: false, erro: `Muitas tentativas. Tente novamente em ${BLOQUEIO_MINUTOS} minutos ou acesse pelo link enviado no WhatsApp.` }
  }

  // 2) A senha antiga do ERP, para quem já tinha uma. Ao acertar, migra.
  if (!aluno.portalSenhaHash) {
    // Quem TEM conta e só errou a senha não pode ouvir "você ainda não criou
    // uma senha": além de confundir quem já tem uma, a frase entrega o estado
    // da conta a quem está tentando adivinhar.
    if (pelaConta === 'senha_errada') return generico
    return { ok: false, precisaDefinirSenha: true, erro: 'Você ainda não criou uma senha. Peça o link de acesso para definir a sua.' }
  }
  if (!(await bcrypt.compare(senha, aluno.portalSenhaHash))) {
    const tentativas = (aluno.portalTentativas || 0) + 1
    await prisma.aluno.update({
      where: { id: aluno.id },
      data: {
        portalTentativas: tentativas,
        ...(tentativas >= MAX_TENTATIVAS ? { portalBloqueadoAte: new Date(Date.now() + BLOQUEIO_MINUTOS * 60000) } : {}),
      },
    })
    return generico
  }

  // Acertou a senha antiga: leva junto para a conta única, sem pedir nada.
  await migrarParaContaUnica(aluno.id, aluno.portalSenhaHash)

  await prisma.aluno.update({
    where: { id: aluno.id },
    data: { portalTentativas: 0, portalBloqueadoAte: null, portalUltimoLoginEm: new Date() },
  })
  return { ok: true, token: mintPortalToken('aca-aluno', aluno.id, 7), alunoId: aluno.id }
}

export async function definirSenha(alunoId: number, senha: string): Promise<{ ok: boolean; erro?: string }> {
  const problema = validarSenha(senha)
  if (problema) return { ok: false, erro: problema }
  await prisma.aluno.update({
    where: { id: alunoId },
    data: {
      portalSenhaHash: await bcrypt.hash(senha, 10),
      portalSenhaDefinidaEm: new Date(),
      portalTentativas: 0,
      portalBloqueadoAte: null,
    },
  })
  return { ok: true }
}

/**
 * Envia o link de acesso pelo canal que o aluno já usa.
 *
 * Responde sempre a mesma coisa, exista o aluno ou não — senão o formulário de
 * "esqueci a senha" vira um verificador de matrícula para qualquer um.
 */
export async function enviarLinkAcesso(identificador: string, baseUrl: string): Promise<{ enviado: boolean; canal?: string }> {
  const aluno = await acharPorIdentificador(identificador)
  if (!aluno) return { enviado: false }

  const completo = await prisma.aluno.findUnique({
    where: { id: aluno.id },
    select: { id: true, lead: { select: { id: true, nome: true, whatsapp: true, email: true } } },
  })
  const lead = completo?.lead
  if (!lead) return { enviado: false }

  const token = mintPortalToken('aca-aluno', aluno.id, 1)
  const url = `${baseUrl.replace(/\/$/, '')}/portal/aca/senha?t=${encodeURIComponent(token)}`
  const texto = `Olá, ${lead.nome ?? 'tudo bem'}! Use o link abaixo para entrar no portal e criar sua senha:\n\n${url}\n\nO link vale por 24 horas e é de uso pessoal.`

  if (lead.whatsapp) {
    try {
      const { provider } = await getProviderForLeadOwner({ id: lead.id, whatsapp: lead.whatsapp })
      await provider.sendText(lead.whatsapp, texto)
      return { enviado: true, canal: 'whatsapp' }
    } catch {
      // Cai para o e-mail: WhatsApp fora do ar não pode deixar o aluno sem acesso.
    }
  }
  if (lead.email) {
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'secretaria'),
        to: lead.email,
        subject: 'Acesso ao portal do aluno',
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${texto.replace(/\n/g, '<br>')}</div>`,
      })
      return { enviado: true, canal: 'email' }
    } catch { /* nada a fazer */ }
  }
  return { enviado: false }
}
