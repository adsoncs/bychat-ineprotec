// Aba Financeiro: mudar a forma do que ainda não foi pago. Só no painel, com permissão
// própria. Para cartão, os pagamentos antigos valem até a aprovação do novo.
import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { Copy } from '@/components/ui/icon-set'
import { invalidarInscricao } from './Dispensa'

interface Elegivel { id: number; ordem: number; origem: string; acordoId: number | null; meio: string; valor: number; vencimento: string; grupo: string | null }
interface Item { meio: string; valorCentavos: number; vencimento: string; parcelasCartao?: number }
interface Estado {
  elegiveis: Elegivel[]
  pendente: { id: number; expiraEm: string | null; novoTotal: number; saldo: number; motivo: string; por: string | null; link: string | null; parcelas: number } | null
  historico: Array<{ id: number; status: string; saldo: number; novoTotal: number; motivo: string; por: string | null; em: string; nota: string | null; antes: Item[]; depois: Item[] }>
  contratoAssinado: boolean
  prazoDias: number
}
interface Linha { meio: string; valor: string; vencimento: string; parcelas: string }

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const numero = (s: string) => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
const SIT: Record<string, { r: string; t: 'success' | 'warning' | 'neutral' }> = { CONCLUIDA: { r: 'Concluída', t: 'success' }, PENDENTE: { r: 'Aguardando o cartão', t: 'warning' }, CANCELADA: { r: 'Cancelada', t: 'neutral' }, EXPIRADA: { r: 'Prazo encerrado', t: 'neutral' } }
const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',')

export function AlterarFormaPagamento({ registrationId, fechada }: { registrationId: number; fechada: boolean }) {
  const qc = useQueryClient()
  const podeVer = useCan('edu_alterar_pagamento', 'view')
  const pode = useCan('edu_alterar_pagamento', 'edit')
  const base = `/admin/matricula-interna/${registrationId}/troca`
  const q = useQuery({ queryKey: ['mi-troca', registrationId], queryFn: () => api.get<Estado>(base), enabled: podeVer })
  const [abrir, setAbrir] = useState(false)
  const [marcados, setMarcados] = useState<number[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([{ meio: 'credit_card', valor: '', vencimento: hoje(), parcelas: '1' }])
  const [total, setTotal] = useState('')
  const [alterarValor, setAlterarValor] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [cancelar, setCancelar] = useState(false)
  const [link, setLink] = useState<string | null>(null)

  const atualizar = () => {
    for (const k of ['mi-troca', 'mi-combinado', 'mi-financeiro']) void qc.invalidateQueries({ queryKey: [k, registrationId] })
    invalidarInscricao(qc, registrationId)
  }
  const d = q.data
  const selecionados = d?.elegiveis.filter((e) => marcados.includes(e.id)) ?? []
  const saldo = selecionados.reduce((s, e) => s + e.valor, 0)
  const novoTotal = alterarValor ? Math.round(numero(total) * 100) : saldo
  const soma = Math.round(linhas.reduce((s, l) => s + numero(l.valor), 0) * 100)
  // Novo total menor que o saldo = parte da dívida deixa de existir: exige o motivo
  // da redução (mesma regra do servidor, 15 caracteres).
  const reduz = novoTotal < saldo
  const motivoMinimo = reduz ? 15 : 3
  // Um envio por vez (botão travado enquanto processa): o Asaas pode demorar, e
  // cliques repetidos disparavam várias trocas ao mesmo tempo (ineprotec 12/11).
  const criar = useMutation({
    mutationFn: () => api.post<{ pendente: boolean; link: string | null; falhas: string[] }>(base, {
      titulos: marcados, total: novoTotal / 100, motivo,
      linhas: linhas.map((l) => ({ meio: l.meio === 'boleto_parcelado' ? 'boleto' : l.meio, valor: numero(l.valor), vencimento: l.vencimento, parcelas: l.meio === 'boleto' || l.meio === 'pix' ? 1 : Number(l.parcelas) })),
    }),
    onSuccess: (r) => {
      setConfirmar(false); setAbrir(false); setMarcados([]); setMotivo(''); setAlterarValor(false); atualizar(); setLink(r.link)
      if (r.falhas.length) toast(`Troca feita, com atenção: ${r.falhas.join(' · ')}`, 'danger')
      else toast(r.pendente ? 'Link gerado. Os pagamentos antigos valem até o cartão ser aprovado.' : 'Forma de pagamento alterada.', 'success')
    },
    onError: (e: unknown) => { setConfirmar(false); atualizar(); toast((e as Error).message, 'danger') },
  })
  const cancelarM = useMutation({
    mutationFn: () => api.post(`${base}/${d!.pendente!.id}/cancelar`, { motivo: 'Cancelada pelo agente' }),
    onSuccess: () => { setCancelar(false); setLink(null); atualizar(); toast('Troca cancelada. Os pagamentos antigos continuam valendo.', 'success') },
    onError: (e: unknown) => { setCancelar(false); atualizar(); toast((e as Error).message, 'danger') },
  })
  const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast('Link copiado', 'success')).catch(() => {}) }

  if (!podeVer || !d || (!d.elegiveis.length && !d.historico.length)) return null
  const mudar = (i: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const preencherSaldo = (ids: number[]) => {
    const s = d.elegiveis.filter((e) => ids.includes(e.id)).reduce((a, e) => a + e.valor, 0)
    if (linhas.length === 1) mudar(0, { valor: reais(s) })
  }
  const alternar = (id: number, v: boolean) => { const n = v ? [...marcados, id] : marcados.filter((x) => x !== id); setMarcados(n); preencherSaldo(n) }
  const fecha = soma === novoTotal && novoTotal > 0
  const temCartao = linhas.some((l) => l.meio === 'credit_card')

  return (
    <Card>
      <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div>
          <div class="text-xs uppercase tracking-wider text-fg-muted">Alterar forma de pagamento</div>
          <div class="text-xs text-fg-muted mt-0.5">Muda só o que ainda não foi pago. O aluno vê o resultado, mas não faz a troca.</div>
        </div>
        {pode && !fechada && !d.pendente && !abrir && d.elegiveis.length > 0 && <Button size="sm" variant="secondary" onClick={() => setAbrir(true)}>Alterar forma</Button>}
      </div>

      {d.pendente && (
        <div class="rounded-md border border-warning/40 bg-warning/5 p-3 grid gap-2 mb-3">
          <div class="text-sm text-fg">Aguardando o cartão: <strong class="tabular-nums">{brl(d.pendente.novoTotal)}</strong>{d.pendente.parcelas > 1 ? ` em ${d.pendente.parcelas}x` : ''}, até {d.pendente.expiraEm ? dia(d.pendente.expiraEm) : '—'}.</div>
          <div class="text-xs text-fg-muted">Os pagamentos antigos continuam valendo. Quando o cartão for aprovado, eles são cancelados automaticamente. Se o prazo acabar, o link é excluído e nada muda.</div>
          <div class="flex flex-wrap gap-2">
            {(d.pendente.link ?? link) && <Button size="sm" variant="secondary" onClick={() => copiar((d.pendente!.link ?? link)!)}><Copy size={12} /> Copiar link do cartão</Button>}
            {pode && <Button size="sm" variant="ghost" onClick={() => setCancelar(true)}>Cancelar troca</Button>}
          </div>
        </div>
      )}

      {abrir && (
        <div class="grid gap-3">
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full text-xs min-w-[30rem]">
              <thead><tr class="text-left text-fg-subtle border-b border-border"><th class="px-2 py-1.5 w-8" /><th class="px-2 py-1.5 font-medium">Pagamento</th><th class="px-2 py-1.5 font-medium">Vencimento</th><th class="px-2 py-1.5 font-medium text-right">Valor</th></tr></thead>
              <tbody>{d.elegiveis.map((e) => (
                <tr key={e.id} class="border-b border-border last:border-0">
                  <td class="px-2 py-1.5"><input type="checkbox" aria-label={`Selecionar pagamento ${e.ordem}`} checked={marcados.includes(e.id)} onChange={(x) => alternar(e.id, (x.target as HTMLInputElement).checked)} /></td>
                  <td class="px-2 py-1.5 text-fg">{e.origem === 'acordo' ? `Acordo nº ${e.acordoId} · ` : ''}{e.meio}{e.grupo ? ` ${e.grupo}` : ` · pagamento ${e.ordem}`}</td>
                  <td class="px-2 py-1.5 tabular-nums">{dia(e.vencimento)}</td>
                  <td class="px-2 py-1.5 text-right tabular-nums">{brl(e.valor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-end gap-4">
            <div class="text-sm text-fg">Saldo selecionado: <strong class="tabular-nums">{brl(saldo)}</strong></div>
            <label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={alterarValor} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setAlterarValor(v); if (v) setTotal(reais(saldo)) }} /> Alterar o valor</label>
            {alterarValor && <div class="w-36"><Input label="Novo total (R$)" value={total} onInput={(e) => setTotal((e.target as HTMLInputElement).value)} /></div>}
          </div>
          {linhas.map((l, i) => (
            <div key={i} class="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
              <div class="w-40"><Select label="Nova forma" value={l.meio} onChange={(e) => { const meio = (e.target as HTMLSelectElement).value; mudar(i, { meio, parcelas: meio === 'boleto_parcelado' ? '2' : '1' }) }}>
                <option value="credit_card">Cartão</option><option value="pix">Pix</option><option value="boleto">Boleto à vista</option><option value="boleto_parcelado">Boleto parcelado</option>
              </Select></div>
              <div class="w-32"><Input label="Valor (R$)" value={l.valor} onInput={(e) => mudar(i, { valor: (e.target as HTMLInputElement).value })} /></div>
              <div class="w-40"><Input label={l.meio === 'credit_card' ? 'Pagar até' : l.meio === 'boleto_parcelado' ? '1º vencimento' : 'Vencimento'} type="date" min={hoje()} value={l.vencimento} onInput={(e) => mudar(i, { vencimento: (e.target as HTMLInputElement).value })} /></div>
              {l.meio === 'credit_card' && <div class="w-24"><Select label="Vezes" value={l.parcelas} onChange={(e) => mudar(i, { parcelas: (e.target as HTMLSelectElement).value })}>{Array.from({ length: 12 }, (_, n) => <option key={n} value={String(n + 1)}>{n + 1}x</option>)}</Select></div>}
              {l.meio === 'boleto_parcelado' && <div class="w-24"><Select label="Vezes" value={l.parcelas} onChange={(e) => mudar(i, { parcelas: (e.target as HTMLSelectElement).value })}>{Array.from({ length: 23 }, (_, n) => <option key={n} value={String(n + 2)}>{n + 2}x</option>)}</Select></div>}
              {linhas.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>Remover</Button>}
            </div>
          ))}
          <div class="flex items-center gap-3 flex-wrap">
            {linhas.length < 6 && <Button size="sm" variant="ghost" onClick={() => setLinhas((ls) => [...ls, { meio: 'boleto', valor: '', vencimento: ls[ls.length - 1]!.vencimento, parcelas: '1' }])}>Dividir em mais uma forma</Button>}
            <span class={`text-xs tabular-nums ${fecha ? 'text-success' : 'text-fg-muted'}`}>Nova condição {brl(soma)}{fecha ? ' · fecha com o total' : ` · precisa fechar em ${brl(novoTotal)}`}</span>
          </div>
          {temCartao && <div class="text-2xs text-fg-muted">Os pagamentos antigos só são cancelados quando o cartão for aprovado. O link vale por até {d.prazoDias} dias e sempre antes do próximo vencimento. Com cartão, as outras formas só são geradas depois da aprovação.</div>}
          {d.contratoAssinado && <div class="text-xs text-warning" role="status">O contrato já foi assinado. Esta troca muda a condição de pagamento e pode exigir um aditivo.</div>}
          {reduz && <div class="text-xs text-warning" role="status">O novo total é {brl(saldo - novoTotal)} menor que o saldo: essa diferença deixa de ser cobrada. Escreva o motivo da redução e quem autorizou.</div>}
          <Textarea label={reduz ? 'Motivo da redução e quem autorizou (obrigatório, fica no histórico)' : alterarValor ? 'Motivo da troca e da alteração de valor (fica no histórico)' : 'Motivo da troca (fica no histórico)'} rows={2} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
          <div class="flex gap-2">
            <Button size="sm" variant="primary" disabled={!selecionados.length || !fecha || motivo.trim().length < motivoMinimo || criar.isPending} onClick={() => setConfirmar(true)}>Revisar e confirmar</Button>
            <Button size="sm" variant="ghost" onClick={() => setAbrir(false)}>Voltar</Button>
          </div>
        </div>
      )}

      {d.historico.length > 0 && (
        <div class="mt-3">
          <div class="text-xs font-medium text-fg-muted mb-1">Histórico de trocas</div>
          <ul class="grid gap-2 text-xs">{d.historico.map((h) => (
            <li key={h.id} class="border-l-2 border-border pl-2">
              <div class="flex flex-wrap items-center gap-2"><strong>nº {h.id}</strong><Badge tone={SIT[h.status]?.t ?? 'neutral'}>{SIT[h.status]?.r ?? h.status}</Badge><span class="tabular-nums">{brl(h.saldo)}{h.novoTotal !== h.saldo ? ` → ${brl(h.novoTotal)}` : ''}</span><span class="text-fg-muted">{h.por} · {new Date(h.em).toLocaleString('pt-BR')}</span></div>
              <div class="text-fg-muted">De: {h.antes.map((a) => `${MEIO[a.meio] ?? a.meio} ${brl(a.valorCentavos)} (${dia(a.vencimento)})`).join(', ')}</div>
              <div class="text-fg-muted">Para: {h.depois.map((a) => `${MEIO[a.meio] ?? a.meio}${(a.parcelasCartao ?? 1) > 1 ? ` em ${a.parcelasCartao}x` : ''} ${brl(a.valorCentavos)} (${dia(a.vencimento)})`).join(', ')}</div>
              <div class="text-fg">Motivo: {h.motivo}</div>
              {h.nota && <div class="text-fg-muted">{h.nota}</div>}
            </li>
          ))}</ul>
        </div>
      )}

      <ConfirmDialog open={confirmar} onOpenChange={setConfirmar} title={temCartao ? 'Gerar o link do cartão?' : 'Trocar a forma de pagamento agora?'}
        description={`De ${selecionados.length} pagamento(s), saldo de ${brl(saldo)}, para ${brl(novoTotal)}. ${temCartao ? 'Os pagamentos antigos valem até o cartão ser aprovado.' : 'Os pagamentos antigos serão cancelados agora e os novos serão gerados.'} Nenhuma mensagem é enviada ao aluno por aqui.`}
        confirmLabel="Confirmar" loading={criar.isPending} onConfirm={() => { if (!criar.isPending) criar.mutate() }} />
      <ConfirmDialog open={cancelar} onOpenChange={setCancelar} title="Cancelar a troca?" description="O link do cartão será excluído e os pagamentos antigos continuam valendo." confirmLabel="Cancelar troca" destructive onConfirm={() => cancelarM.mutate()} />
    </Card>
  )
}
