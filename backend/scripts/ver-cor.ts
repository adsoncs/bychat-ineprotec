import { prisma } from '../src/lib/prisma.js'
const p = await prisma.enrollmentPortal.findFirst({ where: { slug: 'inscricao' }, select: { brandPrimaryColor: true, brandTemplate: true, brandFontFamily: true, brandRadiusScale: true } })
console.log(JSON.stringify(p))
process.exit(0)
