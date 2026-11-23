// src/services/documentoLados.ts
//
// Revisão por lado do documento frente e verso.
//
// Um documento enviado em dois arquivos (frente + verso) é um registro só, com
// um `status` geral — é ele que contadores, etapas, funil, fluxos e o
// auto-avanço leem. Aqui cada face ganha a própria revisão (`lados`), para a
// secretaria aprovar a frente e recusar o verso, e o aluno reenviar só a face
// recusada.
//
// Regra do status geral: aprovado só com as duas faces aprovadas; recusado se
// qualquer face foi recusada; senão pendente. Aprovação geral feita por outro
// caminho (lote da IA, análise acadêmica) vale para as duas faces.

export type Lado = 'frente' | 'verso'
export type SituacaoLado = 'pending' | 'approved' | 'rejected'

export interface RevisaoDoLado {
  status: SituacaoLado
  nota: string | null
  por: number | null
  em: string | null
}

export interface LadosDoDocumento { frente: RevisaoDoLado; verso: RevisaoDoLado }

type DocLike = { versoFileUrl?: string | null; status: string; reviewNote?: string | null; reviewedBy?: number | null; reviewedAt?: Date | string | null; lados?: unknown }

const situacao = (s: unknown): SituacaoLado => (s === 'approved' || s === 'rejected' ? s : 'pending')

/** As duas faces do documento (null = arquivo único, sem verso). */
export function ladosDoDocumento(doc: DocLike): LadosDoDocumento | null {
  if (!doc.versoFileUrl) return null
  const geral: RevisaoDoLado = {
    status: situacao(doc.status), nota: doc.reviewNote ?? null, por: doc.reviewedBy ?? null,
    em: doc.reviewedAt ? new Date(doc.reviewedAt).toISOString() : null,
  }
  // Aprovado no geral (por qualquer caminho) = as duas faces aprovadas.
  if (geral.status === 'approved') return { frente: { ...geral, nota: null }, verso: { ...geral, nota: null } }
  const l = (doc.lados && typeof doc.lados === 'object' ? doc.lados : null) as Partial<Record<Lado, Partial<RevisaoDoLado>>> | null
  // Sem revisão por lado: as duas faces seguem o geral (documentos antigos).
  if (!l?.frente && !l?.verso) return { frente: { ...geral }, verso: { ...geral } }
  const ler = (x?: Partial<RevisaoDoLado>): RevisaoDoLado => ({ status: situacao(x?.status), nota: x?.nota ?? null, por: x?.por ?? null, em: x?.em ?? null })
  return { frente: ler(l.frente), verso: ler(l.verso) }
}

export function statusGeral(l: LadosDoDocumento): SituacaoLado {
  if (l.frente.status === 'rejected' || l.verso.status === 'rejected') return 'rejected'
  if (l.frente.status === 'approved' && l.verso.status === 'approved') return 'approved'
  return 'pending'
}

/** Motivo geral (o que o aluno e os fluxos leem): só as faces recusadas, com o nome da face. */
export function notaGeral(l: LadosDoDocumento): string | null {
  const partes = (['frente', 'verso'] as const)
    .filter((k) => l[k].status === 'rejected')
    .map((k) => `${k === 'frente' ? 'Frente' : 'Verso'}: ${l[k].nota || 'precisa ser reenviado'}`)
  return partes.length ? partes.join(' · ') : null
}

/**
 * A revisão de uma face (ou das duas, sem `lado`) e o que fica gravado no
 * documento: lados, status e motivo gerais.
 */
export function revisar(doc: DocLike, p: { lado: Lado | null; status: 'approved' | 'rejected'; nota: string | null; por: number }) {
  const agora = new Date().toISOString()
  const atual = ladosDoDocumento(doc)
  if (!atual) return { lados: null, status: p.status as SituacaoLado, reviewNote: p.nota }
  const nova: RevisaoDoLado = { status: p.status, nota: p.status === 'rejected' ? p.nota : null, por: p.por, em: agora }
  const lados: LadosDoDocumento = p.lado
    ? { ...atual, [p.lado]: nova }
    : { frente: { ...nova }, verso: { ...nova } }
  const status = statusGeral(lados)
  return { lados, status, reviewNote: status === 'rejected' ? notaGeral(lados) : status === 'approved' ? (p.lado ? null : p.nota) : null }
}
