import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

/**
 * Auto-layout DAG via Dagre.
 *
 * Posiciona nodes em colunas baseadas na ordem topológica do grafo. Em fluxos
 * com branching (condition/branch com altStepId), o "senão" fica logo abaixo
 * do "próximo" na mesma coluna. Nodes desconectados ficam isolados na esquerda.
 *
 * Largura/altura aproximadas dos nodes precisam ser passadas — dagre usa pra
 * calcular espaçamento. O StepNode mede ~240×80; uso 240×80 com nodesep=50.
 */

const NODE_WIDTH = 240
const NODE_HEIGHT = 80

export interface LayoutResult {
  nodes: Node[]
  /** Mudanças por id pra persistir (positionX/Y novos) */
  changes: { id: string; positionX: number; positionY: number }[]
}

export function layoutWorkflowGraph(
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): LayoutResult {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 90, edgesep: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const positionedNodes: Node[] = []
  const changes: { id: string; positionX: number; positionY: number }[] = []

  for (const node of nodes) {
    const layouted = g.node(node.id)
    if (!layouted) {
      positionedNodes.push(node)
      continue
    }
    // Dagre retorna o CENTRO do node; xyflow espera o canto superior esquerdo.
    const x = Math.max(0, Math.round(layouted.x - NODE_WIDTH / 2))
    const y = Math.max(0, Math.round(layouted.y - NODE_HEIGHT / 2))
    positionedNodes.push({ ...node, position: { x, y } })
    changes.push({ id: node.id, positionX: x, positionY: y })
  }

  return { nodes: positionedNodes, changes }
}
