// tests/contatoSemNumero.test.ts
//
// O contato que chega só com o LID PRECISA virar ficha.
//
// Quando o LID deixou de ser gravado como telefone, a coluna `whatsapp` desse
// contato passou a nascer vazia — e com isso ele bateu de frente com duas
// guardas que existiam desde antes e ninguém tinha motivo para revisar:
//
//   · `createLeadFromForm` devolvia null em "sem nome, sem e-mail, sem
//     telefone", e a mensagem sumia sem deixar ficha nenhuma;
//   · as buscas do motor procuravam o lead pelo telefone, e sem telefone
//     abriam uma ficha nova por mensagem — a jornada recomeçava a cada turno.
//
// As duas falham em silêncio: ninguém vê erro, só um contato que não aparece
// ou aparece três vezes. Por isso viraram teste.
//
// ⚠️ TOCA O BANCO REAL. Tudo leva o prefixo `test:` e é apagado no fim.
//
//   cd backend && npx tsx --test tests/contatoSemNumero.test.ts

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { createLeadFromForm } from '../src/services/formFlow.js'
import { acharLeadDoContato } from '../src/services/contactIdentity.js'

const carimbo = String(Date.now()).slice(-9)
const LID = `9${carimbo}9999`        // 15 dígitos que não formam telefone
const JID = `${LID}@lid`
const criados: number[] = []

after(async () => {
  if (criados.length) {
    await prisma.message.deleteMany({ where: { leadId: { in: criados } } }).catch(() => {})
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: criados } } }).catch(() => {})
    await prisma.lead.deleteMany({ where: { id: { in: criados } } }).catch(() => {})
  }
  await prisma.$disconnect()
})

describe('o contato puro-LID vira ficha', () => {
  test('sem nome, sem e-mail e sem telefone — o LID basta', async () => {
    const r = await createLeadFromForm(
      { id: null }, [], {}, {}, '127.0.0.1', null, undefined,
      { channel: 'whatsapp', forceWhatsapp: JID, leadSource: 'whatsapp' } as any,
    )

    assert.ok(r, 'a mensagem de quem chega só com LID não pode sumir sem deixar ficha')
    criados.push(r!.leadId)
    assert.equal(r!.newLead.whatsapp, '', 'o LID não é telefone: a coluna fica vazia')
    assert.equal(r!.newLead.waLid, JID, 'e o LID vai para onde liga a conversa à pessoa')
  })

  test('a mensagem seguinte encontra a MESMA ficha', async () => {
    const achado = await acharLeadDoContato(JID)
    assert.ok(achado, 'sem isto o motor abriria uma ficha por mensagem')
    assert.equal(achado!.id, criados[0])
  })

  test('encontra também pelos dígitos crus, como o webhook os passa', async () => {
    const achado = await acharLeadDoContato(LID)
    assert.ok(achado, 'o webhook usa os dígitos do LID como endereço de entrega')
    assert.equal(achado!.id, criados[0])
  })

  test('um telefone de verdade continua nascendo com telefone', async () => {
    const fone = `5562${carimbo.slice(0, 5)}999`
    const r = await createLeadFromForm(
      { id: null }, [], {}, {}, '127.0.0.1', null, undefined,
      { channel: 'whatsapp', forceWhatsapp: fone, leadSource: 'whatsapp' } as any,
    )
    assert.ok(r)
    criados.push(r!.leadId)
    assert.ok(r!.newLead.whatsapp, 'a correção do LID não pode esvaziar quem tem número')
    assert.equal(r!.newLead.waLid, null)
  })
})
