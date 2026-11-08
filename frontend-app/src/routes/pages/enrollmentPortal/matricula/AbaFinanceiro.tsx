// Aba Financeiro da matrícula interna: plano, condição combinada, cupom e cobrança.
// A conta é toda do servidor (payment-options, valor-personalizado, payment-init).
import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { Copy, Pencil } from '@/components/ui/icon-set'
import { chamarComoAgente, rotaInscricao, sessaoInterna } from './sessao'
import { invalidarInscricao } from './Dispensa'
import { PagamentoCombinado } from './PagamentoCombinado'
import { AlterarFormaPagamento } from './AlterarFormaPagamento'

type OpcaoChave = 'entrada' | 'integral'
type FormaNum = { ativo: boolean; descontoPct: number; valorBase: number | null }
type ParcNum = { ativo: boolean; parcelasMax: number; jurosMesPct: number | null; faixas: unknown[]; valorBase: number | null }
type OpcaoNum = { ativo: boolean; pix: FormaNum; boleto: FormaNum; cartao: ParcNum; boletoParcelado: ParcNum }
interface EditorNum {
  matricula: number; mensalidade: number; numParcelas: number; diaVencimento: number
  opcoes: Record<OpcaoChave, OpcaoNum>
  pontualidade: { ativo: boolean; descontoPct: number; diaLimite: number; ateVencimento: boolean; terminaEm90: boolean; naPrimeira: boolean | null }
  vencimentoEntrada: string | null; primeiraSeguinte: string | null
}
interface Negociacao {
  pode: boolean
  plano: { id: number; nome: string } | null
  tabela: EditorNum | null
  editor: EditorNum | null
  resumo: string[]
  atual: { planoId: number; matricula: number; mensalidade: number; motivo: string; por: string | null; em: string } | null
}
interface Opcoes {
  planos?: Array<{ id: number; nome: string; resumo: string; opcoes: Array<{ chave: OpcaoChave; valor: number; rotulo: string; detalhe: string }> }>
  escolha?: { planoId: number; opcao: OpcaoChave }
  semPlano?: boolean
  aviso?: string
  rotulo?: string
  valor: number
  valorTabela?: number
  cupom?: { aplicado: boolean; code?: string; desconto?: number; motivo?: string } | null
  negociacao?: Negociacao | null
  /** Sem plano de pagamento (taxa, ou curso sem plano): só o agente recebe. */
  valorAvulso?: { pode: boolean; portalCobra: boolean; valor: number; tabela: number; combinado: { motivo: string; por: string | null; em: string } | null } | null
  meios: {
    pix: { ativo: boolean; valor?: number; descontoPct?: number }
    boleto: { ativo: boolean; opcoes?: Array<{ parcelas: number; valorEntrada: number; valorParcela: number; valorTotal: number; descricao: string }> }
    cartao: { ativo: boolean; opcoes?: Array<{ parcelas: number; valorParcela: number; valorTotal: number; descricao: string }> }
  }
}

const brl = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—')
const num2 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : '')
const txt = (v: number | null | undefined) => (typeof v === 'number' ? String(v).replace('.', ',') : '')

type Txt = string
type FormaTxt = { ativo: boolean; descontoPct: Txt; valorBase: Txt }
type ParcTxt = { ativo: boolean; parcelasMax: Txt; jurosMesPct: Txt; valorBase: Txt; multiFaixa: boolean }
type OpcaoTxt = { ativo: boolean; pix: FormaTxt; boleto: FormaTxt; cartao: ParcTxt; boletoParcelado: ParcTxt }
interface EditorTxt {
  matricula: Txt; mensalidade: Txt; numParcelas: Txt; diaVencimento: Txt
  opcoes: Record<OpcaoChave, OpcaoTxt>
  pontualidade: { ativo: boolean; descontoPct: Txt; diaLimite: Txt; ateVencimento: boolean; terminaEm90: boolean; naPrimeira: boolean | null }
  vencimentoEntrada: Txt; primeiraSeguinte: Txt
}
function paraTexto(e: EditorNum): EditorTxt {
  const f = (x: FormaNum): FormaTxt => ({ ativo: x.ativo, descontoPct: txt(x.descontoPct), valorBase: num2(x.valorBase) })
  const p = (x: ParcNum): ParcTxt => ({ ativo: x.ativo, parcelasMax: String(x.parcelasMax), valorBase: num2(x.valorBase), jurosMesPct: x.jurosMesPct === null ? '' : txt(x.jurosMesPct), multiFaixa: x.jurosMesPct === null })
  const o = (x: OpcaoNum): OpcaoTxt => ({ ativo: x.ativo, pix: f(x.pix), boleto: f(x.boleto), cartao: p(x.cartao), boletoParcelado: p(x.boletoParcelado) })
  return {
    matricula: num2(e.matricula), mensalidade: num2(e.mensalidade), numParcelas: String(e.numParcelas), diaVencimento: String(e.diaVencimento),
    opcoes: { entrada: o(e.opcoes.entrada), integral: o(e.opcoes.integral) },
    pontualidade: { ...e.pontualidade, descontoPct: txt(e.pontualidade.descontoPct), diaLimite: String(e.pontualidade.diaLimite) },
    vencimentoEntrada: e.vencimentoEntrada ?? '', primeiraSeguinte: e.primeiraSeguinte ?? '',
  }
}
function paraEnvio(e: EditorTxt) {
  const parc = (x: ParcTxt) => ({ ativo: x.ativo, parcelasMax: x.parcelasMax, valorBase: x.valorBase || null, jurosMesPct: x.jurosMesPct.trim() === '' ? null : x.jurosMesPct })
  const forma = (x: FormaTxt) => ({ ativo: x.ativo, descontoPct: x.descontoPct || '0', valorBase: x.valorBase || null })
  const op = (x: OpcaoTxt) => ({ ativo: x.ativo, pix: forma(x.pix), boleto: forma(x.boleto), cartao: parc(x.cartao), boletoParcelado: parc(x.boletoParcelado) })
  return {
    matricula: e.matricula || '0', mensalidade: e.mensalidade || '0', numParcelas: e.numParcelas, diaVencimento: e.diaVencimento,
    opcoes: { entrada: op(e.opcoes.entrada), integral: op(e.opcoes.integral) },
    pontualidade: e.pontualidade,
    vencimentoEntrada: e.vencimentoEntrada || null, primeiraSeguinte: e.primeiraSeguinte || null,
  }
}

const celula = 'h-7 w-full rounded border border-border bg-surface-inset px-1.5 text-xs text-fg tabular-nums disabled:opacity-40'
function Celula({ valor, aoMudar, dica, desligado }: { valor: Txt; aoMudar: (v: Txt) => void; dica?: string; desligado?: boolean }) {
  return <input class={celula} value={valor} placeholder={dica} title={dica} disabled={desligado} inputMode="decimal" onInput={(e) => aoMudar((e.target as HTMLInputElement).value)} />
}

function EditorDeCondicoes({ registrationId, neg, aoFechar }: { registrationId: number; neg: Negociacao; aoFechar: () => void }) {
  const qc = useQueryClient()
  const [ed, setEd] = useState<EditorTxt>(() => paraTexto(neg.editor!))
  const [motivo, setMotivo] = useState(neg.atual?.planoId === neg.plano?.id ? (neg.atual?.motivo ?? '') : '')
  const T = neg.tabela!
  const mudar = (f: (e: EditorTxt) => void) => setEd((e) => { const c: EditorTxt = JSON.parse(JSON.stringify(e)); f(c); return c })
  const salvar = useMutation({
    mutationFn: () => chamarComoAgente<{ avisos?: string[] }>(registrationId, (s) => `${rotaInscricao(s)}/valor-personalizado`, { method: 'PUT', body: { planoId: neg.plano!.id, motivo, editor: paraEnvio(ed) } }),
    onSuccess: (r) => {
      toast('Condições salvas', 'success')
      for (const a of r.avisos ?? []) toast(a, 'warning')
      invalidarInscricao(qc, registrationId); aoFechar()
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const linhaOpcao = (chave: OpcaoChave, titulo: string) => {
    const o = ed.opcoes[chave]; const t = T.opcoes[chave]
    const alterna = (f: 'pix' | 'boleto' | 'cartao' | 'boletoParcelado', v: boolean) => mudar((e) => { e.opcoes[chave][f].ativo = v })
    return (
      <div class="rounded-md border border-border overflow-x-auto" key={chave}>
        <label class="flex items-center gap-2 px-3 py-2 bg-surface-3 text-xs font-medium text-fg">
          <input type="checkbox" checked={o.ativo} onChange={(e) => mudar((x) => { x.opcoes[chave].ativo = (e.target as HTMLInputElement).checked })} /> {titulo}
        </label>
        {o.ativo && (
          <table class="w-full text-xs min-w-[34rem]">
            <thead><tr class="text-left text-fg-subtle border-b border-border">
              <th class="px-3 py-1.5 font-medium">Forma</th><th class="px-2 py-1.5 font-medium w-20">Desconto %</th><th class="px-2 py-1.5 font-medium w-20">Até (vezes)</th>
              <th class="px-2 py-1.5 font-medium w-24">Juros % a.m.</th><th class="px-2 py-1.5 font-medium w-32">Preço próprio (R$)</th>
            </tr></thead>
            <tbody>
              {(['pix', 'boleto'] as const).map((k) => (
                <tr class="border-b border-border" key={k}>
                  <td class="px-3 py-1"><label class="flex items-center gap-2"><input type="checkbox" checked={o[k].ativo} onChange={(e) => alterna(k, (e.target as HTMLInputElement).checked)} /> {k === 'pix' ? 'Pix à vista' : 'Boleto à vista'}</label></td>
                  <td class="px-2 py-1"><Celula valor={o[k].descontoPct} dica={`tabela ${txt(t[k].descontoPct)}%`} desligado={!o[k].ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].descontoPct = v })} /></td>
                  <td class="px-2 py-1 text-fg-subtle">—</td><td class="px-2 py-1 text-fg-subtle">—</td>
                  <td class="px-2 py-1"><Celula valor={o[k].valorBase} dica={t[k].valorBase ? `tabela ${num2(t[k].valorBase)}` : 'do plano'} desligado={!o[k].ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].valorBase = v })} /></td>
                </tr>
              ))}
              {(['cartao', 'boletoParcelado'] as const).map((k) => (
                <tr class="border-b border-border last:border-0" key={k}>
                  <td class="px-3 py-1"><label class="flex items-center gap-2"><input type="checkbox" checked={o[k].ativo} onChange={(e) => alterna(k, (e.target as HTMLInputElement).checked)} /> {k === 'cartao' ? 'Cartão de crédito' : 'Boleto parcelado'}</label></td>
                  <td class="px-2 py-1 text-fg-subtle">—</td>
                  <td class="px-2 py-1"><Celula valor={o[k].parcelasMax} dica={`tabela ${t[k].parcelasMax}x`} desligado={!o[k].ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].parcelasMax = v })} /></td>
                  <td class="px-2 py-1"><Celula valor={o[k].jurosMesPct} dica={o[k].multiFaixa ? 'mantém as faixas' : '0 = sem juros'} desligado={!o[k].ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].jurosMesPct = v })} /></td>
                  <td class="px-2 py-1"><Celula valor={o[k].valorBase} dica={t[k].valorBase ? `tabela ${num2(t[k].valorBase)}` : 'do plano'} desligado={!o[k].ativo} aoMudar={(v) => mudar((e) => { e.opcoes[chave][k].valorBase = v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  return (
    <div class="grid gap-3">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Input label="Matrícula (R$)" hint={`Tabela: ${brl(T.matricula)}. 0 = sem matrícula`} value={ed.matricula} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.matricula = v }) }} />
        <Input label="Mensalidade (R$)" hint={`Tabela: ${brl(T.mensalidade)}`} value={ed.mensalidade} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.mensalidade = v }) }} />
        <Input label="Nº de mensalidades" hint={`Tabela: ${T.numParcelas}`} value={ed.numParcelas} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.numParcelas = v }) }} />
        <Input label="Dia do vencimento" hint={`Tabela: ${T.diaVencimento}`} value={ed.diaVencimento} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.diaVencimento = v }) }} />
        <Input label="Cobrança de agora vence em" type="date" hint="Vazio = prazo do portal" value={ed.vencimentoEntrada} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.vencimentoEntrada = v }) }} />
        <Input label="1ª parcela seguinte em" type="date" hint="Vazio = próximo vencimento" value={ed.primeiraSeguinte} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.primeiraSeguinte = v }) }} />
      </div>
      {linhaOpcao('entrada', 'Pode pagar só a matrícula / 1ª parcela agora')}
      {ed.opcoes.entrada.ativo && (['pix', 'boleto', 'cartao'] as const).some((k) => ed.opcoes.entrada[k].ativo && !!ed.opcoes.entrada[k].valorBase) && (
        <div class="text-xs text-warning" role="status">Preço próprio em Pix, boleto à vista ou cartão vale aqui só como entrada: o contrato e as parcelas seguintes continuam pelo plano. Para vender o curso inteiro por esse valor, use "curso completo".</div>
      )}
      {linhaOpcao('integral', 'Pode pagar o curso completo')}
      <div class="rounded-md border border-border px-3 py-2 grid gap-2">
        <label class="flex items-center gap-2 text-xs font-medium text-fg">
          <input type="checkbox" checked={ed.pontualidade.ativo} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; mudar((x) => { x.pontualidade.ativo = v }) }} /> Desconto de pontualidade nas parcelas
        </label>
        {ed.pontualidade.ativo && (
          <div class="flex flex-wrap items-end gap-3 text-xs">
            <div class="w-28"><Input label="Desconto %" value={ed.pontualidade.descontoPct} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.pontualidade.descontoPct = v }) }} /></div>
            {!ed.pontualidade.ateVencimento && <div class="w-28"><Input label="Até o dia" value={ed.pontualidade.diaLimite} onInput={(e) => { const v = (e.target as HTMLInputElement).value; mudar((x) => { x.pontualidade.diaLimite = v }) }} /></div>}
            <label class="flex items-center gap-2 h-9"><input type="checkbox" checked={ed.pontualidade.ateVencimento} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; mudar((x) => { x.pontualidade.ateVencimento = v }) }} /> Vale até o vencimento</label>
            <label class="flex items-center gap-2 h-9"><input type="checkbox" checked={ed.pontualidade.terminaEm90} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; mudar((x) => { x.pontualidade.terminaEm90 = v }) }} /> Terminar em ,90</label>
            <label class="flex items-center gap-2 h-9"><input type="checkbox" checked={ed.pontualidade.naPrimeira ?? ed.opcoes.integral.ativo} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; mudar((x) => { x.pontualidade.naPrimeira = v }) }} /> Aplicar também na 1ª parcela do boleto parcelado</label>
          </div>
        )}
      </div>
      <Textarea label="Motivo" value={motivo} placeholder="Ex.: condição combinada com o gerente, convênio, retenção" onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} />
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={motivo.trim().length < 3 || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar condições'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEd({ ...paraTexto(T), vencimentoEntrada: ed.vencimentoEntrada, primeiraSeguinte: ed.primeiraSeguinte })}>Preencher com a tabela</Button>
        <Button size="sm" variant="ghost" onClick={aoFechar}>Cancelar</Button>
        <span class="text-2xs text-fg-muted">Um Pix ou boleto aberto com as condições anteriores é cancelado ao salvar.</span>
      </div>
    </div>
  )
}

/** Valor único da cobrança, para mais ou para menos, quando não há plano. */
function EditarValorAvulso({ registrationId, v, rotulo, bloqueado }: { registrationId: number; v: NonNullable<Opcoes['valorAvulso']>; rotulo: string; bloqueado: boolean }) {
  const qc = useQueryClient()
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const salvar = useMutation({
    mutationFn: () => chamarComoAgente<{ avisos?: string[] }>(registrationId, (s) => `${rotaInscricao(s)}/valor-personalizado`, { method: 'PUT', body: { valorAvulso: valor, motivo } }),
    onSuccess: (r) => { toast('Valor salvo', 'success'); for (const a of r.avisos ?? []) toast(a, 'warning'); setEditando(false); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const voltar = useMutation({
    mutationFn: () => chamarComoAgente<{ avisos?: string[] }>(registrationId, (s) => `${rotaInscricao(s)}/valor-personalizado`, { method: 'DELETE' }),
    onSuccess: (r) => { toast('Voltou ao valor da tabela', 'success'); for (const a of r.avisos ?? []) toast(a, 'warning'); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  return (
    <div class="grid gap-2">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-2xs text-fg-subtle">{rotulo}</div>
          <div class="text-lg font-semibold text-fg tabular-nums">{brl(v.valor)}</div>
          {v.combinado && <div class="text-2xs text-fg-muted">Tabela: {brl(v.tabela)}. Combinado por {v.combinado.por ?? '—'} em {new Date(v.combinado.em).toLocaleDateString('pt-BR')}: {v.combinado.motivo}</div>}
        </div>
        {v.pode && !bloqueado && !editando && (
          <div class="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => { setValor(num2(v.valor)); setMotivo(''); setEditando(true) }}><Pencil size={12} /> Editar valor</Button>
            {v.combinado && <Button size="sm" variant="ghost" disabled={voltar.isPending} onClick={() => voltar.mutate()}>Voltar à tabela</Button>}
          </div>
        )}
      </div>
      {!v.pode && <div class="text-2xs text-fg-muted">Seu perfil não altera valores (permissão "Valor personalizado").</div>}
      {editando && (
        <div class="grid sm:grid-cols-[10rem_minmax(0,1fr)] gap-3 rounded-md border border-border p-3">
          <Input label="Novo valor (R$)" hint={`Tabela: ${brl(v.tabela)}. Pode ser maior ou menor.`} value={valor} inputMode="decimal" onInput={(e) => setValor((e.target as HTMLInputElement).value)} />
          <Input label="Motivo" value={motivo} placeholder="Ex.: condição combinada com o gerente" onInput={(e) => setMotivo((e.target as HTMLInputElement).value)} />
          <div class="sm:col-span-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={!valor.trim() || motivo.trim().length < 3 || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar valor'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
            <span class="text-2xs text-fg-muted">Um Pix ou boleto aberto com o valor anterior é cancelado. O aluno vê só o valor final.</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function AbaFinanceiro({ registrationId, pago, fechada, acoes, children }: {
  registrationId: number
  pago: boolean
  fechada: boolean
  /** Pagamento manual e o que mais a página da inscrição oferecer. */
  acoes?: preact.ComponentChildren
  /** Lista das cobranças já geradas. */
  children?: preact.ComponentChildren
}) {
  const qc = useQueryClient()
  const [escolha, setEscolha] = useState<{ planoId: number; opcao: OpcaoChave } | null>(null)
  const [cupomDigitado, setCupomDigitado] = useState('')
  const [cupom, setCupom] = useState('')
  const [editando, setEditando] = useState(false)
  const [confirmar, setConfirmar] = useState<{ method: 'pix' | 'boleto'; parcelas: number; rotulo: string } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [vezes, setVezes] = useState(0)

  const q = useQuery({
    queryKey: ['mi-financeiro', registrationId, escolha?.planoId, escolha?.opcao, cupom],
    queryFn: () => {
      const p = new URLSearchParams()
      if (cupom) p.set('cupom', cupom)
      if (escolha) { p.set('plano', String(escolha.planoId)); p.set('opcao', escolha.opcao) }
      return chamarComoAgente<Opcoes>(registrationId, (s) => `${rotaInscricao(s)}/payment-options${p.toString() ? `?${p}` : ''}`)
    },
  })
  const o = q.data
  useEffect(() => { setEditando(false) }, [escolha?.planoId])

  const voltarATabela = useMutation({
    mutationFn: () => chamarComoAgente<{ avisos?: string[] }>(registrationId, (s) => `${rotaInscricao(s)}/valor-personalizado`, { method: 'DELETE' }),
    onSuccess: (r) => { toast('Voltou à tabela', 'success'); for (const a of r.avisos ?? []) toast(a, 'warning'); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const gerar = useMutation({
    mutationFn: (c: { method: 'pix' | 'boleto'; parcelas: number }) => chamarComoAgente(registrationId, (s) => `${rotaInscricao(s)}/payment-init`, {
      method: 'POST',
      body: { method: c.method, parcelas: c.parcelas, ...(cupom ? { cupom } : {}), ...(o?.escolha ? { planoId: o.escolha.planoId, opcao: o.escolha.opcao } : {}) },
    }),
    onSuccess: () => { toast('Cobrança gerada. O aluno também vê na tela dele.', 'success'); setConfirmar(null); invalidarInscricao(qc, registrationId) },
    onError: (e: unknown) => { toast((e as Error).message, 'danger'); setConfirmar(null) },
  })
  const gerarLink = useMutation({
    mutationFn: async () => {
      const s = await sessaoInterna(registrationId)
      return chamarComoAgente<{ url: string }>(registrationId, () => `/public/portals/${encodeURIComponent(s.slug)}/atendimento/link`, { method: 'POST', body: { candidateCode: s.candidateCode } })
    },
    onSuccess: (r) => { setLink(r.url); void navigator.clipboard?.writeText(r.url).then(() => toast('Link copiado', 'success')).catch(() => {}) },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  if (q.isLoading) return <Card><div class="text-sm text-fg-muted">Carregando financeiro…</div></Card>
  if (q.error) return <Card><div class="text-sm text-danger">{(q.error as Error).message}</div>{children}</Card>
  if (!o) return null
  // Pagamento combinado montado: as cobranças são dele, sem o checkout de uma cobrança só.
  if ((o as any).combinado) return <div class="grid gap-3"><PagamentoCombinado registrationId={registrationId} pago={pago} fechada={fechada} /><AlterarFormaPagamento registrationId={registrationId} fechada={fechada} />{children}</div>

  const planoAtual = o.planos?.find((p) => p.id === o.escolha?.planoId) ?? null
  const neg = o.negociacao ?? null
  const combinado = neg?.atual && neg.atual.planoId === neg.plano?.id ? neg.atual : null
  const podeGerar = !pago && !fechada
  const boletos = o.meios.boleto.ativo ? (o.meios.boleto.opcoes ?? []) : []
  const boletoAVista = boletos.find((b) => b.parcelas === 1) ?? null
  const parcelados = boletos.filter((b) => b.parcelas > 1)
  const parcelado = parcelados.find((b) => b.parcelas === vezes) ?? parcelados[parcelados.length - 1] ?? null

  return (
    <div class="grid gap-3">
      <Card>
        <div class="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div class="text-xs uppercase tracking-wider text-fg-muted">{o.planos?.length ? 'Plano e condição' : 'Valor'}</div>
          <div class="flex items-center gap-2">
            {combinado || o.valorAvulso?.combinado ? <Badge tone="info">Valor combinado</Badge> : <Badge tone="neutral">Tabela</Badge>}
            {acoes}
          </div>
        </div>
        {o.semPlano && <div class="text-xs text-warning mb-2">{o.valorAvulso?.pode ? 'Este curso não tem plano de pagamento. Defina o valor desta matrícula abaixo.' : o.aviso}</div>}
        {o.valorAvulso && !o.planos?.length && (
          <div class="mb-1">
            <EditarValorAvulso registrationId={registrationId} v={o.valorAvulso} rotulo={o.rotulo ?? 'Valor'} bloqueado={pago || fechada} />
            {!o.valorAvulso.portalCobra && <div class="text-2xs text-fg-muted mt-2">Este portal não gera cobrança pelo sistema. Recebido por fora: "Registrar pagamento manual".</div>}
          </div>
        )}
        {pago && <div class="text-xs text-fg-muted mb-2">Pagamento confirmado: plano, valores e cobrança ficam travados.</div>}
        {!!o.planos?.length && (
          <div class="grid sm:grid-cols-2 gap-3 mb-3">
            <Select label="Plano" value={String(o.escolha?.planoId ?? '')} disabled={pago}
              onChange={(e) => { const id = Number((e.target as HTMLSelectElement).value); const p = o.planos!.find((x) => x.id === id); setEscolha({ planoId: id, opcao: p?.opcoes[0]?.chave ?? 'entrada' }) }}>
              {o.planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.resumo}</option>)}
            </Select>
            <Select label="O que pagar agora" value={o.escolha?.opcao ?? ''} disabled={pago}
              onChange={(e) => setEscolha({ planoId: o.escolha!.planoId, opcao: (e.target as HTMLSelectElement).value as OpcaoChave })}>
              {planoAtual?.opcoes.map((x) => <option key={x.chave} value={x.chave}>{x.rotulo} · {brl(x.valor)}</option>)}
            </Select>
          </div>
        )}
        {neg && !editando && (
          <div class="grid gap-2">
            <ul class="text-xs text-fg grid gap-0.5">
              {neg.resumo.map((l, i) => <li key={i} class={l.startsWith('  ·') ? 'pl-3 text-fg-muted' : ''}>{l.replace(/^ {2}· /, '')}</li>)}
            </ul>
            {combinado && <div class="text-2xs text-fg-muted">Combinado por {combinado.por ?? '—'} em {new Date(combinado.em).toLocaleDateString('pt-BR')}: {combinado.motivo}. Tabela deste plano segue guardada.</div>}
            {neg.pode && !pago && !fechada && (
              <div class="flex flex-wrap gap-2 mt-1">
                <Button size="sm" variant="secondary" onClick={() => setEditando(true)}><Pencil size={12} /> Editar valores e condições</Button>
                {combinado && <Button size="sm" variant="ghost" disabled={voltarATabela.isPending} onClick={() => voltarATabela.mutate()}>Voltar à tabela</Button>}
              </div>
            )}
            {!neg.pode && <div class="text-2xs text-fg-muted">Seu perfil não altera valores (permissão "Valor personalizado").</div>}
          </div>
        )}
        {neg && editando && <EditorDeCondicoes registrationId={registrationId} neg={neg} aoFechar={() => setEditando(false)} />}
      </Card>

      <PagamentoCombinado registrationId={registrationId} pago={pago} fechada={fechada} />
      <AlterarFormaPagamento registrationId={registrationId} fechada={fechada} />

      {!o.semPlano && (o.valorAvulso?.portalCobra ?? true) && (
        <Card>
          <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <div class="text-xs uppercase tracking-wider text-fg-muted">Gerar cobrança</div>
              <div class="text-sm text-fg mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{o.rotulo ?? 'Valor'}: <strong class="tabular-nums">{brl(o.valor)}</strong></span>
                {neg?.pode && !pago && !fechada && <Button size="sm" variant="ghost" onClick={() => { setEditando(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Pencil size={12} /> Editar valor</Button>}
              </div>
            </div>
            {!pago && (
              <form class="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setCupom(cupomDigitado.trim().toUpperCase()) }}>
                <div class="w-36"><Input label="Cupom" value={cupomDigitado} onInput={(e) => setCupomDigitado((e.target as HTMLInputElement).value.toUpperCase())} /></div>
                <Button size="sm" variant="secondary" type="submit" disabled={!cupomDigitado.trim()}>Aplicar</Button>
                {cupom && <Button size="sm" variant="ghost" type="button" onClick={() => { setCupom(''); setCupomDigitado('') }}>Tirar</Button>}
              </form>
            )}
          </div>
          {o.cupom?.aplicado && <div class="text-xs text-success mb-2">Cupom {o.cupom.code} aplicado{o.cupom.desconto ? `: menos ${brl(o.cupom.desconto)}` : ''}.</div>}
          {o.cupom && !o.cupom.aplicado && <div class="text-xs text-danger mb-2">{o.cupom.motivo}</div>}
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full text-xs min-w-[32rem]">
              <thead><tr class="text-left text-fg-subtle border-b border-border">
                <th class="px-3 py-1.5 font-medium">Forma</th><th class="px-2 py-1.5 font-medium">Condição</th><th class="px-2 py-1.5 font-medium text-right">Total</th><th class="px-3 py-1.5" />
              </tr></thead>
              <tbody>
                {o.meios.pix.ativo && (
                  <tr class="border-b border-border last:border-0">
                    <td class="px-3 py-1.5 text-fg">Pix</td>
                    <td class="px-2 py-1.5 text-fg-muted">À vista{o.meios.pix.descontoPct ? ` com ${o.meios.pix.descontoPct}% de desconto` : ''}</td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{brl(o.meios.pix.valor)}</td>
                    <td class="px-3 py-1 text-right">{podeGerar && <Button size="sm" variant="secondary" onClick={() => setConfirmar({ method: 'pix', parcelas: 1, rotulo: `Pix de ${brl(o.meios.pix.valor)}` })}>Gerar Pix</Button>}</td>
                  </tr>
                )}
                {boletoAVista && (
                  <tr class="border-b border-border last:border-0">
                    <td class="px-3 py-1.5 text-fg">Boleto</td>
                    <td class="px-2 py-1.5 text-fg-muted">À vista</td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{brl(boletoAVista.valorTotal)}</td>
                    <td class="px-3 py-1 text-right">{podeGerar && <Button size="sm" variant="secondary" onClick={() => setConfirmar({ method: 'boleto', parcelas: 1, rotulo: `boleto de ${brl(boletoAVista.valorTotal)}` })}>Gerar boleto</Button>}</td>
                  </tr>
                )}
                {parcelados.length > 0 && parcelado && (
                  <tr class="border-b border-border last:border-0">
                    <td class="px-3 py-1.5 text-fg whitespace-nowrap">Boleto parcelado</td>
                    <td class="px-2 py-1">
                      <select class="h-7 w-full max-w-md rounded border border-border bg-surface-inset px-1.5 text-xs text-fg" aria-label="Parcelas do boleto" value={parcelado.parcelas}
                        onChange={(e) => setVezes(Number((e.target as HTMLSelectElement).value))}>
                        {parcelados.map((b) => <option key={b.parcelas} value={b.parcelas}>{b.parcelas}x · {b.descricao}</option>)}
                      </select>
                    </td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{brl(parcelado.valorTotal)}</td>
                    <td class="px-3 py-1 text-right">{podeGerar && <Button size="sm" variant="secondary" onClick={() => setConfirmar({ method: 'boleto', parcelas: parcelado.parcelas, rotulo: `boleto de ${parcelado.descricao}` })}>Gerar boleto</Button>}</td>
                  </tr>
                )}
                {o.meios.cartao.ativo && (
                  <tr class="border-b border-border last:border-0">
                    <td class="px-3 py-1.5 text-fg">Cartão</td>
                    <td class="px-2 py-1.5 text-fg-muted">Até {Math.max(...(o.meios.cartao.opcoes ?? []).map((c) => c.parcelas), 1)}x. Quem digita o cartão é o aluno, pelo link.</td>
                    <td class="px-2 py-1.5 text-right tabular-nums">—</td>
                    <td class="px-3 py-1 text-right">{podeGerar && <Button size="sm" variant="secondary" disabled={gerarLink.isPending} onClick={() => gerarLink.mutate()}><Copy size={12} /> Copiar link</Button>}</td>
                  </tr>
                )}
                {!o.meios.pix.ativo && !boletos.length && !o.meios.cartao.ativo && (
                  <tr><td colSpan={4} class="px-3 py-3 text-center text-fg-muted">Nenhuma forma de pagamento disponível nesta opção.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {link && <div class="mt-2 text-2xs text-fg-muted break-all">Link do aluno (nada foi enviado): {link}</div>}
        </Card>
      )}

      {children}

      <ConfirmDialog open={!!confirmar} onOpenChange={(v) => { if (!v) setConfirmar(null) }}
        title="Gerar cobrança?" description={`Vai gerar ${confirmar?.rotulo ?? ''} no gateway. O aluno também vê na tela dele.`}
        confirmLabel="Gerar cobrança" loading={gerar.isPending} onConfirm={() => { if (confirmar) gerar.mutate({ method: confirmar.method, parcelas: confirmar.parcelas }) }} />
    </div>
  )
}
