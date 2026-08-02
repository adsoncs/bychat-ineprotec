import { useState, useMemo, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Save, Wand2, AlertTriangle, Info, Workflow } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import {
  useFunnelReportConfig, useSaveFunnelReportConfig,
  type DefKpi, type PapelKey, type ConfigFunil, type FunnelReportConfig, type ConfigPayload,
} from '@/hooks/useFunnelReport'

// Configuração do Relatório de Funil: o que define MQL, SQL, RA, RR, Fechamento
// e Faturamento.
//
// A configuração é POR FUNIL porque as etapas variam — "Matrículas" vai de
// INTERESSADO a MATRICULADO e não tem nenhuma etapa em comum com o funil padrão.
// Um mapeamento global estaria errado para a maioria dos funis, que foi
// exatamente o defeito que esta tela corrige.
//
// Tela dedicada, não modal: são 6 decisões por funil, cada uma com parâmetros
// próprios, e o usuário precisa comparar com as etapas reais enquanto decide.

const ROTULO_ESCOPO: Record<string, string> = {
  todos: 'Todos os leads (inclui orgânicos)',
  pago: 'Somente leads de campanha paga',
}
const ROTULO_CONTAGEM: Record<string, string> = {
  passou: 'Quem alcançou a etapa no período (histórico)',
  atual: 'Quem está na etapa ou além (situação atual)',
}

export function FunnelReportConfigPage() {
  const [, navigate] = useLocation()
  const { data, isLoading } = useFunnelReportConfig()
  const salvar = useSaveFunnelReportConfig()

  const [rascunho, setRascunho] = useState<FunnelReportConfig | null>(null)
  const [funilSel, setFunilSel] = useState<number | null>(null)

  // Carrega o salvo uma vez; depois o rascunho é a fonte da verdade, para o
  // refetch não descartar edição em andamento.
  useEffect(() => {
    if (data?.config && !rascunho) setRascunho(structuredClone(data.config))
    if (data?.funnels?.length && funilSel === null) setFunilSel(data.funnels[0]!.id)
  }, [data, rascunho, funilSel])

  if (isLoading || !data || !rascunho) return <Skeleton class="h-96 w-full" />

  const funil = data.funnels.find((f) => f.id === funilSel) ?? data.funnels[0]
  const cfgFunil: ConfigFunil = (funilSel !== null ? rascunho.porFunil[String(funilSel)] : undefined) ?? {}

  function definir(papel: PapelKey, def: DefKpi | undefined) {
    if (funilSel === null) return
    setRascunho((r) => {
      if (!r) return r
      const novo = structuredClone(r)
      const chave = String(funilSel)
      novo.porFunil[chave] = { ...(novo.porFunil[chave] ?? {}) }
      if (def) novo.porFunil[chave]![papel] = def
      else delete novo.porFunil[chave]![papel]
      return novo
    })
  }

  function aplicarSugestao() {
    if (funilSel === null || !data) return
    const sug = data.sugestoes[String(funilSel)]
    if (!sug) return
    setRascunho((r) => {
      if (!r) return r
      const novo = structuredClone(r)
      novo.porFunil[String(funilSel)] = structuredClone(sug) as ConfigFunil
      return novo
    })
    toast('Sugestão aplicada — revise antes de salvar', 'success')
  }

  function handleSalvar() {
    if (!rascunho) return
    salvar.mutate(rascunho, {
      onSuccess: () => toast('Configuração salva — o relatório já usa as novas definições', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const pendentes = data.papeis.filter((p) => !cfgFunil[p.key])

  return (
    <Page
      title="Configuração do Relatório de Funil"
      description="Define o que conta como MQL, SQL, RA, RR, Fechamento e Faturamento em cada funil."
      actions={
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
            onClick={() => navigate('/funnel-report')}
          >
            <ChevronLeft size={15} /> Voltar ao relatório
          </button>
          <Button variant="primary" size="sm" onClick={handleSalvar} disabled={salvar.isPending}>
            <Save size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <Card class="!p-4">
        <div class="flex items-start gap-2.5">
          <Info size={15} class="text-accent mt-0.5 shrink-0" />
          <div class="text-xs text-fg-muted leading-relaxed">
            Cada KPI aponta para uma fonte de dado real. Um papel <strong class="text-fg">sem
            configuração aparece como "—" no relatório</strong>, e não como zero — porque zero
            afirma que não houve resultado, e o que existe é ausência de medição.
          </div>
        </div>
      </Card>

      {/* Regras que valem para todos os funis */}
      <Card class="!p-4 space-y-3">
        <h2 class="text-sm font-semibold text-fg">Regras gerais</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Select
              label="Quais leads entram"
              value={rascunho.escopo}
              onChange={(e) => setRascunho((r) => r && ({ ...r, escopo: (e.target as HTMLSelectElement).value as 'todos' | 'pago' }))}
            >
              {Object.entries(ROTULO_ESCOPO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <p class="text-[0.6875rem] text-fg-muted mt-1 leading-relaxed">
              "Somente campanha paga" faz o relatório bater com o Relatório Meta Ads, mas deixa de
              fora os leads orgânicos. Custo por etapa (CPL, CMQL) só é interpretável nesse modo.
            </p>
          </div>
          <div>
            <Select
              label="Como contar cada etapa"
              value={rascunho.contagem}
              onChange={(e) => setRascunho((r) => r && ({ ...r, contagem: (e.target as HTMLSelectElement).value as 'passou' | 'atual' }))}
            >
              {Object.entries(ROTULO_CONTAGEM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <p class="text-[0.6875rem] text-fg-muted mt-1 leading-relaxed">
              Por histórico, um lead que fez reunião e depois foi perdido continua contando na
              reunião. Pela situação atual, ele desaparece dessa etapa — o que subestima o meio do
              funil e infla as taxas de conversão.
            </p>
          </div>
        </div>
      </Card>

      {/* Seleção de funil */}
      <div class="flex gap-1 border-b border-border overflow-x-auto">
        {data.funnels.map((f) => {
          const qtd = Object.keys(rascunho.porFunil[String(f.id)] ?? {}).length
          return (
            <button
              key={f.id}
              type="button"
              class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${funilSel === f.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
              onClick={() => setFunilSel(f.id)}
            >
              {f.name}
              <span class={`ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 ${qtd === 6 ? 'bg-success/15 text-success' : qtd > 0 ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-fg-subtle'}`}>
                {qtd}/6
              </span>
            </button>
          )
        })}
      </div>

      {funil && (
        <>
          <Card class="!p-3">
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div class="min-w-0">
                <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Etapas reais deste funil</div>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  {funil.stages.map((s) => (
                    <code key={s.key} class="bg-surface-3 px-1.5 py-0.5 rounded text-[0.625rem] text-fg-muted font-mono">
                      {s.key}
                    </code>
                  ))}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={aplicarSugestao}>
                <Wand2 size={13} /> Sugerir a partir das etapas
              </Button>
            </div>
          </Card>

          {pendentes.length > 0 && (
            <Card class="!p-3 border-warning/40 bg-warning/5">
              <div class="flex items-start gap-2">
                <AlertTriangle size={14} class="text-warning mt-0.5 shrink-0" />
                <div class="text-xs text-fg-muted leading-relaxed">
                  <strong class="text-fg">{pendentes.length} KPI(s) sem definição neste funil:</strong>{' '}
                  {pendentes.map((p) => p.label.split(' — ')[0]).join(', ')}. Vão aparecer como "—" no
                  relatório.
                </div>
              </div>
            </Card>
          )}

          <div class="space-y-3">
            {data.papeis.map((p) => (
              <EditorPapel
                key={p.key}
                papel={p.key}
                label={p.label}
                def={cfgFunil[p.key]}
                stages={funil.stages}
                catalogo={data}
                onChange={(d) => definir(p.key, d)}
              />
            ))}
          </div>
        </>
      )}
    </Page>
  )
}

/** Um papel do funil: escolha da fonte + os parâmetros daquela fonte. */
function EditorPapel({ papel, label, def, stages, catalogo, onChange }: {
  papel: PapelKey
  label: string
  def: DefKpi | undefined
  stages: { key: string; name: string; position: number }[]
  catalogo: ConfigPayload
  onChange: (d: DefKpi | undefined) => void
}) {
  const fontes = useMemo(
    () => catalogo.fontes.filter((f) => f.papeis.includes(papel)),
    [catalogo.fontes, papel],
  )
  const fonteAtual = def ? catalogo.fontes.find((f) => f.tipo === def.tipo) : undefined

  /** Troca de fonte reinicia os parâmetros com um padrão sensato para o tipo. */
  function trocarTipo(tipo: string) {
    if (!tipo) { onChange(undefined); return }
    switch (tipo) {
      case 'etapa': onChange({ tipo: 'etapa', stageKeys: [] }); break
      case 'qualificacao': onChange({ tipo: 'qualificacao', fieldKeys: [] }); break
      case 'campo': onChange({ tipo: 'campo', key: '', operador: 'preenchido' }); break
      case 'score': onChange({ tipo: 'score', campo: 'aiScore', min: 70 }); break
      case 'score_label': onChange({ tipo: 'score_label', labels: ['hot'] }); break
      case 'tag': onChange({ tipo: 'tag', tagIds: [] }); break
      // Padrões que fazem RA e RR serem números diferentes desde o primeiro save.
      case 'agendamento': onChange({ tipo: 'agendamento', statuses: papel === 'rr' ? ['completed'] : ['scheduled', 'confirmed', 'completed'] }); break
      case 'negociacao': onChange({ tipo: 'negociacao', statuses: ['aceita'] }); break
      case 'outcome': onChange({ tipo: 'outcome', valor: 'won' }); break
      case 'venda_ia': onChange({ tipo: 'venda_ia' }); break
      case 'valor_negociacao': onChange({ tipo: 'valor_negociacao', resultado: 'won' }); break
      case 'valor_venda_ia': onChange({ tipo: 'valor_venda_ia' }); break
      case 'valor_campo': onChange({ tipo: 'valor_campo', key: '' }); break
      case 'nenhum': onChange({ tipo: 'nenhum' }); break
    }
  }

  const params = fonteAtual?.parametros ?? []
  const atualizar = (patch: Record<string, unknown>) => onChange({ ...(def as any), ...patch })

  /** Multi-seleção por chips: mais legível que um <select multiple> apertado. */
  const Chips = ({ opcoes, selecionados, onToggle }: {
    opcoes: { valor: string; rotulo: string }[]
    selecionados: string[]
    onToggle: (v: string) => void
  }) => (
    <div class="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = selecionados.includes(o.valor)
        return (
          <button
            key={o.valor}
            type="button"
            class={`text-[0.6875rem] px-2 py-1 rounded-md border transition-colors ${on ? 'border-accent bg-accent/15 text-accent font-medium' : 'border-border text-fg-muted hover:text-fg'}`}
            onClick={() => onToggle(o.valor)}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )

  return (
    <Card class="!p-4 space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <Workflow size={14} class="text-accent shrink-0" />
          <span class="text-sm font-semibold text-fg">{label}</span>
        </div>
        {!def && (
          <span class="text-[0.625rem] font-medium px-2 py-0.5 rounded-full bg-warning/15 text-warning">
            sem definição
          </span>
        )}
      </div>

      <Select
        label="Fonte do dado"
        value={def?.tipo ?? ''}
        onChange={(e) => trocarTipo((e.target as HTMLSelectElement).value)}
      >
        <option value="">— sem definição —</option>
        {fontes.map((f) => <option key={f.tipo} value={f.tipo}>{f.rotulo}</option>)}
      </Select>
      {fonteAtual && (
        <p class="text-[0.6875rem] text-fg-muted leading-relaxed">{fonteAtual.descricao}</p>
      )}

      {/* Parâmetros da fonte escolhida */}
      {params.includes('stageKeys') && def?.tipo === 'etapa' && (
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1.5">Etapas que contam</label>
          <Chips
            opcoes={stages.map((s) => ({ valor: s.key, rotulo: `${s.name || s.key}` }))}
            selecionados={def.stageKeys}
            onToggle={(v) => atualizar({
              stageKeys: def.stageKeys.includes(v) ? def.stageKeys.filter((k) => k !== v) : [...def.stageKeys, v],
            })}
          />
        </div>
      )}

      {params.includes('fieldKeys') && def?.tipo === 'qualificacao' && (
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1.5">Campos qualificadores</label>
          {catalogo.catalogos.qualificadores.length === 0 ? (
            <p class="text-[0.6875rem] text-fg-subtle italic">
              Nenhum campo marcado como qualificador nos formulários.
            </p>
          ) : (
            <div class="space-y-2">
              {catalogo.catalogos.qualificadores.map((q) => {
                const on = def.fieldKeys.includes(q.key)
                return (
                  <button
                    key={q.key}
                    type="button"
                    class={`w-full text-left rounded-md border p-2 transition-colors ${on ? 'border-accent bg-accent/10' : 'border-border hover:border-fg-subtle'}`}
                    onClick={() => atualizar({
                      fieldKeys: on ? def.fieldKeys.filter((k) => k !== q.key) : [...def.fieldKeys, q.key],
                    })}
                  >
                    <div class="text-xs font-medium text-fg">{q.label}</div>
                    <div class="text-[0.625rem] text-fg-muted mt-0.5">
                      {q.positiveValues.length
                        ? <>Conta como positivo: <strong class="text-fg">{q.positiveValues.join(', ')}</strong></>
                        : 'Sem valores positivos declarados — qualquer resposta preenchida conta'}
                    </div>
                    <div class="text-[0.625rem] text-fg-subtle mt-0.5">{q.forms.join(' · ')}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {params.includes('campoKey') && (def?.tipo === 'campo' || def?.tipo === 'valor_campo') && (
        <Select
          label="Campo do lead"
          value={(def as any).key ?? ''}
          onChange={(e) => atualizar({ key: (e.target as HTMLSelectElement).value })}
        >
          <option value="">— selecione —</option>
          {catalogo.catalogos.customFields
            .filter((c) => def.tipo !== 'valor_campo' || ['number', 'currency'].includes(c.type))
            .map((c) => <option key={c.key} value={c.key}>{c.label} ({c.key})</option>)}
        </Select>
      )}

      {params.includes('operador') && def?.tipo === 'campo' && (
        <Select
          label="Condição"
          value={def.operador}
          onChange={(e) => atualizar({ operador: (e.target as HTMLSelectElement).value })}
        >
          <option value="preenchido">Está preenchido</option>
          <option value="igual">É igual a</option>
          <option value="diferente">É diferente de</option>
        </Select>
      )}

      {params.includes('valores') && def?.tipo === 'campo' && def.operador !== 'preenchido' && (
        <Input
          label="Valores (separados por vírgula)"
          value={(def.valores ?? []).join(', ')}
          onInput={(e) => atualizar({
            valores: (e.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean),
          })}
          placeholder="sim, agora, 60_dias"
        />
      )}

      {params.includes('scoreCampo') && def?.tipo === 'score' && (
        <div class="grid grid-cols-2 gap-3">
          <Select
            label="Qual score"
            value={def.campo}
            onChange={(e) => atualizar({ campo: (e.target as HTMLSelectElement).value })}
          >
            <option value="aiScore">Score de IA (probabilidade de fechar)</option>
            <option value="priorityScore">Score de prioridade</option>
          </Select>
          <Input
            label="Mínimo"
            type="number"
            min={0}
            max={100}
            value={String(def.min)}
            onInput={(e) => atualizar({ min: Number((e.target as HTMLInputElement).value) || 0 })}
          />
        </div>
      )}

      {params.includes('labels') && def?.tipo === 'score_label' && (
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1.5">Classificações que contam</label>
          <Chips
            opcoes={catalogo.catalogos.scoreLabels.map((l) => ({ valor: l, rotulo: l }))}
            selecionados={def.labels}
            onToggle={(v) => atualizar({
              labels: def.labels.includes(v) ? def.labels.filter((k) => k !== v) : [...def.labels, v],
            })}
          />
        </div>
      )}

      {params.includes('tagIds') && def?.tipo === 'tag' && (
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1.5">Tags que contam</label>
          <Chips
            opcoes={catalogo.catalogos.tags.map((t) => ({ valor: String(t.id), rotulo: t.name }))}
            selecionados={def.tagIds.map(String)}
            onToggle={(v) => {
              const n = Number(v)
              atualizar({ tagIds: def.tagIds.includes(n) ? def.tagIds.filter((k) => k !== n) : [...def.tagIds, n] })
            }}
          />
        </div>
      )}

      {params.includes('bookingStatuses') && def?.tipo === 'agendamento' && (
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1.5">Status do compromisso</label>
          <Chips
            opcoes={catalogo.catalogos.bookingStatuses.map((s) => ({ valor: s, rotulo: s }))}
            selecionados={def.statuses}
            onToggle={(v) => atualizar({
              statuses: def.statuses.includes(v) ? def.statuses.filter((k) => k !== v) : [...def.statuses, v],
            })}
          />
          {papel === 'rr' && def.statuses.length === 1 && def.statuses[0] === 'completed' && (
            <p class="text-[0.6875rem] text-warning mt-1.5 leading-relaxed flex items-start gap-1.5">
              <AlertTriangle size={11} class="mt-0.5 shrink-0" />
              Só "completed" é o critério mais rigoroso: exige que a equipe marque o compromisso como
              concluído após a reunião. Se isso não for rotina, o KPI ficará zerado mesmo havendo
              reuniões.
            </p>
          )}
        </div>
      )}

      {(params.includes('negStatuses') || params.includes('negResultado'))
        && (def?.tipo === 'negociacao' || def?.tipo === 'valor_negociacao') && (
        <div class="space-y-2">
          <div>
            <label class="block text-xs font-medium text-fg-muted mb-1.5">Status da proposta</label>
            <Chips
              opcoes={catalogo.catalogos.negotiationStatuses.map((s) => ({ valor: s, rotulo: s }))}
              selecionados={(def as any).statuses ?? []}
              onToggle={(v) => {
                const atuais: string[] = (def as any).statuses ?? []
                atualizar({ statuses: atuais.includes(v) ? atuais.filter((k) => k !== v) : [...atuais, v] })
              }}
            />
          </div>
          <Select
            label="Resultado"
            value={(def as any).resultado ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              atualizar({ resultado: v || undefined })
            }}
          >
            <option value="">Qualquer (usa a data de criação da proposta)</option>
            <option value="won">Ganho (usa a data do fechamento)</option>
            <option value="lost">Perdido (usa a data do fechamento)</option>
          </Select>
        </div>
      )}

      {params.includes('outcomeValor') && def?.tipo === 'outcome' && (
        <Select
          label="Qual desfecho"
          value={def.valor}
          onChange={(e) => atualizar({ valor: (e.target as HTMLSelectElement).value })}
        >
          <option value="won">Ganho</option>
          <option value="lost">Perdido</option>
        </Select>
      )}
    </Card>
  )
}
