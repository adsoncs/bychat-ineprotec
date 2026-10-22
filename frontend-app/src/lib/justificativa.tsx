// Ação que o servidor recusa com 409 `precisaJustificativa` (ex.: Ganho com a
// jornada da inscrição incompleta — backend services/ganhoComPendencia.ts):
// a caixa única do painel pede o porquê e a ação é refeita com a justificativa.
// Uso no mutationFn: `comJustificativa((j) => api.post(url, { ...body, ...(j ? { justificativa: j } : {}) }))`.

import { useEffect, useState } from 'preact/hooks'
import { ApiError } from '@/lib/apiClient'
import { JustificativaJuncaoDialog } from '@/components/JustificativaJuncaoDialog'

interface Pedido { titulo: string; motivo: string; resolver: (j: string | null) => void }
let ouvinte: ((p: Pedido | null) => void) | null = null

function pedirJustificativa(titulo: string, motivo: string): Promise<string | null> {
  return new Promise((resolver) => {
    if (!ouvinte) { resolver(null); return }
    ouvinte({ titulo, motivo, resolver })
  })
}

export class AcaoCancelada extends Error {
  constructor() { super('Ação cancelada: a justificativa não foi informada.') }
}

export async function comJustificativa<T>(fn: (justificativa?: string) => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const p = e instanceof ApiError ? (e.payload as any) : null
    if (!(e instanceof ApiError) || e.status !== 409 || !p?.precisaJustificativa) throw e
    const j = await pedirJustificativa(String(p.titulo || 'Confirmar com justificativa'), [p.error, p.motivo].filter(Boolean).join(' — '))
    if (!j) throw new AcaoCancelada()
    return fn(j)
  }
}

/** Montado uma vez no AppShell. */
export function JustificativaGlobal() {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  useEffect(() => { ouvinte = setPedido; return () => { ouvinte = null } }, [])
  if (!pedido) return null
  const fechar = (j: string | null) => { pedido.resolver(j); setPedido(null) }
  return (
    <JustificativaJuncaoDialog titulo={pedido.titulo} motivo={pedido.motivo} acao="Confirmar mesmo assim"
      descricao="A justificativa fica no histórico do lead e no seu histórico de ações."
      onCancel={() => fechar(null)} onConfirm={(j) => fechar(j)} />
  )
}
