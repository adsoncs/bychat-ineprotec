import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldBan, Trash2 } from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

interface Supressao { id: number; email: string; motivo: string; detalhe: string | null; criadoPor: string | null; criadoEm: string }
interface Resposta { itens: Supressao[]; total: number; porMotivo: Record<string, number> }

const MOTIVOS: Record<string, [string, 'danger' | 'warning' | 'neutral']> = {
  bounce: ['Endereço inexistente', 'danger'],
  spam: ['Marcou como spam', 'warning'],
  manual: ['Bloqueado à mão', 'neutral'],
}

/**
 * Endereços que não recebem mais e-mail. O sistema bloqueia sozinho quem
 * devolveu (bounce) ou reclamou (spam); desbloquear é decisão de alguém.
 */
export function EmailBloqueios() {
  const qc = useQueryClient()
  const [busca, setBusca] = useState('')
  const [novo, setNovo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['email-supressoes', busca],
    queryFn: () => api.get<Resposta>(`/admin/email-supressoes${busca ? `?q=${encodeURIComponent(busca)}` : ''}`),
  })
  const inval = () => qc.invalidateQueries({ queryKey: ['email-supressoes'] })
  const bloquear = useMutation({
    mutationFn: (email: string) => api.post('/admin/email-supressoes', { email }),
    onSuccess: () => { setNovo(''); inval(); toast('Endereço bloqueado', 'success') },
    onError: (e: Error) => toast(e.message, 'danger'),
  })
  const desbloquear = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/email-supressoes/${id}`),
    onSuccess: () => { inval(); toast('Endereço desbloqueado', 'success') },
    onError: (e: Error) => toast(e.message, 'danger'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"><ShieldBan size={16} class="text-fg-muted" /> Endereços bloqueados</CardTitle>
      </CardHeader>
      <div class="space-y-3">
        <p class="text-xs text-fg-muted">
          Quem devolveu o e-mail (endereço inexistente) ou marcou como spam deixa de receber automaticamente — insistir prejudica a entrega
          de todos os e-mails. Quem marcou como spam ainda recebe os e-mails do sistema (senha, acesso ao portal) e os escritos pela equipe.
        </p>
        {data && data.total > 0 && (
          <div class="flex flex-wrap gap-2 text-xs">
            {Object.entries(data.porMotivo).map(([m, n]) => <Badge key={m} tone={MOTIVOS[m]?.[1] ?? 'neutral'}>{MOTIVOS[m]?.[0] ?? m}: {n}</Badge>)}
          </div>
        )}
        <div class="flex flex-wrap gap-2 items-end">
          <div class="flex-1 min-w-[180px]"><Input label="Buscar" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} placeholder="parte do e-mail" /></div>
          <div class="flex-1 min-w-[180px]"><Input label="Bloquear um endereço" type="email" value={novo} onInput={(e) => setNovo((e.target as HTMLInputElement).value)} placeholder="nome@dominio.com" /></div>
          <Button variant="secondary" size="sm" disabled={!novo.trim() || bloquear.isPending} onClick={() => bloquear.mutate(novo.trim())}>Bloquear</Button>
        </div>
        {isLoading ? <div class="text-sm text-fg-muted">Carregando…</div>
          : !data?.itens.length ? <div class="text-sm text-fg-muted">Nenhum endereço bloqueado{busca ? ' com essa busca' : ''}.</div>
          : (
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead><tr class="text-left text-xs text-fg-muted"><th class="py-1.5 pr-3 font-medium">E-mail</th><th class="py-1.5 pr-3 font-medium">Motivo</th><th class="py-1.5 pr-3 font-medium">Desde</th><th /></tr></thead>
                <tbody>
                  {data.itens.map((s) => (
                    <tr key={s.id} class="border-t border-border">
                      <td class="py-1.5 pr-3 break-all">{s.email}{s.detalhe && <div class="text-xs text-fg-muted">{s.detalhe}</div>}</td>
                      <td class="py-1.5 pr-3"><Badge tone={MOTIVOS[s.motivo]?.[1] ?? 'neutral'}>{MOTIVOS[s.motivo]?.[0] ?? s.motivo}</Badge></td>
                      <td class="py-1.5 pr-3 whitespace-nowrap text-fg-muted">{new Date(s.criadoEm).toLocaleDateString('pt-BR')}</td>
                      <td class="py-1.5 text-right">
                        <Button variant="ghost" size="sm" aria-label={`Desbloquear ${s.email}`} disabled={desbloquear.isPending}
                          onClick={() => { if (confirm(`Desbloquear ${s.email}? Ele volta a receber e-mails.`)) desbloquear.mutate(s.id) }}>
                          <Trash2 size={14} /> Desbloquear
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </Card>
  )
}
