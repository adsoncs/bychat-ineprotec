// Frente e verso num PDF só, para quem aceita UM arquivo por documento (SEI).
//
// pdfkit embute JPEG e PNG; PDF e HEIC/WebP não entram — nesse caso devolve
// null e quem chamou segue só com a frente e registra o aviso.
import PDFDocument from 'pdfkit'

export interface Face { bytes: Buffer; mime: string }

const EMBUTIVEL = new Set(['image/jpeg', 'image/jpg', 'image/png'])

/** Assinatura dos bytes: o MIME informado pelo navegador nem sempre é confiável. */
function tipoReal(b: Buffer): 'jpeg' | 'png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  return null
}

export function podeJuntar(f: Face): boolean {
  return EMBUTIVEL.has(f.mime.toLowerCase()) && tipoReal(f.bytes) !== null
}

/** PDF A4 com a frente na página 1 e o verso na página 2; null se algum lado não for JPG/PNG. */
export async function juntarFrenteVerso(frente: Face, verso: Face): Promise<Buffer | null> {
  if (!podeJuntar(frente) || !podeJuntar(verso)) return null
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 28, autoFirstPage: false, info: { Title: 'Documento — frente e verso' } })
    const partes: Buffer[] = []
    doc.on('data', (c: Buffer) => partes.push(c))
    doc.on('end', () => resolve(Buffer.concat(partes)))
    doc.on('error', reject)
    try {
      for (const [rotulo, face] of [['Frente', frente], ['Verso', verso]] as const) {
        doc.addPage()
        const w = doc.page.width - 56
        const h = doc.page.height - 56 - 18
        doc.fontSize(9).fillColor('#555').text(rotulo, 28, 28)
        doc.image(face.bytes, 28, 46, { fit: [w, h], align: 'center' })
      }
      doc.end()
    } catch (e) { reject(e) }
  })
}
