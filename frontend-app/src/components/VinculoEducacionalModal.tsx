// Catálogo › Ligar ao Educacional (Fase 1 da integração Negociações × Educacional).
// 1) Cada produto do Catálogo aponta para o curso do Educacional que ele vende —
//    o sistema sugere pelo nome, o admin confirma.
// 2) Propostas antigas são ligadas às inscrições do mesmo lead quando o curso
//    bate (simula antes; só grava no clique).
// Backend: routes/catalog.ts (vinculo-cursos, vincular-propostas).

import { useEffect, useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

interface Curso { id: number; nome: string }
interface ProdutoVinculo { id: number; nome: string; categoria: string; courseId: number | null; sugestao: { id: number; nome: string; confianca: number } | null }
interface Simulacao { gravado: boolean; ligaveis: number; ambiguas: number; semInscricao: number; total: number; exemplos: Array<{ negotiationId: number; codigo: string; titulo: string; motivo: string }> }

export function VinculoEducacionalModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['catalog-vinculo-cursos'],
    queryFn: () => api.get<{ cursos: Curso[]; produtos: ProdutoVinculo[] }>('/admin/catalog/vinculo-cursos'),
  })
  const [escolha, setEscolha] = useState<Record<number, number | null>>({})
  useEffect(() => {
    if (!data) return
    setEscolha(Object.fromEntries(data.produtos.map((p) => [p.id, p.courseId ?? p.sugestao?.id ?? null])))
  }, [data])
  const [sim, setSim] = useState<Simulacao | null>(null)

  const salvar = useMutation({
    mutationFn: () => api.post<{ gravados: number }>('/admin/catalog/vinculo-cursos', {
      vinculos: Object.entries(escolha).map(([productId, courseId]) => ({ productId: Number(productId), courseId })),
    }),
    onSuccess: (r) => { toast(`${r.gravados} produto(s) atualizados`, 'success'); void qc.invalidateQueries({ queryKey: ['catalog-vinculo-cursos'] }); void qc.invalidateQueries({ queryKey: ['catalog'] }) },
    onError: (e: any) => toast(e?.message || 'Erro ao salvar', 'danger'),
  })
  const vincular = useMutation({
    mutationFn: (gravar: boolean) => api.post<Simulacao>('/admin/catalog/vincular-propostas', { gravar }),
    onSuccess: (r) => { setSim(r); if (r.gravado) toast(`${r.ligaveis} proposta(s) ligadas às inscrições`, 'success') },
    onError: (e: any) => toast(e?.message || 'Erro', 'danger'),
  })

  const ligados = data ? data.produtos.filter((p) => escolha[p.id]).length : 0
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Ligar o Catálogo ao Educacional" size="xl"
      description="Diga qual curso do Educacional cada produto vende. Com isso, propostas, metas e comissões passam a saber o curso vendido — sem depender do título da proposta."
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        <Button size="sm" onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={!data}>Salvar vínculos</Button>
      </>}>
      {isLoading || !data ? <Skeleton class="h-64" /> : (
        <div class="space-y-4">
          {data.cursos.length === 0 ? (
            <div class="text-sm text-fg-muted">Nenhum curso cadastrado no Educacional.</div>
          ) : (
            <>
              <div class="text-xs text-fg-muted">{ligados} de {data.produtos.length} produtos com curso. A sugestão vem do nome; confira antes de salvar.</div>
              <div class="max-h-[50vh] overflow-auto border border-border rounded-md divide-y divide-border">
                {data.produtos.map((p) => (
                  <div key={p.id} class="grid grid-cols-1 md:grid-cols-[1fr_18rem] gap-2 items-center px-3 py-2 text-sm">
                    <div class="min-w-0">
                      <div class="truncate">{p.nome}</div>
                      <div class="text-3xs text-fg-muted flex items-center gap-2">
                        {p.categoria}
                        {!p.courseId && p.sugestao && escolha[p.id] === p.sugestao.id && <Badge tone="info">sugestão ({Math.round(p.sugestao.confianca * 100)}%)</Badge>}
                      </div>
                    </div>
                    <Select value={String(escolha[p.id] ?? '')} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; setEscolha((s) => ({ ...s, [p.id]: v ? Number(v) : null })) }}>
                      <option value="">— não é curso —</option>
                      {data.cursos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}

          <div class="rounded-md border border-border p-3 space-y-2">
            <div class="text-sm font-medium">Propostas antigas → inscrições</div>
            <div class="text-xs text-fg-muted">Liga cada proposta à inscrição do mesmo lead quando o curso do item é o curso da inscrição (ou quando o lead tem uma só de cada). Salve os vínculos acima antes. Primeiro simule; nada é gravado até você confirmar.</div>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => vincular.mutate(false)} loading={vincular.isPending && !sim}>Simular</Button>
              {sim && !sim.gravado && sim.ligaveis > 0 && (
                <Button size="sm" onClick={() => vincular.mutate(true)} loading={vincular.isPending}>Ligar {sim.ligaveis} proposta(s)</Button>
              )}
            </div>
            {sim && (
              <div class="text-xs space-y-1">
                <div>{sim.gravado ? 'Ligadas' : 'Podem ser ligadas'}: <strong>{sim.ligaveis}</strong> · ambíguas (mais de uma inscrição do curso): {sim.ambiguas} · lead sem inscrição: {sim.semInscricao} · propostas sem vínculo: {sim.total}</div>
                {sim.exemplos.slice(0, 8).map((e) => <div key={e.negotiationId} class="text-fg-muted">#{e.negotiationId} {e.titulo} → {e.codigo} ({e.motivo})</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
