import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Award, FileCheck2, AlertTriangle, CalendarClock, Check, ExternalLink, GraduationCap, Users } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import {
  useQualificacoesAEmitir, useQualificacaoMut,
  useConformidadeSistec, useSistecMut, useConformidadeLatoSensu,
} from '@/hooks/useAcaQualificacao'

// Certificação intermediária + conformidade com o SISTEC.
//
// As duas coisas convivem aqui porque são a mesma rotina da secretaria da escola
// técnica: fechar o mês no SISTEC e entregar o que o aluno já tem direito de
// receber.

const ABAS = [
  { id: 'qualificacoes', label: 'Certificados a emitir' },
  { id: 'sistec', label: 'Conformidade SISTEC' },
  { id: 'lato', label: 'Pós lato sensu' },
] as const

type Aba = (typeof ABAS)[number]['id']

export function AcademicoQualificacoesPage() {
  const [, navigate] = useLocation()
  const [aba, setAba] = useState<Aba>('qualificacoes')

  const fila = useQualificacoesAEmitir()
  const mut = useQualificacaoMut()
  const conf = useConformidadeSistec()
  const sistec = useSistecMut()
  const lato = useConformidadeLatoSensu()

  const [selecao, setSelecao] = useState<string[]>([])
  const [selSistec, setSelSistec] = useState<number[]>([])

  const chave = (q: { vinculoId: number; moduloId: number }) => `${q.vinculoId}:${q.moduloId}`
  const lista = fila.data?.lista ?? []

  const emitirSelecionados = () => {
    const itens = lista
      .filter((q) => selecao.includes(chave(q)))
      .map((q) => ({ vinculoId: q.vinculoId, moduloId: q.moduloId }))
    if (itens.length === 0) return
    mut.emitirLote.mutate(itens, {
      onSuccess: (r) => {
        setSelecao([])
        toast(
          `${r.emitidos} certificado(s) emitido(s).${r.erros.length > 0 ? ` ${r.erros.length} falharam.` : ''}`,
          r.emitidos > 0 ? 'success' : 'danger',
        )
      },
      onError: (e: any) => toast(e?.message ?? 'Falha na emissão.', 'danger'),
    })
  }

  const aplicarIntegralizando = () => {
    if (selSistec.length === 0) return
    sistec.aplicarIntegralizando.mutate(selSistec, {
      onSuccess: (r) => {
        setSelSistec([])
        toast(`${r.ajustados} vínculo(s) marcados como "Integralizar em Fase Escolar".`, 'success')
      },
      onError: (e: any) => toast(e?.message ?? 'Falha ao ajustar.', 'danger'),
    })
  }

  const p = conf.data?.prazo

  return (
    <Page
      title="Qualificação profissional"
      description="Certificados de etapa com terminalidade e o fechamento mensal do SISTEC."
      actions={
        aba === 'qualificacoes' && selecao.length > 0 ? (
          <Button onClick={emitirSelecionados} disabled={mut.emitirLote.isPending}>
            <Award size={16} /> Emitir {selecao.length} certificado(s)
          </Button>
        ) : aba === 'sistec' && selSistec.length > 0 ? (
          <Button onClick={aplicarIntegralizando} disabled={sistec.aplicarIntegralizando.isPending}>
            <Check size={16} /> Aplicar em {selSistec.length}
          </Button>
        ) : undefined
      }
    >
      {/* Prazo do SISTEC aparece nas duas abas: é a data que não pode passar. */}
      {p && (
        <Card class={`!p-3 mb-4 text-sm flex items-start gap-2 ${p.vencido ? 'border-danger/40 bg-danger/5' : p.alerta ? 'border-warning/40 bg-warning/5' : ''}`}>
          <CalendarClock size={16} class={`shrink-0 mt-0.5 ${p.vencido ? 'text-danger' : p.alerta ? 'text-warning' : 'text-fg-subtle'}`} />
          <span class="text-fg-muted">
            Competência <strong class="text-fg">{p.competencia}</strong> — o registro no SISTEC vai até{' '}
            <strong class="text-fg">{new Date(p.limite).toLocaleDateString('pt-BR')}</strong>
            {p.vencido
              ? ' · prazo VENCIDO. Registrar agora conta no mês errado e distorce os indicadores da unidade.'
              : ` · faltam ${p.diasRestantes} dia(s).`}
          </span>
        </Card>
      )}

      <div class="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {ABAS.map((t) => (
          <button
            key={t.id}
            class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
            onClick={() => setAba(t.id)}
          >
            {t.label}
            {t.id === 'qualificacoes' && (fila.data?.total ?? 0) > 0 && (
              <span class="ml-1.5 text-[10px] rounded-full bg-accent/15 text-accent px-1.5 py-0.5">{fila.data?.total}</span>
            )}
            {t.id === 'lato' && (lato.data?.resumo?.comImpedimento ?? 0) > 0 && (
              <span class="ml-1.5 text-[10px] rounded-full bg-danger/15 text-danger px-1.5 py-0.5">
                {lato.data?.resumo?.comImpedimento}
              </span>
            )}
            {t.id === 'sistec' && (conf.data?.integralizandoEmFaseEscolar.aAjustar.length ?? 0) > 0 && (
              <span class="ml-1.5 text-[10px] rounded-full bg-warning/15 text-warning px-1.5 py-0.5">
                {conf.data?.integralizandoEmFaseEscolar.aAjustar.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {aba === 'qualificacoes' && (
        fila.isLoading ? (
          <Skeleton class="h-48 w-full" />
        ) : lista.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Award size={24} />}
              title="Nenhum certificado pendente"
              description="Ninguém concluiu um módulo com terminalidade sem receber o certificado. A lista aparece sozinha quando um módulo fecha."
            />
          </Card>
        ) : (
          <div class="space-y-3">
            <Card class="!p-4 text-xs text-fg-muted">
              O certificado de qualificação é <strong class="text-fg">devido</strong> a quem concluiu a etapa —
              Resolução CNE/CP nº 1/2021, art. 49, §2º diz que <em>será</em> conferido. A lista inclui quem
              trancou ou evadiu de propósito: o direito não desaparece com a saída, e é esse aluno que mais
              precisa do documento.
            </Card>
            <Card class="p-0 overflow-hidden">
              <div class="px-4 py-2.5 border-b border-border flex items-center justify-between">
                <span class="text-sm font-medium text-fg">{lista.length} certificado(s) a emitir</span>
                <button
                  class="text-xs text-accent hover:underline"
                  onClick={() => setSelecao(selecao.length === lista.length ? [] : lista.map(chave))}
                >
                  {selecao.length === lista.length ? 'Limpar seleção' : 'Selecionar todos'}
                </button>
              </div>
              <div class="divide-y divide-border">
                {lista.map((q) => (
                  <label key={chave(q)} class="px-4 py-3 flex items-center gap-3 hover:bg-surface-2 cursor-pointer">
                    <input
                      type="checkbox" checked={selecao.includes(chave(q))}
                      onChange={() => setSelecao((s) => (s.includes(chave(q)) ? s.filter((x) => x !== chave(q)) : [...s, chave(q)]))}
                    />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{q.nome}</span>
                        {q.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {q.ra}</span>}
                        {q.situacao !== 'ATIVO' && <Badge tone="warning">{q.situacao}</Badge>}
                      </div>
                      <div class="text-xs text-fg-muted mt-0.5">
                        <strong class="text-fg">{q.titulo}</strong> · módulo {q.modulo} · {q.cargaHoraria}h
                      </div>
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      onClick={(e) => { e.preventDefault(); navigate(`/aca/vinculos/${q.vinculoId}/integralizacao`) }}
                    >
                      <ExternalLink size={14} /> Ver
                    </Button>
                  </label>
                ))}
              </div>
            </Card>
          </div>
        )
      )}

      {aba === 'sistec' && (
        conf.isLoading || !conf.data ? (
          <Skeleton class="h-48 w-full" />
        ) : (
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card class="space-y-1">
                <div class="flex items-center gap-2 text-fg-muted text-xs"><FileCheck2 size={14} /> Em fase escolar</div>
                <div class="text-2xl font-semibold text-fg">{conf.data.integralizandoEmFaseEscolar.registrados}</div>
                <div class="text-[11px] text-fg-subtle">Já registrados com a situação correta.</div>
              </Card>
              <Card class="space-y-1">
                <div class="flex items-center gap-2 text-fg-muted text-xs"><AlertTriangle size={14} /> Alunos sem CPF</div>
                <div class={`text-2xl font-semibold ${conf.data.pendencias.alunosSemCpf > 0 ? 'text-danger' : 'text-fg'}`}>
                  {conf.data.pendencias.alunosSemCpf}
                </div>
                <div class="text-[11px] text-fg-subtle">Sem CPF a matrícula não sobe.</div>
              </Card>
              <Card class="space-y-1">
                <div class="flex items-center gap-2 text-fg-muted text-xs"><AlertTriangle size={14} /> Técnicos sem eixo</div>
                <div class={`text-2xl font-semibold ${conf.data.pendencias.cursosTecnicosSemEixo > 0 ? 'text-warning' : 'text-fg'}`}>
                  {conf.data.pendencias.cursosTecnicosSemEixo}
                </div>
                <div class="text-[11px] text-fg-subtle">O SISTEC exige o eixo tecnológico.</div>
              </Card>
            </div>

            {conf.data.integralizandoEmFaseEscolar.aAjustar.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Check size={24} />}
                  title="Nada a ajustar"
                  description="Nenhum aluno terminou os componentes com o vínculo ainda em 'ativo'."
                />
              </Card>
            ) : (
              <>
                <Card class="!p-4 text-xs text-fg-muted">
                  Estes alunos <strong class="text-fg">cumpriram todos os componentes curriculares</strong> e
                  falta apenas estágio, TCC ou atividade complementar. No SISTEC isso é
                  “Integralizar em Fase Escolar”; mantê-los como “em curso” informa situação errada ao MEC, e
                  evadi-los por engano é pior. Mudar a situação é ato da secretaria, por isso a confirmação.
                </Card>
                <Card class="p-0 overflow-hidden">
                  <div class="px-4 py-2.5 border-b border-border flex items-center justify-between">
                    <span class="text-sm font-medium text-fg">
                      {conf.data.integralizandoEmFaseEscolar.aAjustar.length} aluno(s) a ajustar
                    </span>
                    <button
                      class="text-xs text-accent hover:underline"
                      onClick={() => setSelSistec(
                        selSistec.length === conf.data!.integralizandoEmFaseEscolar.aAjustar.length
                          ? []
                          : conf.data!.integralizandoEmFaseEscolar.aAjustar.map((x) => x.vinculoId),
                      )}
                    >
                      {selSistec.length === conf.data.integralizandoEmFaseEscolar.aAjustar.length ? 'Limpar seleção' : 'Selecionar todos'}
                    </button>
                  </div>
                  <div class="divide-y divide-border">
                    {conf.data.integralizandoEmFaseEscolar.aAjustar.map((x) => (
                      <label key={x.vinculoId} class="px-4 py-3 flex items-center gap-3 hover:bg-surface-2 cursor-pointer">
                        <input
                          type="checkbox" checked={selSistec.includes(x.vinculoId)}
                          onChange={() => setSelSistec((s) => (s.includes(x.vinculoId) ? s.filter((y) => y !== x.vinculoId) : [...s, x.vinculoId]))}
                        />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-sm font-medium text-fg truncate">{x.nome}</span>
                            {x.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {x.ra}</span>}
                          </div>
                          <div class="text-xs text-fg-muted mt-0.5">Falta: {x.pendencias.join(', ')}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </Card>
              </>
            )}

            <Card class="!p-4">
              <h2 class="text-sm font-semibold text-fg mb-2">Situações que o SISTEC aceita</h2>
              <div class="flex flex-wrap gap-1.5">
                {Object.entries(conf.data.rotulos).map(([k, v]) => (
                  <Badge key={k} tone="neutral">{v}</Badge>
                ))}
              </div>
              <p class="text-[11px] text-fg-subtle mt-2">
                Reprovação não consta: o SISTEC só a aceita para FIC e superior. No curso técnico o aluno que não
                atinge desempenho permanece “em curso” e entra nos indicadores como retido.
              </p>
            </Card>
          </div>
        )
      )}

      {aba === 'lato' && (
        lato.isLoading ? <Skeleton class="h-48 w-full" /> : (
          <div class="space-y-3">
            <Card class="!p-4">
              <div class="flex items-start gap-2.5">
                <GraduationCap size={16} class="text-accent mt-0.5 shrink-0" />
                <div class="text-xs text-fg-muted leading-relaxed">
                  <span class="font-semibold text-fg">O que a norma exige da especialização</span>
                  <ul class="mt-1.5 space-y-1">
                    <li>· <strong class="text-fg">Art. 7º, I</strong> — carga mínima de 360 horas.</li>
                    <li>
                      · <strong class="text-fg">Art. 8º</strong> — o certificado deve vir acompanhado do
                      histórico, e nele devem constar o ato de credenciamento da instituição, o período de
                      realização e o <strong class="text-fg">corpo docente que efetivamente ministrou o curso,
                      com titulação</strong>. Este último é o mais esquecido.
                    </li>
                    <li>· <strong class="text-fg">Art. 9º</strong> — pelo menos 30% do corpo docente com título stricto sensu.</li>
                  </ul>
                  <p class="mt-1.5 text-[11px] text-fg-subtle">
                    Res. CNE/CES nº 1/2018. Cursos de especialização são registrados no Censo da Educação
                    Superior (art. 6º) — a régua não é só de graduação.
                  </p>
                </div>
              </div>
            </Card>

            {lato.data?.resumo?.semCursoLatoSensu ? (
              <EmptyState
                icon={<GraduationCap size={24} />}
                title="Nenhum curso de especialização cadastrado"
                description="Cadastre o curso com nível Especialização ou Pós-graduação para que a conformidade seja apurada. Sem curso, não há o que verificar."
              />
            ) : (
              (lato.data?.cursos ?? []).map((c) => {
                const impedimentos = c.pendencias.filter((p) => p.gravidade === 'impedimento')
                return (
                  <Card key={c.courseId} class={`!p-4 ${impedimentos.length ? 'border-danger/40' : 'border-success/30'}`}>
                    <div class="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div class="text-sm font-semibold text-fg">{c.curso}</div>
                        <div class="text-xs text-fg-muted mt-0.5">
                          {c.cargaHoraria ? `${c.cargaHoraria}h` : 'carga horária não informada'}
                          {' · '}
                          {c.docentes.total} docente(s), {c.docentes.percentual}% stricto sensu
                        </div>
                      </div>
                      <Badge tone={impedimentos.length ? 'danger' : c.pendencias.length ? 'warning' : 'success'}>
                        {impedimentos.length
                          ? `${impedimentos.length} impedimento(s)`
                          : c.pendencias.length ? `${c.pendencias.length} atenção` : 'conforme'}
                      </Badge>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                      <Indicador
                        rotulo="Carga horária"
                        valor={c.cargaHoraria ? `${c.cargaHoraria}h` : '—'}
                        ok={c.chMinimaAtendida}
                        detalhe="mínimo 360h"
                      />
                      <Indicador
                        rotulo="Stricto sensu"
                        valor={`${c.docentes.percentual}%`}
                        ok={c.docentes.atende}
                        detalhe={`${c.docentes.strictoSensu} de ${c.docentes.total} · mínimo 30%`}
                      />
                      <Indicador
                        rotulo="Credenciamento"
                        valor={c.atoCredenciamento?.numero ?? c.atoCredenciamento?.tipo ?? '—'}
                        ok={!!c.atoCredenciamento?.ehCredenciamento}
                        detalhe={c.atoCredenciamento?.ehCredenciamento ? 'ato de credenciamento' : 'nenhum ato de credenciamento'}
                      />
                    </div>

                    {c.pendencias.length > 0 && (
                      <ul class="mt-3 space-y-1.5">
                        {c.pendencias.map((p) => (
                          <li key={p.artigo + p.descricao} class="text-xs text-fg-muted leading-relaxed flex items-start gap-2">
                            <AlertTriangle
                              size={12}
                              class={`mt-0.5 shrink-0 ${p.gravidade === 'impedimento' ? 'text-danger' : 'text-warning'}`}
                            />
                            <span><strong class="text-fg">{p.artigo}</strong> — {p.descricao}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      class="text-[11px] text-accent hover:underline mt-3 inline-flex items-center gap-1"
                      onClick={() => navigate('/aca/docente')}
                    >
                      <Users size={11} /> Cadastro de docentes e titulação
                    </button>
                  </Card>
                )
              })
            )}
          </div>
        )
      )}
    </Page>
  )
}

/** Indicador de conformidade: valor + se atende, com o limite da norma. */
function Indicador({ rotulo, valor, ok, detalhe }: {
  rotulo: string
  valor: string
  ok: boolean
  detalhe: string
}) {
  return (
    <div class={`rounded-md border p-2.5 ${ok ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'}`}>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{rotulo}</div>
      <div class="flex items-center gap-1.5 mt-0.5">
        {ok ? <Check size={13} class="text-success" /> : <AlertTriangle size={13} class="text-danger" />}
        <span class="text-sm font-semibold text-fg truncate">{valor}</span>
      </div>
      <div class="text-[0.625rem] text-fg-subtle mt-0.5">{detalhe}</div>
    </div>
  )
}
