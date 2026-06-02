// Cria 1 SelectionProcess por EntryMode ativo (idempotente via slug),
// para uma unidade-alvo, e vincula todos ao EnrollmentPortal informado.
//
// Executar (defaults: portalId=1, periodoLetivo=2026/2):
//   node backend/scripts/seed-portal-selection-processes.mjs
//
// Override:
//   PORTAL_ID=2 PERIODO=2026/1 node backend/scripts/seed-portal-selection-processes.mjs
//
// Idempotente: re-executar não duplica processos nem altera os já vinculados.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PORTAL_ID = parseInt(process.env.PORTAL_ID || '1', 10)
const PERIODO = process.env.PERIODO || '2026/2'

// Modos que pertencem a uma graduação tradicional → carregam levelId do portal.
// Os demais (pos_graduacao, extensao, bolsa) ficam com levelId=NULL — usuário
// pode ajustar depois quando criar os níveis correspondentes.
const GRADUATION_MODES = new Set([
  'vestibular_online',
  'vestibular_presencial',
  'enem',
  'transferencia',
  'segunda_graduacao',
])

function slugFor(modeCode, periodo) {
  // periodo "2026/2" → "20262"
  const periodoSlug = periodo.replace('/', '')
  const modeSlug = modeCode.replace(/_/g, '-')
  return `${modeSlug}-${periodoSlug}`
}

function nameFor(mode, periodo) {
  return `${mode.name} ${periodo}`
}

async function run() {
  const portal = await prisma.enrollmentPortal.findUnique({
    where: { id: PORTAL_ID },
    select: { id: true, nome: true, unitId: true, selectionProcessIds: true },
  })
  if (!portal) {
    console.error(`✗ portal id=${PORTAL_ID} não existe`)
    process.exit(1)
  }
  console.log(`→ portal ${portal.id} "${portal.nome}" (unitId=${portal.unitId})`)

  // Pega levelId default da unidade — primeiro nível disponível com graduação.
  // Se a unidade tem só um nível, usamos ele para os modos de graduação.
  const graduationLevel = await prisma.educationalLevel.findFirst({
    where: { active: true },
    orderBy: { ordem: 'asc' },
    select: { id: true, nome: true },
  })
  if (graduationLevel) {
    console.log(`→ nível de graduação default: ${graduationLevel.id} "${graduationLevel.nome}"`)
  }

  const modes = await prisma.entryMode.findMany({
    where: { active: true },
    orderBy: { ordem: 'asc' },
    select: { id: true, code: true, name: true },
  })
  console.log(`→ ${modes.length} modos de ingresso ativos`)

  const createdOrFoundIds = []
  let created = 0
  let existing = 0

  for (const mode of modes) {
    const slug = slugFor(mode.code, PERIODO)
    const levelId = GRADUATION_MODES.has(mode.code) ? graduationLevel?.id ?? null : null

    // 1) já existe processo com este slug? → reutilizar
    const foundBySlug = await prisma.selectionProcess.findUnique({
      where: { slug },
      select: { id: true, entryModeId: true, unitId: true },
    })

    if (foundBySlug) {
      createdOrFoundIds.push(foundBySlug.id)
      if (foundBySlug.entryModeId !== mode.id) {
        console.warn(`! slug=${slug} já existe (id=${foundBySlug.id}) com entryModeId=${foundBySlug.entryModeId} ≠ ${mode.id} — não tocado`)
      } else {
        console.log(`✓ existente: id=${foundBySlug.id} slug=${slug} modo=${mode.code}`)
      }
      existing++
      continue
    }

    // 2) já existe processo ativo com (unitId, entryModeId, periodoLetivo)? → reutilizar
    //    Evita duplicar quando o usuário criou o processo com slug livre (ex.: "vestibular-2026-20262").
    const foundByMode = await prisma.selectionProcess.findFirst({
      where: {
        unitId: portal.unitId,
        entryModeId: mode.id,
        periodoLetivo: PERIODO,
        active: true,
      },
      orderBy: { id: 'asc' },
      select: { id: true, slug: true, nome: true },
    })

    if (foundByMode) {
      createdOrFoundIds.push(foundByMode.id)
      console.log(`✓ existente: id=${foundByMode.id} slug=${foundByMode.slug} modo=${mode.code} (match por unidade+modo+período)`)
      existing++
      continue
    }

    const sp = await prisma.selectionProcess.create({
      data: {
        unitId: portal.unitId,
        levelId,
        entryModeId: mode.id,
        nome: nameFor(mode, PERIODO),
        slug,
        periodoLetivo: PERIODO,
        status: 'active',
        active: true,
      },
      select: { id: true },
    })
    createdOrFoundIds.push(sp.id)
    console.log(`+ criado : id=${sp.id} slug=${slug} modo=${mode.code} levelId=${levelId ?? 'null'}`)
    created++
  }

  // Vincula ao portal — união idempotente entre IDs já presentes e os agora resolvidos.
  const current = Array.isArray(portal.selectionProcessIds) ? portal.selectionProcessIds.map(Number) : []
  const merged = Array.from(new Set([...current, ...createdOrFoundIds])).sort((a, b) => a - b)
  const changed = merged.length !== current.length || merged.some((v, i) => v !== current[i])

  if (changed) {
    await prisma.enrollmentPortal.update({
      where: { id: portal.id },
      data: { selectionProcessIds: merged },
    })
    console.log(`→ portal.selectionProcessIds atualizado: [${current.join(',')}] → [${merged.join(',')}]`)
  } else {
    console.log(`→ portal.selectionProcessIds já contém todos os IDs: [${merged.join(',')}]`)
  }

  console.log(`\nResumo: ${created} criado(s), ${existing} já existia(m). Portal vinculado a ${merged.length} processo(s).`)
  await prisma.$disconnect()
}

run().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
