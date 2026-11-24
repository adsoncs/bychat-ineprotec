// src/lib/exportarTabela.ts
//
// Exportação única de tabelas: CSV, Excel (.xlsx) ou PDF, com os MESMOS dados.
// As rotas montam colunas + linhas (o que o CSV já montava) e chamam
// `responderTabela`; o formato vem da query (?formato=xlsx|pdf|csv, padrão csv).
// Pedido de 24/11/2026: o time escolhe o formato num seletor ao exportar.
//
// · CSV: separador ";" e BOM (abre certo no Excel brasileiro), como antes.
// · Excel: números ficam número (dá para somar); largura das colunas ajustada.
// · PDF: A4 deitado, título, data de geração, cabeçalho repetido em cada página
//   e número da página. Muitas colunas = letra menor; a partir de um limite,
//   só as primeiras colunas cabem e o rodapé avisa quantas ficaram de fora
//   (para a tabela inteira, use o Excel).

import type { FastifyReply } from 'fastify'
import PDFDocument from 'pdfkit'
import { utils, write } from 'xlsx'

export type Celula = string | number | boolean | null | undefined
export type FormatoExportacao = 'csv' | 'xlsx' | 'pdf'

export interface Tabela {
  /** Nome do arquivo sem extensão (ex.: "financeiro-portal"). */
  nome: string
  /** Título no topo do PDF / nome da aba do Excel. */
  titulo: string
  /** Linha de contexto do PDF (período, filtros). */
  subtitulo?: string | null
  colunas: string[]
  linhas: Celula[][]
  /** Colunas que vão para o PDF, pelo nome (tabelas largas). Sem isto, as primeiras que couberem. */
  colunasPdf?: string[]
}

export function formatoDaQuery(q: any): FormatoExportacao {
  const f = String(q?.formato ?? '').toLowerCase()
  return f === 'xlsx' || f === 'excel' ? 'xlsx' : f === 'pdf' ? 'pdf' : 'csv'
}

/** Texto seguro para CSV (aspas e fórmulas neutralizadas). */
function celulaCsv(v: Celula): string {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`
}

export function tabelaEmCsv(t: Tabela): string {
  return '﻿' + [t.colunas, ...t.linhas].map((l) => l.map(celulaCsv).join(';')).join('\n')
}

/** "1.234,56" / "1234,56" → número; qualquer outra coisa fica texto. */
function numeroBr(v: Celula): Celula {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return v
  // Código com zero à esquerda (CPF, CEP, matrícula) continua texto.
  if (/^-?0\d/.test(s)) return v
  // Inteiro longo sem pontuação (telefone, CPF sem máscara, id) também: no Excel
  // viraria notação científica ou perderia dígitos.
  if (/^-?\d{8,}$/.test(s)) return v
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : v
}

export function tabelaEmXlsx(t: Tabela): Buffer {
  const dados = [t.colunas, ...t.linhas.map((l) => l.map((c) => numeroBr(c) ?? ''))]
  const ws = utils.aoa_to_sheet(dados)
  ws['!cols'] = t.colunas.map((c, i) => {
    const maior = Math.max(String(c).length, ...t.linhas.slice(0, 500).map((l) => String(l[i] ?? '').length))
    return { wch: Math.min(60, Math.max(8, maior + 2)) }
  })
  ws['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, t.linhas.length), c: Math.max(0, t.colunas.length - 1) } }) }
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, t.titulo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Dados')
  return write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// Helvetica do PDF só tem o conjunto Latin-1/WinAnsi: o resto vira "?".
const textoPdf = (v: Celula) => (v == null ? '' : String(v)).replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…€]/g, '?')

const MAX_COLUNAS_PDF = 14

export async function tabelaEmPdf(t: Tabela): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true })
  const partes: Buffer[] = []
  doc.on('data', (b: Buffer) => partes.push(b))
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))))

  // Índices das colunas do PDF: as escolhidas pela rota, ou as primeiras que cabem.
  const escolhidas = (t.colunasPdf ?? []).map((n) => t.colunas.indexOf(n)).filter((i) => i >= 0)
  const idx = (escolhidas.length ? escolhidas : t.colunas.map((_, i) => i)).slice(0, MAX_COLUNAS_PDF)
  const cols = idx.map((i) => t.colunas[i]!)
  const foraDoPdf = t.colunas.filter((_, i) => !idx.includes(i))
  const fora = foraDoPdf.length
  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const fonte = cols.length <= 6 ? 9 : cols.length <= 9 ? 8 : cols.length <= 12 ? 7 : 6
  // Largura de cada coluna proporcional ao conteúdo (limitada), somando a página.
  const pesos = cols.map((c, k) => Math.min(40, Math.max(6, String(c).length, ...t.linhas.slice(0, 300).map((l) => String(l[idx[k]!] ?? '').length))))
  const soma = pesos.reduce((a, b) => a + b, 0) || 1
  const larg = pesos.map((p) => (p / soma) * largura)
  const x0 = doc.page.margins.left
  const gerado = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  const topo = () => {
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(textoPdf(t.titulo), x0, doc.page.margins.top, { width: largura })
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text(textoPdf([t.subtitulo, `Gerado em ${gerado}`, `${t.linhas.length} linha(s)`].filter(Boolean).join('  ·  ')), x0, doc.y + 2, { width: largura })
    doc.moveDown(0.6)
    cabecalho()
  }
  const cabecalho = () => {
    const y = doc.y
    doc.font('Helvetica-Bold').fontSize(fonte).fillColor('#111')
    const alturas = cols.map((c, i) => doc.heightOfString(textoPdf(c), { width: larg[i]! - 4 }))
    const h = Math.max(...alturas) + 6
    doc.rect(x0, y, largura, h).fill('#eef1f5')
    let x = x0
    doc.fillColor('#111')
    cols.forEach((c, i) => { doc.text(textoPdf(c), x + 2, y + 3, { width: larg[i]! - 4 }); x += larg[i]! })
    doc.y = y + h
  }

  topo()
  doc.font('Helvetica').fontSize(fonte)
  const limiteY = () => doc.page.height - doc.page.margins.bottom - 14
  t.linhas.forEach((linha, n) => {
    const celulas = idx.map((i) => textoPdf(linha[i]))
    doc.font('Helvetica').fontSize(fonte)
    const h = Math.max(...celulas.map((c, i) => doc.heightOfString(c, { width: larg[i]! - 4 }))) + 5
    if (doc.y + h > limiteY()) { doc.addPage(); doc.y = doc.page.margins.top; cabecalho(); doc.font('Helvetica').fontSize(fonte) }
    const y = doc.y
    if (n % 2 === 1) doc.rect(x0, y, largura, h).fill('#f8f9fb')
    doc.fillColor('#222')
    let x = x0
    celulas.forEach((c, i) => { doc.text(c, x + 2, y + 2.5, { width: larg[i]! - 4 }); x += larg[i]! })
    doc.y = y + h
  })
  if (!t.linhas.length) doc.font('Helvetica').fontSize(9).fillColor('#555').text('Nenhum dado no recorte escolhido.', x0, doc.y + 6)

  // Rodapé: página n de N (+ aviso das colunas que não couberam).
  const paginas = doc.bufferedPageRange()
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i)
    const aviso = fora > 0 ? `${fora} coluna(s) fora do PDF (${textoPdf(foraDoPdf.join(', ')).slice(0, 140)}${foraDoPdf.join(', ').length > 140 ? '…' : ''}); a tabela completa está no Excel.  ·  ` : ''
    doc.font('Helvetica').fontSize(7).fillColor('#777')
      .text(`${aviso}Página ${i + 1} de ${paginas.count}`, x0, doc.page.height - doc.page.margins.bottom - 8, { width: largura, align: 'right', lineBreak: false })
  }
  doc.end()
  return fim
}

/** Responde a rota com a tabela no formato pedido. */
export async function responderTabela(reply: FastifyReply, t: Tabela, formato: FormatoExportacao) {
  if (formato === 'xlsx') {
    return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${t.nome}.xlsx"`).send(tabelaEmXlsx(t))
  }
  if (formato === 'pdf') {
    return reply.header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${t.nome}.pdf"`).send(await tabelaEmPdf(t))
  }
  return reply.header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${t.nome}.csv"`).send(tabelaEmCsv(t))
}

/** Converte um CSV já montado (";" e aspas) em tabela — para rotas antigas. */
export function tabelaDoCsv(csv: string, nome: string, titulo: string, subtitulo?: string | null, sep: ';' | ',' = ';', colunasPdf?: string[]): Tabela {
  const texto = csv.replace(/^﻿/, '')
  const linhas: string[][] = []
  let atual: string[] = [], campo = '', aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++ } else if (ch === '"') aspas = false
      else campo += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) { atual.push(campo); campo = '' }
    else if (ch === '\n') { atual.push(campo.replace(/\r$/, '')); linhas.push(atual); atual = []; campo = '' }
    else campo += ch
  }
  if (campo || atual.length) { atual.push(campo); linhas.push(atual) }
  const [cab, ...resto] = linhas
  // O CSV protege fórmula com apóstrofo: no Excel/PDF ele não é necessário.
  const limpa = (s: string) => s.replace(/^'([=+\-@])/, '$1')
  return { nome, titulo, subtitulo: subtitulo ?? null, colunasPdf, colunas: (cab ?? []).map(limpa), linhas: resto.filter((l) => l.some((c) => c !== '')).map((l) => l.map(limpa)) }
}
