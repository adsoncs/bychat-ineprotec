import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, CheckCircle2, XCircle, Copy, Lock, PlayCircle, PauseCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMatrizes, useCatalogoMut, type ComponenteFull } from '@/hooks/useAcaCatalogo'
import { useMatrizValidacao, useAtivarMatriz, useMudarStatusMatriz, useClonarMatriz } from '@/hooks/useAcaFundacao'
import { toast } from '@/lib/toast'

// Detalhe da matriz: valida a estrutura, ativa (travando a edição) e clona
// para nova versão — o caminho legítimo de "alterar" uma matriz em uso.

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  RASCUNHO: 'neutral', ATIVA: 'success', SUSPENSA: 'warning', EXTINTA: 'danger',
}
const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho', ATIVA: 'Ativa', SUSPENSA: 'Suspensa', EXTINTA: 'Extinta',
}

// Tipo do componente decide contra qual balde de CH ele conta na integralização.
const TIPO_LABEL: Record<string, string> = {
  OBRIGATORIA: 'Obrigatória', ELETIVA: 'Eletiva', OPTATIVA: 'Optativa',
  ESTAGIO: 'Estágio', TCC: 'TCC', ATIVIDADE_COMPLEMENTAR: 'Ativ. complementar', EXTENSAO: 'Extensão',
}
const TIPO_TONE: Record<string, 'info' | 'neutral' | 'success' | 'warning'> = {
  OBRIGATORIA: 'info', ELETIVA: 'neutral', OPTATIVA: 'neutral',
  ESTAGIO: 'warning', TCC: 'warning', ATIVIDADE_COMPLEMENTAR: 'success', EXTENSAO: 'success',
}

export function AcademicoMatrizDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading } = useMatrizes()
  const validacao = useMatrizValidacao(id)
  const ativar = useAtivarMatriz()
  const mudarStatus = useMudarStatusMatriz()
  const clonar = useClonarMatriz()
  const [novaVersao, setNovaVersao] = useState('')
  const [clonando, setClonando] = useState(false)

  if (isLoading) return <Skeleton class="h-64 w-full" />
  const matriz = (data?.matrizes ?? []).find((m) => m.id === id)
  if (!matriz) {
    return (
      <Page title="Matriz não encontrada">
        <Card class="text-sm text-fg-subtle text-center py-8">
          A matriz #{id} não existe mais ou foi removida.
        </Card>
      </Page>
    )
  }

  const status = matriz.status ?? 'RASCUNHO'
  const problemas = validacao.data?.problemas ?? []
  const valida = validacao.data?.ok === true

  // Componentes agrupados por fase — é como o coordenador lê a grade.
  const porFase = new Map<number, typeof matriz.componentes>()
  for (const c of matriz.componentes ?? []) {
    porFase.set(c.fase, [...(porFase.get(c.fase) ?? []), c])
  }
  const fases = [...porFase.keys()].sort((a, b) => a - b)

  function ativarMatriz() {
    ativar.mutate(id, {
      onSuccess: () => toast('Matriz ativada — a partir de agora é imutável', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function alterarStatus(novo: 'ATIVA' | 'SUSPENSA' | 'EXTINTA') {
    const aviso = novo === 'EXTINTA'
      ? 'Extinguir a matriz? Ela deixa de receber ingressantes e não volta atrás.'
      : novo === 'SUSPENSA'
        ? 'Suspender a matriz? Ela para de receber ingressantes, mas segue válida para quem já está nela.'
        : 'Reativar a matriz?'
    if (!confirm(aviso)) return
    mudarStatus.mutate({ id, status: novo }, {
      onSuccess: () => toast(`Matriz ${(STATUS_LABEL[novo] ?? novo).toLowerCase()}`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function clonarMatriz() {
    if (!novaVersao.trim()) { toast('Informe a versão da nova matriz (ex.: 2027.1)', 'warning'); return }
    clonar.mutate({ id, versao: novaVersao.trim() }, {
      onSuccess: (r) => {
        toast('Nova versão criada em rascunho', 'success')
        setClonando(false); setNovaVersao('')
        navigate(`/aca/matrizes/${r.matriz.id}`)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title={`Matriz ${matriz.versao}`}
      description={matriz.nome ?? `Curso #${matriz.courseId}`}
      actions={
        <div class="flex items-center gap-2">
          <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={() => navigate('/aca/matrizes')}>
            <ChevronLeft size={15} /> Voltar
          </button>
          <Badge tone={STATUS_TONE[status]!}>{STATUS_LABEL[status]}</Badge>
        </div>
      }
    >
      {/* Validação estrutural: é o que libera (ou barra) a ativação */}
      <Card class={valida ? 'border-success/40 bg-success/5' : problemas.length ? 'border-danger/40 bg-danger/5' : ''}>
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex items-start gap-2 min-w-0">
            {valida
              ? <CheckCircle2 size={17} class="text-success shrink-0 mt-0.5" />
              : <XCircle size={17} class="text-danger shrink-0 mt-0.5" />}
            <div class="min-w-0">
              <div class="text-sm font-semibold text-fg">
                {validacao.isLoading ? 'Validando estrutura…' : valida ? 'Estrutura válida' : `${problemas.length} problema(s) na estrutura`}
              </div>
              <div class="text-xs text-fg-muted mt-0.5">
                Confere ciclos de pré-requisito e a carga horária declarada no PPC.
              </div>
              {problemas.length > 0 && (
                <ul class="mt-2 space-y-1">
                  {problemas.map((p, i) => (
                    <li key={i} class="text-xs text-fg-muted">
                      <span class="text-[0.625rem] uppercase tracking-wider text-danger mr-1.5">{p.tipo.replace(/_/g, ' ')}</span>
                      {p.mensagem}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div class="flex gap-2 shrink-0">
            {status === 'RASCUNHO' && (
              <Button variant="primary" size="sm" onClick={ativarMatriz} disabled={!valida || ativar.isPending}>
                <PlayCircle size={14} /> {ativar.isPending ? 'Ativando…' : 'Ativar matriz'}
              </Button>
            )}
            {status === 'ATIVA' && (
              <Button variant="ghost" size="sm" onClick={() => alterarStatus('SUSPENSA')}>
                <PauseCircle size={14} /> Suspender
              </Button>
            )}
            {status === 'SUSPENSA' && (
              <Button variant="ghost" size="sm" onClick={() => alterarStatus('ATIVA')}>
                <PlayCircle size={14} /> Reativar
              </Button>
            )}
            {status !== 'EXTINTA' && status !== 'RASCUNHO' && (
              <Button variant="ghost" size="sm" onClick={() => alterarStatus('EXTINTA')}>Extinguir</Button>
            )}
          </div>
        </div>
      </Card>

      {status !== 'RASCUNHO' && (
        <Card class="!p-3">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-start gap-2 text-sm text-fg-muted">
              <Lock size={15} class="shrink-0 mt-0.5" />
              <span>
                Matriz {(STATUS_LABEL[status] ?? status).toLowerCase()}: os componentes não podem mais ser editados.
                Para alterar a grade, crie uma nova versão.
              </span>
            </div>
            {!clonando ? (
              <Button variant="ghost" size="sm" onClick={() => setClonando(true)}>
                <Copy size={14} /> Criar nova versão
              </Button>
            ) : (
              <div class="flex items-end gap-2">
                <div class="w-36">
                  <Input
                    label="Nova versão"
                    placeholder="2027.1"
                    value={novaVersao}
                    onInput={(e) => setNovaVersao((e.target as HTMLInputElement).value)}
                  />
                </div>
                <Button variant="primary" size="sm" onClick={clonarMatriz} disabled={clonar.isPending}>
                  {clonar.isPending ? 'Clonando…' : 'Clonar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setClonando(false)}>Cancelar</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Grade por fase */}
      <div class="space-y-3">
        {fases.length === 0 ? (
          <Card class="text-sm text-fg-subtle text-center py-8">Nenhum componente nesta matriz.</Card>
        ) : fases.map((fase) => {
          const comps = porFase.get(fase) ?? []
          const ch = comps.reduce((s, c) => s + (c.disciplina?.cargaHoraria ?? 0), 0)
          return (
            <Card key={fase} class="!p-0 overflow-hidden">
              <div class="px-4 py-2 bg-surface-2/50 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-fg">{fase}º período</h2>
                <span class="text-[11px] text-fg-subtle">{comps.length} componentes · {ch}h</span>
              </div>
              <ul class="divide-y divide-border">
                {comps.map((c) => (
                  <li key={c.id} class="px-4 py-2">
                    <div class="flex items-center justify-between gap-3 text-sm">
                      <span class="text-fg truncate">
                        {c.disciplina?.codigo ? <span class="text-fg-subtle font-mono text-xs mr-2">{c.disciplina.codigo}</span> : null}
                        {c.disciplina?.nome ?? `Componente #${c.id}`}
                      </span>
                      <span class="flex items-center gap-2 shrink-0">
                        <Badge tone={TIPO_TONE[c.tipo ?? (c.obrigatoria ? 'OBRIGATORIA' : 'ELETIVA')] ?? 'neutral'}>
                          {TIPO_LABEL[c.tipo ?? (c.obrigatoria ? 'OBRIGATORIA' : 'ELETIVA')] ?? c.tipo}
                        </Badge>
                        {c.grupoEletiva && <span class="text-[11px] text-fg-subtle">grupo {c.grupoEletiva}</span>}
                        <span class="text-xs text-fg-muted tabular-nums">{c.chTotal ?? c.disciplina?.cargaHoraria ?? 0}h</span>
                      </span>
                    </div>
                    {/* Edição só existe em RASCUNHO — depois disso a matriz é imutável. */}
                    {status === 'RASCUNHO' && <EditorComponente matrizId={id} comp={c} />}
                  </li>
                ))}
              </ul>
            </Card>
          )
        })}
      </div>
    </Page>
  )
}


/**
 * Edição do componente enquanto a matriz é rascunho: tipo, carga horária
 * própria e grupo de eletivas — os campos que o motor de integralização usa
 * para saber contra qual exigência do PPC cada disciplina conta.
 */
function EditorComponente({ matrizId, comp }: { matrizId: number; comp: ComponenteFull }) {
  const [aberto, setAberto] = useState(false)
  const { updateComponente } = useCatalogoMut()
  const [f, setF] = useState({
    tipo: comp.tipo ?? (comp.obrigatoria ? 'OBRIGATORIA' : 'ELETIVA'),
    fase: String(comp.fase ?? 1),
    chTotal: comp.chTotal != null ? String(comp.chTotal) : '',
    chExtensao: comp.chExtensao != null ? String(comp.chExtensao) : '',
    grupoEletiva: comp.grupoEletiva ?? '',
  })

  function salvar() {
    updateComponente.mutate(
      {
        matrizId, compId: comp.id,
        tipo: f.tipo,
        fase: Number(f.fase) || 1,
        chTotal: f.chTotal === '' ? null : Number(f.chTotal),
        chExtensao: f.chExtensao === '' ? null : Number(f.chExtensao),
        grupoEletiva: f.grupoEletiva.trim() || null,
        obrigatoria: f.tipo === 'OBRIGATORIA',
      },
      {
        onSuccess: () => { toast('Componente atualizado', 'success'); setAberto(false) },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  if (!aberto) {
    return (
      <button type="button" class="text-[11px] text-accent hover:underline mt-1" onClick={() => setAberto(true)}>
        Editar classificação
      </button>
    )
  }

  return (
    <div class="mt-2 grid grid-cols-2 md:grid-cols-6 gap-2 items-end bg-surface-2/40 rounded-md p-2">
      <div class="col-span-2">
        <Select label="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: (e.target as HTMLSelectElement).value })}>
          {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <Input label="Período" inputMode="numeric" value={f.fase} onInput={(e) => setF({ ...f, fase: (e.target as HTMLInputElement).value })} />
      <Input label="CH total" placeholder="catálogo" inputMode="numeric" value={f.chTotal} onInput={(e) => setF({ ...f, chTotal: (e.target as HTMLInputElement).value })} />
      <Input label="CH extensão" inputMode="numeric" value={f.chExtensao} onInput={(e) => setF({ ...f, chExtensao: (e.target as HTMLInputElement).value })} />
      <Input label="Grupo eletiva" value={f.grupoEletiva} onInput={(e) => setF({ ...f, grupoEletiva: (e.target as HTMLInputElement).value })} />
      <div class="col-span-2 md:col-span-6 flex gap-2">
        <Button size="sm" variant="primary" onClick={salvar} disabled={updateComponente.isPending}>
          {updateComponente.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
      </div>
    </div>
  )
}
