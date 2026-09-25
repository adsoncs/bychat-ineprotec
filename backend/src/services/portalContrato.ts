// src/services/portalContrato.ts
//
// Contrato de matrícula no Portal — Fase 5 da consolidação ERP × Portal
// (10/09/2026). O candidato assina onde já está, e a assinatura efetiva a
// matrícula.
//
// O que existia antes, e por que não funcionava:
//
//  1. **Duas noções de "assinado".** `AcaContrato.aceiteEm` (aceite digitando o
//     nome, com IP e data) e `AcaAssinatura` (envelope eletrônico do Autentique).
//     O painel do aluno aceitava qualquer uma das duas como pronta, mas só o
//     envelope efetivava a matrícula. Aqui as duas convergem: assinar no Portal
//     grava o aceite, fecha o envelope aberto (se houver) e efetiva.
//  2. **Circularidade.** `contratoAtivoDoAluno` só procurava contrato de
//     matrícula já `MATRICULADO` — mas é a assinatura que promove a matrícula.
//     Quem estava `INSCRITO` não via o contrato que o matricularia. Das cinco
//     matrículas da demo, quatro estavam presas assim.
//  3. **Nada para clicar.** No modo simulado o link de assinatura apontava para
//     `https://assinatura.simulada/...`, domínio que não existe; e o Autentique
//     não está configurado. O painel oferecia "Assinar contrato" e o botão não
//     levava a lugar nenhum.
//
// Valor jurídico: é o mesmo mecanismo que o SSR do ERP já usava — aceite
// eletrônico com nome, IP, data e cópia do termo congelada no momento do aceite
// (`aceiteTermo`). Não se inventou nada aqui; mudou o lugar onde acontece.

import { prisma } from '../lib/prisma.js'
import { dadosContrato } from './acaContrato.js'
import { efetivarPorContratoAssinado } from './acaEfetivacao.js'

export interface ContratoDoPortal {
  id: number
  matriculaId: number
  titulo: string
  termo: string
  curso: string
  turma: string
  aluno: string
  ra: string
  valorTotalCentavos: number
  numParcelas: number
  valorParcelaCentavos: number
  assinado: boolean
  assinadoEm: Date | null
  assinadoPor: string | null
  /** Envelope eletrônico, quando a instituição usa um provedor externo. */
  envelope: { id: number; status: string; link: string | null } | null
}

/**
 * O contrato que este aluno tem para ver ou assinar.
 *
 * Pega a matrícula mais recente — **em qualquer status** — porque exigir
 * `MATRICULADO` era exatamente o que escondia o contrato de quem precisava
 * assiná-lo.
 */
export async function contratoDoAluno(alunoId: number): Promise<ContratoDoPortal | null> {
  const matricula = await prisma.acaMatricula.findFirst({
    where: { alunoId },
    orderBy: [{ dataMatricula: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true },
  })
  if (!matricula) return null

  const contrato = await prisma.acaContrato.findUnique({
    where: { matriculaId: matricula.id },
    select: { id: true },
  })
  if (!contrato) return null

  const d = await dadosContrato(contrato.id)
  if (!d) return null

  const envelope = await prisma.acaAssinatura.findFirst({
    where: { matriculaId: matricula.id },
    orderBy: { id: 'desc' },
    select: { id: true, status: true, signatarios: { select: { linkAssinatura: true } } },
  })

  // Link de provedor externo só é oferecido se for um endereço de verdade. O
  // modo simulado grava um domínio inexistente, e mandar o candidato para lá é
  // pior do que não mostrar botão nenhum.
  const linkBruto = envelope?.signatarios?.find((s) => s.linkAssinatura)?.linkAssinatura ?? null
  const link = linkBruto && !linkBruto.includes('assinatura.simulada') ? linkBruto : null

  return {
    id: d.id,
    matriculaId: matricula.id,
    titulo: 'Contrato de prestação de serviços educacionais',
    termo: d.termo,
    curso: d.curso,
    turma: d.turma,
    aluno: d.aluno,
    ra: d.ra,
    valorTotalCentavos: d.valorTotal,
    numParcelas: d.numParcelas,
    valorParcelaCentavos: d.valorParcela,
    assinado: !!d.aceiteEm || envelope?.status === 'ASSINADO',
    assinadoEm: d.aceiteEm ?? null,
    assinadoPor: d.aceiteNome ?? null,
    envelope: envelope ? { id: envelope.id, status: envelope.status, link } : null,
  }
}

export type ResultadoAssinatura =
  | { ok: true; jaAssinado: boolean; matriculaEfetivada: boolean }
  | { ok: false; erro: string }

/**
 * Assina o contrato pelo Portal.
 *
 * Idempotente: quem clica duas vezes, ou volta pelo histórico do navegador, não
 * assina duas vezes nem recebe erro. A gravação do aceite é condicional
 * (`updateMany` com `aceiteEm: null` no `where`) porque duas abas abertas na
 * mesma tela são o caso comum, não o raro.
 */
export async function assinarPeloPortal(params: {
  alunoId: number
  nome: string
  ip: string
  userAgent?: string | null
}): Promise<ResultadoAssinatura> {
  const nome = String(params.nome || '').trim()
  // Duas palavras: é o que distingue uma assinatura de um "ok" no campo.
  if (nome.length < 5 || !nome.includes(' ')) {
    return { ok: false, erro: 'Escreva seu nome completo para assinar.' }
  }

  const contrato = await contratoDoAluno(params.alunoId)
  if (!contrato) return { ok: false, erro: 'Não encontramos um contrato para a sua matrícula.' }
  if (contrato.assinado) return { ok: true, jaAssinado: true, matriculaEfetivada: false }

  const d = await dadosContrato(contrato.id)

  const gravado = await prisma.acaContrato.updateMany({
    where: { id: contrato.id, aceiteEm: null },
    data: {
      aceiteEm: new Date(),
      aceiteIp: String(params.ip || '').slice(0, 60),
      aceiteNome: nome.slice(0, 191),
      // O termo é congelado no aceite: mudar o modelo depois não pode reescrever
      // o que a pessoa assinou.
      aceiteTermo: d?.termo ?? null,
    },
  })
  if (gravado.count === 0) return { ok: true, jaAssinado: true, matriculaEfetivada: false }

  // Se a instituição também mantém envelope eletrônico, ele fecha junto — senão
  // ficariam duas verdades sobre o mesmo contrato.
  let envelopeFechado: number | null = null
  if (contrato.envelope && contrato.envelope.status !== 'ASSINADO' && contrato.envelope.status !== 'CANCELADO') {
    const r = await prisma.acaAssinatura.updateMany({
      where: { id: contrato.envelope.id, status: { notIn: ['ASSINADO', 'CANCELADO'] } },
      data: { status: 'ASSINADO', finalizadoEm: new Date() },
    })
    if (r.count > 0) {
      envelopeFechado = contrato.envelope.id
      await prisma.acaSignatario
        .updateMany({
          where: { assinaturaId: contrato.envelope.id, status: { not: 'ASSINADO' } },
          data: { status: 'ASSINADO', assinadoEm: new Date() },
        })
        .catch(() => {})
    }
  }

  // Contrato assinado efetiva a matrícula — é a razão de o contrato existir
  // neste ponto do funil. Quando há envelope, reaproveita a ponte que já
  // existia; sem envelope, promove aqui.
  let matriculaEfetivada = false
  try {
    if (envelopeFechado) {
      await efetivarPorContratoAssinado(envelopeFechado)
      const m = await prisma.acaMatricula.findUnique({
        where: { id: contrato.matriculaId }, select: { status: true },
      })
      matriculaEfetivada = m?.status === 'MATRICULADO'
    } else {
      const r = await prisma.acaMatricula.updateMany({
        where: { id: contrato.matriculaId, status: { notIn: ['MATRICULADO', 'CANCELADO', 'TRANCADO', 'EVADIDO', 'TRANSFERIDO'] } },
        data: { status: 'MATRICULADO' },
      })
      matriculaEfetivada = r.count > 0
    }
  } catch (e: any) {
    // O aceite já está gravado e vale; a promoção da matrícula pode ser refeita.
    console.warn('[portalContrato] falha ao efetivar após assinatura:', e?.message || e)
  }

  return { ok: true, jaAssinado: false, matriculaEfetivada }
}
