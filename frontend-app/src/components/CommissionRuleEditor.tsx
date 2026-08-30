// Editor de uma regra de comissão.
//
// A regra responde três perguntas, nesta ordem: PARA QUEM vale (funil + agentes),
// QUANTO paga (uma taxa para o pagamento único, outra para a mensalidade — porque
// a proposta separa os dois) e SE a taxa melhora quando o agente bate a meta.

import { useEffect, useState } from 'preact/hooks'
import { Plus, Trash2 } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import {
  METRIC_LABEL, METRICS,
  useSaveCommissionRule,
  type CommissionRule, type CommissionTier, type GoalMetric, type RateType,
} from '@/hooks/useGoalsCommissions'

interface Funnel { id: number; name: string; active?: boolean }
interface UserOption { id: number; name: string }

type Draft = {
  id?: number
  nome: string
  active: boolean
  funnelId: number | null
  prioridade: number
  base: 'liquido' | 'bruto'
  tipoUnico: RateType
  taxaUnico: string
  tipoRecorrente: RateType
  taxaRecorrente: string
  mesesRecorrente: number
  aceleradorAtivo: boolean
  aceleradorMetrica: GoalMetric | null
  observacoes: string
  agentIds: number[]
  tiers: (Omit<CommissionTier, 'taxaUnico' | 'taxaRecorrente'> & { taxaUnico: string; taxaRecorrente: string })[]
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

function emptyDraft(): Draft {
  return {
    nome: '', active: true, funnelId: null, prioridade: 0, base: 'liquido',
    tipoUnico: 'percent', taxaUnico: '', tipoRecorrente: 'percent', taxaRecorrente: '',
    mesesRecorrente: 1, aceleradorAtivo: false, aceleradorMetrica: null, observacoes: '',
    agentIds: [], tiers: [],
  }
}

function toDraft(r: CommissionRule): Draft {
  return {
    id: r.id, nome: r.nome, active: r.active, funnelId: r.funnelId, prioridade: r.prioridade,
    base: r.base, tipoUnico: r.tipoUnico, taxaUnico: str(r.taxaUnico),
    tipoRecorrente: r.tipoRecorrente, taxaRecorrente: str(r.taxaRecorrente),
    mesesRecorrente: r.mesesRecorrente, aceleradorAtivo: r.aceleradorAtivo,
    aceleradorMetrica: r.aceleradorMetrica, observacoes: r.observacoes ?? '',
    agentIds: r.agentIds ?? [],
    tiers: (r.tiers ?? []).map((t) => ({ ...t, taxaUnico: str(t.taxaUnico), taxaRecorrente: str(t.taxaRecorrente) })),
  }
}

/** Um bloco de taxa (único ou mensalidade): tipo + valor, na mesma linha. */
function RateFields({ titulo, ajuda, tipo, taxa, onTipo, onTaxa }: {
  titulo: string
  ajuda: string
  tipo: RateType
  taxa: string
  onTipo: (v: RateType) => void
  onTaxa: (v: string) => void
}) {
  return (
    <div class="rounded-lg border border-border p-3 space-y-2">
      <div>
        <div class="text-sm font-medium text-fg">{titulo}</div>
        <div class="text-2xs text-fg-muted">{ajuda}</div>
      </div>
      <div class="flex items-end gap-2">
        <Select label="Forma" value={tipo} onChange={(e) => onTipo((e.target as HTMLSelectElement).value as RateType)} class="w-40">
          <option value="percent">Percentual (%)</option>
          <option value="valor">Valor fixo (R$)</option>
          <option value="none">Não comissiona</option>
        </Select>
        {tipo !== 'none' ? (
          <Input
            label={tipo === 'percent' ? 'Taxa (%)' : 'Valor (R$)'}
            type="number" step="0.01" min="0"
            value={taxa}
            onInput={(e) => onTaxa((e.target as HTMLInputElement).value)}
            class="w-32"
          />
        ) : null}
      </div>
    </div>
  )
}

export function CommissionRuleEditor({ open, rule, funnels, users, onClose }: {
  open: boolean
  rule: CommissionRule | null
  funnels: Funnel[]
  users: UserOption[]
  onClose: () => void
}) {
  const [d, setD] = useState<Draft>(emptyDraft())
  const save = useSaveCommissionRule()

  useEffect(() => {
    if (!open) return
    setD(rule ? toDraft(rule) : emptyDraft())
  }, [open, rule])

  const patch = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }))

  function toggleAgent(id: number) {
    setD((cur) => ({
      ...cur,
      agentIds: cur.agentIds.includes(id) ? cur.agentIds.filter((x) => x !== id) : [...cur.agentIds, id],
    }))
  }

  function addTier() {
    setD((cur) => ({
      ...cur,
      tiers: [...cur.tiers, {
        atingimentoMin: cur.tiers.length ? Math.min(200, (cur.tiers[cur.tiers.length - 1].atingimentoMin || 0) + 20) : 0,
        tipoUnico: cur.tipoUnico, taxaUnico: cur.taxaUnico,
        tipoRecorrente: cur.tipoRecorrente, taxaRecorrente: cur.taxaRecorrente,
      }],
    }))
  }
  function patchTier(i: number, p: Partial<Draft['tiers'][number]>) {
    setD((cur) => ({ ...cur, tiers: cur.tiers.map((t, idx) => (idx === i ? { ...t, ...p } : t)) }))
  }
  function removeTier(i: number) {
    setD((cur) => ({ ...cur, tiers: cur.tiers.filter((_, idx) => idx !== i) }))
  }

  function submit() {
    if (!d.nome.trim()) { toast('Dê um nome à regra', 'danger'); return }
    if (d.aceleradorAtivo && !d.aceleradorMetrica) { toast('Escolha o indicador que mede o atingimento', 'danger'); return }
    if (d.aceleradorAtivo && !d.tiers.length) { toast('Adicione ao menos uma faixa ou desligue o acelerador', 'danger'); return }
    save.mutate({
      ...d,
      taxaUnico: d.taxaUnico === '' ? null : Number(d.taxaUnico),
      taxaRecorrente: d.taxaRecorrente === '' ? null : Number(d.taxaRecorrente),
      tiers: d.tiers.map((t) => ({
        ...t,
        taxaUnico: t.taxaUnico === '' ? null : Number(t.taxaUnico),
        taxaRecorrente: t.taxaRecorrente === '' ? null : Number(t.taxaRecorrente),
      })),
    } as any, {
      onSuccess: () => { toast('Regra salva', 'success'); onClose() },
      onError: () => toast('Falha ao salvar a regra', 'danger'),
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={rule ? `Regra: ${rule.nome}` : 'Nova regra de comissão'}
      size="lg"
      footer={
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar regra'}</Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <Input label="Nome da regra" value={d.nome} onInput={(e) => patch({ nome: (e.target as HTMLInputElement).value })} placeholder="Ex.: Comercial — padrão" />
          <Select label="Funil" value={d.funnelId ? String(d.funnelId) : ''} onChange={(e) => patch({ funnelId: Number((e.target as HTMLSelectElement).value) || null })}>
            <option value="">Qualquer funil</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        </div>

        {/* Para quem vale */}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div>
            <div class="text-sm font-medium text-fg">Agentes</div>
            <div class="text-2xs text-fg-muted">
              Nenhum marcado = vale para todo agente. Marcar alguém cria a exceção dessa pessoa,
              que passa na frente da regra geral do funil.
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {users.map((u) => {
              const on = d.agentIds.includes(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleAgent(u.id)}
                  class={on
                    ? 'px-2 py-1 rounded-md text-xs border border-accent bg-accent text-fg-on-brand'
                    : 'px-2 py-1 rounded-md text-xs border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3'}
                >{u.name}</button>
              )
            })}
          </div>
        </div>

        {/* Quanto paga */}
        <div class="grid gap-3 sm:grid-cols-2">
          <RateFields
            titulo="Pagamento único"
            ajuda="Incide sobre o que é cobrado uma vez só na proposta."
            tipo={d.tipoUnico} taxa={d.taxaUnico}
            onTipo={(v) => patch({ tipoUnico: v })} onTaxa={(v) => patch({ taxaUnico: v })}
          />
          <div class="space-y-2">
            <RateFields
              titulo="Mensalidade"
              ajuda="Incide sobre a mensalidade (MRR) da proposta."
              tipo={d.tipoRecorrente} taxa={d.taxaRecorrente}
              onTipo={(v) => patch({ tipoRecorrente: v })} onTaxa={(v) => patch({ taxaRecorrente: v })}
            />
            {d.tipoRecorrente !== 'none' ? (
              <Input
                label="Quantas mensalidades comissionam"
                hint="1 = só a primeira mensalidade."
                type="number" min="1" step="1"
                value={String(d.mesesRecorrente)}
                onInput={(e) => patch({ mesesRecorrente: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })}
                class="w-56"
              />
            ) : null}
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <Select label="Base de cálculo" value={d.base} onChange={(e) => patch({ base: (e.target as HTMLSelectElement).value as 'liquido' | 'bruto' })}>
            <option value="liquido">Valor negociado (com desconto)</option>
            <option value="bruto">Valor de tabela (sem desconto)</option>
          </Select>
          <Input
            label="Prioridade"
            hint="Desempata entre regras igualmente específicas — maior ganha."
            type="number" step="1"
            value={String(d.prioridade)}
            onInput={(e) => patch({ prioridade: Number((e.target as HTMLInputElement).value) || 0 })}
          />
        </div>

        {/* Acelerador */}
        <div class="rounded-lg border border-border p-3 space-y-3">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={d.aceleradorAtivo} onChange={(e) => patch({ aceleradorAtivo: (e.target as HTMLInputElement).checked })} class="mt-1" />
            <span>
              <span class="text-sm font-medium text-fg">Acelerador por meta</span>
              <span class="block text-2xs text-fg-muted">
                A taxa muda conforme o quanto o agente atingiu da meta no mês. A faixa alcançada vale
                para <strong>tudo o que ele fechou no período</strong>, não só para a venda que passou do alvo.
              </span>
            </span>
          </label>

          {d.aceleradorAtivo ? (
            <div class="space-y-3">
              <Select
                label="Indicador que mede o atingimento"
                hint="A meta comparada é a do agente neste funil (ou a dele sem funil, se não houver)."
                value={d.aceleradorMetrica ?? ''}
                onChange={(e) => patch({ aceleradorMetrica: ((e.target as HTMLSelectElement).value || null) as GoalMetric | null })}
                class="w-72"
              >
                <option value="">Escolha…</option>
                {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
              </Select>

              <div class="space-y-2">
                {d.tiers.length === 0 ? (
                  <p class="text-xs text-fg-muted">Sem faixas, vale sempre a taxa acima.</p>
                ) : null}
                {d.tiers.map((t, i) => (
                  <div key={i} class="flex flex-wrap items-end gap-2 rounded-md border border-border/70 p-2">
                    <Input
                      label="A partir de (% da meta)"
                      type="number" min="0" step="1"
                      value={String(t.atingimentoMin)}
                      onInput={(e) => patchTier(i, { atingimentoMin: Number((e.target as HTMLInputElement).value) || 0 })}
                      class="w-40"
                    />
                    <Select label="Único" value={t.tipoUnico} onChange={(e) => patchTier(i, { tipoUnico: (e.target as HTMLSelectElement).value as RateType })} class="w-32">
                      <option value="percent">%</option>
                      <option value="valor">R$</option>
                      <option value="none">—</option>
                    </Select>
                    {t.tipoUnico !== 'none' ? (
                      <Input label="Taxa" type="number" step="0.01" min="0" value={t.taxaUnico} onInput={(e) => patchTier(i, { taxaUnico: (e.target as HTMLInputElement).value })} class="w-24" />
                    ) : null}
                    <Select label="Mensal" value={t.tipoRecorrente} onChange={(e) => patchTier(i, { tipoRecorrente: (e.target as HTMLSelectElement).value as RateType })} class="w-32">
                      <option value="percent">%</option>
                      <option value="valor">R$</option>
                      <option value="none">—</option>
                    </Select>
                    {t.tipoRecorrente !== 'none' ? (
                      <Input label="Taxa" type="number" step="0.01" min="0" value={t.taxaRecorrente} onInput={(e) => patchTier(i, { taxaRecorrente: (e.target as HTMLInputElement).value })} class="w-24" />
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => removeTier(i)} title="Remover faixa"><Trash2 size={14} /></Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={addTier}><Plus size={14} /> Adicionar faixa</Button>
              </div>
            </div>
          ) : null}
        </div>

        <Textarea
          label="Observações"
          value={d.observacoes}
          onInput={(e) => patch({ observacoes: (e.target as HTMLTextAreaElement).value })}
          rows={2}
        />

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={d.active} onChange={(e) => patch({ active: (e.target as HTMLInputElement).checked })} />
          <span class="text-sm text-fg">Regra ativa</span>
          {!d.active ? <Badge tone="warning">Inativa não comissiona novas vendas</Badge> : null}
        </label>
      </div>
    </Modal>
  )
}
