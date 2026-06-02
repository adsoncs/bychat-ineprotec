import { prisma } from './src/lib/prisma.js'
import { signToken } from './src/lib/auth.js'
const u = await prisma.user.findFirst({ where: { role: { in: ['SUPERADMIN','ADMIN'] } }, select: { id:true, email:true, name:true, role:true } })
console.error('user=', u?.id, u?.role)
console.log(signToken({ userId: u!.id, email: u!.email, name: u!.name || 'admin', role: u!.role }))
await prisma.$disconnect()
