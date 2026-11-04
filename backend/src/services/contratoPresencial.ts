// services/contratoPresencial.ts
//
// Contrato assinado NO PAPEL (03/11/2026). O candidato assina a via impressa na
// secretaria/polo e a equipe registra a via digitalizada. Não é o agente
// "assinando pelo candidato": é o registro de uma assinatura que aconteceu, com
// o documento como prova — por isso exige o arquivo, o nome de quem assinou e
// a data, e tem permissão própria ("Contrato assinado no papel", só admin herda).
//
// Entra pelo MESMO caminho das assinaturas eletrônicas: um envelope (AcaAssinatura)
// com provider 'PRESENCIAL' e o PDF digitalizado. Ao fechar, o envelope faz o
// que os outros fazem (acaAssinatura.recompute): grava o aceite da inscrição
// (etapa Contrato concluída), efetiva a matrícula quando houver e arquiva no GED.

import { prisma } from '../lib/prisma.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

const EXTS = ['pdf', 'jpg', 'jpeg', 'png']

/** Foto do contrato (JPG/PNG) vira PDF de uma página por imagem — o GED e a matrícula esperam PDF. */
async function imagemEmPdf(buf: Buffer): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({ size: 'A4', margin: 24, autoFirstPage: true })
  const partes: Buffer[] = []
  doc.on('data', (c: Buffer) => partes.push(c))
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))))
  doc.image(buf, 24, 24, { fit: [doc.page.width - 48, doc.page.height - 48], align: 'center', valign: 'center' })
  doc.end()
  return fim
}

export async function registrarContratoPresencial(p: {
  registrationId: number
  assinadoPor: string
  assinadoEm: Date
  observacao: string
  pdf: Buffer
  nomeArquivo: string
  usuario: { id: number; nome: string }
  req?: any
}): Promise<{ ok: true; envelopeId: number } | { ok: false; status: number; erro: string }> {
  const nome = String(p.assinadoPor || '').trim()
  if (nome.length < 5 || !nome.includes(' ')) return { ok: false, status: 400, erro: 'Informe o nome completo de quem assinou o contrato.' }
  if (!(p.assinadoEm instanceof Date) || isNaN(p.assinadoEm.getTime())) return { ok: false, status: 400, erro: 'Informe a data em que o contrato foi assinado.' }

  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: p.registrationId },
    select: {
      id: true, leadId: true, candidateCode: true, status: true, contratoAceite: true, formData: true,
      lead: { select: { email: true } },
      processRegistration: { select: { offering: { select: { id: true, course: { select: { exigeContrato: true } } } } } },
    },
  })
  if (!reg) return { ok: false, status: 404, erro: 'Inscrição não encontrada' }
  if (['cancelled', 'merged', 'expired'].includes(reg.status)) return { ok: false, status: 409, erro: 'Inscrição cancelada, expirada ou mesclada.' }
  if (!reg.processRegistration?.offering) return { ok: false, status: 409, erro: 'A inscrição ainda não tem curso escolhido — não há contrato a registrar.' }
  if (reg.processRegistration.offering.course?.exigeContrato === false) return { ok: false, status: 409, erro: 'Este curso não exige contrato.' }
  if ((reg.contratoAceite as any)?.em) return { ok: false, status: 409, erro: 'O contrato desta inscrição já está assinado.' }

  const { envelopeDaInscricao } = await import('./contratoDoPortal.js')
  const svc = await import('./acaAssinatura.js')
  const atual = await envelopeDaInscricao(reg.id).catch(() => null)
  if (atual?.status === 'ASSINADO') return { ok: false, status: 409, erro: 'O contrato desta inscrição já está assinado.' }
  // Assinatura eletrônica em andamento (Autentique/Clicksign): deixa de valer —
  // senão o candidato assinaria duas vezes o mesmo contrato.
  if (atual && atual.status !== 'CANCELADO') await svc.cancelar(atual.id).catch(() => null)

  const fd = (reg.formData as Record<string, unknown>) ?? {}
  const env = await svc.criar({
    titulo: `Contrato assinado no papel — ${nome}`.slice(0, 191),
    origem: 'UPLOAD',
    arquivoBase64: p.pdf.toString('base64'),
    arquivoNome: (p.nomeArquivo.replace(/\.[a-z0-9]+$/i, '') || 'contrato') + '.pdf',
    registrationId: reg.id,
    signatarios: [{
      nome: nome.slice(0, 191), email: (reg.lead?.email || String(fd.email || '')) || null,
      cpf: String(fd.cpf || '') || null, papel: 'ALUNO', deliveryMethod: 'LINK',
    }],
  } as any)
  const presencial = {
    assinadoPor: nome, assinadoEm: p.assinadoEm.toISOString(), observacao: String(p.observacao || '').slice(0, 1000),
    registradoPor: { id: p.usuario.id, nome: p.usuario.nome }, registradoEm: new Date().toISOString(),
  }
  await prisma.acaAssinatura.update({
    where: { id: env.id },
    data: { provider: 'PRESENCIAL', status: 'ENVIADO' as any, enviadoEm: new Date(), finalizadoEm: p.assinadoEm, metaJson: { presencial } as any },
  })
  // Fecha o envelope pelo caminho de sempre: aceite da inscrição, efetivação e GED.
  for (const s of env.signatarios) await svc.simularAssinatura(env.id, s.id)

  const depois = await prisma.enrollmentRegistration.findUnique({ where: { id: reg.id }, select: { contratoAceite: true } })
  if (!(depois?.contratoAceite as any)?.em) return { ok: false, status: 500, erro: 'O envelope foi registrado, mas a etapa Contrato não fechou. Avise o suporte.' }
  // O aceite guarda também quem registrou (a prova é o arquivo do envelope).
  await prisma.enrollmentRegistration.update({
    where: { id: reg.id }, data: { contratoAceite: { ...(depois!.contratoAceite as object), presencial } as any },
  }).catch(() => {})

  await registrarEventoDaInscricao({
    registrationId: reg.id, etapa: 'contrato', acao: 'contrato_presencial', ator: 'atendente',
    userId: p.usuario.id, userName: p.usuario.nome, req: p.req ?? null,
    dados: { assinadoPor: nome, assinadoEm: presencial.assinadoEm, envelopeId: env.id, observacao: presencial.observacao || undefined },
  })
  if (reg.leadId) {
    const { logEvent } = await import('./leadHistory.js')
    logEvent({
      leadId: reg.leadId, type: 'contract_signed', category: 'operator',
      title: `Contrato assinado no papel registrado — ${reg.candidateCode}`,
      description: `Assinado por ${nome} em ${p.assinadoEm.toLocaleDateString('pt-BR')}; registrado por ${p.usuario.nome}.`,
      actorType: 'operator', userId: p.usuario.id, userName: p.usuario.nome,
      metadata: { registrationId: reg.id, envelopeId: env.id, presencial: true },
    })
  }
  return { ok: true, envelopeId: env.id }
}

/** Lê o pedido multipart (arquivo `contrato` + assinadoPor, assinadoEm, observacao). */
export async function contratoPresencialDaRequisicao(req: any, registrationId: number, usuario: { id: number; nome: string }):
  Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const file = await req.file?.({ limits: { fileSize: 20 * 1024 * 1024 } }).catch(() => null)
  if (!file) return { ok: false, status: 400, erro: 'Anexe o contrato assinado (PDF ou foto).' }
  const ext = String(file.filename.split('.').pop() || '').toLowerCase()
  if (!EXTS.includes(ext)) return { ok: false, status: 400, erro: 'Contrato em PDF, JPG ou PNG.' }
  const partes: Buffer[] = []
  for await (const c of file.file) partes.push(c)
  if (file.file.truncated) return { ok: false, status: 413, erro: 'Arquivo muito grande (máx. 20 MB).' }
  let buf: Buffer = Buffer.concat(partes)
  try {
    const { validateUploadContent } = await import('../lib/uploadSafety.js')
    buf = validateUploadContent(buf, ext, { allowSvg: false })
  } catch (e: any) { return { ok: false, status: 400, erro: e?.message || 'Arquivo inválido' } }
  if (ext !== 'pdf') {
    try { buf = await imagemEmPdf(buf) } catch { return { ok: false, status: 400, erro: 'Não foi possível ler a imagem. Envie em PDF, JPG ou PNG.' } }
  } else if (!buf.subarray(0, 5).toString().startsWith('%PDF')) {
    return { ok: false, status: 400, erro: 'O arquivo não é um PDF válido.' }
  }
  const campo = (n: string) => String(file.fields?.[n]?.value ?? '').trim()
  const dia = campo('assinadoEm').slice(0, 10)
  const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && dia > hojeBr) return { ok: false, status: 400, erro: 'A data da assinatura não pode ser no futuro.' }
  const assinadoEm = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? new Date(`${dia}T12:00:00-03:00`) : new Date(NaN)
  const r = await registrarContratoPresencial({
    registrationId, assinadoPor: campo('assinadoPor'), assinadoEm, observacao: campo('observacao'),
    pdf: buf, nomeArquivo: file.filename, usuario, req,
  })
  return r.ok ? { ok: true } : r
}
