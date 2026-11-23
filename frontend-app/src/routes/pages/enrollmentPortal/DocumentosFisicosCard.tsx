// Documentos físicos da inscrição: o que a escola recebe em papel (ata, fichas,
// contrato assinado, estágio, TCC, prova final…). A secretaria marca o que chegou.
// A lista vem do modo de ingresso (Educacional › Modos de ingresso › Documentos
// físicos) e pode valer só para alguns polos. O aluno não vê.
import { useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, Check, Undo2 } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'

interface Item { id: number; nome: string; recebido: { em: string; porNome: string | null; observacao: string | null } | null }

export function DocumentosFisicosCard({ registrationId, podeOperar }: { registrationId: number; podeOperar: boolean }) {
  const qc = useQueryClient()
  const chave = ['doc-fisicos', registrationId]
  const q = useQuery({ queryKey: chave, queryFn: () => api.get<{ itens: Item[] }>(`/admin/enrollment-documents/fisicos/${registrationId}`), staleTime: 10_000 })
  const [marcando, setMarcando] = useState<number | null>(null)
  const [obs, setObs] = useState('')
  const [data, setData] = useState('')
  const marcar = useMutation({
    mutationFn: (reqId: number) => api.put(`/admin/enrollment-documents/fisicos/${registrationId}/${reqId}`, { observacao: obs || null, recebidoEm: data ? `${data}T12:00:00` : null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: chave }); setMarcando(null); setObs(''); setData(''); toast('Recebimento registrado', 'success') },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const desmarcar = useMutation({
    mutationFn: (reqId: number) => api.delete(`/admin/enrollment-documents/fisicos/${registrationId}/${reqId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: chave }); toast('Recebimento desfeito', 'success') },
    onError: (e: any) => toast(e?.message || 'Falha', 'danger'),
  })
  const itens = q.data?.itens ?? []
  if (!itens.length) return null
  const recebidos = itens.filter((i) => i.recebido).length
  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <div class="text-xs uppercase tracking-wider text-fg-muted flex items-center gap-1.5 flex-1"><Package size={12} /> Documentos físicos ({recebidos} de {itens.length})</div>
        <Badge tone={recebidos === itens.length ? 'success' : 'warning'}>{recebidos === itens.length ? 'Todos recebidos' : `${itens.length - recebidos} a receber`}</Badge>
      </div>
      <div class="text-2xs text-fg-muted mb-2">Entregas em papel conferidas pela secretaria. O aluno não vê esta lista.</div>
      <ul class="space-y-1.5">
        {itens.map((i) => (
          <li key={i.id} class="rounded-md border border-border p-2 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span class={`flex-1 min-w-[12rem] ${i.recebido ? 'text-fg' : 'text-fg-muted'}`}>{i.nome}</span>
              {i.recebido
                ? <Badge tone="success">Recebido em {new Date(i.recebido.em).toLocaleDateString('pt-BR')}</Badge>
                : <Badge tone="neutral">Aguardando</Badge>}
              {podeOperar && !i.recebido && marcando !== i.id && <Button size="sm" variant="secondary" onClick={() => setMarcando(i.id)}><Check size={12} /> Marcar recebido</Button>}
              {podeOperar && i.recebido && <Button size="sm" variant="ghost" disabled={desmarcar.isPending} onClick={() => desmarcar.mutate(i.id)}><Undo2 size={12} /> Desfazer</Button>}
            </div>
            {i.recebido && (i.recebido.porNome || i.recebido.observacao) && (
              <div class="text-2xs text-fg-muted mt-1">{i.recebido.porNome ? `por ${i.recebido.porNome}` : ''}{i.recebido.observacao ? ` · ${i.recebido.observacao}` : ''}</div>
            )}
            {marcando === i.id && (
              <div class="grid gap-2 sm:grid-cols-[10rem_1fr_auto] items-end mt-2">
                <Input type="date" label="Recebido em" value={data} onInput={(e: any) => setData(e.currentTarget.value)} />
                <Input label="Observação (opcional)" value={obs} onInput={(e: any) => setObs(e.currentTarget.value)} placeholder="Ex.: entregue no polo, via original" />
                <div class="flex gap-1">
                  <Button size="sm" loading={marcar.isPending} onClick={() => marcar.mutate(i.id)}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setMarcando(null); setObs(''); setData('') }}>Cancelar</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
