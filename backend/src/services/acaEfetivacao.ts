// src/services/acaEfetivacao.ts
// Módulo Acadêmico · ponte Portal de Matrículas → ERP.
//
// O portal público cria Lead + ProcessRegistration + EnrollmentRegistration; o
// ERP trabalha com Aluno → AcaVinculo → AcaMatricula. Não havia nada ligando os
// dois: o candidato terminava a inscrição, pagava, mandava documento — e alguém
// tinha que redigitá-lo na secretaria para virar aluno. Este serviço faz esse
// salto, com os mesmos cuidados da inscrição manual (vaga, lista de espera,
// duplicidade e trilha em AcaMatriculaEvento).
//
// É idempotente: chamar duas vezes na mesma inscrição devolve o que já existe.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'

const ATIVOS = ['INSCRITO', 'PRE_MATRICULA', 'MATRICULADO'] as const

export interface ResultadoEfetivacao {
  alunoId: number
  ra: string | null
  vinculoId: number
  matriculaId: number
  turmaId: number
  listaEspera: boolean
  jaExistia: boolean
}

/** Primeiro valor não-vazio entre as chaves candidatas do formData. */
function achar(form: Record<string, any>, chaves: string[]): string | null {
  for (const k of chaves) {
    const v = form?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

function soDigitos(v: string | null): string | null {
  if (!v) return null
  const d = v.replace(/\D+/g, '')
  return d || null
}

function paraData(v: string | null): Date | null {
  if (!v) return null
  // aceita 2001-05-30 e 30/05/2001 — o form do portal usa os dois conforme o bloco
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : v
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

const TURNOS: Record<string, 'MATUTINO' | 'VESPERTINO' | 'NOTURNO' | 'INTEGRAL' | 'EAD'> = {
  matutino: 'MATUTINO', manha: 'MATUTINO', manhã: 'MATUTINO',
  vespertino: 'VESPERTINO', tarde: 'VESPERTINO',
  noturno: 'NOTURNO', noite: 'NOTURNO',
  integral: 'INTEGRAL', ead: 'EAD', 'a distancia': 'EAD', 'a distância': 'EAD',
}

function paraTurno(v: string | null) {
  if (!v) return null
  return TURNOS[v.trim().toLowerCase()] ?? null
}

/** Ocupação da turma — mesma regra da inscrição pela secretaria (acaInscricao). */
async function ocupacao(turmaId: number) {
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { capacidade: true } })
  const inscritos = await prisma.acaMatricula.count({
    where: { turmaId, listaEspera: false, status: { in: ATIVOS as any } },
  })
  const capacidade = turma?.capacidade ?? null
  return { capacidade, inscritos, lotada: capacidade != null && inscritos >= capacidade }
}

/**
 * Cria (ou recupera) o Aluno a partir do Lead da inscrição, preenchendo o que o
 * formulário trouxer. Lead↔Aluno é 1:1 — o mesmo contato que conversa no
 * WhatsApp é o aluno, não uma segunda pessoa.
 */
async function garantirAluno(leadId: number, form: Record<string, any>) {
  const existente = await prisma.aluno.findUnique({ where: { leadId }, select: { id: true, ra: true, cpf: true } })

  const dados = {
    cpf: soDigitos(achar(form, ['cpf', 'CPF', 'documento'])),
    dataNascimento: paraData(achar(form, ['dataNascimento', 'data_nascimento', 'nascimento'])),
    rg: achar(form, ['rg', 'RG']),
    rgOrgaoEmissor: achar(form, ['rgOrgaoEmissor', 'orgao_emissor']),
    sexo: achar(form, ['sexo', 'genero']),
    nomeMae: achar(form, ['nomeMae', 'nome_mae', 'mae']),
    nomePai: achar(form, ['nomePai', 'nome_pai', 'pai']),
    racaCor: achar(form, ['racaCor', 'raca_cor', 'raca']),
    nacionalidade: achar(form, ['nacionalidade']),
    naturalidade: achar(form, ['naturalidade']),
    estadoCivil: achar(form, ['estadoCivil', 'estado_civil']),
  }
  // não sobrescreve com null o que a secretaria já preencheu à mão
  const limpo = Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null))

  if (existente) {
    if (Object.keys(limpo).length) {
      await prisma.aluno.update({ where: { id: existente.id }, data: limpo as any })
    }
    return { id: existente.id, ra: existente.ra, criado: false }
  }

  const aluno = await prisma.aluno.create({
    data: { leadId, ...(limpo as any) },
    select: { id: true, ra: true },
  })

  // RA só é gerado aqui porque o portal do aluno aceita login por CPF ou RA, e
  // quem vem do portal não passa pela secretaria para receber um.
  if (!aluno.ra) {
    const ano = new Date().getFullYear()
    const ra = `${ano}${String(aluno.id).padStart(6, '0')}`
    await prisma.aluno.update({ where: { id: aluno.id }, data: { ra } })
    return { id: aluno.id, ra, criado: true }
  }
  return { id: aluno.id, ra: aluno.ra, criado: true }
}

/** Vínculo aluno↔curso. É ele que carrega forma de ingresso, campus e turno. */
async function garantirVinculo(
  alunoId: number,
  offering: { courseId: number; unitId: number; turno: string | null },
  entryModeId: number | null,
) {
  const existente = await prisma.acaVinculo.findFirst({
    where: { alunoId, courseId: offering.courseId },
    select: { id: true },
  })
  if (existente) return existente.id

  const v = await prisma.acaVinculo.create({
    data: {
      alunoId,
      courseId: offering.courseId,
      unidadeId: offering.unitId,
      situacao: 'PRE_MATRICULADO',
      turno: paraTurno(offering.turno) as any,
      entryModeId: entryModeId ?? undefined,
      dataIngresso: new Date(),
    },
    select: { id: true },
  })
  return v.id
}

/**
 * Turma que recebe o candidato: a que está ligada à oferta escolhida e com
 * matrícula aberta. Sem turma não dá para matricular — e o erro precisa dizer
 * isso com todas as letras, porque a saída é a secretaria abrir a turma.
 */
async function acharTurma(offeringId: number, turmaIdForcada?: number | null) {
  if (turmaIdForcada) {
    const t = await prisma.acaTurma.findUnique({ where: { id: turmaIdForcada }, select: { id: true, ativo: true } })
    if (!t) throw new Error(`Turma ${turmaIdForcada} não existe.`)
    return t.id
  }
  const turmas = await prisma.acaTurma.findMany({
    where: { courseOfferingId: offeringId, ativo: true },
    orderBy: [{ matriculaAberta: 'desc' }, { id: 'desc' }],
    select: { id: true, matriculaAberta: true, nome: true },
  })
  if (turmas.length === 0) {
    throw new Error(
      'Não há turma criada para esta oferta. Crie a turma em Estrutura Acadêmica e ligue-a à oferta antes de efetivar.',
    )
  }
  const aberta = turmas.find((t) => t.matriculaAberta)
  if (!aberta) {
    throw new Error(
      `A turma "${turmas[0].nome}" existe mas está com matrícula fechada. Abra a matrícula na turma para efetivar.`,
    )
  }
  return aberta.id
}

/**
 * Efetiva a inscrição do portal no ERP: cria aluno, vínculo e matrícula.
 * `forcarEspera` põe na lista de espera mesmo havendo vaga.
 */
export async function efetivarInscricao(
  registrationId: number,
  opts: { turmaId?: number | null; forcarEspera?: boolean; origem?: string } = {},
): Promise<ResultadoEfetivacao> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, status: true, leadId: true, formData: true,
      processRegistration: {
        select: {
          id: true, offeringId: true,
          offering: { select: { id: true, courseId: true, unitId: true, turno: true } },
        },
      },
    },
  })
  if (!reg) throw new Error('Inscrição não encontrada.')
  if (!reg.leadId) throw new Error('Inscrição sem contato vinculado — não dá para criar o aluno.')

  const form = (reg.formData as Record<string, any>) || {}

  // A oferta vem do processo seletivo; o formData guarda o offeringId como
  // segunda fonte (inscrição de portal sem processo seletivo).
  let offering = reg.processRegistration?.offering ?? null
  if (!offering) {
    const offeringId = Number(achar(form, ['offeringId', 'oferta', 'ofertaId']) || 0)
    if (offeringId) {
      offering = await prisma.courseOffering.findUnique({
        where: { id: offeringId },
        select: { id: true, courseId: true, unitId: true, turno: true },
      })
    }
  }
  if (!offering) throw new Error('Inscrição sem oferta de curso — escolha o curso antes de efetivar.')

  const aluno = await garantirAluno(reg.leadId, form)
  const entryModeId = Number(achar(form, ['entryModeId', 'formaIngressoId']) || 0) || null
  const vinculoId = await garantirVinculo(aluno.id, offering, entryModeId)
  const turmaId = await acharTurma(offering.id, opts.turmaId)

  const dup = await prisma.acaMatricula.findUnique({
    where: { alunoId_turmaId: { alunoId: aluno.id, turmaId } },
    select: { id: true, listaEspera: true },
  })
  if (dup) {
    return {
      alunoId: aluno.id, ra: aluno.ra, vinculoId, matriculaId: dup.id,
      turmaId, listaEspera: dup.listaEspera, jaExistia: true,
    }
  }

  const occ = await ocupacao(turmaId)
  const listaEspera = opts.forcarEspera === true || occ.lotada
  const matricula = await prisma.acaMatricula.create({
    data: {
      alunoId: aluno.id,
      turmaId,
      vinculoId,
      courseOfferingId: offering.id,
      status: 'INSCRITO',
      listaEspera,
      origem: opts.origem || 'portal',
      // Guarda de onde veio: é o que permite ao financeiro montar o contrato
      // com o que a pessoa escolheu no checkout, e à secretaria voltar da
      // matrícula para a inscrição sem procurar por nome.
      enrollmentRegistrationId: reg.id,
    },
    select: { id: true },
  })
  await prisma.acaMatriculaEvento.create({
    data: {
      matriculaId: matricula.id,
      para: 'INSCRITO',
      obs: listaEspera
        ? `Inscrição ${reg.candidateCode} vinda do portal — turma lotada, entrou em lista de espera`
        : `Inscrição ${reg.candidateCode} vinda do portal`,
    },
  })

  // Fecha o ciclo do lado do portal: quem olha a inscrição precisa ver que ela
  // já virou matrícula, senão a secretaria refaz o trabalho.
  await prisma.enrollmentRegistration.update({
    where: { id: reg.id },
    data: { status: 'enrolled' },
  })
  if (reg.processRegistration) {
    await prisma.processRegistration.update({
      where: { id: reg.processRegistration.id },
      data: { status: 'matriculado', matriculadoEm: new Date() },
    })
  }

  // A matrícula precisa aparecer na conversa: quem atende o candidato no
  // WhatsApp vê, na mesma linha do tempo, que ele virou aluno — sem abrir o ERP.
  logEvent({
    leadId: reg.leadId,
    type: 'enrollment_matriculado',
    category: 'lifecycle',
    title: listaEspera ? 'Entrou em lista de espera' : 'Virou aluno',
    source: 'system',
    actorType: 'system',
    description: `Inscrição ${reg.candidateCode} efetivada — RA ${aluno.ra ?? '—'}, matrícula #${matricula.id}.`,
    metadata: { registrationId: reg.id, alunoId: aluno.id, matriculaId: matricula.id, turmaId, listaEspera },
  })

  // Mesmo gatilho da matrícula feita pela secretaria (acaMatricula.ts): quem
  // entra pelo portal não pode ficar sem o contrato que os outros recebem.
  import('./acaAssinatura.js')
    .then((m) => m.dispararEvento('MATRICULA_CRIADA', { alunoId: aluno.id, matriculaId: matricula.id }))
    .catch((e) => console.warn('[acaEfetivacao] gatilho MATRICULA_CRIADA falhou:', e?.message || e))

  return {
    alunoId: aluno.id, ra: aluno.ra, vinculoId, matriculaId: matricula.id,
    turmaId, listaEspera, jaExistia: false,
  }
}

/**
 * Contrato assinado → matrícula efetivada.
 *
 * O motor de assinatura só sabia mudar o status do próprio envelope: a matrícula
 * seguia "INSCRITO" mesmo com o contrato assinado, e alguém tinha que lembrar de
 * mudar na mão. Chamado pelo recompute() do acaAssinatura sempre que o envelope
 * fecha, seja por assinatura real, webhook do provedor ou simulação.
 */
export async function efetivarPorContratoAssinado(envelopeId: number): Promise<void> {
  const env = await prisma.acaAssinatura.findUnique({
    where: { id: envelopeId },
    select: { id: true, status: true, matriculaId: true },
  })
  if (!env || env.status !== 'ASSINADO' || !env.matriculaId) return

  const mat = await prisma.acaMatricula.findUnique({
    where: { id: env.matriculaId },
    select: { id: true, status: true, vinculoId: true, listaEspera: true },
  })
  // Quem está em lista de espera não vira matriculado por ter assinado: primeiro
  // precisa de vaga (promover), senão a turma estoura a capacidade em silêncio.
  if (!mat || mat.listaEspera) return
  if (!['INSCRITO', 'PRE_MATRICULA'].includes(mat.status)) return

  await prisma.acaMatricula.update({ where: { id: mat.id }, data: { status: 'MATRICULADO' } })

  const dono = await prisma.aluno.findUnique({ where: { id: (await prisma.acaMatricula.findUnique({ where: { id: mat.id }, select: { alunoId: true } }))!.alunoId }, select: { leadId: true, ra: true } })
  if (dono) {
    logEvent({
      leadId: dono.leadId,
      type: 'enrollment_contrato_assinado',
      category: 'lifecycle',
      title: 'Contrato assinado — matrícula efetivada',
      source: 'system',
      actorType: 'system',
      description: `Assinatura eletrônica concluída; matrícula #${mat.id} passou a MATRICULADO.`,
      metadata: { matriculaId: mat.id, envelopeId },
    })
  }
  await prisma.acaMatriculaEvento.create({
    data: { matriculaId: mat.id, de: mat.status, para: 'MATRICULADO', obs: 'Contrato assinado eletronicamente' },
  })
  if (mat.vinculoId) {
    await prisma.acaVinculo.update({ where: { id: mat.vinculoId }, data: { situacao: 'ATIVO' } })
  }
}

/**
 * Contrato assinado → PDF arquivado no GED do aluno.
 *
 * Sem isto o documento assinado só existia no provedor: a secretaria precisava
 * entrar na Autentique para achar o contrato de um aluno, e o que fica no
 * sistema é o que sobrevive à troca de fornecedor.
 */
export async function arquivarContratoNoGed(envelopeId: number): Promise<number | null> {
  const env = await prisma.acaAssinatura.findUnique({
    where: { id: envelopeId },
    select: { id: true, status: true, alunoId: true, titulo: true, arquivoAssinadoUrl: true },
  })
  if (!env || env.status !== 'ASSINADO' || !env.alunoId) return null

  // Já arquivado antes (reprocessamento de webhook não duplica no GED).
  const jaTem = await prisma.acaGedArquivo.findFirst({
    where: { alunoId: env.alunoId, tipo: 'Contrato', observacao: `envelope:${env.id}` },
    select: { id: true },
  })
  if (jaTem) return jaTem.id

  let url = env.arquivoAssinadoUrl // provedor real devolve o PDF assinado
  if (!url) {
    // Modo simulado, ou provedor sem link: guarda o PDF que o próprio sistema gera.
    const { gerarPdf } = await import('./acaAssinatura.js')
    const { uploadsPath } = await import('../lib/uploadsDir.js')
    const fs = await import('node:fs/promises')
    const { buffer } = await gerarPdf(env.id)
    const dir = uploadsPath('contratos')
    await fs.mkdir(dir, { recursive: true })
    const nome = `contrato-${env.alunoId}-${env.id}.pdf`
    await fs.writeFile(`${dir}/${nome}`, buffer)
    url = `/uploads/contratos/${nome}`
  }

  const arquivo = await prisma.acaGedArquivo.create({
    data: {
      alunoId: env.alunoId,
      tipo: 'Contrato',
      nome: env.titulo.slice(0, 191),
      url,
      status: 'CONFERIDO', // assinado eletronicamente já nasce conferido
      observacao: `envelope:${env.id}`,
    },
    select: { id: true },
  })
  return arquivo.id
}
