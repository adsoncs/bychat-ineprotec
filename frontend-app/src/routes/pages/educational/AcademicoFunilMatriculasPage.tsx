import { useMemo, useState } from 'preact/hooks'
import { ClipboardList, GraduationCap, AlertTriangle, Check } from '@/components/ui/icon-set'
import {
  useFunilMatriculas,
  useEfetivarEmLote,
  useConversaoMatriculas,
  type EtapaFunil,
  type ItemFunil,
  type LinhaConversao,
} from '@/hooks/useAcaFunilMatriculas'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/** Tom de cada etapa: o que espera ação da secretaria puxa a atenção. */
const TOM: Record<EtapaFunil, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  inscrito: 'info',
  documentos: 'warning',
  contrato: 'warning',
  pagamento: 'warning',
  matriculado: 'success',
  cancelado: 'neutral',
}

type Aba = 'fila' | 'conversao'

export function AcademicoFunilMatriculasPage() {
  const [aba, setAba] = useState<Aba>('fila')
  const [etapa, setEtapa] = useState<EtapaFunil | ''>('')
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState<number[]>([])

  const { data, isLoading, isError, refetch } = useFunilMatriculas({ etapa, busca, limite: 300 })
  const efetivar = useEfetivarEmLote()

  const itens = data?.itens ?? []
  const etapas = data?.etapas ?? []
  // Os totais por etapa vêm do conjunto inteiro; a lista é que vem filtrada.
  // Usar itens.length aqui faria "Todas" mostrar o tamanho do filtro atual.
  const totalGeral = etapas.reduce((s, e) => s + e.total, 0)

  // Só faz sentido efetivar quem ainda não virou aluno.
  const efetivaveis = useMemo(
    () => itens.filter((i) => !i.matriculaId && i.etapa !== 'cancelado').map((i) => i.registrationId),
    [itens],
  )
  const selecionaveis = selecionadas.filter((id) => efetivaveis.includes(id))

  function alternar(id: number) {
    setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function efetivarSelecionadas() {
    if (!selecionaveis.length) return
    try {
      const r = await efetivar.mutateAsync(selecionaveis)
      setSelecionadas([])
      if (r.falhas.length === 0) {
        toast(
          r.efetivadas === 1 ? '1 matrícula efetivada.' : `${r.efetivadas} matrículas efetivadas.`,
          'success',
        )
      } else {
        // O motivo de cada recusa importa: é ele que diz o que a secretaria
        // precisa arrumar (turma fechada, curso não escolhido, menor sem responsável).
        toast(
          `${r.efetivadas === 1 ? '1 efetivada' : `${r.efetivadas} efetivadas`}, `
          + `${r.falhas.length} não: ${r.falhas.map((f) => f.erro).slice(0, 2).join(' · ')}`,
          'warning',
          8000,
        )
      }
    } catch (e) {
      toast((e as Error).message || 'Não foi possível efetivar.', 'danger')
    }
  }

  return (
    <Page
      title="Funil de matrículas"
      description="Onde cada inscrição parou e o que falta para virar matrícula."
      actions={
        selecionaveis.length > 0 ? (
          <Button onClick={efetivarSelecionadas} disabled={efetivar.isPending}>
            {efetivar.isPending
              ? 'Efetivando…'
              : selecionaveis.length === 1 ? 'Efetivar 1 matrícula' : `Efetivar ${selecionaveis.length} matrículas`}
          </Button>
        ) : undefined
      }
    >
      <div class="flex gap-2">
        {(['fila', 'conversao'] as Aba[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            class={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              aba === a ? 'bg-accent text-fg-on-brand' : 'bg-surface-2 text-fg-muted hover:bg-surface-3',
            )}
          >
            {a === 'fila' ? 'Fila' : 'Conversão'}
          </button>
        ))}
      </div>

      {aba === 'conversao' && <Conversao />}

      {aba === 'fila' && <>
      {/* Etapas como filtro: clicar troca a lista, e o total já diz onde está a fila. */}
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEtapa('')}
          class={cn(
            'rounded-lg border px-3 py-2 text-sm transition-colors',
            etapa === '' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface-2 hover:bg-surface-3',
          )}
        >
          Todas <span class="tabular-nums opacity-70">{totalGeral}</span>
        </button>
        {etapas.map((e) => (
          <button
            key={e.chave}
            type="button"
            onClick={() => setEtapa(etapa === e.chave ? '' : e.chave)}
            class={cn(
              'rounded-lg border px-3 py-2 text-sm transition-colors',
              etapa === e.chave ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface-2 hover:bg-surface-3',
            )}
          >
            {e.rotulo} <span class="tabular-nums opacity-70">{e.total}</span>
          </button>
        ))}
      </div>

      <Card>
        <div class="mb-3">
          <SearchInput
            value={busca}
            onChange={(v: string) => setBusca(v)}
            placeholder="Buscar por nome ou código da inscrição"
          />
        </div>

        {isLoading && <div class="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} class="h-14" />)}</div>}

        {isError && (
          <EmptyState
            icon={<AlertTriangle class="h-6 w-6" />}
            title="Não foi possível carregar o funil"
            description="Verifique sua conexão e tente de novo."
            action={<Button variant="secondary" onClick={() => refetch()}>Tentar de novo</Button>}
          />
        )}

        {!isLoading && !isError && itens.length === 0 && (
          <EmptyState
            icon={<ClipboardList class="h-6 w-6" />}
            title="Nenhuma inscrição nesta etapa"
            description="Assim que alguém se inscrever pelo portal, aparece aqui."
          />
        )}

        {!isLoading && itens.length > 0 && (
          <div class="divide-y divide-border">
            {itens.map((i) => (
              <LinhaDoFunil
                key={i.registrationId}
                item={i}
                selecionada={selecionadas.includes(i.registrationId)}
                podeEfetivar={efetivaveis.includes(i.registrationId)}
                onSelecionar={() => alternar(i.registrationId)}
              />
            ))}
          </div>
        )}
      </Card>
      </>}
    </Page>
  )
}

/** De cada 100 inscrições, quantas viram matrícula — e onde vale investir. */
function Conversao() {
  const { data, isLoading } = useConversaoMatriculas()
  if (isLoading) return <Card><Skeleton class="h-40" /></Card>
  if (!data) return null

  return (
    <>
      <Card>
        <div class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div class="text-2xl font-semibold tabular-nums">{data.conversaoGeral}%</div>
            <div class="text-sm text-fg-muted">
              {data.matriculadas} de {data.total} inscrições viraram matrícula
            </div>
          </div>
          {!data.amostraSuficiente && (
            <Badge tone="warning">amostra menor que {data.minimoParaPercentual} — a porcentagem ainda não conclui</Badge>
          )}
        </div>
      </Card>

      <TabelaConversao titulo="Por curso" linhas={data.porCurso} minimo={data.minimoParaPercentual} />
      <TabelaConversao titulo="Por forma de ingresso" linhas={data.porFormaDeIngresso} minimo={data.minimoParaPercentual} />
      <TabelaConversao titulo="Por origem do anúncio" linhas={data.porOrigem} minimo={data.minimoParaPercentual} />
    </>
  )
}

function TabelaConversao(props: { titulo: string; linhas: LinhaConversao[]; minimo: number }) {
  if (!props.linhas.length) return null
  return (
    <Card>
      <h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">{props.titulo}</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
              <th class="pb-2 pr-3 font-medium">Item</th>
              <th class="pb-2 pr-3 text-right font-medium">Inscrições</th>
              <th class="pb-2 pr-3 text-right font-medium">Pagas</th>
              <th class="pb-2 pr-3 text-right font-medium">Matrículas</th>
              <th class="pb-2 text-right font-medium">Conversão</th>
            </tr>
          </thead>
          <tbody>
            {props.linhas.map((l) => (
              <tr key={l.chave} class="border-b border-border last:border-0">
                <td class="py-2 pr-3">{l.rotulo}</td>
                <td class="py-2 pr-3 text-right tabular-nums">{l.inscricoes}</td>
                <td class="py-2 pr-3 text-right tabular-nums">{l.pagas}</td>
                <td class="py-2 pr-3 text-right tabular-nums">{l.matriculadas}</td>
                <td class="py-2 text-right tabular-nums">
                  {/* Sem amostra, a porcentagem engana mais do que informa. */}
                  {l.amostraSuficiente
                    ? `${l.conversao}%`
                    : <span class="text-fg-subtle" title={`Menos de ${props.minimo} inscrições`}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function LinhaDoFunil(props: {
  item: ItemFunil
  selecionada: boolean
  podeEfetivar: boolean
  onSelecionar: () => void
}) {
  const { item } = props
  return (
    <div class="flex items-start gap-3 py-3">
      <input
        type="checkbox"
        class="mt-1 h-4 w-4 accent-[var(--accent)] disabled:opacity-30"
        checked={props.selecionada}
        disabled={!props.podeEfetivar}
        onChange={props.onSelecionar}
        aria-label={`Selecionar ${item.candidato}`}
        title={props.podeEfetivar ? 'Selecionar para efetivar' : 'Já tem matrícula no sistema'}
      />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{item.candidato}</span>
          <Badge tone={TOM[item.etapa]}>{item.etapa}</Badge>
          {/* Ter matrícula criada não é estar matriculado: o registro pode
              existir em INSCRITO, esperando contrato. Dizer "matriculado" aqui
              contradizia a própria etapa da linha. */}
          {item.matriculaId && item.etapa !== 'matriculado' && (
            <Badge tone="neutral" title={`Matrícula #${item.matriculaId} já criada no sistema`}>
              <GraduationCap class="mr-1 inline h-3 w-3" />já é aluno
            </Badge>
          )}
        </div>
        <div class="mt-0.5 text-sm text-fg-muted">{item.motivo}</div>
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span class="font-mono">{item.codigo}</span>
          {item.oferta && <span>{item.oferta}</span>}
          {item.whatsapp && <span>{item.whatsapp}</span>}
          <span>parada há {item.diasParado}d · criada {formatRelative(item.criadaEm)}</span>
        </div>
      </div>

      {item.etapa === 'matriculado' && <Check class="mt-1 h-4 w-4 shrink-0 text-success" />}
    </div>
  )
}
