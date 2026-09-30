// src/services/contratoWord.ts
//
// Contrato em Word: a instituição sobe o .docx real (o que o advogado
// escreveu), com os campos marcados no texto — {{aluno.nome}}, {{curso}},
// {{valor_total}}… O sistema preenche com os dados da inscrição, converte em
// PDF pelo LibreOffice (mantém a formatação do Word) e o PDF segue para a
// Autentique só para ser assinado.
//
// Por que Word e não um editor na tela: o contrato de uma escola tem cláusulas,
// numeração, negrito, tabelas e rodapé que um editor de texto simples perde, e
// quem mantém o contrato é o jurídico — que trabalha no Word.

import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type VarsContrato = Record<string, string>

/**
 * Lê o valor de um campo: o mapa é plano ("aluno.nome" é a chave), e o nome é
 * comparado sem diferença de maiúsculas/espaços — "{{ Aluno.Nome }}" também vale.
 */
function valorDoCampo(vars: VarsContrato, tag: string): string | undefined {
  const t = tag.trim()
  if (t in vars) return vars[t]
  const alvo = t.toLowerCase()
  const k = Object.keys(vars).find((x) => x.toLowerCase() === alvo)
  return k ? vars[k] : undefined
}

function abrir(docx: Buffer, vars: VarsContrato, faltando: Set<string>) {
  const zip = new PizZip(docx)
  return new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    parser: (tag: string) => ({
      get: () => {
        const v = valorDoCampo(vars, tag)
        if (v === undefined || v === '') faltando.add(tag.trim())
        return v ?? ''
      },
    }),
    // Campo sem valor sai em branco — nunca "undefined" no contrato.
    nullGetter: () => '',
  })
}

/** Os campos que o modelo usa, na ordem em que aparecem (sem repetir). */
export function camposDoModelo(docx: Buffer): string[] {
  const vistos: string[] = []
  const zip = new PizZip(docx)
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    parser: (tag: string) => {
      const t = tag.trim()
      if (!vistos.includes(t)) vistos.push(t)
      return { get: () => '' }
    },
    nullGetter: () => '',
  })
  doc.render({})
  return vistos
}

/**
 * Valida o arquivo enviado: é um .docx de verdade e os `{{ }}` estão bem
 * fechados. Devolve a mensagem que a tela mostra quando não está.
 */
export function validarModelo(docx: Buffer): { ok: true; campos: string[] } | { ok: false; erro: string } {
  try {
    return { ok: true, campos: camposDoModelo(docx) }
  } catch (e: any) {
    const detalhes: string[] = (e?.properties?.errors ?? []).map((x: any) => x?.properties?.explanation).filter(Boolean)
    if (/zip|end of central directory/i.test(String(e?.message))) return { ok: false, erro: 'O arquivo não é um Word (.docx) válido.' }
    return { ok: false, erro: detalhes.length ? `Campos mal escritos no modelo: ${detalhes.slice(0, 3).join(' · ')}` : `Modelo inválido: ${e?.message || e}` }
  }
}

/** Preenche o Word com os dados. `faltando` = campos do modelo sem valor. */
export function preencherDocx(docx: Buffer, vars: VarsContrato): { docx: Buffer; faltando: string[] } {
  const faltando = new Set<string>()
  const doc = abrir(docx, vars, faltando)
  doc.render({})
  return { docx: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer, faltando: [...faltando] }
}

// Uma conversão por vez: o LibreOffice é pesado, e duas instâncias com o mesmo
// perfil travam uma à outra.
let fila: Promise<unknown> = Promise.resolve()

/** Word → PDF pelo LibreOffice em modo servidor. */
export function docxParaPdf(docx: Buffer): Promise<Buffer> {
  const trabalho = fila.then(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'contrato-'))
    try {
      const entrada = join(dir, 'contrato.docx')
      await writeFile(entrada, docx)
      await new Promise<void>((resolve, reject) => {
        execFile('soffice', [
          `-env:UserInstallation=file://${join(dir, 'perfil')}`,
          '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, entrada,
        ], { timeout: 90_000 }, (err) => (err ? reject(new Error(`Falha ao converter o contrato em PDF: ${err.message}`)) : resolve()))
      })
      return await readFile(join(dir, 'contrato.pdf'))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })
  fila = trabalho.catch(() => {})
  return trabalho
}

/** Atalho: preenche e converte. */
export async function gerarPdfDoModelo(docx: Buffer, vars: VarsContrato): Promise<{ pdf: Buffer; faltando: string[] }> {
  const { docx: preenchido, faltando } = preencherDocx(docx, vars)
  return { pdf: await docxParaPdf(preenchido), faltando }
}
