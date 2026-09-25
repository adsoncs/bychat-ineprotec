// Gera um link no formato ANTIGO (token HMAC na URL) para conferir que os
// avisos já enviados aos alunos continuam abrindo depois da mudança.
import { mintPortalToken } from '../src/lib/acaPortalToken.js'
import { prisma } from '../src/lib/prisma.js'

const aluno = await prisma.aluno.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
console.log(mintPortalToken('aca-aluno', aluno!.id, 30))
process.exit(0)
