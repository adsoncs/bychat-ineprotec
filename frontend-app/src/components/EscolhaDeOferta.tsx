// Fase 5 (temporário, 23/10/2026): as propostas antigas que o sistema não
// conseguiu ligar com certeza a uma oferta dos portais. Quem vendeu escolhe a
// oferta certa — grava só a ligação; valor, data e comissão não mudam.
// Quando a lista zerar, a chave sai e este componente também.

import { useState } from 'preact/hooks'
import { AlertTriangle, Check, ExternalLink } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import {
  usePendenciasDeOferta, usePendenciaDaProposta, useEscolherOferta,
  type OpcaoDeOferta, type PendenciaDeOferta,
} from '@/hooks/useNegotiations'

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const SEM = 'sem'

/** Seletor + Salvar de uma pendência: prováveis primeiro, depois todas as ofertas. */
function Escolher({ p, opcoes, compacto }: { p: PendenciaDeOferta; opcoes: OpcaoDeOferta[]; compacto?: boolean }) {
  const [valor, setValor] = useState<string>(p.candidatos.length === 1 ? String(p.candidatos[0]!.id) : '')
  const salvar = useEscolherOferta()
  const prov = new Set(p.candidatos.map((c) => c.id))
  const outras = opcoes.filter((o) => !prov.has(o.id))
  const rotulo = (o: OpcaoDeOferta) => `${o.nome} · ${o.portal}`
  function ok() {
    if (!valor) { toast('Escolha a oferta', 'warning'); return }
    salvar.mutate(
      { id: p.negotiationId, ...(valor === SEM ? { semCurso: true } : { offeringId: Number(valor) }) },
      { onSuccess: () => toast('Curso da proposta salvo', 'success'), onError: (e: unknown) => toast((e as Error).message, 'danger') },
    )
  }
  return (
    <div class={compacto ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center gap-2 mt-2'}>
      <Select value={valor} onChange={(e) => setValor((e.target as HTMLSelectElement).value)} class="min-w-72 flex-1">
        <option value="">Escolha a oferta…</option>
        {p.candidatos.length ? (
          <optgroup label="Prováveis">
            {p.candidatos.map((o) => <option key={o.id} value={o.id}>{rotulo(o)}</option>)}
          </optgroup>
        ) : null}
        <optgroup label="Todas as ofertas dos portais">
          {outras.map((o) => <option key={o.id} value={o.id}>{rotulo(o)}</option>)}
        </optgroup>
        <option value={SEM}>Não é curso / sem curso</option>
      </Select>
      <Button size="sm" onClick={ok} disabled={salvar.isPending}><Check size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar'}</Button>
    </div>
  )
}

/** Aviso dentro da proposta (editor da negociação). */
export function AvisoDeOfertaDaProposta({ negotiationId }: { negotiationId: number }) {
  const { data } = usePendenciaDaProposta(negotiationId)
  const p = data?.pendencia
  if (!p) return null
  return (
    <Card class="!p-3 bg-warning/10 border-warning/40">
      <div class="flex items-start gap-2">
        <AlertTriangle size={16} class="text-warning mt-0.5 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-fg">Escolha a oferta desta venda</div>
          <p class="text-xs text-fg-muted">
            O sistema não conseguiu saber com certeza de qual curso e frente (escola ou consultoria) é esta proposta.
            {p.pista ? <> Pista: <em>{p.pista}</em></> : null}
          </p>
          <Escolher p={p} opcoes={data?.opcoes ?? []} />
        </div>
      </div>
    </Card>
  )
}

/** Lista para resolver de uma vez (topo de Negociações). Some quando não há pendência. */
export function PendenciasDeOferta({ onAbrirLead }: { onAbrirLead: (leadId: number) => void }) {
  const { data } = usePendenciasDeOferta()
  const [aberto, setAberto] = useState(false)
  const [verPerdidas, setVerPerdidas] = useState(false)
  const itens = data?.itens ?? []
  if (!data?.ligado || !itens.length) return null
  const alta = itens.filter((i) => i.prioridade === 'alta')
  const mostrar = verPerdidas ? itens : alta
  return (
    <Card class="!p-3 bg-warning/10 border-warning/40">
      <div class="flex flex-wrap items-center gap-2">
        <AlertTriangle size={16} class="text-warning" />
        <div class="flex-1 min-w-56 text-sm text-fg">
          <strong>{itens.length}</strong> proposta(s) {data.totalGeral > itens.length ? 'suas ' : ''}precisam da oferta certa
          {alta.length ? <> — <strong>{alta.length}</strong> ganhas ou abertas</> : null}.
          <span class="text-xs text-fg-muted"> Só liga a proposta ao curso; valor, data e comissão não mudam.</span>
        </div>
        <Button size="sm" variant={aberto ? 'secondary' : 'primary'} onClick={() => setAberto(!aberto)}>{aberto ? 'Fechar' : 'Resolver agora'}</Button>
      </div>
      {aberto ? (
        <div class="mt-3 space-y-2">
          <label class="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" checked={verPerdidas} onChange={(e) => setVerPerdidas((e.target as HTMLInputElement).checked)} />
            Mostrar também as perdidas ({itens.length - alta.length}) — opcionais
          </label>
          {mostrar.map((p) => (
            <div key={p.negotiationId} class="rounded-md border border-border bg-surface p-2">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <button type="button" class="text-fg font-medium hover:text-accent inline-flex items-center gap-1" onClick={() => onAbrirLead(p.leadId)}>
                  {p.leadNome || `Lead #${p.leadId}`} <ExternalLink size={12} />
                </button>
                <span class="text-xs text-fg-muted truncate max-w-80">{p.titulo}</span>
                {p.resultado === 'won' ? <Badge tone="success">Ganha · {brl(p.valorFinal)}</Badge> : p.resultado === 'lost' ? <Badge tone="danger">Perdida</Badge> : <Badge tone="info">Aberta</Badge>}
                <span class="text-2xs text-fg-muted">{new Date(p.createdAt).toLocaleDateString('pt-BR')}{p.responsavel ? ` · ${p.responsavel}` : ''}</span>
              </div>
              {p.pista ? <p class="text-xs text-fg-muted mt-1">Pista: <em>{p.pista}</em></p> : null}
              <Escolher p={p} opcoes={data.opcoes} compacto />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
