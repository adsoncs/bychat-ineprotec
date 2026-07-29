import { useLocation } from 'wouter-preact'
import { ChevronLeft, Repeat, Undo2, MessageCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useVinculo, useEstornarMovimentacao, SITUACAO_LABEL, SITUACAO_TONE } from '@/hooks/useAcaFundacao'
import { toast } from '@/lib/toast'

// Prontuário do vínculo: quem é, em que situação está e como chegou nela.
// A linha do tempo é a prova documental — nada é apagado, o estorno entra como
// um novo evento apontando para o que desfez.

function dataHora(s: string) {
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function AcademicoVinculoDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading } = useVinculo(id)
  const estornar = useEstornarMovimentacao()

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!data?.vinculo) {
    return (
      <Page title="Vínculo não encontrado">
        <EmptyState title="Vínculo não encontrado" description="O registro pode ter sido removido." />
      </Page>
    )
  }

  const v = data.vinculo
  const movimentacoes = v.movimentacoes ?? []
  const ultima = movimentacoes[0]
  const nome = v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`

  function desfazer() {
    if (!ultima) return
    const label = `${ultima.de ? SITUACAO_LABEL[ultima.de] : '—'} → ${SITUACAO_LABEL[ultima.para]}`
    const motivo = prompt(`Estornar a última movimentação (${label})?\n\nInforme o motivo:`)
    if (motivo === null) return
    estornar.mutate(
      // exactOptionalPropertyTypes: a chave só entra quando há valor.
      { movId: ultima.id, ...(motivo ? { motivo } : {}) },
      {
        onSuccess: () => toast('Movimentação estornada — o histórico manteve os dois registros', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title={nome}
      description={`Vínculo #${v.id}${v.ra ? ` · RA ${v.ra}` : ''}`}
      actions={
        <div class="flex items-center gap-2">
          <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={() => navigate('/aca/vinculos')}>
            <ChevronLeft size={15} /> Voltar
          </button>
          <Button variant="primary" size="sm" onClick={() => navigate(`/aca/vinculos/${v.id}/mover`)}>
            <Repeat size={14} /> Movimentar situação
          </Button>
        </div>
      }
    >
      {v.sensivel && (
        <Card class="!p-3 border-warning/40 bg-warning/5 text-sm text-fg-muted">
          Vínculo marcado como <strong class="text-fg">sensível</strong>: cobrança e comunicação automática ficam suspensas.
        </Card>
      )}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card class="lg:col-span-1 space-y-3">
          <div>
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Situação</div>
            <div class="mt-1"><Badge tone={SITUACAO_TONE[v.situacao]}>{SITUACAO_LABEL[v.situacao]}</Badge></div>
          </div>
          <Campo rotulo="RA" valor={v.ra ?? v.aluno?.ra ?? '—'} />
          <Campo rotulo="CPF" valor={v.aluno?.cpf ?? '—'} />
          <Campo rotulo="Curso" valor={`#${v.courseId}`} />
          <Campo rotulo="Matriz" valor={v.matrizId ? `#${v.matrizId}` : 'não vinculada'} />
          <Campo rotulo="Forma de ingresso" valor={v.formaIngresso ?? '—'} />
          <Campo rotulo="Ingresso" valor={v.dataIngresso ? new Date(v.dataIngresso).toLocaleDateString('pt-BR') : '—'} />
          {v.dataConclusao && <Campo rotulo="Conclusão" valor={new Date(v.dataConclusao).toLocaleDateString('pt-BR')} />}
          {v.aluno?.lead?.whatsapp && (
            <a
              class="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              href={`https://wa.me/${String(v.aluno.lead.whatsapp).replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={13} /> Conversar no WhatsApp
            </a>
          )}
        </Card>

        <div class="lg:col-span-2 space-y-3">
          <Card class="!p-0 overflow-hidden">
            <div class="px-4 py-2.5 flex items-center justify-between bg-surface-2/50">
              <h2 class="text-sm font-semibold text-fg">Linha do tempo</h2>
              {ultima && ultima.de && (
                <Button size="sm" variant="ghost" onClick={desfazer} disabled={estornar.isPending}>
                  <Undo2 size={13} /> Estornar última
                </Button>
              )}
            </div>
            {movimentacoes.length === 0 ? (
              <div class="px-4 py-6 text-sm text-fg-subtle text-center">Sem movimentações registradas.</div>
            ) : (
              <ul class="divide-y divide-border">
                {movimentacoes.map((m) => (
                  <li key={m.id} class="px-4 py-2.5">
                    <div class="flex items-start justify-between gap-3 flex-wrap">
                      <div class="min-w-0">
                        <div class="text-sm text-fg flex items-center gap-1.5 flex-wrap">
                          {m.de ? <span class="text-fg-muted">{SITUACAO_LABEL[m.de]}</span> : <span class="text-fg-subtle">criação</span>}
                          <span class="text-fg-subtle">→</span>
                          <Badge tone={SITUACAO_TONE[m.para]}>{SITUACAO_LABEL[m.para]}</Badge>
                          {m.estornoDeId && <Badge tone="warning">estorno</Badge>}
                        </div>
                        {m.motivo && <div class="text-xs text-fg-muted mt-0.5">{m.motivo}</div>}
                        {m.observacao && <div class="text-[11px] text-fg-subtle mt-0.5">{m.observacao}</div>}
                      </div>
                      <div class="text-[11px] text-fg-subtle whitespace-nowrap text-right">
                        {dataHora(m.dataEfeito)}
                        {m.userName ? <div>{m.userName}</div> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card class="!p-0 overflow-hidden">
            <div class="px-4 py-2.5 bg-surface-2/50">
              <h2 class="text-sm font-semibold text-fg">Matrículas em turma ({v.matriculas?.length ?? 0})</h2>
            </div>
            {(v.matriculas ?? []).length === 0 ? (
              <div class="px-4 py-5 text-sm text-fg-subtle text-center">Nenhuma matrícula em turma vinculada.</div>
            ) : (
              <ul class="divide-y divide-border">
                {(v.matriculas ?? []).map((m) => (
                  <li key={m.id} class="px-4 py-2 flex items-center justify-between text-sm">
                    <span class="text-fg">Turma #{m.turmaId}</span>
                    <span class="flex items-center gap-2">
                      <Badge tone="neutral">{m.status}</Badge>
                      <span class="text-[11px] text-fg-subtle">{new Date(m.dataMatricula).toLocaleDateString('pt-BR')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{rotulo}</div>
      <div class="text-sm text-fg">{valor}</div>
    </div>
  )
}
