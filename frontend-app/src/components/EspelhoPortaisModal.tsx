// Fase 5 (23/10/2026): o Catálogo como espelho das ofertas dos portais. Mostra
// o que mudaria (simulação) antes de ligar; ligado, a cópia roda sozinha a cada
// 10 min. Produtos cadastrados à mão não são tocados.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

interface Resultado {
  criados: { oferta: number; nome: string }[]
  atualizados: { oferta: number; nome: string; mudou: string[] }[]
  desativados: { produto: number; nome: string }[]
  semPlano: { oferta: number; nome: string; portal: string }[]
  iguais: number
}

export function EspelhoPortaisModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['espelho-portais'],
    queryFn: () => api.get<{ ligado: boolean; simulacao: Resultado }>('/admin/catalog/espelho-portais'),
  })
  const atualizar = () => { qc.invalidateQueries({ queryKey: ['espelho-portais'] }); qc.invalidateQueries({ queryKey: ['catalog'] }) }
  const ligar = useMutation({
    mutationFn: (ligado: boolean) => api.put<{ ligado: boolean; resultado: Resultado | null }>('/admin/catalog/espelho-portais', { ligado }),
    onSuccess: (r) => { atualizar(); toast(r.ligado ? `Espelho ligado: ${r.resultado?.criados.length ?? 0} criado(s), ${r.resultado?.atualizados.length ?? 0} atualizado(s)` : 'Espelho desligado', 'success') },
  })
  const sinc = useMutation({
    mutationFn: () => api.post<{ resultado: Resultado }>('/admin/catalog/espelho-portais/sincronizar', {}),
    onSuccess: (r) => { atualizar(); toast(`${r.resultado.criados.length} criado(s), ${r.resultado.atualizados.length} atualizado(s), ${r.resultado.desativados.length} desativado(s)`, 'success') },
  })
  const s = data?.simulacao
  const pend = s ? s.criados.length + s.atualizados.length + s.desativados.length : 0
  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title="Espelho dos portais"
      description="Um produto para cada oferta dos portais, com o mesmo nome e o preço do curso pelo plano; a categoria é o nome do portal. Produtos cadastrados à mão não mudam."
      size="lg"
      footer={
        <div class="flex justify-end gap-2">
          {data?.ligado ? <Button variant="ghost" size="md" onClick={() => ligar.mutate(false)} disabled={ligar.isPending}>Desligar</Button> : null}
          {data?.ligado
            ? <Button variant="primary" size="md" onClick={() => sinc.mutate()} disabled={sinc.isPending || !pend}>{sinc.isPending ? 'Copiando…' : 'Copiar agora'}</Button>
            : <Button variant="primary" size="md" onClick={() => ligar.mutate(true)} disabled={ligar.isPending || isLoading}>{ligar.isPending ? 'Ligando…' : 'Ligar e copiar'}</Button>}
        </div>
      }
    >
      {isLoading || !s ? <Skeleton class="h-40 w-full" /> : (
        <div class="space-y-3 text-sm">
          <div class="flex items-center gap-2">
            {data?.ligado ? <Badge tone="success">Ligado — copia a cada 10 min</Badge> : <Badge tone="neutral">Desligado</Badge>}
            <span class="text-fg-muted">{s.iguais} produto(s) já iguais aos portais.</span>
          </div>
          <Lista titulo="Serão criados" itens={s.criados.map((c) => c.nome)} />
          <Lista titulo="Serão atualizados" itens={s.atualizados.map((c) => `${c.nome} (${c.mudou.join(', ')})`)} />
          <Lista titulo="Serão desativados (saíram dos portais)" itens={s.desativados.map((c) => c.nome)} />
          <Lista titulo="Ofertas sem plano de pagamento (ficam fora até ter preço)" itens={s.semPlano.map((c) => `${c.nome} · ${c.portal}`)} />
        </div>
      )}
    </Modal>
  )
}

function Lista({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (!itens.length) return null
  return (
    <div>
      <div class="text-xs uppercase tracking-wide text-fg-muted mb-1">{titulo} ({itens.length})</div>
      <ul class="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {itens.map((t, i) => <li key={i} class="px-2 py-1 text-xs text-fg">{t}</li>)}
      </ul>
    </div>
  )
}
