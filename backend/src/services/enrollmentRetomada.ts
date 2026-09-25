// src/services/enrollmentRetomada.ts
//
// Retomada de inscrição abandonada.
//
// Quem começa a inscrição e para no meio some sem deixar rastro na operação:
// não virou lead qualificado, não está em fila nenhuma, e ninguém liga porque
// ninguém sabe que existiu. O rascunho, porém, está salvo — com o telefone que
// a pessoa já digitou. Esta varredura convida de volta, uma vez só, com o link
// que reabre o formulário no ponto em que parou.
//
// Parcela vencendo e cobrança de atraso NÃO estão aqui: já existem em
// acaComunicacao (aviso prévio + régua pós-vencimento, com deduplicação).

import { prisma } from '../lib/prisma.js'
import { getProviderForLeadOwner } from './whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from './notify.js'

/** Espera antes de convidar: menos que isso é atropelar quem foi tomar café. */
const HORAS_PARA_CONSIDERAR_ABANDONADO = Number(process.env.RETOMADA_HORAS || 6)
const DIAS_LIMITE = 14 // rascunho velho demais não vale mais o incômodo
const CHAVE_SETTING = 'enrollment.retomada.convidados'

export interface ResultadoRetomada {
  analisados: number
  convidados: number
  semContato: number
  detalhes: Array<{ draftId: number; canal: string; horasParado: number }>
}

async function jaConvidados(): Promise<number[]> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE_SETTING }, select: { value: true } })
  const v = s?.value as number[] | undefined
  return Array.isArray(v) ? v : []
}

async function gravarConvidados(ids: number[]): Promise<void> {
  // Guarda só os últimos 2000: a lista serve para não repetir convite, não como histórico.
  const value = ids.slice(-2000)
  await prisma.setting.upsert({
    where: { key: CHAVE_SETTING },
    update: { value: value as any },
    create: {
      key: CHAVE_SETTING, value: value as any, grp: 'enrollment', fieldType: 'json',
      label: 'Rascunhos já convidados a retomar (controle interno)',
    },
  })
}

export async function varrerRascunhosAbandonados(opts: { simular?: boolean } = {}): Promise<ResultadoRetomada> {
  const agora = Date.now()
  const limiteSuperior = new Date(agora - HORAS_PARA_CONSIDERAR_ABANDONADO * 3600_000)
  const limiteInferior = new Date(agora - DIAS_LIMITE * 86400_000)

  const rascunhos = await prisma.enrollmentDraft.findMany({
    where: {
      updatedAt: { lt: limiteSuperior, gt: limiteInferior },
      expiresAt: { gt: new Date() },
      OR: [{ whatsapp: { not: null } }, { email: { not: null } }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true, sessionId: true, formData: true, currentStep: true,
      email: true, whatsapp: true, updatedAt: true,
      portal: { select: { id: true, slug: true, nome: true, active: true } },
    },
  })

  const convidados = await jaConvidados()
  const out: ResultadoRetomada = { analisados: rascunhos.length, convidados: 0, semContato: 0, detalhes: [] }
  const novos: number[] = []

  for (const d of rascunhos) {
    if (convidados.includes(d.id)) continue
    if (!d.portal?.active) continue

    // Já se inscreveu depois de abandonar? Então não há o que retomar.
    const contato = (d.formData as any)?.whatsapp || d.whatsapp
    if (contato) {
      const jaInscrito = await prisma.enrollmentRegistration.findFirst({
        where: { portalId: d.portal.id, lead: { whatsapp: { contains: String(contato).replace(/\D/g, '').slice(-8) } } },
        select: { id: true },
      })
      if (jaInscrito) continue
    }

    const horas = Math.floor((agora - new Date(d.updatedAt).getTime()) / 3600_000)
    const canal = await convidar(d, horas, opts.simular === true)
    if (canal) {
      out.convidados++
      out.detalhes.push({ draftId: d.id, canal, horasParado: horas })
      novos.push(d.id)
    } else {
      out.semContato++
    }
  }

  if (!opts.simular && novos.length) await gravarConvidados([...convidados, ...novos])
  return out
}

async function convidar(
  d: { id: number; sessionId: string; formData: unknown; email: string | null; whatsapp: string | null; portal: { slug: string; nome: string } | null },
  horas: number,
  simular: boolean,
): Promise<string | null> {
  const nome = String((d.formData as any)?.nome || '').split(' ')[0] || 'tudo bem'
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  // O rascunho é recuperado pelo sessionId que a própria página guardou; o link
  // só reabre o formulário, não expõe dado de ninguém.
  const url = `${base}/portal/${d.portal?.slug ?? ''}`
  const texto = `Olá, ${nome}! Vi que você começou a inscrição em ${d.portal?.nome ?? 'nosso portal'} e não terminou.`
    + `\n\nSeus dados estão salvos — é só voltar e continuar de onde parou: ${url}`
    + '\n\nSe precisar de ajuda para escolher o curso, é só responder por aqui.'

  const tel = d.whatsapp || (d.formData as any)?.whatsapp
  if (simular) return tel ? 'whatsapp (simulado)' : d.email ? 'email (simulado)' : null

  if (tel) {
    try {
      const { provider } = await getProviderForLeadOwner({ id: 0, whatsapp: String(tel) })
      await provider.sendText(String(tel), texto)
      return 'whatsapp'
    } catch { /* cai para o e-mail */ }
  }
  if (d.email) {
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'secretaria'),
        to: d.email,
        subject: 'Sua inscrição está salva — falta pouco',
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${texto.replace(/\n/g, '<br>')}</div>`,
      })
      return 'email'
    } catch { /* nada mais a tentar */ }
  }
  return null
}

let timer: NodeJS.Timeout | null = null

/** De 6 em 6 horas: acompanha o ritmo de quem abandona no mesmo dia. */
export function iniciarRetomadaDeRascunhos(): void {
  if (timer) return
  const rodar = () => {
    varrerRascunhosAbandonados()
      .then((r) => { if (r.convidados) console.log(`[enrollmentRetomada] ${r.convidados} convite(s) de retomada`) })
      .catch((e) => console.warn('[enrollmentRetomada] varredura falhou:', e?.message || e))
  }
  timer = setInterval(rodar, 6 * 60 * 60 * 1000)
  setTimeout(rodar, 7 * 60 * 1000)
}
