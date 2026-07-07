// src/services/leadExportRender.ts
// Renderizadores da exportação de leads a partir do Dossier normalizado:
//  - XLSX  : uma aba por bloco (SheetJS), leads como linhas.
//  - CSV   : arquivo único multi-bloco com BOM (Excel PT-BR).
//  - HTML  : dossiê visual por lead (uma "página" por lead) com branding.
//  - PDF   : o mesmo HTML impresso por google-chrome headless (soberano, no VPS).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { utils, write as xlsxWrite } from 'xlsx'
import { getBranding } from '../lib/branding.js'
import type { Dossier, Block, KvRow } from './leadExportData.js'

const ACCENT = '#0f766e' // teal — cabeçalho do dossiê

// ── helpers de célula ───────────────────────────────────────────────────────
function isKv(block: Block): boolean { return block.kind === 'kv' }

// linhas de uma tabela (kind=table) para um lead
function tableRows(block: Block, leadId: number): Record<string, string>[] {
  return (block.byLead[leadId] as Record<string, string>[]) || []
}
function kvRows(block: Block, leadId: number): KvRow[] {
  return (block.byLead[leadId] as KvRow[]) || []
}

function blockHasData(block: Block, leadId: number): boolean {
  const rows = block.byLead[leadId] as any[]
  if (!rows || !rows.length) return false
  if (isKv(block)) return (rows as KvRow[]).some(r => r.value !== '' && !r.label.startsWith('—'))
  return true
}

// ── XLSX ────────────────────────────────────────────────────────────────────
function sheetName(base: string, used: Set<string>): string {
  let name = base.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim() || 'Aba'
  let n = name, i = 2
  while (used.has(n.toLowerCase())) { n = `${name.slice(0, 26)} ${i++}` }
  used.add(n.toLowerCase())
  return n
}

export function renderXlsx(dossier: Dossier): Buffer {
  const wb = utils.book_new()
  const used = new Set<string>()

  // Aba índice.
  const idx = [['ID', 'Código', 'Nome', 'Empresa'], ...dossier.leads.map(l => [l.id, l.uid, l.nome, l.empresa])]
  utils.book_append_sheet(wb, utils.aoa_to_sheet(idx), sheetName('Leads', used))

  for (const block of dossier.blocks) {
    let aoa: any[][]
    if (isKv(block)) {
      aoa = [['Lead', 'Campo', 'Valor']]
      for (const l of dossier.leads) {
        for (const r of kvRows(block, l.id)) {
          if (r.label.startsWith('—')) continue // separadores visuais
          aoa.push([l.uid, r.label, r.value])
        }
      }
    } else {
      const cols = block.columns || []
      aoa = [['Lead', ...cols]]
      for (const l of dossier.leads) {
        for (const row of tableRows(block, l.id)) aoa.push([l.uid, ...cols.map(c => row[c] ?? '')])
      }
    }
    if (aoa.length <= 1) continue // sem dados
    utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), sheetName(block.label, used))
  }

  return xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// ── CSV (multi-bloco, BOM) ──────────────────────────────────────────────────
function escCsv(v: any): string {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export function renderCsv(dossier: Dossier): string {
  const out: string[] = []
  out.push(`===== LEADS =====`)
  out.push(['ID', 'Código', 'Nome', 'Empresa'].map(escCsv).join(','))
  for (const l of dossier.leads) out.push([l.id, l.uid, l.nome, l.empresa].map(escCsv).join(','))
  out.push('')

  for (const block of dossier.blocks) {
    const lines: string[] = []
    if (isKv(block)) {
      lines.push(['Lead', 'Campo', 'Valor'].map(escCsv).join(','))
      let any = false
      for (const l of dossier.leads) for (const r of kvRows(block, l.id)) {
        if (r.label.startsWith('—')) continue
        lines.push([l.uid, r.label, r.value].map(escCsv).join(',')); any = true
      }
      if (!any) continue
    } else {
      const cols = block.columns || []
      lines.push(['Lead', ...cols].map(escCsv).join(','))
      let any = false
      for (const l of dossier.leads) for (const row of tableRows(block, l.id)) {
        lines.push([l.uid, ...cols.map(c => row[c] ?? '')].map(escCsv).join(',')); any = true
      }
      if (!any) continue
    }
    out.push(`===== ${block.label.toUpperCase()} =====`)
    out.push(...lines)
    out.push('')
  }

  return '﻿' + out.join('\r\n')
}

// ── HTML (dossiê por lead) ──────────────────────────────────────────────────
function esc(v: any): string {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function blockHtml(block: Block, leadId: number): string {
  if (!blockHasData(block, leadId)) return ''
  if (isKv(block)) {
    const rows = kvRows(block, leadId).map(r =>
      r.label.startsWith('—')
        ? `<tr class="sep"><td colspan="2">${esc(r.label.replace(/—/g, '').trim())}</td></tr>`
        : `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`,
    ).join('')
    return `<div class="block"><h3>${esc(block.label)}</h3><table class="kv">${rows}</table></div>`
  }
  const cols = block.columns || []
  const rows = tableRows(block, leadId)
  const head = cols.map(c => `<th>${esc(c)}</th>`).join('')
  const body = rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')
  return `<div class="block"><h3>${esc(block.label)} <span class="count">(${rows.length})</span></h3>`
    + `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`
}

export async function renderHtml(dossier: Dossier): Promise<string> {
  const brand = await getBranding().catch(() => ({ brandName: 'BeyondHub' } as any))
  const gen = dossier.generatedAt.toLocaleString('pt-BR')

  const leadSections = dossier.leads.map(l => {
    const blocks = dossier.blocks.map(b => blockHtml(b, l.id)).filter(Boolean).join('')
    return `<section class="lead">
      <div class="lead-head">
        <h2>${esc(l.nome)} <span class="uid">${esc(l.uid)}</span></h2>
        <div class="sub">${esc(l.empresa)}</div>
      </div>
      ${blocks || '<p class="empty">Sem dados nas seções selecionadas.</p>'}
    </section>`
  }).join('')

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Exportação de leads — ${esc(brand.brandName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; font-size: 12px; }
  .top { background: ${ACCENT}; color: #fff; padding: 18px 28px; }
  .top h1 { margin: 0; font-size: 18px; }
  .top .meta { opacity: .85; font-size: 12px; margin-top: 4px; }
  .wrap { padding: 20px 28px; }
  .lead { margin-bottom: 28px; }
  .lead-head { border-bottom: 2px solid ${ACCENT}; padding-bottom: 6px; margin-bottom: 12px; }
  .lead-head h2 { margin: 0; font-size: 16px; color: #111827; }
  .lead-head .uid { font-size: 12px; color: ${ACCENT}; font-weight: 600; }
  .lead-head .sub { color: #6b7280; font-size: 12px; }
  .block { margin: 12px 0; break-inside: avoid; }
  .block h3 { font-size: 13px; margin: 0 0 6px; color: ${ACCENT}; border-left: 3px solid ${ACCENT}; padding-left: 8px; }
  .block .count { color: #9ca3af; font-weight: 400; }
  table { border-collapse: collapse; width: 100%; }
  .kv th { text-align: left; width: 32%; background: #f0fdfa; color: #374151; font-weight: 600; vertical-align: top; }
  .kv td, .kv th { border: 1px solid #e5e7eb; padding: 4px 8px; font-size: 12px; word-break: break-word; }
  .kv tr.sep td { background: ${ACCENT}; color: #fff; font-weight: 600; font-size: 11px; padding: 3px 8px; }
  .tbl-wrap { overflow-x: auto; }
  .tbl th { background: #f0fdfa; color: #374151; text-align: left; }
  .tbl th, .tbl td { border: 1px solid #e5e7eb; padding: 4px 8px; font-size: 11px; vertical-align: top; word-break: break-word; max-width: 340px; }
  .tbl tbody tr:nth-child(even) { background: #fafafa; }
  .empty { color: #9ca3af; font-style: italic; }
  @media print { .lead { page-break-after: always; } .lead:last-child { page-break-after: auto; } .block { page-break-inside: avoid; } }
</style></head>
<body>
  <div class="top">
    <h1>Exportação de leads — ${esc(brand.brandName)}</h1>
    <div class="meta">${dossier.leads.length} lead(s) · gerado em ${esc(gen)}</div>
  </div>
  <div class="wrap">${leadSections}</div>
</body></html>`
}

// ── PDF (google-chrome headless imprime o HTML) ─────────────────────────────
function execFileP(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()))
  })
}

const CHROME_BINS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

export async function renderPdf(dossier: Dossier): Promise<Buffer> {
  const html = await renderHtml(dossier)
  const base = join(tmpdir(), `leadexport-${randomUUID()}`)
  const htmlPath = `${base}.html`
  const pdfPath = `${base}.pdf`
  const profileDir = `${base}-profile`
  await fs.writeFile(htmlPath, html, 'utf-8')

  const args = [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--user-data-dir=${profileDir}`, '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ]

  let lastErr: any = null
  try {
    let ok = false
    for (const bin of CHROME_BINS) {
      try { await execFileP(bin, args, 90_000); ok = true; break } catch (e) { lastErr = e }
    }
    if (!ok) throw lastErr || new Error('nenhum navegador headless disponível')
    return await fs.readFile(pdfPath)
  } finally {
    // limpeza best-effort
    for (const p of [htmlPath, pdfPath]) { await fs.rm(p, { force: true }).catch(() => {}) }
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}
