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
  type CadenceStep,
  useCadenceExecutionStats,
  useSaveCadenceCanvas,
  type CadenceCanvasSaveStep,
} from '@/hooks/useSalesCadences'
import { CadenceStepEditPanel } from '@/components/CadenceStepEditPanel'
import { layoutWorkflowGraph } from '@/lib/workflowLayout'
import { toast } from '@/lib/toast'

/**
 * Canvas de cadência — read-only por padrão, editable via prop.
 *
 * Diferente do `WorkflowCanvasView`, aqui os "tipos" do node são CANAIS
 * (whatsapp/email/sms/call/linkedin/manual). A topologia padrão é linear
 * (ordem por `order`), mas com `nextStepId` opcional o operador pode criar
 * grafos com branching — o `cadenceScheduler` usa nextStepId quando presente
 * e cai no fallback linear quando null.
 *
 * Reutiliza:
 *  - `layoutWorkflowGraph` (Dagre) — funciona pra qualquer DAG.
 *  - Estatísticas pro modo Execução vêm do endpoint dedicado de cadência.
 */

const CHANNEL_META: Record<string, { label: string; color: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#25D366', icon: '💬' },
  email:    { label: 'E-mail',   color: '#1a73e8', icon: '✉️' },
  sms:      { label: 'SMS',      color: '#f9ab00', icon: '📱' },
  call:     { label: 'Ligação',  color: '#8e24aa', icon: '📞' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', icon: '💼' },
  manual:   { label: 'Tarefa',   color: '#5f6368', icon: '📋' },
}

type StepIssue = 'no-output-non-breakup' | 'orphan' | 'broken-next'

function detectIssues(steps: CadenceStep[]): Map<number, StepIssue[]> {
  const issues = new Map<number, StepIssue[]>()
  const idSet = new Set(steps.map((s) => s.id))
  const incomingCount = new Map<number, number>()
  for (const s of steps) {
    if (s.nextStepId) incomingCount.set(s.nextStepId, (incomingCount.get(s.nextStepId) ?? 0) + 1)
    if (s.altStepId) incomingCount.set(s.altStepId, (incomingCount.get(s.altStepId) ?? 0) + 1)
  }
  // Em modo linear, o "próximo" implícito é o step com order+1.
  for (const s of steps) {
    const nextLinear = steps.find((x) => x.order === s.order + 1)
    if (nextLinear) incomingCount.set(nextLinear.id, (incomingCount.get(nextLinear.id) ?? 0) + 1)
  }

  const sortedAsc = [...steps].sort((a, b) => a.order - b.order)
  const lastStep = sortedAsc[sortedAsc.length - 1]

  for (const s of steps) {
    const list: StepIssue[] = []
    // Step com nextStepId apontando pra step que não existe → arestas órfãs.
    if (s.nextStepId && !idSet.has(s.nextStepId)) list.push('broken-next')
    if (s.altStepId && !idSet.has(s.altStepId)) list.push('broken-next')
    // Step não-breakup que termina abruptamente (não é o último na ordem
    // linear nem aponta pra nada). Em cadência o "fim natural" é o step com
    // maior order ou um isBreakUp.
    const hasOutgoing = !!s.nextStepId || steps.some((x) => x.order === s.order + 1)
    if (!hasOutgoing && !s.isBreakUp && lastStep && lastStep.id !== s.id) list.push('no-output-non-breakup')
    // Step sem ninguém apontando (quando não é o primeiro)
    const isFirst = s.order === 0
    if (!isFirst && (incomingCount.get(s.id) ?? 0) === 0) list.push('orphan')
    if (list.length > 0) issues.set(s.id, list)
  }
  return issues
}

const ISSUE_LABELS: Record<StepIssue, string> = {
  'no-output-non-breakup': 'Sem saída e não é break-up — defina próximo step ou marque como break-up',
  'orphan': 'Sem entrada — nunca será executado',
  'broken-next': 'Aponta para step inexistente',
}

function defaultStepDataForChannel(channel: string): { dayOffset: number; hourOffset: number } {
  // Defaults amistosos pro primeiro step / steps subsequentes
  if (channel === 'whatsapp' || channel === 'sms') return { dayOffset: 0, hourOffset: 1 }
  if (channel === 'email') return { dayOffset: 1, hourOffset: 0 }
  if (channel === 'call') return { dayOffset: 2, hourOffset: 0 }
  return { dayOffset: 1, hourOffset: 0 }
}

function StepNode({ id, data, selected }: NodeProps) {
  const channel = data.channel as string
  const meta = CHANNEL_META[channel] ?? { label: channel, color: '#5f6368', icon: '?' }
  const isBreakUp = data.isBreakUp as boolean
  const isManual = data.isManual as boolean
  const dayOffset = (data.dayOffset as number | undefined) ?? 0
  const hourOffset = (data.hourOffset as number | undefined) ?? 0
  const order = (data.order as number | undefined) ?? 0

  const issues = (data.issues as StepIssue[] | undefined) ?? []
  const hasError = issues.includes('no-output-non-breakup') || issues.includes('broken-next')
  const hasWarning = issues.includes('orphan')
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

  const heatBg = executionMode && heatmapIntensity > 0
    ? `linear-gradient(135deg, ${meta.color}${Math.round(8 + heatmapIntensity * 30).toString(16).padStart(2, '0')} 0%, transparent 100%)`
    : undefined

  const offsetLabel = dayOffset === 0 && hourOffset === 0
    ? 'imediato'
    : dayOffset > 0
      ? `D+${dayOffset}${hourOffset > 0 ? ` ${hourOffset}h` : ''}`
      : `+${hourOffset}h`

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
          title="Remover step (do buffer — clique em Salvar pra confirmar)"
          aria-label="Remover step"
        >
          <Trash2 size={10} />
        </button>
      )}
      {(isNew || isDirty) && !executionMode && (
        <span
          class="absolute -top-1.5 -right-1.5 inline-flex items-center px-1 h-4 rounded text-[0.5625rem] font-bold shadow-sm"
          style={{ background: isNew ? '#0ea5e9' : '#f59e0b', color: '#fff' }}
          title={isNew ? 'Novo step (não salvo)' : 'Modificado'}
        >
          {isNew ? 'NOVO' : '•'}
        </span>
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{ background: '#5f6368', width: 8, height: 8 }}
      />
      <div class="flex items-center gap-2 mb-1">
        <span class="text-base">{meta.icon}</span>
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.6875rem] font-medium"
          style={{ background: `${meta.color}15`, color: meta.color }}
        >
          {meta.label}
        </span>
        <span class="text-[0.625rem] text-fg-subtle">#{order + 1} · {offsetLabel}</span>
        {isBreakUp && (
          <span class="text-[0.625rem] px-1 py-0.5 rounded bg-danger/15 text-danger">break-up</span>
        )}
        {isManual && (
          <span class="text-[0.625rem] px-1 py-0.5 rounded bg-fg-muted/15 text-fg-muted">manual</span>
        )}
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
      <div class="text-sm font-medium text-fg break-words">{String(data.name ?? meta.label)}</div>

      {executionMode && totalPassed > 0 && (
        <div class="text-[0.6875rem] text-fg-muted mt-1 tabular-nums flex items-center gap-1">
          <span class="text-fg-subtle">↗</span>
          <span>{totalPassed.toLocaleString('pt-BR')}</span>
          <span class="text-fg-subtle">passaram aqui</span>
        </div>
      )}

      {!isBreakUp && (
        <Handle
          type="source"
          position={Position.Right}
          id="next"
          style={{ background: '#5f6368', width: 8, height: 8, top: '50%' }}
        />
      )}
    </div>
  )
}

const nodeTypes = { step: StepNode }

function buildGraph(
  steps: CadenceStep[],
  options: {
    dirtyIds?: Set<number>
    onRequestDelete?: (stepId: number) => void
    editable?: boolean
  } = {},
): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...steps].sort((a, b) => a.order - b.order)
  const issues = detectIssues(steps)
  const nodes: Node[] = sorted.map((s, idx) => {
    const px = s.positionX ?? 0
    const py = s.positionY ?? 0
    const hasCustomPosition = px > 0 || py > 0
    return {
      id: String(s.id),
      type: 'step',
      position: hasCustomPosition
        ? { x: px, y: py }
        : { x: idx * 280, y: 0 },
      data: {
        name: CHANNEL_META[s.channel]?.label ?? s.channel,
        channel: s.channel,
        order: s.order,
        dayOffset: s.dayOffset,
        hourOffset: s.hourOffset,
        isBreakUp: s.isBreakUp,
        isManual: s.isManual,
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
  // Edge explícita por nextStepId (tem prioridade).
  const explicitNext = new Set<number>()
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
      explicitNext.add(s.id)
    }
    if (s.altStepId) {
      edges.push({
        id: `e-alt-${s.id}`,
        source: String(s.id),
        target: String(s.altStepId),
        sourceHandle: 'next',
        targetHandle: 'in',
        label: 'senão',
        labelStyle: { fontSize: 11, fill: '#e37400' },
        style: { stroke: '#e37400', strokeDasharray: '4 3', strokeWidth: 1.5 },
      })
    }
  }
  // Edges implícitas (linear) — desenhadas pontilhadas pra deixar claro que
  // não é uma conexão "real" no grafo, é só o fallback do scheduler.
  for (const s of sorted) {
    if (explicitNext.has(s.id) || s.isBreakUp) continue
    const next = sorted.find((x) => x.order === s.order + 1)
    if (next) {
      edges.push({
        id: `e-implicit-${s.id}`,
        source: String(s.id),
        target: String(next.id),
        sourceHandle: 'next',
        targetHandle: 'in',
        label: 'linear',
        labelStyle: { fontSize: 10, fill: '#9ca3af', fontStyle: 'italic' },
        style: { stroke: '#9ca3af', strokeDasharray: '3 4', strokeWidth: 1 },
      })
    }
  }

  return { nodes, edges }
}

interface Props {
  steps: CadenceStep[]
  cadenceId?: number
  editable?: boolean
  height?: string
  showMiniMap?: boolean
  showLegend?: boolean
}

export function CadenceCanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({
  steps: serverSteps,
  cadenceId,
  editable = false,
  height = '500px',
  showMiniMap = true,
  showLegend = true,
}: Props) {
  // ─── Buffer local (Fase 26 + Save/Discard) ──────────────────────────
  const [localSteps, setLocalSteps] = useState<CadenceStep[]>(serverSteps)
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
  const tempIdRef = useRef(-1)
  function nextTempId() { return tempIdRef.current-- }

  const serverSnapshotRef = useRef<Map<number, CadenceStep>>(new Map())

  useEffect(() => {
    setLocalSteps(serverSteps)
    setDeletedIds(new Set())
    setDirtyIds(new Set())
    tempIdRef.current = -1
    serverSnapshotRef.current = new Map(serverSteps.map((s) => [s.id, s]))
  }, [serverSteps])

  const isDirty =
    deletedIds.size > 0 || dirtyIds.size > 0 || localSteps.some((s) => s.id < 0)

  const pendingChangesCount =
    deletedIds.size + dirtyIds.size + localSteps.filter((s) => s.id < 0).length

  function markDirty(stepId: number) {
    if (stepId < 0) return
    setDirtyIds((prev) => {
      if (prev.has(stepId)) return prev
      const next = new Set(prev); next.add(stepId); return next
    })
  }

  function patchLocalStep(stepId: number, patch: Partial<CadenceStep>) {
    setLocalSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    )
    markDirty(stepId)
  }

  function requestDelete(stepId: number) {
    setLocalSteps((prev) => {
      const cleaned = prev
        .filter((s) => s.id !== stepId)
        .map((s) => ({
          ...s,
          nextStepId: s.nextStepId === stepId ? null : s.nextStepId,
          altStepId: s.altStepId === stepId ? null : s.altStepId,
        }))
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
      setDeletedIds((prev) => { const next = new Set(prev); next.add(stepId); return next })
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

  // ─── React Flow state ───────────────────────────────────────────────
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
  const execStats = useCadenceExecutionStats(cadenceId ?? null, executionMode && editable)

  const isDraggingRef = useRef(false)
  useEffect(() => {
    if (isDraggingRef.current) return
    const g = buildGraph(localSteps, { dirtyIds, onRequestDelete: requestDelete, editable })
    setNodes(g.nodes)
    setEdges(g.edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSteps, dirtyIds, editable, setNodes, setEdges])

  const saveCanvas = useSaveCadenceCanvas(cadenceId ?? 0)

  const reactFlow = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Guard: avisa antes de fechar a aba/navegar pra fora se houver mudanças.
  useEffect(() => {
    if (!editable || !isDirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault(); e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [editable, isDirty])

  function handleSave() {
    if (!cadenceId || !isDirty) return
    const payloadSteps: CadenceCanvasSaveStep[] = localSteps.map((s) => ({
      id: s.id,
      order: s.order,
      dayOffset: s.dayOffset,
      hourOffset: s.hourOffset,
      channel: s.channel,
      templateId: s.templateId,
      isManual: s.isManual,
      isBreakUp: s.isBreakUp,
      conditionJson: s.conditionJson,
      positionX: s.positionX ?? 0,
      positionY: s.positionY ?? 0,
      nextStepId: s.nextStepId ?? null,
      altStepId: s.altStepId ?? null,
    }))
    saveCanvas.mutate(
      { steps: payloadSteps, deletedStepIds: Array.from(deletedIds) },
      {
        onSuccess: () => toast('Cadência salva', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

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

  useEffect(() => {
    if (!editable) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      const isCtrl = e.ctrlKey || e.metaKey

      if (isCtrl && e.key.toLowerCase() === 'f') {
        if (wrapperRef.current && document.activeElement && wrapperRef.current.contains(document.activeElement)) {
          e.preventDefault()
        }
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
        return
      }
      if (e.key === 'Escape' && searchOpen && document.activeElement === searchInputRef.current) {
        e.preventDefault()
        setSearchOpen(false)
        setSearchQuery('')
        return
      }

      if (isCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (isDirty && !saveCanvas.isPending) handleSave()
        return
      }
      if (inField) return
      if (!isCtrl) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); doUndo()
      } else if (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault(); doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, searchOpen, isDirty, saveCanvas.isPending])

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
        const isMatch =
          String(n.data.name ?? '').toLowerCase().includes(q) ||
          String(n.data.channel ?? '').toLowerCase().includes(q)
        return { ...n, data: { ...n.data, matched: isMatch, dimmed: !isMatch } }
      }),
    )
  }, [searchQuery, setNodes])

  useEffect(() => {
    if (!executionMode || !execStats.data) {
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: { ...n.data, executionMode: false, leadsHere: 0, totalPassed: 0, heatmapIntensity: 0 },
        })),
      )
      setEdges((prev) =>
        prev.map((e) => ({
          ...e,
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
    for (const e of edgeStats) edgeCountByKey.set(`${e.fromStepId}-${e.toStepId}`, e.count)

    setEdges((prev) =>
      prev.map((e) => {
        const isAlt = e.id.startsWith('e-alt-')
        const isImplicit = e.id.startsWith('e-implicit-')
        const fromId = Number(e.source)
        const toId = Number(e.target)
        const count = edgeCountByKey.get(`${fromId}-${toId}`) ?? 0
        const intensity = count / maxEdgeCount
        const baseColor = isAlt ? '#e37400' : isImplicit ? '#9ca3af' : '#5f6368'
        const baseWidth = isImplicit ? 1 : 1.5
        const strokeWidth = baseWidth + intensity * 3
        return {
          ...e,
          label: count > 0 ? `${count}` : (isAlt ? 'senão' : isImplicit ? 'linear' : 'próximo'),
          labelStyle: { fontSize: 11, fill: count > 0 ? baseColor : (isImplicit ? '#9ca3af' : '#5f6368'), fontWeight: count > 0 ? 600 : 400 },
          style: {
            stroke: baseColor,
            strokeWidth,
            ...(isAlt ? { strokeDasharray: '4 3' } : {}),
            ...(isImplicit ? { strokeDasharray: '3 4' } : {}),
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
      if (next) reactFlow.setCenter(next.position.x + 110, next.position.y + 40, { zoom: 1, duration: 300 })
    } else if (e.key === 'Escape') {
      e.preventDefault(); setSearchOpen(false); setSearchQuery('')
    }
  }

  function handleNodeDragStart() { isDraggingRef.current = true }
  function handleNodeDragStop(_e: unknown, node: Node) {
    if (!editable || !cadenceId) return
    isDraggingRef.current = false
    const stepId = Number(node.id)
    if (!Number.isFinite(stepId)) return
    const newX = Math.round(node.position.x)
    const newY = Math.round(node.position.y)
    patchLocalStep(stepId, { positionX: newX, positionY: newY })
  }

  const handleConnect: OnConnect = (params: Connection) => {
    if (!editable || !cadenceId) return
    const sourceId = Number(params.source)
    const targetId = Number(params.target)
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) return
    patchLocalStep(sourceId, { nextStepId: targetId })
  }

  function handleNodesDelete(deleted: Node[]) {
    if (!editable || !cadenceId) return
    for (const node of deleted) {
      const stepId = Number(node.id)
      if (!Number.isFinite(stepId)) continue
      requestDelete(stepId)
    }
  }

  function handleEdgesDelete(deleted: Edge[]) {
    if (!editable || !cadenceId) return
    for (const edge of deleted) {
      if (edge.id.startsWith('e-implicit-')) {
        toast('Edge linear é automática — mude a ordem do step pra remover', 'warning')
        continue
      }
      const sourceId = Number(edge.source)
      if (!Number.isFinite(sourceId)) continue
      const isAlt = edge.id.startsWith('e-alt-')
      if (isAlt) patchLocalStep(sourceId, { altStepId: null })
      else patchLocalStep(sourceId, { nextStepId: null })
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    if (!editable || !cadenceId) return
    const channel = e.dataTransfer?.getData('application/x-cadence-channel')
    if (!channel) return
    const meta = CHANNEL_META[channel]
    if (!meta) return

    const position = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const isManualByDefault = channel === 'call' || channel === 'linkedin' || channel === 'manual'
    const defaults = defaultStepDataForChannel(channel)
    const tempId = nextTempId()
    const maxOrder = localSteps.length === 0 ? 0 : Math.max(...localSteps.map((s) => s.order)) + 1
    const newStep: CadenceStep = {
      id: tempId,
      order: maxOrder,
      dayOffset: defaults.dayOffset,
      hourOffset: defaults.hourOffset,
      channel,
      templateId: null,
      isManual: isManualByDefault,
      isBreakUp: false,
      conditionJson: null,
      positionX: Math.max(0, Math.round(position.x)),
      positionY: Math.max(0, Math.round(position.y)),
      nextStepId: null,
      altStepId: null,
    }
    setLocalSteps((prev) => [...prev, newStep])
    void meta // marca como usado pra silenciar lint
  }

  function handleNodesChange(changes: NodeChange[]) { onNodesChange(changes) }

  function handleNodeClick(_e: unknown, node: Node) {
    if (!editable) return
    const id = Number(node.id)
    if (Number.isFinite(id)) setSelectedStepId(id)
  }
  function handlePaneClick() {
    if (!editable) return
    setSelectedStepId(null)
  }

  function handleExport() {
    if (!cadenceId || localSteps.length === 0) {
      toast('Nada para exportar', 'warning')
      return
    }
    const payload = {
      version: 1,
      kind: 'cadence',
      exportedAt: new Date().toISOString(),
      cadence: { id: cadenceId },
      steps: localSteps.map((s) => ({
        id: s.id,
        order: s.order,
        channel: s.channel,
        templateId: s.templateId,
        dayOffset: s.dayOffset,
        hourOffset: s.hourOffset,
        isManual: s.isManual,
        isBreakUp: s.isBreakUp,
        conditionJson: s.conditionJson,
        positionX: s.positionX ?? 0,
        positionY: s.positionY ?? 0,
        nextStepId: s.nextStepId ?? null,
        altStepId: s.altStepId ?? null,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cadence-${cadenceId}-${Date.now()}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(`Exportados ${localSteps.length} steps`, 'success')
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  async function handleImportFile(file: File) {
    if (!editable || !cadenceId) return
    let parsed: { steps?: unknown[] } | null = null
    try {
      const text = await file.text()
      parsed = JSON.parse(text)
    } catch {
      toast('Arquivo JSON inválido', 'danger'); return
    }
    if (!parsed || !Array.isArray(parsed.steps)) {
      toast('Estrutura inválida — esperado { steps: [...] }', 'danger'); return
    }
    const importSteps = parsed.steps as Array<{
      id: number
      order: number
      channel: string
      templateId?: number | null
      dayOffset?: number
      hourOffset?: number
      isManual?: boolean
      isBreakUp?: boolean
      positionX?: number
      positionY?: number
      nextStepId?: number | null
      altStepId?: number | null
    }>

    const idMap: Record<number, number> = {}
    const baseOrder = localSteps.length === 0 ? 0 : Math.max(...localSteps.map((s) => s.order)) + 1
    const newSteps: CadenceStep[] = importSteps.map((s, idx) => {
      const tempId = nextTempId()
      idMap[s.id] = tempId
      return {
        id: tempId,
        order: baseOrder + idx,
        channel: s.channel,
        templateId: s.templateId ?? null,
        dayOffset: s.dayOffset ?? 0,
        hourOffset: s.hourOffset ?? 0,
        isManual: s.isManual ?? false,
        isBreakUp: s.isBreakUp ?? false,
        conditionJson: null,
        positionX: s.positionX ?? 0,
        positionY: s.positionY ?? 0,
        nextStepId: null,
        altStepId: null,
      }
    })
    for (let i = 0; i < importSteps.length; i++) {
      const orig = importSteps[i]!
      const ns = newSteps[i]!
      if (orig.nextStepId != null && idMap[orig.nextStepId] !== undefined) ns.nextStepId = idMap[orig.nextStepId]!
      if (orig.altStepId != null && idMap[orig.altStepId] !== undefined) ns.altStepId = idMap[orig.altStepId]!
    }
    setLocalSteps((prev) => [...prev, ...newSteps])
    toast(`Importados ${importSteps.length} steps no buffer — clique Salvar pra confirmar`, 'success')
  }
  function handleImportClick() { fileInputRef.current?.click() }
  function handleImportChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleImportFile(file)
    input.value = ''
  }

  function handleAutoLayout() {
    if (!editable || !cadenceId || nodes.length === 0) return
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
    toast(`Layout reorganizado (${result.changes.length} steps)`, 'success')
    setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 50)
  }

  if (localSteps.length === 0 && !editable) {
    return (
      <div class="rounded-md border border-dashed border-border p-8 text-center">
        <p class="text-sm text-fg-muted">Nenhum step nesta cadência.</p>
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
                    placeholder="Buscar steps…"
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
                  title={executionMode ? 'Desativar modo Execução' : 'Mostrar quantos leads passam por cada step (atualiza a cada 5s)'}
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
                  title="Exporta a cadência como JSON (backup ou template)"
                >
                  <Download size={12} /> Exportar
                </button>
                <button
                  type="button"
                  onClick={handleImportClick}
                  disabled={saveCanvas.isPending}
                  class="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-surface border border-border text-xs font-medium text-fg hover:bg-surface-3 shadow-sm disabled:opacity-50"
                  title="Importa steps de um JSON exportado anteriormente"
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
                    {(['active', 'paused', 'completed', 'exited'] as const).map((status) => {
                      const v = execStats.data.summary[status] ?? 0
                      const labels: Record<string, string> = {
                        active: 'ativos',
                        paused: 'pausados',
                        completed: 'concluídos',
                        exited: 'saíram',
                      }
                      const colors: Record<string, string> = {
                        active: '#1a73e8',
                        paused: '#f9ab00',
                        completed: '#2e7d32',
                        exited: '#dc2626',
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
            <span><span class="inline-block w-3 h-0.5 bg-fg-subtle align-middle mr-1" /> próximo (explícito)</span>
            <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#9ca3af', borderTop: '1px dashed #9ca3af' }} /> linear (auto, fallback)</span>
            <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#e37400', borderTop: '1px dashed #e37400' }} /> senão (alt)</span>
            {editable && <span class="text-fg-subtle">· paleta cria · clique edita · Del remove · Ctrl+Z desfaz · Ctrl+F busca · Execução mostra leads em tempo real</span>}
            <span class="ml-auto">{nodes.length} steps · {edges.length} conexões</span>
          </div>
        )}
      </div>
      {editable && cadenceId && selectedStep && (
        <CadenceStepEditPanel
          cadenceId={cadenceId}
          step={selectedStep}
          steps={localSteps}
          onPatch={(patch) => patchLocalStep(selectedStep.id, patch)}
          onClose={() => setSelectedStepId(null)}
        />
      )}
    </div>
  )
}

function Palette() {
  const [collapsed, setCollapsed] = useState(false)

  function handleDragStart(e: DragEvent, channel: string) {
    if (!e.dataTransfer) return
    e.dataTransfer.setData('application/x-cadence-channel', channel)
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
        {collapsed ? '›' : '‹ Canais'}
      </button>
      {!collapsed && (
        <>
          <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-semibold px-3 pt-3 pb-1">
            Arraste para o canvas
          </div>
          <div class="flex flex-col gap-1.5 p-2">
            {Object.entries(CHANNEL_META).map(([channel, meta]) => (
              <div
                key={channel}
                draggable
                onDragStart={(e) => handleDragStart(e as unknown as DragEvent, channel)}
                class="flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-grab active:cursor-grabbing text-xs font-medium hover:opacity-80 select-none"
                style={{
                  background: `${meta.color}10`,
                  color: meta.color,
                  borderColor: `${meta.color}40`,
                }}
                title={`Adicionar step: ${meta.label}`}
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
