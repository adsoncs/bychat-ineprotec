// src/services/acaDiploma.ts
// Módulo Acadêmico · F17 — Diploma Digital (padrão MEC). Geração do XML do
// diplomado + ponto de integração de assinatura ICP-Brasil + ciclo de vida
// (registro/anulação) + validação pública por código.
// ⚠️ O XSD oficial do MEC é extenso e versionado — aqui geramos uma estrutura
// representativa, mapeável ao leiaute vigente na homologação.

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { montarHistorico } from './acaDocumentos.js'

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string))

export async function diplomaConfig() {
  return (await prisma.acaDiplomaConfig.findFirst()) || null
}

/** Cria (ou retorna) o diploma de uma matrícula CONCLUÍDA. */
export async function criarDiploma(matriculaId: number) {
  const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { status: true, alunoId: true, dataConclusao: true } })
  if (!mat) throw new Error('Matrícula não encontrada')
  if (mat.status !== 'CONCLUIDO') throw new Error('A matrícula precisa estar CONCLUÍDA para gerar o diploma')
  const existente = await prisma.acaDiploma.findUnique({ where: { matriculaId } })
  if (existente) return existente
  const hist = await montarHistorico(mat.alunoId)
  return prisma.acaDiploma.create({ data: { matriculaId, alunoId: mat.alunoId, cargaHoraria: hist?.chTotal ?? 0, dataColacao: mat.dataConclusao, status: 'RASCUNHO' } })
}

/** Gera o XML do diplomado (padrão MEC, base) e o código de validação público. */
export async function gerarXmlDiploma(diplomaId: number) {
  const d = await prisma.acaDiploma.findUnique({ where: { id: diplomaId } })
  if (!d) throw new Error('Diploma não encontrado')
  if (d.status === 'ANULADO') throw new Error('Diploma anulado')
  const [cfg, aluno, hist] = await Promise.all([diplomaConfig(), prisma.aluno.findUnique({ where: { id: d.alunoId }, select: { ra: true, cpf: true, dataNascimento: true, lead: { select: { nome: true } } } }), montarHistorico(d.alunoId)])
  const codigo = d.codigoValidacao || crypto.randomBytes(12).toString('hex').toUpperCase()
  const emissao = new Date()
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DiplomaDigital versao="1.0" padrao="MEC">
  <Diplomado>
    <Nome>${esc(aluno?.lead.nome)}</Nome>
    <CPF>${esc(aluno?.cpf || '')}</CPF>
    <RA>${esc(aluno?.ra || '')}</RA>
    <DataNascimento>${aluno?.dataNascimento ? new Date(aluno.dataNascimento).toISOString().slice(0, 10) : ''}</DataNascimento>
  </Diplomado>
  <Diploma>
    <Curso>${esc(hist?.curso || '')}</Curso>
    <CargaHorariaTotal>${d.cargaHoraria}</CargaHorariaTotal>
    <DataColacao>${d.dataColacao ? new Date(d.dataColacao).toISOString().slice(0, 10) : ''}</DataColacao>
    <DataEmissao>${emissao.toISOString().slice(0, 10)}</DataEmissao>
    <Numero>${esc(d.numero || '')}</Numero>
    <Livro>${esc(d.livro || '')}</Livro>
    <Folha>${esc(d.folha || '')}</Folha>
  </Diploma>
  <IESEmissora>
    <Nome>${esc(cfg?.iesEmissora || '')}</Nome>
    <CNPJ>${esc(cfg?.cnpjEmissora || '')}</CNPJ>
    <CodigoMEC>${esc(cfg?.codigoMecEmissora || '')}</CodigoMEC>
    <Reitor>${esc(cfg?.reitor || '')}</Reitor>
    <Secretario>${esc(cfg?.secretario || '')}</Secretario>
  </IESEmissora>
  <IESRegistradora>
    <Nome>${esc(cfg?.iesRegistradora || cfg?.iesEmissora || '')}</Nome>
    <CodigoMEC>${esc(cfg?.codigoMecRegistradora || '')}</CodigoMEC>
  </IESRegistradora>
  <Validacao>
    <Codigo>${codigo}</Codigo>
  </Validacao>
  <!-- A assinatura ICP-Brasil (XMLDSig) é aplicada na etapa de assinatura (ponto de integração). -->
</DiplomaDigital>`
  return prisma.acaDiploma.update({ where: { id: diplomaId }, data: { xmlDiplomado: xml, codigoValidacao: codigo, dataEmissao: emissao, status: 'XML_GERADO' } })
}

/**
 * Assinatura ICP-Brasil — PONTO DE INTEGRAÇÃO. Aqui recebemos o resultado da
 * assinatura (feita por A1/A3 ou provedor externo) e registramos. Em produção,
 * o XMLDSig é aplicado pelo assinador configurado em AcaDiplomaConfig.provedorAssinatura.
 */
export async function assinarDiploma(diplomaId: number, assinaturaInfo: string) {
  const d = await prisma.acaDiploma.findUnique({ where: { id: diplomaId }, select: { status: true } })
  if (!d) throw new Error('Diploma não encontrado')
  if (d.status !== 'XML_GERADO') throw new Error('Gere o XML antes de assinar')
  return prisma.acaDiploma.update({ where: { id: diplomaId }, data: { status: 'ASSINADO', assinaturaInfo } })
}

export async function registrarDiploma(diplomaId: number, dados: { numero?: string; livro?: string; folha?: string }) {
  const d = await prisma.acaDiploma.findUnique({ where: { id: diplomaId }, select: { status: true } })
  if (!d) throw new Error('Diploma não encontrado')
  if (d.status !== 'ASSINADO') throw new Error('Assine o diploma antes de registrar')
  return prisma.acaDiploma.update({ where: { id: diplomaId }, data: { status: 'REGISTRADO', numero: dados.numero || null, livro: dados.livro || null, folha: dados.folha || null } })
}

export async function anularDiploma(diplomaId: number, motivo: string) {
  return prisma.acaDiploma.update({ where: { id: diplomaId }, data: { status: 'ANULADO', motivoAnulacao: motivo } })
}

export async function validarPorCodigo(codigo: string) {
  const d = await prisma.acaDiploma.findUnique({ where: { codigoValidacao: codigo }, select: { status: true, numero: true, cargaHoraria: true, dataEmissao: true, alunoId: true } })
  if (!d) return null
  const aluno = await prisma.aluno.findUnique({ where: { id: d.alunoId }, select: { lead: { select: { nome: true } } } })
  const hist = await montarHistorico(d.alunoId)
  return { valido: d.status === 'REGISTRADO' || d.status === 'ASSINADO', anulado: d.status === 'ANULADO', nome: aluno?.lead.nome, curso: hist?.curso, cargaHoraria: d.cargaHoraria, numero: d.numero, dataEmissao: d.dataEmissao, status: d.status }
}
