// Relatório "Descontos concedidos" do Financeiro do portal (12/11/2026):
// cada desconto dado pela equipe numa fatura já gerada — quem deu, quem
// aprovou, motivo, de quanto para quanto. Fonte: services/descontoFatura.
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Download } from '@/components/ui/icon-set'
import { toast } from '@/lib/toast'
import { baixarCsv } from '@/lib/baixarCsv'
import { brl, quandoBr } from '@/components/educational/PagamentosDaMatricula'

interface Item {
  id: number; registrationId: number; portalId: number | null; codigo: string | null; aluno: string | null; portal: string | null; fatura: string
  modo: 'valor' | 'percentual' | 'cupom'; percentual: number | null; cupom: string | null
  antes: number; desconto: number; depois: number; situacao: 'aplicado' | 'aguardando_cartao' | 'nao_usado'
  motivo: string; aprovadoPor: string | null; por: string | null; em: string
}
interface Relatorio { itens: Item[]; total: number; quantidade: number; aguardando: number; porPessoa: Record<string, { quantidade: number; valor: number }> }

const SIT = {
  aplicado: { rotulo: 'Aplicado', tom: 'success' as const },
  aguardando_cartao: { rotulo: 'Aguardando cartão', tom: 'warning' as const },
  nao_usado: { rotulo: 'Não usado', tom: 'neutral' as const },
}

export function DescontosConcedidosCard({ de, ate, portalId }: { de?: string | undefined; ate?: string | undefined; portalId?: string | number | undefined }) {
  const qs = new URLSearchParams()
  if (de) qs.set('de', de)
  if (ate) qs.set('ate', ate)
  if (portalId) qs.set('portalId', String(portalId))
  const q = useQuery({ queryKey: ['descontos-concedidos', qs.toString()], queryFn: () => api.get<Relatorio>(`/admin/educational/portal-financeiro/descontos?${qs}`), staleTime: 30_000 })
  const r = q.data
  if (!r?.itens.length) return null
  const pessoas = Object.entries(r.porPessoa).sort((a, b) => b[1].valor - a[1].valor)

  return (
    <Card class="p-4 mb-4">
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <div class="text-sm font-semibold">Descontos concedidos pela equipe</div>
        <span class="text-xs text-fg-muted">{r.quantidade} desconto(s) · <strong class="text-fg tabular-nums">{brl(r.total)}</strong>{r.aguardando ? ` · ${r.aguardando} aguardando cartão` : ''}</span>
        <Button class="ml-auto" variant="secondary" size="sm" onClick={() => baixarCsv(`/admin/educational/portal-financeiro/descontos.csv?${qs}`, 'descontos-concedidos.csv').catch((e) => toast(e.message, 'danger'))}>
          <Download size={13} /> CSV
        </Button>
      </div>
      {pessoas.length > 1 && (
        <div class="flex flex-wrap gap-2 mb-3">{pessoas.map(([p, v]) => <Badge key={p} tone="neutral">{p}: {v.quantidade} · {brl(v.valor)}</Badge>)}</div>
      )}
      <Table minWidth="56rem">
        <THead><TR><TH>Data</TH><TH>Aluno</TH><TH>Fatura</TH><TH align="right">Desconto</TH><TH align="right">Ficou</TH><TH>Dado por / aprovado por</TH><TH>Motivo</TH><TH>Situação</TH></TR></THead>
        <TBody>
          {r.itens.map((i) => (
            <TR key={i.id}>
              <TD><span class="text-xs tabular-nums">{quandoBr(i.em)}</span></TD>
              <TD>
                <a class="text-sm text-accent hover:underline" href={`/app/enrollment-portals/${i.portalId}/registrations/${i.registrationId}`}>{i.aluno ?? '—'}</a>
                <div class="text-2xs text-fg-muted">{i.codigo}{i.portal ? ` · ${i.portal}` : ''}</div>
              </TD>
              <TD><span class="text-xs">{i.fatura}{i.cupom ? ` · cupom ${i.cupom}` : i.modo === 'percentual' && i.percentual ? ` · ${i.percentual.toLocaleString('pt-BR')}%` : ''}</span></TD>
              <TD align="right"><span class="tabular-nums font-medium">−{brl(i.desconto)}</span></TD>
              <TD align="right"><span class="tabular-nums text-xs">{brl(i.antes)} → {brl(i.depois)}</span></TD>
              <TD><span class="text-xs">{i.por ?? '—'}{i.aprovadoPor ? <div class="text-fg-muted">aprov.: {i.aprovadoPor}</div> : null}</span></TD>
              <TD><span class="text-xs line-clamp-2" title={i.motivo}>{i.motivo}</span></TD>
              <TD><Badge tone={SIT[i.situacao]?.tom ?? 'neutral'}>{SIT[i.situacao]?.rotulo ?? i.situacao}</Badge></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}
