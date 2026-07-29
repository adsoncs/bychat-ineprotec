import { useState } from 'preact/hooks'
import { ClipboardCheck, Check, Minus, X, Users, Info } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import {
  useListaVerificacao, useCompetenciaMut, RESULTADO, CAPACIDADE_TIPO,
  type ResultadoAfericao,
} from '@/hooks/useAcaCompetencia'

// Lista de verificação da avaliação por competências.
//
// Duas visões porque o professor trabalha das duas formas: percorrendo um aluno
// (que é o formato da lista de verificação do SENAI, com a evidência à vista) e
// fechando um critério para a turma inteira depois de uma atividade prática.

const ORDEM: ResultadoAfericao[] = ['ATENDE', 'EM_DESENVOLVIMENTO', 'NAO_ATENDE']

function BotaoResultado({
  valor, atual, onClick, compacto,
}: { valor: ResultadoAfericao; atual: ResultadoAfericao | null; onClick: () => void; compacto?: boolean }) {
  const r = RESULTADO[valor]
  const ativo = atual === valor
  const cor = ativo
    ? valor === 'ATENDE' ? 'bg-success text-fg-on-brand border-success'
      : valor === 'EM_DESENVOLVIMENTO' ? 'bg-warning text-fg-on-brand border-warning'
        : 'bg-danger text-fg-on-brand border-danger'
    : 'bg-surface-2 text-fg-muted border-border hover:bg-surface-3'
  const Icone = valor === 'ATENDE' ? Check : valor === 'EM_DESENVOLVIMENTO' ? Minus : X
  return (
    <button
      type="button" onClick={onClick} title={r.label}
      class={`border rounded-md ${compacto ? 'w-7 h-7' : 'px-2.5 h-8'} flex items-center justify-center gap-1 text-xs ${cor}`}
    >
      <Icone size={13} />
      {!compacto && <span>{r.label}</span>}
    </button>
  )
}

export function ListaVerificacaoPanel({ diarioId }: { diarioId: number }) {
  const { data, isLoading } = useListaVerificacao(diarioId)
  const mut = useCompetenciaMut()
  const [visao, setVisao] = useState<'aluno' | 'turma'>('aluno')
  const [matriculaId, setMatriculaId] = useState<number | null>(null)

  if (isLoading) return <Skeleton class="h-64 w-full mt-3" />

  if (data?.semComponente) {
    return (
      <Card class="mt-3">
        <EmptyState
          icon={<ClipboardCheck size={24} />}
          title="Disciplina fora da matriz"
          description="Este diário não está ligado a um componente da matriz da turma, então não há capacidades para verificar."
        />
      </Card>
    )
  }

  const capacidades = data?.capacidades ?? []
  const alunos = data?.alunos ?? []

  if (capacidades.length === 0) {
    return (
      <Card class="mt-3">
        <EmptyState
          icon={<ClipboardCheck size={24} />}
          title="Nenhuma capacidade cadastrada"
          description="A avaliação por competências precisa das capacidades e dos critérios definidos na matriz curricular, em rascunho."
        />
      </Card>
    )
  }

  const criterios = capacidades.flatMap((c) => c.criterios)
  const alunoAtual = alunos.find((a) => a.matriculaId === matriculaId) ?? alunos[0]

  const marcar = (criterioId: number, mid: number, resultado: ResultadoAfericao) => {
    mut.aferir.mutate({ criterioId, matriculaId: mid, resultado }, {
      onError: (e: any) => toast(e?.message ?? 'Não foi possível registrar.', 'danger'),
    })
  }

  const marcarColuna = (criterioId: number, resultado: ResultadoAfericao) => {
    const itens = alunos.map((a) => ({ criterioId, matriculaId: a.matriculaId, resultado }))
    mut.aferirLote.mutate(itens, {
      onSuccess: (r) => toast(`${r.registrados} registro(s) na turma.`, 'success'),
      onError: (e: any) => toast(e?.message ?? 'Falha no lançamento.', 'danger'),
    })
  }

  return (
    <div class="mt-3 space-y-3">
      <Card class="!p-3 text-xs text-fg-muted flex gap-2">
        <Info size={15} class="shrink-0 mt-0.5 text-fg-subtle" />
        <span>
          Critérios <strong class="text-fg">críticos</strong> decidem a aptidão: sem atendê-los o aluno não está
          apto, ainda que o resto esteja bom. Os <strong class="text-fg">desejáveis</strong> qualificam o
          desempenho. Não atendeu? Retome a capacidade e marque de novo — a tentativa anterior fica registrada.
        </span>
      </Card>

      <div class="flex items-center gap-2">
        <div class="flex gap-1 border border-border rounded-lg p-0.5">
          <button
            class={`text-xs px-2.5 py-1 rounded-md ${visao === 'aluno' ? 'bg-surface-3 text-fg' : 'text-fg-muted'}`}
            onClick={() => setVisao('aluno')}
          >Por aluno</button>
          <button
            class={`text-xs px-2.5 py-1 rounded-md ${visao === 'turma' ? 'bg-surface-3 text-fg' : 'text-fg-muted'}`}
            onClick={() => setVisao('turma')}
          >Turma inteira</button>
        </div>
        <span class="text-xs text-fg-subtle">
          {criterios.filter((k) => k.peso === 'CRITICO').length} critério(s) crítico(s) ·{' '}
          {criterios.length} no total
        </span>
      </div>

      {visao === 'aluno' ? (
        <div class="grid gap-3 lg:grid-cols-[260px_1fr]">
          {/* Alunos com o estado de cada um */}
          <Card class="p-0 overflow-hidden h-fit">
            <div class="px-3 py-2 bg-surface-2 text-xs text-fg-muted flex items-center gap-1.5">
              <Users size={13} /> {alunos.length} aluno(s)
            </div>
            <div class="divide-y divide-border max-h-[30rem] overflow-auto">
              {alunos.map((a) => (
                <button
                  key={a.matriculaId}
                  class={`w-full px-3 py-2 text-left hover:bg-surface-2 ${alunoAtual?.matriculaId === a.matriculaId ? 'bg-surface-2' : ''}`}
                  onClick={() => setMatriculaId(a.matriculaId)}
                >
                  <div class="flex items-center gap-2">
                    <span class="flex-1 text-sm text-fg truncate">{a.nome}</span>
                    {a.apto
                      ? <Badge tone="success">apto</Badge>
                      : a.semAfericao === criterios.length
                        ? <Badge tone="neutral">—</Badge>
                        : <Badge tone="warning">{a.criticosAtendidos}/{a.criticosTotal}</Badge>}
                  </div>
                  {a.nivel && <div class="text-[10px] text-fg-subtle">nível {a.nivel}</div>}
                </button>
              ))}
            </div>
          </Card>

          {/* Capacidades e critérios do aluno selecionado */}
          {!alunoAtual ? (
            <Card class="text-sm text-fg-subtle text-center py-8">Sem alunos matriculados.</Card>
          ) : (
            <div class="space-y-3">
              {capacidades.map((cap) => (
                <Card key={cap.id} class="!p-0 overflow-hidden">
                  <div class="px-4 py-2.5 bg-surface-2/50">
                    <div class="flex items-center gap-2 flex-wrap">
                      <Badge tone="neutral">{CAPACIDADE_TIPO[cap.tipo] ?? cap.tipo}</Badge>
                      <span class="text-sm font-medium text-fg">{cap.descricao}</span>
                    </div>
                  </div>
                  {cap.criterios.length === 0 ? (
                    <p class="px-4 py-3 text-xs text-fg-subtle">Nenhum critério nesta capacidade.</p>
                  ) : (
                    <ul class="divide-y divide-border">
                      {cap.criterios.map((k) => {
                        const atual = alunoAtual.resultados[String(k.id)] ?? null
                        return (
                          <li key={k.id} class="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-start gap-2">
                                <span class="text-sm text-fg">{k.descricao}</span>
                                {k.peso === 'CRITICO' && <Badge tone="danger">crítico</Badge>}
                              </div>
                              {k.evidencia && (
                                <div class="text-[11px] text-fg-subtle mt-0.5">Observar: {k.evidencia}</div>
                              )}
                            </div>
                            <div class="flex gap-1 shrink-0">
                              {ORDEM.map((v) => (
                                <BotaoResultado
                                  key={v} valor={v} atual={atual}
                                  onClick={() => marcar(k.id, alunoAtual.matriculaId, v)}
                                />
                              ))}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Turma inteira: uma coluna por critério, com lançamento em massa */
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left px-3 py-2 text-xs font-medium text-fg-muted sticky left-0 bg-surface">Aluno</th>
                {criterios.map((k) => (
                  <th key={k.id} class="px-2 py-2 text-xs font-medium text-fg-muted" title={k.descricao}>
                    <div class="flex flex-col items-center gap-1">
                      <span class={`truncate max-w-[7rem] ${k.peso === 'CRITICO' ? 'text-danger' : ''}`}>
                        {k.descricao.length > 22 ? `${k.descricao.slice(0, 22)}…` : k.descricao}
                      </span>
                      <div class="flex gap-0.5">
                        {ORDEM.map((v) => (
                          <button
                            key={v} title={`Marcar "${RESULTADO[v].label}" para a turma`}
                            class="text-[9px] px-1 rounded border border-border text-fg-subtle hover:bg-surface-3"
                            onClick={() => marcarColuna(k.id, v)}
                          >{RESULTADO[v].curto}</button>
                        ))}
                      </div>
                    </div>
                  </th>
                ))}
                <th class="px-3 py-2 text-xs font-medium text-fg-muted">Situação</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {alunos.map((a) => (
                <tr key={a.matriculaId} class="hover:bg-surface-2">
                  <td class="px-3 py-2 text-fg truncate max-w-[12rem] sticky left-0 bg-surface">{a.nome}</td>
                  {criterios.map((k) => {
                    const atual = a.resultados[String(k.id)] ?? null
                    return (
                      <td key={k.id} class="px-2 py-2">
                        <div class="flex justify-center gap-0.5">
                          {ORDEM.map((v) => (
                            <BotaoResultado
                              key={v} valor={v} atual={atual} compacto
                              onClick={() => marcar(k.id, a.matriculaId, v)}
                            />
                          ))}
                        </div>
                      </td>
                    )
                  })}
                  <td class="px-3 py-2 text-center">
                    {a.apto
                      ? <Badge tone="success">apto{a.nivel ? ` · ${a.nivel}` : ''}</Badge>
                      : <Badge tone={a.semAfericao === criterios.length ? 'neutral' : 'warning'}>
                        {a.criticosAtendidos}/{a.criticosTotal}
                      </Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {alunoAtual && visao === 'aluno' && (
        <Card class="!p-3 text-xs">
          <span class="text-fg-muted">
            <strong class="text-fg">{alunoAtual.nome}</strong>:{' '}
            {alunoAtual.apto
              ? `apto — todos os ${alunoAtual.criticosTotal} critério(s) crítico(s) atendidos${alunoAtual.nivel ? ` (nível ${alunoAtual.nivel})` : ''}.`
              : `${alunoAtual.criticosAtendidos} de ${alunoAtual.criticosTotal} crítico(s) atendidos`
                + `${alunoAtual.semAfericao > 0 ? ` · ${alunoAtual.semAfericao} critério(s) sem aferição` : ''}.`}
          </span>
        </Card>
      )}
    </div>
  )
}
