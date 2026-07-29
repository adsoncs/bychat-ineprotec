// src/services/acaDocRender.ts
// Renderização compartilhada dos PDFs de documentos (admin + portal do aluno).

import { prisma } from '../lib/prisma.js'
import { pdfHistorico, pdfDeclaracao, pdfAta, pdfRecibo, pdfCertificado, pdfQuitacaoAnual, pdfCarteirinha, pdfInformeIR, type DocHeader } from './acaPdf.js'

export async function getDocHeader(): Promise<DocHeader> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['legal.company_name', 'legal.cnpj', 'business.company_name'] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); const raw = r ? r.value : null; return typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : raw }
  const instituicao = (v('legal.company_name') as string) || (v('business.company_name') as string) || 'Instituição'
  const cnpj = (v('legal.cnpj') as string) || null
  return { instituicao, cnpj: cnpj && cnpj.trim() ? cnpj : null }
}

export function dataExtenso(d = new Date()) {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`
}

/** Renderiza o PDF de um AcaDocumento a partir do snapshot. Retorna null se tipo inválido. */
export async function renderDocumentoPdf(doc: { numero: string; tipo: string; dadosJson: any; emitidoEm: Date }): Promise<Buffer | null> {
  const h = await getDocHeader()
  const data = (doc.dadosJson as any) || {}
  const quando = dataExtenso(new Date(doc.emitidoEm))
  if (doc.tipo === 'HISTORICO') return pdfHistorico(h, doc.numero, quando, data.aluno, data.curso, data.periodos, data.chTotal)
  if (doc.tipo === 'DECLARACAO_MATRICULA') {
    const corpo = `Declaramos para os devidos fins que ${data.aluno?.nome} (RA ${data.aluno?.ra || '—'}, CPF ${data.aluno?.cpf || '—'}) encontra-se regularmente matriculado(a) no curso ${data.curso}, turma ${data.turma}, nesta instituição de ensino.`
    return pdfDeclaracao(h, doc.numero, quando, 'DECLARAÇÃO DE MATRÍCULA', corpo)
  }
  if (doc.tipo === 'DECLARACAO_FREQUENCIA') {
    const freqTxt = data.freq != null ? `, apresentando frequência global de ${data.freq}% até a presente data` : ''
    const corpo = `Declaramos para os devidos fins que ${data.aluno?.nome} (RA ${data.aluno?.ra || '—'}) está regularmente matriculado(a) e frequentando o curso ${data.curso}, turma ${data.turma}${freqTxt}.`
    return pdfDeclaracao(h, doc.numero, quando, 'DECLARAÇÃO DE FREQUÊNCIA', corpo)
  }
  if (doc.tipo === 'ATA_RESULTADOS') return pdfAta(h, doc.numero, quando, data.turma, data.linhas, data.ata)
  if (doc.tipo === 'RECIBO') return pdfRecibo(h, doc.numero, quando, data)
  if (doc.tipo === 'CERTIFICADO') return pdfCertificado(h, doc.numero, quando, data)
  if (doc.tipo === 'QUITACAO_ANUAL') return pdfQuitacaoAnual(h, doc.numero, quando, data)
  if (doc.tipo === 'CARTEIRINHA') return pdfCarteirinha(h, doc.numero, quando, data)
  if (doc.tipo === 'INFORME_IR') return pdfInformeIR(h, doc.numero, quando, data)
  return null
}
