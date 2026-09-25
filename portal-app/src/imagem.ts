// Reduz a foto antes de subir.
//
// Foto de celular novo passa de 8 MB, e o documento continua legível com uma
// fração disso. Em rede de dados ruim — que é onde essa gente está — subir o
// original é a diferença entre concluir a inscrição e desistir dela.
//
// Nunca falha o envio por causa da compressão: se algo der errado (HEIC que o
// navegador não decodifica, canvas bloqueado), devolve o arquivo original.

const LIMITE_PARA_COMPRIMIR = 1.5 * 1024 * 1024 // abaixo disso não compensa
const LADO_MAXIMO = 2200 // suficiente para ler CPF e histórico escolar
const QUALIDADE = 0.85

export interface ResultadoCompressao {
  arquivo: File
  comprimido: boolean
  de: number
  para: number
}

export async function comprimirSePreciso(arquivo: File): Promise<ResultadoCompressao> {
  const original: ResultadoCompressao = { arquivo, comprimido: false, de: arquivo.size, para: arquivo.size }

  const ehImagem = arquivo.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(arquivo.name)
  if (!ehImagem || arquivo.size <= LIMITE_PARA_COMPRIMIR) return original

  try {
    const bitmap = await carregarBitmap(arquivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const largura = Math.round(bitmap.width * escala)
    const altura = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = largura
    canvas.height = altura
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, largura, altura)

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALIDADE))
    if (!blob || blob.size >= arquivo.size) return original // comprimir piorou: fica o original

    const nome = arquivo.name.replace(/\.[^.]+$/, '') + '.jpg'
    return {
      arquivo: new File([blob], nome, { type: 'image/jpeg' }),
      comprimido: true,
      de: arquivo.size,
      para: blob.size,
    }
  } catch {
    return original
  }
}

async function carregarBitmap(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(arquivo) } catch { /* HEIC costuma cair aqui */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem não pôde ser lida')) }
    img.src = url
  })
}
