import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ShieldCheck, Plus, ScrollText, AlertTriangle, Search, ExternalLink } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { useAlunos } from '@/hooks/useAcaAluno'
import { useAcaRefs } from '@/hooks/useAcaCatalogo'
import {
  usePpcps, useProcessosReconhecimento, useReconhecimentoMut,
  PPCP_STATUS, PROCESSO_STATUS,
} from '@/hooks/useAcaReconhecimento'

// Reconhecimento de saberes e competências.
//
// LDB art. 41: o conhecimento adquirido "inclusive no trabalho" pode ser
// avaliado, reconhecido e certificado. Mas o art. 47, §2º da Res. CNE/CP 1/2021
// exige autorização prévia do sistema de ensino, via PPCP — e é por isso que a
// tela começa pelo projeto, não pelo candidato.

const ABAS = [
  { id: 'processos', label: 'Processos' },
  { id: 'ppcp', label: 'Projetos (PPCP)' },
] as const

type Aba = (typeof ABAS)[number]['id']

export function AcademicoReconhecimentoPage() {
  const [, navigate] = useLocation()
  const [aba, setAba] = useState<Aba>('processos')

  const ppcps = usePpcps()
  const processos = useProcessosReconhecimento()
  const refs = useAcaRefs()
  const mut = useReconhecimentoMut()

  // Novo PPCP
  const [novoPpcp, setNovoPpcp] = useState(false)
  const [fp, setFp] = useState({ courseId: '', nome: '', metodologia: '' })

  // Autorização
  const [autorizando, setAutorizando] = useState<number | null>(null)
  const [fa, setFa] = useState({ atoAutorizacao: '', orgaoAutorizador: '', vigenciaAte: '' })

  // Novo processo
  const [novoProc, setNovoProc] = useState(false)
  const [q, setQ] = useState('')
  const alunos = useAlunos(q)
  const [fpr, setFpr] = useState({ ppcpId: '', alunoId: 0, alunoNome: '', matriculaId: '', itinerario: '', banca: '' })

  const vigentes = (ppcps.data?.ppcps ?? []).filter((p) => p.vigente)

  const criarPpcp = () => {
    mut.criarPpcp.mutate(
      { courseId: Number(fp.courseId), nome: fp.nome, ...(fp.metodologia ? { metodologia: fp.metodologia } : {}) },
      {
        onSuccess: () => {
          toast('Projeto criado em rascunho. Autorize-o para poder abrir processos.', 'success')
          setFp({ courseId: '', nome: '', metodologia: '' }); setNovoPpcp(false)
        },
        onError: (e: any) => toast(e?.message ?? 'Falha ao criar.', 'danger'),
      },
    )
  }

  const autorizar = (id: number) => {
    mut.mudarStatusPpcp.mutate(
      {
        id, status: 'AUTORIZADO',
        atoAutorizacao: fa.atoAutorizacao, orgaoAutorizador: fa.orgaoAutorizador,
        ...(fa.vigenciaAte ? { vigenciaAte: fa.vigenciaAte } : {}),
      },
      {
        onSuccess: () => {
          toast('Projeto autorizado — já é possível abrir processos.', 'success')
          setAutorizando(null); setFa({ atoAutorizacao: '', orgaoAutorizador: '', vigenciaAte: '' })
        },
        onError: (e: any) => toast(e?.message ?? 'Falha ao autorizar.', 'danger'),
      },
    )
  }

  const abrir = () => {
    mut.abrirProcesso.mutate(
      {
        ppcpId: Number(fpr.ppcpId), alunoId: fpr.alunoId,
        ...(fpr.matriculaId ? { matriculaId: Number(fpr.matriculaId) } : {}),
        ...(fpr.itinerario ? { itinerario: fpr.itinerario } : {}),
        ...(fpr.banca ? { banca: fpr.banca } : {}),
      },
      {
        onSuccess: (r) => {
          toast(`Processo ${r.processo.protocolo} aberto.`, 'success')
          setNovoProc(false)
          setFpr({ ppcpId: '', alunoId: 0, alunoNome: '', matriculaId: '', itinerario: '', banca: '' })
          navigate(`/aca/reconhecimento/${r.processo.id}`)
        },
        onError: (e: any) => toast(e?.message ?? 'Falha ao abrir.', 'danger'),
      },
    )
  }

  return (
    <Page
      title="Reconhecimento de saberes"
      description="Certificação profissional de quem já sabe fazer — LDB art. 41 e Res. CNE/CP 1/2021, art. 47."
      actions={
        aba === 'ppcp' ? (
          <Button onClick={() => setNovoPpcp((v) => !v)}><Plus size={16} /> Novo projeto</Button>
        ) : (
          <Button onClick={() => setNovoProc((v) => !v)} disabled={vigentes.length === 0}>
            <Plus size={16} /> Novo processo
          </Button>
        )
      }
    >
      {vigentes.length === 0 && (
        <Card class="!p-4 mb-4 border-warning/40 bg-warning/5 text-sm text-fg-muted flex gap-2">
          <AlertTriangle size={16} class="shrink-0 mt-0.5 text-warning" />
          <span>
            Nenhum PPCP autorizado e vigente. O reconhecimento de saberes <strong class="text-fg">exige
            autorização prévia do sistema de ensino</strong> (art. 47, §2º) — sem projeto autorizado a escola
            não pode aplicar avaliação e dispensar componente. Comece pela aba <em>Projetos</em>.
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
            {t.id === 'processos' && (processos.data?.processos.length ?? 0) > 0 && (
              <span class="ml-1.5 text-[10px] rounded-full bg-surface-3 text-fg-muted px-1.5 py-0.5">
                {processos.data?.processos.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {aba === 'ppcp' && (
        <div class="space-y-3">
          {novoPpcp && (
            <Card class="space-y-3">
              <h2 class="text-sm font-semibold text-fg">Novo Projeto Pedagógico de Certificação</h2>
              <p class="text-xs text-fg-muted">
                O PPCP é construído a partir do perfil profissional de conclusão e do PPC do curso. Nasce em
                rascunho: para valer, precisa da autorização do sistema de ensino.
              </p>
              <Select label="Curso de referência" value={fp.courseId} onChange={(e) => setFp({ ...fp, courseId: (e.target as HTMLSelectElement).value })}>
                <option value="">Selecione…</option>
                {(refs.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
              <Input label="Nome do projeto" value={fp.nome} onInput={(e) => setFp({ ...fp, nome: (e.target as HTMLInputElement).value })} />
              <Textarea
                label="Metodologia" rows={3} value={fp.metodologia}
                placeholder="Ex.: análise de portfólio, prova prática e entrevista técnica"
                hint="O §3º admite a metodologia própria da instituição, desde que autorizada."
                onInput={(e) => setFp({ ...fp, metodologia: (e.target as HTMLTextAreaElement).value })}
              />
              <div class="flex gap-2">
                <Button onClick={criarPpcp} disabled={!fp.courseId || !fp.nome.trim() || mut.criarPpcp.isPending}>Criar</Button>
                <Button variant="ghost" onClick={() => setNovoPpcp(false)}>Cancelar</Button>
              </div>
            </Card>
          )}

          {ppcps.isLoading ? (
            <Skeleton class="h-40 w-full" />
          ) : (ppcps.data?.ppcps.length ?? 0) === 0 ? (
            <Card>
              <EmptyState
                icon={<ScrollText size={24} />}
                title="Nenhum projeto cadastrado"
                description="O PPCP é o documento que autoriza a escola a reconhecer saberes. Sem ele, nenhum processo pode ser aberto."
                action={<Button onClick={() => setNovoPpcp(true)}><Plus size={16} /> Novo projeto</Button>}
              />
            </Card>
          ) : (
            (ppcps.data?.ppcps ?? []).map((p) => (
              <Card key={p.id} class="space-y-2">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-fg">{p.nome}</span>
                      <Badge tone={PPCP_STATUS[p.status]?.tone ?? 'neutral'}>{PPCP_STATUS[p.status]?.label ?? p.status}</Badge>
                      {p.vencido && <Badge tone="danger">autorização vencida</Badge>}
                      {p.vigente && <Badge tone="info">vigente</Badge>}
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">
                      {p.atoAutorizacao
                        ? `${p.atoAutorizacao}${p.orgaoAutorizador ? ` · ${p.orgaoAutorizador}` : ''}`
                          + `${p.vigenciaAte ? ` · vigente até ${new Date(p.vigenciaAte).toLocaleDateString('pt-BR')}` : ''}`
                        : 'Sem ato de autorização registrado.'}
                    </div>
                    {p.metodologia && <div class="text-xs text-fg-subtle mt-1">{p.metodologia}</div>}
                    <div class="text-[11px] text-fg-subtle mt-1">{p._count?.processos ?? 0} processo(s)</div>
                  </div>
                  <div class="flex flex-col gap-1.5 shrink-0">
                    {p.status !== 'AUTORIZADO' && (
                      <Button size="sm" onClick={() => setAutorizando(autorizando === p.id ? null : p.id)}>
                        <ShieldCheck size={14} /> Autorizar
                      </Button>
                    )}
                    {p.status === 'AUTORIZADO' && (
                      <Button size="sm" variant="ghost" onClick={() => mut.mudarStatusPpcp.mutate({ id: p.id, status: 'SUSPENSO' }, {
                        onSuccess: () => toast('Projeto suspenso — novos processos ficam bloqueados.', 'success'),
                      })}>Suspender</Button>
                    )}
                  </div>
                </div>

                {autorizando === p.id && (
                  <div class="border-t border-border pt-3 space-y-2">
                    <p class="text-xs text-fg-muted">
                      Informe o ato do sistema de ensino que autorizou este projeto. É esse registro que
                      demonstra a autorização se ela for questionada.
                    </p>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input label="Ato de autorização" value={fa.atoAutorizacao} placeholder="Ex.: Parecer CEE nº 45/2026" onInput={(e) => setFa({ ...fa, atoAutorizacao: (e.target as HTMLInputElement).value })} />
                      <Input label="Órgão" value={fa.orgaoAutorizador} placeholder="Conselho Estadual de Educação" onInput={(e) => setFa({ ...fa, orgaoAutorizador: (e.target as HTMLInputElement).value })} />
                      <Input label="Vigência até" type="date" value={fa.vigenciaAte} onInput={(e) => setFa({ ...fa, vigenciaAte: (e.target as HTMLInputElement).value })} />
                    </div>
                    <div class="flex gap-2">
                      <Button size="sm" onClick={() => autorizar(p.id)} disabled={!fa.atoAutorizacao.trim() || !fa.orgaoAutorizador.trim() || mut.mudarStatusPpcp.isPending}>
                        Confirmar autorização
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAutorizando(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {aba === 'processos' && (
        <div class="space-y-3">
          {novoProc && (
            <Card class="space-y-3">
              <h2 class="text-sm font-semibold text-fg">Abrir processo</h2>
              <Select label="Projeto (PPCP)" value={fpr.ppcpId} onChange={(e) => setFpr({ ...fpr, ppcpId: (e.target as HTMLSelectElement).value })}>
                <option value="">Selecione…</option>
                {vigentes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </Select>

              {fpr.alunoId ? (
                <div class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span class="text-sm text-fg">{fpr.alunoNome}</span>
                  <Button size="sm" variant="ghost" onClick={() => setFpr({ ...fpr, alunoId: 0, alunoNome: '' })}>Trocar</Button>
                </div>
              ) : (
                <div class="space-y-2">
                  <SearchInput value={q} onChange={setQ} placeholder="Buscar candidato por nome ou RA…" />
                  {(alunos.data?.alunos ?? []).length === 0 ? (
                    <p class="text-xs text-fg-subtle flex items-center gap-1.5"><Search size={13} /> Digite para localizar.</p>
                  ) : (
                    <div class="max-h-44 overflow-auto divide-y divide-border rounded-lg border border-border">
                      {(alunos.data?.alunos ?? []).map((a) => (
                        <button
                          key={a.id} type="button"
                          class="w-full px-3 py-2 flex items-center gap-3 hover:bg-surface-2 text-left text-sm"
                          onClick={() => setFpr({
                            ...fpr, alunoId: a.id, alunoNome: a.lead?.nome ?? `Aluno #${a.id}`,
                            matriculaId: String(a.matriculas?.[0]?.id ?? ''),
                          })}
                        >
                          <span class="text-fg-muted text-xs font-mono w-20">RA {a.ra ?? '—'}</span>
                          <span class="flex-1 text-fg">{a.lead?.nome ?? '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Input
                label="Matrícula (id)" inputMode="numeric" value={fpr.matriculaId}
                hint="Necessária para lançar o aproveitamento do que for reconhecido."
                onInput={(e) => setFpr({ ...fpr, matriculaId: (e.target as HTMLInputElement).value })}
              />
              <Textarea
                label="Itinerário profissional declarado" rows={4} value={fpr.itinerario}
                placeholder="Experiência de trabalho, cursos não formais, atividades…"
                hint="O art. 47, §1º manda avaliar o itinerário, incluindo estudos não formais e experiência no trabalho."
                onInput={(e) => setFpr({ ...fpr, itinerario: (e.target as HTMLTextAreaElement).value })}
              />
              <Textarea
                label="Banca avaliadora" rows={2} value={fpr.banca}
                placeholder="Nomes e papéis de quem vai avaliar"
                onInput={(e) => setFpr({ ...fpr, banca: (e.target as HTMLTextAreaElement).value })}
              />
              <div class="flex gap-2">
                <Button onClick={abrir} disabled={!fpr.ppcpId || !fpr.alunoId || mut.abrirProcesso.isPending}>Abrir processo</Button>
                <Button variant="ghost" onClick={() => setNovoProc(false)}>Cancelar</Button>
              </div>
            </Card>
          )}

          {processos.isLoading ? (
            <Skeleton class="h-40 w-full" />
          ) : (processos.data?.processos.length ?? 0) === 0 ? (
            <Card>
              <EmptyState
                icon={<ScrollText size={24} />}
                title="Nenhum processo"
                description="Abra um processo para avaliar e reconhecer os saberes de quem já atua na área."
              />
            </Card>
          ) : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {(processos.data?.processos ?? []).map((p) => (
                <button
                  key={p.id}
                  class="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-2 text-left"
                  onClick={() => navigate(`/aca/reconhecimento/${p.id}`)}
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-fg truncate">{p.aluno.nome}</span>
                      {p.aluno.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {p.aluno.ra}</span>}
                      <Badge tone={PROCESSO_STATUS[p.status]?.tone ?? 'neutral'}>
                        {PROCESSO_STATUS[p.status]?.label ?? p.status}
                      </Badge>
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">
                      {p.protocolo} · {p.ppcp.nome} · {p._count?.avaliacoes ?? 0} componente(s) avaliado(s)
                    </div>
                  </div>
                  <ExternalLink size={15} class="shrink-0 text-fg-subtle" />
                </button>
              ))}
            </Card>
          )}
        </div>
      )}
    </Page>
  )
}
