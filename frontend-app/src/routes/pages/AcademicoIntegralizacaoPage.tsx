import { useLocation } from 'wouter-preact'
import { ChevronLeft, GraduationCap, Lock, CheckCircle2, Award } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { useModulosDoVinculo, useQualificacaoMut } from '@/hooks/useAcaQualificacao'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useIntegralizacao, useVinculo,
  STATUS_COMP_LABEL, STATUS_COMP_TONE, TIPO_COMP_LABEL,
} from '@/hooks/useAcaFundacao'

// Plano de estudos do aluno: o que já cumpriu, o que está travado e o que
// pode cursar agora. Mesma engine da apuração de formandos e da trava de
// colação — aluno e secretaria enxergam exatamente o mesmo número.

export function AcademicoIntegralizacaoPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const vinculo = useVinculo(id)
  const { data, isLoading } = useIntegralizacao(id)
  const mods = useModulosDoVinculo(id)
  const qual = useQualificacaoMut()

  if (isLoading || vinculo.isLoading) return <Skeleton class="h-64 w-full" />
  if (!data) {
    return (
      <Page title="Integralização">
        <Card class="text-sm text-fg-subtle text-center py-8">Não foi possível calcular a integralização.</Card>
      </Page>
    )
  }

  const nome = vinculo.data?.vinculo?.aluno?.lead?.nome ?? `Vínculo #${id}`

  if (data.semMatriz) {
    return (
      <Page
        title="Integralização"
        description={nome}
        actions={<Voltar onClick={() => navigate(`/aca/vinculos/${id}`)} />}
      >
        <Card class="!p-4 border-warning/40 bg-warning/5 text-sm text-fg-muted">
          Este vínculo não tem <strong class="text-fg">matriz curricular</strong> definida. A integralização é
          calculada contra a matriz do aluno — sem ela, não há o que medir. Vincule a matriz para liberar o cálculo.
        </Card>
      </Page>
    )
  }

  // Agrupa por fase para ler como grade do curso.
  const porFase = new Map<number, typeof data.componentes>()
  for (const c of data.componentes) porFase.set(c.fase, [...(porFase.get(c.fase) ?? []), c])
  const fases = [...porFase.keys()].sort((a, b) => a - b)
  const restante = data.chTotalMatriz - data.chCumprida - data.chEmCurso

  return (
    <Page
      title="Integralização"
      description={`${nome} · o que falta para se formar`}
      actions={<Voltar onClick={() => navigate(`/aca/vinculos/${id}`)} />}
    >
      {/* Módulos com terminalidade: o aluno pode já ter direito a certificado
          antes de terminar o curso. */}
      {(mods.data?.modulos.length ?? 0) > 0 && (
        <Card class="!p-0 overflow-hidden">
          <div class="px-4 py-2.5 bg-surface-2/50">
            <h2 class="text-sm font-semibold text-fg">Módulos e qualificações</h2>
          </div>
          <ul class="divide-y divide-border">
            {(mods.data?.modulos ?? []).map((m) => (
              <li key={m.moduloId} class="px-4 py-2.5 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm text-fg">{m.numero}. {m.nome}</span>
                    {m.concluido
                      ? <Badge tone="success">concluído</Badge>
                      : <Badge tone="neutral">{m.cumpridos}/{m.componentes}</Badge>}
                    {m.temTerminalidade && <Badge tone="info">{m.tituloQualificacao}</Badge>}
                  </div>
                  {m.pendentes.length > 0 && (
                    <div class="text-[11px] text-fg-subtle mt-0.5">Falta: {m.pendentes.join(', ')}</div>
                  )}
                  {m.certificadoNumero && (
                    <div class="text-[11px] text-success mt-0.5">Certificado {m.certificadoNumero} emitido</div>
                  )}
                </div>
                {m.temTerminalidade && m.concluido && !m.certificadoId && (
                  <Button
                    size="sm"
                    onClick={() => qual.emitir.mutate({ vinculoId: id, moduloId: m.moduloId }, {
                      onSuccess: (r) => toast(`Certificado ${r.documento.numero} emitido.`, 'success'),
                      onError: (e: any) => toast(e?.message ?? 'Falha ao emitir.', 'danger'),
                    })}
                    disabled={qual.emitir.isPending}
                  >
                    <Award size={14} /> Emitir certificado
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!data.podeProgredir && (
        <Card class="!p-3 border-danger/40 bg-danger/5">
          <div class="flex items-start gap-2 text-sm">
            <Lock size={16} class="text-danger shrink-0 mt-0.5" />
            <span class="text-fg">
              <strong>Progressão bloqueada.</strong> {data.motivoProgressao}
              {data.nomesDependencias.length > 0 && (
                <span class="block text-fg-muted text-xs mt-0.5">
                  Dependências: {data.nomesDependencias.join(', ')}.
                </span>
              )}
            </span>
          </div>
        </Card>
      )}
      {data.podeProgredir && data.dependencias > 0 && data.limiteDependencias != null && (
        <Card class="!p-3 border-warning/40 bg-warning/5 text-sm text-fg-muted">
          {data.dependencias} de {data.limiteDependencias} dependência(s) permitidas —
          mais uma reprovação trava a matrícula no período seguinte.
        </Card>
      )}
      {data.concluido && (
        <Card class="!p-3 border-success/40 bg-success/5">
          <div class="flex items-center gap-2 text-sm">
            <CheckCircle2 size={16} class="text-success shrink-0" />
            <span class="text-fg">
              <strong>Integralização completa.</strong> O aluno cumpriu todos os componentes da matriz —
              é candidato à colação de grau.
            </span>
          </div>
        </Card>
      )}

      {/* Resumo: a resposta que o coordenador quer em 1 segundo */}
      <Card>
        <div class="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Progresso</div>
            <div class="text-2xl font-semibold text-fg tabular-nums">{data.percentual}%</div>
            <div class="text-xs text-fg-muted mt-0.5">
              {data.chCumprida}h cumpridas de {data.chTotalMatriz}h
              {data.chEmCurso > 0 ? ` · ${data.chEmCurso}h cursando` : ''}
              {restante > 0 ? ` · faltam ${restante}h` : ''}
            </div>
          </div>
          <div class="text-right">
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Pode cursar agora</div>
            <div class="text-lg font-semibold text-fg tabular-nums">{data.disponiveis}</div>
            <div class="text-xs text-fg-muted">componentes liberados</div>
          </div>
        </div>
        <div class="mt-3 h-2 rounded-full bg-surface-3 overflow-hidden">
          <div class="h-full bg-success transition-all" style={{ width: `${Math.min(100, data.percentual)}%` }} />
        </div>
      </Card>

      {/* Baldes de CH — é como o PPC declara a exigência */}
      {data.baldes.length > 0 && (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.baldes.map((b) => (
            <Card key={b.tipo} class="!p-3">
              <div class="text-xs font-medium text-fg">{TIPO_COMP_LABEL[b.tipo] ?? b.tipo}</div>
              <div class="text-sm text-fg-muted mt-1 tabular-nums">
                {b.cumprido}h{b.exigido != null ? ` / ${b.exigido}h` : ''}
                {b.percentual != null && <span class="text-fg-subtle text-xs ml-1">({b.percentual}%)</span>}
              </div>
              {b.pendente > 0 && <div class="text-[11px] text-fg-subtle mt-0.5">{b.pendente}h pendentes</div>}
              {b.percentual != null && (
                <div class="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div class="h-full bg-accent" style={{ width: `${b.percentual}%` }} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Grade com o status de cada componente */}
      <div class="space-y-3">
        {fases.map((fase) => {
          const comps = porFase.get(fase) ?? []
          return (
            <Card key={fase} class="!p-0 overflow-hidden">
              <div class="px-4 py-2 bg-surface-2/50 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-fg">{fase}º período</h2>
                <span class="text-[11px] text-fg-subtle">
                  {comps.filter((c) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO').length} de {comps.length} cumpridos
                </span>
              </div>
              <ul class="divide-y divide-border">
                {comps.map((c) => (
                  <li key={c.componenteId} class="px-4 py-2">
                    <div class="flex items-center justify-between gap-3 flex-wrap">
                      <div class="min-w-0 flex items-center gap-2">
                        {c.status === 'BLOQUEADO'
                          ? <Lock size={13} class="text-warning shrink-0" />
                          : <GraduationCap size={13} class="text-fg-subtle shrink-0" />}
                        <span class="text-sm text-fg truncate">
                          {c.codigo ? <span class="font-mono text-xs text-fg-subtle mr-2">{c.codigo}</span> : null}
                          {c.nome}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        {c.media != null && <span class="text-xs text-fg-muted tabular-nums">média {c.media}</span>}
                        <span class="text-xs text-fg-muted tabular-nums">{c.cargaHoraria}h</span>
                        <Badge tone={STATUS_COMP_TONE[c.status]}>{STATUS_COMP_LABEL[c.status]}</Badge>
                      </div>
                    </div>
                    {c.bloqueadoPor && c.bloqueadoPor.length > 0 && (
                      <div class="text-[11px] text-warning mt-1 ml-5">
                        Falta cumprir: {c.bloqueadoPor.join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )
        })}
      </div>
    </Page>
  )
}

function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={onClick}>
      <ChevronLeft size={15} /> Voltar
    </button>
  )
}
