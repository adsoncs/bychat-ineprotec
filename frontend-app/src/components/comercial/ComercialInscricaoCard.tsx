// Detalhe da inscrição › Comercial: a proposta ligada (Negociações), o
// vendedor e a comissão (Fase 3 da integração com o Educacional).
import { Link } from 'wouter-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useComercialDaInscricao } from '@/hooks/useComercial'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ComercialInscricaoCard({ registrationId }: { registrationId: number }) {
  const { data } = useComercialDaInscricao(registrationId)
  if (!data) return null
  const p = data.proposta
  return (
    <Card>
      <div class="text-sm font-semibold mb-2">Comercial</div>
      <div class="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
        <span class="text-fg-muted">Vendedor</span><span>{data.vendedor ?? '—'}</span>
        <span class="text-fg-muted">Proposta</span>
        <span>
          {p ? (
            <>
              <Link href={`/app/leads/${p.leadId}`} class="text-info hover:underline">{p.titulo}</Link>{' '}
              <Badge tone={p.resultado === 'won' ? 'success' : p.resultado === 'lost' ? 'danger' : 'info'}>{p.resultado === 'won' ? 'ganha' : p.resultado === 'lost' ? 'perdida' : 'aberta'}</Badge>
              <div class="text-fg-muted">{brl(p.valorFinal)}{p.fechadaEm ? ` · ${new Date(p.fechadaEm).toLocaleDateString('pt-BR')}` : ''}{p.origem === 'portal' ? ' · gerada pela inscrição' : ''}</div>
            </>
          ) : <span class="text-fg-muted">Nenhuma (ligue "Inscrição vira proposta" na aba Comercial do portal)</span>}
        </span>
        <span class="text-fg-muted">Comissão</span>
        <span>{data.comissao ? `${brl(data.comissao.valor)} · ${data.comissao.status} · ${data.comissao.competencia}` : '—'}</span>
      </div>
    </Card>
  )
}
