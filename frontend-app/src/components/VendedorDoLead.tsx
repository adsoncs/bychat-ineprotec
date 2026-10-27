import { useState } from 'preact/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { useUserStore } from '@/stores/user'
import { useDestinos } from '@/hooks/useDestinos'

/**
 * "Vendido por": quem estava com o lead no momento do Ganho. Comissão, metas e
 * placares contam por ele — transferir o lead depois (Secretaria, Financeiro…)
 * não muda. Só um administrador corrige, e a correção fica no histórico.
 */
export function VendedorDoLead({ leadId, vendedor }: { leadId: number; vendedor: { id: number; name: string | null } | null }) {
  const papel = useUserStore((s) => s.user?.role)
  const admin = papel === 'ADMIN' || papel === 'SUPERADMIN'
  const [editando, setEditando] = useState(false)
  const destinos = useDestinos(editando)
  const qc = useQueryClient()
  const corrigir = useMutation({
    mutationFn: (userId: number | null) => api.put<{ ok: true }>(`/bychat/leads/${leadId}/vendedor`, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', leadId] })
      toast('Vendedor corrigido — a comissão foi refeita', 'success')
      setEditando(false)
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  if (editando) {
    return (
      <span class="inline-flex items-center gap-1 text-2xs text-fg-muted">
        Vendido por
        <select
          class="h-7 rounded border border-border bg-surface px-1 text-xs text-fg"
          value={vendedor?.id ?? ''}
          disabled={corrigir.isPending || destinos.isLoading}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            corrigir.mutate(v ? Number(v) : null)
          }}
        >
          <option value="">sem vendedor</option>
          {(destinos.data?.pessoas ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" class="text-fg-muted hover:text-fg" onClick={() => setEditando(false)}>cancelar</button>
      </span>
    )
  }
  return (
    <span
      class="text-2xs text-fg-muted whitespace-nowrap"
      title="Quem estava com o lead no Ganho. Comissão e placar contam por esta pessoa; transferir o lead depois não muda."
    >
      Vendido por <strong class="text-fg font-medium">{vendedor?.name || '—'}</strong>
      {admin && (
        <button type="button" class="ml-1 underline hover:text-fg" onClick={() => setEditando(true)}>corrigir</button>
      )}
    </span>
  )
}
