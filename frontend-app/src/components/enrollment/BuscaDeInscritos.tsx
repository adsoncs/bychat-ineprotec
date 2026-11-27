// Resultado da busca de inscritos na tela de portais.
//
// A busca procura em TODOS os portais que a pessoa enxerga (nome, CPF,
// telefone, e-mail, código da inscrição, RA) e agrupa por pessoa: a mesma
// pessoa pode ter várias inscrições em portais diferentes. Cada inscrição é uma
// linha clicável que abre o cadastro dela dentro do portal certo; as vivas vêm
// antes das encerradas (cancelada, expirada, transferida).
import { useLocation } from 'wouter-preact'
import { ArrowRight, GraduationCap, Loader2, Mail, Phone, IdCard, User, ExternalLink } from '@/components/ui/icon-set'
import { SeloDoPortal, identidadeDo, tinta } from '@/lib/identidadePortal'
import { STATUS_INSCRICAO, PAGAMENTO, SITUACAO_MATRICULA } from '@/components/leads/eduColumns'
import { formatDateTime, formatRelative } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { PessoaEncontrada, InscricaoEncontrada } from '@/hooks/useEnrollmentPortals'

const TOM_STATUS: Record<string, string> = {
  paid: 'success', enrolled: 'success', approved: 'success', docs_approved: 'success',
  pending: 'warning', submitted: 'info', draft: 'neutral', reviewing: 'info', docs_uploaded: 'info', docs_reviewing: 'info',
  cancelled: 'danger', expired: 'danger', rejected: 'danger', docs_rejected: 'danger', transferred: 'neutral',
}
const TOM_PAGAMENTO: Record<string, string> = { paid: 'success', pending: 'warning', overdue: 'danger', expired: 'danger', cancelled: 'neutral', refunded: 'neutral', transferred: 'neutral' }
const CLASSE_TOM: Record<string, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-accent/15 text-accent',
  neutral: 'bg-surface-3 text-fg-muted',
}

function Selo({ tom, children }: { tom: string; children: preact.ComponentChildren }) {
  return <span class={cn('inline-flex items-center rounded px-1.5 py-px text-3xs font-semibold uppercase tracking-wide whitespace-nowrap', CLASSE_TOM[tom] ?? CLASSE_TOM.neutral)}>{children}</span>
}

function telefone(v: string | null): string | null {
  if (!v) return null
  const d = v.replace(/\D/g, '')
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : v
}

/** Caminho da inscrição no portal dela. */
export const caminhoDaInscricao = (i: Pick<InscricaoEncontrada, 'portalId' | 'id'>) => `/enrollment-portals/${i.portalId}/registrations/${i.id}`

export function BuscaDeInscritos({
  termo, pessoas, total, limitado, carregando,
}: {
  termo: string
  pessoas: PessoaEncontrada[]
  total: number
  limitado?: boolean | undefined
  carregando: boolean
}) {
  const [, navigate] = useLocation()
  const nInscricoes = pessoas.reduce((n, p) => n + p.inscricoes.length, 0)

  return (
    <section class="rounded-lg border border-border bg-surface-2 overflow-hidden" aria-label="Inscritos encontrados">
      <header class="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <User size={14} class="text-fg-muted" />
        <h2 class="text-xs font-semibold text-fg">Inscritos encontrados</h2>
        {carregando && <Loader2 size={13} class="animate-spin text-fg-muted" />}
        <span class="text-2xs text-fg-muted tabular-nums">
          {total === 0 && !carregando ? `Nenhuma inscrição com "${termo}"` : `${total} ${total === 1 ? 'pessoa' : 'pessoas'} · ${nInscricoes} ${nInscricoes === 1 ? 'inscrição' : 'inscrições'}`}
        </span>
        {pessoas.length === 1 && nInscricoes === 1 && (
          <span class="ml-auto hidden sm:inline text-2xs text-fg-muted">Enter abre a inscrição</span>
        )}
      </header>

      {total === 0 && !carregando && (
        <p class="px-4 py-4 text-xs text-fg-muted">
          Procure pelo nome, CPF, telefone, e-mail, código da inscrição (ou só o final dele, ex.: <code class="font-mono">CUCF</code>) ou RA.
        </p>
      )}

      <div class="divide-y divide-border max-h-[32rem] overflow-y-auto">
        {pessoas.map((p) => {
          const vivas = p.inscricoes.filter((i) => !i.encerrada).length
          const portais = new Set(p.inscricoes.map((i) => i.portalId)).size
          return (
            <div key={p.leadId ?? p.inscricoes[0]!.id} class="px-4 py-3">
              <div class="flex items-start gap-3">
                <span class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-fg">
                  {p.nome.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-sm font-semibold text-fg">{p.nome}</span>
                    {p.aluno && (
                      <span class="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-px text-3xs font-semibold uppercase text-success">
                        <GraduationCap size={11} /> Aluno{p.aluno.ra ? ` · RA ${p.aluno.ra}` : ''}
                        {p.aluno.situacoes[0] ? ` · ${SITUACAO_MATRICULA[p.aluno.situacoes[0]] ?? p.aluno.situacoes[0]}` : ''}
                      </span>
                    )}
                    {p.inscricoes.length > 1 && (
                      <span class="text-2xs text-fg-muted">
                        {p.inscricoes.length} inscrições em {portais} {portais === 1 ? 'portal' : 'portais'}{vivas !== p.inscricoes.length ? ` · ${vivas} em andamento` : ''}
                      </span>
                    )}
                  </div>
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-muted">
                    {p.whatsapp && <span class="inline-flex items-center gap-1"><Phone size={11} />{telefone(p.whatsapp)}</span>}
                    {p.email && <span class="inline-flex items-center gap-1 truncate max-w-[16rem]"><Mail size={11} />{p.email}</span>}
                    {p.cpf && <span class="inline-flex items-center gap-1"><IdCard size={11} />{p.cpf}</span>}
                    {p.responsavel && <span>Responsável: {p.responsavel}</span>}
                    {p.leadId && (
                      <button type="button" onClick={() => navigate(`/leads/${p.leadId}`)} class="inline-flex items-center gap-1 text-accent hover:underline">
                        <ExternalLink size={11} /> Ficha do lead
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <ul class="mt-2.5 space-y-1.5 sm:pl-12">
                {p.inscricoes.map((i) => {
                  const id = identidadeDo(i.portal)
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => navigate(caminhoDaInscricao(i))}
                        class={cn(
                          'group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent/5',
                          i.encerrada ? 'border-border/60 opacity-70' : 'border-border',
                        )}
                        style={{ borderLeft: `3px solid ${id.cor}` }}
                        title={`Abrir a inscrição ${i.codigo} no portal ${i.portal?.nome ?? ''}`}
                      >
                        <SeloDoPortal icone={id.icone} cor={id.cor} imagem={id.imagem} tamanho={28} />
                        <span class="min-w-0 flex-1">
                          <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span class="truncate text-xs font-semibold text-fg">{i.portal?.nome ?? `Portal #${i.portalId}`}</span>
                            {id.empresa && (
                              <span class="rounded px-1 py-px text-3xs font-medium text-fg" style={{ background: tinta(id.cor, 18) }}>{id.empresa}</span>
                            )}
                            {i.portal && !i.portal.active && <Selo tom="neutral">Portal inativo</Selo>}
                          </span>
                          <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-fg-muted">
                            <code class="font-mono text-fg">{i.codigo}</code>
                            {i.curso && <span class="truncate max-w-[18rem]">{i.curso}</span>}
                            {i.processo && <span class="hidden md:inline truncate max-w-[14rem]">· {i.processo}</span>}
                            <span title={formatDateTime(i.criadaEm)}>· {formatRelative(i.criadaEm)}</span>
                          </span>
                        </span>
                        <span class="hidden sm:flex flex-col items-end gap-1 shrink-0">
                          <Selo tom={TOM_STATUS[i.status] ?? 'neutral'}>{STATUS_INSCRICAO[i.status] ?? i.status}</Selo>
                          <span class="flex gap-1">
                            {i.pagamento && <Selo tom={TOM_PAGAMENTO[i.pagamento] ?? 'neutral'}>Pgto: {PAGAMENTO[i.pagamento] ?? i.pagamento}</Selo>}
                            {i.contratoAceito && <Selo tom="success">Contrato ✓</Selo>}
                          </span>
                        </span>
                        <ArrowRight size={14} class="shrink-0 text-fg-muted group-hover:text-accent" />
                      </button>
                      {/* No celular os selos vão para baixo da linha. */}
                      <span class="mt-1 flex flex-wrap gap-1 sm:hidden pl-1">
                        <Selo tom={TOM_STATUS[i.status] ?? 'neutral'}>{STATUS_INSCRICAO[i.status] ?? i.status}</Selo>
                        {i.pagamento && <Selo tom={TOM_PAGAMENTO[i.pagamento] ?? 'neutral'}>Pgto: {PAGAMENTO[i.pagamento] ?? i.pagamento}</Selo>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {limitado && (
        <p class="border-t border-border px-4 py-2 text-2xs text-fg-muted">Muitos resultados: mostrando os mais relevantes. Refine com sobrenome, CPF ou código.</p>
      )}
    </section>
  )
}
