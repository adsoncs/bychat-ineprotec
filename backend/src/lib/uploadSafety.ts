// Segurança de uploads (Fase 3 — A8/M6).
//
// Dois objetivos:
//  1. Validar que o CONTEÚDO do arquivo bate com a extensão/MIME declarado
//     (magic bytes) — impede que um HTML/SVG malicioso entre disfarçado de
//     imagem (.png) e seja depois servido/sniffado como markup.
//  2. Sanitizar SVG — remove <script>, <foreignObject>, handlers on*, <a> e
//     esquemas perigosos, para que um SVG aceito como logo/favicon não execute
//     script mesmo se for inlinado no DOM em algum contexto.
//
// A defesa primária contra XSS de SVG/HTML servido de /uploads/ é feita na
// camada de servidor (headers nosniff + CSP sandbox + Content-Disposition,
// ver server.ts). Este módulo é defesa em profundidade na ENTRADA.

import sanitizeHtml from 'sanitize-html'

export type SniffKind =
  | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico'
  | 'pdf' | 'avif' | 'heic' | 'svg' | 'markup' | 'unknown'

/** Detecta o tipo real do arquivo pelos primeiros bytes / início do texto. */
export function sniffKind(buf: Buffer): SniffKind {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico'
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf'
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase()
    if (/avif|avis/.test(brand)) return 'avif'
    if (/heic|heix|heif|hevc|mif1|msf1/.test(brand)) return 'heic'
  }
  // Texto / markup — analisa o início ignorando BOM e espaços.
  const head = buf.slice(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  if (head.startsWith('<')) return 'markup'
  return 'unknown'
}

// Tipos de conteúdo aceitos por extensão. 'unknown' (formato não reconhecido,
// mas SEM cara de markup) é tolerado para não rejeitar formatos exóticos
// legítimos (ex.: variações de HEIC) — o servidor já força o Content-Type pela
// extensão + nosniff, então conteúdo binário desconhecido nunca vira markup.
const EXT_KINDS: Record<string, SniffKind[]> = {
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  gif: ['gif'],
  webp: ['webp'],
  bmp: ['bmp'],
  ico: ['ico', 'png'], // .ico pode conter PNG embutido
  pdf: ['pdf'],
  avif: ['avif'],
  heic: ['heic'],
  heif: ['heic'],
  svg: ['svg'],
}

export class UploadValidationError extends Error {}
export class UploadTooLargeError extends Error {}

/**
 * Drena um stream de arquivo do multipart para um Buffer, abortando se exceder
 * o limite. Necessário para validar magic bytes / sanitizar SVG antes de gravar.
 */
export async function bufferMultipart(
  file: AsyncIterable<Buffer | Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const c of file) {
    const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c)
    total += chunk.length
    if (total > maxBytes) throw new UploadTooLargeError(`Arquivo excede ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Valida o conteúdo contra a extensão e, para SVG, devolve a versão sanitizada.
 * Lança UploadValidationError quando o conteúdo é incompatível ou perigoso.
 *
 * @param ext extensão SEM ponto, minúscula (ex.: 'png', 'svg')
 * @param opts.allowSvg se true, SVG é aceito (e sanitizado); senão é rejeitado
 * @returns buffer a ser persistido (idêntico, exceto SVG que vem sanitizado)
 */
export function validateUploadContent(
  buf: Buffer,
  ext: string,
  opts: { allowSvg?: boolean } = {},
): Buffer {
  const kind = sniffKind(buf)

  // Markup que não é SVG (HTML/XML arbitrário) nunca é um upload legítimo aqui.
  if (kind === 'markup') {
    throw new UploadValidationError('Conteúdo do arquivo parece HTML/XML, não uma imagem.')
  }

  if (kind === 'svg') {
    if (!opts.allowSvg) {
      throw new UploadValidationError('SVG não é permitido neste upload.')
    }
    return sanitizeSvg(buf)
  }

  const expected = EXT_KINDS[ext]
  if (expected) {
    // Se reconhecemos um tipo conhecido e ele conflita com a extensão → rejeita.
    // 'unknown' passa (ver comentário em EXT_KINDS).
    if (kind !== 'unknown' && !expected.includes(kind)) {
      throw new UploadValidationError(`Conteúdo do arquivo (${kind}) não corresponde à extensão .${ext}.`)
    }
  }

  return buf
}

// Conjunto de tags SVG seguras. Exclui de propósito: script, foreignObject,
// handler e <a> (vetores de execução de script / navegação).
// Nota: <style> é omitido de propósito (sanitize-html o marca como vetor de XSS).
// Logos/favicons usam atributos de apresentação (fill/stroke); CSS embutido é
// raro e, no contexto de serviço, já é neutralizado pela CSP sandbox.
const SVG_ALLOWED_TAGS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'view', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'tref',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'marker', 'image',
  'filter',
  'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite', 'feflood',
  'femerge', 'femergenode', 'femorphology', 'feturbulence', 'fedisplacementmap',
  'feimage', 'fetile', 'fecomponenttransfer', 'fefuncr', 'fefuncg', 'fefuncb', 'fefunca',
  'fedropshadow', 'fespecularlighting', 'fediffuselighting', 'fedistantlight', 'fepointlight', 'fespotlight',
  'animate', 'animatetransform', 'animatemotion', 'mpath', 'set',
  // versões camelCase preservadas pelo parser (lowerCaseTags:false)
  'linearGradient', 'radialGradient', 'clipPath', 'textPath',
  'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood',
  'feMerge', 'feMergeNode', 'feMorphology', 'feTurbulence', 'feDisplacementMap',
  'feImage', 'feTile', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feDropShadow', 'feSpecularLighting', 'feDiffuseLighting', 'feDistantLight', 'fePointLight', 'feSpotLight',
  'animateTransform', 'animateMotion',
]

/** Sanitiza um SVG; lança UploadValidationError se não for sanitizável. */
export function sanitizeSvg(input: Buffer | string): Buffer {
  const raw = typeof input === 'string' ? input : input.toString('utf8')
  let clean: string
  try {
    clean = sanitizeHtml(raw, {
      allowedTags: SVG_ALLOWED_TAGS,
      // Mantém todos os atributos de apresentação; handlers on* são removidos no
      // pós-passe abaixo (a saída já vem normalizada pelo parser).
      allowedAttributes: { '*': ['*'] },
      // SVG depende de tags/atributos camelCase (viewBox, linearGradient…).
      parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
      allowedSchemes: ['http', 'https', 'data'],
      allowedSchemesAppliedToAttributes: ['href', 'xlink:href', 'src'],
      allowProtocolRelative: false,
    })
  } catch {
    throw new UploadValidationError('SVG inválido ou não sanitizável.')
  }
  // Pós-passe sobre a saída normalizada: remove handlers de evento e neutraliza
  // javascript:. Seguro aqui porque o parser já reserializou o markup (sem
  // truques de tags aninhadas).
  clean = clean
    .replace(/\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/g, '')
    .replace(/(href|xlink:href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
  if (!/<svg[\s>]/i.test(clean)) {
    throw new UploadValidationError('SVG inválido após sanitização.')
  }
  return Buffer.from(clean, 'utf8')
}
