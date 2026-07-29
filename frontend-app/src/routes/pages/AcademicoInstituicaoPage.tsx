import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Building2, Plus, Pencil, ShieldCheck, AlertTriangle, Trash2 } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMantenedoras, useIesList, useAtos, useRemoveAto, type Ato } from '@/hooks/useAcaFundacao'
import { toast } from '@/lib/toast'

// Hierarquia institucional: mantenedora → IES → atos autorizativos.
// É a base do regulatório — Censo, e-MEC e diploma digital penduram aqui.
// Toda criação/edição acontece em tela dedicada, nunca em modal.

const ALERTA: Record<string, { tone: 'danger' | 'warning' | 'info'; texto: string }> = {
  vencido: { tone: 'danger', texto: 'Vencido' },
  critico: { tone: 'danger', texto: 'Vence em 30 dias' },
  atencao: { tone: 'warning', texto: 'Vence em 90 dias' },
  proximo: { tone: 'info', texto: 'Vence em 180 dias' },
}

function dataBr(s?: string | null) {
  return s ? new Date(s).toLocaleDateString('pt-BR') : '—'
}

export function AcademicoInstituicaoPage() {
  const [, navigate] = useLocation()
  const mantenedoras = useMantenedoras()
  const ies = useIesList()
  const atos = useAtos()
  const removeAto = useRemoveAto()
  const [iesSelecionada, setIesSelecionada] = useState<number | null>(null)

  const listaM = mantenedoras.data?.mantenedoras ?? []
  const listaI = ies.data?.ies ?? []
  const listaA = (atos.data?.atos ?? []).filter((a) => a.ativo)
  const atosDe = (iesId: number) => listaA.filter((a) => a.escopo === 'IES' && a.entidadeId === iesId)
  const vencendo = listaA.filter((a) => a.alerta && a.alerta !== 'proximo')

  function excluirAto(a: Ato) {
    if (!confirm(`Inativar o ato "${a.tipo} ${a.numero ?? ''}"? O histórico é preservado.`)) return
    removeAto.mutate(a.id, {
      onSuccess: () => toast('Ato inativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Instituição"
      description="Mantenedora, IES e atos autorizativos — a base do regulatório (Censo, e-MEC e diploma)."
      actions={
        <Button variant="primary" size="sm" onClick={() => navigate('/aca/instituicao/mantenedora/nova')}>
          <Plus size={14} /> Nova mantenedora
        </Button>
      }
    >
      {/* Atos vencendo primeiro: é a informação que exige ação */}
      {vencendo.length > 0 && (
        <Card class="!p-3 border-warning/40 bg-warning/5">
          <div class="flex items-start gap-2 text-sm">
            <AlertTriangle size={16} class="text-warning shrink-0 mt-0.5" />
            <div>
              <strong class="text-fg">{vencendo.length} ato(s) autorizativo(s) exigindo atenção.</strong>
              <div class="text-fg-muted text-xs mt-0.5">
                {vencendo.slice(0, 3).map((a) => `${a.tipo}${a.numero ? ` ${a.numero}` : ''} (${a.diasParaVencer! < 0 ? 'vencido' : `${a.diasParaVencer} dias`})`).join(' · ')}
              </div>
            </div>
          </div>
        </Card>
      )}

      {mantenedoras.isLoading ? (
        <Skeleton class="h-40 w-full" />
      ) : listaM.length === 0 ? (
        <EmptyState
          title="Nenhuma mantenedora cadastrada"
          description="A mantenedora é a pessoa jurídica que mantém a IES. Cadastre-a para liberar o restante da hierarquia."
        />
      ) : (
        <div class="space-y-4">
          {listaM.map((m) => {
            const filhas = listaI.filter((i) => i.mantenedoraId === m.id)
            return (
              <Card key={m.id} class="!p-0 overflow-hidden">
                <div class="px-4 py-3 flex items-start justify-between gap-3 bg-surface-2/50">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <Building2 size={15} class="text-fg-muted shrink-0" />
                      <span class="text-sm font-semibold text-fg truncate">{m.razaoSocial}</span>
                      {!m.ativo && <Badge tone="neutral">Inativa</Badge>}
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">
                      {m.cnpj ? `CNPJ ${m.cnpj}` : 'CNPJ não informado'}
                      {m.repNome ? ` · Rep.: ${m.repNome}` : ''}
                    </div>
                  </div>
                  <div class="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/instituicao/mantenedora/${m.id}`)}>
                      <Pencil size={13} /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/instituicao/ies/nova?mantenedora=${m.id}`)}>
                      <Plus size={13} /> IES
                    </Button>
                  </div>
                </div>

                {filhas.length === 0 ? (
                  <div class="px-4 py-4 text-xs text-fg-subtle">Nenhuma IES vinculada a esta mantenedora.</div>
                ) : (
                  <div class="divide-y divide-border">
                    {filhas.map((i) => {
                      const meusAtos = atosDe(i.id)
                      const aberto = iesSelecionada === i.id
                      return (
                        <div key={i.id} class="px-4 py-3">
                          <div class="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              class="text-left min-w-0 flex-1"
                              onClick={() => setIesSelecionada(aberto ? null : i.id)}
                            >
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-sm text-fg font-medium">{i.nome}</span>
                                {i.sigla && <Badge tone="neutral">{i.sigla}</Badge>}
                                {i.codigoEmec
                                  ? <Badge tone="info">e-MEC {i.codigoEmec}</Badge>
                                  : <Badge tone="warning">sem código e-MEC</Badge>}
                                <span class="text-[0.6875rem] text-fg-subtle">
                                  {meusAtos.length} ato(s)
                                </span>
                              </div>
                              <div class="text-xs text-fg-muted mt-0.5">
                                {[i.organizacaoAcad, i.categoriaAdmin].filter(Boolean).join(' · ') || 'Classificação não informada'}
                                {i.piNome ? ` · PI: ${i.piNome}` : ' · PI/RI não informado'}
                              </div>
                            </button>
                            <div class="flex gap-1.5 shrink-0">
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/instituicao/ies/${i.id}`)}>
                                <Pencil size={13} /> Editar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/instituicao/ato/IES/${i.id}`)}>
                                <ShieldCheck size={13} /> Ato
                              </Button>
                            </div>
                          </div>

                          {aberto && (
                            <div class="mt-3 rounded-md border border-border overflow-hidden">
                              {meusAtos.length === 0 ? (
                                <div class="px-3 py-3 text-xs text-fg-subtle">
                                  Nenhum ato autorizativo. Credenciamento e recredenciamento são exigidos no regulatório.
                                </div>
                              ) : (
                                <table class="w-full text-xs">
                                  <thead class="bg-surface-3 text-fg-subtle uppercase tracking-wider text-[0.625rem]">
                                    <tr>
                                      <th class="text-left px-3 py-1.5 font-medium">Tipo</th>
                                      <th class="text-left px-3 py-1.5 font-medium">Número</th>
                                      <th class="text-left px-3 py-1.5 font-medium">DOU</th>
                                      <th class="text-left px-3 py-1.5 font-medium">Validade</th>
                                      <th class="text-left px-3 py-1.5 font-medium">Situação</th>
                                      <th class="w-8"></th>
                                    </tr>
                                  </thead>
                                  <tbody class="divide-y divide-border">
                                    {meusAtos.map((a) => (
                                      <tr key={a.id}>
                                        <td class="px-3 py-1.5 text-fg capitalize">{a.tipo}</td>
                                        <td class="px-3 py-1.5 text-fg-muted">{a.numero ?? '—'}</td>
                                        <td class="px-3 py-1.5 text-fg-muted">{dataBr(a.dataDou)}</td>
                                        <td class="px-3 py-1.5 text-fg-muted">{dataBr(a.validadeAte)}</td>
                                        <td class="px-3 py-1.5">
                                          {a.alerta
                                            ? <Badge tone={ALERTA[a.alerta]!.tone}>{ALERTA[a.alerta]!.texto}</Badge>
                                            : <span class="text-fg-subtle">—</span>}
                                        </td>
                                        <td class="px-2 py-1.5">
                                          <button
                                            type="button"
                                            class="text-fg-subtle hover:text-danger"
                                            title="Inativar ato"
                                            onClick={() => excluirAto(a)}
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </Page>
  )
}
