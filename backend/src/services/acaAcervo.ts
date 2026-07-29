// src/services/acaAcervo.ts
//
// Acervo acadêmico digital (Portaria MEC 315/2018 + Decreto 9.235/2017).
//
// Guardar arquivo não é ter acervo. A norma exige três coisas que faltavam:
// classificação documental, temporalidade (o que é permanente e o que pode ser
// descartado, e quando) e garantia de integridade. E a eliminação não é apagar:
// é um ato formal, com listagem, comissão e termo — o termo permanece mesmo
// depois de os arquivos sumirem, porque é ele que prova que o descarte foi
// regular.

import { createHash } from 'node:crypto'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { uploadsPath } from '../lib/uploadsDir.js'
import { prisma } from '../lib/prisma.js'

/**
 * Tabela de temporalidade padrão, por tipo de documento. Baseada na praxe do
 * Código de Classificação da atividade-fim das IFES, aplicada por analogia
 * (é o que a Portaria 315 manda).
 *
 * `null` em anos = guarda permanente.
 */
export const TEMPORALIDADE_PADRAO: Record<string, { classificacao: string; anos: number | null }> = {
  HISTORICO: { classificacao: '125.1 — Histórico escolar', anos: null },
  DIPLOMA: { classificacao: '125.3 — Diploma', anos: null },
  CERTIFICADO: { classificacao: '125.4 — Certificado', anos: null },
  ATA_RESULTADOS: { classificacao: '124.2 — Atas de resultados', anos: null },
  CONTRATO: { classificacao: '132.1 — Contrato de prestação de serviço', anos: 20 },
  RG: { classificacao: '121.1 — Documento de identificação', anos: null },
  CPF: { classificacao: '121.1 — Documento de identificação', anos: null },
  COMPROVANTE_RESIDENCIA: { classificacao: '121.4 — Comprovante de residência', anos: 5 },
  ATESTADO: { classificacao: '123.5 — Atestados e justificativas', anos: 5 },
  REQUERIMENTO: { classificacao: '123.1 — Requerimentos', anos: 10 },
  BOLETO: { classificacao: '133.2 — Comprovantes financeiros', anos: 5 },
  OUTRO: { classificacao: '129 — Documentos diversos', anos: 5 },
}

/** Remove acentos, caixa e separadores para casar "Histórico escolar" com HISTORICO. */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Sinônimos: o campo `tipo` do acervo é texto livre digitado pela secretaria. */
const SINONIMOS: Array<{ chave: keyof typeof TEMPORALIDADE_PADRAO | string; termos: string[] }> = [
  { chave: 'HISTORICO', termos: ['HISTORICO', 'HISTORICOESCOLAR'] },
  { chave: 'DIPLOMA', termos: ['DIPLOMA'] },
  { chave: 'CERTIFICADO', termos: ['CERTIFICADO', 'CERTIFICADODECONCLUSAO', 'CERTIDAODENASCIMENTO', 'CERTIDAO'] },
  { chave: 'ATA_RESULTADOS', termos: ['ATA'] },
  { chave: 'CONTRATO', termos: ['CONTRATO'] },
  { chave: 'RG', termos: ['RG', 'IDENTIDADE', 'CNH', 'TITULODEELEITOR', 'TITULOELEITOR', 'RESERVISTA', 'FOTO'] },
  { chave: 'CPF', termos: ['CPF'] },
  { chave: 'COMPROVANTE_RESIDENCIA', termos: ['COMPROVANTEDERESIDENCIA', 'RESIDENCIA', 'ENDERECO'] },
  { chave: 'ATESTADO', termos: ['ATESTADO', 'COMPROVANTEDEVACINACAO', 'VACINACAO', 'VACINA'] },
  { chave: 'REQUERIMENTO', termos: ['REQUERIMENTO'] },
  { chave: 'BOLETO', termos: ['BOLETO', 'RECIBO'] },
]

/**
 * Classificação a partir do tipo informado.
 *
 * REGRA DE SEGURANÇA: quando o tipo não casa com nada conhecido, o padrão é
 * PERMANENTE. Guardar demais é reversível a qualquer momento; eliminar um
 * documento de guarda permanente não é. Foi o que quase aconteceu com
 * "Histórico escolar", que sem os sinônimos caía em "diversos / 5 anos".
 */
export function classificarPorTipo(tipo: string): { classificacao: string; temporalidade: 'PERMANENTE' | 'TEMPORARIO'; prazoGuardaAnos: number | null } {
  const n = normalizar(tipo)
  const direto = TEMPORALIDADE_PADRAO[tipo.toUpperCase()]
  const porSinonimo = SINONIMOS.find((s) => s.termos.some((t) => n === t || n.includes(t)))
  const regra = direto ?? (porSinonimo ? TEMPORALIDADE_PADRAO[porSinonimo.chave as string] : undefined)
  if (!regra) {
    return { classificacao: `129 — Documentos diversos (${tipo})`.substring(0, 60), temporalidade: 'PERMANENTE', prazoGuardaAnos: null }
  }
  return {
    classificacao: regra.classificacao,
    temporalidade: regra.anos == null ? 'PERMANENTE' : 'TEMPORARIO',
    prazoGuardaAnos: regra.anos,
  }
}

function guardaAte(prazoAnos: number | null, base = new Date()): Date | null {
  if (prazoAnos == null) return null
  const d = new Date(base)
  d.setFullYear(d.getFullYear() + prazoAnos)
  return d
}

/** Teto de download: acervo é documento, não vídeo. */
const LIMITE_BYTES = 50 * 1024 * 1024

/** SHA-256 de arquivo sob nossa custódia (/uploads). */
async function hashLocal(url: string): Promise<{ hash: string; bytes: number } | null> {
  const m = /\/uploads\/(.+)$/.exec(url)
  if (!m) return null
  const caminho = uploadsPath(m[1]!)
  try {
    const [buf, info] = await Promise.all([readFile(caminho), stat(caminho)])
    return { hash: createHash('sha256').update(buf).digest('hex'), bytes: info.size }
  } catch {
    return null
  }
}

/**
 * Baixa um documento externo e devolve conteúdo + hash.
 *
 * O acervo do tenant guarda LINK, não arquivo — por isso nenhum documento tinha
 * hash: a função antiga só lia `/uploads`. Buscar a URL resolve, mas é o
 * servidor abrindo endereço que veio de cadastro: passa pelo mesmo guarda de
 * SSRF usado nos conectores, senão o campo "URL do documento" vira caminho para
 * a rede interna e o serviço de metadados da nuvem.
 */
async function baixarExterno(url: string): Promise<{ hash: string; bytes: number; buf: Buffer; contentType: string | null } | null> {
  let alvo: URL
  try { alvo = new URL(url) } catch { return null }
  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return null

  const { assertUrlIsPublic } = await import('../lib/urlSafety.js')
  const check = await assertUrlIsPublic(url)
  if (!check.ok) throw new Error(`Endereço bloqueado por segurança: ${check.reason}`)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return null
    const declarado = Number(res.headers.get('content-length') || 0)
    if (declarado > LIMITE_BYTES) throw new Error(`Documento maior que o limite de ${Math.round(LIMITE_BYTES / 1024 / 1024)} MB`)
    const buf = Buffer.from(await res.arrayBuffer())
    // Content-length é declaração do servidor remoto; o tamanho real é o que
    // chegou. Conferir os dois evita download sem teto por cabeçalho mentiroso.
    if (buf.length > LIMITE_BYTES) throw new Error('Documento excede o limite de tamanho')
    return {
      hash: createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      buf,
      contentType: res.headers.get('content-type'),
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Tempo esgotado ao baixar o documento')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Hash de integridade do documento, esteja ele em custódia própria ou externo.
 *
 * Vale registrar o limite: hash de link externo prova que o conteúdo daquele
 * endereço não mudou desde o registro — não impede o link de sair do ar. Quem
 * quer acervo no sentido da Portaria 315 precisa da custódia (ver
 * `trazerParaCustodia`).
 */
export async function hashDoArquivo(url: string): Promise<{ hash: string; bytes: number } | null> {
  const local = await hashLocal(url)
  if (local) return local
  const externo = await baixarExterno(url).catch(() => null)
  return externo ? { hash: externo.hash, bytes: externo.bytes } : null
}

/**
 * Aplica classificação, temporalidade e hash a um arquivo do acervo.
 * Idempotente: recalcular não muda o que já está correto.
 */
export async function classificarArquivo(arquivoId: number, override?: { classificacao?: string; temporalidade?: string; prazoGuardaAnos?: number | null }) {
  const arq = await prisma.acaGedArquivo.findUnique({ where: { id: arquivoId } })
  if (!arq) throw new Error('Arquivo não encontrado')

  const padrao = classificarPorTipo(arq.tipo)
  const temporalidade = override?.temporalidade ?? padrao.temporalidade
  const prazo = override?.prazoGuardaAnos !== undefined ? override.prazoGuardaAnos : padrao.prazoGuardaAnos
  const integridade = arq.hashSha256 ? null : await hashDoArquivo(arq.url)

  return prisma.acaGedArquivo.update({
    where: { id: arquivoId },
    data: {
      classificacao: override?.classificacao ?? padrao.classificacao,
      temporalidade,
      prazoGuardaAnos: temporalidade === 'PERMANENTE' ? null : prazo,
      guardaAte: temporalidade === 'PERMANENTE' ? null : guardaAte(prazo, arq.createdAt),
      ...(integridade ? { hashSha256: integridade.hash, tamanhoBytes: integridade.bytes } : {}),
    },
  })
}

/**
 * Traz o documento para custódia própria: baixa o arquivo externo, grava em
 * /uploads/acervo e passa a apontar para a cópia local.
 *
 * É a diferença entre ter o acervo e ter uma lista de links. Link externo
 * quebra, o servidor de terceiro sai do ar, a pasta compartilhada é
 * reorganizada — e o documento que a instituição é obrigada a guardar some sem
 * ninguém perceber. A URL original fica registrada na origem.
 */
export async function trazerParaCustodia(arquivoId: number): Promise<{ url: string; hash: string; bytes: number }> {
  const arq = await prisma.acaGedArquivo.findUnique({ where: { id: arquivoId } })
  if (!arq) throw new Error('Arquivo não encontrado')
  if (/\/uploads\//.test(arq.url)) throw new Error('Este documento já está sob custódia própria')

  const baixado = await baixarExterno(arq.url)
  if (!baixado) throw new Error('Não foi possível baixar o documento deste endereço')

  const dir = uploadsPath('acervo')
  await mkdir(dir, { recursive: true })
  // Nome derivado do hash: mesmo conteúdo não duplica, e o nome não carrega
  // dado do aluno para dentro do sistema de arquivos.
  const ext = extensaoDe(arq.url, baixado.contentType)
  const nome = `${baixado.hash.slice(0, 32)}${ext}`
  await writeFile(join(dir, nome), baixado.buf)

  const url = `/uploads/acervo/${nome}`
  await prisma.acaGedArquivo.update({
    where: { id: arquivoId },
    data: {
      url,
      hashSha256: baixado.hash,
      tamanhoBytes: baixado.bytes,
      observacao: [arq.observacao, `Origem: ${arq.url}`].filter(Boolean).join(' · ').slice(0, 1000),
    },
  })
  return { url, hash: baixado.hash, bytes: baixado.bytes }
}

/** Extensão a partir da URL ou do content-type — sem inventar quando não dá. */
function extensaoDe(url: string, contentType: string | null): string {
  const daUrl = /\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/.exec(url)?.[1]
  if (daUrl) return `.${daUrl.toLowerCase()}`
  const mapa: Record<string, string> = {
    'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'text/plain': '.txt',
  }
  return mapa[(contentType ?? '').split(';')[0]!.trim()] ?? ''
}

/** Confere se o arquivo ainda corresponde ao hash registrado. */
export async function verificarIntegridade(arquivoId: number): Promise<{ ok: boolean; motivo: string }> {
  const arq = await prisma.acaGedArquivo.findUnique({ where: { id: arquivoId }, select: { url: true, hashSha256: true } })
  if (!arq) return { ok: false, motivo: 'Arquivo não encontrado' }
  if (!arq.hashSha256) return { ok: false, motivo: 'Sem hash registrado — classifique o arquivo para gerar' }
  const atual = await hashDoArquivo(arq.url)
  if (!atual) return { ok: false, motivo: 'Arquivo indisponível para leitura' }
  return atual.hash === arq.hashSha256
    ? { ok: true, motivo: 'Íntegro — confere com o hash registrado' }
    : { ok: false, motivo: 'DIVERGENTE — o conteúdo mudou desde o registro' }
}

/** Documentos temporários com prazo vencido — candidatos à eliminação. */
export async function elegiveisEliminacao(ate = new Date()) {
  return prisma.acaGedArquivo.findMany({
    where: {
      temporalidade: 'TEMPORARIO',
      guardaAte: { not: null, lte: ate },
      eliminadoEm: null,
    },
    orderBy: { guardaAte: 'asc' },
  })
}

/**
 * Elimina documentos por termo. Os registros NÃO são apagados: recebem a data
 * de eliminação e o vínculo com o termo. O acervo precisa saber o que deixou de
 * existir e sob qual autorização.
 */
export async function eliminar(params: {
  arquivoIds: number[]
  comissao: string
  responsavel?: string | null
  observacao?: string | null
  criadoPor?: number | null
}) {
  const arquivos = await prisma.acaGedArquivo.findMany({
    where: { id: { in: params.arquivoIds }, eliminadoEm: null },
    select: { id: true, alunoId: true, tipo: true, nome: true, classificacao: true, guardaAte: true, hashSha256: true },
  })
  if (arquivos.length === 0) throw new Error('Nenhum arquivo elegível na seleção')

  const permanentes = await prisma.acaGedArquivo.count({
    where: { id: { in: params.arquivoIds }, temporalidade: 'PERMANENTE' },
  })
  if (permanentes > 0) throw new Error(`${permanentes} documento(s) de guarda PERMANENTE na seleção — não podem ser eliminados`)

  const aindaNoPrazo = arquivos.filter((a) => !a.guardaAte || a.guardaAte > new Date())
  if (aindaNoPrazo.length > 0) throw new Error(`${aindaNoPrazo.length} documento(s) ainda dentro do prazo de guarda`)

  const ano = new Date().getFullYear()
  const seq = (await prisma.acaEliminacaoTermo.count({ where: { numero: { startsWith: `${ano}/` } } })) + 1
  const numero = `${ano}/${String(seq).padStart(4, '0')}`

  return prisma.$transaction(async (tx) => {
    const termo = await tx.acaEliminacaoTermo.create({
      data: {
        numero, comissao: params.comissao,
        responsavel: params.responsavel ?? null,
        observacao: params.observacao ?? null,
        // O snapshot é o coração do termo: os arquivos somem, a lista fica.
        itensJson: arquivos as any,
        qtdItens: arquivos.length,
        criadoPor: params.criadoPor ?? null,
      },
    })
    await tx.acaGedArquivo.updateMany({
      where: { id: { in: arquivos.map((a) => a.id) } },
      data: { eliminadoEm: new Date(), eliminacaoTermoId: termo.id, status: 'ELIMINADO' },
    })
    return { termo, eliminados: arquivos.length }
  })
}
