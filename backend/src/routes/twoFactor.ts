// src/routes/twoFactor.ts
//
// Cadastro e uso do segundo fator (G16 / RN-1401).
//
// O fluxo tem três passos de propósito: gerar o segredo, CONFIRMAR com um
// código válido e só então ativar. Ativar direto ao gerar é o erro clássico —
// se o usuário não conseguiu ler o QR, ele fica trancado fora da própria conta
// e alguém precisa desligar o 2FA pelo banco.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { novoSegredo, uriOtpAuth, verificarTotp, gerarCodigosRecuperacao } from '../services/twoFactor.js'
import bcrypt from 'bcryptjs'

export async function twoFactorRoutes(app: FastifyInstance) {
  /** Situação do 2FA do usuário logado. */
  app.get('/api/admin/2fa/status', { preHandler: authMiddleware }, async (req) => {
    const userId = (req as any).user?.userId as number
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorConfirmedAt: true, twoFactorSecret: true, twoFactorBackupCodes: true },
    })
    let restantes = 0
    try { restantes = u?.twoFactorBackupCodes ? (JSON.parse(u.twoFactorBackupCodes) as string[]).length : 0 } catch { restantes = 0 }
    return {
      habilitado: !!u?.twoFactorEnabled,
      confirmadoEm: u?.twoFactorConfirmedAt ?? null,
      aguardandoConfirmacao: !!u?.twoFactorSecret && !u?.twoFactorEnabled,
      codigosRecuperacaoRestantes: restantes,
    }
  })

  /**
   * Passo 1 — gera o segredo e devolve o otpauth:// para virar QR.
   * Não ativa nada: até a confirmação, o login segue só com senha.
   */
  app.post('/api/admin/2fa/iniciar', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user?.userId as number
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, twoFactorEnabled: true } })
    if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' })
    if (u.twoFactorEnabled) return reply.code(400).send({ error: 'O segundo fator já está ativo. Desative antes de cadastrar outro aplicativo.' })

    const segredo = novoSegredo()
    await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: segredo, twoFactorEnabled: false } })
    const uri = uriOtpAuth({ segredo, conta: u.email, emissor: 'ByChat' })
    // O QR é gerado aqui e vai como data-URI: a página de configuração não pode
    // buscar imagem de servidor externo com o segredo dentro da URL.
    let qrDataUrl: string | null = null
    try {
      const QRCode = (await import('qrcode')).default
      qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
    } catch {
      // Sem QR o cadastro ainda funciona: o segredo é digitável no aplicativo.
    }
    return { segredo, uri, qrDataUrl }
  })

  /** Passo 2 — confirma com um código do aplicativo e ativa. */
  app.post('/api/admin/2fa/confirmar', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user?.userId as number
    const codigo = String((req.body as any)?.codigo || '')
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorSecret: true, twoFactorEnabled: true } })
    if (!u?.twoFactorSecret) return reply.code(400).send({ error: 'Gere o QR antes de confirmar.' })
    if (u.twoFactorEnabled) return reply.code(400).send({ error: 'O segundo fator já está ativo.' })
    if (!verificarTotp(u.twoFactorSecret, codigo)) {
      return reply.code(400).send({ error: 'Código inválido. Confira o relógio do celular e tente o código atual.' })
    }

    const { visiveis, hashes } = gerarCodigosRecuperacao()
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: new Date(),
        twoFactorBackupCodes: JSON.stringify(hashes),
      },
    })
    const actor = auditActor(req)
    void logUserAudit({
      action: 'auth.2fa.enabled', targetUserId: userId, targetType: 'auth',
      targetLabel: 'Segundo fator ativado', ...actor,
    })
    // Os códigos aparecem UMA vez: o banco guarda só o hash.
    return { ok: true, codigosRecuperacao: visiveis }
  })

  /**
   * Desativa. Exige a senha atual — quem senta no computador destravado de um
   * colega não pode desligar o segundo fator só por estar com a sessão aberta.
   */
  app.post('/api/admin/2fa/desativar', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user?.userId as number
    const senha = String((req.body as any)?.senha || '')
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, twoFactorEnabled: true } })
    if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' })
    if (!senha || !(await bcrypt.compare(senha, u.passwordHash))) {
      return reply.code(401).send({ error: 'Senha incorreta.' })
    }
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorConfirmedAt: null, twoFactorBackupCodes: null },
    })
    const actor = auditActor(req)
    void logUserAudit({
      action: 'auth.2fa.disabled', targetUserId: userId, targetType: 'auth',
      targetLabel: 'Segundo fator desativado', ...actor,
    })
    return { ok: true }
  })

  /** Gera novos códigos de recuperação, invalidando os antigos. */
  app.post('/api/admin/2fa/codigos', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user?.userId as number
    const senha = String((req.body as any)?.senha || '')
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, twoFactorEnabled: true } })
    if (!u?.twoFactorEnabled) return reply.code(400).send({ error: 'O segundo fator não está ativo.' })
    if (!senha || !(await bcrypt.compare(senha, u.passwordHash))) {
      return reply.code(401).send({ error: 'Senha incorreta.' })
    }
    const { visiveis, hashes } = gerarCodigosRecuperacao()
    await prisma.user.update({ where: { id: userId }, data: { twoFactorBackupCodes: JSON.stringify(hashes) } })
    const actor = auditActor(req)
    void logUserAudit({
      action: 'auth.2fa.codes_regenerated', targetUserId: userId, targetType: 'auth',
      targetLabel: 'Códigos de recuperação regerados', ...actor,
    })
    return { ok: true, codigosRecuperacao: visiveis }
  })
}
