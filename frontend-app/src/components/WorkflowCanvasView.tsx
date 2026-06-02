import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Panel,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type OnConnect,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { LayoutGrid, Download, Upload, AlertTriangle, Search, X as XIcon, Activity, Users, Save, Trash2 } from 'lucide-preact'
import {
  type WorkflowStep,
  useWorkflowExecutionStats,
  useSaveWorkflowCanvas,
  type CanvasSaveStep,
} from '@/hooks/useWorkflows'
import { WorkflowStepEditPanel } from '@/components/WorkflowStepEditPanel'
import { layoutWorkflowGraph } from '@/lib/workflowLayout'
import { toast } from '@/lib/toast'

/**
 * Canvas de fluxo — read-only por padrão, editable via prop.
 *
 * No modo editable:
 *  - Arrastar nodes persiste positionX/Y (debounced no onNodeDragStop).
 *  - Conectar handles persiste nextStepId (handle "next") ou altStepId (handle "alt").
 *  - Paleta lateral à esquerda permite drag-to-create de novos passos.
 *  - Tecla Delete remove node selecionado (cascata: deleta step + edges automaticamente).
 *  - Tecla Delete em edge selecionada zera nextStepId/altStepId no step de origem.
 *  - Snap-to-grid de 16px.
 *
 * É reutilizado pela POC standalone (rota /workflows/:id/canvas-poc, read-only)
 * e pelo modo Canvas dentro do `WorkflowStepsEditor` (modal de edição).
 */

const STEP_TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  trigger:   { label: 'Gatilho',     color: '#1a73e8', icon: '⚡' },
  wait:      { label: 'Esperar',     color: '#f9ab00', icon: '⏳' },
  condition: { label: 'Condição',    color: '#8e24aa', icon: '🔀' },
  action:    { label: 'Ação',        color: '#2e7d32', icon: '▶' },
  branch:    { label: 'Ramificação', color: '#e37400', icon: '🌿' },
  goal:      { label: 'Meta',        color: '#ea4335', icon: '🎯' },
}

const COLUMN_WIDTH = 280
const ROW_HEIGHT = 110

function defaultConfig(type: string): Record<string, unknown> {
  if (type === 'wait') return { duration: 30, unit: 'minutes' }
  if (type === 'action') return { actionType: 'send_whatsapp', message: '' }
  if (type === 'condition') return { type: 'field', field: 'lead.status', operator: 'equals', value: '' }
  return {}
}

/**
 * S5.3 — Detecta problemas estruturais por step. Retorna issues como conjunto.
 *  - 'no-output': step não-goal sem nextStepId → fluxo morre aqui
 *  - 'orphan': step não-trigger sem ninguém apontando pra ele → nunca executado
 *  - 'incomplete-branch': condition/branch sem altStepId → ramificação incompleta
 */
type StepIssue = 'no-output' | 'orphan' | 'incomplete-branch'

function detectIssues(steps: WorkflowStep[]): Map<number, StepIssue[]> {
  const issues = new Map<number, StepIssue[]>()
  const incomingCount = new Map<number, number>()
  for (const s of steps) {
    if (s.nextStepId) incomingCount.set(s.nextStepId, (incomingCount.get(s.nextStepId) ?? 0) + 1)
    if (s.altStepId) incomingCount.set(s.altStepId, (incomingCount.get(s.altStepId) ?? 0) + 1)
  }
  for (const s of steps) {
    const list: StepIssue[] = []
    if (s.type !== 'goal' && !s.nextStepId) list.push('no-output')
    if (s.type !== 'trigger' && (incomingCount.get(s.id) ?? 0) === 0) list.push('orphan')
    if ((s.type === 'condition' || s.type === 'branch') && !s.altStepId) list.push('incomplete-branch')
    if (list.length > 0) issues.set(s.id, list)
  }
  return issues
}

const ISSUE_LABELS: Record<StepIssue, string> = {
  'no-output': 'Sem saída — o fluxo termina aqui',
  'orphan': 'Sem entrada — nunca será executado',
  'incomplete-branch': 'Ramificação incompleta — falta caminho "senão"',
}

// Tipo de node renderizado: meta + nome + handles condicionais por tipo.
function StepNode({ id, data, selected }: NodeProps) {
  const type = data.type as string
  const meta = STEP_TYPE_META[type] ?? { label: type, color: '#5f6368', icon: '?' }
  const hasInput = type !== 'trigger'
  const hasNextOutput = type !== 'goal'
  const hasAltOutput = type === 'condition' || type === 'branch'

  const issues = (data.issues as StepIssue[] | undefined) ?? []
  const hasError = issues.includes('no-output')
  const hasWarning = issues.includes('orphan') || issues.includes('incomplete-branch')
  const issueColor = hasError ? '#dc2626' : hasWarning ? '#d97706' : null

  const matched = data.matched as boolean | undefined
  const dimmed = data.dimmed as boolean | undefined
  const leadsHere = (data.leadsHere as number | undefined) ?? 0
  const totalPassed = (data.totalPassed as number | undefined) ?? 0
  const executionMode = data.executionMode as boolean | undefined
  const heatmapIntensity = (data.heatmapIntensity as number | undefined) ?? 0
  const isNew = (data.isNew as boolean | undefined) ?? false
  const isDirty = (data.isDirty as boolean | undefined) ?? false
  const onRequestDelete = data.onRequestDelete as ((stepId: number) => void) | undefined
  const editable = (data.editable as boolean | undefined) ?? false

  // Heatmap: opacidade do background baseado em quão usado é o step (0..1)
  const heatBg = executionMode && heatmapIntensity > 0
    ? `linear-gradient(135deg, ${meta.color}${Math.round(8 + heatmapIntensity * 30).toString(16).padStart(2, '0')} 0%, transparent 100%)`
    : undefined

  return (
    <div
      class="group rounded-md border bg-surface px-3 py-2.5 shadow-sm min-w-[220px] transition-shadow relative"
      style={{
        borderLeft: `4px solid ${meta.color}`,
        background: heatBg,
        boxShadow: selected
          ? `0 0 0 2px ${meta.color}55`
          : matched
            ? `0 0 0 2px #1a73e8aa`
            : leadsHere > 0
              ? `0 0 0 2px #f59e0baa`
              : issueColor
                ? `0 0 0 1px ${issueColor}66`
                : undefined,
        outline: issueColor && !selected && !matched && leadsHere === 0 ? `1px dashed ${issueColor}` : undefined,
        outlineOffset: '-3px',
        opacity: dimmed ? 0.35 : 1,
      }}
    >
      {executionMode && leadsHere > 0 && (
        <span
          class="absolute -top-2 -right-2 inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[0.625rem] font-semibold shadow-md"
          style={{ background: '#f59e0b', color: '#fff' }}
          title={`${leadsHere} lead${leadsHere === 1 ? '' : 's'} parado${leadsHere === 1 ? '' : 's'} aqui agora`}
        >
          <Users size={9} /> {leadsHere}
        </span>
      )}
      {editable && onRequestDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRequestDelete(Number(id)) }}
          class="absolute -top-2 -left-2 size-5 grid place-items-center rounded-full bg-danger text-white shadow-md opacity-0 group-hover:opacity-100 hover:bg-danger/90 transition-opacity z-10"
          title="Remover passo (do buffer — clique em Salvar pra confirmar)"
          aria-label="Remover passo"
        >
          <Trash2 size={10} />
        </button>
      )}
      {(isNew || isDirty) && !executionMode && (
        <span
          class="absolute -top-1.5 -right-1.5 inline-flex items-center px-1 h-4 rounded text-[0.5625rem] font-bold shadow-sm"
          style={{ background: isNew ? '#0ea5e9' : '#f59e0b', color: '#fff' }}
          title={isNew ? 'Novo passo (não salvo)' : 'Modificado'}
        >
          {isNew ? 'NOVO' : '•'}
        </span>
      )}
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          style={{ background: '#5f6368', width: 8, height: 8 }}
        />
      )}
      <div class="flex items-center gap-2 mb-1">
        <span class="text-base">{meta.icon}</span>
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.6875rem] font-medium"
          style={{ background: `${meta.color}15`, color: meta.color }}
        >
          {meta.label}
        </span>
        {issueColor && (
          <span
            class="ml-auto inline-flex items-center"
            title={issues.map((i) => ISSUE_LABELS[i]).join(' · ')}
            style={{ color: issueColor }}
          >
            <AlertTriangle size={11} />
          </span>
        )}
      </div>
      <div class="text-sm font-medium text-fg break-words">{String(data.name)}</div>

      {executionMode && totalPassed > 0 && (
        <div class="text-[0.6875rem] text-fg-muted mt-1 tabular-nums flex items-center gap-1">
          <span class="text-fg-subtle">↗</span>
          <span>{totalPassed.toLocaleString('pt-BR')}</span>
          <span class="text-fg-subtle">passaram aqui</span>
        </div>
      )}

      {hasNextOutput && (
        <Handle
          type="source"
          position={Position.Right}
          id="next"
          style={{
            background: '#5f6368',
            width: 8,
            height: 8,
            top: hasAltOutput ? '38%' : '50%',
          }}
        />
      )}
      {hasAltOutput && (
        <Handle
          type="source"
          position={Position.Right}
          id="alt"
          style={{ background: '#e37400', width: 8, height: 8, top: '68%' }}
        />
      )}
    </div>
  )
}

const nodeTypes = { step: StepNode }

/**
 * Builder Visual (Fase 26): além dos `steps` reais (vindos do server), recebe
 * `dirtySet` (IDs positivos modificados localmente) pra mostrar badge "•".
 * Steps com id < 0 são "novos" (criados no buffer local — ainda não persistidos).
 */
function buildGraph(
  steps: WorkflowStep[],
  options: {
    dirtyIds?: Set<number>
    onRequestDelete?: (stepId: number) => void
    editable?: boolean
  } = {},
): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...steps].sort((a, b) => a.position - b.position)
  const issues = detectIssues(steps)
  const nodes: Node[] = sorted.map((s, idx) => {
    const hasCustomPosition = (s.positionX ?? 0) > 0 || (s.positionY ?? 0) > 0
    return {
      id: String(s.id),
      type: 'step',
      position: hasCustomPosition
        ? { x: Number(s.positionX ?? 0), y: Number(s.positionY ?? 0) }
        : { x: 0, y: idx * ROW_HEIGHT },
      data: {
        name: s.name,
        type: s.type,
        raw: s,
        issues: issues.get(s.id) ?? [],
        isNew: s.id < 0,
        isDirty: s.id > 0 && (options.dirtyIds?.has(s.id) ?? false),
        editable: options.editable ?? false,
        onRequestDelete: options.onRequestDelete,
      },
    }
  })

  const edges: Edge[] = []
  for (const s of sorted) {
    if (s.nextStepId) {
      edges.push({
        id: `e-next-${s.id}`,
        source: String(s.id),
        target: String(s.nextStepId),
        sourceHandle: 'next',
        targetHandle: 'in',
        label: 'próximo',
        labelStyle: { fontSize: 11, fill: '#5f6368' },
        style: { stroke: '#5f6368', strokeWidth: 1.5 },
      })
    }
    if (s.altStepId) {
      edges.push({
        id: `e-alt-${s.id}`,
        source: String(s.id),
        target: String(s.altStepId),
        sourceHandle: 'alt',
        targetHandle: 'in',
        label: 'senão',
        labelStyle: { fontSize: 11, fill: '#e37400' },
        style: { stroke: '#e37400', strokeDasharray: '4 3', strokeWidth: 1.5 },
      })
    }
  }

  // Auto-layout: targets com 2+ entradas vão pra coluna direita (evita overlap)
  // só aplicado quando nenhum node tem posição custom
  const hasAnyCustom = nodes.some((n) => n.position.x !== 0 || (n.position.y !== 0 && n.position.y % ROW_HEIGHT !== 0))
  if (!hasAnyCustom) {
    const incoming = new Map<string, number>()
    for (const e of edges) {
      incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
    }
    for (const n of nodes) {
      if ((incoming.get(n.id) ?? 0) >= 2) {
        n.position.x = COLUMN_WIDTH
      }
    }
  }

  return { nodes, edges }
}

interface Props {
  steps: WorkflowStep[]
  workflowId?: number
  editable?: boolean
  height?: string
  showMiniMap?: boolean
  showLegend?: boolean
}

/**
 * Wrapper externo que provê o ReactFlowProvider — necessário pra usar
 * useReactFlow() no componente interno (paleta drag-to-create depende disso).
 */
export function WorkflowCanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({
  steps: serverSteps,
  workflowId,
  editable = false,
  height = '500px',
  showMiniMap = true,
  showLegend = true,
}: Props) {
  // ─── Buffer local (Fase 26) ──────────────────────────────────────────
  // O canvas trabalha sobre `localSteps` em vez de chamar mutations a cada
  // ação. `deletedIds` rastreia steps existentes (id positivo) marcados pra
  // remoção. `dirtyIds` marca os existentes alterados. Ao clicar Salvar,
  // tudo vai num único POST /canvas-save (transação no backend).
  const [localSteps, setLocalSteps] = useState<WorkflowStep[]>(serverSteps)
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
  const tempIdRef = useRef(-1)
  function nextTempId() { return tempIdRef.current-- }

  // Snapshot do server pra comparar e detectar dirty em existentes.
  const serverSnapshotRef = useRef<Map<number, WorkflowStep>>(new Map())

  // Reset local sempre que o server retorna novos dados (após save ou fetch).
  useEffect(() => {
    setLocalSteps(serverSteps)
    setDeletedIds(new Set())
    setDirtyIds(new Set())
    tempIdRef.current = -1
    serverSnapshotRef.current = new Map(serverSteps.map((s) => [s.id, s]))
  }, [serverSteps])

  const isDirty =
    deletedIds.size > 0 ||
    dirtyIds.size > 0 ||
    localSteps.some((s) => s.id < 0)

  const pendingChangesCount = deletedIds.size + dirtyIds.size + localSteps.filter((s) => s.id < 0).length

  // Helper: marca um step existente como dirty (pra mostrar badge "•").
  function markDirty(stepId: number) {
    if (stepId < 0) return // novos já são "NOVO" — não precisa marcar
    setDirtyIds((prev) => {
      if (prev.has(stepId)) return prev
      const next = new Set(prev)
      next.add(stepId)
      return next
    })
  }

  /** Atualiza um step no buffer local (positivo = existente, negativo = novo). */
  function patchLocalStep(stepId: number, patch: Partial<WorkflowStep>) {
    setLocalSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    )
    markDirty(stepId)
  }

  /** Solicitação de delete: novo (id<0) só remove do buffer; existente vai pra deletedIds + remove do buffer. */
  function requestDelete(stepId: number) {
    setLocalSteps((prev) => {
      // Limpa qualquer ref cruzada apontando pra esse step.
      const cleaned = prev
        .filter((s) => s.id !== stepId)
        .map((s) => ({
          ...s,
          nextStepId: s.nextStepId === stepId ? null : s.nextStepId,
          altStepId: s.altStepId === stepId ? null : s.altStepId,
        }))
      // Marca como dirty quem teve ref alterada.
      for (const s of cleaned) {
        if (s.id > 0) {
          const original = serverSnapshotRef.current.get(s.id)
          if (original && (original.nextStepId !== s.nextStepId || original.altStepId !== s.altStepId)) {
            markDirty(s.id)
          }
        }
      }
      return cleaned
    })
    if (stepId > 0) {
      setDeletedIds((prev) => {
        const next = new Set(prev)
        next.add(stepId)
        return next
      })
    }
    setSelectedStepId((curr) => (curr === stepId ? null : curr))
  }

  function discardChanges() {
    setLocalSteps(serverSteps)
    setDeletedIds(new Set())
    setDirtyIds(new Set())
    tempIdRef.current = -1
    setSelectedStepId(null)
  }

  // ─── React Flow state (derivado do localSteps) ──────────────────────
  const initialGraph = useMemo(
    () => buildGraph(localSteps, { dirtyIds, onRequestDelete: requestDelete, editable }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localSteps, dirtyIds, editable],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges)
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null)
  const selectedStep = selectedStepId !== null ? localSteps.find((s) => s.id === selectedStepId) ?? null : null

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const matchCursorRef = useRef(0)

  const [executionMode, setExecutionMode] = useState(false)
  const execStats = useWorkflowExecutionStats(workflowId ?? null, executionMode && editable)

  // Reconstrói o grafo quando localSteps/dirtyIds mudam. Ref evita reset
  // enquanto o usuário está arrastando.
  const isDraggingRef = useRef(false)
  useEffect(() => {
    if (isDraggingRef.current) return
    const g = buildGraph(localSteps, { dirtyIds, onRequestDelete: requestDelete, editable })
    setNodes(g.nodes)
    setEdges(g.edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSteps, dirtyIds, editable, setNodes, setEdges])

  const saveCanvas = useSaveWorkflowCanvas(workflowId ?? 0)

  const reactFlow = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Guard: avisa antes de fechar a aba/navegar pra fora se houver mudanças não salvas.
  useEffect(() => {
    if (!editable || !isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [editable, isDirty])

  // Histórico — em modo buffer não precisa, mas mantemos undo/redo locais
  // implícitos: Discard reseta tudo. Removido o histórico cirúrgico antigo.
  type HistoryAction = { undo: () => void; redo: () => void; label: string }
  const historyRef = useRef<{ past: HistoryAction[]; future: HistoryAction[] }>({ past: [], future: [] })


  function doUndo() {
    const action = historyRef.current.past.pop()
    if (!action) return
    action.undo()
    historyRef.current.future.push(action)
    toast(`Desfeito: ${action.label}`, 'success')
  }

  function doRedo() {
    const action = historyRef.current.future.pop()
    if (!action) return
    action.redo()
    historyRef.current.past.push(action)
    toast(`Refeito: ${action.label}`, 'success')
  }

  /** Persiste todo o buffer no backend de uma vez. */
  function handleSave() {
    if (!workflowId || !isDirty) return
    const payloadSteps: CanvasSaveStep[] = localSteps.map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
      config: s.config,
      position: s.position,
      positionX: s.positionX ?? 0,
      positionY: s.positionY ?? 0,
      nextStepId: s.nextStepId,
      altStepId: s.altStepId,
    }))
    saveCanvas.mutate(
      { steps: payloadSteps, deletedStepIds: Array.from(deletedIds) },
      {
        onSuccess: () => toast('Fluxo salvo', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  useEffect(() => {
    if (!editable) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      const isCtrl = e.ctrlKey || e.metaKey

      // S5.4 — Ctrl+F abre busca em qualquer lugar (mesmo em input, sobrescreve busca do navegador no canvas)
      if (isCtrl && e.key.toLowerCase() === 'f') {
        // Só intercepta se o canvas está visível
        if (wrapperRef.current && document.activeElement && wrapperRef.current.contains(document.activeElement)) {
          e.preventDefault()
        }
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
        return
      }
      // Esc fecha busca quando aberta e foco no input
      if (e.key === 'Escape' && searchOpen && document.activeElement === searchInputRef.current) {
        e.preventDefault()
        setSearchOpen(false)
        setSearchQuery('')
        return
      }

      // Ctrl+S salva tudo (mesmo dentro de campos — comportamento esperado de "salvar").
      if (isCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (isDirty && !saveCanvas.isPending) handleSave()
        return
      }
      if (inField) return // undo/redo não dispara em campos
      if (!isCtrl) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, searchOpen, isDirty, saveCanvas.isPending])

  // Aplica matched/dimmed nos nodes conforme query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setNodes((prev) =>
        prev.map((n) => ({ ...n, data: { ...n.data, matched: false, dimmed: false } })),
      )
      matchCursorRef.current = 0
      return
    }
    const q = searchQuery.toLowerCase()
    setNodes((prev) =>
      prev.map((n) => {
        const isMatch = String(n.data.name ?? '').toLowerCase().includes(q)
        return { ...n, data: { ...n.data, matched: isMatch, dimmed: !isMatch } }
      }),
    )
  }, [searchQuery, setNodes])

  // S7 — Aplica stats nos nodes/edges quando executionMode ativo.
  useEffect(() => {
    if (!executionMode || !execStats.data) {
      // Limpa overlays quando desliga modo execução
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: { ...n.data, executionMode: false, leadsHere: 0, totalPassed: 0, heatmapIntensity: 0 },
        })),
      )
      setEdges((prev) =>
        prev.map((e) => ({
          ...e,
          style: e.id.startsWith('e-alt-')
            ? { stroke: '#e37400', strokeDasharray: '4 3', strokeWidth: 1.5 }
            : { stroke: '#5f6368', strokeWidth: 1.5 },
          animated: false,
        })),
      )
      return
    }

    const { stepStats, edgeStats } = execStats.data
    const statsByStep = new Map<number, { leadsHere: number; totalPassed: number }>()
    for (const s of stepStats) statsByStep.set(s.stepId, s)
    const maxPassed = Math.max(1, ...stepStats.map((s) => s.totalPassed))

    setNodes((prev) =>
      prev.map((n) => {
        const stat = statsByStep.get(Number(n.id))
        const intensity = stat ? stat.totalPassed / maxPassed : 0
        return {
          ...n,
          data: {
            ...n.data,
            executionMode: true,
            leadsHere: stat?.leadsHere ?? 0,
            totalPassed: stat?.totalPassed ?? 0,
            heatmapIntensity: intensity,
          },
        }
      }),
    )

    const maxEdgeCount = Math.max(1, ...edgeStats.map((e) => e.count))
    const edgeCountByKey = new Map<string, number>()
    for (const e of edgeStats) {
      edgeCountByKey.set(`${e.fromStepId}-${e.toStepId}-${e.kind}`, e.count)
    }

    setEdges((prev) =>
      prev.map((e) => {
        const isAlt = e.id.startsWith('e-alt-')
        const fromId = Number(e.source)
        const toId = Number(e.target)
        const count = edgeCountByKey.get(`${fromId}-${toId}-${isAlt ? 'alt' : 'next'}`) ?? 0
        const intensity = count / maxEdgeCount
        const baseColor = isAlt ? '#e37400' : '#5f6368'
        const strokeWidth = 1.5 + intensity * 3 // 1.5..4.5
        return {
          ...e,
          label: count > 0 ? `${count}` : (isAlt ? 'senão' : 'próximo'),
          labelStyle: { fontSize: 11, fill: count > 0 ? baseColor : '#5f6368', fontWeight: count > 0 ? 600 : 400 },
          style: {
            stroke: baseColor,
            strokeWidth,
            ...(isAlt ? { strokeDasharray: '4 3' } : {}),
          },
          animated: count > 0,
        }
      }),
    )
  }, [executionMode, execStats.data, setNodes, setEdges])

  function handleSearchEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const matches = nodes.filter((n) => n.data.matched)
      if (matches.length === 0) return
      matchCursorRef.current = (matchCursorRef.current + 1) % matches.length
      const next = matches[matchCursorRef.current]
      if (next) {
        reactFlow.setCenter(next.position.x + 110, next.position.y + 40, { zoom: 1, duration: 300 })
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  // Drag termina: persiste posição apenas no buffer local.
  function handleNodeDragStop(_e: unknown, node: Node) {
    if (!editable || !workflowId) return
    isDraggingRef.current = false
    const stepId = Number(node.id)
    if (!Number.isFinite(stepId)) return

    const newX = Math.round(node.position.x)
    const newY = Math.round(node.position.y)
    patchLocalStep(stepId, { positionX: newX, positionY: newY })
  }

  function handleNodeDragStart() {
    isDraggingRef.current = true
  }

  // Conexão visual: grava nextStepId/altStepId no buffer local.
  const handleConnect: OnConnect = (params: Connection) => {
    if (!editable || !workflowId) return
    const sourceId = Number(params.source)
    const targetId = Number(params.target)
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) return

    const isAlt = params.sourceHandle === 'alt'
    if (isAlt) {
      patchLocalStep(sourceId, { altStepId: targetId })
    } else {
      patchLocalStep(sourceId, { nextStepId: targetId })
    }
  }

  // Tecla Del: marca steps pra remoção via buffer.
  function handleNodesDelete(deleted: Node[]) {
    if (!editable || !workflowId) return
    for (const node of deleted) {
      const stepId = Number(node.id)
      if (!Number.isFinite(stepId)) continue
      requestDelete(stepId)
    }
  }

  function handleEdgesDelete(deleted: Edge[]) {
    if (!editable || !workflowId) return
    for (const edge of deleted) {
      const sourceId = Number(edge.source)
      if (!Number.isFinite(sourceId)) continue
      const isAlt = edge.id.startsWith('e-alt-') || edge.sourceHandle === 'alt'
      if (isAlt) {
        patchLocalStep(sourceId, { altStepId: null })
      } else {
        patchLocalStep(sourceId, { nextStepId: null })
      }
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  // Drop da paleta: cria step com tempId negativo no buffer local.
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    if (!editable || !workflowId) return
    const type = e.dataTransfer?.getData('application/x-step-type')
    if (!type) return
    const meta = STEP_TYPE_META[type]
    if (!meta) return

    const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const tempId = nextTempId()
    const maxPos = Math.max(0, ...localSteps.map((s) => s.position ?? 0))
    const newStep: WorkflowStep = {
      id: tempId,
      workflowId: workflowId,
      type,
      name: meta.label,
      config: defaultConfig(type),
      position: maxPos + 1,
      positionX: Math.max(0, Math.round(position.x)),
      positionY: Math.max(0, Math.round(position.y)),
      nextStepId: null,
      altStepId: null,
    }
    setLocalSteps((prev) => [...prev, newStep])
  }

  // Apenas onNodesChange aplica mudanças locais (move, select, dimensions).
  // Persistência só ocorre no onNodeDragStop pra não bombardear o backend.
  function handleNodesChange(changes: NodeChange[]) {
    onNodesChange(changes)
  }

  function handleNodeClick(_e: unknown, node: Node) {
    if (!editable) return
    const id = Number(node.id)
    if (Number.isFinite(id)) setSelectedStepId(id)
  }

  function handlePaneClick() {
    if (!editable) return
    setSelectedStepId(null)
  }

  // Export: serializa o estado atual do buffer (já mostra mudanças não salvas).
  function handleExport() {
    if (!workflowId || localSteps.length === 0) {
      toast('Nada para exportar', 'warning')
      return
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      workflow: { id: workflowId },
      steps: localSteps.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
        config: s.config,
        position: s.position,
        positionX: s.positionX ?? 0,
        positionY: s.positionY ?? 0,
        nextStepId: s.nextStepId,
        altStepId: s.altStepId,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${workflowId}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(`Exportados ${localSteps.length} passos`, 'success')
  }

  // Import: anexa steps com tempIds negativos no buffer. idMap interno
  // resolve refs cruzadas. Save persiste tudo de uma vez no backend.
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handleImportFile(file: File) {
    if (!editable || !workflowId) return
    let parsed: { steps?: unknown[] } | null = null
    try {
      const text = await file.text()
      parsed = JSON.parse(text)
    } catch {
      toast('Arquivo JSON inválido', 'danger')
      return
    }
    if (!parsed || !Array.isArray(parsed.steps)) {
      toast('Estrutura inválida — esperado { steps: [...] }', 'danger')
      return
    }
    const importSteps = parsed.steps as Array<{
      id: number
      type: string
      name: string
      config?: unknown
      position?: number
      positionX?: number
      positionY?: number
      nextStepId?: number | null
      altStepId?: number | null
    }>

    const idMap: Record<number, number> = {}
    const baseMaxPos = Math.max(0, ...localSteps.map((s) => s.position ?? 0))
    const newSteps: WorkflowStep[] = importSteps.map((s, idx) => {
      const tempId = nextTempId()
      idMap[s.id] = tempId
      return {
        id: tempId,
        workflowId,
        type: s.type,
        name: s.name,
        config: s.config ?? {},
        position: baseMaxPos + idx + 1,
        positionX: s.positionX ?? 0,
        positionY: s.positionY ?? 0,
        nextStepId: null,
        altStepId: null,
      }
    })
    // 2ª passada: resolve refs.
    for (let i = 0; i < importSteps.length; i++) {
      const orig = importSteps[i]!
      const ns = newSteps[i]!
      if (orig.nextStepId != null && idMap[orig.nextStepId] !== undefined) {
        ns.nextStepId = idMap[orig.nextStepId]!
      }
      if (orig.altStepId != null && idMap[orig.altStepId] !== undefined) {
        ns.altStepId = idMap[orig.altStepId]!
      }
    }
    setLocalSteps((prev) => [...prev, ...newSteps])
    toast(`Importados ${importSteps.length} passos no buffer — clique Salvar pra confirmar`, 'success')
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleImportChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleImportFile(file)
    input.value = ''
  }

  // Auto-layout: Dagre reposiciona tudo dentro do buffer (sem persistir).
  function handleAutoLayout() {
    if (!editable || !workflowId || nodes.length === 0) return
    const result = layoutWorkflowGraph(nodes, edges, 'LR')
    setNodes(result.nodes)
    setLocalSteps((prev) =>
      prev.map((s) => {
        const change = result.changes.find((c) => Number(c.id) === s.id)
        if (!change) return s
        markDirty(s.id)
        return { ...s, positionX: change.positionX, positionY: change.positionY }
      }),
    )
    toast(`Layout reorganizado (${result.changes.length} passos)`, 'success')
    // Re-fit pra ver tudo
    setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 50)
  }

  if (localSteps.length === 0 && !editable) {
    return (
      <div class="rounded-md border border-dashed border-border p-8 text-center">
        <p class="text-sm text-fg-muted">Nenhum passo neste fluxo.</p>
      </div>
    )
  }

  // Handlers só quando editável — espalhados condicionalmente para não
  // passar `undefined` explícito às props do ReactFlow (exactOptionalPropertyTypes).
  const editableHandlers = editable
    ? {
        onNodesChange: handleNodesChange,
        onEdgesChange,
        onConnect: handleConnect,
        onNodeDragStart: handleNodeDragStart,
        onNodeDragStop: handleNodeDragStop,
        onNodesDelete: handleNodesDelete,
        onEdgesDelete: handleEdgesDelete,
        onNodeClick: handleNodeClick,
        onPaneClick: handlePaneClick,
      }
    : {}

  return (
    <div class="rounded-md border border-border overflow-hidden flex" ref={wrapperRef}>
      {editable && <Palette />}
      <div class="flex-1 flex flex-col">
        <div
          style={{ height }}
          onDragOver={editable ? handleDragOver : undefined}
          onDrop={editable ? handleDrop : undefined}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            {...editableHandlers}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
            snapToGrid={editable}
            snapGrid={[16, 16]}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
            {showMiniMap && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
            {editable && searchOpen && (
              <Panel position="top-left">
                <div class="flex items-center gap-1.5 bg-surface border border-border rounded-md px-2 py-1.5 shadow-md">
                  <Search size={12} class="text-fg-subtle" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                    onKeyDown={handleSearchEnter as unknown as preact.JSX.KeyboardEventHandler<HTMLInputElement>}
                    placeholder="Buscar passos…"
                    class="bg-transparent outline-none text-sm text-fg w-44 placeholder:text-fg-subtle"
                  />
                  {searchQuery && (
                    <span class="text-[0.6875rem] text-fg-subtle tabular-nums">
                      {nodes.filter((n) => n.data.matched).length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                    class="size-5 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3"
                    title="Fechar (Esc)"
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              </Panel>
            )}
            {editable && (
              <Panel position="top-right" class="flex gap-1.5 flex-wrap items-center">
                {isDirty && (
                  <span
                    class="inline-flex items-center gap-1 px-2 h-8 rounded-md text-xs font-medium shadow-sm"
                    style={{ background: '#f59e0b', color: '#fff' }}
                    title={`${pendingChangesCount} mudança(s) não salva(s)`}
                  >
                    {pendingChangesCount} mudança{pendingChangesCount === 1 ? '' : 's'} não salva{pendingChangesCount === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || saveCanvas.isPending}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium shadow-sm disabled:opacity-50"
                  style={{
                    background: isDirty ? '#16a34a' : 'var(--surface)',
                    color: isDirty ? '#fff' : 'var(--fg-muted)',
                    borderColor: isDirty ? '#16a34a' : 'var(--border)',
                    border: '1px solid',
                  }}
                  title={isDirty ? 'Salvar todas as mudanças (Ctrl+S)' : 'Sem mudanças pra salvar'}
                >
                  <Save size={12} /> {saveCanvas.isPending ? 'Salvando…' : 'Salvar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isDirty) return
                    if (window.confirm('Descartar todas as mudanças não salvas?')) {
                      discardChanges()
                      toast('Mudanças descartadas', 'success')
                    }
                  }}
                  disabled={!isDirty || saveCanvas.isPending}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-3 shadow-sm disabled:opacity-50"
                  title="Descartar mudanças e voltar ao último estado salvo"
                >
                  <XIcon size={12} /> Descartar
                </button>
                <span class="w-px h-6 bg-border mx-0.5" />
                <button
                  type="button"
                  onClick={() => setExecutionMode((v) => !v)}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs font-medium shadow-sm"
                  style={{
                    background: executionMode ? '#1a73e8' : 'var(--surface)',
                    color: executionMode ? '#fff' : 'var(--fg)',
                    borderColor: executionMode ? '#1a73e8' : 'var(--border)',
                  }}
                  title={executionMode ? 'Desativar modo Execução' : 'Mostrar quantos leads passam por cada passo (atualiza a cada 5s)'}
                >
                  <Activity size={12} /> Execução {executionMode ? 'ON' : 'OFF'}
                </button>
                {nodes.length > 1 && (
                  <button
                    type="button"
                    onClick={handleAutoLayout}
                    disabled={saveCanvas.isPending}
                    class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-3 shadow-sm disabled:opacity-50"
                    title="Reorganiza os nodes em colunas (Dagre layered)"
                  >
                    <LayoutGrid size={12} /> Organizar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExport}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-3 shadow-sm"
                  title="Exporta o fluxo como JSON (backup ou template)"
                >
                  <Download size={12} /> Exportar
                </button>
                <button
                  type="button"
                  onClick={handleImportClick}
                  disabled={saveCanvas.isPending}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-3 shadow-sm disabled:opacity-50"
                  title="Importa passos de um JSON exportado anteriormente"
                >
                  <Upload size={12} /> Importar
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  class="hidden"
                  onChange={handleImportChange}
                />
              </Panel>
            )}
            {editable && executionMode && execStats.data && (
              <Panel position="bottom-left">
                <div class="flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2 shadow-sm text-xs">
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-info animate-pulse" />
                    <span class="text-fg-muted">Atualiza a cada 5s</span>
                  </div>
                  <div class="h-3 w-px bg-border" />
                  <div class="flex items-center gap-3 tabular-nums">
                    {(['running', 'paused', 'completed', 'failed'] as const).map((status) => {
                      const v = execStats.data.summary[status] ?? 0
                      const labels: Record<string, string> = {
                        running: 'rodando',
                        paused: 'pausados',
                        completed: 'concluídos',
                        failed: 'falhados',
                      }
                      const colors: Record<string, string> = {
                        running: '#1a73e8',
                        paused: '#f9ab00',
                        completed: '#2e7d32',
                        failed: '#dc2626',
                      }
                      return (
                        <span key={status} class="flex items-center gap-1">
                          <span class="w-1.5 h-1.5 rounded-full" style={{ background: colors[status] }} />
                          <span class="text-fg-muted">{labels[status]}:</span>
                          <span class="font-semibold text-fg">{v}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
        {showLegend && (
          <div class="px-3 py-2 border-t border-border text-[0.6875rem] text-fg-muted flex items-center gap-3 flex-wrap">
            <span><span class="inline-block w-3 h-0.5 bg-fg-subtle align-middle mr-1" /> próximo passo</span>
            <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#e37400', borderTop: '1px dashed #e37400' }} /> caminho alternativo (senão)</span>
            {editable && <span class="text-fg-subtle">· paleta cria · clique edita · Del remove · Ctrl+Z desfaz · Ctrl+F busca · botão "Execução" mostra leads em tempo real</span>}
            <span class="ml-auto">{nodes.length} passos · {edges.length} conexões</span>
          </div>
        )}
      </div>
      {editable && workflowId && selectedStep && (
        <WorkflowStepEditPanel
          workflowId={workflowId}
          step={selectedStep}
          steps={localSteps}
          onPatch={(patch) => patchLocalStep(selectedStep.id, patch)}
          onClose={() => setSelectedStepId(null)}
        />
      )}
    </div>
  )
}

/**
 * Paleta lateral — cards arrastáveis, um por tipo de step. Drag inicia
 * com `dataTransfer.setData('application/x-step-type', tipo)`; o canvas
 * captura no onDrop e cria o step naquela posição.
 */
function Palette() {
  const [collapsed, setCollapsed] = useState(false)

  function handleDragStart(e: DragEvent, type: string) {
    if (!e.dataTransfer) return
    e.dataTransfer.setData('application/x-step-type', type)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      class="border-r border-border bg-surface-2 flex flex-col"
      style={{ width: collapsed ? '32px' : '180px', transition: 'width 150ms ease' }}
    >
      <button
        type="button"
        class="text-[0.6875rem] text-fg-muted hover:text-fg p-2 border-b border-border text-left"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Expandir paleta' : 'Recolher paleta'}
      >
        {collapsed ? '›' : '‹ Paleta'}
      </button>
      {!collapsed && (
        <>
          <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-semibold px-3 pt-3 pb-1">
            Arraste para o canvas
          </div>
          <div class="flex flex-col gap-1.5 p-2">
            {Object.entries(STEP_TYPE_META).map(([type, meta]) => (
              <div
                key={type}
                draggable
                onDragStart={(e) => handleDragStart(e as unknown as DragEvent, type)}
                class="flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-grab active:cursor-grabbing text-xs font-medium hover:opacity-80 select-none"
                style={{
                  background: `${meta.color}10`,
                  color: meta.color,
                  borderColor: `${meta.color}40`,
                }}
                title={`Adicionar passo: ${meta.label}`}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
