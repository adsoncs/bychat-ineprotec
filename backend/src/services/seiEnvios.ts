// src/services/seiEnvios.ts
//
// QUANDO uma inscrição vai para o SEI — o "como" (pessoa → matrícula →
// documentos) está em seiIntegracao.ts.
//
// Regra de ouro: nada sai para o SEI sem estar APTO, em nenhum modo. Apto =
//   1. portal: todas as etapas concluídas (pagamento, documentos obrigatórios
//      APROVADOS, contrato assinado, análise, redação, dados…), inscrição ativa
//      e, se a instituição quiser, matrícula efetivada;
//   2. cadastro: o que o SEI exige da pessoa (nome completo, CPF válido, e-mail,
//      celular, endereço com CEP) e do responsável financeiro;
//   3. de-para: oferta, polo, condição de pagamento, documentos obrigatórios e
//      contrato com código do SEI;
//   4. SEI (opcional, com a pessoa de teste): o curso tem matrícula on-line
//      ativa e o SEI oferece a unidade, turno, turma, processo e condição do
//      de-para — o mesmo roteiro do envio de verdade.
//
// Modos (Integrações › SEI › Regras de envio — o cliente escolhe):
//   manual      só pela ficha (1 por 1) ou pela lista de prontas (em lote/agendado)
//   automatico  assim que fica apta
//   carencia    apta → agenda para daqui a N horas (dá tempo de reter)
//   programado  nas janelas configuradas (dias da semana + horários), em lote
// Em qualquer modo, o envio manual, em lote e agendado continua disponível, e
// a inscrição RETIDA fica fora do automático e do programado.
//
// Situações do SeiEnvio além das do processamento:
//   AGENDADO   espera proximaTentativaEm (carência ou agendamento manual)
//   RETIDO     a secretaria segurou: nenhum automático mexe
//   BLOQUEADO  entrou na fila mas deixou de estar apta; a varredura reavalia

import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import * as sei from '../lib/seiClient.js'
import { previa, processar, navegarOferta, SeiPendencia, type MapaOferta } from './seiIntegracao.js'
import { combinarMatricula, etapasDaInscricao, lerJornada, MATRICULA_PADRAO } from './portalJornada.js'
import { requisitosQueValem } from './docCondicional.js'

// ── Regras de envio ─────────────────────────────────────────────────────────

export type ModoEnvio = 'manual' | 'automatico' | 'carencia' | 'programado'
export type OrigemEnvio = 'manual' | 'lote' | 'agendado' | 'automatico' | 'programado'

export interface RegrasEnvio {
  modo: ModoEnvio
  /** carencia: horas entre ficar apta e ir para o SEI. */
  carenciaHoras: number
  /** programado: horários "HH:MM" (horário de Brasília). */
  horarios: string[]
  /** programado: dias da semana (0 = domingo … 6 = sábado). */
  diasSemana: number[]
  /** automático/programado: no máximo N inscrições por rodada. */
  loteMaximo: number
  /** automático/programado: só estes portais (vazio = todos). */
  portais: number[]
  /** Exige a matrícula efetivada no ERP do portal (contrato do ERP assinado). */
  exigirEfetivacao: boolean
  /** Confere no SEI, com a pessoa de teste, se a oferta do de-para é aceita. */
  validarNoSei: boolean
  /** Código de uma pessoa de teste no SEI (o NE009 exige uma pessoa). */
  pessoaTeste: string
}

const CHAVE_REGRAS = 'sei.regras_envio'
const CHAVE_JANELA = 'sei.ultima_janela'

export const REGRAS_PADRAO: RegrasEnvio = {
  modo: 'manual',
  carenciaHoras: 24,
  horarios: ['08:00'],
  diasSemana: [1, 2, 3, 4, 5],
  loteMaximo: 50,
  portais: [],
  exigirEfetivacao: false,
  validarNoSei: true,
  pessoaTeste: '',
}

const MODOS: ModoEnvio[] = ['manual', 'automatico', 'carencia', 'programado']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function lerValor(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return null }
}

/** Normaliza o que veio do banco ou da tela: nunca confia no formato. */
export function normalizarRegras(bruto: unknown, base: RegrasEnvio = REGRAS_PADRAO): RegrasEnvio {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<RegrasEnvio>
  const num = (v: unknown, min: number, max: number, padrao: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao
  }
  const horarios = Array.isArray(b.horarios)
    ? [...new Set(b.horarios.map((h) => String(h).trim().padStart(5, '0')).filter((h) => HHMM.test(h)))].sort()
    : base.horarios
  const dias = Array.isArray(b.diasSemana)
    ? [...new Set(b.diasSemana.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : base.diasSemana
  return {
    modo: MODOS.includes(b.modo as ModoEnvio) ? (b.modo as ModoEnvio) : base.modo,
    carenciaHoras: b.carenciaHoras === undefined ? base.carenciaHoras : num(b.carenciaHoras, 1, 720, base.carenciaHoras),
    horarios,
    diasSemana: dias,
    loteMaximo: b.loteMaximo === undefined ? base.loteMaximo : num(b.loteMaximo, 1, 500, base.loteMaximo),
    portais: Array.isArray(b.portais) ? [...new Set(b.portais.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : base.portais,
    exigirEfetivacao: b.exigirEfetivacao === undefined ? base.exigirEfetivacao : !!b.exigirEfetivacao,
    validarNoSei: b.validarNoSei === undefined ? base.validarNoSei : !!b.validarNoSei,
    pessoaTeste: b.pessoaTeste === undefined ? base.pessoaTeste : String(b.pessoaTeste ?? '').trim().slice(0, 40),
  }
}

export async function lerRegras(): Promise<RegrasEnvio> {
  const row = await prisma.setting.findUnique({ where: { key: CHAVE_REGRAS }, select: { value: true } })
  if (row) return normalizarRegras(lerValor(row.value))
  // Antes das regras existia só o liga/desliga "enviar automaticamente".
  const cfg = await sei.getSeiConfig()
  return { ...REGRAS_PADRAO, modo: cfg.autoEnviar ? 'automatico' : 'manual' }
}

export async function salvarRegras(bruto: unknown): Promise<RegrasEnvio> {
  const regras = normalizarRegras(bruto, await lerRegras())
  if (regras.modo === 'programado' && (!regras.horarios.length || !regras.diasSemana.length)) {
    throw new SeiPendencia('No envio programado, escolha ao menos um dia da semana e um horário.')
  }
  const value = JSON.stringify(regras)
  await prisma.setting.upsert({
    where: { key: CHAVE_REGRAS },
    create: { key: CHAVE_REGRAS, value, label: 'Regras de envio ao SEI', grp: 'sei', fieldType: 'json' },
    update: { value },
  })
  return regras
}

// ── Aptidão ─────────────────────────────────────────────────────────────────

export type GrupoChecagem = 'portal' | 'cadastro' | 'depara' | 'sei'
export interface ItemChecagem { grupo: GrupoChecagem; ok: boolean; texto: string }

export interface Elegibilidade {
  registrationId: number
  apto: boolean
  itens: ItemChecagem[]
  bloqueios: string[]
  avisos: string[]
  /** null = não conferido no SEI (desligado, sem pessoa de teste ou pulado). */
  conferidoNoSei: boolean | null
}

const STATUS_FORA = new Set(['cancelled', 'rejected', 'expired', 'merged'])
const ROTULO_STATUS: Record<string, string> = { cancelled: 'cancelada', rejected: 'recusada', expired: 'expirada', merged: 'mesclada em outra' }

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const tem = (v: unknown) => String(v ?? '').trim() !== ''

export function cpfValido(cpf: unknown): boolean {
  const n = so(cpf)
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false
  for (const t of [9, 10]) {
    let soma = 0
    for (let i = 0; i < t; i++) soma += Number(n[i]) * (t + 1 - i)
    const d = ((soma * 10) % 11) % 10
    if (d !== Number(n[t])) return false
  }
  return true
}

const emailValido = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim())

// Conferência no SEI por oferta: o mesmo roteiro para todos os alunos da
// oferta, então guarda o resultado um tempo e não martela o SEI.
const cacheSei = new Map<string, { em: number; ok: boolean; texto: string }>()
const CACHE_SEI_OK_MS = 15 * 60_000
const CACHE_SEI_FALHA_MS = 2 * 60_000

async function conferirNoSei(mapa: MapaOferta, condicao: string, pessoaTeste: string): Promise<{ ok: boolean; texto: string }> {
  const chave = JSON.stringify([mapa, condicao, pessoaTeste])
  const c = cacheSei.get(chave)
  if (c && Date.now() - c.em < (c.ok ? CACHE_SEI_OK_MS : CACHE_SEI_FALHA_MS)) return c
  let r: { ok: boolean; texto: string }
  try {
    const banners: any = await sei.listarBanners()
    const lista = Array.isArray(banners?.banner) ? banners.banner : []
    const ativo = lista.some((b: any) => String(b?.codigoBanner ?? '') === String(mapa.codigoBanner ?? '') && String(b?.curso?.codigo ?? '') === String(mapa.codigoCurso ?? ''))
    if (!ativo) {
      r = { ok: false, texto: `O SEI não tem matrícula on-line ativa para o curso ${mapa.codigoCurso} / banner ${mapa.codigoBanner}.` }
    } else {
      await navegarOferta(mapa, condicao, pessoaTeste)
      r = { ok: true, texto: 'O SEI aceita a oferta do de-para (curso, unidade, turno, turma, processo e condição de pagamento).' }
    }
  } catch (e: any) {
    const transitorio = e instanceof sei.SeiError && e.transitorio
    r = { ok: false, texto: transitorio ? `Não deu para conferir no SEI agora: ${e.message}` : `O SEI recusaria a oferta: ${e?.message || e}` }
  }
  cacheSei.set(chave, { em: Date.now(), ...r })
  return r
}

export function limparCacheConferencia() {
  cacheSei.clear()
}

export async function elegibilidade(registrationId: number, opts: { online?: boolean; regras?: RegrasEnvio } = {}): Promise<Elegibilidade> {
  const regras = opts.regras ?? (await lerRegras())
  const cfg = await sei.getSeiConfig()
  const itens: ItemChecagem[] = []
  const add = (grupo: GrupoChecagem, ok: boolean, texto: string) => itens.push({ grupo, ok, texto })

  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, status: true, mergedIntoId: true, contratoAceite: true, formData: true,
      paymentStatus: true, paymentPaidAt: true,
      portal: { select: { requirePayment: true, jornadaEtapas: true } },
      documents: { select: { typeCode: true, status: true }, orderBy: { uploadedAt: 'desc' } },
      processRegistration: {
        select: {
          offering: { select: { course: { select: { exigeContrato: true, enviarSei: true } } } },
          selectionProcess: {
            select: {
              useCustomDocuments: true,
              documentRequirements: { select: { required: true, condicao: true, documentType: { select: { id: true, code: true, name: true } } } },
              entryMode: { select: { documentRequirements: { select: { required: true, condicao: true, documentType: { select: { id: true, code: true, name: true } } } } } },
            },
          },
        },
      },
    },
  })
  if (!reg) throw new SeiPendencia('Inscrição não encontrada.')

  // 1) Portal
  const fora = reg.mergedIntoId ? 'merged' : STATUS_FORA.has(reg.status) ? reg.status : null
  add('portal', !fora, fora ? `Inscrição ${ROTULO_STATUS[fora] ?? fora}.` : 'Inscrição ativa.')
  // Regras da matrícula do portal (Portais › Etapas): portal fora do SEI não envia,
  // nem pelo botão manual; portal sem contrato não cobra assinatura.
  // Junto com as do curso (Educacional › Cursos): extensão vendida no portal
  // do polo não tem contrato nem vai ao SEI.
  const doPortal = lerJornada(reg.portal?.jornadaEtapas).matricula ?? { ...MATRICULA_PADRAO }
  const curso = reg.processRegistration?.offering?.course
  const regrasPortal = combinarMatricula(doPortal, curso)
  if (!doPortal.enviarSei) add('portal', false, 'Este portal não envia ao SEI (Portais › Etapas › Matrícula).')
  else if (curso?.enviarSei === false) add('portal', false, 'Este curso não envia ao SEI (Educacional › Cursos).')

  // Etapas das duas sequências (inscrição e portal logado): todas concluídas.
  const vistas = new Set<string>()
  for (const onde of ['inscricao', 'painel'] as const) {
    const j = await etapasDaInscricao(registrationId, onde)
    for (const et of j?.etapas ?? []) {
      if (vistas.has(et.chave)) continue
      vistas.add(et.chave)
      add('portal', et.situacao === 'feito', `${et.titulo}: ${et.detalhe}`)
    }
  }
  if (reg.portal?.requirePayment && !vistas.has('pagamento')) {
    add('portal', reg.paymentStatus === 'paid', reg.paymentStatus === 'paid' ? 'Pagamento confirmado.' : 'Pagamento ainda não confirmado.')
  }

  // Documentos obrigatórios: o SEI recebe só os APROVADOS — mesmo no portal em
  // que a etapa "libera no envio", aqui a aprovação da secretaria é exigida.
  const sp = reg.processRegistration?.selectionProcess as any
  const exigidos: Array<{ required: boolean; documentType: { id: number; code: string; name: string } }> = sp
    ? requisitosQueValem(sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? []), reg.formData)
    : []
  const obrigatorios = exigidos.filter((x) => x.required)
  const ultimoPorTipo = new Map<string, string>()
  for (const d of reg.documents) if (!ultimoPorTipo.has(d.typeCode)) ultimoPorTipo.set(d.typeCode, d.status)
  const naoAprovados = obrigatorios.filter((x) => ultimoPorTipo.get(x.documentType.code) !== 'approved')
  // Etapa "Documentos" concluída já diz "aprovados"; a linha extra só aparece
  // quando ela não existe ou quando conclui no envio (sem esperar a aprovação).
  if (obrigatorios.length && (naoAprovados.length || !vistas.has('documentos'))) {
    add('portal', !naoAprovados.length, naoAprovados.length
      ? `Documentos obrigatórios sem aprovação: ${naoAprovados.map((x) => x.documentType.name).join(', ')}.`
      : `Documentos obrigatórios aprovados (${obrigatorios.length}).`)
  }

  // Contrato assinado (no portal ou no ERP).
  const matricula = await prisma.acaMatricula.findFirst({
    where: { enrollmentRegistrationId: registrationId },
    orderBy: { id: 'desc' },
    select: { status: true, contrato: { select: { aceiteEm: true } } },
  })
  const assinou = !!(reg.contratoAceite as any)?.em || !!matricula?.contrato?.aceiteEm
    || !!(await prisma.acaAssinatura.findFirst({ where: { registrationId, status: 'ASSINADO' }, select: { id: true } }))
  if (!vistas.has('contrato') && regrasPortal?.exigeContrato !== false) add('portal', assinou, assinou ? 'Contrato assinado.' : 'Contrato ainda não assinado.')
  if (regras.exigirEfetivacao) {
    const ok = matricula?.status === 'MATRICULADO'
    add('portal', ok, ok ? 'Matrícula efetivada no portal.' : 'Matrícula ainda não efetivada no portal.')
  }

  // 2) Cadastro (o que o SEI exige) e 3) de-para
  const pv = await previa(registrationId)
  const p = pv.pessoa as Record<string, any>
  const nomePartes = String(p.nome ?? '').trim().split(/\s+/).filter(Boolean)
  add('cadastro', nomePartes.length >= 2, nomePartes.length >= 2 ? 'Nome completo.' : 'Falta o nome completo (nome e sobrenome).')
  add('cadastro', cpfValido(p.cpf), cpfValido(p.cpf) ? 'CPF válido.' : tem(p.cpf) ? 'CPF inválido.' : 'Falta o CPF.')
  add('cadastro', emailValido(p.email), emailValido(p.email) ? 'E-mail válido.' : tem(p.email) ? 'E-mail inválido.' : 'Falta o e-mail.')
  const cel = so(p.celular)
  add('cadastro', cel.length >= 10 && cel.length <= 13, cel ? (cel.length >= 10 ? 'Celular informado.' : 'Celular incompleto.') : 'Falta o celular.')
  const faltaEnd = [
    so(p.cep).length !== 8 && 'CEP',
    !tem(p.endereco) && 'logradouro',
    !tem(p.numero) && 'número',
    !tem(p.setor) && 'bairro',
  ].filter(Boolean) as string[]
  add('cadastro', !faltaEnd.length, faltaEnd.length ? `Endereço incompleto: falta ${faltaEnd.join(', ')}.` : 'Endereço completo.')
  const resp = (Array.isArray(p.filiacao) ? p.filiacao : []).find((f: any) => f?.responsavelFinanceiro)
  if (resp) {
    const ok = tem(resp.pais?.nome) && cpfValido(resp.pais?.cpf)
    add('cadastro', ok, ok ? 'Responsável financeiro com nome e CPF válido.' : 'Responsável financeiro sem nome ou com CPF inválido.')
  }

  for (const pend of pv.pendencias) {
    if (pend.startsWith('Aluno sem')) continue // já coberto pelo cadastro acima
    add('depara', false, pend)
  }
  const semMapa = obrigatorios.filter((x) => {
    const d = pv.documentos.find((y) => y.tipo === x.documentType.code)
    return d && !d.codigoTipoDocumentoSei
  })
  if (obrigatorios.length) {
    add('depara', !semMapa.length, semMapa.length
      ? `Documento obrigatório sem tipo do SEI no de-para: ${semMapa.map((x) => x.documentType.name).join(', ')}.`
      : 'Documentos obrigatórios com tipo do SEI no de-para.')
  }
  if (cfg.enviarContrato && regrasPortal?.exigeContrato !== false) {
    add('depara', !!pv.contrato, pv.contrato
      ? 'PDF do contrato assinado encontrado.'
      : 'PDF do contrato assinado não encontrado (o contrato foi só aceito na tela?). Desligue "Enviar o contrato" ou gere o PDF assinado.')
  }
  const avisos = pv.avisos.filter((a) => !semMapa.some((x) => a.includes(`"${x.documentType.name}"`)) && !a.startsWith('Contrato assinado não encontrado'))

  // 4) SEI
  let conferidoNoSei: boolean | null = null
  const semBloqueioAteAqui = itens.every((i) => i.ok)
  if (opts.online && regras.validarNoSei) {
    if (!regras.pessoaTeste) {
      avisos.push('Conferência no SEI desligada: informe a pessoa de teste em Regras de envio.')
    } else if (semBloqueioAteAqui && pv.mapaOferta) {
      const r = await conferirNoSei(pv.mapaOferta, pv.condicaoPagamento, regras.pessoaTeste)
      add('sei', r.ok, r.texto)
      conferidoNoSei = r.ok
    }
  }

  const bloqueios = itens.filter((i) => !i.ok).map((i) => i.texto)
  return { registrationId, apto: bloqueios.length === 0, itens, bloqueios, avisos, conferidoNoSei }
}

// ── Inscrições candidatas (ainda não enviadas) ───────────────────────────────

/** Situações em que a inscrição ainda está "a enviar". */
const AINDA_A_ENVIAR = ['BLOQUEADO', 'RETIDO', 'CANCELADO']

/**
 * Inscrições que podem estar prontas: ativas, dos últimos 12 meses, com
 * contrato aceito ou matrícula no ERP, e sem envio em andamento ou concluído.
 */
async function idsCandidatos(portais: number[] = [], limite = 300): Promise<number[]> {
  const desde = new Date(Date.now() - 365 * 86_400_000)
  // Portais com o envio ao SEI desligado nem entram na lista.
  const foraDoSei = (await prisma.enrollmentPortal.findMany({ select: { id: true, jornadaEtapas: true } }))
    .filter((p) => lerJornada(p.jornadaEtapas).matricula?.enviarSei === false)
    .map((p) => p.id)
  const comMatricula = await prisma.acaMatricula.findMany({
    where: { enrollmentRegistrationId: { not: null }, createdAt: { gte: desde } },
    select: { enrollmentRegistrationId: true },
  })
  const regs = await prisma.enrollmentRegistration.findMany({
    where: {
      createdAt: { gte: desde },
      mergedIntoId: null,
      // Cursos com o envio ao SEI desligado (Educacional › Cursos) também não entram.
      NOT: { processRegistration: { offering: { course: { enviarSei: false } } } },
      status: { notIn: [...STATUS_FORA] },
      ...(portais.length || foraDoSei.length
        ? { portalId: { ...(portais.length ? { in: portais } : {}), ...(foraDoSei.length ? { notIn: foraDoSei } : {}) } }
        : {}),
      OR: [
        { status: { in: ['enrolled', 'approved', 'docs_approved'] } },
        { id: { in: comMatricula.map((m) => m.enrollmentRegistrationId!) } },
        { contratoAceite: { not: Prisma.DbNull } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: limite * 2,
    select: { id: true },
  })
  const envios = await prisma.seiEnvio.findMany({ where: { registrationId: { in: regs.map((r) => r.id) } }, select: { registrationId: true, status: true } })
  const st = new Map(envios.map((e) => [e.registrationId, e.status]))
  return regs.map((r) => r.id).filter((id) => !st.has(id) || AINDA_A_ENVIAR.includes(st.get(id)!)).slice(0, limite)
}

export async function listarCandidatas(opts: { online?: boolean } = {}) {
  const regras = await lerRegras()
  const ids = await idsCandidatos()
  const [regs, envios] = await Promise.all([
    prisma.enrollmentRegistration.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, candidateCode: true, formData: true, updatedAt: true,
        lead: { select: { nome: true } },
        portal: { select: { id: true, nome: true } },
        processRegistration: { select: { offering: { select: { nome: true } } } },
      },
    }),
    prisma.seiEnvio.findMany({ where: { registrationId: { in: ids } } }),
  ])
  const envioDe = new Map(envios.map((e) => [e.registrationId, e]))
  const linhas = []
  for (const r of regs) {
    let el: Elegibilidade | null = null
    let erro: string | null = null
    try { el = await elegibilidade(r.id, { online: opts.online, regras }) } catch (e: any) { erro = e?.message || String(e) }
    const envio = envioDe.get(r.id) ?? null
    linhas.push({
      registrationId: r.id,
      candidateCode: r.candidateCode,
      nome: (r.formData as any)?.nome || r.lead?.nome || null,
      portal: r.portal,
      oferta: r.processRegistration?.offering?.nome ?? null,
      atualizadoEm: r.updatedAt,
      envio: envio ? { id: envio.id, status: envio.status, ultimoErro: envio.ultimoErro } : null,
      apto: !!el?.apto,
      bloqueios: el?.bloqueios ?? (erro ? [erro] : []),
      avisos: el?.avisos ?? [],
      conferidoNoSei: el?.conferidoNoSei ?? null,
    })
  }
  linhas.sort((a, b) => Number(b.apto) - Number(a.apto) || +new Date(b.atualizadoEm) - +new Date(a.atualizadoEm))
  return { regras, linhas }
}

// ── Pôr na fila, agendar, reter, liberar ────────────────────────────────────

const ehAutomatica = (o: OrigemEnvio) => o === 'automatico' || o === 'programado'

/**
 * Põe a inscrição na fila do SEI (agora ou em `quando`). Recusa — com os
 * motivos — se ela não estiver apta. Origem automática respeita RETIDO;
 * manual passa por cima (é a secretaria decidindo).
 */
export async function agendarEnvio(registrationId: number, origem: OrigemEnvio, opts: { userId?: number | null; quando?: Date | null; regras?: RegrasEnvio } = {}) {
  const cfg = await sei.getSeiConfig(true)
  if (!cfg.enabled) throw new SeiPendencia('Ligue a integração com o SEI antes de enviar.')
  const atual = await prisma.seiEnvio.findUnique({ where: { registrationId } })
  if (atual?.status === 'CONCLUIDO') throw new SeiPendencia(`Já enviada ao SEI (matrícula ${atual.matricula ?? '—'}).`)
  if (atual?.status === 'PROCESSANDO') return atual
  if (atual?.status === 'RETIDO' && ehAutomatica(origem)) return null
  // Começou no SEI (já tem pessoa): retomar não depende de aptidão — parar no meio é pior.
  if (!atual?.codigoPessoa) {
    const el = await elegibilidade(registrationId, { online: true, regras: opts.regras })
    if (!el.apto) throw new SeiPendencia(`Ainda não está apta para o SEI: ${el.bloqueios.join(' · ')}`)
  }
  const quando = opts.quando && opts.quando.getTime() > Date.now() + 30_000 ? opts.quando : null
  const status = quando ? 'AGENDADO' : 'PENDENTE'
  const dados = { status, origem, proximaTentativaEm: quando ?? new Date(), ultimoErro: null }
  const envio = await prisma.seiEnvio.upsert({
    where: { registrationId },
    create: { registrationId, criadoPorId: opts.userId ?? null, ...dados },
    update: { ...dados, ...(ehAutomatica(origem) ? {} : { tentativas: 0, criadoPorId: opts.userId ?? atual?.criadoPorId ?? null }) },
  })
  if (status === 'PENDENTE') void processar(envio.id)
  return envio
}

export async function reter(registrationId: number, userId: number | null, motivo: string) {
  const atual = await prisma.seiEnvio.findUnique({ where: { registrationId } })
  if (atual?.status === 'CONCLUIDO') throw new SeiPendencia('Já enviada ao SEI: não há o que reter.')
  if (atual?.status === 'PROCESSANDO') throw new SeiPendencia('O envio está em andamento agora; tente de novo em instantes.')
  const texto = `Retida${motivo ? `: ${motivo.slice(0, 300)}` : ' pela secretaria'}.`
  return prisma.seiEnvio.upsert({
    where: { registrationId },
    create: { registrationId, status: 'RETIDO', origem: 'manual', criadoPorId: userId, ultimoErro: texto, proximaTentativaEm: null },
    update: { status: 'RETIDO', ultimoErro: texto, proximaTentativaEm: null },
  })
}

/** Tira da retenção: volta a valer o modo de envio configurado. */
export async function liberar(registrationId: number) {
  const atual = await prisma.seiEnvio.findUnique({ where: { registrationId } })
  if (!atual || atual.status !== 'RETIDO') return null
  if (atual.codigoPessoa) {
    // Já tinha começado no SEI: retoma de onde parou.
    const e = await prisma.seiEnvio.update({ where: { id: atual.id }, data: { status: 'PENDENTE', ultimoErro: null, proximaTentativaEm: new Date() } })
    void processar(e.id)
    return e
  }
  await prisma.seiEnvio.delete({ where: { id: atual.id } })
  void tentarAutomatico(registrationId).catch(() => {})
  return null
}

// ── Automático, carência e programado ───────────────────────────────────────

/** Uma inscrição: põe na fila se o modo for automático e ela estiver apta. */
async function tentarAutomatico(registrationId: number, regras?: RegrasEnvio) {
  const r = regras ?? (await lerRegras())
  const cfg = await sei.getSeiConfig()
  if (!cfg.enabled || !cfg.baseUrl) return null
  if (r.modo !== 'automatico' && r.modo !== 'carencia') return null
  if (r.portais.length) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portalId: true } })
    if (!reg || !r.portais.includes(reg.portalId)) return null
  }
  const quando = r.modo === 'carencia' ? new Date(Date.now() + r.carenciaHoras * 3_600_000) : null
  try {
    return await agendarEnvio(registrationId, 'automatico', { quando, regras: r })
  } catch (e) {
    if (e instanceof SeiPendencia) return null // ainda não apta: a varredura reavalia
    throw e
  }
}

/** Varre as candidatas e põe na fila as aptas (até o lote máximo). */
export async function varrer(origem: 'automatico' | 'programado', regras: RegrasEnvio) {
  const ids = await idsCandidatos(regras.portais)
  const atuais = await prisma.seiEnvio.findMany({ where: { registrationId: { in: ids } }, select: { registrationId: true, status: true } })
  // Retidas e canceladas pela secretaria ficam de fora do automático.
  const fora = new Set(atuais.filter((a) => a.status === 'RETIDO' || a.status === 'CANCELADO').map((a) => a.registrationId))
  const quando = origem === 'automatico' && regras.modo === 'carencia' ? new Date(Date.now() + regras.carenciaHoras * 3_600_000) : null
  let postas = 0
  for (const id of ids) {
    if (postas >= regras.loteMaximo) break
    if (fora.has(id)) continue
    try {
      const el = await elegibilidade(id, { online: true, regras })
      if (!el.apto) continue
      const e = await agendarEnvio(id, origem, { quando, regras })
      if (e) postas++
    } catch (err: any) {
      if (!(err instanceof SeiPendencia)) console.warn(`[sei] varredura ${origem} inscrição ${id}:`, err?.message || err)
    }
  }
  return postas
}

/** Agora no horário de Brasília: data, HH:MM e dia da semana. */
function agoraBrasilia(d = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(d).map((p) => [p.type, p.value]),
  )
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday)
  return { data: `${partes.year}-${partes.month}-${partes.day}`, hhmm: `${partes.hour}:${partes.minute}`, dia }
}

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Janela programada que venceu agora (até 60 min de atraso) e ainda não rodou. */
async function janelaVencida(regras: RegrasEnvio): Promise<string | null> {
  const agora = agoraBrasilia()
  if (!regras.diasSemana.includes(agora.dia)) return null
  const vencidas = regras.horarios.filter((h) => {
    const atraso = minutos(agora.hhmm) - minutos(h)
    return atraso >= 0 && atraso <= 60
  })
  if (!vencidas.length) return null
  const chave = `${agora.data} ${vencidas[vencidas.length - 1]}`
  const ultima = await prisma.setting.findUnique({ where: { key: CHAVE_JANELA }, select: { value: true } })
  const ultimaTxt = String(lerValor(ultima?.value) ?? ultima?.value ?? '')
  return ultimaTxt >= chave ? null : chave
}

/** Próximas janelas do envio programado (para a tela). */
export function proximasJanelas(regras: RegrasEnvio, n = 3): string[] {
  if (regras.modo !== 'programado') return []
  const out: string[] = []
  const agora = agoraBrasilia()
  for (let d = 0; d <= 8 && out.length < n; d++) {
    const dia = agoraBrasilia(new Date(Date.now() + d * 86_400_000))
    if (!regras.diasSemana.includes(dia.dia)) continue
    for (const h of regras.horarios) {
      if (d === 0 && minutos(h) <= minutos(agora.hhmm)) continue
      out.push(`${dia.data.split('-').reverse().join('/')} ${h}`)
      if (out.length >= n) break
    }
  }
  return out
}

let timer: NodeJS.Timeout | null = null
let rodando = false
let ultimaVarredura = 0
const VARREDURA_MS = 10 * 60_000

async function tick() {
  if (rodando) return
  rodando = true
  try {
    const cfg = await sei.getSeiConfig()
    if (!cfg.enabled || !cfg.baseUrl) return
    const regras = await lerRegras()

    // Envio preso em PROCESSANDO (servidor reiniciou no meio): volta para a fila.
    await prisma.seiEnvio.updateMany({
      where: { status: 'PROCESSANDO', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { status: 'PENDENTE', proximaTentativaEm: new Date() },
    })
    // Agendado que venceu (carência ou agendamento manual) entra na fila.
    await prisma.seiEnvio.updateMany({
      where: { status: 'AGENDADO', proximaTentativaEm: { lte: new Date() } },
      data: { status: 'PENDENTE' },
    })

    if ((regras.modo === 'automatico' || regras.modo === 'carencia') && Date.now() - ultimaVarredura >= VARREDURA_MS) {
      ultimaVarredura = Date.now()
      const n = await varrer('automatico', regras)
      if (n) console.log(`[sei] ${n} inscrição(ões) apta(s) posta(s) na fila (${regras.modo}).`)
    }
    if (regras.modo === 'programado') {
      const janela = await janelaVencida(regras)
      if (janela) {
        await prisma.setting.upsert({
          where: { key: CHAVE_JANELA },
          create: { key: CHAVE_JANELA, value: janela, label: 'Última janela de envio ao SEI', grp: 'sei', fieldType: 'text' },
          update: { value: janela },
        })
        const n = await varrer('programado', regras)
        console.log(`[sei] janela ${janela}: ${n} inscrição(ões) enviada(s).`)
      }
    }

    // BLOQUEADO que voltou a ficar apto (documento reaprovado, de-para feito…).
    const bloqueados = await prisma.seiEnvio.findMany({
      where: { status: 'BLOQUEADO', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      take: 20, select: { id: true, registrationId: true },
    })
    for (const b of bloqueados) {
      const el = await elegibilidade(b.registrationId, { online: false, regras }).catch(() => null)
      await prisma.seiEnvio.update({
        where: { id: b.id },
        data: el?.apto ? { status: 'PENDENTE', ultimoErro: null, proximaTentativaEm: new Date() } : { ultimoErro: `Ainda não está apta para o SEI: ${el?.bloqueios.join(' · ') ?? '—'}` },
      })
    }

    const prontos = await prisma.seiEnvio.findMany({
      where: { status: 'PENDENTE', proximaTentativaEm: { lte: new Date() } },
      orderBy: { proximaTentativaEm: 'asc' },
      take: 10,
      select: { id: true },
    })
    for (const p of prontos) await processar(p.id)
  } catch (e: any) {
    console.warn('[sei] agendador:', e?.message || e)
  } finally {
    rodando = false
  }
}

export function iniciarAgendadorSei() {
  if (timer) return
  timer = setInterval(() => { void tick() }, 60_000)
  // Matrícula efetivada (contrato assinado) → no automático, tenta na hora.
  eventBus.on('matricula.efetivada', async (ev: any) => {
    try {
      const registrationId = Number(ev?.payload?.registrationId)
      if (registrationId) await tentarAutomatico(registrationId)
    } catch (e: any) {
      console.warn('[sei] gatilho matricula.efetivada:', e?.message || e)
    }
  })
}
