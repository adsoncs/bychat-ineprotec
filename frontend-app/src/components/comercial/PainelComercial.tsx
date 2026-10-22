// Painel comercial do Educacional: vendas das inscrições (propostas ganhas),
// vendedores × meta, e quebras por portal, curso e polo. Mesmos dados de
// Negociações e Metas & Comissões, só recortados (Fase 3, 22/10/2026).
// Usado na página Educacional › Comercial e na aba Comercial de cada portal.

import { useEffect, useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { usePainelComercial, useSalvarMetaPortal, type LinhaResumo } from '@/hooks/useComercial'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { useCourses, useCampuses } from '@/hooks/useEducational'

const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)

function Tabela({ titulo, linhas }: { titulo: string; linhas: LinhaResumo[] }) {
  const total = linhas.reduce((s, l) => s + l.valor, 0) || 1
  return (
    <Card>
      <div class="text-sm font-semibold mb-2">{titulo}</div>
      {linhas.length === 0 ? <div class="text-xs text-fg-muted">Sem vendas no mês.</div> : (
        <div class="space-y-1.5">
          {linhas.map((l) => (
            <div key={String(l.id)} class="text-xs">
              <div class="flex justify-between gap-2"><span class="truncate">{l.nome}</span><span class="shrink-0">{l.quantidade} · <strong>{brl(l.valor)}</strong></span></div>
              <div class="h-1.5 rounded bg-surface-3 overflow-hidden"><div class="h-full bg-accent" style={{ width: `${Math.max(2, (l.valor / total) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function PainelComercial({ portalId }: { portalId?: number }) {
  const [mes, setMes] = useState(mesAtual())
  const [portal, setPortal] = useState<number | null>(portalId ?? null)
  const [curso, setCurso] = useState<number | null>(null)
  const [polo, setPolo] = useState<number | null>(null)
  const filtro = { mes, portalId: portalId ?? portal, courseId: curso, campusId: polo }
  const { data, isLoading } = usePainelComercial(filtro)
  const portais = useEnrollmentPortals()
  const cursos = useCourses()
  const locais = useCampuses()
  const salvarMeta = useSalvarMetaPortal()
  const [meta, setMeta] = useState<{ valor: string; quantidade: string }>({ valor: '', quantidade: '' })
  useEffect(() => { setMeta({ valor: data?.metaPortal?.valor != null ? String(data.metaPortal.valor) : '', quantidade: data?.metaPortal?.quantidade != null ? String(data.metaPortal.quantidade) : '' }) }, [data?.metaPortal?.valor, data?.metaPortal?.quantidade, data?.mes])
  const portalDaMeta = portalId ?? portal

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex flex-wrap items-end gap-2">
          <Input label="Mês" type="month" value={mes} onInput={(e) => setMes((e.currentTarget as HTMLInputElement).value || mesAtual())} class="w-40" />
          {!portalId && (
            <Select label="Portal" value={portal ? String(portal) : ''} onChange={(e) => setPortal(Number((e.currentTarget as HTMLSelectElement).value) || null)} class="w-56">
              <option value="">Todos os portais</option>
              {(portais.data?.portals ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          )}
          <Select label="Curso" value={curso ? String(curso) : ''} onChange={(e) => setCurso(Number((e.currentTarget as HTMLSelectElement).value) || null)} class="w-56">
            <option value="">Todos os cursos</option>
            {((cursos.data as any)?.courses ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select label="Polo / local" value={polo ? String(polo) : ''} onChange={(e) => setPolo(Number((e.currentTarget as HTMLSelectElement).value) || null)} class="w-56">
            <option value="">Todos os locais</option>
            {((locais.data as any)?.campuses ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading || !data ? <Skeleton class="h-64" /> : (
        <>
          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              ['Vendas no mês', String(data.kpis.vendas)], ['Valor vendido', brl(data.kpis.valorVendas)], ['Ticket médio', brl(data.kpis.ticket)],
              ['Propostas abertas', `${data.kpis.abertas} · ${brl(data.kpis.valorAberto)}`], ['Perdidas no mês', String(data.kpis.perdidas)],
              ['Conversão', data.kpis.conversao != null ? `${data.kpis.conversao}%` : '—'], ['Comissões', brl(data.kpis.comissao)],
            ].map(([t, v]) => <Card key={t}><div class="text-2xs text-fg-muted">{t}</div><div class="text-base font-semibold">{v}</div></Card>)}
          </div>
          {data.kpis.inscricoes > 0 && data.kpis.inscricoesComProposta === 0 && (
            <div class="rounded-md border border-info/30 bg-info/5 p-3 text-xs">Nenhuma inscrição deste recorte virou proposta ainda. Ligue "Inscrição vira proposta" na aba Comercial do portal.</div>
          )}

          {portalDaMeta && (
            <Card>
              <div class="flex flex-wrap items-end gap-2">
                <div class="text-sm font-semibold mr-2">Meta do portal em {data.mes}</div>
                <Input label="Valor (R$)" type="number" value={meta.valor} onInput={(e) => setMeta((m) => ({ ...m, valor: (e.currentTarget as HTMLInputElement).value }))} class="w-36" />
                <Input label="Vendas" type="number" value={meta.quantidade} onInput={(e) => setMeta((m) => ({ ...m, quantidade: (e.currentTarget as HTMLInputElement).value }))} class="w-28" />
                <Button size="sm" variant="secondary" loading={salvarMeta.isPending}
                  onClick={() => salvarMeta.mutate({ portalId: portalDaMeta, mes: data.mes, valor: meta.valor ? Number(meta.valor) : null, quantidade: meta.quantidade ? Number(meta.quantidade) : null }, { onSuccess: () => toast('Meta salva', 'success'), onError: (e: any) => toast(e?.message || 'Erro', 'danger') })}>
                  Salvar meta
                </Button>
                {data.metaPortal && (
                  <div class="flex gap-2 text-xs ml-2">
                    {data.metaPortal.atingimentoValor != null && <Badge tone={data.metaPortal.atingimentoValor >= 100 ? 'success' : 'info'}>{data.metaPortal.atingimentoValor}% do valor</Badge>}
                    {data.metaPortal.atingimentoQuantidade != null && <Badge tone={data.metaPortal.atingimentoQuantidade >= 100 ? 'success' : 'info'}>{data.metaPortal.atingimentoQuantidade}% das vendas</Badge>}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <div class="text-sm font-semibold mb-2">Vendedores</div>
            {data.porVendedor.length === 0 ? <div class="text-xs text-fg-muted">Sem vendas no mês.</div> : (
              <table class="w-full text-xs">
                <thead class="text-fg-muted text-3xs uppercase"><tr class="border-b border-border"><th class="text-left py-1.5">Vendedor</th><th class="text-right">Vendas</th><th class="text-right">Valor</th><th class="text-right">Meta (Metas & Comissões)</th><th class="text-right">Comissão</th></tr></thead>
                <tbody class="divide-y divide-border">
                  {data.porVendedor.map((v) => (
                    <tr key={String(v.userId)}>
                      <td class="py-1.5">{v.nome}</td><td class="text-right">{v.quantidade}</td><td class="text-right">{brl(v.valor)}</td>
                      <td class="text-right">{v.meta.valor != null ? <>{brl(v.meta.valor)}{v.atingimento != null && <span class="text-fg-muted"> · {v.atingimento}%</span>}</> : <span class="text-fg-muted">—</span>}</td>
                      <td class="text-right">{brl(v.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {!portalId && <Tabela titulo="Por portal" linhas={data.porPortal} />}
            <Tabela titulo="Por curso" linhas={data.porCurso} />
            <Tabela titulo="Por polo / local" linhas={data.porPolo} />
          </div>

          <Card>
            <div class="text-sm font-semibold mb-2">Vendas do mês</div>
            {data.vendasDoMes.length === 0 ? <div class="text-xs text-fg-muted">Nenhuma venda no mês.</div> : (
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead class="text-fg-muted text-3xs uppercase"><tr class="border-b border-border"><th class="text-left py-1.5">Aluno</th><th class="text-left">Inscrição</th><th class="text-left">Curso</th><th class="text-left">Polo</th><th class="text-left">Vendedor</th><th class="text-right">Valor</th><th class="text-right">Comissão</th><th class="text-right">Data</th></tr></thead>
                  <tbody class="divide-y divide-border">
                    {data.vendasDoMes.map((v) => (
                      <tr key={v.negotiationId}>
                        <td class="py-1.5">{v.leadId ? <Link href={`/app/leads/${v.leadId}`} class="text-info hover:underline">{v.nome || `#${v.leadId}`}</Link> : v.nome}</td>
                        <td class="font-mono">{v.codigo}</td><td>{v.curso}</td><td>{v.polo ?? '—'}</td><td>{v.vendedor ?? '—'}</td>
                        <td class="text-right">{brl(v.valor)}</td>
                        <td class="text-right">{v.comissao != null ? <>{brl(v.comissao)} <span class="text-fg-muted">({v.comissaoStatus})</span></> : '—'}</td>
                        <td class="text-right">{new Date(v.fechadaEm).toLocaleDateString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
