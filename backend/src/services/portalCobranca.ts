// src/services/portalCobranca.ts
//
// O que o checkout do portal cobra de uma inscrição, e em que contexto.
//
// Havia uma promessa não cumprida: o portal com "O que cobra: Curso" dizia
// "entrada agora e o restante como parcelas do contrato", mas o checkout
// cobrava sempre a taxa de inscrição do processo. Agora:
//   · escopo 'taxa'  → taxa de inscrição do processo seletivo;
//   · escopo 'curso' → a primeira cobrança do curso: a matrícula do plano de
//     pagamento da oferta, ou a 1ª mensalidade quando não há matrícula. Sem
//     plano no ERP, valem os valores cadastrados na própria oferta.
// É a mesma ordem em que o ERP abate o que foi pago ao gerar o contrato
// (matrícula primeiro, depois as mensalidades) — ver acaFinanceiro.
//
// O contexto (curso, oferta, processo, nível, modalidade, CPF, e-mail) é o que
// as travas do cupom conferem.

import { prisma } from '../lib/prisma.js'

export interface CobrancaDoPortal {
  escopo: 'taxa' | 'curso'
  /** Em reais. 0 quando não há valor configurado. */
  valor: number
  /** Como a cobrança aparece para a pessoa e no financeiro. */
  rotulo: 'Taxa de inscrição' | 'Matrícula' | '1ª mensalidade'
  /** De onde veio o valor — ajuda a secretaria a achar onde corrigir. */
  fonte: 'processo' | 'plano_erp' | 'oferta' | 'nenhuma'
  contexto: ContextoDaInscricao
}

export interface ContextoDaInscricao {
  portalId: number | null
  offeringId: number | null
  courseId: number | null
  processId: number | null
  levelId: number | null
  modalityId: number | null
  cpf: string | null
  email: string | null
}

export async function cobrancaDoPortal(registrationId: number): Promise<CobrancaDoPortal | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      portalId: true, formData: true,
      lead: { select: { email: true } },
      portal: { select: { paymentScope: true } },
      processRegistration: {
        select: {
          selectionProcessId: true,
          selectionProcess: { select: { taxaInscricao: true } },
          offering: {
            select: {
              id: true, courseId: true, levelId: true, modalityId: true,
              valorMatricula: true, valorMensalidade: true,
            },
          },
        },
      },
    },
  })
  if (!reg) return null
  const fd = (reg.formData ?? {}) as Record<string, unknown>
  const of = reg.processRegistration?.offering ?? null
  const contexto: ContextoDaInscricao = {
    portalId: reg.portalId ?? null,
    offeringId: of?.id ?? null,
    courseId: of?.courseId ?? null,
    processId: reg.processRegistration?.selectionProcessId ?? null,
    levelId: of?.levelId ?? null,
    modalityId: of?.modalityId ?? null,
    cpf: String(fd.cpf ?? '').replace(/\D/g, '') || null,
    email: String(reg.lead?.email || fd.email || '').trim().toLowerCase() || null,
  }

  if (reg.portal?.paymentScope !== 'curso') {
    const taxa = Number(reg.processRegistration?.selectionProcess?.taxaInscricao ?? 0)
    return { escopo: 'taxa', valor: taxa > 0 ? taxa : 0, rotulo: 'Taxa de inscrição', fonte: taxa > 0 ? 'processo' : 'nenhuma', contexto }
  }

  // Curso: plano de pagamento ativo da oferta (ERP) primeiro.
  if (of?.id) {
    const plano = await prisma.acaPlanoPagamento.findFirst({
      where: { courseOfferingId: of.id, ativo: true },
      orderBy: { id: 'asc' },
      select: { taxaMatriculaCentavos: true, valorParcelaCentavos: true },
    }).catch(() => null)
    if (plano && plano.taxaMatriculaCentavos > 0) {
      return { escopo: 'curso', valor: plano.taxaMatriculaCentavos / 100, rotulo: 'Matrícula', fonte: 'plano_erp', contexto }
    }
    if (plano && plano.valorParcelaCentavos > 0) {
      return { escopo: 'curso', valor: plano.valorParcelaCentavos / 100, rotulo: '1ª mensalidade', fonte: 'plano_erp', contexto }
    }
    const matricula = Number(of.valorMatricula ?? 0)
    if (matricula > 0) return { escopo: 'curso', valor: matricula, rotulo: 'Matrícula', fonte: 'oferta', contexto }
    const mensalidade = Number(of.valorMensalidade ?? 0)
    if (mensalidade > 0) return { escopo: 'curso', valor: mensalidade, rotulo: '1ª mensalidade', fonte: 'oferta', contexto }
  }
  return { escopo: 'curso', valor: 0, rotulo: 'Matrícula', fonte: 'nenhuma', contexto }
}
