// Conciliação por conta do Asaas (24/11): para cada conta (uma por empresa),
// o que entrou no período × o que o sistema tem como pago. Divergência primeiro.
// Só leitura — a consulta ao Asaas roda quando a pessoa clica em "Conferir".
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EtiquetaUnidade, type MarcaUnidade } from '@/components/educational/UnidadeFinanceiro'

type Situacao = 'conciliado' | 'aberto_no_sistema' | 'sem_vinculo'
interface Linha {
  paymentId: string; data: string; valor: number; liquido: number; meio: string; descricao: string; situacao: Situacao; explicacao: string
  registrationId: number | null; portalId: number | null; codigo: string | null; leadId: number | null; nome: string | null; invoiceUrl: string | null
}
interface Conta {
  conexaoId: number; conexao: string; unidade: MarcaUnidade | null; recebido: number; liquido: number; taxas: number
  pagamentos: number; conciliados: number; divergentes: number; linhas: Linha[]; falha: string | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const hojeBr = (delta = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + delta * 86_400_000))
const SIT: Record<Situacao, { rotulo: string; tom: 'success' | 'danger' | 'warning' }> = {
  conciliado: { rotulo: 'Conciliado', tom: 'success' },
  aberto_no_sistema: { rotulo: 'Pago no Asaas, aberto no sistema', tom: 'danger' },
  sem_vinculo: { rotulo: 'Sem vínculo no sistema', tom: 'warning' },
}

export function ConciliacaoAsaasCard({ unitId }: { unitId?: string | undefined }) {
  const [de, setDe] = useState(hojeBr(-1))
  const [ate, setAte] = useState(hojeBr(0))
  const [pedido, setPedido] = useState<string | null>(null)
  const [verTudo, setVerTudo] = useState(false)
  const chave = `de=${de}&ate=${ate}${unitId ? `&unitId=${unitId}` : ''}`
  const q = useQuery({
    queryKey: ['portal-financeiro', 'conciliacao', pedido],
    queryFn: () => api.get<{ de: string; ate: string; contas: Conta[] }>(`/admin/educational/portal-financeiro/conciliacao?${pedido}`),
    enabled: !!pedido, staleTime: 60_000,
  })
  const desatualizada = !!pedido && pedido !== chave
  return (
    <Card class="p-4 mb-4">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <div class="text-sm font-semibold">Conciliação com o Asaas</div>
          <div class="text-xs text-fg-muted">O que entrou em cada conta do Asaas no período, comparado com o que o sistema tem como pago.</div>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <div class="w-36"><Input label="Pago de" type="date" value={de} max={ate} onInput={(e) => setDe((e.target as HTMLInputElement).value)} /></div>
          <div class="w-36"><Input label="Até" type="date" value={ate} min={de} max={hojeBr(0)} onInput={(e) => setAte((e.target as HTMLInputElement).value)} /></div>
          <Button size="sm" variant="primary" disabled={q.isFetching} onClick={() => { setPedido(chave); if (pedido === chave) void q.refetch() }}>{q.isFetching ? 'Conferindo…' : 'Conferir'}</Button>
        </div>
      </div>
      {!pedido && <div class="text-xs text-fg-muted">Escolha o período e clique em Conferir. A consulta lê o Asaas na hora; não muda nada.</div>}
      {desatualizada && <div class="text-xs text-warning mb-2">O período ou a unidade mudou: clique em Conferir de novo.</div>}
      {q.isFetching && <Skeleton class="h-24" />}
      {q.isError && <div class="text-sm text-danger">{(q.error as Error).message}</div>}
      {q.data && !q.isFetching && (
        <div class="grid gap-3">
          {!q.data.contas.length && <div class="text-sm text-fg-muted">Nenhuma conta do Asaas ativa para esta unidade.</div>}
          {q.data.contas.map((c) => {
            const linhas = verTudo ? c.linhas : c.linhas.filter((l) => l.situacao !== 'conciliado')
            return (
              <div key={c.conexaoId} class="rounded-md border border-border">
                <div class="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-border">
                  <div class="flex items-center gap-2"><span class="text-sm font-semibold">{c.conexao}</span><EtiquetaUnidade u={c.unidade} /></div>
                  <div class="flex flex-wrap gap-3 text-xs">
                    <span>Recebido <b class="tabular-nums">{brl(c.recebido)}</b></span>
                    <span>Líquido <b class="tabular-nums">{brl(c.liquido)}</b></span>
                    <span class="text-fg-muted">Taxas {brl(c.taxas)}</span>
                    <span>{c.pagamentos} pagamento(s)</span>
                    <Badge tone="success">{c.conciliados} conciliado(s)</Badge>
                    {c.divergentes > 0 ? <Badge tone="danger">{c.divergentes} para conferir</Badge> : <Badge tone="success">Tudo bate</Badge>}
                  </div>
                </div>
                {c.falha && <div class="px-3 py-2 text-xs text-danger">Não foi possível ler esta conta no Asaas: {c.falha}</div>}
                {!linhas.length ? <div class="px-3 py-2 text-xs text-fg-muted">{c.pagamentos ? 'Todos os pagamentos do período estão no sistema.' : 'Nenhum pagamento no período.'}</div> : (
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm min-w-[48rem]">
                      <thead><tr class="text-left text-xs text-fg-subtle border-b border-border">
                        <th class="px-3 py-1.5 font-medium">Pago em</th><th class="px-2 py-1.5 font-medium">Aluno</th><th class="px-2 py-1.5 font-medium text-right">Valor</th>
                        <th class="px-2 py-1.5 font-medium">Meio</th><th class="px-2 py-1.5 font-medium">Situação</th>
                      </tr></thead>
                      <tbody>
                        {linhas.map((l) => (
                          <tr key={l.paymentId} class="border-b border-border last:border-0 align-top">
                            <td class="px-3 py-2 text-xs tabular-nums">{dia(l.data)}</td>
                            <td class="px-2 py-2">
                              <div class="font-medium">{l.nome ?? '—'}</div>
                              <div class="text-xs text-fg-muted">
                                {l.codigo && l.portalId && l.registrationId
                                  ? <a class="text-accent hover:underline" href={`${env.appBasePath}/enrollment-portals/${l.portalId}/registrations/${l.registrationId}`} target="_blank" rel="noopener noreferrer">{l.codigo}</a>
                                  : (l.descricao || l.paymentId)}
                                {l.invoiceUrl && <> · <a class="text-accent hover:underline" href={l.invoiceUrl} target="_blank" rel="noopener noreferrer">ver no Asaas</a></>}
                              </div>
                            </td>
                            <td class="px-2 py-2 text-right tabular-nums">{brl(l.valor)}{l.liquido !== l.valor && <div class="text-2xs text-fg-muted">líquido {brl(l.liquido)}</div>}</td>
                            <td class="px-2 py-2 text-xs">{l.meio}</td>
                            <td class="px-2 py-2"><Badge tone={SIT[l.situacao].tom}>{SIT[l.situacao].rotulo}</Badge><div class="text-2xs text-fg-muted mt-1">{l.explicacao}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
          {q.data.contas.some((c) => c.conciliados > 0) && (
            <button type="button" class="text-xs text-accent hover:underline justify-self-start" onClick={() => setVerTudo((v) => !v)}>{verTudo ? 'Mostrar só o que precisa conferir' : 'Mostrar também os conciliados'}</button>
          )}
        </div>
      )}
    </Card>
  )
}
