// Aba Financeiro: "Pagar o restante agora". O agente libera; o aluno paga no
// Meu Portal, no cartão, em até N vezes SEM juros (o valor é a soma das
// parcelas). Desconto só por cupom, que o próprio aluno aplica lá.
// Permissão: "Alterar forma de pagamento" (services/restanteAgora.ts).
import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { Copy } from '@/components/ui/icon-set'
import { invalidarInscricao } from './Dispensa'

interface Parcela { numero: number; titulo: string; valorCentavos: number; vencimento: string | null; situacao: string; cobrancaId: string | null }
interface Restante {
  status: 'liberado' | 'aguardando' | 'pago' | 'cancelado' | 'estornado'
  numeros: number[]; valorCentavos: number; parcelasMax: number; motivo: string; liberadoEm: string; porNome: string | null
  cobranca?: { invoiceUrl: string | null; valorCentavos: number; descontoCentavos: number; cupom: string | null; parcelas: number; em: string } | null
  pagoEm?: string | null; encerradoEm?: string | null; encerradoPor?: string | null
}
interface Estado { parcelas: Parcela[]; restante: Restante | null; impedimento: string | null; parcelasMax: number }

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

export function PagarRestante({ registrationId, fechada }: { registrationId: number; fechada: boolean }) {
  const qc = useQueryClient()
  const podeVer = useCan('edu_alterar_pagamento', 'view')
  const pode = useCan('edu_alterar_pagamento', 'edit')
  const base = `/admin/matricula-interna/${registrationId}/troca/restante`
  const q = useQuery({ queryKey: ['mi-restante', registrationId], queryFn: () => api.get<Estado>(base), enabled: podeVer })
  const [abrir, setAbrir] = useState(false)
  const [marcados, setMarcados] = useState<number[] | null>(null)
  const [vezes, setVezes] = useState('12')
  const [motivo, setMotivo] = useState('')
  const [cancelar, setCancelar] = useState(false)

  const atualizar = () => {
    for (const k of ['mi-restante', 'mi-financeiro', 'mi-troca']) void qc.invalidateQueries({ queryKey: [k, registrationId] })
    invalidarInscricao(qc, registrationId)
  }
  const d = q.data
  const escolhidos = marcados ?? d?.parcelas.map((p) => p.numero) ?? []
  const soma = d?.parcelas.filter((p) => escolhidos.includes(p.numero)).reduce((s, p) => s + p.valorCentavos, 0) ?? 0
  const n = Math.max(1, Number(vezes) || 1)

  const liberar = useMutation({
    mutationFn: () => api.post<{ valorCentavos: number }>(base, { numeros: escolhidos, parcelasMax: n, motivo }),
    onSuccess: (r) => { setAbrir(false); setMarcados(null); setMotivo(''); atualizar(); toast(`Liberado: o aluno paga ${brl(r.valorCentavos)} no cartão pelo Meu Portal.`, 'success') },
    onError: (e: unknown) => { atualizar(); toast((e as Error).message, 'danger') },
  })
  const cancelarM = useMutation({
    mutationFn: () => api.post(`${base}/cancelar`, {}),
    onSuccess: () => { setCancelar(false); atualizar(); toast('Pagamento do restante cancelado. As parcelas seguem como antes.', 'success') },
    onError: (e: unknown) => { setCancelar(false); atualizar(); toast((e as Error).message, 'danger') },
  })
  const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast('Link copiado', 'success')).catch(() => {}) }

  if (!podeVer || !d) return null
  const r = d.restante
  const vivo = r && (r.status === 'liberado' || r.status === 'aguardando')
  // Sem nada a pagar e sem histórico: a seção não aparece.
  if (!vivo && !d.parcelas.length && !r) return null
  const alternar = (num: number, v: boolean) => setMarcados(v ? [...escolhidos, num] : escolhidos.filter((x) => x !== num))
  const motivoOk = motivo.trim().length >= 3

  return (
    <Card>
      <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div>
          <div class="text-xs uppercase tracking-wider text-fg-muted">Pagar o restante agora</div>
          <div class="text-xs text-fg-muted mt-0.5">O aluno quita as parcelas que faltam no cartão, pelo Meu Portal: em até N vezes, sem juros. Desconto só por cupom, que ele aplica na tela dele.</div>
        </div>
        {pode && !fechada && !vivo && !abrir && !d.impedimento && d.parcelas.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAbrir(true)}>Liberar no cartão</Button>
        )}
      </div>

      {d.impedimento && !vivo && d.parcelas.length > 0 && <div class="text-xs text-fg-muted italic mb-2">{d.impedimento}</div>}

      {vivo && r && (
        <div class={`rounded-md border p-3 grid gap-2 mb-3 ${r.status === 'aguardando' ? 'border-warning/40 bg-warning/5' : 'border-accent/40 bg-accent/5'}`}>
          <div class="flex items-center gap-2 flex-wrap">
            <Badge tone={r.status === 'aguardando' ? 'warning' : 'info'}>{r.status === 'aguardando' ? 'Aluno abriu o pagamento' : 'Liberado para o aluno'}</Badge>
            <span class="text-sm text-fg"><strong class="tabular-nums">{brl(r.valorCentavos)}</strong> · {r.numeros.length} {r.numeros.length === 1 ? 'parcela' : 'parcelas'} · até {r.parcelasMax}x sem juros</span>
          </div>
          {r.cobranca && (
            <div class="text-xs text-fg-muted">
              Cobrança: <strong class="text-fg tabular-nums">{brl(r.cobranca.valorCentavos)}</strong> em {r.cobranca.parcelas}x
              {r.cobranca.cupom ? ` · cupom ${r.cobranca.cupom} (−${brl(r.cobranca.descontoCentavos)})` : ''}. As parcelas antigas valem até o cartão ser aprovado.
            </div>
          )}
          <div class="text-xs text-fg-muted">Liberado por {r.porNome ?? '—'} em {dia(r.liberadoEm)} · {r.motivo}. O aluno encontra em Meu Portal › Financeiro.</div>
          <div class="flex flex-wrap gap-2">
            {r.cobranca?.invoiceUrl && <Button size="sm" variant="secondary" onClick={() => copiar(r.cobranca!.invoiceUrl!)}><Copy size={12} /> Copiar link do cartão</Button>}
            {pode && <Button size="sm" variant="ghost" onClick={() => setCancelar(true)}>Cancelar</Button>}
          </div>
        </div>
      )}

      {r && !vivo && (
        <div class="text-xs text-fg-muted mb-2">
          Último: {r.status === 'pago' ? `pago em ${dia(r.pagoEm)} — ${brl(r.cobranca?.valorCentavos ?? r.valorCentavos)} em ${r.cobranca?.parcelas ?? 1}x${r.cobranca?.cupom ? `, cupom ${r.cobranca.cupom}` : ''}` : r.status === 'estornado' ? 'estornado no cartão: as parcelas voltaram a ser devidas' : `cancelado${r.encerradoPor ? ` por ${r.encerradoPor}` : ''} em ${dia(r.encerradoEm)}`}.
        </div>
      )}

      {abrir && (
        <div class="grid gap-3">
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full text-xs min-w-[26rem]">
              <thead><tr class="text-left text-fg-subtle border-b border-border"><th class="px-2 py-1.5 w-8" /><th class="px-2 py-1.5 font-medium">Parcela</th><th class="px-2 py-1.5 font-medium">Vencimento</th><th class="px-2 py-1.5 font-medium text-right">Valor</th></tr></thead>
              <tbody>{d.parcelas.map((p) => (
                <tr key={p.numero} class="border-b border-border last:border-0">
                  <td class="px-2 py-1.5"><input type="checkbox" aria-label={`Incluir ${p.titulo}`} checked={escolhidos.includes(p.numero)} onChange={(x) => alternar(p.numero, (x.target as HTMLInputElement).checked)} /></td>
                  <td class="px-2 py-1.5 text-fg">{p.titulo}{p.cobrancaId ? <span class="text-fg-muted"> · boleto gerado (é cancelado se o cartão passar)</span> : ''}</td>
                  <td class="px-2 py-1.5 tabular-nums">{dia(p.vencimento)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{brl(p.valorCentavos)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <Select label="Em até quantas vezes no cartão (sem juros)" value={vezes} onChange={(e) => setVezes((e.target as HTMLSelectElement).value)}>
              {Array.from({ length: d.parcelasMax }, (_, i) => i + 1).map((k) => (
                <option key={k} value={String(k)}>{k}x de {brl(Math.round(soma / k))}</option>
              ))}
            </Select>
            <div class="rounded-md border border-border p-3 text-sm">
              <div class="text-xs text-fg-muted">Total a pagar</div>
              <div class="text-lg font-semibold tabular-nums text-fg">{brl(soma)}</div>
              <div class="text-2xs text-fg-muted">Sem juros. Com cupom, o aluno vê o novo valor antes de pagar.</div>
            </div>
          </div>
          <Textarea label="Motivo" rows={2} value={motivo} placeholder="Ex.: aluno quer quitar a diferença da transferência no cartão" onInput={(x) => setMotivo((x.target as HTMLTextAreaElement).value)} />
          <div class="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setAbrir(false); setMarcados(null) }}>Fechar</Button>
            <Button size="sm" disabled={!escolhidos.length || !motivoOk || liberar.isPending} onClick={() => liberar.mutate()}>
              {liberar.isPending ? 'Liberando…' : `Liberar ${brl(soma)} no cartão`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelar}
        onOpenChange={(v) => { if (!v) setCancelar(false) }}
        title="Cancelar o pagamento do restante?"
        description={r?.status === 'aguardando' ? 'O link do cartão que o aluno abriu deixa de valer. As parcelas seguem como antes.' : 'O aluno deixa de ver a opção no Meu Portal. As parcelas seguem como antes.'}
        confirmLabel="Cancelar pagamento"
        destructive
        loading={cancelarM.isPending}
        onConfirm={() => cancelarM.mutate()}
      />
    </Card>
  )
}
