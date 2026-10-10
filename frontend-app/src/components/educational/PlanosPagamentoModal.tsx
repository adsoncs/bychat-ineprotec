// Educacional › Ofertas › Planos de pagamento.
//
// A instituição cadastra os planos de cada oferta: quantas parcelas, quem
// cuida das que ficam (SEI, a plataforma, ou ninguém), o que o candidato pode
// pagar agora (a entrada ou o curso completo), por quais formas — Pix e boleto
// à vista com desconto, cartão e boleto parcelado até N vezes com juros por
// faixa — e o desconto de pontualidade. O candidato só vê o que estiver ligado.
// As contas de verdade são do servidor (services/planoFinanceiro); a prévia
// aqui só ajuda a conferir.

import { useEffect, useState } from 'preact/hooks'
import { Plus, Pencil, Trash2, Wallet } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { api, ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

type Destino = 'sei' | 'attrae' | 'nenhum'
interface Faixa { ate: number; jurosMesPct: number }
interface Formas {
  pix: { ativo: boolean; descontoPct: number }
  boleto: { ativo: boolean; descontoPct: number }
  cartao: { ativo: boolean; parcelasMax: number; faixas: Faixa[] }
  boletoParcelado: { ativo: boolean; parcelasMax: number; faixas: Faixa[] }
}
interface Regras {
  destino: Destino
  destinoBoletoIntegral: 'sei' | 'attrae'
  entrada: { ativo: boolean } & Formas
  integral: { ativo: boolean } & Formas
  pontualidade: { ativo: boolean; descontoPct: number; diaLimite: number }
  codigoSei: string
  codigoSeiIntegral: string
}
interface Plano {
  id?: number
  nome: string
  ativo: boolean
  totalParcelas: number
  primeira: 'matricula' | 'mensalidade'
  valorParcela: number
  valorMatricula: number | null
  diaVencimento: number
  regras: Regras
  doPortal?: boolean
}

const FORMAS_VAZIAS: Formas = {
  pix: { ativo: true, descontoPct: 0 },
  boleto: { ativo: false, descontoPct: 0 },
  cartao: { ativo: false, parcelasMax: 1, faixas: [] },
  boletoParcelado: { ativo: false, parcelasMax: 2, faixas: [] },
}
const NOVO: Plano = {
  nome: '', ativo: true, totalParcelas: 6, primeira: 'matricula', valorParcela: 0, valorMatricula: null, diaVencimento: 10,
  regras: {
    destino: 'attrae',
    destinoBoletoIntegral: 'attrae',
    entrada: { ativo: true, ...FORMAS_VAZIAS },
    integral: { ativo: false, ...FORMAS_VAZIAS },
    pontualidade: { ativo: false, descontoPct: 0, diaLimite: 5 },
    codigoSei: '', codigoSeiIntegral: '',
  },
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Juros da faixa que cobre n vezes — a mesma regra do servidor. */
function jurosDe(faixas: Faixa[], n: number) {
  if (n <= 1 || !faixas.length) return 0
  const ord = [...faixas].sort((a, b) => a.ate - b.ate)
  return (ord.find((f) => f.ate >= n) ?? ord[ord.length - 1]!).jurosMesPct
}
function parcelaPrice(valor: number, n: number, jurosPct: number) {
  if (jurosPct <= 0) return valor / n
  const i = jurosPct / 100
  return (valor * i) / (1 - Math.pow(1 + i, -n))
}

export function PlanosPagamentoModal({ offeringId, offeringNome, onClose }: { offeringId: number; offeringNome: string; onClose: () => void }) {
  const [planos, setPlanos] = useState<Plano[] | null>(null)
  const [editando, setEditando] = useState<Plano | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<Plano | null>(null)

  async function carregar() {
    try {
      const r = await api.get<{ planos: Plano[] }>(`/api/admin/educacional/offerings/${offeringId}/planos-pagamento`)
      setPlanos(r.planos)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao carregar os planos', 'danger')
      setPlanos([])
    }
  }
  useEffect(() => { void carregar() }, [offeringId])

  async function salvar() {
    if (!editando) return
    setSalvando(true)
    try {
      if (editando.id) await api.put(`/api/admin/educacional/planos-pagamento/${editando.id}`, editando)
      else await api.post(`/api/admin/educacional/offerings/${offeringId}/planos-pagamento`, editando)
      toast('Plano salvo', 'success')
      setEditando(null)
      await carregar()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao salvar', 'danger')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(p: Plano) {
    if (!p.id) return
    try {
      const r = await api.delete<{ desativado?: boolean; motivo?: string }>(`/api/admin/educacional/planos-pagamento/${p.id}`)
      toast(r.motivo ?? 'Plano excluído', r.desativado ? 'warning' : 'success')
      await carregar()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao excluir', 'danger')
    } finally {
      setExcluindo(null)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={editando ? (editando.id ? 'Editar plano de pagamento' : 'Novo plano de pagamento') : 'Planos de pagamento'}
      description={offeringNome}
      size="xl"
      footer={editando ? (
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditando(null)}>Voltar</Button>
          <Button onClick={salvar} loading={salvando}>Salvar plano</Button>
        </div>
      ) : undefined}
    >
      {editando ? (
        <EditorDoPlano plano={editando} muda={setEditando} />
      ) : (
        <div class="flex flex-col gap-3">
          <p class="text-xs text-fg-muted">
            O candidato vê na etapa de pagamento só os planos ativos, as opções e as formas ligadas aqui.
            Com mais de um plano, ele escolhe. Mudar um plano vale para as próximas inscrições, e os contratos
            já gerados ficam como foram contratados.
          </p>
          {planos == null ? <div class="text-xs text-fg-muted">Carregando…</div> : planos.length === 0 ? (
            <div class="text-xs text-fg-muted border border-dashed border-border rounded-md p-4 text-center">
              Nenhum plano cadastrado. Sem plano, o portal cobra pela tabela de preços ou pelo valor da oferta, como antes.
            </div>
          ) : planos.map((p) => (
            <div key={p.id} class="flex items-start gap-3 border border-border rounded-md p-3">
              <span class="size-8 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0"><Wallet size={14} /></span>
              <div class="min-w-0 flex-1 text-xs">
                <div class="text-sm font-medium flex items-center gap-2 flex-wrap">
                  {p.nome}
                  {!p.ativo && <span class="text-3xs bg-surface-3 text-fg-muted px-2 py-0.5 rounded-full">inativo</span>}
                  {!p.doPortal && <span class="text-3xs bg-warning/15 text-warning px-2 py-0.5 rounded-full">plano antigo do ERP: não aparece no portal; se salvar aqui, passa a valer no portal no lugar da tabela de preços da oferta</span>}
                </div>
                <div class="text-fg-muted mt-0.5">{resumo(p)}</div>
                <div class="text-fg-muted mt-0.5">
                  Parcelas restantes: <b class="text-fg">{p.regras.destino === 'sei' ? 'enviadas ao SEI' : p.regras.destino === 'attrae' ? 'cobradas aqui (fatura mensal)' : 'nenhuma'}</b>
                  {' · '}Opções: {[p.regras.entrada.ativo && 'entrada', p.regras.integral.ativo && 'curso completo'].filter(Boolean).join(' e ') || '—'}
                  {p.regras.pontualidade.ativo && p.regras.pontualidade.descontoPct > 0 && ` · pontualidade ${p.regras.pontualidade.descontoPct}% até o dia ${p.regras.pontualidade.diaLimite}`}
                </div>
              </div>
              <div class="flex gap-0.5 shrink-0">
                <button type="button" class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20" onClick={() => setEditando(copia(p))} aria-label="Editar" title="Editar"><Pencil size={12} /></button>
                <button type="button" class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20" onClick={() => setExcluindo(p)} aria-label="Excluir" title="Excluir"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          <div><Button variant="secondary" onClick={() => setEditando(copia(NOVO))}><Plus size={12} /> Novo plano</Button></div>
        </div>
      )}
      {excluindo && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setExcluindo(null) }}
          title="Excluir plano"
          description={`Excluir o plano "${excluindo.nome}"? Se ele já estiver em algum contrato, só é desativado.`}
          confirmLabel="Excluir"
          destructive
          onConfirm={() => excluir(excluindo)}
        />
      )}
    </Modal>
  )
}

function resumo(p: Plano) {
  const mat = p.primeira === 'matricula'
  const vm = mat ? (p.valorMatricula ?? p.valorParcela) : p.valorParcela
  const total = vm + p.valorParcela * (p.totalParcelas - 1)
  if (mat && vm !== p.valorParcela) return `Matrícula ${brl(vm)} + ${p.totalParcelas - 1}x ${brl(p.valorParcela)} · total ${brl(total)} · vence dia ${p.diaVencimento}`
  return `${p.totalParcelas}x ${brl(p.valorParcela)} (a 1ª é ${mat ? 'a matrícula' : 'a 1ª mensalidade'}) · total ${brl(total)} · vence dia ${p.diaVencimento}`
}

function Marca({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: any }) {
  return (
    <label class="flex items-center gap-1.5 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /> {children}
    </label>
  )
}

function Secao({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: any }) {
  return (
    <div class="border border-border rounded-md p-3 flex flex-col gap-2">
      <div>
        <div class="text-sm font-medium">{titulo}</div>
        {ajuda && <div class="text-2xs text-fg-muted mt-0.5">{ajuda}</div>}
      </div>
      {children}
    </div>
  )
}

function EditorDoPlano({ plano: p, muda }: { plano: Plano; muda: (p: Plano) => void }) {
  const set = (parcial: Partial<Plano>) => muda({ ...p, ...parcial })
  const setR = (parcial: Partial<Regras>) => muda({ ...p, regras: { ...p.regras, ...parcial } })
  const mat = p.primeira === 'matricula'
  const vEntrada = mat ? (p.valorMatricula ?? p.valorParcela) : p.valorParcela
  const vIntegral = vEntrada + p.valorParcela * Math.max(0, p.totalParcelas - 1)
  const r = p.regras

  return (
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Nome do plano *" value={p.nome} placeholder="Ex.: Semestral — 6 parcelas" onInput={(e) => set({ nome: (e.target as HTMLInputElement).value })} />
        <div class="flex items-end pb-2"><Marca checked={p.ativo} onChange={(v) => set({ ativo: v })}>Plano ativo (aparece no portal)</Marca></div>
      </div>

      <Secao titulo="Parcelas do curso" ajuda="O total de parcelas, contando a primeira, que é a cobrada na inscrição.">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Total de parcelas" type="number" min={1} max={120} value={String(p.totalParcelas)} onInput={(e) => set({ totalParcelas: Math.max(1, Math.round(num((e.target as HTMLInputElement).value))) })} />
          <Select label="A 1ª parcela é" value={p.primeira} onChange={(e) => set({ primeira: (e.target as HTMLSelectElement).value as Plano['primeira'] })}>
            <option value="matricula">a matrícula</option>
            <option value="mensalidade">a 1ª mensalidade</option>
          </Select>
          <Input label="Valor de cada parcela (R$)" type="number" step="0.01" min={0} value={String(p.valorParcela || '')} onInput={(e) => set({ valorParcela: num((e.target as HTMLInputElement).value) })} />
          <Input label="Vencimento (dia do mês)" type="number" min={1} max={28} value={String(p.diaVencimento)} onInput={(e) => set({ diaVencimento: Math.min(28, Math.max(1, Math.round(num((e.target as HTMLInputElement).value)))) })} />
        </div>
        {mat && (
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input label="Valor da matrícula (R$)" hint="Em branco = igual à parcela" type="number" step="0.01" min={0} value={p.valorMatricula == null ? '' : String(p.valorMatricula)} onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ valorMatricula: v === '' ? null : num(v) }) }} />
          </div>
        )}
        <div class="text-2xs text-fg-muted">{resumo(p)}</div>
      </Secao>

      <Secao titulo="Parcelas que ficam em aberto" ajuda="Depois da entrada: quem emite e cobra as demais parcelas.">
        <Select value={r.destino} onChange={(e) => setR({ destino: (e.target as HTMLSelectElement).value as Destino })}>
          <option value="sei">Enviadas ao SEI (o SEI cobra)</option>
          <option value="attrae">Cobradas aqui (fatura mês a mês no gateway)</option>
          <option value="nenhum">Nenhuma (só pagamento integral)</option>
        </Select>
        {(r.destino === 'sei' || (r.integral.ativo && r.integral.boletoParcelado.ativo && r.destinoBoletoIntegral === 'sei')) && (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Código da condição de pagamento no SEI" value={r.codigoSei} onInput={(e) => setR({ codigoSei: (e.target as HTMLInputElement).value })} hint="Vai na integração com a matrícula" />
            {r.integral.ativo && <Input label="Código no SEI (curso completo)" value={r.codigoSeiIntegral} onInput={(e) => setR({ codigoSeiIntegral: (e.target as HTMLInputElement).value })} hint="Em branco = o mesmo código" />}
          </div>
        )}
        {(r.destino === 'attrae' || (r.integral.ativo && r.integral.boletoParcelado.ativo && r.destinoBoletoIntegral === 'attrae')) && (
          <div class="flex flex-col gap-2">
            <Marca checked={r.pontualidade.ativo} onChange={(v) => setR({ pontualidade: { ...r.pontualidade, ativo: v } })}>Desconto de pontualidade</Marca>
            {r.pontualidade.ativo && (
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Input label="Desconto (%)" type="number" step="0.01" min={0} max={90} value={String(r.pontualidade.descontoPct || '')} onInput={(e) => setR({ pontualidade: { ...r.pontualidade, descontoPct: num((e.target as HTMLInputElement).value) } })} />
                <Input label="Pagando até o dia" type="number" min={1} max={27} value={String(r.pontualidade.diaLimite)} onInput={(e) => setR({ pontualidade: { ...r.pontualidade, diaLimite: Math.round(num((e.target as HTMLInputElement).value)) } })} hint={`Antes do vencimento (dia ${p.diaVencimento})`} />
              </div>
            )}
            {r.pontualidade.ativo && <div class="text-2xs text-fg-muted">A fatura de cada mês sai com {r.pontualidade.descontoPct || 0}% de desconto para pagamento até o dia {r.pontualidade.diaLimite}. Depois desse dia, vale o valor cheio da parcela (com os demais descontos, como bolsa, que já estão nela).</div>}
          </div>
        )}
      </Secao>

      <Secao titulo={`Pagar a entrada — ${mat ? 'matrícula' : '1ª parcela'} de ${brl(vEntrada)}`} ajuda="O candidato paga só a primeira parcela agora; as demais seguem o destino acima.">
        <Marca checked={r.entrada.ativo} onChange={(v) => setR({ entrada: { ...r.entrada, ativo: v } })}>Oferecer esta opção</Marca>
        {r.entrada.ativo && <EditorDeFormas valor={vEntrada} formas={r.entrada} muda={(f) => setR({ entrada: { ...r.entrada, ...f } })} />}
      </Secao>

      {p.totalParcelas > 1 && (
        <Secao titulo={`Pagar o curso completo — ${brl(vIntegral)}`} ajuda="O candidato quita tudo agora: à vista (com desconto) ou parcelado no cartão/boleto. Não sobra parcela do plano.">
          <Marca checked={r.integral.ativo} onChange={(v) => setR({ integral: { ...r.integral, ativo: v } })}>Oferecer esta opção</Marca>
          {r.integral.ativo && <EditorDeFormas valor={vIntegral} formas={r.integral} muda={(f) => setR({ integral: { ...r.integral, ...f } })} />}
          {r.integral.ativo && r.integral.boletoParcelado.ativo && (
            <Select
              label="Parcelas do boleto parcelado (curso completo)"
              hint="A 1ª é paga na inscrição; as demais ficam em aberto com quem você escolher aqui."
              value={r.destinoBoletoIntegral}
              onChange={(e) => setR({ destinoBoletoIntegral: (e.target as HTMLSelectElement).value as 'sei' | 'attrae' })}
            >
              <option value="attrae">Cobradas aqui (fatura mês a mês no gateway)</option>
              <option value="sei">Enviadas ao SEI (o SEI cobra)</option>
            </Select>
          )}
        </Secao>
      )}
    </div>
  )
}

function EditorDeFormas({ valor, formas: f, muda }: { valor: number; formas: Formas; muda: (f: Formas) => void }) {
  const set = <K extends keyof Formas>(k: K, v: Partial<Formas[K]>) => muda({ ...f, [k]: { ...f[k], ...v } })
  return (
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="border border-border rounded-md p-2 flex flex-col gap-2">
        <Marca checked={f.pix.ativo} onChange={(v) => set('pix', { ativo: v })}>Pix</Marca>
        {f.pix.ativo && <Input label="Desconto à vista (%)" type="number" step="0.01" min={0} max={90} value={String(f.pix.descontoPct || '')} onInput={(e) => set('pix', { descontoPct: num((e.target as HTMLInputElement).value) })} hint={f.pix.descontoPct > 0 ? `Fica ${brl(valor * (1 - f.pix.descontoPct / 100))}` : undefined} />}
      </div>
      <div class="border border-border rounded-md p-2 flex flex-col gap-2">
        <Marca checked={f.boleto.ativo} onChange={(v) => set('boleto', { ativo: v })}>Boleto à vista</Marca>
        {f.boleto.ativo && <Input label="Desconto à vista (%)" type="number" step="0.01" min={0} max={90} value={String(f.boleto.descontoPct || '')} onInput={(e) => set('boleto', { descontoPct: num((e.target as HTMLInputElement).value) })} hint={f.boleto.descontoPct > 0 ? `Fica ${brl(valor * (1 - f.boleto.descontoPct / 100))}` : undefined} />}
      </div>
      <Parcelado titulo="Cartão de crédito" teto={12} valor={valor} forma={f.cartao} muda={(v) => set('cartao', v)} />
      <Parcelado titulo="Boleto parcelado" teto={48} valor={valor} forma={f.boletoParcelado} muda={(v) => set('boletoParcelado', v)} minimo={2} />
    </div>
  )
}

function Parcelado({ titulo, teto, valor, forma, muda, minimo = 1 }: {
  titulo: string; teto: number; valor: number; minimo?: number
  forma: { ativo: boolean; parcelasMax: number; faixas: Faixa[] }
  muda: (v: Partial<{ ativo: boolean; parcelasMax: number; faixas: Faixa[] }>) => void
}) {
  const faixas = forma.faixas
  const setFaixa = (i: number, v: Partial<Faixa>) => muda({ faixas: faixas.map((x, j) => (j === i ? { ...x, ...v } : x)) })
  const exemplo = [minimo, Math.ceil(forma.parcelasMax / 2), forma.parcelasMax].filter((n, i, a) => n >= minimo && a.indexOf(n) === i)
  return (
    <div class="border border-border rounded-md p-2 flex flex-col gap-2">
      <Marca checked={forma.ativo} onChange={(v) => muda({ ativo: v })}>{titulo}</Marca>
      {forma.ativo && (
        <>
          <Input label={`Em até quantas vezes (máx. ${teto})`} type="number" min={minimo} max={teto} value={String(forma.parcelasMax)} onInput={(e) => muda({ parcelasMax: Math.min(teto, Math.max(minimo, Math.round(num((e.target as HTMLInputElement).value)))) })} hint={`O candidato vê de ${minimo}x a ${forma.parcelasMax}x`} />
          <div class="text-2xs text-fg-muted">Juros por faixa (ao mês). Sem faixa = sem juros. Ex.: até 2x → 0%; até 6x → 1,99%; até 12x → 2,49%.</div>
          {faixas.map((fx, i) => (
            <div key={i} class="flex items-end gap-2">
              <Input label="Até (vezes)" type="number" min={1} max={forma.parcelasMax} value={String(fx.ate)} onInput={(e) => setFaixa(i, { ate: Math.round(num((e.target as HTMLInputElement).value)) })} />
              <Input label="Juros % a.m." type="number" step="0.01" min={0} max={20} value={String(fx.jurosMesPct)} onInput={(e) => setFaixa(i, { jurosMesPct: num((e.target as HTMLInputElement).value) })} />
              <button type="button" class="size-8 mb-0.5 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20 shrink-0" onClick={() => muda({ faixas: faixas.filter((_, j) => j !== i) })} aria-label="Remover faixa"><Trash2 size={12} /></button>
            </div>
          ))}
          <div><Button size="sm" variant="ghost" onClick={() => muda({ faixas: [...faixas, { ate: forma.parcelasMax, jurosMesPct: 0 }] })}><Plus size={12} /> Faixa de juros</Button></div>
          {valor > 0 && (
            <div class="text-2xs text-fg-muted">
              Prévia: {exemplo.map((n) => {
                const j = jurosDe(faixas, n)
                const parc = parcelaPrice(valor, n, j)
                return `${n}x ${brl(parc)}${j > 0 ? ` (total ${brl(parc * n)})` : ' sem juros'}`
              }).join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
