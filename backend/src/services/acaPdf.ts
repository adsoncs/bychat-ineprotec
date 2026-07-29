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

/**
 * Declaração de quitação anual (Lei 12.007/09). A lei exige discriminar os
 * meses quitados, então a tabela de parcelas faz parte do documento — não é
 * enfeite.
 */
export function pdfQuitacaoAnual(
  h: DocHeader, numero: string, dataExtenso: string,
  d: { aluno: AlunoInfo; curso: string; ano: number; totalCentavos: number; parcelas: Array<{ tipo: string; vencimento: string | Date; pagoEm: string | Date | null; valorCentavos: number }> },
) {
  const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const dia = (v: string | Date | null) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—')
  return build((doc) => {
    cabecalho(doc, h, 'DECLARAÇÃO DE QUITAÇÃO ANUAL DE DÉBITO', numero)
    const corpo = `Declaramos, para os fins do disposto na Lei nº 12.007, de 29 de julho de 2009, que ${d.aluno.nome}`
      + `${d.aluno.cpf ? ` (CPF ${d.aluno.cpf})` : ''}${d.aluno.ra ? `, RA ${d.aluno.ra}` : ''}, aluno(a) do curso ${d.curso},`
      + ` encontra-se QUITADO(A) quanto às obrigações financeiras vencidas no exercício de ${d.ano}, conforme discriminado abaixo.`
    doc.fontSize(11).font('Helvetica').text(corpo, { align: 'justify', lineGap: 4 })
    doc.moveDown(1)

    const y0 = doc.y
    doc.fontSize(9).font('Helvetica-Bold')
    doc.text('Referência', 50, y0).text('Vencimento', 230, y0).text('Pagamento', 330, y0).text('Valor', 430, y0, { width: 115, align: 'right' })
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ccc').stroke().strokeColor('#000')
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(9.5)
    for (const p of d.parcelas) {
      const y = doc.y
      doc.text(String(p.tipo), 50, y)
        .text(dia(p.vencimento), 230, y)
        .text(dia(p.pagoEm), 330, y)
        .text(money(p.valorCentavos), 430, y, { width: 115, align: 'right' })
      doc.moveDown(0.2)
    }
    doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).strokeColor('#ccc').stroke().strokeColor('#000')
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(10).text(`Total quitado em ${d.ano}: ${money(d.totalCentavos)}`, 50, doc.y, { width: 495, align: 'right' })
    rodape(doc, dataExtenso, numero)
  })
}

/**
 * Informe de pagamentos do ano-calendário, para dedução de instrução no IR.
 * Traz CNPJ do prestador e CPF do aluno porque é isso que a declaração pede.
 */
export function pdfInformeIR(
  h: DocHeader, numero: string, dataExtenso: string,
  d: { aluno: AlunoInfo; curso: string; ano: number; totalCentavos: number; pagamentos: Array<{ tipo: string; nroParcela: number | null; vencimento: string | Date; pagoEm: string | Date | null; valorCentavos: number }> },
) {
  const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const dia = (v: string | Date | null) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—')
  return build((doc) => {
    cabecalho(doc, h, `INFORME DE PAGAMENTOS — ANO-CALENDÁRIO ${d.ano}`, numero)
    const corpo = `Informamos que ${d.aluno.nome}${d.aluno.cpf ? ` (CPF ${d.aluno.cpf})` : ''}`
      + `${d.aluno.ra ? `, RA ${d.aluno.ra}` : ''}, aluno(a) do curso ${d.curso}, efetuou os pagamentos abaixo`
      + ` no ano-calendário de ${d.ano}, para fins de comprovação de despesas com instrução na Declaração de`
      + ` Ajuste Anual do Imposto sobre a Renda.`
    doc.fontSize(11).font('Helvetica').text(corpo, { align: 'justify', lineGap: 4 })
    doc.moveDown(1)

    const y0 = doc.y
    doc.fontSize(9).font('Helvetica-Bold')
    doc.text('Referência', 50, y0).text('Vencimento', 240, y0).text('Pago em', 340, y0).text('Valor', 430, y0, { width: 115, align: 'right' })
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#ccc').stroke().strokeColor('#000')
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(9.5)
    for (const p of d.pagamentos) {
      const y = doc.y
      doc.text(`${p.nroParcela ? `${p.nroParcela}ª ` : ''}${String(p.tipo)}`, 50, y)
        .text(dia(p.vencimento), 240, y)
        .text(dia(p.pagoEm), 340, y)
        .text(money(p.valorCentavos), 430, y, { width: 115, align: 'right' })
      doc.moveDown(0.2)
    }
    doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).strokeColor('#ccc').stroke().strokeColor('#000')
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(10).text(`Total pago em ${d.ano}: ${money(d.totalCentavos)}`, 50, doc.y, { width: 495, align: 'right' })
    doc.moveDown(1)
    doc.font('Helvetica').fontSize(8.5).fillColor('#555')
      .text('Os valores acima consideram a data do efetivo pagamento (regime de caixa), conforme a legislação do imposto de renda.', { align: 'justify' })
      .fillColor('#000')
    rodape(doc, dataExtenso, numero)
  })
}

/** Carteirinha do estudante em cartão, com código de verificação. */
export function pdfCarteirinha(
  h: DocHeader, numero: string, _dataExtenso: string,
  d: { aluno: AlunoInfo & { nascimento?: string | Date | null }; curso: string; turma: string; periodo: string | null; validade: string | Date },
) {
  return new Promise<Buffer>((resolve, reject) => {
    // Cartão em paisagem, próximo ao tamanho de crachá.
    const doc = new PDFDocument({ size: [242, 153], margin: 0 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      doc.rect(0, 0, 242, 24).fill('#111827')
      doc.fillColor('#fff').fontSize(8.5).font('Helvetica-Bold')
        .text((h.instituicao || 'Instituição').toUpperCase().substring(0, 38), 8, 8, { width: 226 })
      doc.fillColor('#111827')

      doc.fontSize(6).font('Helvetica').fillColor('#6b7280').text('ESTUDANTE', 8, 32)
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text(String(d.aluno.nome).substring(0, 34), 8, 40, { width: 226 })

      let y = 58
      const linha = (rot: string, val: string) => {
        doc.fontSize(6).font('Helvetica').fillColor('#6b7280').text(rot, 8, y)
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#111827').text(val.substring(0, 40), 8, y + 7, { width: 226 })
        y += 20
      }
      linha('CURSO', d.curso || '—')
      linha('RA / TURMA', `${d.aluno.ra || '—'}  ·  ${d.turma || '—'}`)

      doc.fontSize(6).font('Helvetica').fillColor('#6b7280')
        .text(`Validade: ${new Date(d.validade).toLocaleDateString('pt-BR')}${d.periodo ? `  ·  ${d.periodo}` : ''}`, 8, 126)
        .text(`Verificação: ${numero}`, 8, 136)
      doc.fillColor('#111827')
      doc.end()
    } catch (e) { reject(e as Error) }
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
