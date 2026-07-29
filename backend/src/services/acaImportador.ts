// src/services/acaImportador.ts
//
// Importadores com simulação (RN-105).
//
// Migrar de um sistema legado é o momento de maior risco de uma implantação: o
// arquivo vem sujo, e um import que grava direto deixa a base inconsistente sem
// ninguém perceber. Aqui todo import roda primeiro em modo simulação, valida
// linha a linha e devolve o relatório de erros — só grava quando o operador
// confirma, e sempre em transação.
//
// O contrato é o mesmo para todos os tipos: analisar(csv) → relatório;
// importar(csv) → grava o que está válido.

import { prisma } from '../lib/prisma.js'

export type TipoImport = 'disciplinas' | 'alunos' | 'notas_historico' | 'titulos'

export interface ErroLinha {
  linha: number
  campo?: string
  valor?: string
  mensagem: string
}

export interface RelatorioImport {
  tipo: TipoImport
  totalLinhas: number
  validas: number
  invalidas: number
  erros: ErroLinha[]
  /** Amostra do que será gravado, para conferência antes de confirmar. */
  amostra: Record<string, unknown>[]
  /** Linhas que já existem e serão puladas ou atualizadas. */
  duplicadas: number
  simulacao: boolean
}

/** Parser de CSV tolerante a ; e , e a aspas — planilha brasileira usa ambos. */
export function parseCsv(texto: string): { cabecalho: string[]; linhas: string[][] } {
  const limpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
  if (!limpo) return { cabecalho: [], linhas: [] }
  const primeira = limpo.split('\n')[0]!
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ';' : ','

  const linhas: string[][] = []
  for (const raw of limpo.split('\n')) {
    const campos: string[] = []
    let atual = '', aspas = false
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!
      if (c === '"') {
        if (aspas && raw[i + 1] === '"') { atual += '"'; i++ }
        else aspas = !aspas
      } else if (c === sep && !aspas) { campos.push(atual.trim()); atual = '' }
      else atual += c
    }
    campos.push(atual.trim())
    linhas.push(campos)
  }
  const cabecalho = (linhas.shift() ?? []).map((h) => h.toLowerCase().replace(/\s+/g, '_'))
  return { cabecalho, linhas }
}

function indexar(cabecalho: string[], linha: string[]): Record<string, string> {
  const o: Record<string, string> = {}
  cabecalho.forEach((h, i) => { o[h] = (linha[i] ?? '').trim() })
  return o
}

/** Aceita 1.234,56 / 1234.56 / 123456 (centavos quando inteiro sem separador). */
function paraCentavos(v: string): number | null {
  if (!v) return null
  const limpo = v.replace(/[R$\s]/g, '')
  if (/^\d+$/.test(limpo)) return Number(limpo) * 100
  const n = Number(limpo.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/**
 * Converte data aceitando DD/MM/AAAA e AAAA-MM-DD.
 *
 * O JavaScript faz rollover silencioso: `new Date('2005-02-31')` vira
 * 03/03/2005 em vez de erro. Numa importação isso grava uma data de nascimento
 * ERRADA sem ninguém perceber — e data de nascimento vai para o Censo. Por
 * isso conferimos se os componentes sobreviveram à conversão.
 */
function paraData(v: string): Date | null {
  if (!v) return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  let ano: number, mes: number, dia: number
  if (br) { dia = Number(br[1]); mes = Number(br[2]); ano = Number(br[3]) }
  else if (iso) { ano = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3]) }
  else {
    const solta = new Date(v)
    return Number.isNaN(solta.getTime()) ? null : solta
  }
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (Number.isNaN(d.getTime())) return null
  // Se o dia/mês mudou na conversão, a data não existia no calendário.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return d
}

const somenteDigitos = (s: string) => s.replace(/\D/g, '')

/** Validação de CPF — importar aluno com CPF inválido contamina o Censo. */
function cpfValido(cpf: string): boolean {
  const n = somenteDigitos(cpf)
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(n[i]) * (10 - i)
  let d1 = (soma * 10) % 11
  if (d1 === 10) d1 = 0
  if (d1 !== Number(n[9])) return false
  soma = 0
  for (let i = 0; i < 10; i++) soma += Number(n[i]) * (11 - i)
  let d2 = (soma * 10) % 11
  if (d2 === 10) d2 = 0
  return d2 === Number(n[10])
}

interface Preparado {
  erros: ErroLinha[]
  registros: Array<{ linha: number; dados: any; duplicado: boolean }>
}

async function prepararDisciplinas(cab: string[], linhas: string[][]): Promise<Preparado> {
  const erros: ErroLinha[] = []
  const registros: Preparado['registros'] = []
  const existentes = await prisma.acaDisciplina.findMany({ select: { nome: true, codigo: true } })
  const porCodigo = new Set(existentes.map((d) => (d.codigo ?? '').toUpperCase()).filter(Boolean))
  const porNome = new Set(existentes.map((d) => d.nome.toUpperCase()))
  const vistos = new Set<string>()

  linhas.forEach((l, i) => {
    const n = i + 2 // +1 do cabeçalho, +1 para numeração humana
    const r = indexar(cab, l)
    if (!r.nome) { erros.push({ linha: n, campo: 'nome', mensagem: 'Nome da disciplina é obrigatório' }); return }
    const ch = Number(r.carga_horaria || r.ch || 0)
    if (!Number.isFinite(ch) || ch <= 0) {
      erros.push({ linha: n, campo: 'carga_horaria', valor: r.carga_horaria ?? '', mensagem: 'Carga horária deve ser um número maior que zero' })
      return
    }
    const chave = (r.codigo || r.nome).toUpperCase()
    if (vistos.has(chave)) { erros.push({ linha: n, campo: 'codigo', valor: chave, mensagem: 'Duplicada dentro do próprio arquivo' }); return }
    vistos.add(chave)
    const duplicado = (r.codigo && porCodigo.has(r.codigo.toUpperCase())) || porNome.has(r.nome.toUpperCase())
    registros.push({
      linha: n, duplicado: !!duplicado,
      dados: { nome: r.nome.substring(0, 191), codigo: r.codigo || null, cargaHoraria: ch, ementa: r.ementa || null, courseId: Number(r.curso_id) || null },
    })
  })
  return { erros, registros }
}

async function prepararAlunos(cab: string[], linhas: string[][]): Promise<Preparado> {
  const erros: ErroLinha[] = []
  const registros: Preparado['registros'] = []
  const existentes = await prisma.aluno.findMany({ select: { cpf: true, ra: true } })
  const cpfs = new Set(existentes.map((a) => somenteDigitos(a.cpf ?? '')).filter(Boolean))
  const ras = new Set(existentes.map((a) => (a.ra ?? '').toUpperCase()).filter(Boolean))
  const vistos = new Set<string>()

  linhas.forEach((l, i) => {
    const n = i + 2
    const r = indexar(cab, l)
    if (!r.nome) { erros.push({ linha: n, campo: 'nome', mensagem: 'Nome é obrigatório' }); return }
    const cpf = somenteDigitos(r.cpf ?? '')
    if (cpf && !cpfValido(cpf)) {
      erros.push({ linha: n, campo: 'cpf', valor: r.cpf ?? '', mensagem: 'CPF inválido — o Censo rejeita' })
      return
    }
    if (!cpf && !r.email && !r.whatsapp) {
      erros.push({ linha: n, mensagem: 'Sem CPF, e-mail ou WhatsApp não há como identificar a pessoa' })
      return
    }
    const chave = cpf || (r.email ?? '').toLowerCase() || (r.whatsapp ?? '')
    if (vistos.has(chave)) { erros.push({ linha: n, valor: chave, mensagem: 'Repetido dentro do próprio arquivo' }); return }
    vistos.add(chave)
    const nascimento = r.nascimento ? paraData(r.nascimento) : null
    if (r.nascimento && !nascimento) {
      erros.push({ linha: n, campo: 'nascimento', valor: r.nascimento, mensagem: 'Data inválida (use AAAA-MM-DD ou DD/MM/AAAA)' })
      return
    }
    registros.push({
      linha: n,
      duplicado: (!!cpf && cpfs.has(cpf)) || (!!r.ra && ras.has(r.ra.toUpperCase())),
      dados: {
        nome: r.nome.substring(0, 191), cpf: cpf || null, ra: r.ra || null,
        email: r.email || null, whatsapp: r.whatsapp || null,
        dataNascimento: nascimento, racaCor: r.raca_cor || r.cor_raca || null,
        nacionalidade: r.nacionalidade || null,
      },
    })
  })
  return { erros, registros }
}

async function prepararTitulos(cab: string[], linhas: string[][]): Promise<Preparado> {
  const erros: ErroLinha[] = []
  const registros: Preparado['registros'] = []
  const alunos = await prisma.aluno.findMany({ select: { id: true, cpf: true, ra: true } })
  const porCpf = new Map(alunos.map((a) => [somenteDigitos(a.cpf ?? ''), a.id]))
  const porRa = new Map(alunos.map((a) => [(a.ra ?? '').toUpperCase(), a.id]))

  linhas.forEach((l, i) => {
    const n = i + 2
    const r = indexar(cab, l)
    const alunoId = porCpf.get(somenteDigitos(r.cpf ?? '')) ?? porRa.get((r.ra ?? '').toUpperCase())
    if (!alunoId) {
      erros.push({ linha: n, campo: 'cpf/ra', valor: r.cpf || r.ra || '', mensagem: 'Aluno não encontrado na base — importe os alunos primeiro' })
      return
    }
    const valor = paraCentavos(r.valor ?? '')
    if (valor == null || valor <= 0) {
      erros.push({ linha: n, campo: 'valor', valor: r.valor ?? '', mensagem: 'Valor inválido' })
      return
    }
    const venc = paraData(r.vencimento ?? '')
    if (!venc) { erros.push({ linha: n, campo: 'vencimento', valor: r.vencimento ?? '', mensagem: 'Vencimento inválido' }); return }
    registros.push({ linha: n, duplicado: false, dados: { alunoId, valorCentavos: valor, dataVencimento: venc, tipo: (r.tipo || 'MENSALIDADE').toUpperCase() } })
  })
  return { erros, registros }
}

async function preparar(tipo: TipoImport, cab: string[], linhas: string[][]): Promise<Preparado> {
  if (tipo === 'disciplinas') return prepararDisciplinas(cab, linhas)
  if (tipo === 'alunos') return prepararAlunos(cab, linhas)
  if (tipo === 'titulos') return prepararTitulos(cab, linhas)
  throw new Error(`Importador "${tipo}" ainda não implementado`)
}

/** Analisa sem gravar: é o dry-run que a implantação exige antes de confiar. */
export async function analisar(tipo: TipoImport, csv: string): Promise<RelatorioImport> {
  const { cabecalho, linhas } = parseCsv(csv)
  if (cabecalho.length === 0) throw new Error('Arquivo vazio ou sem cabeçalho')
  const { erros, registros } = await preparar(tipo, cabecalho, linhas)
  return {
    tipo, totalLinhas: linhas.length,
    validas: registros.length, invalidas: erros.length,
    erros: erros.slice(0, 200),
    amostra: registros.slice(0, 5).map((r) => r.dados),
    duplicadas: registros.filter((r) => r.duplicado).length,
    simulacao: true,
  }
}

/**
 * Importa de verdade. Linhas inválidas são ignoradas (o relatório já as
 * apontou); duplicadas são puladas para não criar registro repetido.
 */
export async function importar(tipo: TipoImport, csv: string): Promise<RelatorioImport & { gravadas: number; puladas: number }> {
  const { cabecalho, linhas } = parseCsv(csv)
  if (cabecalho.length === 0) throw new Error('Arquivo vazio ou sem cabeçalho')
  const { erros, registros } = await preparar(tipo, cabecalho, linhas)
  const novos = registros.filter((r) => !r.duplicado)

  let gravadas = 0
  if (tipo === 'disciplinas') {
    await prisma.$transaction(async (tx) => {
      for (const r of novos) {
        const { courseId, ...resto } = r.dados
        await tx.acaDisciplina.create({ data: { ...resto, courseId: courseId ?? 1 } })
        gravadas++
      }
    })
  } else if (tipo === 'alunos') {
    // Aluno pende de Lead (Pessoa unificada) — criar os dois na mesma transação.
    await prisma.$transaction(async (tx) => {
      for (const r of novos) {
        const d = r.dados
        const lead = await tx.lead.create({
          data: {
            uid: `imp-${Date.now()}-${gravadas}`, empresa: 'Importado', nome: d.nome,
            whatsapp: d.whatsapp ?? '', email: d.email ?? '',
            formData: { origem: 'importacao_csv' } as any, scores: {} as any,
            lastStep: 0, completed: false, status: 'NOVO',
            qualifiedAt: new Date(), qualificationSource: 'importacao',
          },
        })
        await tx.aluno.create({
          // O nome vive no Lead (Pessoa unificada) — Aluno não duplica o campo.
          data: {
            leadId: lead.id, cpf: d.cpf, ra: d.ra,
            dataNascimento: d.dataNascimento, racaCor: d.racaCor, nacionalidade: d.nacionalidade,
          } as any,
        })
        gravadas++
      }
    })
  } else {
    throw new Error(`Gravação de "${tipo}" ainda não implementada`)
  }

  return {
    tipo, totalLinhas: linhas.length,
    validas: registros.length, invalidas: erros.length,
    erros: erros.slice(0, 200),
    amostra: novos.slice(0, 5).map((r) => r.dados),
    duplicadas: registros.length - novos.length,
    simulacao: false,
    gravadas, puladas: registros.length - novos.length,
  }
}

/** Modelo de CSV por tipo — evita o vaivém de "qual é o formato?". */
export function modeloCsv(tipo: TipoImport): string {
  if (tipo === 'disciplinas') return 'nome;codigo;carga_horaria;ementa;curso_id\nCálculo I;MAT101;80;Limites e derivadas;1'
  if (tipo === 'alunos') return 'nome;cpf;ra;email;whatsapp;nascimento;raca_cor;nacionalidade\nMaria Silva;12345678909;2026001;maria@ex.com;5511999999999;10/05/2004;PARDA;Brasileira'
  if (tipo === 'titulos') return 'cpf;ra;valor;vencimento;tipo\n12345678909;2026001;350,00;10/03/2026;MENSALIDADE'
  return ''
}
