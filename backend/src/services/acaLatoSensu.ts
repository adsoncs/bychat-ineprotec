// src/services/acaLatoSensu.ts
//
// Conformidade dos cursos de pós-graduação lato sensu (especialização).
//
// Res. CNE/CES nº 1/2018 impõe exigências que um ERP de graduação não cobre, e
// que costumam ser descobertas na hora da fiscalização:
//
//   Art. 7º, I  — matriz com carga mínima de 360 horas.
//   Art. 8º     — o certificado deve vir ACOMPANHADO do histórico escolar, e
//                 nele devem constar obrigatória e explicitamente:
//                   I   — o ato legal de credenciamento da instituição;
//                   II  — identificação do curso, período de realização,
//                         duração total e carga horária de cada atividade;
//                   III — o elenco do corpo docente que EFETIVAMENTE ministrou
//                         o curso, com a respectiva titulação.
//   Art. 8º §1º — o certificado é registrado pela instituição que ministrou;
//          §2º — em convênio, registrado por AMBAS as instituições.
//   Art. 9º     — corpo docente com no mínimo 30% de portadores de título
//                 stricto sensu (mestrado ou doutorado).
//
// O item III é o mais esquecido: não basta listar as disciplinas, é preciso dizer
// QUEM deu aula e com que titulação — por isso `corpoDocenteEfetivo` sai dos
// diários que o aluno cursou, e não do cadastro do curso.

import { prisma } from '../lib/prisma.js'

/** Carga horária mínima do lato sensu (art. 7º, I). */
export const CH_MINIMA_LATO_SENSU = 360

/** Proporção mínima de docentes com stricto sensu (art. 9º). */
export const PCT_MINIMO_STRICTO_SENSU = 30

const TITULOS_STRICTO = ['MESTRE', 'DOUTOR', 'MESTRADO', 'DOUTORADO', 'PHD', 'POS-DOUTOR', 'PÓS-DOUTOR']

/** Titulação de stricto sensu — especialização não conta para o art. 9º. */
export function ehStrictoSensu(titulacao?: string | null): boolean {
  if (!titulacao) return false
  const t = titulacao.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return TITULOS_STRICTO.some((s) => t.includes(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
}

/** Graus que são de nível médio ou livre — nunca lato sensu, por definição. */
const GRAUS_NAO_SUPERIORES = ['tecnico', 'especializacao_tecnica', 'livre', 'qualificacao', 'fic']

/**
 * Reconhece o curso como pós-graduação lato sensu. Sem enum dedicado, usa os
 * sinais que existem: o grau e o nível de ensino.
 *
 * A armadilha é "especialização TÉCNICA": ela existe e NÃO é lato sensu — é
 * educação profissional técnica de nível médio (Res. CNE/CP 1/2021, art. 15,
 * III), respondendo ao SISTEC, não ao Censo da Educação Superior. Casar só a
 * palavra "especialização" faria o ERP exigir 360h e 30% de stricto sensu de um
 * curso de nível médio, que não está sujeito a nenhum dos dois.
 *
 * Retorna false quando não há evidência — exibir exigência de especialização num
 * curso técnico seria pior que omitir.
 */
export function ehLatoSensu(curso: {
  grau?: string | null
  level?: { nome?: string | null; codigo?: string | null } | null
}): boolean {
  const semAcento = (v: string) => v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // O grau é declaração explícita e vence a heurística de texto.
  const grau = (curso.grau ?? '').trim().toLowerCase()
  if (GRAUS_NAO_SUPERIORES.includes(grau)) return false
  if (grau === 'pos_lato') return true

  const alvo = semAcento([curso.grau, curso.level?.nome, curso.level?.codigo].filter(Boolean).join(' '))
  // "Especialização Técnica" e afins: nível médio, fora do escopo desta norma.
  if (/TECNIC/.test(alvo)) return false
  return /ESPECIALIZACAO|LATO.?SENSU|POS.?GRADUACAO|MBA/.test(alvo)
}

/**
 * Ato legal de credenciamento da instituição (art. 8º, I).
 *
 * Prefere o ato de credenciamento propriamente dito; na falta, devolve o ato de
 * IES mais recente e sinaliza que não é credenciamento — melhor imprimir o que
 * existe com a ressalva do que imprimir nada.
 */
export async function atoCredenciamento(): Promise<{
  tipo: string
  numero: string | null
  dataPublicacao: Date | null
  dataDou: Date | null
  validadeAte: Date | null
  ehCredenciamento: boolean
} | null> {
  const atos = await prisma.acaAtoAutorizativo.findMany({
    where: { escopo: 'IES', ativo: true },
    orderBy: [{ dataPublicacao: 'desc' }],
    select: { tipo: true, numero: true, dataPublicacao: true, dataDou: true, validadeAte: true },
  })
  if (!atos.length) return null
  const cred = atos.find((a) => /CREDENCIA/i.test(a.tipo))
  const escolhido = cred ?? atos[0]!
  return { ...escolhido, ehCredenciamento: !!cred }
}

export interface DocenteEfetivo {
  userId: number
  nome: string
  titulacao: string | null
  strictoSensu: boolean
  /** Disciplinas que este docente ministrou para o aluno. */
  disciplinas: string[]
}

/**
 * Corpo docente que EFETIVAMENTE ministrou as disciplinas do aluno (art. 8º,
 * III). Sai dos diários das turmas em que o aluno teve resultado — é o único
 * lugar que registra quem deu aula de fato.
 */
export async function corpoDocenteEfetivo(alunoId: number): Promise<DocenteEfetivo[]> {
  const matriculas = await prisma.acaMatricula.findMany({
    where: { alunoId, status: { in: ['MATRICULADO', 'CONCLUIDO', 'TRANCADO'] as any } },
    select: { id: true, turmaId: true },
  })
  if (!matriculas.length) return []

  const diarios = await prisma.acaDiario.findMany({
    where: { turmaId: { in: matriculas.map((m) => m.turmaId) }, professorUserId: { not: null } },
    select: { id: true, professorUserId: true, disciplinaId: true },
  })
  if (!diarios.length) return []

  // Só conta o docente do diário em que o aluno tem resultado: matrícula em
  // turma cujo diário ele não cursou não faz daquele professor seu professor.
  const resultados = await prisma.acaResultado.findMany({
    where: { diarioId: { in: diarios.map((d) => d.id) }, matriculaId: { in: matriculas.map((m) => m.id) } },
    select: { diarioId: true },
  })
  const cursados = new Set(resultados.map((r) => r.diarioId))
  const efetivos = diarios.filter((d) => cursados.has(d.id))
  if (!efetivos.length) return []

  const userIds = [...new Set(efetivos.map((d) => d.professorUserId!))]
  const disciplinaIds = [...new Set(efetivos.map((d) => d.disciplinaId))]
  const [users, docentes, disciplinas] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.acaDocente.findMany({ where: { userId: { in: userIds } }, select: { userId: true, titulacao: true } }),
    prisma.acaDisciplina.findMany({ where: { id: { in: disciplinaIds } }, select: { id: true, nome: true } }),
  ])
  const nomeUser = new Map(users.map((u) => [u.id, u.name]))
  const tit = new Map(docentes.map((d) => [d.userId, d.titulacao]))
  const nomeDisc = new Map(disciplinas.map((d) => [d.id, d.nome]))

  const porDocente = new Map<number, DocenteEfetivo>()
  for (const d of efetivos) {
    const uid = d.professorUserId!
    let reg = porDocente.get(uid)
    if (!reg) {
      const titulacao = tit.get(uid) ?? null
      reg = {
        userId: uid,
        nome: nomeUser.get(uid) ?? `Usuário #${uid}`,
        titulacao,
        strictoSensu: ehStrictoSensu(titulacao),
        disciplinas: [],
      }
      porDocente.set(uid, reg)
    }
    const nome = nomeDisc.get(d.disciplinaId)
    if (nome && !reg.disciplinas.includes(nome)) reg.disciplinas.push(nome)
  }
  return [...porDocente.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export interface PendenciaLatoSensu {
  artigo: string
  descricao: string
  gravidade: 'impedimento' | 'atencao'
}

export interface ConformidadeLatoSensu {
  courseId: number
  curso: string
  ehLatoSensu: boolean
  cargaHoraria: number | null
  chMinimaAtendida: boolean
  docentes: { total: number; strictoSensu: number; percentual: number; atende: boolean }
  atoCredenciamento: Awaited<ReturnType<typeof atoCredenciamento>>
  pendencias: PendenciaLatoSensu[]
}

/**
 * Painel de conformidade do curso. Reporta em vez de bloquear: a instituição
 * precisa ver o que falta antes de emitir certificado, e travar a emissão
 * puniria o aluno por um dado de cadastro.
 *
 * O corpo docente aqui é o do CURSO (quem está alocado nos diários das turmas do
 * curso), diferente de `corpoDocenteEfetivo`, que é por aluno.
 */
export async function conformidadeLatoSensu(courseId: number): Promise<ConformidadeLatoSensu | null> {
  const curso = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, nome: true, grau: true, cargaHoraria: true, level: { select: { nome: true, codigo: true } } },
  })
  if (!curso) return null

  const lato = ehLatoSensu(curso)
  const pendencias: PendenciaLatoSensu[] = []

  // Carga horária: usa a da matriz ativa quando existe, porque é ela que vale
  // para o aluno; o campo do curso costuma ser o valor de catálogo.
  // A matriz guarda CH por balde (obrigatória, eletiva, estágio, TCC…), não um
  // total. O mínimo do art. 7º é da carga do curso, então soma todos.
  const matrizes = await prisma.acaMatriz.findMany({
    where: { courseId, status: 'ATIVA' },
    select: {
      id: true, chObrigatoria: true, chEletiva: true, chOptativa: true,
      chEstagio: true, chTcc: true, chComplementar: true, chExtensao: true,
    },
  })
  const chDaMatriz = (m: (typeof matrizes)[number]) =>
    (m.chObrigatoria ?? 0) + (m.chEletiva ?? 0) + (m.chOptativa ?? 0)
    + (m.chEstagio ?? 0) + (m.chTcc ?? 0) + (m.chComplementar ?? 0) + (m.chExtensao ?? 0)
  const chMatriz = matrizes.reduce((max, m) => Math.max(max, chDaMatriz(m)), 0)
  const ch = chMatriz || curso.cargaHoraria || null
  const chOk = (ch ?? 0) >= CH_MINIMA_LATO_SENSU
  if (lato && !chOk) {
    pendencias.push({
      artigo: 'Art. 7º, I',
      descricao: ch
        ? `Carga horária de ${ch}h abaixo do mínimo de ${CH_MINIMA_LATO_SENSU}h exigido para lato sensu.`
        : `Carga horária não informada — o mínimo para lato sensu é ${CH_MINIMA_LATO_SENSU}h.`,
      gravidade: 'impedimento',
    })
  }

  // Corpo docente alocado nas turmas do curso.
  const ofertas = await prisma.courseOffering.findMany({ where: { courseId }, select: { id: true } })
  const turmas = ofertas.length
    ? await prisma.acaTurma.findMany({ where: { courseOfferingId: { in: ofertas.map((o) => o.id) } }, select: { id: true } })
    : []
  const diarios = turmas.length
    ? await prisma.acaDiario.findMany({
        where: { turmaId: { in: turmas.map((t) => t.id) }, professorUserId: { not: null } },
        select: { professorUserId: true },
      })
    : []
  const userIds = [...new Set(diarios.map((d) => d.professorUserId!))]
  const docs = userIds.length
    ? await prisma.acaDocente.findMany({ where: { userId: { in: userIds } }, select: { userId: true, titulacao: true } })
    : []
  const titPorUser = new Map(docs.map((d) => [d.userId, d.titulacao]))
  const totalDocentes = userIds.length
  const comStricto = userIds.filter((u) => ehStrictoSensu(titPorUser.get(u))).length
  const pct = totalDocentes ? Math.round((comStricto / totalDocentes) * 1000) / 10 : 0
  const pctOk = totalDocentes > 0 && pct >= PCT_MINIMO_STRICTO_SENSU

  if (lato) {
    if (!totalDocentes) {
      pendencias.push({
        artigo: 'Art. 8º, III',
        descricao: 'Nenhum docente alocado nos diários — o histórico do lato sensu deve listar quem '
          + 'efetivamente ministrou o curso, com titulação.',
        gravidade: 'impedimento',
      })
    } else if (!pctOk) {
      pendencias.push({
        artigo: 'Art. 9º',
        descricao: `${pct}% do corpo docente tem título stricto sensu (${comStricto} de ${totalDocentes}); `
          + `o mínimo é ${PCT_MINIMO_STRICTO_SENSU}%.`,
        gravidade: 'impedimento',
      })
    }
    // Titulação em branco é o caso mais comum e o mais silencioso: o docente
    // pode ser mestre e simplesmente não ter o campo preenchido.
    const semTitulacao = userIds.filter((u) => !titPorUser.get(u))
    if (semTitulacao.length) {
      pendencias.push({
        artigo: 'Art. 8º, III',
        descricao: `${semTitulacao.length} docente(s) sem titulação cadastrada — o histórico sairá `
          + 'incompleto e o percentual do art. 9º fica subestimado.',
        gravidade: 'atencao',
      })
    }
  }

  const ato = await atoCredenciamento()
  if (lato) {
    if (!ato) {
      pendencias.push({
        artigo: 'Art. 8º, I',
        descricao: 'Nenhum ato autorizativo de IES cadastrado — o histórico do lato sensu deve trazer '
          + 'o ato legal de credenciamento da instituição.',
        gravidade: 'impedimento',
      })
    } else if (!ato.ehCredenciamento) {
      pendencias.push({
        artigo: 'Art. 8º, I',
        descricao: `Há atos de IES cadastrados, mas nenhum é de credenciamento (o mais recente é `
          + `"${ato.tipo}"). O histórico exige o ato de credenciamento.`,
        gravidade: 'atencao',
      })
    }
  }

  return {
    courseId: curso.id,
    curso: curso.nome,
    ehLatoSensu: lato,
    cargaHoraria: ch,
    chMinimaAtendida: chOk,
    docentes: { total: totalDocentes, strictoSensu: comStricto, percentual: pct, atende: pctOk },
    atoCredenciamento: ato,
    pendencias,
  }
}
