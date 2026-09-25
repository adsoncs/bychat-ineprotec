// Semeia o mínimo do ERP na demo para exercitar a ponte portal → matrícula:
// um período letivo e uma turma por oferta ativa, ligada à oferta.
// Só cria o que falta — rodar duas vezes não duplica.
import { prisma } from '../src/lib/prisma.js'

const TURNOS: Record<string, any> = {
  matutino: 'MATUTINO', vespertino: 'VESPERTINO', noturno: 'NOTURNO',
  integral: 'INTEGRAL', ead: 'EAD',
}

const periodo = await prisma.acaPeriodoLetivo.upsert({
  where: { codigo: '2026.1' },
  update: {},
  create: {
    codigo: '2026.1',
    descricao: 'Primeiro semestre de 2026',
    anoLetivo: 2026,
    dataInicio: new Date('2026-02-02'),
    dataFim: new Date('2026-06-30'),
    ativo: true,
  },
  select: { id: true, codigo: true },
})
console.log(`período letivo ${periodo.codigo} (id ${periodo.id})`)

const ofertas = await prisma.courseOffering.findMany({
  where: { active: true },
  select: { id: true, nome: true, turno: true, complemento: true },
})

let criadas = 0
for (const o of ofertas) {
  const existe = await prisma.acaTurma.findFirst({
    where: { courseOfferingId: o.id, periodoLetivoId: periodo.id },
    select: { id: true },
  })
  if (existe) continue
  await prisma.acaTurma.create({
    data: {
      courseOfferingId: o.id,
      periodoLetivoId: periodo.id,
      nome: `${o.nome}${o.complemento ? ' — ' + o.complemento : ''} · 2026.1`,
      turno: TURNOS[String(o.turno || '').toLowerCase()] ?? null,
      capacidade: 40,
      ativo: true,
      matriculaAberta: true,
    },
  })
  criadas++
}

console.log(`ofertas ativas: ${ofertas.length} | turmas criadas agora: ${criadas}`)
console.log(`total de turmas no ERP: ${await prisma.acaTurma.count()}`)
process.exit(0)
