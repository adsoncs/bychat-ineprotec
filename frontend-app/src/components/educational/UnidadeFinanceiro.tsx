// Unidade (empresa) no Financeiro e na Inadimplência: seletor do topo e
// etiqueta em cada linha. ineprotec, 24/11: o time não separava o que era da
// INEPROTEC e o que era da Matrícula EAD — nomes de portal parecidos, totais
// somados. A unidade vem do portal da inscrição (backend lib/unidadesFinanceiro).
//
// A escolha fica gravada no navegador (mesma chave nas duas telas): quem cuida
// de uma empresa só abre sempre nela.
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface UnidadeFin { id: number; nome: string; cor: string | null; portalIds: number[] }
export interface MarcaUnidade { id: number; nome: string; cor: string | null }

const CHAVE = 'financeiro:unidade:v1'

export function useUnidadesFinanceiro() {
  return useQuery({
    queryKey: ['portal-financeiro', 'unidades'],
    queryFn: () => api.get<{ unidades: UnidadeFin[] }>('/admin/educational/portal-financeiro/unidades'),
    staleTime: 5 * 60_000,
  })
}

/** Unidade escolhida ('' = todas), lembrada entre as telas e as visitas. */
export function useUnidadeEscolhida(): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try { return localStorage.getItem(CHAVE) ?? '' } catch { return '' }
  })
  const set = (novo: string) => {
    setV(novo)
    try { if (novo) localStorage.setItem(CHAVE, novo); else localStorage.removeItem(CHAVE) } catch { /* sem storage: vale só nesta visita */ }
  }
  return [v, set]
}

const corOu = (c: string | null | undefined) => c || 'var(--color-fg-muted, #64748b)'

/** Botões INEPROTEC | MATRÍCULA EAD | Todas. Some com uma unidade só. */
export function SeletorDeUnidade({ unidades, valor, onChange }: { unidades: UnidadeFin[]; valor: string; onChange: (v: string) => void }) {
  if (unidades.length < 2) return null
  const opcoes: Array<{ id: string; nome: string; cor: string | null }> = [...unidades.map((u) => ({ id: String(u.id), nome: u.nome, cor: u.cor })), { id: '', nome: 'Todas', cor: null }]
  return (
    <div role="radiogroup" aria-label="Unidade" class="inline-flex flex-wrap rounded-md border border-border overflow-hidden">
      {opcoes.map((o) => {
        const ativo = valor === o.id
        return (
          <button key={o.id || 'todas'} type="button" role="radio" aria-checked={ativo} onClick={() => onChange(o.id)}
            class={`inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold border-r border-border last:border-r-0 ${ativo ? 'text-white' : 'text-fg-muted hover:text-fg bg-surface'}`}
            style={ativo ? { background: o.cor || 'var(--color-accent, #2563eb)' } : undefined}>
            {o.cor && <span class="w-2 h-2 rounded-full" style={{ background: ativo ? '#fff' : o.cor }} aria-hidden="true" />}
            {o.nome}
          </button>
        )
      })}
    </div>
  )
}

/** Etiqueta da unidade na linha: cor + nome curto. */
export function EtiquetaUnidade({ u }: { u: MarcaUnidade | null | undefined }) {
  if (!u) return null
  return (
    <span class="inline-flex items-center gap-1 h-5 px-1.5 rounded text-2xs font-semibold whitespace-nowrap"
      style={{ color: corOu(u.cor), background: `color-mix(in srgb, ${corOu(u.cor)} 12%, transparent)` }} title={u.nome}>
      <span class="w-1.5 h-1.5 rounded-full" style={{ background: corOu(u.cor) }} aria-hidden="true" />
      {u.nome}
    </span>
  )
}

/** Portais da unidade escolhida (todos quando nenhuma). */
export function portaisDaUnidade<T extends { id: number }>(portais: T[], unidades: UnidadeFin[], valor: string): T[] {
  const u = unidades.find((x) => String(x.id) === valor)
  return u ? portais.filter((p) => u.portalIds.includes(p.id)) : portais
}
