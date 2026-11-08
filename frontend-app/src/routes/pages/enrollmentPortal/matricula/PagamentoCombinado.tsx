// Aba Financeiro: pagar o curso em mais de um meio. O agente monta, o sistema gera
// as cobranças e o aluno vê a mesma lista na tela dele. Nenhuma mensagem sai sozinha.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { pedirRascunho } from '@/lib/rascunhoDaConversa'
import { Copy, MessageSquare } from '@/components/ui/icon-set'
import { invalidarInscricao } from './Dispensa'

interface PagamentoDaLista {
  id: number; titulo: string; detalhe: string | null; valor: number; vencimento: string; situacao: string; meio: string
  pagar: string | null; boletoPdf: string | null; pix: string | null; linha: string | null; erro: string | null; status: string; provider: string | null; pagaEm: string | null
}
interface Resposta {
  combinado: { descricao: string; motivo: string | null; por: string | null; em: string | null; descontoPct: number | null; total: number; pago: number; pagamentos: PagamentoDaLista[] } | null
  aceita: boolean; simulado: boolean; lead: { id: number; nome: string | null; whatsapp: string | null } | null
}
interface Linha { meio: string; valor: string; vencimento: string; parcelas: string }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const mesQueVem = () => { const d = new Date(`${hoje()}T12:00:00`); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10) }
const numero = (s: string) => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const dia = (iso: string) => iso.split('-').reverse().join('/')
const TOM: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { paga: 'success', aberta: 'info', prevista: 'neutral', vencida: 'danger', estornada: 'warning', cancelada: 'neutral' }
const ROTULO_STATUS: Record<string, string> = { substituida: 'Substituída', aguardando: 'Aguardando aprovação', renegociada: 'Renegociada' }
const ROTULO: Record<string, string> = { paga: 'Paga', aberta: 'Em aberto', prevista: 'Não gerada', vencida: 'Vencida', estornada: 'Estornada', cancelada: 'Cancelada' }

export function PagamentoCombinado({ registrationId, pago, fechada }: { registrationId: number; pago: boolean; fechada: boolean }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const podeVer = useCan('edu_valor_personalizado', 'view')
  const pode = useCan('edu_valor_personalizado', 'edit')
  const base = `/admin/matricula-interna/${registrationId}/combinado`
  const q = useQuery({ queryKey: ['mi-combinado', registrationId], queryFn: () => api.get<Resposta>(base), enabled: podeVer })
  const [abrir, setAbrir] = useState(false)
  const [total, setTotal] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([
    { meio: 'boleto', valor: '', vencimento: hoje(), parcelas: '1' },
    { meio: 'credit_card', valor: '', vencimento: mesQueVem(), parcelas: '1' },
  ])
  const [pontualidade, setPontualidade] = useState(false)
  const [pct, setPct] = useState('')
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [desfazer, setDesfazer] = useState(false)

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['mi-combinado', registrationId] })
    void qc.invalidateQueries({ queryKey: ['mi-financeiro', registrationId] })
    invalidarInscricao(qc, registrationId)
  }
  const criar = useMutation({
    mutationFn: () => api.post<{ falhas: string[] }>(base, {
      total: numero(total), motivo,
      linhas: linhas.map((l) => ({ meio: l.meio === 'boleto_parcelado' ? 'boleto' : l.meio, valor: numero(l.valor), vencimento: l.vencimento, parcelas: l.meio === 'boleto' || l.meio === 'pix' ? 1 : Number(l.parcelas) })),
      pontualidade: { ativo: pontualidade, pct: numero(pct) },
    }),
    onSuccess: (r) => {
      setConfirmar(false); setAbrir(false); atualizar()
      if (r.falhas.length) toast(`Combinação salva, com atenção: ${r.falhas.join(' · ')}`, 'danger')
      else toast('Cobranças geradas. O aluno já vê na tela dele.', 'success')
    },
    onError: (e: unknown) => { setConfirmar(false); toast((e as Error).message, 'danger') },
  })
  const desfazerM = useMutation({
    mutationFn: () => api.delete(base),
    onSuccess: () => { setDesfazer(false); atualizar(); toast('Combinação desfeita e cobranças canceladas.', 'success') },
    onError: (e: unknown) => { setDesfazer(false); toast((e as Error).message, 'danger') },
  })
  const acao = useMutation({
    mutationFn: ({ id, tipo }: { id: number; tipo: 'gerar' | 'simular' }) => api.post(`${base}/${id}/${tipo}`, {}),
    onSuccess: () => atualizar(),
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const copiar = (texto: string) => { void navigator.clipboard?.writeText(texto).then(() => toast('Copiado', 'success')).catch(() => {}) }

  const d = q.data
  if (!podeVer || !d) return null
  const c = d.combinado

  if (c) {
    const levarAConversa = () => {
      if (!d.lead) return
      const nome = (d.lead.nome ?? '').trim().split(/\s+/)[0]
      const itens = c.pagamentos.filter((p) => p.pagar && p.situacao !== 'paga').map((p) => `${p.titulo} (${p.meio}, ${brl(p.valor)}, ${dia(p.vencimento)}): ${p.pagar}`)
      pedirRascunho(d.lead.id, `Olá${nome ? `, ${nome}` : ''}! Seguem os seus pagamentos, conforme combinamos:\n\n${itens.join('\n')}`)
      navigate(`/conversations?leadId=${d.lead.id}`)
    }
    return (
      <Card>
        <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div>
            <div class="text-xs uppercase tracking-wider text-fg-muted">Pagamento combinado</div>
            <div class="text-sm text-fg mt-0.5">Total <strong class="tabular-nums">{brl(c.total)}</strong> · recebido <strong class="tabular-nums">{brl(c.pago)}</strong></div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            {d.lead?.whatsapp && <Button size="sm" variant="secondary" onClick={levarAConversa}><MessageSquare size={12} /> Levar à conversa</Button>}
            {pode && c.pago === 0 && !fechada && <Button size="sm" variant="ghost" onClick={() => setDesfazer(true)}>Desfazer</Button>}
          </div>
        </div>
        <div class="overflow-x-auto rounded-md border border-border">
          <table class="w-full text-xs min-w-[40rem]">
            <thead><tr class="text-left text-fg-subtle border-b border-border">
              <th class="px-3 py-1.5 font-medium">Pagamento</th><th class="px-2 py-1.5 font-medium">Forma</th><th class="px-2 py-1.5 font-medium text-right">Valor</th>
              <th class="px-2 py-1.5 font-medium">Data</th><th class="px-2 py-1.5 font-medium">Situação</th><th class="px-2 py-1.5 font-medium">Ações</th>
            </tr></thead>
            <tbody>
              {c.pagamentos.map((p) => (
                <tr key={p.id} class="border-b border-border last:border-0 align-top">
                  <td class="px-3 py-2 text-fg">{p.titulo}{p.erro && p.status === 'prevista' && <div class="text-2xs text-danger mt-0.5">{p.erro}</div>}</td>
                  <td class="px-2 py-2">{p.detalhe ?? p.meio}</td>
                  <td class="px-2 py-2 text-right tabular-nums">{brl(p.valor)}</td>
                  <td class="px-2 py-2 tabular-nums">{p.pagaEm ? dia(p.pagaEm.slice(0, 10)) : dia(p.vencimento)}</td>
                  <td class="px-2 py-2"><Badge tone={TOM[p.situacao] ?? 'neutral'}>{ROTULO_STATUS[p.status] ?? ROTULO[p.situacao] ?? p.situacao}</Badge></td>
                  <td class="px-2 py-2">
                    <div class="flex flex-wrap gap-1">
                      {p.pagar && <Button size="sm" variant="ghost" onClick={() => copiar(p.pagar!)}><Copy size={12} /> Link</Button>}
                      {p.linha && <Button size="sm" variant="ghost" onClick={() => copiar(p.linha!)}><Copy size={12} /> Linha</Button>}
                      {p.pix && <Button size="sm" variant="ghost" onClick={() => copiar(p.pix!)}><Copy size={12} /> Pix</Button>}
                      {pode && p.status === 'prevista' && <Button size="sm" variant="secondary" disabled={acao.isPending} onClick={() => acao.mutate({ id: p.id, tipo: 'gerar' })}>Gerar de novo</Button>}
                      {pode && d.simulado && (p.status === 'aberta' || p.status === 'aguardando') && <Button size="sm" variant="secondary" disabled={acao.isPending} onClick={() => acao.mutate({ id: p.id, tipo: 'simular' })}>Simular pagamento</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="text-2xs text-fg-muted mt-2">
          {c.por ? `Combinado por ${c.por}` : ''}{c.em ? ` em ${new Date(c.em).toLocaleDateString('pt-BR')}` : ''}{c.motivo ? ` · ${c.motivo}` : ''}.
          {' '}A matrícula é confirmada no 1º pagamento recebido. O cartão é pago na página do Asaas, pelo link.
        </div>
        <ConfirmDialog open={desfazer} onOpenChange={setDesfazer} title="Desfazer o pagamento combinado?" description="Todas as cobranças desta combinação serão canceladas." confirmLabel="Desfazer" destructive onConfirm={() => desfazerM.mutate()} />
      </Card>
    )
  }

  if (pago || fechada || !pode || !d.aceita) return null
  if (!abrir) {
    return (
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-xs uppercase tracking-wider text-fg-muted">Pagamento combinado</div>
            <div class="text-xs text-fg-muted mt-0.5">O aluno paga o curso em mais de um meio: Pix, boleto e cartão, cada um com valor e data.</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setAbrir(true)}>Montar combinação</Button>
        </div>
      </Card>
    )
  }

  const soma = linhas.reduce((s, l) => s + numero(l.valor), 0)
  const diferenca = Math.round((numero(total) - soma) * 100) / 100
  const mudar = (i: number, parcial: Partial<Linha>) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...parcial } : l)))
  const temBoleto = linhas.some((l) => l.meio === 'boleto' || l.meio === 'boleto_parcelado')

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Pagamento combinado</div>
      <div class="grid gap-3">
        <div class="w-48"><Input label="Valor total negociado (R$)" value={total} onInput={(e) => setTotal((e.target as HTMLInputElement).value)} /></div>
        {linhas.map((l, i) => (
          <div key={i} class="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
            <div class="text-xs font-medium text-fg w-full">Pagamento {i + 1}{i === 0 ? ' (confirma a matrícula quando pago)' : ''}</div>
            <div class="w-36"><Select label="Forma" value={l.meio} onChange={(e) => { const meio = (e.target as HTMLSelectElement).value; mudar(i, { meio, parcelas: meio === 'boleto_parcelado' ? (Number(l.parcelas) > 1 ? l.parcelas : '2') : '1' }) }}>
              <option value="pix">Pix</option><option value="boleto">Boleto à vista</option><option value="boleto_parcelado">Boleto parcelado</option><option value="credit_card">Cartão</option>
            </Select></div>
            <div class="w-32"><Input label="Valor (R$)" value={l.valor} onInput={(e) => mudar(i, { valor: (e.target as HTMLInputElement).value })} /></div>
            <div class="w-40"><Input label={l.meio === 'credit_card' ? 'Pagar a partir de' : l.meio === 'boleto_parcelado' ? '1º vencimento' : 'Vencimento'} type="date" min={hoje()} value={l.vencimento} onInput={(e) => mudar(i, { vencimento: (e.target as HTMLInputElement).value })} /></div>
            {l.meio === 'credit_card' && <div class="w-24"><Select label="Vezes" value={l.parcelas} onChange={(e) => mudar(i, { parcelas: (e.target as HTMLSelectElement).value })}>
              {Array.from({ length: 12 }, (_, n) => <option key={n} value={String(n + 1)}>{n + 1}x</option>)}
            </Select></div>}
            {l.meio === 'boleto_parcelado' && <div class="w-24"><Select label="Vezes" value={l.parcelas} onChange={(e) => mudar(i, { parcelas: (e.target as HTMLSelectElement).value })}>
              {Array.from({ length: 23 }, (_, n) => <option key={n} value={String(n + 2)}>{n + 2}x</option>)}
            </Select></div>}
            {linhas.length > 2 && <Button size="sm" variant="ghost" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}>Remover</Button>}
            {l.meio === 'boleto_parcelado' && numero(l.valor) > 0 && <div class="text-2xs text-fg-muted w-full">{l.parcelas}x de {brl(Math.floor((numero(l.valor) * 100) / Number(l.parcelas)) / 100)}, um boleto por mês, a partir de {dia(l.vencimento)}. Todos são gerados agora.</div>}
            {l.meio === 'credit_card' && <div class="text-2xs text-fg-muted w-full">{l.vencimento <= hoje() ? 'O aluno paga hoje pelo link, e a 1ª parcela costuma cair na próxima fatura do cartão.' : 'O aluno informa o cartão pelo link na data combinada. Até lá, não há garantia de pagamento.'}</div>}
          </div>
        ))}
        <div class="flex items-center gap-3 flex-wrap">
          {linhas.length < 6 && <Button size="sm" variant="ghost" onClick={() => setLinhas((ls) => [...ls, { meio: 'boleto', valor: '', vencimento: ls[ls.length - 1]!.vencimento, parcelas: '1' }])}>Adicionar pagamento</Button>}
          <span class={`text-xs tabular-nums ${diferenca === 0 && soma > 0 ? 'text-success' : 'text-fg-muted'}`}>Soma {brl(soma)}{diferenca !== 0 ? ` · ${diferenca > 0 ? 'faltam' : 'sobram'} ${brl(Math.abs(diferenca))}` : ' · fecha com o total'}</span>
        </div>
        <div class="rounded-md border border-border px-3 py-2 grid gap-2">
          <label class="flex items-center gap-2 text-xs font-medium text-fg">
            <input type="checkbox" checked={pontualidade} disabled={!temBoleto} onChange={(e) => setPontualidade((e.target as HTMLInputElement).checked)} /> Aplicar desconto de pontualidade nos boletos
          </label>
          {!temBoleto && <div class="text-2xs text-fg-muted">Não há boleto nesta combinação.</div>}
          {pontualidade && temBoleto && <div class="w-32"><Input label="Desconto %" value={pct} onInput={(e) => setPct((e.target as HTMLInputElement).value)} /></div>}
          {pontualidade && temBoleto && <div class="text-2xs text-fg-muted">Vale até o vencimento de cada boleto.</div>}
        </div>
        <Textarea label="Motivo da condição" rows={2} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
        <div class="flex gap-2">
          <Button size="sm" variant="primary" disabled={criar.isPending || diferenca !== 0 || soma <= 0 || motivo.trim().length < 3} onClick={() => setConfirmar(true)}>Gerar cobranças</Button>
          <Button size="sm" variant="ghost" onClick={() => setAbrir(false)}>Cancelar</Button>
        </div>
      </div>
      <ConfirmDialog open={confirmar} onOpenChange={setConfirmar} title={`Gerar ${linhas.reduce((s, l) => s + (l.meio === 'boleto_parcelado' ? Number(l.parcelas) : 1), 0)} cobranças, total de ${brl(soma)}?`} description="As cobranças abertas desta inscrição serão canceladas e as novas serão criadas no gateway. O Asaas não avisa o aluno da criação: envie os links pela conversa. Lembretes de vencimento e atraso continuam, e essa escolha vale para o cadastro do aluno no Asaas." confirmLabel="Gerar cobranças" onConfirm={() => criar.mutate()} />
    </Card>
  )
}
