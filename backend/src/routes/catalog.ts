// src/routes/catalog.ts
// Catálogo de Produtos e Serviços — o que a empresa vende, seja mercadoria,
// serviço, plano ou mensalidade. É a fonte da verdade do chatbot de IA (que
// consulta via ferramenta consultar_catalogo, não recebe a lista no prompt) e de
// onde saem os itens das propostas do módulo Negociações. CRUD manual + import
// por planilha (modelo XLSX gerado aqui).

import { FastifyInstance } from 'fastify'
import { read, utils, write } from 'xlsx'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware } from '../lib/auth.js'

// Colunas do modelo de importação (na ordem do XLSX). `sku` é o código interno
// do item — o nome da coluna fica por compatibilidade com planilhas já em uso.
const COLS = ['categoria', 'nome', 'marca', 'preco', 'cobranca', 'estoque', 'disponivel', 'sku', 'descricao'] as const

/**
 * Tipo de cobrança padrão do item: `recorrente` (mensalidade, entra no MRR) ou
 * `unico` (cobrado uma vez só). Aceita as palavras que o operador
 * escreve na planilha — "mensal", "mensalidade", "assinatura", "recorrente".
 */
function parseCobranca(v: unknown): 'unico' | 'recorrente' {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return ['recorrente', 'mensal', 'mensalidade', 'assinatura', 'recorrencia', 'mrr'].includes(s) ? 'recorrente' : 'unico'
}

function parsePreco(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  // formato BR: "R$ 1.999,90" → 1999.90
  const s = String(v).replace(/[^\d.,-]/g, '').trim()
  if (!s) return null
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = parseFloat(norm)
  return isFinite(n) ? n : null
}
function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase()
  if (['não', 'nao', 'no', 'false', '0', 'esgotado', 'indisponivel', 'indisponível'].includes(s)) return false
  return true // default disponível
}
function parseInt2(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10)
  return isFinite(n) ? n : null
}
function str(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export async function catalogRoutes(app: FastifyInstance) {
  // ── Listagem (com busca/categoria) ──
  // Leitura com `authMiddleware`, não `adminOnly`: quem monta a proposta escolhe
  // os itens no catálogo, e vendedor (AGENT) não é administrador — com o gate
  // antigo o seletor de itens vinha vazio para ele, sem dizer por quê.
  // A escrita (criar/editar/importar) segue restrita a administradores.
  app.get('/api/admin/catalog', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    const cat = String((req.query as any)?.categoria || '').trim()
    const where: any = { active: true }
    if (cat) where.categoria = cat
    if (q) where.OR = [{ nome: { contains: q } }, { descricao: { contains: q } }, { marca: { contains: q } }, { categoria: { contains: q } }]
    const products = await prisma.product.findMany({ where, orderBy: [{ categoria: 'asc' }, { nome: 'asc' }], take: 1000 })
    return { products }
  })

  // ── Categorias distintas + contagem ──
  app.get('/api/admin/catalog/categories', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.product.groupBy({ by: ['categoria'], where: { active: true }, _count: { _all: true } })
    return { categories: rows.map(r => ({ categoria: r.categoria, count: r._count._all })).sort((a, b) => a.categoria.localeCompare(b.categoria)) }
  })

  // ── Criar ──
  app.post('/api/admin/catalog', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.categoria) return reply.code(400).send({ error: 'Nome e categoria são obrigatórios' })
    const p = await prisma.product.create({
      data: {
        categoria: String(b.categoria).slice(0, 100), nome: String(b.nome).slice(0, 191),
        marca: str(b.marca, 100), descricao: str(b.descricao, 5000), sku: str(b.sku, 60),
        preco: parsePreco(b.preco), estoque: parseInt2(b.estoque),
        disponivel: b.disponivel !== false, imageUrl: str(b.imageUrl, 500),
        cobranca: parseCobranca(b.cobranca),
      },
    })
    return { product: p }
  })

  // ── Atualizar ──
  app.put('/api/admin/catalog/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const data: any = {}
    if (b.categoria !== undefined) data.categoria = String(b.categoria).slice(0, 100)
    if (b.nome !== undefined) data.nome = String(b.nome).slice(0, 191)
    if (b.marca !== undefined) data.marca = str(b.marca, 100)
    if (b.descricao !== undefined) data.descricao = str(b.descricao, 5000)
    if (b.sku !== undefined) data.sku = str(b.sku, 60)
    if (b.preco !== undefined) data.preco = parsePreco(b.preco)
    if (b.estoque !== undefined) data.estoque = parseInt2(b.estoque)
    if (b.disponivel !== undefined) data.disponivel = !!b.disponivel
    if (b.imageUrl !== undefined) data.imageUrl = str(b.imageUrl, 500)
    if (b.cobranca !== undefined) data.cobranca = parseCobranca(b.cobranca)
    const p = await prisma.product.update({ where: { id }, data }).catch(() => null)
    if (!p) return reply.code(404).send({ error: 'Produto não encontrado' })
    return { product: p }
  })

  // ── Excluir (soft) ──
  app.delete('/api/admin/catalog/:id', { preHandler: adminOnly }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.product.update({ where: { id }, data: { active: false } }).catch(() => {})
    return { ok: true }
  })

  // ── Modelo de importação (XLSX) ──
  app.get('/api/admin/catalog/template', { preHandler: adminOnly }, async (_req, reply) => {
    // Exemplos propositalmente neutros: o mesmo modelo serve para quem vende
  // mercadoria, curso, plano ou serviço recorrente.
  const example = [
      { categoria: 'Categoria A', nome: 'Item cobrado uma vez', marca: '', preco: '1500,00', cobranca: 'único', estoque: '', disponivel: 'sim', sku: 'COD-001', descricao: 'Descrição do que está incluído' },
      { categoria: 'Categoria B', nome: 'Item com mensalidade', marca: '', preco: '390,00', cobranca: 'mensalidade', estoque: '', disponivel: 'sim', sku: 'COD-002', descricao: 'O que o cliente recebe todo mês' },
    ]
    const ws = utils.json_to_sheet(example, { header: COLS as unknown as string[] })
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Produtos')
    const buf: Buffer = write(wb, { type: 'buffer', bookType: 'xlsx' })
    reply.header('Content-Disposition', 'attachment; filename="modelo-catalogo.xlsx"')
    reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return reply.send(buf)
  })

  // ── Importar planilha (upsert por SKU, senão por nome+categoria) ──
  app.post('/api/admin/catalog/import', { preHandler: adminOnly }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Arquivo é obrigatório (multipart "file")' })
    const buffer = await data.toBuffer()
    let rows: Record<string, any>[]
    try {
      const wb = read(buffer, { type: 'buffer', cellDates: false })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      rows = utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
    } catch {
      return reply.code(400).send({ error: 'Não foi possível ler a planilha (envie um .xlsx no modelo).' })
    }
    // normaliza chaves de cabeçalho (minúsculas sem acento)
    const norm = (k: string) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    let created = 0, updated = 0, skipped = 0
    for (const raw of rows) {
      const r: Record<string, any> = {}
      for (const k of Object.keys(raw)) r[norm(k)] = raw[k]
      const nome = str(r['nome'] ?? r['produto'] ?? r['modelo'], 191)
      const categoria = str(r['categoria'] ?? r['categoria '] ?? r['tipo'], 100)
      if (!nome || !categoria) { skipped++; continue }
      const payload = {
        categoria, nome, marca: str(r['marca'], 100), descricao: str(r['descricao'] ?? r['descrição'] ?? r['specs'], 5000),
        sku: str(r['sku'] ?? r['codigo'] ?? r['código'], 60), preco: parsePreco(r['preco'] ?? r['preço'] ?? r['valor']),
        estoque: parseInt2(r['estoque'] ?? r['qtd'] ?? r['quantidade']), disponivel: parseBool(r['disponivel'] ?? r['disponível'] ?? r['ativo']),
        cobranca: parseCobranca(r['cobranca'] ?? r['cobrança'] ?? r['tipo de cobranca'] ?? r['recorrencia']),
        active: true,
      }
      const existing = payload.sku
        ? await prisma.product.findFirst({ where: { sku: payload.sku } })
        : await prisma.product.findFirst({ where: { nome, categoria } })
      if (existing) { await prisma.product.update({ where: { id: existing.id }, data: payload }); updated++ }
      else { await prisma.product.create({ data: payload }); created++ }
    }
    return { ok: true, created, updated, skipped, total: rows.length }
  })
}
