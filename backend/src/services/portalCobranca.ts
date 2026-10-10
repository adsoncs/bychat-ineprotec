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
import type { TabelaDePrecos } from './tabelaDePrecos.js'
import { opcoesDoPlano, planosDaOferta, valorDaOpcao } from './planoFinanceiro.js'

export interface CobrancaDoPortal {
  escopo: 'taxa' | 'curso'
  /** Em reais. 0 quando não há valor configurado. */
  valor: number
  /** Como a cobrança aparece para a pessoa e no financeiro. Matrícula e 1ª
   *  mensalidade usam o texto do resumo quando o portal personalizou
   *  (Branding › Textos: resumoMatricula / resumoMensalidade); o curso pela
   *  tabela de preços usa resumoCurso. */
  rotulo: string
  /** De onde veio o valor — ajuda a secretaria a achar onde corrigir. */
  fonte: 'processo' | 'plano_erp' | 'oferta' | 'tabela' | 'nenhuma'
  contexto: ContextoDaInscricao
  /**
   * Tabela de preços da oferta, quando há: cada meio cobra o curso inteiro pela
   * condição dela, e `valor` é o à vista. Ver services/tabelaDePrecos.
   */
  tabela?: TabelaDePrecos | null
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
      portal: { select: { paymentScope: true, brandLabels: true } },
      processRegistration: {
        select: {
          selectionProcessId: true,
          selectionProcess: { select: { taxaInscricao: true } },
          offering: {
            select: {
              id: true, courseId: true, levelId: true, modalityId: true,
              valorMatricula: true, valorMensalidade: true, tabelaPrecos: true,
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

  // O nome que a instituição deu no resumo vale também para a cobrança — senão
  // o resumo diz "1ª parcela" e o pagamento/fatura dizem "1ª mensalidade".
  const textos = (reg.portal?.brandLabels ?? {}) as Record<string, unknown>
  const texto = (chave: string, padrao: string) => {
    const v = typeof textos[chave] === 'string' ? (textos[chave] as string).trim() : ''
    return v || padrao
  }
  const MATRICULA = texto('resumoMatricula', 'Matrícula')
  const MENSALIDADE = texto('resumoMensalidade', '1ª mensalidade')
  const CURSO = texto('resumoCurso', 'Curso')

  if (reg.portal?.paymentScope !== 'curso') {
    const taxa = Number(reg.processRegistration?.selectionProcess?.taxaInscricao ?? 0)
    return { escopo: 'taxa', valor: taxa > 0 ? taxa : 0, rotulo: 'Taxa de inscrição', fonte: taxa > 0 ? 'processo' : 'nenhuma', contexto }
  }

  // Plano de pagamento (services/planoFinanceiro). O valor aqui é o da 1ª
  // opção do 1º plano; a tela de pagamento troca de plano e de opção
  // (services/checkoutDoPlano).
  const [plano1] = await planosDaOferta(of?.id)
  const opcao1 = plano1 ? opcoesDoPlano(plano1)[0] : undefined
  if (plano1 && opcao1) {
    return {
      escopo: 'curso', valor: valorDaOpcao(plano1, opcao1),
      rotulo: opcao1 === 'integral' ? CURSO : plano1.taxaMatriculaCentavos > 0 ? MATRICULA : texto('resumoMensalidade', '1ª parcela'),
      fonte: 'plano_erp', contexto,
    }
  }

  // O plano de pagamento é a única fonte do preço do curso: sem plano ativo,
  // não há o que cobrar (a tabela de preços e os valores avulsos da oferta
  // deixaram de valer). O checkout avisa e o painel mostra "falta plano".
  return { escopo: 'curso', valor: 0, rotulo: MATRICULA, fonte: 'nenhuma', contexto }
}
