import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { GraduationCap, ChevronRight } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'
import { useVinculos, SITUACAO_LABEL, SITUACAO_TONE, type VinculoSituacao } from '@/hooks/useAcaFundacao'

// Vínculo acadêmico = a relação do aluno com um curso/matriz (o RA).
// Diferente da matrícula em turma: é aqui que mora a situação do aluno na
// instituição, e é contra a matriz deste vínculo que a integralização é medida.

const FILTROS: Array<{ id: VinculoSituacao | 'todos'; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'ATIVO', label: 'Ativos' },
  { id: 'PRE_MATRICULADO', label: 'Pré-matriculados' },
  { id: 'TRANCADO', label: 'Trancados' },
  { id: 'EVADIDO', label: 'Evadidos' },
  { id: 'FORMADO', label: 'Formados' },
]

export function AcademicoVinculosPage() {
  const [, navigate] = useLocation()
  const [situacao, setSituacao] = useState<VinculoSituacao | 'todos'>('todos')
  const { data, isLoading } = useVinculos(situacao === 'todos' ? {} : { situacao })
  const vinculos = data?.vinculos ?? []

  return (
    <Page
      title="Vínculos acadêmicos"
      description="O registro do aluno no curso: RA, matriz, situação e histórico de movimentações."
    >
      <div class="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSituacao(f.id)}
            class={cn(
              'px-2.5 py-1 rounded-full text-[0.6875rem] font-medium border',
              situacao === f.id ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-3',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton class="h-48 w-full" />
      ) : vinculos.length === 0 ? (
        <EmptyState
          title="Nenhum vínculo encontrado"
          description="O vínculo nasce na matrícula do aluno em um curso. Ajuste o filtro ou matricule um aluno."
        />
      ) : (
        <Card class="!p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-subtle text-[0.6875rem] uppercase tracking-wider">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Aluno</th>
                  <th class="text-left px-4 py-2 font-medium">RA</th>
                  <th class="text-left px-4 py-2 font-medium">Situação</th>
                  <th class="text-left px-4 py-2 font-medium">Ingresso</th>
                  <th class="text-left px-4 py-2 font-medium">Disciplinas</th>
                  <th class="text-left px-4 py-2 font-medium">Movimentações</th>
                  <th class="w-8"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {vinculos.map((v) => (
                  <tr
                    key={v.id}
                    class="hover:bg-surface-3 cursor-pointer"
                    onClick={() => navigate(`/aca/vinculos/${v.id}`)}
                  >
                    <td class="px-4 py-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <GraduationCap size={14} class="text-fg-subtle shrink-0" />
                        <span class="text-fg truncate">{v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`}</span>
                        {v.sensivel && <Badge tone="neutral">sensível</Badge>}
                      </div>
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted font-mono">{v.ra ?? v.aluno?.ra ?? '—'}</td>
                    <td class="px-4 py-2">
                      <Badge tone={SITUACAO_TONE[v.situacao]}>{SITUACAO_LABEL[v.situacao]}</Badge>
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">
                      {v.dataIngresso ? new Date(v.dataIngresso).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted tabular-nums">{v._count?.matriculas ?? 0}</td>
                    <td class="px-4 py-2 text-xs text-fg-muted tabular-nums">{v._count?.movimentacoes ?? 0}</td>
                    <td class="px-2 py-2 text-fg-subtle"><ChevronRight size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && data.total > vinculos.length && (
        <p class="text-[11px] text-fg-subtle">Exibindo {vinculos.length} de {data.total} vínculos.</p>
      )}
    </Page>
  )
}
