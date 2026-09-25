// src/services/acaContratoLembrete.ts
//
// Contrato enviado e não assinado é o ponto onde a matrícula empaca em silêncio:
// ninguém recusou, ninguém assinou, e a secretaria só descobre no fim do prazo.
// Esta varredura cobra quem falta, no canal que a pessoa usa, com intervalo
// crescente — e para de insistir depois de algumas tentativas, em vez de virar
// perseguição.

import { prisma } from '../lib/prisma.js'
import { getProviderForLeadOwner } from './whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from './notify.js'

/** Dias após o envio em que cada lembrete sai. Depois disso, silêncio. */
const DIAS_DE_LEMBRETE = [2, 5, 10]
const CHAVE_SETTING = 'aca.contrato.lembrete.enviados'

const dia = 24 * 60 * 60 * 1000

/** Quais lembretes já saíram, por envelope. Guardado em Setting (sem migration). */
async function jaEnviados(): Promise<Record<string, number[]>> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE_SETTING }, select: { value: true } })
  return (s?.value as Record<string, number[]>) ?? {}
}

async function gravarEnviados(mapa: Record<string, number[]>): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHAVE_SETTING },
    update: { value: mapa as any },
    create: {
      key: CHAVE_SETTING, value: mapa as any, grp: 'aca', fieldType: 'json',
      label: 'Lembretes de contrato já enviados (controle interno)',
    },
  })
}

export interface ResultadoLembretes {
  analisados: number
  enviados: number
  falhas: number
  detalhes: Array<{ envelopeId: number; signatario: string; canal: string; diasParado: number }>
}

export async function varrerContratosParados(opts: { simular?: boolean } = {}): Promise<ResultadoLembretes> {
  const agora = Date.now()
  const envelopes = await prisma.acaAssinatura.findMany({
    where: { status: { in: ['ENVIADO', 'PARCIAL'] }, enviadoEm: { not: null } },
    select: {
      id: true, titulo: true, enviadoEm: true, alunoId: true,
      signatarios: { select: { id: true, nome: true, status: true, email: true, telefone: true, deliveryMethod: true, linkAssinatura: true } },
    },
  })

  const mapa = await jaEnviados()
  const out: ResultadoLembretes = { analisados: envelopes.length, enviados: 0, falhas: 0, detalhes: [] }

  for (const env of envelopes) {
    const diasParado = Math.floor((agora - new Date(env.enviadoEm!).getTime()) / dia)
    // O maior marco já vencido é o que vale — não dispara três de uma vez para
    // quem ficou uma semana sem abrir o sistema.
    const marco = [...DIAS_DE_LEMBRETE].reverse().find((d) => diasParado >= d)
    if (marco == null) continue

    const feitos = mapa[String(env.id)] ?? []
    if (feitos.includes(marco)) continue

    const pendentes = env.signatarios.filter((s) => s.status === 'PENDENTE' || s.status === 'VISUALIZADO')
    if (!pendentes.length) continue

    let algumEnviado = false
    for (const s of pendentes) {
      const canal = await cobrar(env, s, diasParado, opts.simular === true)
      if (canal) {
        algumEnviado = true
        out.enviados++
        out.detalhes.push({ envelopeId: env.id, signatario: s.nome, canal, diasParado })
      } else {
        out.falhas++
      }
    }
    if (algumEnviado && !opts.simular) {
      mapa[String(env.id)] = [...feitos, marco]
    }
  }

  if (!opts.simular) await gravarEnviados(mapa)
  return out
}

async function cobrar(
  env: { id: number; titulo: string; alunoId: number | null },
  s: { nome: string; email: string | null; telefone: string | null; deliveryMethod: string; linkAssinatura: string | null },
  diasParado: number,
  simular: boolean,
): Promise<string | null> {
  const link = s.linkAssinatura || ''
  const texto = `Olá, ${s.nome}! O contrato "${env.titulo}" está esperando sua assinatura há ${diasParado} dia(s).`
    + (link ? `\n\nAssine por aqui: ${link}` : '\n\nProcure a secretaria para receber o link de assinatura.')
    + '\n\nSe já assinou, pode ignorar esta mensagem.'

  if (simular) return s.telefone ? 'whatsapp (simulado)' : s.email ? 'email (simulado)' : null

  if (s.telefone) {
    try {
      const aluno = env.alunoId
        ? await prisma.aluno.findUnique({ where: { id: env.alunoId }, select: { lead: { select: { id: true, whatsapp: true } } } })
        : null
      const lead = aluno?.lead
      const { provider } = await getProviderForLeadOwner({ id: lead?.id ?? 0, whatsapp: s.telefone })
      await provider.sendText(s.telefone, texto)
      return 'whatsapp'
    } catch {
      // Cai para o e-mail: WhatsApp fora do ar não pode segurar a cobrança.
    }
  }
  if (s.email) {
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'secretaria'),
        to: s.email,
        subject: `Falta sua assinatura — ${env.titulo}`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${texto.replace(/\n/g, '<br>')}</div>`,
      })
      return 'email'
    } catch { /* nada mais a tentar */ }
  }
  return null
}

let timer: NodeJS.Timeout | null = null

/** Uma passada por dia basta: contrato parado se mede em dias, não em minutos. */
export function iniciarLembretesDeContrato(): void {
  if (timer) return
  const rodar = () => {
    varrerContratosParados()
      .then((r) => { if (r.enviados) console.log(`[acaContratoLembrete] ${r.enviados} lembrete(s) enviado(s)`) })
      .catch((e) => console.warn('[acaContratoLembrete] varredura falhou:', e?.message || e))
  }
  timer = setInterval(rodar, 24 * 60 * 60 * 1000)
  // Primeira passada 5 minutos após subir, para não competir com o boot.
  setTimeout(rodar, 5 * 60 * 1000)
}
