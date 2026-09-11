// scripts/transcrever-audios-antigos.ts
//
// Transcreve os áudios que já estão na conversa e ficaram sem texto.
//
// Enquanto a transcrição não era chamada no caminho da Cloud API, cada áudio
// entrou como uma bolha com o corpo "[audio]". O arquivo continua salvo em
// `uploads/`, então o conteúdo não se perdeu — só nunca foi lido. Este script
// lê o que ficou para trás.
//
// Só mexe em mensagem RECEBIDA e sem texto: áudio que já tem transcrição, ou
// que a equipe enviou, fica como está.
//
//   npx tsx scripts/transcrever-audios-antigos.ts            (só relata)
//   npx tsx scripts/transcrever-audios-antigos.ts --aplicar  (grava)
//   npx tsx scripts/transcrever-audios-antigos.ts --aplicar --dias=30

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '../src/lib/prisma.js'
import { transcreverAudio } from '../src/services/audioTranscription.js'

const aplicar = process.argv.includes('--aplicar')
const dias = Number(process.argv.find((a) => a.startsWith('--dias='))?.split('=')[1] || 30)

const desde = new Date(Date.now() - dias * 24 * 3600_000)

const audios = await prisma.message.findMany({
  where: {
    mediaType: 'audio',
    fromMe: false,
    timestamp: { gte: desde },
    // `body` é obrigatório no schema: o áudio sem transcrição fica com o
    // rótulo "[audio]" ou com a string vazia — nunca nulo.
    OR: [{ body: '[audio]' }, { body: '' }],
  },
  select: { id: true, leadId: true, mediaUrl: true, timestamp: true, provider: true },
  orderBy: { timestamp: 'asc' },
})

console.log(`\n═══ ÁUDIOS SEM TRANSCRIÇÃO (últimos ${dias} dias) ═══\n`)
console.log(`${audios.length} áudio(s) recebido(s) sem texto\n`)

let feitos = 0, semArquivo = 0, semTexto = 0

for (const m of audios) {
  const rel = String(m.mediaUrl || '').replace(/^\//, '')
  // `uploads/` fica um nível acima de `backend/`, que é de onde o script roda.
  const caminho = join(process.cwd(), '..', rel)
  const quando = m.timestamp.toISOString().slice(0, 16).replace('T', ' ')

  if (!rel || !existsSync(caminho)) {
    console.log(`  ⚠ #${m.id} ${quando} — arquivo não está mais em disco (${m.mediaUrl || 'sem url'})`)
    semArquivo++
    continue
  }

  const texto = await transcreverAudio(readFileSync(caminho), rel.split('.').pop() || null)
  if (!texto) {
    console.log(`  · #${m.id} ${quando} — não deu para transcrever (áudio curto, ruído ou formato)`)
    semTexto++
    continue
  }

  console.log(`  ✔ #${m.id} ${quando} [${m.provider}] "${texto.slice(0, 70)}${texto.length > 70 ? '…' : ''}"`)
  feitos++
  if (aplicar) {
    await prisma.message.update({ where: { id: m.id }, data: { body: texto } })
  }
}

console.log(`\n${'─'.repeat(58)}`)
console.log(`  transcritos ................. ${feitos}`)
console.log(`  arquivo ausente ............. ${semArquivo}`)
console.log(`  sem texto reconhecível ...... ${semTexto}`)
console.log(aplicar ? '\nGravado.\n' : '\nNada foi gravado. Rode com --aplicar.\n')

await prisma.$disconnect()
