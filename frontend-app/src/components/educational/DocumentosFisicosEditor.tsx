// Documentos físicos de um modo de ingresso: o que a escola recebe em papel
// (ata, fichas, contrato, estágio, TCC, prova final…). Cada item pode valer só
// para alguns polos (condição sobre o polo escolhido na inscrição). O aluno não
// vê esta lista — a secretaria marca o recebimento na ficha da inscrição.
import { useEffect, useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { useCampuses } from '@/hooks/useEducational'

interface Item { id?: number | null; nome: string; condicao: { campo: string; valores: string[] } | null }

export function DocumentosFisicosEditor({ entryModeId, aoSalvar }: { entryModeId: number; aoSalvar?: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['modo-fisicos', entryModeId], queryFn: () => api.get<{ itens: Item[] }>(`/admin/educacional/entry-modes/${entryModeId}/fisicos`) })
  const polos = useCampuses()
  const [itens, setItens] = useState<Item[]>([])
  useEffect(() => { if (q.data) setItens(q.data.itens) }, [q.data])
  const salvar = useMutation({
    mutationFn: () => api.put<{ itens: Item[] }>(`/admin/educacional/entry-modes/${entryModeId}/fisicos`, { itens }),
    onSuccess: (r) => { setItens(r.itens); void qc.invalidateQueries({ queryKey: ['modo-fisicos', entryModeId] }); toast('Documentos físicos salvos', 'success'); aoSalvar?.() },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const lista = polos.data?.campuses ?? []
  const muda = (i: number, p: Partial<Item>) => setItens((xs) => xs.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const alternarPolo = (i: number, id: number) => {
    const atual = new Set(itens[i]?.condicao?.valores ?? [])
    atual.has(String(id)) ? atual.delete(String(id)) : atual.add(String(id))
    muda(i, { condicao: atual.size ? { campo: 'campusId', valores: [...atual] } : null })
  }
  if (q.isLoading) return <div class="text-xs text-fg-muted">Carregando…</div>
  return (
    <div class="space-y-3">
      <div class="text-xs text-fg-muted">
        Entregas em papel que a secretaria confere (o aluno não vê). Sem polo marcado, o item vale para todos;
        com polos marcados, só para quem escolheu um deles na inscrição (ex.: "somente ENSA").
      </div>
      {itens.length === 0 && <div class="text-xs text-fg-muted italic">Nenhum documento físico neste modo.</div>}
      <ul class="space-y-2">
        {itens.map((it, i) => (
          <li key={it.id ?? `novo-${i}`} class="rounded-md border border-border p-2 space-y-2">
            <div class="flex items-end gap-2">
              <div class="flex-1"><Input label={`Documento ${i + 1}`} value={it.nome} onInput={(e: any) => muda(i, { nome: e.currentTarget.value })} placeholder="Ex.: Ata de comparecimento à avaliação final" /></div>
              <Button size="sm" variant="ghost" onClick={() => setItens((xs) => xs.filter((_, k) => k !== i))} aria-label="Remover"><Trash2 size={12} /></Button>
            </div>
            {lista.length > 0 && (
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted">
                <span>Só para os polos:</span>
                {lista.map((c) => (
                  <label key={c.id} class="inline-flex items-center gap-1">
                    <input type="checkbox" checked={(it.condicao?.valores ?? []).includes(String(c.id))} onChange={() => alternarPolo(i, c.id)} />
                    {c.nome}{c.unit?.nome ? ` (${c.unit.nome})` : ''}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div class="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setItens((xs) => [...xs, { nome: '', condicao: null }])}><Plus size={12} /> Adicionar documento físico</Button>
        <Button size="sm" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
      </div>
    </div>
  )
}
