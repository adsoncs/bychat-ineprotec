// Número reservado (linha pessoal) — quem lê o quê.
//
// O caso que abriu esta frente veio do kobogo (05/10/2026): a linha pessoal do
// dono tinha sido reservada em agosto, mas o cadastro dela foi apagado e
// recriado com outro nome. A reserva vale pelo nome gravado em cada mensagem —
// 9.692 mensagens pessoais voltaram a aparecer para a equipe. Ao corrigir,
// três regras novas entraram, e o teste cobre as três:
//
//  1. Reservado vale também contra o SUPERADMIN que não é dono nem observador.
//     Ele continua vendo o NÚMERO na tela de configuração.
//  2. Conversa individual que passou pela linha reservada E por um número da
//     empresa aparece, sem as mensagens da linha reservada — na lista, ao abrir,
//     na busca e no histórico do lead.
//  3. Cadastro reservado com histórico não pode ser apagado (409).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { api, MARCA } from './apoio.js'
import { prisma } from '../src/lib/prisma.js'

const RESERVADA = 'teste_reservada'
const EMPRESA = 'demo_n1'
const DONO = 3 // Rafael (MANAGER) — dono da linha reservada
const SEGREDO = 'segredo-da-linha-pessoal-7731'
const PUBLICO = 'assunto-da-empresa-7731'
const TEL_PESSOAL = '5562988877001'
const TEL_MISTO = '5562988877002'
const JID = '120363999000777001@g.us'

let instId = 0
let soPessoal = 0
let misto = 0
let grupo = 0

async function limpar() {
  await prisma.lead.deleteMany({ where: { OR: [{ whatsapp: { in: [TEL_PESSOAL, TEL_MISTO] } }, { groupJid: JID }] } })
  await prisma.whatsAppInstance.deleteMany({ where: { instanceName: RESERVADA } })
}

async function lead(dados: { whatsapp: string; nome: string; isGroup?: boolean; groupJid?: string; instanceName: string }) {
  const l = await prisma.lead.create({
    data: {
      empresa: '', email: '', formData: {}, scores: {},
      nome: `${MARCA} ${dados.nome}`, whatsapp: dados.whatsapp,
      isGroup: !!dados.isGroup, groupJid: dados.groupJid ?? null,
      instanceName: dados.instanceName, assignedUserId: DONO,
      lastMessageAt: new Date(),
    },
  })
  return l.id
}

async function msg(leadId: number, instancia: string, body: string, minutos: number) {
  await prisma.message.create({
    data: {
      leadId, body, fromMe: false, provider: 'evolution', evolutionInstance: instancia,
      timestamp: new Date(Date.now() - minutos * 60_000),
    },
  })
}

beforeAll(async () => {
  await limpar()
  const inst = await prisma.whatsAppInstance.create({
    data: { name: `${MARCA} linha pessoal`, instanceName: RESERVADA, visibility: 'restricted', ownerUserId: DONO, active: false },
  })
  instId = inst.id

  soPessoal = await lead({ whatsapp: TEL_PESSOAL, nome: 'só pessoal', instanceName: RESERVADA })
  await msg(soPessoal, RESERVADA, SEGREDO, 30)

  // Misto: a ÚLTIMA mensagem é a pessoal — a prévia da lista não pode mostrá-la.
  misto = await lead({ whatsapp: TEL_MISTO, nome: 'misto', instanceName: EMPRESA })
  await msg(misto, EMPRESA, PUBLICO, 20)
  await msg(misto, RESERVADA, SEGREDO, 10)

  grupo = await lead({ whatsapp: JID, nome: 'grupo', isGroup: true, groupJid: JID, instanceName: EMPRESA })
  await msg(grupo, RESERVADA, `${SEGREDO} no grupo`, 25)
  await msg(grupo, EMPRESA, PUBLICO, 5)
})

afterAll(async () => {
  await limpar()
  await prisma.$disconnect().catch(() => {})
})

async function lista(papel: 'superadmin' | 'manager' | 'admin') {
  const r = await api.get(`/atendimento/tickets?bucket=qualquer&ids=${[soPessoal, misto, grupo].join(',')}&limit=50&semContadores=1`, papel)
  expect(r.status).toBe(200)
  return new Map<number, any>((r.body.tickets ?? []).map((t: any) => [t.id, t]))
}

describe('linha reservada', () => {
  it('superadmin que não é dono não vê a conversa só pessoal', async () => {
    const l = await lista('superadmin')
    expect(l.has(soPessoal)).toBe(false)
    expect((await api.get(`/atendimento/tickets/${soPessoal}/messages`, 'superadmin')).status).toBe(403)
    expect((await api.get(`/leads/${soPessoal}/history`, 'superadmin')).status).toBe(403)
  })

  it('conversa mista aparece sem a mensagem pessoal (lista, conversa, busca)', async () => {
    const l = await lista('superadmin')
    expect(l.has(misto)).toBe(true)
    expect(l.get(misto).lastMessage?.body).toBe(PUBLICO)

    const m = await api.get(`/atendimento/tickets/${misto}/messages`, 'superadmin')
    expect(m.status).toBe(200)
    const textos = (m.body.messages ?? m.body).map((x: any) => x.body)
    expect(textos).toContain(PUBLICO)
    expect(textos).not.toContain(SEGREDO)

    const b = await api.get(`/atendimento/tickets/${misto}/busca?q=${SEGREDO}`, 'superadmin')
    expect(b.body.total).toBe(0)
    const g = await api.get(`/atendimento/busca/mensagens?q=${SEGREDO}`, 'superadmin')
    expect((g.body.mensagens ?? []).filter((x: any) => x.leadId === misto)).toHaveLength(0)
  })

  it('grupo que fala por número da empresa aparece inteiro', async () => {
    const l = await lista('superadmin')
    expect(l.has(grupo)).toBe(true)
  })

  it('o dono vê tudo', async () => {
    const l = await lista('manager')
    expect(l.has(soPessoal)).toBe(true)
    expect(l.get(misto)?.lastMessage?.body).toBe(SEGREDO)
    const m = await api.get(`/atendimento/tickets/${misto}/messages`, 'manager')
    expect((m.body.messages ?? m.body).map((x: any) => x.body)).toContain(SEGREDO)
  })

  it('superadmin vê o número na configuração; admin não', async () => {
    const s = await api.get('/admin/instances', 'superadmin')
    expect(s.body.instances.some((i: any) => i.instanceName === RESERVADA)).toBe(true)
    const a = await api.get('/admin/instances', 'admin')
    expect(a.body.instances.some((i: any) => i.instanceName === RESERVADA)).toBe(false)
  })

  it('não apaga cadastro reservado com histórico; sem histórico, apaga', async () => {
    const r = await api.del(`/admin/instances/${instId}`, 'superadmin')
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('reserved_has_history')
    expect(r.body.error).toMatch(/reservado/)
    expect(await prisma.whatsAppInstance.count({ where: { id: instId } })).toBe(1)

    await prisma.message.deleteMany({ where: { evolutionInstance: RESERVADA } })
    const ok = await api.del(`/admin/instances/${instId}`, 'superadmin')
    expect(ok.status).toBe(200)
  })
})
