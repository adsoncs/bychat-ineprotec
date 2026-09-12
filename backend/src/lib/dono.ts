// src/lib/dono.ts
//
// O dono do produto — um nível acima do SUPERADMIN, que é do cliente.
//
// Existe porque a loja de apps não pode ser configurável por quem compra: se o
// superadmin alcança os direitos de uso, ele se dá os módulos que não pagou.
//
// É ATRIBUTO e não papel: há 47 comparações estritas `role === 'SUPERADMIN'`
// no código e nenhuma hierarquia de papéis. Um valor novo no enum falharia em
// todas elas, e o dono acabaria com MENOS acesso que o superadmin. Assim ele
// segue superadmin em tudo e ganha o que é dele por esta checagem explícita.
//
// Nenhuma rota escreve `isOwner`: quem define é `scripts/definir-dono.ts`, no
// servidor. Uma tela que concede "dono" é uma tela que alguém alcança.

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'

/** Este usuário é o dono do produto? Lê do banco — o papel no JWT não basta. */
export async function ehDono(userId: number | undefined | null): Promise<boolean> {
  if (!userId) return false
  // Lê do banco a cada vez, de propósito: o JWT vive horas, e tirar o dono de
  // alguém precisa valer no pedido seguinte, não no próximo login.
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true, active: true } })
  return u?.isOwner === true && u.active === true
}

/**
 * Trava de rota: só o dono passa.
 *
 * A mensagem não explica o que existe do outro lado. Quem não é dono não
 * precisa saber que há uma loja ali — e descrever a tranca ajuda quem tenta
 * abri-la.
 */
export async function exigirDono(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = (req as unknown as { user?: { userId?: number } }).user?.userId
  if (!(await ehDono(userId))) {
    return reply.code(404).send({ error: 'Não encontrado' })
  }
}
