// Andamento do aluno no Moodle para a equipe (ficha da inscrição › Moodle).
// O mesmo conteúdo da aba AVA do Meu Portal (portal-app/AvaProgresso.tsx):
// progresso, requisitos para concluir, avaliações e disciplinas.
// Backend: services/moodleProgresso.ts (GET /api/admin/moodle/inscricao/:id/progresso).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { CheckCircle2, ExternalLink, RefreshCw } from '@/components/ui/icon-set'

type SituacaoAvaliacao = 'aprovado' | 'reprovado' | 'feita' | 'pendente' | 'bloqueada'
interface Avaliacao {
  cmid: number; nome: string; tipo: 'final' | 'modulo' | 'disciplina' | 'simulado'; requisito: boolean
  situacao: SituacaoAvaliacao; nota: number | null; notaMax: number | null; notaMinima: number | null; enviadaEm: string | null
  tentativasUsadas: number | null; tentativasMax: number | null; abre: string | null; fecha: string | null; regra: string | null
}
export interface ProgressoAva {
  curso: { id: number; nome: string; url: string }
  progresso: number | null
  atividades: { feitas: number; total: number }
  ultimoAcesso: string | null
  concluido: boolean
  concluidoEm: string | null
  regraConclusao: 'todos' | 'qualquer' | null
  requisitos: Array<{ titulo: string; detalhe: string; cumprido: boolean; em: string | null }>
  avaliacoes: Avaliacao[]
  disciplinas: Array<{ nome: string; feitas: number; total: number }>
  atualizadoEm: string
}

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
const nota = (n: number | null) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const nomeLimpo = (s: string) => s.replace(/^avalia[cç][aã]o\s*[-–:]\s*/i, '').replace(/\s*\(copiado\)/gi, '').trim()
const SITUACAO: Record<SituacaoAvaliacao, { rotulo: string; tom: 'success' | 'danger' | 'info' | 'warning' | 'neutral' }> = {
  aprovado: { rotulo: 'Aprovado', tom: 'success' },
  reprovado: { rotulo: 'Não atingiu a nota', tom: 'danger' },
  feita: { rotulo: 'Feita', tom: 'info' },
  pendente: { rotulo: 'Disponível', tom: 'warning' },
  bloqueada: { rotulo: 'Não liberada', tom: 'neutral' },
}
function tentativas(a: Avaliacao): string | null {
  if (a.tentativasMax == null || a.tentativasUsadas == null) return a.tentativasMax ? `até ${a.tentativasMax} tentativas` : null
  if (a.tentativasMax === 0) return `${a.tentativasUsadas} tentativa(s), sem limite`
  const r = Math.max(0, a.tentativasMax - a.tentativasUsadas)
  return `${a.tentativasUsadas} de ${a.tentativasMax} tentativas · ${r} restante(s)`
}

export const chaveDoProgresso = (registrationId: number) => ['moodle-progresso', registrationId]

export function useProgressoAva(registrationId: number, ativo: boolean) {
  return useQuery({
    queryKey: chaveDoProgresso(registrationId),
    queryFn: () => api.get<{ progresso: ProgressoAva | null }>(`/admin/moodle/inscricao/${registrationId}/progresso`).then((r) => r.progresso),
    enabled: ativo,
    staleTime: 5 * 60_000,
  })
}

/** Linha curta para o cartão: barra + % + situação da final. */
export function ResumoDoProgresso({ p }: { p: ProgressoAva }) {
  const pct = p.progresso ?? 0
  const final = p.avaliacoes.find((a) => a.tipo === 'final') ?? [...p.avaliacoes].reverse().find((a) => a.tipo === 'modulo')
  return (
    <div class="space-y-1">
      <div class="flex items-center gap-2 text-xs">
        <div class="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden"><div class="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} /></div>
        <span class="tabular-nums font-semibold text-fg">{pct}%</span>
      </div>
      <div class="text-2xs text-fg-muted">
        {p.concluido ? <span class="text-success font-medium">Curso concluído{p.concluidoEm ? ` em ${dia(p.concluidoEm)}` : ''}</span> : `${p.atividades.feitas} de ${p.atividades.total} atividades`}
        {final && !p.concluido ? ` · ${final.tipo === 'final' ? 'Final do curso' : 'Última avaliação'}: ${SITUACAO[final.situacao].rotulo.toLowerCase()}` : ''}
        {p.ultimoAcesso ? ` · último acesso ${dia(p.ultimoAcesso)}` : ' · nunca acessou'}
      </div>
    </div>
  )
}

export function ProgressoAvaPainel({ registrationId }: { registrationId: number }) {
  const qc = useQueryClient()
  const q = useProgressoAva(registrationId, true)
  async function atualizar() {
    const r = await api.get<{ progresso: ProgressoAva | null }>(`/admin/moodle/inscricao/${registrationId}/progresso?forcar=1`)
    qc.setQueryData(chaveDoProgresso(registrationId), r.progresso)
  }
  if (q.isLoading) return <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-10 w-full" />)}</div>
  if (q.isError) return <div class="text-sm text-danger">Não foi possível ler o andamento no Moodle: {(q.error as Error).message}</div>
  const p = q.data
  if (!p) return <div class="text-sm text-fg-muted">O aluno ainda não tem acesso liberado no Moodle.</div>
  const pct = p.progresso ?? 0
  const final = p.avaliacoes.find((a) => a.tipo === 'final' && a.requisito) ?? p.avaliacoes.find((a) => a.tipo === 'final')
    ?? [...p.avaliacoes].reverse().find((a) => a.tipo === 'modulo')
  const simulados = p.avaliacoes.filter((a) => a.tipo === 'simulado')
  const lista = p.avaliacoes.filter((a) => a !== final && a.tipo !== 'simulado')

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="text-sm font-semibold text-fg flex-1 min-w-0 truncate">{p.curso.nome}</div>
        {p.concluido ? <Badge tone="success">Concluído{p.concluidoEm ? ` em ${dia(p.concluidoEm)}` : ''}</Badge> : <Badge tone="info">Em andamento</Badge>}
        <a class="inline-flex items-center gap-1 text-xs text-accent hover:underline" href={p.curso.url} target="_blank" rel="noopener"><ExternalLink size={12} /> Abrir no Moodle</a>
      </div>

      <div>
        <div class="flex items-baseline gap-3 mb-1.5">
          <span class="text-2xl font-semibold tabular-nums text-accent">{pct}%</span>
          <span class="text-xs text-fg-muted">{p.atividades.feitas} de {p.atividades.total} atividades · último acesso {dia(p.ultimoAcesso)}</span>
        </div>
        <div class="h-2 rounded-full bg-surface-3 overflow-hidden"><div class="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} /></div>
      </div>

      {p.requisitos.length === 0 && (
        <div class="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-fg">
          Este curso não tem critérios de conclusão configurados no Moodle: o progresso aparece, mas o "curso concluído" não é detectado. O administrador do AVA configura em Curso › Conclusão do curso.
        </div>
      )}
      {p.requisitos.length > 0 && (
        <div>
          <div class="text-2xs uppercase tracking-wider text-fg-muted mb-1.5">Para concluir ({p.regraConclusao === 'qualquer' ? 'basta um' : 'todos'})</div>
          <ul class="space-y-1.5">
            {p.requisitos.map((r, i) => (
              <li key={i} class="flex items-start gap-2 text-sm">
                <CheckCircle2 size={15} class={`mt-0.5 shrink-0 ${r.cumprido ? 'text-success' : 'text-fg-subtle opacity-40'}`} />
                <span class="flex-1 min-w-0"><span class="text-fg">{r.titulo}</span><span class="block text-2xs text-fg-muted">{r.detalhe}</span></span>
                <Badge tone={r.cumprido ? 'success' : 'warning'}>{r.cumprido ? `Cumprido ${dia(r.em)}` : 'Pendente'}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {final && (
        <div class={`rounded-lg border-2 p-3 ${final.situacao === 'aprovado' ? 'border-success/60' : 'border-accent/60'}`}>
          <div class="text-2xs uppercase tracking-wider text-accent mb-1">{final.tipo === 'final' ? 'Etapa final do curso' : 'Última avaliação'}</div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-fg flex-1">{nomeLimpo(final.nome)}</span>
            <Badge tone={SITUACAO[final.situacao].tom}>{SITUACAO[final.situacao].rotulo}</Badge>
          </div>
          <div class="text-xs text-fg-muted mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>Nota <b class="text-fg">{nota(final.nota)}</b>{final.notaMax ? ` de ${nota(final.notaMax)}` : ''}</span>
            {final.notaMinima != null && <span>Mínimo para aprovar <b class="text-fg">{nota(final.notaMinima)}</b></span>}
            {tentativas(final) && <span>{tentativas(final)}</span>}
            {final.fecha && <span>Aberta até <b class="text-fg">{dia(final.fecha)}</b></span>}
            {final.regra && final.situacao === 'bloqueada' && <span>{final.regra}</span>}
          </div>
        </div>
      )}

      {simulados.length > 0 && <div class="text-xs text-fg-muted">Simulados (treino): {simulados.filter((a) => a.situacao !== 'pendente' && a.situacao !== 'bloqueada').length} de {simulados.length} feitos</div>}
      {lista.length > 0 && (
        <div class="rounded-lg border border-border overflow-hidden">
          <div class="hidden sm:grid grid-cols-[minmax(0,1fr)_5rem_9rem] gap-3 px-3 py-2 bg-surface-2 text-2xs uppercase tracking-wider text-fg-muted">
            <span>Avaliação</span><span class="text-right">Nota</span><span>Situação</span>
          </div>
          <ul class="divide-y divide-border">
            {lista.map((a) => (
              <li key={a.cmid} class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_5rem_9rem] gap-x-3 gap-y-1 px-3 py-2 items-center">
                <div class="min-w-0">
                  <div class={`text-sm truncate ${a.tipo === 'modulo' ? 'font-semibold text-fg' : 'text-fg'}`}>{nomeLimpo(a.nome)}</div>
                  <div class="text-2xs text-fg-muted">
                    {a.tipo === 'modulo' ? 'Avaliação de módulo' : 'Disciplina'}
                    {a.notaMinima != null ? ` · mínimo ${nota(a.notaMinima)}` : ''}
                    {a.enviadaEm ? ` · enviada ${dia(a.enviadaEm)}` : ''}
                    {a.situacao !== 'aprovado' && tentativas(a) ? ` · ${tentativas(a)}` : ''}
                    {a.situacao === 'bloqueada' && a.regra ? ` · ${a.regra}` : ''}
                  </div>
                </div>
                <div class="text-right tabular-nums text-sm font-semibold">{nota(a.nota)}</div>
                <div class="col-span-2 sm:col-span-1"><Badge tone={SITUACAO[a.situacao].tom}>{SITUACAO[a.situacao].rotulo}</Badge></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.disciplinas.length > 0 && (
        <div>
          <div class="text-2xs uppercase tracking-wider text-fg-muted mb-1.5">Conteúdo por disciplina</div>
          <ul class="grid gap-1.5 sm:grid-cols-2">
            {p.disciplinas.map((d, i) => {
              const v = d.total ? Math.round((d.feitas / d.total) * 100) : 0
              return (
                <li key={i} class="flex items-center gap-2 text-xs">
                  <span class="flex-1 min-w-0 truncate text-fg" title={d.nome}>{d.nome}</span>
                  <span class="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden"><span class="block h-full bg-accent" style={{ width: `${v}%` }} /></span>
                  <span class="w-10 text-right tabular-nums text-fg-muted">{d.feitas}/{d.total}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div class="flex items-center justify-between text-2xs text-fg-muted">
        <span>Lido do Moodle em {new Date(p.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <Button variant="ghost" size="sm" onClick={() => void atualizar()}><RefreshCw size={12} /> Atualizar</Button>
      </div>
    </div>
  )
}
