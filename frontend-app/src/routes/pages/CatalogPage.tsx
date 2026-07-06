import { useState, useRef } from 'preact/hooks'
import { Boxes, Plus, Upload, Download, Pencil, Trash2 } from 'lucide-preact'
import {
  useCatalog, useCatalogCategories, useSaveProduct, useDeleteProduct, useImportCatalog,
  downloadCatalogTemplate, type Product, type ProductInput,
} from '@/hooks/useCatalog'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'

function fmtPreco(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  if (!isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const EMPTY: ProductInput = { categoria: '', nome: '', marca: '', descricao: '', preco: '', estoque: null, disponivel: true, sku: '' }

function ProductForm({ initial, onDone }: { initial: ProductInput; onDone: () => void }) {
  const [f, setF] = useState<ProductInput>(initial)
  const save = useSaveProduct()
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setF((p) => ({ ...p, [k]: v }))
  function submit() {
    if (!f.nome?.trim() || !f.categoria?.trim()) { toast('Nome e categoria são obrigatórios', 'danger'); return }
    save.mutate(f, {
      onSuccess: () => { toast(f.id ? 'Produto atualizado' : 'Produto adicionado', 'success'); onDone() },
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }
  return (
    <Card>
      <div class="text-sm font-semibold text-fg mb-3">{f.id ? 'Editar produto' : 'Novo produto'}</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Categoria *" value={f.categoria} placeholder="Celulares, Capas, Fones…" onInput={(e) => set('categoria', (e.target as HTMLInputElement).value)} />
        <Input label="Nome / modelo *" value={f.nome} placeholder="iPhone 15 128GB Preto" onInput={(e) => set('nome', (e.target as HTMLInputElement).value)} />
        <Input label="Marca" value={f.marca || ''} onInput={(e) => set('marca', (e.target as HTMLInputElement).value)} />
        <Input label="Preço (R$)" value={String(f.preco ?? '')} placeholder="6999,00" onInput={(e) => set('preco', (e.target as HTMLInputElement).value)} />
        <Input label="Estoque" type="number" value={f.estoque != null ? String(f.estoque) : ''} onInput={(e) => set('estoque', (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value, 10) : null)} />
        <Input label="SKU" value={f.sku || ''} onInput={(e) => set('sku', (e.target as HTMLInputElement).value)} />
      </div>
      <div class="mt-3">
        <Textarea label="Descrição / especificações" rows={2} value={f.descricao || ''} placeholder='Tela 6.1", câmera 48MP, USB-C' onInput={(e) => set('descricao', (e.target as HTMLTextAreaElement).value)} />
      </div>
      <label class="flex items-center gap-2 cursor-pointer select-none mt-3">
        <input type="checkbox" checked={f.disponivel !== false} onChange={(e) => set('disponivel', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
        <span class="text-sm text-fg">Disponível para venda</span>
      </label>
      <div class="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
      </div>
    </Card>
  )
}

export function CatalogPage() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [editing, setEditing] = useState<ProductInput | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, isLoading } = useCatalog(q, cat)
  const cats = useCatalogCategories()
  const del = useDeleteProduct()
  const imp = useImportCatalog()
  const products = data?.products || []

  function onImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    imp.mutate(file, {
      onSuccess: (r) => toast(`Importado: ${r.created} novos, ${r.updated} atualizados${r.skipped ? `, ${r.skipped} ignorados` : ''}`, 'success'),
      onError: (er: unknown) => toast((er as Error).message || 'Falha na importação', 'danger'),
    })
    if (fileRef.current) fileRef.current.value = ''
  }
  function remove(p: Product) {
    if (!confirm(`Remover "${p.nome}" do catálogo?`)) return
    del.mutate(p.id, { onSuccess: () => toast('Produto removido', 'success') })
  }

  return (
    <Page
      title="Catálogo de Produtos"
      description="Fonte da verdade do chatbot de IA. Cadastre os produtos aqui (manual ou por planilha) e a IA responde só com o que existe — sem inventar."
    >
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <Button variant="primary" size="sm" onClick={() => setEditing({ ...EMPTY })}><Plus size={14} /> Novo produto</Button>
        <Button variant="ghost" size="sm" onClick={() => downloadCatalogTemplate().catch(() => toast('Falha ao baixar o modelo', 'danger'))}><Download size={14} /> Baixar modelo</Button>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={imp.isPending}><Upload size={14} /> {imp.isPending ? 'Importando…' : 'Importar planilha'}</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" class="hidden" onChange={onImport} />
        <div class="flex-1" />
        <input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar produto…" class="px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg w-48" />
        <Select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} class="w-44">
          <option value="">Todas as categorias</option>
          {(cats.data?.categories || []).map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria} ({c.count})</option>)}
        </Select>
      </div>

      {editing ? <div class="mb-4"><ProductForm initial={editing} onDone={() => setEditing(null)} /></div> : null}

      {isLoading ? (
        <div class="space-y-2"><Skeleton class="h-14 w-full" /><Skeleton class="h-14 w-full" /></div>
      ) : products.length === 0 ? (
        <EmptyState icon={Boxes} title="Catálogo vazio" description="Adicione produtos manualmente ou importe a planilha (baixe o modelo acima). Depois, ative o módulo e a IA passa a responder com base neles." />
      ) : (
        <div class="space-y-2">
          {products.map((p) => (
            <Card key={p.id}>
              <div class="flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">{p.nome}</span>
                    <Badge tone="neutral">{p.categoria}</Badge>
                    {!p.disponivel ? <Badge tone="danger">Esgotado</Badge> : null}
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5">
                    {fmtPreco(p.preco)}
                    {p.marca ? <> · {p.marca}</> : null}
                    {p.estoque != null ? <> · estoque {p.estoque}</> : null}
                    {p.sku ? <> · {p.sku}</> : null}
                  </div>
                  {p.descricao ? <div class="text-xs text-fg-subtle mt-0.5 truncate">{p.descricao}</div> : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: p.id, categoria: p.categoria, nome: p.nome, marca: p.marca || '', descricao: p.descricao || '', preco: p.preco ?? '', estoque: p.estoque, disponivel: p.disponivel, sku: p.sku || '' })}><Pencil size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)} disabled={del.isPending}><Trash2 size={14} /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}
