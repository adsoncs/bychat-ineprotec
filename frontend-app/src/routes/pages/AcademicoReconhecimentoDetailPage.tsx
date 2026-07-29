import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Check, X, Gavel, Briefcase, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import {
  useProcessoReconhecimento, useReconhecimentoMut, PROCESSO_STATUS, PPCP_STATUS,
} from '@/hooks/useAcaReconhecimento'

// Detalhe do processo de reconhecimento: onde a banca avalia componente por
// componente e a coordenação decide.
//
// Cada reconhecimento gera aproveitamento na hora — o que a banca decide aqui
// entra no histórico do aluno. Por isso a tela insiste no instrumento aplicado:
// reconhecer sem registrar COMO se avaliou não sustenta auditoria.

const INSTRUMENTOS = [
  'Prova prática',
  'Prova teórica',
  'Análise de portfólio',
  'Entrevista técnica',
  'Análise de portfólio + entrevista técnica',
  'Demonstração em situação real de trabalho',
]

export function AcademicoReconhecimentoDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading } = useProcessoReconhecimento(id)
  const mut = useReconhecimentoMut()

  const [fa, setFa] = useState({ componenteId: '', instrumento: INSTRUMENTOS[0]!, resultado: 'RECONHECIDO', parecer: '' })
  const [decidindo, setDecidindo] = useState<'DEFERIDO' | 'INDEFERIDO' | 'CANCELADO' | null>(null)
  const [parecerFinal, setParecerFinal] = useState('')

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!data) {
    return (
      <Page title="Processo" actions={<Button variant="ghost" onClick={() => navigate('/aca/reconhecimento')}><ChevronLeft size={16} /> Voltar</Button>}>
        <Card class="text-sm text-fg-subtle text-center py-8">Processo não encontrado.</Card>
      </Page>
    )
  }

  const { processo, ppcp, avaliacoes, componentesDisponiveis } = data
  const encerrado = ['DEFERIDO', 'INDEFERIDO', 'CANCELADO'].includes(processo.status)
  const ppcpVigente = ppcp.vigente

  const avaliar = () => {
    mut.avaliar.mutate(
      {
        processoId: id, componenteId: Number(fa.componenteId),
        instrumento: fa.instrumento, resultado: fa.resultado,
        ...(fa.parecer ? { parecer: fa.parecer } : {}),
      },
      {
        onSuccess: () => {
          toast(
            fa.resultado === 'RECONHECIDO'
              ? 'Reconhecido — o aproveitamento já entrou na integralização do aluno.'
              : 'Registrado como não reconhecido.',
            'success',
          )
          setFa({ componenteId: '', instrumento: INSTRUMENTOS[0]!, resultado: 'RECONHECIDO', parecer: '' })
        },
        onError: (e: any) => toast(e?.message ?? 'Falha ao avaliar.', 'danger'),
      },
    )
  }

  const decidir = () => {
    if (!decidindo) return
    mut.decidir.mutate(
      { id, status: decidindo, ...(parecerFinal ? { parecerFinal } : {}) },
      {
        onSuccess: () => {
          toast(
            decidindo === 'DEFERIDO'
              ? 'Processo deferido.'
              : 'Processo encerrado — os aproveitamentos reconhecidos foram removidos.',
            'success',
          )
          setDecidindo(null); setParecerFinal('')
        },
        onError: (e: any) => toast(e?.message ?? 'Falha ao decidir.', 'danger'),
      },
    )
  }

  return (
    <Page
      title={`Processo ${processo.protocolo}`}
      description={`${processo.aluno.nome}${processo.aluno.ra ? ` · RA ${processo.aluno.ra}` : ''}`}
      actions={<Button variant="ghost" onClick={() => navigate('/aca/reconhecimento')}><ChevronLeft size={16} /> Voltar</Button>}
    >
      {!ppcpVigente && !encerrado && (
        <Card class="!p-4 mb-4 border-danger/40 bg-danger/5 text-sm text-fg-muted flex gap-2">
          <AlertTriangle size={16} class="shrink-0 mt-0.5 text-danger" />
          <span>
            O projeto <strong class="text-fg">{ppcp.nome}</strong> está {PPCP_STATUS[ppcp.status]?.label.toLowerCase()}
            {ppcp.vencido ? ' e com a autorização vencida' : ''}. Avaliar agora seria decidir sem amparo — o sistema
            vai recusar até que a autorização seja regularizada.
          </span>
        </Card>
      )}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          {/* Itinerário: é o que a banca lê antes de decidir o que avaliar */}
          <Card class="space-y-2">
            <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Briefcase size={15} /> Itinerário profissional declarado</h2>
            {processo.itinerario ? (
              <p class="text-sm text-fg whitespace-pre-wrap">{processo.itinerario}</p>
            ) : (
              <p class="text-sm text-fg-subtle italic">
                Nada declarado. O art. 47, §1º manda avaliar o itinerário do candidato, incluindo estudos não
                formais e experiência no trabalho.
              </p>
            )}
            {processo.banca && (
              <div class="border-t border-border pt-2">
                <div class="text-xs font-medium text-fg-muted mb-0.5">Banca</div>
                <p class="text-sm text-fg">{processo.banca}</p>
              </div>
            )}
          </Card>

          {/* Componentes avaliados */}
          <Card class="!p-0 overflow-hidden">
            <div class="px-4 py-2.5 bg-surface-2/50">
              <h2 class="text-sm font-semibold text-fg">Componentes avaliados</h2>
            </div>
            {avaliacoes.length === 0 ? (
              <p class="px-4 py-4 text-sm text-fg-subtle">Nenhum componente avaliado ainda.</p>
            ) : (
              <ul class="divide-y divide-border">
                {avaliacoes.map((a) => (
                  <li key={a.id} class="px-4 py-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-sm text-fg">{a.componente}</span>
                          {a.resultado === 'RECONHECIDO'
                            ? <Badge tone="success">reconhecido</Badge>
                            : <Badge tone="danger">não reconhecido</Badge>}
                          <span class="text-[11px] text-fg-subtle">{a.cargaHoraria}h</span>
                        </div>
                        <div class="text-xs text-fg-muted mt-0.5">Instrumento: {a.instrumento}</div>
                        {a.parecer && <div class="text-xs text-fg-subtle mt-0.5">{a.parecer}</div>}
                        {a.aproveitamentoId && (
                          <div class="text-[11px] text-success mt-0.5">
                            Aproveitamento lançado — já conta na integralização
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Nova avaliação */}
          {!encerrado && (
            <Card class="space-y-3">
              <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><Gavel size={15} /> Avaliar componente</h2>
              {componentesDisponiveis.length === 0 ? (
                <p class="text-xs text-fg-subtle">
                  Todos os componentes do curso já foram avaliados neste processo.
                </p>
              ) : (
                <>
                  <Select label="Componente" value={fa.componenteId} onChange={(e) => setFa({ ...fa, componenteId: (e.target as HTMLSelectElement).value })}>
                    <option value="">Selecione…</option>
                    {componentesDisponiveis.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome} ({c.cargaHoraria}h)</option>
                    ))}
                  </Select>
                  <Select
                    label="Instrumento aplicado" value={fa.instrumento}
                    hint="Obrigatório: reconhecer sem registrar como se avaliou não sustenta auditoria."
                    onChange={(e) => setFa({ ...fa, instrumento: (e.target as HTMLSelectElement).value })}
                  >
                    {INSTRUMENTOS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </Select>
                  <Select label="Resultado" value={fa.resultado} onChange={(e) => setFa({ ...fa, resultado: (e.target as HTMLSelectElement).value })}>
                    <option value="RECONHECIDO">Reconhecido</option>
                    <option value="NAO_RECONHECIDO">Não reconhecido</option>
                  </Select>
                  <Textarea
                    label="Parecer da banca" rows={3} value={fa.parecer}
                    placeholder="O que sustentou a decisão"
                    onInput={(e) => setFa({ ...fa, parecer: (e.target as HTMLTextAreaElement).value })}
                  />
                  <Button onClick={avaliar} disabled={!fa.componenteId || !ppcpVigente || mut.avaliar.isPending}>
                    {fa.resultado === 'RECONHECIDO' ? <Check size={16} /> : <X size={16} />} Registrar avaliação
                  </Button>
                  {fa.resultado === 'RECONHECIDO' && (
                    <p class="text-[11px] text-fg-subtle -mt-1">
                      Reconhecer dispensa o aluno do componente e entra no histórico dele.
                    </p>
                  )}
                </>
              )}
            </Card>
          )}
        </div>

        <div class="space-y-4">
          <Card class="space-y-2">
            <h2 class="text-sm font-semibold text-fg">Situação</h2>
            <Badge tone={PROCESSO_STATUS[processo.status]?.tone ?? 'neutral'}>
              {PROCESSO_STATUS[processo.status]?.label ?? processo.status}
            </Badge>
            <div class="text-xs text-fg-muted space-y-1 pt-1">
              <div>Reconhecidos: <strong class="text-fg">{data.reconhecidos}</strong></div>
              <div>Não reconhecidos: <strong class="text-fg">{data.naoReconhecidos}</strong></div>
              <div>Carga horária reconhecida: <strong class="text-fg">{data.cargaHorariaReconhecida}h</strong></div>
              {processo.decididoEm && (
                <div class="text-fg-subtle">Decidido em {new Date(processo.decididoEm).toLocaleString('pt-BR')}</div>
              )}
            </div>
            {processo.parecerFinal && (
              <div class="border-t border-border pt-2 text-xs text-fg-muted">{processo.parecerFinal}</div>
            )}
          </Card>

          <Card class="space-y-2">
            <h2 class="text-sm font-semibold text-fg">Amparo</h2>
            <div class="text-xs text-fg-muted space-y-1">
              <div class="text-fg">{ppcp.nome}</div>
              <div>
                <Badge tone={PPCP_STATUS[ppcp.status]?.tone ?? 'neutral'}>{PPCP_STATUS[ppcp.status]?.label ?? ppcp.status}</Badge>
              </div>
              {ppcp.atoAutorizacao && <div>{ppcp.atoAutorizacao}</div>}
              {ppcp.orgaoAutorizador && <div>{ppcp.orgaoAutorizador}</div>}
              {ppcp.vigenciaAte && <div>Vigente até {new Date(ppcp.vigenciaAte).toLocaleDateString('pt-BR')}</div>}
            </div>
            <p class="text-[11px] text-fg-subtle border-t border-border pt-2">
              É este projeto que se apresenta quando perguntarem sob qual amparo o aluno foi dispensado.
            </p>
          </Card>

          {!encerrado && (
            <Card class="space-y-2">
              <h2 class="text-sm font-semibold text-fg">Decidir</h2>
              {decidindo ? (
                <>
                  <p class="text-xs text-fg-muted">
                    {decidindo === 'DEFERIDO'
                      ? 'Os componentes reconhecidos permanecem no histórico do aluno.'
                      : 'Os aproveitamentos já lançados serão REMOVIDOS — não pode sobrar dispensa de um processo negado.'}
                  </p>
                  <Textarea label="Parecer final" rows={3} value={parecerFinal} onInput={(e) => setParecerFinal((e.target as HTMLTextAreaElement).value)} />
                  <div class="flex gap-2">
                    <Button
                      size="sm" variant={decidindo === 'DEFERIDO' ? 'primary' : 'danger'}
                      onClick={decidir} disabled={mut.decidir.isPending}
                    >Confirmar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDecidindo(null)}>Cancelar</Button>
                  </div>
                </>
              ) : (
                <div class="flex flex-col gap-1.5">
                  <Button size="sm" onClick={() => setDecidindo('DEFERIDO')} disabled={avaliacoes.length === 0}>
                    Deferir
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDecidindo('INDEFERIDO')}>Indeferir</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDecidindo('CANCELADO')}>Cancelar processo</Button>
                  {avaliacoes.length === 0 && (
                    <p class="text-[11px] text-fg-subtle">Avalie ao menos um componente antes de deferir.</p>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
