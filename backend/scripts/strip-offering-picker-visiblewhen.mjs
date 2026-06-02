// Defesa em camada de DB para a dependência circular do offering-picker.
//
// Por construção do portal de matrículas, o campo `offering-picker` é o que
// DEFINE o entryMode (lido da oferta escolhida). Logo, `visibleWhen.entryMode`
// nesse campo cria dependência circular: ele só apareceria depois de já ter
// sido respondido.
//
// O frontend já bloqueia/ignora essa regra (frontend/assets/enrollment-portal.js
// e frontend/modules/enrollmentPortals.js), mas portais antigos podem ter sido
// salvos com a regra antes do fix. Este script varre todos os EnrollmentPortal,
// remove `visibleWhen.entryMode` de qualquer field type='offering-picker' e
// salva backup do formConfig original.
//
// Idempotente: re-executar não muda nada se já estiver limpo.
//
// Executar:
//   node backend/scripts/strip-offering-picker-visiblewhen.mjs
//
// Dry-run (não salva, só lista):
//   DRY_RUN=1 node backend/scripts/strip-offering-picker-visiblewhen.mjs

import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()
const DRY_RUN = process.env.DRY_RUN === '1'
const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/bychat-beyond-backup'

function sanitizeFormConfig(formConfig) {
  // Retorna { changed: boolean, formConfig: novo, hits: [{stepIdx, fieldIdx, fieldName}] }
  if (!formConfig || typeof formConfig !== 'object') return { changed: false, formConfig, hits: [] }
  const steps = Array.isArray(formConfig.steps) ? formConfig.steps : null
  if (!steps) return { changed: false, formConfig, hits: [] }

  const hits = []
  const newSteps = steps.map((step, sIdx) => {
    const fields = Array.isArray(step?.fields) ? step.fields : null
    if (!fields) return step
    const newFields = fields.map((field, fIdx) => {
      if (!field || typeof field !== 'object') return field
      if (field.type !== 'offering-picker') return field
      const vw = field.visibleWhen
      if (!vw || typeof vw !== 'object' || !('entryMode' in vw)) return field
      hits.push({ stepIdx: sIdx, fieldIdx: fIdx, fieldName: field.name || null })
      const { entryMode, ...rest } = vw
      const newField = { ...field }
      if (Object.keys(rest).length === 0) {
        delete newField.visibleWhen
      } else {
        newField.visibleWhen = rest
      }
      return newField
    })
    return { ...step, fields: newFields }
  })

  if (hits.length === 0) return { changed: false, formConfig, hits }
  return { changed: true, formConfig: { ...formConfig, steps: newSteps }, hits }
}

async function run() {
  const portals = await prisma.enrollmentPortal.findMany({
    select: { id: true, slug: true, nome: true, formConfig: true },
    orderBy: { id: 'asc' },
  })
  console.log(`→ ${portals.length} portal(is) examinado(s)${DRY_RUN ? ' (DRY_RUN)' : ''}`)

  let touched = 0
  let clean = 0
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  for (const p of portals) {
    const result = sanitizeFormConfig(p.formConfig)
    if (!result.changed) {
      console.log(`✓ portal ${p.id} "${p.slug}" — limpo`)
      clean++
      continue
    }
    console.log(`! portal ${p.id} "${p.slug}" — ${result.hits.length} ocorrência(s):`)
    for (const h of result.hits) {
      console.log(`    step[${h.stepIdx}].fields[${h.fieldIdx}]${h.fieldName ? ` (name="${h.fieldName}")` : ''}`)
    }

    if (DRY_RUN) {
      touched++
      continue
    }

    try {
      mkdirSync(BACKUP_DIR, { recursive: true })
      const backupPath = join(BACKUP_DIR, `portal${p.id}-formConfig-${stamp}.json`)
      writeFileSync(backupPath, JSON.stringify(p.formConfig, null, 2))
      console.log(`    backup: ${backupPath}`)
    } catch (e) {
      console.warn(`    ✗ falha ao salvar backup: ${e.message} — abortando este portal`)
      continue
    }

    await prisma.enrollmentPortal.update({
      where: { id: p.id },
      data: { formConfig: result.formConfig },
    })
    console.log(`    ✓ atualizado`)
    touched++
  }

  console.log(`\nResumo: ${touched} portal(is) ${DRY_RUN ? 'precisariam ser' : 'foram'} atualizado(s), ${clean} já estava(m) limpo(s).`)
  await prisma.$disconnect()
}

run().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
