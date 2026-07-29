import { useState } from 'preact/hooks'
import { Shuffle, Plus, Trash2, ArrowRight, ArrowLeftRight, Info } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEquivalenciaGrupos, useCriarEquivalenciaGrupo, useRemoverEquivalenciaGrupo } from '@/hooks/useAcaEquivalencia'
import { useMatrizes } from '@/hooks/useAcaCatalogo'
import { toast } from '@/lib/toast'

// Equivalências compostas (N:1 e 1:N). O formulário fica na própria tela —
// sem modal —, alternando entre lista e cadastro.

export function AcademicoEquivalenciasPage() {
  const { data, isLoading } = useEquivalenciaGrupos()
  const matrizes = useMatrizes()
  const criar = useCriarEquivalenciaGrupo()
  const remover = useRemoverEquivalenciaGrupo()
  const [cadastrando, setCadastrando] = useState(false)
  const [f, setF] = useState({ nome: '', observacao: '', bidirecional: false })
  const [origem, setOrigem] = useState<number[]>([])
  const [destino, setDestino] = useState<number[]>([])

  const grupos = data?.grupos ?? []
  // Componentes de todas as matrizes, para escolher os dois lados.
  const componentes = (matrizes.data?.matrizes ?? []).flatMap((m) =>
    (m.componentes ?? []).map((c) => ({
      id: c.id,
      label: `${c.disciplina?.nome ?? `#${c.id}`} — matriz ${m.versao}`,
    })),
  )

  function alternar(lista: number[], setLista: (v: number[]) => void, id: number) {
    setLista(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id])
  }

  function salvar() {
    if (!f.nome.trim()) { toast('Dê um nome à equivalência', 'warning'); return }
    if (origem.length === 0 || destino.length === 0) { toast('Escolha ao menos um componente de cada lado', 'warning'); return }
    criar.mutate(
      // exactOptionalPropertyTypes: observação só entra quando preenchida.
      { nome: f.nome.trim(), origem, destino, bidirecional: f.bidirecional, ...(f.observacao.trim() ? { observacao: f.observacao.trim() } : {}) },
      {
        onSuccess: () => {
          toast('Equivalência criada', 'success')
          setCadastrando(false); setF({ nome: '', observacao: '', bidirecional: false }); setOrigem([]); setDestino([])
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title="Equivalências"
      description="Quando um conjunto de disciplinas cursadas dispensa outro — inclusive N para 1 e 1 para N."
      actions={
        !cadastrando ? (
          <Button variant="primary" size="sm" onClick={() => setCadastrando(true)}>
            <Plus size={14} /> Nova equivalência
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setCadastrando(false)}>Cancelar</Button>
        )
      }
    >
      <Card class="!p-3 bg-surface-2/50">
        <div class="flex items-start gap-2 text-xs text-fg-muted">
          <Info size={14} class="shrink-0 mt-0.5" />
          <span>
            A dispensa só é oferecida quando <strong class="text-fg">todos</strong> os componentes de origem estiverem
            cumpridos — é o que diferencia "Cálculo A + Cálculo B equivalem a Cálculo Único" de dois pares soltos.
          </span>
        </div>
      </Card>

      {cadastrando && (
        <Card class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Nome *" placeholder="Ex.: Cálculo A + B ⇒ Cálculo Único" value={f.nome} onInput={(e) => setF({ ...f, nome: (e.target as HTMLInputElement).value })} />
            <label class="flex items-center gap-2 text-sm text-fg cursor-pointer select-none self-end pb-2">
              <input type="checkbox" checked={f.bidirecional} onChange={(e) => setF({ ...f, bidirecional: (e.target as HTMLInputElement).checked })} />
              Vale nos dois sentidos
            </label>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Lado
              titulo="Cursou (origem)"
              descricao="O que o aluno precisa ter cumprido."
              componentes={componentes}
              selecionados={origem}
              onToggle={(id) => alternar(origem, setOrigem, id)}
            />
            <Lado
              titulo="Dispensa (destino)"
              descricao="O que fica dispensado."
              componentes={componentes}
              selecionados={destino}
              onToggle={(id) => alternar(destino, setDestino, id)}
            />
          </div>

          <Textarea label="Observação" rows={2} value={f.observacao} onInput={(e) => setF({ ...f, observacao: (e.target as HTMLTextAreaElement).value })} />
          <Button variant="primary" onClick={salvar} disabled={criar.isPending}>
            {criar.isPending ? 'Salvando…' : 'Salvar equivalência'}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <Skeleton class="h-40 w-full" />
      ) : grupos.length === 0 ? (
        !cadastrando && <EmptyState title="Nenhuma equivalência composta" description="Cadastre quando um conjunto de disciplinas dispensar outro." />
      ) : (
        <div class="space-y-2">
          {grupos.map((g) => (
            <Card key={g.id} class="!p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Shuffle size={14} class="text-fg-muted shrink-0" />
                    <span class="text-sm font-medium text-fg">{g.nome}</span>
                    <Badge tone="neutral">{g.origem.length}:{g.destino.length}</Badge>
                    {g.bidirecional && <Badge tone="info">bidirecional</Badge>}
                  </div>
                  <div class="mt-2 flex items-center gap-2 flex-wrap text-xs">
                    <span class="text-fg-muted">{g.origem.map((i) => i.nome).join(' + ')}</span>
                    {g.bidirecional ? <ArrowLeftRight size={13} class="text-fg-subtle" /> : <ArrowRight size={13} class="text-fg-subtle" />}
                    <span class="text-fg-muted">{g.destino.map((i) => i.nome).join(' + ')}</span>
                  </div>
                  {g.observacao && <div class="text-[11px] text-fg-subtle mt-1">{g.observacao}</div>}
                </div>
                <button
                  type="button"
                  class="text-fg-subtle hover:text-danger shrink-0"
                  title="Inativar"
                  onClick={() => {
                    if (!confirm(`Inativar "${g.nome}"?`)) return
                    remover.mutate(g.id, {
                      onSuccess: () => toast('Equivalência inativada', 'success'),
                      onError: (e: unknown) => toast((e as Error).message, 'danger'),
                    })
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  )
}

function Lado({
  titulo, descricao, componentes, selecionados, onToggle,
}: {
  titulo: string
  descricao: string
  componentes: Array<{ id: number; label: string }>
  selecionados: number[]
  onToggle: (id: number) => void
}) {
  const [busca, setBusca] = useState('')
  const filtrados = busca
    ? componentes.filter((c) => c.label.toLowerCase().includes(busca.toLowerCase()))
    : componentes
  return (
    <div>
      <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">{titulo}</div>
      <p class="text-[11px] text-fg-subtle mb-2">{descricao}</p>
      <Input placeholder="Filtrar disciplina…" value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
      <div class="mt-2 max-h-52 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {filtrados.length === 0 ? (
          <div class="px-3 py-3 text-xs text-fg-subtle">Nenhum componente encontrado.</div>
        ) : filtrados.map((c) => (
          <label key={c.id} class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-surface-3 cursor-pointer">
            <input type="checkbox" checked={selecionados.includes(c.id)} onChange={() => onToggle(c.id)} />
            <span class="truncate">{c.label}</span>
          </label>
        ))}
      </div>
      {selecionados.length > 0 && (
        <div class="text-[11px] text-fg-subtle mt-1">{selecionados.length} selecionado(s)</div>
      )}
    </div>
  )
}
