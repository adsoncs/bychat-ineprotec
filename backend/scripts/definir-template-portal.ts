// Troca o template do portal (arranjo da página), para ver os dois lado a lado.
//   npx tsx --env-file=.env scripts/definir-template-portal.ts <slug> <classico|duas-colunas>
import { prisma } from '../src/lib/prisma.js'
const slug = process.argv[2] ?? 'inscricao'
const tpl = process.argv[3] ?? 'duas-colunas'
if (!['classico', 'duas-colunas'].includes(tpl)) { console.log('template inválido'); process.exit(1) }
const p = await prisma.enrollmentPortal.update({ where: { slug }, data: { brandTemplate: tpl }, select: { nome: true, brandTemplate: true } })
console.log(`${p.nome}: template = ${p.brandTemplate}`)
process.exit(0)
