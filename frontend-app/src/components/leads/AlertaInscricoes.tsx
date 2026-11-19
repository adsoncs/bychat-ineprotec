// Alerta de matrícula já cadastrada, na conversa e na ficha do lead.
//
// Mostra as inscrições ATIVAS da pessoa — desta ficha e das ligadas a ela
// (possível duplicado, mesmo telefone, mesmo CPF). Caso que motivou
// (ineprotec, 19/11): a inscrição do portal nasceu numa ficha duplicada, a
// conversa de quem atendia não mostrava nada, e veio uma segunda matrícula à mão.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { AlertTriangle, ChevronDown, ExternalLink } from '@/components/ui/icon-set'
import { useInscricoesAtivas, type InscricaoAtivaDoContato } from '@/hooks/useLeads'
import { STATUS_INSCRICAO, PAGAMENTO } from '@/components/leads/eduColumns'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/cn'

const LIGACAO: Record<InscricaoAtivaDoContato['ligacao'], string | null> = {
  esta_ficha: null,
  ficha_principal: 'na ficha principal deste contato',
  possivel_duplicado: 'numa ficha duplicada deste contato',
  mesmo_telefone: 'em outra ficha com o mesmo telefone',
  mesmo_cpf: 'em outra ficha com o mesmo CPF',
}

export function AlertaInscricoes({ leadId, class: className }: { leadId: number | null | undefined; class?: string }) {
  const { data } = useInscricoesAtivas(leadId)
  const [, navigate] = useLocation()
  const [aberto, setAberto] = useState(false)
  // As de OUTRA ficha primeiro: são as que ninguém vê na conversa (o caso que motivou).
  const lista = [...(data?.inscricoes ?? [])].sort((a, b) => Number(a.ligacao === 'esta_ficha') - Number(b.ligacao === 'esta_ficha'))
  if (!lista.length) return null
  const outraFicha = lista.some((i) => i.ligacao !== 'esta_ficha')
  const mostrar = aberto ? lista : lista.slice(0, 1)

  return (
    <div role="status" class={cn('border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg', className)}>
      <div class="flex items-start gap-2">
        <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1">
          <div class="font-semibold">
            {lista.length === 1 ? 'Este contato já tem uma inscrição' : `Este contato já tem ${lista.length} inscrições`}
            {outraFicha && <span class="font-normal text-fg-muted"> · atenção: há inscrição em outra ficha</span>}
            <span class="font-normal text-fg-muted"> — confira antes de fazer outra matrícula.</span>
          </div>
          <ul class="mt-1 grid gap-1">
            {mostrar.map((i) => (
              <li key={i.id} class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <button type="button" class="inline-flex items-center gap-1 font-mono font-semibold text-accent hover:underline"
                  onClick={() => navigate(`/enrollment-portals/${i.portalId}/registrations/${i.id}`)} title="Abrir a inscrição">
                  {i.codigo} <ExternalLink size={11} />
                </button>
                <span class="text-fg-muted truncate max-w-[22rem]">{[i.curso, i.portal].filter(Boolean).join(' · ')}</span>
                <span class="rounded bg-surface-3 px-1.5 py-px text-3xs font-semibold uppercase">{STATUS_INSCRICAO[i.status] ?? i.status}</span>
                {i.pagamento && <span class="rounded bg-surface-3 px-1.5 py-px text-3xs font-semibold uppercase">Pgto: {PAGAMENTO[i.pagamento] ?? i.pagamento}</span>}
                <span class="text-fg-muted">{i.vendedor ? `vendedor(a) ${i.vendedor} · ` : ''}{formatRelative(i.criadaEm)}</span>
                {LIGACAO[i.ligacao] && <span class="font-medium text-warning">{LIGACAO[i.ligacao]}</span>}
              </li>
            ))}
          </ul>
        </div>
        {lista.length > 1 && (
          <button type="button" class="shrink-0 inline-flex items-center gap-1 text-fg-muted hover:text-fg" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
            {aberto ? 'Menos' : `Ver as ${lista.length}`} <ChevronDown size={12} class={cn('transition-transform', aberto && 'rotate-180')} />
          </button>
        )}
      </div>
    </div>
  )
}
