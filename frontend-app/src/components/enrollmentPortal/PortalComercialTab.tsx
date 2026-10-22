// Portal › Comercial: a inscrição vira PROPOSTA em Negociações, e a proposta
// ganha conta em Metas e Comissões (Fase 2 da integração, 22/10/2026).
// Regras do cliente: valor = só o que foi pago; vendedor = responsável da ficha
// na hora da inscrição; marco da venda escolhido aqui (pagamento ou jornada).
// Backend: routes/portalComercial.ts + services/propostaDaInscricao.ts.

import { useEffect, useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { useIsModuleActive } from '@/hooks/usePermissions'

type Marco = 'pagamento' | 'jornada'
interface Config { modo: 'desligado' | 'ativo'; marco: Marco }
interface Estado { config: Config; propostas: { total: number; abertas: number; ganhas: number; perdidas: number; valorGanho: number; geradasPeloPortal: number } }
interface Simulacao {
  marco: Marco; total: number; resumo: Record<string, number>; vendas: { quantidade: number; valor: number }
  linhas: Array<{ registrationId: number; codigo: string; curso: string; acao: string; motivo: string; valor: number; vendedor: string | null; ganha: boolean }>
}

const ACAO: Record<string, string> = { criar: 'Criar proposta', adotar: 'Ligar proposta existente', atualizar: 'Atualizar valor', ganhar: 'Ganhar', perder: 'Perder', reabrir: 'Reabrir', nada: 'Nada a fazer' }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function PortalComercialTab({ portal }: { portal: { id: number; nome: string } }) {
  const qc = useQueryClient()
  const negociacoes = useIsModuleActive('negotiations')
  const { data, isLoading } = useQuery({ queryKey: ['portal-comercial', portal.id], queryFn: () => api.get<Estado>(`/admin/enrollment-portals/${portal.id}/comercial`) })
  const [marco, setMarco] = useState<Marco>('pagamento')
  useEffect(() => { if (data) setMarco(data.config.marco) }, [data])
  const [sim, setSim] = useState<Simulacao | null>(null)
  const [confirmar, setConfirmar] = useState<'ligar' | 'desligar' | null>(null)

  const simular = useMutation({
    mutationFn: () => api.post<Simulacao>(`/admin/enrollment-portals/${portal.id}/comercial/simular`, { marco }),
    onSuccess: setSim,
    onError: (e: any) => toast(e?.message || 'Erro ao simular', 'danger'),
  })
  const salvar = useMutation({
    mutationFn: (b: Partial<Config>) => api.put<{ config: Config; aplicado: Record<string, number> | null }>(`/admin/enrollment-portals/${portal.id}/comercial`, b),
    onSuccess: (r) => {
      setConfirmar(null)
      void qc.invalidateQueries({ queryKey: ['portal-comercial', portal.id] })
      const n = r.aplicado ? Object.entries(r.aplicado).filter(([k]) => k !== 'nada').map(([k, v]) => `${v} ${ACAO[k]?.toLowerCase() ?? k}`).join(', ') : ''
      toast(r.config.modo === 'ativo' ? `Ligado.${n ? ' Aplicado: ' + n : ''}` : 'Salvo.', 'success')
    },
    onError: (e: any) => toast(e?.message || 'Erro ao salvar', 'danger'),
  })

  if (isLoading || !data) return <Skeleton class="h-64" />
  const ativo = data.config.modo === 'ativo'
  return (
    <div class="space-y-4">
      {negociacoes === false && (
        <div class="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">O módulo Negociações não está ativo nesta conta: as propostas são criadas, mas só aparecem quando o módulo for ligado.</div>
      )}
      <Card>
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold">Inscrição vira proposta</h3>
            <Badge tone={ativo ? 'success' : 'neutral'}>{ativo ? 'Ligado' : 'Desligado'}</Badge>
          </div>
          <p class="text-xs text-fg-muted">
            Cada inscrição deste portal ganha uma proposta em Negociações, com o vendedor (quem atendia a pessoa na hora da inscrição) e o valor <strong>pago</strong> — parcelas futuras e cobradas pelo SEI ficam de fora. Quando o marco da venda acontece, a proposta é ganha e entra em Metas e Comissões. Cancelamento ou estorno desfaz. Se o lead já tinha uma proposta manual aberta do mesmo curso, ela é ligada em vez de criar outra.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-2 items-center text-sm">
            <span class="text-fg-muted">A venda conta quando</span>
            <Select value={marco} onChange={(e) => setMarco((e.currentTarget as HTMLSelectElement).value as Marco)} class="max-w-sm">
              <option value="pagamento">o pagamento é confirmado</option>
              <option value="jornada">todas as etapas do portal são concluídas</option>
            </Select>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => simular.mutate()} loading={simular.isPending}>Simular</Button>
            {ativo ? (
              <>
                {marco !== data.config.marco && <Button size="sm" onClick={() => salvar.mutate({ marco })} loading={salvar.isPending}>Salvar marco</Button>}
                <Button size="sm" variant="ghost" onClick={() => setConfirmar('desligar')}>Desligar</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setConfirmar('ligar')} disabled={!sim}>Ligar</Button>
            )}
          </div>
          {!ativo && !sim && <div class="text-2xs text-fg-muted">Simule antes de ligar: a simulação mostra o que aconteceria com cada inscrição, sem gravar nada.</div>}
        </div>
      </Card>

      <Card>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div><div class="text-2xs text-fg-muted">Propostas ligadas</div><div class="text-lg font-semibold">{data.propostas.total}</div></div>
          <div><div class="text-2xs text-fg-muted">Abertas</div><div class="text-lg font-semibold">{data.propostas.abertas}</div></div>
          <div><div class="text-2xs text-fg-muted">Ganhas</div><div class="text-lg font-semibold">{data.propostas.ganhas}</div></div>
          <div><div class="text-2xs text-fg-muted">Perdidas</div><div class="text-lg font-semibold">{data.propostas.perdidas}</div></div>
          <div><div class="text-2xs text-fg-muted">Valor ganho</div><div class="text-lg font-semibold">{brl(data.propostas.valorGanho)}</div></div>
        </div>
      </Card>

      {sim && (
        <Card>
          <div class="space-y-2">
            <div class="text-sm font-semibold">Simulação ({sim.marco === 'jornada' ? 'venda = jornada concluída' : 'venda = pagamento confirmado'})</div>
            <div class="flex flex-wrap gap-2 text-xs">
              {Object.entries(sim.resumo).map(([k, v]) => <Badge key={k} tone={k === 'nada' ? 'neutral' : 'info'}>{ACAO[k] ?? k}: {v}</Badge>)}
              <Badge tone="success">Vendas: {sim.vendas.quantidade} · {brl(sim.vendas.valor)}</Badge>
            </div>
            <div class="max-h-[50vh] overflow-auto border border-border rounded-md">
              <table class="w-full text-xs">
                <thead class="text-fg-muted text-3xs uppercase"><tr class="border-b border-border"><th class="text-left px-2 py-1.5">Inscrição</th><th class="text-left px-2">Curso</th><th class="text-left px-2">O que faria</th><th class="text-right px-2">Valor</th><th class="text-left px-2">Vendedor</th></tr></thead>
                <tbody class="divide-y divide-border">
                  {sim.linhas.map((l) => (
                    <tr key={l.registrationId}>
                      <td class="px-2 py-1.5 font-mono">{l.codigo}</td>
                      <td class="px-2 truncate max-w-[14rem]">{l.curso}</td>
                      <td class="px-2">{ACAO[l.acao] ?? l.acao}{l.ganha && l.acao !== 'ganhar' ? ' (ganha)' : ''}<div class="text-3xs text-fg-muted">{l.motivo}</div></td>
                      <td class="px-2 text-right">{l.valor ? brl(l.valor) : '—'}</td>
                      <td class="px-2">{l.vendedor ?? <span class="text-fg-muted">sem vendedor</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {confirmar && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) setConfirmar(null) }}
          title={confirmar === 'ligar' ? 'Ligar inscrição → proposta neste portal?' : 'Desligar inscrição → proposta?'}
          description={confirmar === 'ligar'
            ? `As inscrições existentes recebem a proposta agora (o que a simulação mostrou) e as novas passam a receber automaticamente. As vendas entram em Metas e Comissões.`
            : 'As propostas já criadas continuam como estão; novas inscrições deixam de gerar proposta.'}
          confirmLabel={confirmar === 'ligar' ? 'Ligar' : 'Desligar'}
          loading={salvar.isPending}
          onConfirm={() => salvar.mutate(confirmar === 'ligar' ? { modo: 'ativo', marco } : { modo: 'desligado' })} />
      )}
    </div>
  )
}
