// src/lib/donoDoLead.ts
//
// Lead com responsável não muda de mão sozinho.
//
// Regra do cliente (fabad, 20/10): quando um lead cai para uma pessoa, nenhuma
// ação do sistema tira o lead dela — rodízio, Jornada IA, workflow, escalada,
// virada de turno, "assumir ao responder", sincronizações. Só a própria pessoa
// transfere (ou um administrador, para destravar quem saiu da empresa).
//
// O lead troca de responsável por dezenas de caminhos; a trava mora no
// middleware do Prisma (lib/prisma.ts), por onde todos passam. As rotas em que
// uma PESSOA transfere declaram quem está agindo com `agirComo` — sem isso, a
// gravação é tratada como automática e só pode dar dono a quem não tem.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface AtorDaTroca {
  userId: number
  admin: boolean
}

const contexto = new AsyncLocalStorage<AtorDaTroca>()

/**
 * Executa `fn` como ação manual de `user`: dentro dela (e do que ela aguardar),
 * as gravações de responsável valem como feitas por essa pessoa.
 */
export function comoAtor<T>(user: { userId: number; role?: string | null }, fn: () => Promise<T>): Promise<T> {
  // Aguarda DENTRO do contexto: a promise do Prisma é preguiçosa — a consulta
  // só roda no `.then`, e se ele acontecesse fora daqui o ator se perderia.
  return contexto.run({ userId: user.userId, admin: user.role === 'ADMIN' || user.role === 'SUPERADMIN' }, async () => await fn())
}

/**
 * preHandler das rotas em que uma pessoa troca o responsável (depois do
 * authMiddleware): o handler inteiro roda como ação manual do usuário logado.
 */
export function rotaManualDeDono(req: any, _reply: unknown, done: (err?: Error) => void): void {
  const user = req.user
  if (!user?.userId) return done()
  contexto.run({ userId: user.userId, admin: user.role === 'ADMIN' || user.role === 'SUPERADMIN' }, () => done())
}

/**
 * Encaminhamento do sistema para OUTRA equipe (decisão do cliente, 20/10): o
 * lead muda de setor, então o rodízio da equipe nova escolhe o responsável. Na
 * MESMA equipe a trava continua valendo — quem só chama isto é
 * `enviarParaEquipe` (services/encaminharEquipe.ts), depois de conferir isso.
 */
export function comoEncaminhamentoDeEquipe<T>(fn: () => Promise<T>): Promise<T> {
  return contexto.run({ userId: 0, admin: true }, async () => await fn())
}

export function atorDaTroca(): AtorDaTroca | null {
  return contexto.getStore() ?? null
}

/** Pode trocar o dono atual? Lead sem dono recebe dono de qualquer caminho. */
export function podeTrocarDono(donoAtual: number | null, novoDono: number | null): boolean {
  if (donoAtual == null || donoAtual === novoDono) return true
  const ator = atorDaTroca()
  return !!ator && (ator.admin || ator.userId === donoAtual)
}
