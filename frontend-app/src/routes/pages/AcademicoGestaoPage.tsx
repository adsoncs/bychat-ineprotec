import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  Users, GraduationCap, Wallet, AlertTriangle, TrendingDown, BookOpen,
  Inbox, FileCheck2, Archive, HeartPulse, Percent,
} from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { useBiDirecao, useBiCoordenacao, useBiSecretaria, FAIXA } from '@/hooks/useAcaInteligencia'
import { money } from '@/hooks/useAcaBi'

// BI por persona. O mesmo acervo de dados lido por três perguntas diferentes:
// a direção quer saber se o semestre fecha, a coordenação onde intervir na
// turma, e a secretaria o que está na fila hoje.

const PERSONAS = [
  { id: 'direcao', label: 'Direção', ajuda: 'O semestre fecha?' },
  { id: 'coordenacao', label: 'Coordenação', ajuda: 'Onde intervir na turma?' },
  { id: 'secretaria', label: 'Secretaria', ajuda: 'O que está na fila hoje?' },
] as const

type Persona = (typeof PERSONAS)[number]['id']

function Kpi({ icon, label, value, hint, tone }: { icon: any; label: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <Card class="space-y-1">
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icon}<span>{label}</span></div>
      <div class={`text-2xl font-semibold ${tone ?? 'text-fg'}`}>{value}</div>
      {hint && <div class="text-[11px] text-fg-subtle">{hint}</div>}
    </Card>
  )
}

export function AcademicoGestaoPage() {
  const [, navigate] = useLocation()
  const [persona, setPersona] = useState<Persona>('direcao')
  const direcao = useBiDirecao(persona === 'direcao')
  const coordenacao = useBiCoordenacao(null, persona === 'coordenacao')
  const secretaria = useBiSecretaria(persona === 'secretaria')

  return (
    <Page
      title="Painel de gestão"
      description="Cada papel enxerga o número que a decisão dele exige."
    >
      <div class="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${persona === p.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
            onClick={() => setPersona(p.id)}
          >
            {p.label}
            <span class="ml-1.5 text-[11px] text-fg-subtle hidden sm:inline">{p.ajuda}</span>
          </button>
        ))}
      </div>

      {persona === 'direcao' && (
        direcao.isLoading || !direcao.data ? <Skeleton class="h-64 w-full" /> : (
          <div class="space-y-4">
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={<Users size={14} />} label="Alunos ativos" value={direcao.data.alunos.ativos} />
              <Kpi
                icon={<TrendingDown size={14} />} label="Em risco de evasão" value={direcao.data.risco.emRisco}
                tone={direcao.data.risco.emRisco > 0 ? 'text-warning' : 'text-fg'}
                hint="Score 50 ou mais."
              />
              <Kpi
                icon={<Percent size={14} />} label="Inadimplência" value={`${direcao.data.financeiro.inadimplenciaPct}%`}
                tone={direcao.data.financeiro.inadimplenciaPct >= 15 ? 'text-danger' : 'text-fg'}
                hint="Vencido sobre recebido + vencido."
              />
              <Kpi icon={<GraduationCap size={14} />} label="Formados" value={direcao.data.alunos.formados} />
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card class="space-y-2">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Wallet size={15} /> Financeiro</h2>
                {[
                  ['Recebido', direcao.data.financeiro.recebidoCentavos, 'text-success'],
                  ['A vencer', direcao.data.financeiro.aVencerCentavos, 'text-fg'],
                  ['Vencido', direcao.data.financeiro.vencidoCentavos, 'text-danger'],
                ].map(([label, v, cor]) => (
                  <div key={String(label)} class="flex items-center justify-between text-sm">
                    <span class="text-fg-muted">{label}</span>
                    <span class={`font-medium ${cor}`}>{money(Number(v))}</span>
                  </div>
                ))}
              </Card>

              <Card class="space-y-2">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Users size={15} /> Situação dos vínculos</h2>
                {[
                  ['Ativos', direcao.data.alunos.ativos],
                  ['Formados', direcao.data.alunos.formados],
                  ['Trancados', direcao.data.alunos.trancados],
                  ['Evadidos', direcao.data.alunos.evadidos],
                ].map(([label, v]) => (
                  <div key={String(label)} class="flex items-center justify-between text-sm">
                    <span class="text-fg-muted">{label}</span>
                    <span class="text-fg font-medium">{v}</span>
                  </div>
                ))}
              </Card>

              <Card class="space-y-2">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><AlertTriangle size={15} /> Risco por faixa</h2>
                {(['CRITICO', 'ALTO', 'MEDIO', 'BAIXO'] as const).map((k) => (
                  <div key={k} class="flex items-center justify-between text-sm">
                    <span class="text-fg-muted flex items-center gap-2">
                      <span class={`w-2 h-2 rounded-full ${FAIXA[k]!.barra}`} /> {FAIXA[k]!.label}
                    </span>
                    <span class="text-fg font-medium">{direcao.data.risco.porFaixa?.[k] ?? 0}</span>
                  </div>
                ))}
              </Card>
            </div>

            {direcao.data.risco.prioridade.length > 0 && (
              <Card class="p-0 overflow-hidden">
                <div class="px-4 py-2.5 border-b border-border flex items-center justify-between">
                  <span class="text-sm font-medium text-fg">Prioridade de retenção</span>
                  <button class="text-xs text-accent hover:underline" onClick={() => navigate('/aca/evasao')}>Ver painel completo</button>
                </div>
                <div class="divide-y divide-border">
                  {direcao.data.risco.prioridade.map((r) => (
                    <button
                      key={r.vinculoId}
                      class="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2 text-left"
                      onClick={() => navigate(`/aca/vinculos/${r.vinculoId}`)}
                    >
                      <span class="w-8 text-right font-mono text-sm text-fg">{r.score}</span>
                      <span class="flex-1 text-sm text-fg truncate">{r.nome}</span>
                      <span class="text-xs text-fg-subtle truncate max-w-[50%] hidden sm:block">{r.acaoSugerida}</span>
                      <Badge tone={FAIXA[r.faixa]?.tone ?? 'neutral'}>{FAIXA[r.faixa]?.label ?? r.faixa}</Badge>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )
      )}

      {persona === 'coordenacao' && (
        coordenacao.isLoading || !coordenacao.data ? <Skeleton class="h-64 w-full" /> : (
          <div class="space-y-4">
            <Card class="p-0 overflow-x-auto">
              <div class="px-4 py-2.5 border-b border-border text-sm font-medium text-fg flex items-center gap-2">
                <BookOpen size={15} /> Disciplinas por reprovação
              </div>
              {coordenacao.data.disciplinas.length === 0 ? (
                <p class="px-4 py-6 text-sm text-fg-subtle text-center">Nenhum resultado lançado ainda.</p>
              ) : (
                <table class="w-full text-sm">
                  <thead class="text-xs text-fg-muted border-b border-border">
                    <tr>
                      <th class="text-left px-4 py-2 font-medium">Disciplina</th>
                      <th class="text-right px-4 py-2 font-medium">Alunos</th>
                      <th class="text-right px-4 py-2 font-medium">Reprovação</th>
                      <th class="text-right px-4 py-2 font-medium">Média</th>
                      <th class="text-right px-4 py-2 font-medium">Frequência</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    {coordenacao.data.disciplinas.map((d) => (
                      <tr key={d.disciplinaId} class="hover:bg-surface-2">
                        <td class="px-4 py-2 text-fg">{d.nome}</td>
                        <td class="px-4 py-2 text-right text-fg-muted">{d.alunos}</td>
                        <td class="px-4 py-2 text-right">
                          <span class={d.reprovacaoPct >= 30 ? 'text-danger font-medium' : d.reprovacaoPct >= 15 ? 'text-warning' : 'text-fg-muted'}>
                            {d.reprovacaoPct}%
                          </span>
                        </td>
                        <td class="px-4 py-2 text-right text-fg-muted">{d.mediaTurma ?? '—'}</td>
                        <td class="px-4 py-2 text-right">
                          <span class={d.frequenciaMedia < 75 ? 'text-danger font-medium' : 'text-fg-muted'}>{d.frequenciaMedia}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card class="p-0 overflow-hidden">
              <div class="px-4 py-2.5 border-b border-border text-sm font-medium text-fg flex items-center gap-2">
                <TrendingDown size={15} /> Alunos em risco no curso
              </div>
              {coordenacao.data.alunosEmRisco.length === 0 ? (
                <p class="px-4 py-6 text-sm text-fg-subtle text-center">Nenhum aluno acima do limiar de risco.</p>
              ) : (
                <div class="divide-y divide-border">
                  {coordenacao.data.alunosEmRisco.map((r) => (
                    <button
                      key={r.vinculoId}
                      class="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2 text-left"
                      onClick={() => navigate(`/aca/vinculos/${r.vinculoId}`)}
                    >
                      <span class="w-8 text-right font-mono text-sm text-fg">{r.score}</span>
                      <span class="flex-1 text-sm text-fg truncate">{r.nome}</span>
                      <span class="text-xs text-fg-subtle truncate max-w-[45%] hidden sm:block">
                        {r.fatores[0]?.detalhe ?? ''}
                      </span>
                      <Badge tone={FAIXA[r.faixa]?.tone ?? 'neutral'}>{FAIXA[r.faixa]?.label ?? r.faixa}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      )}

      {persona === 'secretaria' && (
        secretaria.isLoading || !secretaria.data ? <Skeleton class="h-48 w-full" /> : (
          <div class="space-y-4">
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi
                icon={<Inbox size={14} />} label="Requerimentos abertos" value={secretaria.data.requerimentos.abertos}
                hint={secretaria.data.requerimentos.atrasados > 0 ? `${secretaria.data.requerimentos.atrasados} fora do prazo` : 'Todos dentro do prazo.'}
                tone={secretaria.data.requerimentos.atrasados > 0 ? 'text-danger' : 'text-fg'}
              />
              <Kpi
                icon={<BookOpen size={14} />} label="Diários pendentes" value={secretaria.data.diarios.pendentes}
                hint={`${secretaria.data.diarios.fechados} de ${secretaria.data.diarios.total} fechados.`}
                tone={secretaria.data.diarios.pendentes > 0 ? 'text-warning' : 'text-fg'}
              />
              <Kpi
                icon={<FileCheck2 size={14} />} label="Documentos a conferir" value={secretaria.data.documentos.aConferir}
              />
              <Kpi
                icon={<HeartPulse size={14} />} label="Regimes a analisar" value={secretaria.data.regimesEspeciais.aguardandoAnalise}
                tone={secretaria.data.regimesEspeciais.aguardandoAnalise > 0 ? 'text-warning' : 'text-fg'}
                hint="Enquanto não deferir, o aluno acumula falta."
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card class="space-y-2">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Archive size={15} /> Acervo</h2>
                <div class="flex items-center justify-between text-sm">
                  <span class="text-fg-muted">Sem classificação</span>
                  <span class={secretaria.data.documentos.acervoSemClassificacao > 0 ? 'text-warning font-medium' : 'text-fg'}>
                    {secretaria.data.documentos.acervoSemClassificacao}
                  </span>
                </div>
                <button class="text-xs text-accent hover:underline" onClick={() => navigate('/aca/acervo')}>Abrir acervo</button>
              </Card>
              <Card class="space-y-2">
                <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Inbox size={15} /> Requerimentos</h2>
                <div class="flex items-center justify-between text-sm">
                  <span class="text-fg-muted">Total registrado</span>
                  <span class="text-fg font-medium">{secretaria.data.requerimentos.total}</span>
                </div>
                <button class="text-xs text-accent hover:underline" onClick={() => navigate('/aca/requerimentos')}>Abrir fila</button>
              </Card>
            </div>
          </div>
        )
      )}
    </Page>
  )
}
