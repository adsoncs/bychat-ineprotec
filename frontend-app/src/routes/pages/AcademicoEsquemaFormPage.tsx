import { useState, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Save, Plus, Trash2, FlaskConical, Trash } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useEsquema, useSaveEsquema, useSimularEsquema, useInativarEsquema,
  ESCOPO_LABEL, SITUACAO_SIM_LABEL, SITUACAO_SIM_TONE,
  type EsquemaComponente, type EsquemaEscopo, type ResultadoSimulacao,
} from '@/hooks/useAcaAvaliacao'
import { useAcaRefs, useMatrizes, useDisciplinas } from '@/hooks/useAcaCatalogo'
import { toast } from '@/lib/toast'

// Regimento em tela dedicada, com simulador ao lado: o operador confere a
// regra com notas de exemplo ANTES de ela valer para o aluno (T-801).

const FREQ_MINIMA_LEGAL = 75

export function AcademicoEsquemaFormPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const criando = params.id === 'novo'
  const id = criando ? null : Number(params.id)
  const { data, isLoading } = useEsquema(id)
  const save = useSaveEsquema()
  const inativar = useInativarEsquema()
  const simular = useSimularEsquema()
  const refs = useAcaRefs()
  const matrizes = useMatrizes()
  const disciplinas = useDisciplinas()

  const [f, setF] = useState({
    escopo: 'INSTITUCIONAL' as EsquemaEscopo, escopoId: '', nome: '', descricao: '',
    mediaAprovacao: '7', notaEliminatoria: '', frequenciaMinima: '75',
    formulaMedia: '', exameHabilitado: false, exameMinimo: '3',
    formulaFinal: '(MP + EX)/2', mediaFinalAprovacao: '5',
    casasDecimais: '1', arredondamento: 'MATEMATICO', limiteDependencias: '',
    escala: 'NUMERICA_0_10', segundaChamadaHabilitada: false,
  })
  // Mapa conceito→piso. Editado como lista para o operador poder renomear os
  // conceitos do regimento dele (alguns usam MB/B/R/I em vez de A–E).
  const [conceitos, setConceitos] = useState<Array<{ conceito: string; piso: string }>>([
    { conceito: 'A', piso: '9' }, { conceito: 'B', piso: '7' },
    { conceito: 'C', piso: '6' }, { conceito: 'D', piso: '4' }, { conceito: 'E', piso: '0' },
  ])
  const [componentes, setComponentes] = useState<EsquemaComponente[]>([
    { sigla: 'N1', nome: 'Prova 1', peso: 1 },
    { sigla: 'N2', nome: 'Prova 2', peso: 1 },
  ])
  const [pronto, setPronto] = useState(criando)
  const [notasSim, setNotasSim] = useState<Record<string, string>>({})
  const [freqSim, setFreqSim] = useState('90')
  const [exameSim, setExameSim] = useState('')
  const [resultado, setResultado] = useState<ResultadoSimulacao | null>(null)

  useEffect(() => {
    const e = data?.esquema
    if (criando || pronto || !e) return
    setF({
      escopo: e.escopo, escopoId: e.escopoId ? String(e.escopoId) : '', nome: e.nome, descricao: e.descricao ?? '',
      mediaAprovacao: String(e.mediaAprovacao), notaEliminatoria: e.notaEliminatoria != null ? String(e.notaEliminatoria) : '',
      frequenciaMinima: String(e.frequenciaMinima), formulaMedia: e.formulaMedia ?? '',
      exameHabilitado: e.exameHabilitado, exameMinimo: e.exameMinimo != null ? String(e.exameMinimo) : '',
      formulaFinal: e.formulaFinal ?? '', mediaFinalAprovacao: e.mediaFinalAprovacao != null ? String(e.mediaFinalAprovacao) : '',
      casasDecimais: String(e.casasDecimais), arredondamento: e.arredondamento, limiteDependencias: e.limiteDependencias != null ? String(e.limiteDependencias) : '',
      escala: e.escala ?? 'NUMERICA_0_10', segundaChamadaHabilitada: !!e.segundaChamadaHabilitada,
    })
    const mapa = e.mapaConceitos as Record<string, number> | null | undefined
    if (mapa && Object.keys(mapa).length > 0) {
      setConceitos(Object.entries(mapa)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([conceito, piso]) => ({ conceito, piso: String(piso) })))
    }
    setComponentes(e.componentes.map((c) => ({
      sigla: c.sigla, nome: c.nome, peso: c.peso,
      ...(typeof c.obrigatorio === 'boolean' ? { obrigatorio: c.obrigatorio } : {}),
    })))
    setPronto(true)
  }, [data, criando, pronto])

  function corpo() {
    return {
      escopo: f.escopo,
      escopoId: f.escopo === 'INSTITUCIONAL' ? null : Number(f.escopoId) || null,
      nome: f.nome.trim(), descricao: f.descricao.trim() || null,
      mediaAprovacao: Number(f.mediaAprovacao) || 0,
      notaEliminatoria: f.notaEliminatoria === '' ? null : Number(f.notaEliminatoria),
      frequenciaMinima: Number(f.frequenciaMinima) || FREQ_MINIMA_LEGAL,
      formulaMedia: f.formulaMedia.trim() || null,
      exameHabilitado: f.exameHabilitado,
      exameMinimo: f.exameHabilitado && f.exameMinimo !== '' ? Number(f.exameMinimo) : null,
      formulaFinal: f.exameHabilitado ? (f.formulaFinal.trim() || null) : null,
      mediaFinalAprovacao: f.exameHabilitado && f.mediaFinalAprovacao !== '' ? Number(f.mediaFinalAprovacao) : null,
      casasDecimais: Number(f.casasDecimais) || 1,
      arredondamento: f.arredondamento,
      limiteDependencias: f.limiteDependencias === '' ? null : Number(f.limiteDependencias),
      escala: f.escala,
      segundaChamadaHabilitada: f.segundaChamadaHabilitada,
      // Só envia o mapa quando a escala é conceitual — mandar sempre deixaria
      // lixo num esquema numérico e confundiria quem for lê-lo depois.
      mapaConceitos: f.escala === 'CONCEITO'
        ? Object.fromEntries(conceitos
            .filter((c) => c.conceito.trim() !== '' && c.piso !== '')
            .map((c) => [c.conceito.trim().toUpperCase(), Number(c.piso)]))
        : null,
      componentes: componentes.map((c, i) => ({ ...c, ordem: i })),
    }
  }

  function submeter() {
    if (!f.nome.trim()) { toast('Informe o nome do esquema', 'warning'); return }
    if (f.escopo !== 'INSTITUCIONAL' && !f.escopoId) { toast(`Selecione o ${ESCOPO_LABEL[f.escopo].toLowerCase()}`, 'warning'); return }
    if (componentes.length === 0) { toast('Adicione ao menos um componente de nota', 'warning'); return }
    save.mutate(
      { ...(id ? { id } : {}), ...corpo() } as any,
      {
        onSuccess: () => { toast(criando ? 'Esquema criado' : 'Esquema salvo', 'success'); navigate('/aca/esquemas') },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function rodarSimulacao() {
    if (!id) { toast('Salve o esquema antes de simular', 'warning'); return }
    const notas: Record<string, number | null> = {}
    for (const c of componentes) {
      const v = notasSim[c.sigla]
      notas[c.sigla] = v === undefined || v === '' ? null : Number(v)
    }
    simular.mutate(
      { id, notas, frequencia: Number(freqSim) || 0, ...(exameSim !== '' ? { notaExame: Number(exameSim) } : {}) },
      {
        onSuccess: (r) => setResultado(r.resultado),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  if (!criando && isLoading) return <Skeleton class="h-64 w-full" />

  const opcoesEscopo = f.escopo === 'CURSO'
    ? (refs.data?.courses ?? []).map((c) => ({ id: c.id, label: c.nome }))
    : f.escopo === 'MATRIZ'
      ? (matrizes.data?.matrizes ?? []).map((m) => ({ id: m.id, label: `Matriz ${m.versao}` }))
      : f.escopo === 'DISCIPLINA'
        ? (disciplinas.data?.disciplinas ?? []).map((d) => ({ id: d.id, label: d.nome }))
        : []

  return (
    <Page
      title={criando ? 'Novo esquema de avaliação' : f.nome || 'Esquema de avaliação'}
      description="Componentes de nota, fórmula da média, exame e frequência mínima."
      actions={
        <div class="flex items-center gap-2">
          <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={() => navigate('/aca/esquemas')}>
            <ChevronLeft size={15} /> Voltar
          </button>
          {id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!confirm('Inativar este esquema? As disciplinas voltam a usar o esquema mais geral.')) return
                inativar.mutate(id, {
                  onSuccess: () => { toast('Esquema inativado', 'success'); navigate('/aca/esquemas') },
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })
              }}
            >
              <Trash size={13} /> Inativar
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={submeter} disabled={save.isPending}>
            <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="lg:col-span-2 space-y-3">
          <Card class="space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select label="Aplica-se a" value={f.escopo} onChange={(e) => setF({ ...f, escopo: (e.target as HTMLSelectElement).value as EsquemaEscopo, escopoId: '' })}>
                {(['INSTITUCIONAL', 'CURSO', 'MATRIZ', 'DISCIPLINA'] as EsquemaEscopo[]).map((s) => (
                  <option key={s} value={s}>{ESCOPO_LABEL[s]}</option>
                ))}
              </Select>
              {f.escopo !== 'INSTITUCIONAL' && (
                <Select label={ESCOPO_LABEL[f.escopo]} value={f.escopoId} onChange={(e) => setF({ ...f, escopoId: (e.target as HTMLSelectElement).value })}>
                  <option value="">Selecione…</option>
                  {opcoesEscopo.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              )}
              <div class={f.escopo === 'INSTITUCIONAL' ? 'md:col-span-1' : 'md:col-span-2'}>
                <Input label="Nome *" placeholder="Ex.: Regimento 2026" value={f.nome} onInput={(e) => setF({ ...f, nome: (e.target as HTMLInputElement).value })} />
              </div>
            </div>
            <Textarea label="Descrição" rows={2} value={f.descricao} onInput={(e) => setF({ ...f, descricao: (e.target as HTMLTextAreaElement).value })} />
          </Card>

          {/* Componentes de nota */}
          <Card class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-fg">Componentes de nota</h2>
              <Button size="sm" variant="ghost" onClick={() => setComponentes([...componentes, { sigla: `N${componentes.length + 1}`, nome: `Nota ${componentes.length + 1}`, peso: 1 }])}>
                <Plus size={13} /> Adicionar
              </Button>
            </div>
            <p class="text-[11px] text-fg-subtle">A sigla é o que a fórmula usa. Ex.: N1, N2, TRAB.</p>
            <div class="space-y-2">
              {componentes.map((c, i) => (
                <div key={i} class="grid grid-cols-12 gap-2 items-end">
                  <div class="col-span-3">
                    <Input label={i === 0 ? 'Sigla' : ''} value={c.sigla} onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value.toUpperCase()
                      setComponentes(componentes.map((x, j) => j === i ? { ...x, sigla: v } : x))
                    }} />
                  </div>
                  <div class="col-span-6">
                    <Input label={i === 0 ? 'Nome' : ''} value={c.nome} onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value
                      setComponentes(componentes.map((x, j) => j === i ? { ...x, nome: v } : x))
                    }} />
                  </div>
                  <div class="col-span-2">
                    <Input label={i === 0 ? 'Peso' : ''} inputMode="decimal" value={String(c.peso)} onInput={(e) => {
                      const v = Number((e.target as HTMLInputElement).value) || 0
                      setComponentes(componentes.map((x, j) => j === i ? { ...x, peso: v } : x))
                    }} />
                  </div>
                  <div class="col-span-1 pb-1.5">
                    <button type="button" class="text-fg-subtle hover:text-danger" onClick={() => setComponentes(componentes.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Input
              label="Fórmula da média"
              placeholder="Vazio = média ponderada pelos pesos. Ex.: (N1*4 + N2*6)/10"
              value={f.formulaMedia}
              onInput={(e) => setF({ ...f, formulaMedia: (e.target as HTMLInputElement).value })}
            />
          </Card>

          {/* Regras de aprovação */}
          <Card class="space-y-3">
            <h2 class="text-sm font-semibold text-fg">Aprovação</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Média para aprovar" inputMode="decimal" value={f.mediaAprovacao} onInput={(e) => setF({ ...f, mediaAprovacao: (e.target as HTMLInputElement).value })} />
              <Input label="Nota mínima eliminatória" placeholder="opcional" inputMode="decimal" value={f.notaEliminatoria} onInput={(e) => setF({ ...f, notaEliminatoria: (e.target as HTMLInputElement).value })} />
              <Input
                label={`Frequência mínima (%) — piso legal ${FREQ_MINIMA_LEGAL}`}
                inputMode="numeric"
                value={f.frequenciaMinima}
                onInput={(e) => setF({ ...f, frequenciaMinima: (e.target as HTMLInputElement).value })}
              />
            </div>
            {Number(f.frequenciaMinima) < FREQ_MINIMA_LEGAL && (
              <p class="text-[11px] text-warning">
                O ensino superior exige no mínimo {FREQ_MINIMA_LEGAL}%. Valor menor será elevado ao salvar.
              </p>
            )}

            <label class="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" checked={f.exameHabilitado} onChange={(e) => setF({ ...f, exameHabilitado: (e.target as HTMLInputElement).checked })} />
              Usa exame final / recuperação
            </label>
            {f.exameHabilitado && (
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input label="Vai para exame a partir de" inputMode="decimal" value={f.exameMinimo} onInput={(e) => setF({ ...f, exameMinimo: (e.target as HTMLInputElement).value })} />
                <Input label="Fórmula final (MP e EX)" placeholder="(MP + EX)/2" value={f.formulaFinal} onInput={(e) => setF({ ...f, formulaFinal: (e.target as HTMLInputElement).value })} />
                <Input label="Média final para aprovar" inputMode="decimal" value={f.mediaFinalAprovacao} onInput={(e) => setF({ ...f, mediaFinalAprovacao: (e.target as HTMLInputElement).value })} />
              </div>
            )}

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Casas decimais" inputMode="numeric" value={f.casasDecimais} onInput={(e) => setF({ ...f, casasDecimais: (e.target as HTMLInputElement).value })} />
              <Select label="Arredondamento" value={f.arredondamento} onChange={(e) => setF({ ...f, arredondamento: (e.target as HTMLSelectElement).value })}>
                <option value="MATEMATICO">Matemático (7,45 → 7,5)</option>
                <option value="CIMA">Sempre para cima</option>
                <option value="BAIXO">Sempre para baixo</option>
              </Select>
              <Input
                label="Limite de dependências" placeholder="sem limite" inputMode="numeric"
                hint="Regime seriado: máximo de reprovações que o aluno carrega para o período seguinte."
                value={f.limiteDependencias} onInput={(e) => setF({ ...f, limiteDependencias: (e.target as HTMLInputElement).value })}
              />
            </div>

            <label class="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
              <input type="checkbox" checked={f.segundaChamadaHabilitada} onChange={(e) => setF({ ...f, segundaChamadaHabilitada: (e.target as HTMLInputElement).checked })} />
              Admite segunda chamada
            </label>
            <p class="text-[11px] text-fg-subtle -mt-1">
              Com isto ligado, a nota reposta é lançada marcada como segunda chamada e fica registrada
              como tal. Desligado, o sistema recusa o lançamento — é o que impede uma reposição informal
              virar nota comum no histórico.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select label="Escala das notas" value={f.escala} onChange={(e) => setF({ ...f, escala: (e.target as HTMLSelectElement).value })}>
                <option value="NUMERICA_0_10">Numérica 0 a 10</option>
                <option value="NUMERICA_0_100">Numérica 0 a 100</option>
                <option value="CONCEITO">Conceito (A, B, C…)</option>
              </Select>
            </div>
            {f.escala === 'CONCEITO' && (
              <div class="space-y-2 rounded-lg border border-border p-3">
                <div class="text-sm text-fg-muted">
                  Conceitos e nota mínima de cada um
                  <span class="block text-[11px] text-fg-subtle">
                    O cálculo continua numérico; o conceito é como o resultado aparece. Uma média cai no
                    conceito de maior piso que ela alcança.
                  </span>
                </div>
                {conceitos.map((c, i) => (
                  <div key={i} class="flex items-center gap-2">
                    <div class="w-24">
                      <Input
                        value={c.conceito} placeholder="A"
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value
                          setConceitos((p) => p.map((x, j) => (j === i ? { ...x, conceito: v } : x)))
                        }}
                      />
                    </div>
                    <span class="text-xs text-fg-subtle">a partir de</span>
                    <div class="w-24">
                      <Input
                        value={c.piso} inputMode="decimal"
                        onInput={(e) => {
                          const v = (e.target as HTMLInputElement).value
                          setConceitos((p) => p.map((x, j) => (j === i ? { ...x, piso: v } : x)))
                        }}
                      />
                    </div>
                    {conceitos.length > 2 && (
                      <button class="text-xs text-fg-subtle hover:text-danger px-1" onClick={() => setConceitos((p) => p.filter((_, j) => j !== i))}>
                        remover
                      </button>
                    )}
                  </div>
                ))}
                <button class="text-xs text-accent hover:underline" onClick={() => setConceitos((p) => [...p, { conceito: '', piso: '' }])}>
                  + conceito
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* Simulador */}
        <Card class="lg:col-span-1 space-y-3 h-fit">
          <div class="flex items-center gap-2">
            <FlaskConical size={15} class="text-fg-muted" />
            <h2 class="text-sm font-semibold text-fg">Simulador</h2>
          </div>
          <p class="text-[11px] text-fg-subtle">
            Confira a regra com notas de exemplo antes de ela valer para o aluno.
          </p>
          {!id && <p class="text-xs text-warning">Salve o esquema para habilitar a simulação.</p>}

          <div class="space-y-2">
            {componentes.map((c) => (
              <Input
                key={c.sigla}
                label={`${c.sigla} — ${c.nome}`}
                inputMode="decimal"
                value={notasSim[c.sigla] ?? ''}
                onInput={(e) => setNotasSim({ ...notasSim, [c.sigla]: (e.target as HTMLInputElement).value })}
              />
            ))}
            <Input label="Frequência (%)" inputMode="numeric" value={freqSim} onInput={(e) => setFreqSim((e.target as HTMLInputElement).value)} />
            {f.exameHabilitado && (
              <Input label="Nota do exame (opcional)" inputMode="decimal" value={exameSim} onInput={(e) => setExameSim((e.target as HTMLInputElement).value)} />
            )}
          </div>

          <Button variant="ghost" size="sm" onClick={rodarSimulacao} disabled={!id || simular.isPending}>
            {simular.isPending ? 'Simulando…' : 'Simular'}
          </Button>

          {resultado && (
            <div class="rounded-md border border-border p-3 space-y-1.5">
              <div class="flex items-center gap-2">
                <Badge tone={SITUACAO_SIM_TONE[resultado.situacao] ?? 'neutral'}>
                  {SITUACAO_SIM_LABEL[resultado.situacao] ?? resultado.situacao}
                </Badge>
                {resultado.media != null && <span class="text-sm text-fg tabular-nums">média {resultado.media}</span>}
                {resultado.conceitoFinal && (
                  <Badge tone="info">conceito {resultado.conceitoFinal}</Badge>
                )}
              </div>
              {resultado.mediaFinal != null && resultado.mediaFinal !== resultado.media && (
                <div class="text-xs text-fg-muted">média final: {resultado.mediaFinal}</div>
              )}
              <div class="text-xs text-fg-muted">{resultado.explicacao}</div>
              {(resultado.cabeSegundaChamada?.length ?? 0) > 0 && (
                <div class="text-xs text-warning">
                  Cabe segunda chamada em: {resultado.cabeSegundaChamada!.join(', ')}.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </Page>
  )
}
