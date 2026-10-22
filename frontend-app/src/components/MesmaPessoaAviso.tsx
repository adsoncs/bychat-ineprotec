// Ficha ligada a outras da MESMA pessoa (assuntos diferentes) e valores que
// uma junção não deixou prevalecer. Backend: services/juncaoSegura.ts.

import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter-preact'
import { Link2 } from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'

interface FichaLigada { id: number; nome: string | null; etapa: string | null; funil: string | null; equipe: string | null; responsavel: string | null }
interface ValorAnterior { campo: string; valor: unknown; de: number; em: string }

const nomeDoCampo = (c: string) => c.replace(/^campo:/, '').replace(/^formulario:/, 'formulário: ')

export function MesmaPessoaAviso({ leadId, formData }: { leadId: number; formData?: unknown }) {
  const { data } = useQuery({
    queryKey: ['lead-mesma-pessoa', leadId],
    queryFn: () => api.get<{ fichas: FichaLigada[] }>(`/bychat/leads/${leadId}/mesma-pessoa`),
    staleTime: 60_000,
  })
  const [verValores, setVerValores] = useState(false)
  const fichas = data?.fichas ?? []
  const anteriores: ValorAnterior[] = Array.isArray((formData as any)?._valoresAnteriores) ? (formData as any)._valoresAnteriores : []
  if (!fichas.length && !anteriores.length) return null
  return (
    <div class="rounded-lg border border-info/30 bg-info/5 p-3 text-sm space-y-2">
      {fichas.length > 0 && (
        <div class="flex items-start gap-3">
          <Link2 size={18} class="mt-0.5 shrink-0 text-info" aria-hidden="true" />
          <div class="space-y-1">
            <strong class="text-info">Mesma pessoa em {fichas.length === 1 ? 'outra ficha' : `${fichas.length} outras fichas`}</strong>
            {fichas.map((f) => (
              <div key={f.id} class="text-xs">
                <Link href={`/app/leads/${f.id}`} class="text-info hover:underline">#{f.id} {f.nome || ''}</Link>
                <span class="text-muted"> — {f.funil || 'sem funil'}{f.etapa ? ` › ${f.etapa}` : ''}{f.equipe ? `, ${f.equipe}` : ''}{f.responsavel ? `, com ${f.responsavel}` : ''}</span>
              </div>
            ))}
            <div class="text-2xs text-muted">Assuntos diferentes: cada ficha segue no seu funil, com o seu responsável.</div>
          </div>
        </div>
      )}
      {anteriores.length > 0 && (
        <div class="text-xs">
          <button type="button" class="text-info hover:underline" onClick={() => setVerValores((v) => !v)}>
            {verValores ? 'Esconder' : 'Ver'} {anteriores.length} valor(es) anterior(es) de fichas juntadas
          </button>
          {verValores && (
            <div class="mt-1 space-y-0.5">
              {anteriores.map((v, i) => (
                <div key={i}><span class="text-muted">{nomeDoCampo(v.campo)}:</span> {typeof v.valor === 'string' ? v.valor : JSON.stringify(v.valor)} <span class="text-muted">(ficha #{v.de}, {new Date(v.em).toLocaleDateString('pt-BR')})</span></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
