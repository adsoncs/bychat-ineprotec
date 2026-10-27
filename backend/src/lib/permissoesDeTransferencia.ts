// src/lib/permissoesDeTransferencia.ts
//
// Quem pode TRANSFERIR leads e contatos e quem pode PEGAR PARA SI um lead que
// está com outra pessoa. Vale igual em Leads, Conversas e Contatos — todas as
// rotas que trocam o responsável perguntam aqui.
//
// Configurado em Configurações › Equipes: a equipe tem as duas marcações
// (Team.podeTransferir / podePegarDeOutros) e cada membro pode ter a sua
// (TeamMember, null = igual à equipe), que vale mais que a da equipe. Quem está
// em várias equipes recebe a permissão se QUALQUER uma delas der.
//
// Admin e superadmin podem tudo. Quem não está em equipe nenhuma transfere
// (como sempre foi) e não pega de outros.

import { prisma } from './prisma.js'

export interface PermissoesDeTransferencia {
  /** Transferir leads/contatos que são seus ou estão sem dono. */
  transferir: boolean
  /** Pegar para si, ou transferir, um lead que está com OUTRA pessoa — passa por cima do Dono fixo. */
  pegarDeOutros: boolean
}

const ehAdmin = (role?: string | null) => role === 'ADMIN' || role === 'SUPERADMIN'

export async function permissoesDeTransferencia(userId: number, role?: string | null): Promise<PermissoesDeTransferencia> {
  if (ehAdmin(role)) return { transferir: true, pegarDeOutros: true }
  const vinculos = await prisma.teamMember.findMany({
    where: { userId, team: { active: true } },
    select: {
      podeTransferir: true,
      podePegarDeOutros: true,
      team: { select: { podeTransferir: true, podePegarDeOutros: true } },
    },
  }).catch(() => [] as any[])
  if (!vinculos.length) return { transferir: true, pegarDeOutros: false }
  return {
    transferir: vinculos.some((v) => v.podeTransferir ?? v.team.podeTransferir),
    pegarDeOutros: vinculos.some((v) => v.podePegarDeOutros ?? v.team.podePegarDeOutros),
  }
}
