// src/services/acaPdf.ts
// Módulo Acadêmico · P7 — geração de PDF dos documentos oficiais (pdfkit).
// Sem dependências externas de rede: monta o PDF em memória e devolve Buffer.

import PDFDocument from 'pdfkit'

export interface DocHeader { instituicao: string; cnpj: string | null }
const SITUACAO_LABEL: Record<string, string> = {
  APROVADO: 'Aprovado', RECUPERACAO: 'Recuperação', REPROVADO_NOTA: 'Reprovado (nota)',
  REPROVADO_FREQUENCIA: 'Reprovado (frequência)', REPROVADO: 'Reprovado', EM_ANDAMENTO: 'Cursando',
}

function build(render: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { render(doc); doc.end() } catch (e) { reject(e) }
  })
}

function cabecalho(doc: PDFKit.PDFDocument, h: DocHeader, titulo: string, numero: string) {
  doc.fontSize(15).font('Helvetica-Bold').text(h.instituicao, { align: 'center' })
  if (h.cnpj) doc.fontSize(9).font('Helvetica').text(`CNPJ ${h.cnpj}`, { align: 'center' })
  doc.moveDown(0.6)
  doc.fontSize(13).font('Helvetica-Bold').text(titulo, { align: 'center' })
  doc.fontSize(8).font('Helvetica').fillColor('#666').text(`Documento nº ${numero}`, { align: 'center' }).fillColor('#000')
  doc.moveDown(0.8)
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000')
  doc.moveDown(0.8)
}

function rodape(doc: PDFKit.PDFDocument, dataExtenso: string, numero: string) {
  doc.moveDown(2)
  doc.fontSize(10).font('Helvetica').text(dataExtenso, { align: 'right' })
  doc.moveDown(3)
  doc.fontSize(10).text('_________________________________________', { align: 'center' })
  doc.fontSize(9).fillColor('#444').text('Secretaria Acadêmica', { align: 'center' }).fillColor('#000')
  doc.fontSize(7).fillColor('#999').text(`Emitido eletronicamente · ${numero}`, 50, 800, { align: 'center', width: 495 }).fillColor('#000')
}

interface AlunoInfo { nome: string; ra: string | null; cpf: string | null }
interface HistPeriodo { periodo: string; turma: string; disciplinas: Array<{ nome: string; cargaHoraria: number; media: number | null; freqPct: number | null; situacao: string }> }

export function pdfHistorico(h: DocHeader, numero: string, dataExtenso: string, aluno: AlunoInfo, curso: string, periodos: HistPeriodo[], chTotal: number) {
  return build((doc) => {
    cabecalho(doc, h, 'HISTÓRICO ESCOLAR', numero)
    doc.fontSize(10).font('Helvetica-Bold').text('Aluno: ', { continued: true }).font('Helvetica').text(aluno.nome)
    doc.font('Helvetica-Bold').text('RA: ', { continued: true }).font('Helvetica').text(aluno.ra || '—', { continued: true })
    doc.font('Helvetica-Bold').text('     CPF: ', { continued: true }).font('Helvetica').text(aluno.cpf || '—')
    doc.font('Helvetica-Bold').text('Curso: ', { continued: true }).font('Helvetica').text(curso)
    doc.moveDown(0.6)

    for (const p of periodos) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a4d8f').text(`${p.periodo} — ${p.turma}`).fillColor('#000')
      doc.moveDown(0.2)
      // cabeçalho da tabela
      const y0 = doc.y
      doc.fontSize(8).font('Helvetica-Bold')
      doc.text('Disciplina', 55, y0, { width: 250 })
      doc.text('C.H.', 305, y0, { width: 45, align: 'right' })
      doc.text('Média', 350, y0, { width: 55, align: 'right' })
      doc.text('Freq.', 405, y0, { width: 50, align: 'right' })
      doc.text('Situação', 455, y0, { width: 90, align: 'right' })
      doc.moveDown(0.2)
      doc.font('Helvetica').fontSize(8)
      for (const d of p.disciplinas) {
        const y = doc.y
        doc.text(d.nome, 55, y, { width: 250 })
        doc.text(String(d.cargaHoraria), 305, y, { width: 45, align: 'right' })
        doc.text(d.media != null ? d.media.toFixed(1) : '—', 350, y, { width: 55, align: 'right' })
        doc.text(d.freqPct != null ? `${d.freqPct}%` : '—', 405, y, { width: 50, align: 'right' })
        doc.text(SITUACAO_LABEL[d.situacao] || d.situacao, 455, y, { width: 90, align: 'right' })
        doc.moveDown(0.3)
      }
      doc.moveDown(0.5)
    }
    doc.fontSize(9).font('Helvetica-Bold').text(`Carga horária total cursada: ${chTotal}h`)
    rodape(doc, dataExtenso, numero)
  })
}

export function pdfDeclaracao(h: DocHeader, numero: string, dataExtenso: string, titulo: string, corpo: string) {
  return build((doc) => {
    cabecalho(doc, h, titulo, numero)
    doc.fontSize(11).font('Helvetica').text(corpo, { align: 'justify', lineGap: 4 })
    rodape(doc, dataExtenso, numero)
  })
}

/** Contrato para assinatura eletrônica: corpo + blocos de assinatura por parte. */
export function pdfContrato(h: DocHeader, titulo: string, dataExtenso: string, corpo: string, partes: Array<{ nome: string; papel: string; documento?: string | null }>) {
  return build((doc) => {
    cabecalho(doc, h, titulo, 'CONTRATO')
    doc.fontSize(10.5).font('Helvetica').text(corpo, { align: 'justify', lineGap: 3.5 })
    doc.moveDown(1.5)
    doc.fontSize(10).font('Helvetica').text(dataExtenso, { align: 'right' })
    doc.moveDown(2.5)
    for (const p of partes) {
      doc.fontSize(10).text('_________________________________________')
      doc.font('Helvetica-Bold').text(p.nome, { continued: false })
      doc.font('Helvetica').fontSize(9).fillColor('#444').text(`${p.papel}${p.documento ? ' · ' + p.documento : ''}`).fillColor('#000').fontSize(10)
      doc.moveDown(1.4)
    }
    doc.fontSize(7).fillColor('#999').text('Documento destinado a assinatura eletrônica.', 50, 805, { align: 'center', width: 495 }).fillColor('#000')
  })
}

export function pdfCertificado(h: DocHeader, numero: string, dataExtenso: string, d: { aluno: AlunoInfo; curso: string; cargaHoraria: number; conclusao: string }) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      const W = doc.page.width, H = doc.page.height
      // moldura
      doc.lineWidth(3).strokeColor('#1a4d8f').rect(25, 25, W - 50, H - 50).stroke()
      doc.lineWidth(1).strokeColor('#c9a227').rect(33, 33, W - 66, H - 66).stroke()
      doc.fillColor('#000')
      doc.moveDown(2)
      doc.fontSize(16).font('Helvetica-Bold').text(h.instituicao, { align: 'center' })
      if (h.cnpj) doc.fontSize(9).font('Helvetica').text(`CNPJ ${h.cnpj}`, { align: 'center' })
      doc.moveDown(1.2)
      doc.fontSize(30).font('Helvetica-Bold').fillColor('#1a4d8f').text('CERTIFICADO', { align: 'center' }).fillColor('#000')
      doc.moveDown(1.4)
      doc.fontSize(13).font('Helvetica').text('Certificamos que', { align: 'center' })
      doc.moveDown(0.5)
      doc.fontSize(24).font('Helvetica-Bold').text(d.aluno.nome, { align: 'center' })
      doc.moveDown(0.6)
      doc.fontSize(13).font('Helvetica').text(
        `concluiu com aproveitamento o curso ${d.curso}${d.cargaHoraria ? `, com carga horária de ${d.cargaHoraria} horas` : ''}, em ${d.conclusao}.`,
        { align: 'center', width: W - 160, lineGap: 4 },
      )
      doc.moveDown(3)
      const y = doc.y
      doc.fontSize(11).text('_______________________________', W / 2 - 200, y, { width: 200, align: 'center' })
      doc.fontSize(11).text('_______________________________', W / 2, y, { width: 200, align: 'center' })
      doc.fontSize(9).fillColor('#444')
      doc.text('Direção', W / 2 - 200, y + 16, { width: 200, align: 'center' })
      doc.text('Secretaria Acadêmica', W / 2, y + 16, { width: 200, align: 'center' }).fillColor('#000')
      doc.fontSize(8).fillColor('#999').text(`${dataExtenso} · Certificado nº ${numero} · RA ${d.aluno.ra || '—'}`, 40, H - 60, { width: W - 80, align: 'center' }).fillColor('#000')
      doc.end()
    } catch (e) { reject(e) }
  })
}

const moneyBR = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function pdfRecibo(h: DocHeader, numero: string, dataExtenso: string, d: { aluno: AlunoInfo; descricao: string; valorCentavos: number; formaPagamento: string; dataPagamento: string }) {
  return build((doc) => {
    cabecalho(doc, h, 'RECIBO DE PAGAMENTO', numero)
    doc.fontSize(20).font('Helvetica-Bold').text(moneyBR(d.valorCentavos), { align: 'right' })
    doc.moveDown(0.8)
    doc.fontSize(11).font('Helvetica').text(
      `Recebemos de ${d.aluno.nome} (RA ${d.aluno.ra || '—'}${d.aluno.cpf ? `, CPF ${d.aluno.cpf}` : ''}) a importância de ${moneyBR(d.valorCentavos)}, referente a ${d.descricao}, pago em ${d.dataPagamento} via ${d.formaPagamento}.`,
      { align: 'justify', lineGap: 4 },
    )
    doc.moveDown(1)
    doc.fontSize(10).fillColor('#555').text('Este recibo comprova o pagamento da parcela indicada e não substitui documento fiscal.', { align: 'justify' }).fillColor('#000')
    rodape(doc, dataExtenso, numero)
  })
}

interface AtaLinha { nome: string; ra: string | null; situacaoGeral: string; reprovadas: number; recuperacoes: number }
export function pdfAta(h: DocHeader, numero: string, dataExtenso: string, turma: string, linhas: AtaLinha[], ata: string | null) {
  return build((doc) => {
    cabecalho(doc, h, 'ATA DE RESULTADOS — CONSELHO DE CLASSE', numero)
    doc.fontSize(10).font('Helvetica-Bold').text('Turma: ', { continued: true }).font('Helvetica').text(turma)
    doc.moveDown(0.5)
    const y0 = doc.y
    doc.fontSize(8).font('Helvetica-Bold')
    doc.text('Aluno', 55, y0, { width: 280 })
    doc.text('RA', 335, y0, { width: 90 })
    doc.text('Resultado', 425, y0, { width: 120, align: 'right' })
    doc.moveDown(0.3)
    doc.font('Helvetica').fontSize(8)
    for (const l of linhas) {
      const y = doc.y
      doc.text(l.nome, 55, y, { width: 280 })
      doc.text(l.ra || '—', 335, y, { width: 90 })
      doc.text(SITUACAO_LABEL[l.situacaoGeral] || l.situacaoGeral, 425, y, { width: 120, align: 'right' })
      doc.moveDown(0.3)
    }
    if (ata && ata.trim()) {
      doc.moveDown(0.8)
      doc.fontSize(9).font('Helvetica-Bold').text('Deliberações:')
      doc.font('Helvetica').fontSize(9).text(ata, { align: 'justify', lineGap: 3 })
    }
    rodape(doc, dataExtenso, numero)
  })
}
