// Verifica o portão da transcrição de áudio (Conversas › Preferências › Áudio).
// Exercita a função real do webhook contra os formatos que a Setting assume:
// Json boolean (semeado por SQL) e string "true"/"false" (salvo pelo painel).
//
//   npx tsx --env-file=.env scripts/test-transcribe-toggle.ts

import { prisma } from '../src/lib/prisma.js'
import { isTranscriptionEnabled, invalidateTranscriptionFlag } from '../src/routes/whatsapp.js'

const KEY = 'conversations.transcribe_audio'

async function set(value: unknown) {
  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: value as never },
    create: { key: KEY, value: value as never, label: 'Transcrever áudios recebidos', grp: 'conversations', fieldType: 'boolean' },
  })
  invalidateTranscriptionFlag()
}

async function main() {
  const original = await prisma.setting.findUnique({ where: { key: KEY } })
  const cases: { value: unknown; expected: boolean; desc: string }[] = [
    { value: true, expected: true, desc: 'boolean true' },
    { value: false, expected: false, desc: 'boolean false' },
    { value: 'true', expected: true, desc: 'string "true" (painel)' },
    { value: 'false', expected: false, desc: 'string "false" (painel)' },
    { value: '1', expected: true, desc: 'string "1"' },
  ]

  let failures = 0
  for (const c of cases) {
    await set(c.value)
    const got = await isTranscriptionEnabled()
    const ok = got === c.expected
    if (!ok) failures++
    console.log(`${ok ? 'OK  ' : 'FALHA'} ${c.desc.padEnd(26)} → ${got} (esperado ${c.expected})`)
  }

  // Ausente = ligada (não tira o recurso de quem nunca abriu o painel).
  await prisma.setting.delete({ where: { key: KEY } }).catch(() => null)
  invalidateTranscriptionFlag()
  const semLinha = await isTranscriptionEnabled()
  if (!semLinha) failures++
  console.log(`${semLinha ? 'OK  ' : 'FALHA'} ${'sem a linha no banco'.padEnd(26)} → ${semLinha} (esperado true)`)

  // Cache de 60s: mudar sem invalidar não deve ter efeito imediato.
  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: 'false' as never },
    create: { key: KEY, value: 'false' as never, label: 'Transcrever áudios recebidos', grp: 'conversations', fieldType: 'boolean' },
  })
  const cacheado = await isTranscriptionEnabled()
  if (cacheado !== true) failures++
  console.log(`${cacheado === true ? 'OK  ' : 'FALHA'} ${'cache segura o valor'.padEnd(26)} → ${cacheado} (esperado true)`)
  invalidateTranscriptionFlag()
  const aposInvalidar = await isTranscriptionEnabled()
  if (aposInvalidar !== false) failures++
  console.log(`${aposInvalidar === false ? 'OK  ' : 'FALHA'} ${'invalidação aplica na hora'.padEnd(26)} → ${aposInvalidar} (esperado false)`)

  // Restaura o estado original da instalação.
  if (original) {
    await prisma.setting.upsert({
      where: { key: KEY },
      update: { value: original.value as never },
      create: { key: KEY, value: original.value as never, label: original.label, grp: original.grp, fieldType: original.fieldType },
    })
  } else {
    await prisma.setting.delete({ where: { key: KEY } }).catch(() => null)
  }
  invalidateTranscriptionFlag()
  console.log(`estado restaurado: ${JSON.stringify(original?.value ?? null)}`)

  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
