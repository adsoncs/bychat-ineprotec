// src/services/pacoteMatricula.ts
//
// Matrícula em PACOTE (combo): dois ou mais cursos da mesma pessoa, cada um com
// a sua inscrição, o seu valor e o seu contrato, mas com UM pagamento só.
//
// - A inscrição PRINCIPAL concentra o financeiro (checkout, combinado, baixa
//   manual) com o valor de todos os cursos.
// - Cada MEMBRO guarda só a parte dele no pacote; não gera cobrança própria e
//   fica "paga pelo pacote" quando a principal recebe o 1º pagamento.
// - Contrato, AVA, documentos e funil seguem por inscrição, como sempre.
//
// Fica em paymentPlan.pacote (JSON): nada muda em quem não usa pacote.
// Pedido do cliente (ineprotec, 18/11/2026: Maycon, Fundamental + Médio).

import { prisma } from '../lib/prisma.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

export interface MembroDoPacote { id: number; codigo: string; curso: string; valorCentavos: number }
export interface PacotePrincipal { papel: 'principal'; valorProprioCentavos: number; membros: MembroDoPacote[]; em: string; por: string | null }
export interface PacoteMembro { papel: 'membro'; principalId: number; principalCodigo: string; principalCurso: string; valorCentavos: number; em: string; por: string | null }
export type Pacote = PacotePrincipal | PacoteMembro

const FECHADAS = ['cancelled', 'transferred', 'merged', 'expired']
type Operador = { userId?: number | null; nome?: string | null }
type Resultado = { ok: true } | { ok: false; status: number; erro: string }

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function pacoteDo(paymentPlan: unknown): Pacote | null {
  const p = (paymentPlan as any)?.pacote
  if (!p || typeof p !== 'object') return null
  if (p.papel === 'principal' && Array.isArray(p.membros)) return p as PacotePrincipal
  if (p.papel === 'membro' && Number(p.principalId) > 0) return p as PacoteMembro
  return null
}

export async function pacoteDaInscricao(registrationId: number): Promise<Pacote | null> {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  return r ? pacoteDo(r.paymentPlan) : null
}

/** Mensagem de bloqueio quando a inscrição é membro: o pagamento é na principal. */
export async function bloqueioDePagamento(registrationId: number): Promise<string | null> {
  const p = await pacoteDaInscricao(registrationId)
  return p?.papel === 'membro'
    ? `Este curso faz parte do pacote ${p.principalCodigo}: o pagamento é feito por essa inscrição, uma vez só para todos os cursos.`
    : null
}

async function cursoDa(registrationId: number): Promise<string> {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { formData: true, processRegistration: { select: { offering: { select: { nome: true } } } } },
  })
  return r?.processRegistration?.offering?.nome ?? String((r?.formData as any)?.offeringNome ?? 'Curso')
}

const mesmaPessoa = (a: any, b: any) => {
  if (a.leadId && a.leadId === b.leadId) return true
  const cpf = (r: any) => String(r.formData?.cpf ?? '').replace(/\D/g, '')
  return cpf(a).length === 11 && cpf(a) === cpf(b)
}

/**
 * Liga `membroId` ao pacote de `principalId`. Os valores são em centavos: o do
 * membro é a parte dele; `valorPrincipalCentavos` (opcional) a parte da
 * principal — sem ele, vale o que já estava gravado.
 */
export async function adicionarAoPacote(principalId: number, membroId: number, valores: { valorMembroCentavos: number; valorPrincipalCentavos?: number | null }, op: Operador): Promise<Resultado> {
  if (principalId === membroId) return { ok: false, status: 400, erro: 'Escolha outra inscrição para o pacote.' }
  const vm = Math.round(Number(valores.valorMembroCentavos))
  if (!Number.isFinite(vm) || vm <= 0) return { ok: false, status: 400, erro: 'Informe o valor deste curso no pacote.' }
  const sel = { id: true, candidateCode: true, status: true, leadId: true, formData: true, paymentPlan: true, paymentStatus: true, paymentId: true, portalId: true } as const
  const [pri, mem] = await Promise.all([
    prisma.enrollmentRegistration.findUnique({ where: { id: principalId }, select: sel }),
    prisma.enrollmentRegistration.findUnique({ where: { id: membroId }, select: sel }),
  ])
  if (!pri || !mem) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (FECHADAS.includes(pri.status) || FECHADAS.includes(mem.status)) return { ok: false, status: 409, erro: 'As duas inscrições precisam estar ativas.' }
  if (!mesmaPessoa(pri, mem)) return { ok: false, status: 409, erro: 'O pacote só junta inscrições da mesma pessoa (mesma ficha ou mesmo CPF).' }
  const pp = pacoteDo(pri.paymentPlan), pm = pacoteDo(mem.paymentPlan)
  if (pp?.papel === 'membro') return { ok: false, status: 409, erro: `${pri.candidateCode} já faz parte do pacote ${pp.principalCodigo}: adicione o curso por lá.` }
  if (pm) return { ok: false, status: 409, erro: `${mem.candidateCode} já está em um pacote.` }
  // O membro não pode ter pagamento próprio: senão o aluno pagaria duas vezes.
  if (mem.paymentStatus === 'paid' || mem.paymentId) return { ok: false, status: 409, erro: `${mem.candidateCode} já tem cobrança ou pagamento próprio. Cancele a cobrança dela antes de pôr no pacote.` }
  const titulos = await prisma.enrollmentTitulo.count({ where: { registrationId: membroId, status: { notIn: ['cancelada', 'substituida'] } } })
  if (titulos) return { ok: false, status: 409, erro: `${mem.candidateCode} já tem financeiro próprio. Desfaça-o antes de pôr no pacote.` }

  const agora = new Date().toISOString()
  const curMem = await cursoDa(membroId), curPri = await cursoDa(principalId)
  const membros = [...(pp?.papel === 'principal' ? pp.membros : []), { id: membroId, codigo: mem.candidateCode, curso: curMem, valorCentavos: vm }]
  const vp = valores.valorPrincipalCentavos != null ? Math.round(Number(valores.valorPrincipalCentavos)) : (pp?.papel === 'principal' ? pp.valorProprioCentavos : 0)
  const principal: PacotePrincipal = { papel: 'principal', valorProprioCentavos: Math.max(0, vp), membros, em: pp?.papel === 'principal' ? pp.em : agora, por: op.nome ?? null }
  const membro: PacoteMembro = { papel: 'membro', principalId, principalCodigo: pri.candidateCode, principalCurso: curPri, valorCentavos: vm, em: agora, por: op.nome ?? null }
  await prisma.$transaction([
    prisma.enrollmentRegistration.update({ where: { id: principalId }, data: { paymentPlan: { ...((pri.paymentPlan as any) ?? {}), pacote: principal } as any } }),
    prisma.enrollmentRegistration.update({ where: { id: membroId }, data: { paymentPlan: { ...((mem.paymentPlan as any) ?? {}), pacote: membro } as any } }),
  ])
  const dados = { principal: pri.candidateCode, membro: mem.candidateCode, curso: curMem, valor: brl(vm), valorPrincipal: brl(principal.valorProprioCentavos) }
  await registrarEventoDaInscricao({ registrationId: principalId, etapa: 'pagamento', acao: 'pacote_curso_adicionado', ator: 'atendente', userId: op.userId ?? null, userName: op.nome ?? null, dados })
  await registrarEventoDaInscricao({ registrationId: membroId, etapa: 'pagamento', acao: 'pacote_entrou', ator: 'atendente', userId: op.userId ?? null, userName: op.nome ?? null, dados })
  // Principal já paga: o membro fica pago na hora.
  await propagarPagamentoDoPacote(principalId)
  // Documentos já enviados em qualquer um dos cursos valem para o outro.
  await sincronizarDocumentosDoPacote(principalId).catch((e) => console.warn('[pacote] documentos:', e?.message || e))
  return { ok: true }
}

/** Tira um curso do pacote — só enquanto o pacote não recebeu nada. */
export async function removerDoPacote(membroId: number, op: Operador): Promise<Resultado> {
  const mem = await prisma.enrollmentRegistration.findUnique({ where: { id: membroId }, select: { candidateCode: true, paymentPlan: true, paymentMethod: true } })
  const pm = mem ? pacoteDo(mem.paymentPlan) : null
  if (!mem || pm?.papel !== 'membro') return { ok: false, status: 404, erro: 'Esta inscrição não está em um pacote.' }
  if (mem.paymentMethod === 'PACOTE') return { ok: false, status: 409, erro: 'O pacote já recebeu pagamento: este curso não pode sair dele. Fale com o Financeiro.' }
  const pri = await prisma.enrollmentRegistration.findUnique({ where: { id: pm.principalId }, select: { paymentPlan: true } })
  const pp = pri ? pacoteDo(pri.paymentPlan) : null
  const { pacote: _m, ...restoM } = (mem.paymentPlan as any) ?? {}
  const ops: any[] = [prisma.enrollmentRegistration.update({ where: { id: membroId }, data: { paymentPlan: restoM as any } })]
  if (pri && pp?.papel === 'principal') {
    const membros = pp.membros.filter((m) => m.id !== membroId)
    const { pacote: _p, ...restoP } = (pri.paymentPlan as any) ?? {}
    ops.push(prisma.enrollmentRegistration.update({ where: { id: pm.principalId }, data: { paymentPlan: (membros.length ? { ...restoP, pacote: { ...pp, membros } } : restoP) as any } }))
  }
  await prisma.$transaction(ops)
  await registrarEventoDaInscricao({ registrationId: pm.principalId, etapa: 'pagamento', acao: 'pacote_curso_removido', ator: 'atendente', userId: op.userId ?? null, userName: op.nome ?? null, dados: { membro: mem.candidateCode } })
  await registrarEventoDaInscricao({ registrationId: membroId, etapa: 'pagamento', acao: 'pacote_saiu', ator: 'atendente', userId: op.userId ?? null, userName: op.nome ?? null, dados: { principal: pm.principalCodigo } })
  return { ok: true }
}

/**
 * A principal recebeu o 1º pagamento: cada membro fica pago (uma vez só) e
 * segue os mesmos efeitos de um pagamento confirmado — funil, eventos para os
 * fluxos, AVA (pelo agendador, com o contrato dele assinado).
 * Chamado por enrollmentNotify.sendPaymentConfirmation, que todo caminho de
 * pagamento já chama (checkout, combinado, baixa manual, cupom, transferência).
 */
export async function propagarPagamentoDoPacote(principalId: number): Promise<number> {
  const pri = await prisma.enrollmentRegistration.findUnique({ where: { id: principalId }, select: { candidateCode: true, paymentPlan: true, paymentStatus: true, paymentPaidAt: true, status: true } })
  const pp = pri ? pacoteDo(pri.paymentPlan) : null
  if (!pri || pp?.papel !== 'principal' || pri.paymentStatus !== 'paid' || FECHADAS.includes(pri.status)) return 0
  let n = 0
  for (const m of pp.membros) {
    const r = await prisma.enrollmentRegistration.updateMany({
      where: { id: m.id, status: { notIn: FECHADAS }, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
      data: { paymentStatus: 'paid', paymentPaidAt: pri.paymentPaidAt ?? new Date(), paymentMethod: 'PACOTE', status: 'paid' },
    })
    if (r.count !== 1) continue
    n++
    await registrarEventoDaInscricao({ registrationId: m.id, etapa: 'pagamento', acao: 'pago_pelo_pacote', ator: 'sistema', dados: { principal: pri.candidateCode, valor: brl(m.valorCentavos) } })
    await import('./funilDaJornada.js').then((f) => f.sincronizarFunil(m.id)).catch(() => {})
    await import('./enrollmentNotify.js').then((x) => x.sendPaymentConfirmation?.({ enrollmentId: m.id })).catch(() => {})
  }
  return n
}

/** Resumo para as telas (painel e portal do aluno). */
export async function resumoDoPacote(registrationId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { id: true, candidateCode: true, paymentPlan: true, paymentStatus: true } })
  const p = r ? pacoteDo(r.paymentPlan) : null
  if (!r || !p) return null
  if (p.papel === 'principal') {
    const total = p.valorProprioCentavos + p.membros.reduce((s, m) => s + m.valorCentavos, 0)
    const sit = await prisma.enrollmentRegistration.findMany({ where: { id: { in: p.membros.map((m) => m.id) } }, select: { id: true, paymentStatus: true, status: true } })
    return {
      papel: 'principal' as const, codigo: r.candidateCode, curso: await cursoDa(r.id), valorProprioCentavos: p.valorProprioCentavos, totalCentavos: total,
      membros: p.membros.map((m) => ({ ...m, pago: sit.find((s) => s.id === m.id)?.paymentStatus === 'paid', status: sit.find((s) => s.id === m.id)?.status ?? null })),
    }
  }
  const pri = await prisma.enrollmentRegistration.findUnique({ where: { id: p.principalId }, select: { paymentPlan: true, paymentStatus: true, portalId: true } })
  const pp = pri ? pacoteDo(pri.paymentPlan) : null
  const total = pp?.papel === 'principal' ? pp.valorProprioCentavos + pp.membros.reduce((s, m) => s + m.valorCentavos, 0) : null
  return { papel: 'membro' as const, codigo: r.candidateCode, principalId: p.principalId, principalPortalId: pri?.portalId ?? null, principalCodigo: p.principalCodigo, principalCurso: p.principalCurso, valorCentavos: p.valorCentavos, totalCentavos: total, pago: r.paymentStatus === 'paid' }
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/**
 * Outras inscrições ativas da MESMA PESSOA: na mesma ficha ou em outra ficha
 * com o mesmo CPF (só CPF: telefone e e-mail se repetem entre parentes).
 * Alimenta o aviso do topo da inscrição e a lista do pacote.
 */
export async function outrasDaPessoa(registrationId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true, formData: true } })
  if (!r) return []
  const cpf = soDigitos((r.formData as any)?.cpf)
  const porCpf: number[] = cpf.length === 11
    ? (await prisma.$queryRawUnsafe<Array<{ id: number }>>(
        "SELECT id FROM bychat_enrollment_registrations WHERE id <> ? AND mergedIntoId IS NULL AND REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(formData, '$.cpf')), '[^0-9]', '') = ?",
        registrationId, cpf)).map((x) => Number(x.id))
    : []
  const outras = await prisma.enrollmentRegistration.findMany({
    where: { id: { not: registrationId }, status: { notIn: FECHADAS }, mergedIntoId: null, OR: [...(r.leadId ? [{ leadId: r.leadId }] : []), { id: { in: porCpf } }] },
    select: { id: true, candidateCode: true, portalId: true, leadId: true, status: true, paymentPlan: true, paymentStatus: true, paymentId: true, createdAt: true,
      portal: { select: { nome: true } }, processRegistration: { select: { offering: { select: { nome: true } } } } },
    orderBy: { createdAt: 'asc' },
  })
  const doPacote = new Set(await inscricoesDoPacote(registrationId))
  return outras.map((o) => ({
    id: o.id, codigo: o.candidateCode, curso: o.processRegistration?.offering?.nome ?? 'Curso', portalId: o.portalId, portal: o.portal?.nome ?? null,
    mesmaFicha: !!r.leadId && o.leadId === r.leadId, leadId: o.leadId, noMesmoPacote: doPacote.has(o.id),
    pago: o.paymentStatus === 'paid', status: o.status,
    impedimento: pacoteDo(o.paymentPlan) ? 'Já está em um pacote' : (o.paymentStatus === 'paid' || o.paymentId) ? 'Tem cobrança ou pagamento próprio' : null,
  }))
}

/** Outras inscrições da mesma pessoa que podem entrar no pacote desta (mesma ficha ou mesmo CPF). */
export async function candidatasAoPacote(registrationId: number) {
  return (await outrasDaPessoa(registrationId)).filter((o) => !o.noMesmoPacote)
    .map((o) => ({ id: o.id, codigo: o.codigo, curso: o.curso, mesmaFicha: o.mesmaFicha, impedimento: o.impedimento }))
}

/**
 * Condição do contrato de uma inscrição do pacote: o valor é a parte do curso;
 * a forma diz que o pagamento é único, pela principal. Null = sem pacote.
 */
export async function condicaoDoContratoNoPacote(registrationId: number): Promise<{ valorTotalCentavos: number; numParcelas: number; valorParcelaCentavos: number; forma: string } | null> {
  const res = await resumoDoPacote(registrationId)
  if (!res) return null
  const principalId = res.papel === 'principal' ? registrationId : res.principalId
  const parte = res.papel === 'principal' ? res.valorProprioCentavos : res.valorCentavos
  const total = res.totalCentavos ?? parte
  const titulos = await prisma.enrollmentTitulo.findMany({ where: { registrationId: principalId, origem: 'combinado', status: { notIn: ['cancelada', 'substituida'] } }, select: { valorCentavos: true } })
  const n = titulos.length || 1
  const codigos = res.papel === 'principal' ? [res.codigo, ...res.membros.map((m) => m.codigo)] : [res.principalCodigo, res.codigo]
  const forma = `Curso contratado em pacote (inscrições ${codigos.join(', ')}), com pagamento único de ${brl(total)} pela inscrição ${res.papel === 'principal' ? res.codigo : res.principalCodigo}`
    + (n > 1 ? `, em ${n} parcelas. Parte deste curso no pacote: ${brl(parte)}.` : `. Parte deste curso no pacote: ${brl(parte)}.`)
  return { valorTotalCentavos: parte, numParcelas: n, valorParcelaCentavos: Math.round(parte / n), forma }
}

// ── Documentos do pacote ────────────────────────────────────────────────────
//
// Os cursos do pacote são da mesma pessoa: RG, CPF, histórico… são os mesmos.
// Cada documento enviado numa inscrição vale para as outras do pacote que pedem
// aquele tipo (cópia do arquivo, como na transferência), e a revisão da
// secretaria (aprovado/recusado) e a análise da IA seguem para as cópias.
// Mesmo documento = mesmo tipo + mesmo arquivo (nome e tamanho, frente e verso).

const assinaturaDoc = (d: { typeCode: string; fileName: string; sizeBytes: number; versoSizeBytes: number | null }) =>
  `${d.typeCode}|${d.fileName}|${d.sizeBytes}|${d.versoSizeBytes ?? 0}`
const CAMPOS_DA_REVISAO = ['status', 'reviewNote', 'reviewedBy', 'reviewedAt', 'aiStatus', 'aiSuggestion', 'aiConfidence', 'aiAnalysis', 'aiCostUsd', 'aiProcessedAt'] as const

/** Ids das inscrições ativas do pacote desta (vazio = sem pacote). */
export async function inscricoesDoPacote(registrationId: number): Promise<number[]> {
  const p = await pacoteDaInscricao(registrationId)
  if (!p) return []
  const principalId = p.papel === 'principal' ? registrationId : p.principalId
  const pri = p.papel === 'principal' ? p : pacoteDo((await prisma.enrollmentRegistration.findUnique({ where: { id: principalId }, select: { paymentPlan: true } }))?.paymentPlan)
  if (pri?.papel !== 'principal') return []
  const ids = [principalId, ...pri.membros.map((m) => m.id)]
  const ativas = await prisma.enrollmentRegistration.findMany({ where: { id: { in: ids }, status: { notIn: FECHADAS }, mergedIntoId: null }, select: { id: true } })
  return ativas.map((a) => a.id)
}

/** Aproveita os documentos entre as inscrições do pacote. Devolve quantos copiou/atualizou. */
export async function sincronizarDocumentosDoPacote(registrationId: number): Promise<{ copiados: number; atualizados: number }> {
  const ids = await inscricoesDoPacote(registrationId)
  if (ids.length < 2) return { copiados: 0, atualizados: 0 }
  const { exigidosDoProcesso, copiarArquivo } = await import('./transferenciaCurso.js')
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { id: { in: ids } },
    select: { id: true, formData: true, processRegistration: { select: { selectionProcessId: true } }, documents: { orderBy: { uploadedAt: 'desc' } } },
  })
  const todos = regs.flatMap((r) => r.documents)
  let copiados = 0, atualizados = 0

  // 1) Revisão: entre cópias do mesmo documento, vale a mais recente.
  const porAssinatura = new Map<string, typeof todos>()
  for (const d of todos) porAssinatura.set(assinaturaDoc(d), [...(porAssinatura.get(assinaturaDoc(d)) ?? []), d])
  const marco = (d: (typeof todos)[number]) => Math.max(d.reviewedAt?.getTime() ?? 0, d.aiProcessedAt?.getTime() ?? 0)
  for (const grupo of porAssinatura.values()) {
    if (grupo.length < 2) continue
    const fonte = [...grupo].sort((a, b) => marco(b) - marco(a))[0]
    if (!marco(fonte)) continue
    for (const d of grupo) {
      if (d.id === fonte.id) continue
      const muda = CAMPOS_DA_REVISAO.some((k) => JSON.stringify((d as any)[k] ?? null) !== JSON.stringify((fonte as any)[k] ?? null))
      if (!muda) continue
      const data: Record<string, unknown> = {}
      for (const k of CAMPOS_DA_REVISAO) data[k] = (fonte as any)[k] ?? null
      await prisma.enrollmentDocument.update({ where: { id: d.id }, data: data as any })
      atualizados++
    }
  }

  // 2) Cópia: o documento mais recente de cada tipo vai para quem pede o tipo e não tem ele.
  const ultimoPorTipo = new Map<string, (typeof todos)[number]>()
  for (const d of [...todos].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())) if (!ultimoPorTipo.has(d.typeCode)) ultimoPorTipo.set(d.typeCode, d)
  for (const r of regs) {
    const sp = r.processRegistration?.selectionProcessId
    const pede = new Set(sp ? (await exigidosDoProcesso(sp, r.formData)).map((e) => e.documentType.code) : [])
    for (const [tipo, fonte] of ultimoPorTipo) {
      if (!pede.has(tipo) || fonte.registrationId === r.id) continue
      if (r.documents.some((d) => assinaturaDoc(d) === assinaturaDoc(fonte))) continue
      // Ela já tem um envio mais novo desse tipo: não volta para o antigo.
      const meu = r.documents.find((d) => d.typeCode === tipo)
      if (meu && meu.uploadedAt > fonte.uploadedAt) continue
      const url = await copiarArquivo(fonte.fileUrl, r.id)
      if (!url) continue
      const verso = fonte.versoFileUrl ? await copiarArquivo(fonte.versoFileUrl, r.id) : null
      const { id: _id, registrationId: _r, fileUrl: _f, versoFileUrl: _v, ...resto } = fonte as any
      const dados: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(resto)) if (v !== null && v !== undefined) dados[k] = v
      // A IA não roda de novo na cópia: o resultado vem da original (passo 1).
      if (dados.aiStatus === 'pending' || dados.aiStatus === 'processing') dados.aiStatus = 'skipped'
      await prisma.enrollmentDocument.create({ data: { ...(dados as any), registrationId: r.id, fileUrl: url, ...(verso ? { versoFileUrl: verso } : {}) } })
      copiados++
      await registrarEventoDaInscricao({ registrationId: r.id, etapa: 'documentos', acao: 'documento_do_pacote', ator: 'sistema', dados: { tipo, nome: fonte.label, de: fonte.registrationId } })
    }
  }
  if (copiados || atualizados) {
    for (const id of ids) await import('./funilDaJornada.js').then((f) => f.sincronizarFunil(id)).catch(() => {})
  }
  return { copiados, atualizados }
}

/** Rede de segurança: revisões feitas por caminhos sem gancho (lote, IA, análise). */
export async function varrerDocumentosDosPacotes(): Promise<number> {
  const principais = await prisma.enrollmentRegistration.findMany({
    where: { status: { notIn: FECHADAS }, paymentPlan: { path: '$.pacote.papel', equals: 'principal' } },
    select: { id: true },
  })
  let n = 0
  for (const p of principais) {
    const r = await sincronizarDocumentosDoPacote(p.id).catch(() => ({ copiados: 0, atualizados: 0 }))
    n += r.copiados + r.atualizados
  }
  return n
}

let agendadorDocs: NodeJS.Timeout | null = null
export function iniciarAgendadorDocumentosDoPacote() {
  if (agendadorDocs) return
  agendadorDocs = setInterval(() => { void varrerDocumentosDosPacotes().catch(() => {}) }, 5 * 60_000)
}
