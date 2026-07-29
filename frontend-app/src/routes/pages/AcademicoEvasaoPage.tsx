import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { TrendingDown, Phone, MessageSquare, ChevronRight } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePainelEvasao, FAIXA, FATOR_LABEL, type RiscoEvasao } from '@/hooks/useAcaInteligencia'

// Risco de evasão. O score é explicável de propósito: a lista só vira ação
// quando o coordenador sabe POR QUE ligar e o que dizer. Por isso cada linha
// abre os fatores que somaram pontos, com o número que os gerou.

function Barra({ risco }: { risco: RiscoEvasao }) {
  const f = FAIXA[risco.faixa] ?? FAIXA.BAIXO!
  return (
    <div class="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden">
      <div class={`h-full ${f.barra}`} style={{ width: `${risco.score}%` }} />
    </div>
  )
}

export function AcademicoEvasaoPage() {
  const [, navigate] = useLocation()
  const [minimo, setMinimo] = useState(25)
  const [aberto, setAberto] = useState<number | null>(null)
  const { data, isLoading } = usePainelEvasao({ scoreMinimo: minimo })

  const linhas = data?.linhas ?? []

  return (
    <Page
      title="Risco de evasão"
      description="Quem está prestes a desistir, por quê, e o que fazer hoje."
      actions={
        <div class="w-56">
          <Select value={String(minimo)} onChange={(e) => setMinimo(Number((e.target as HTMLSelectElement).value))}>
            <option value="0">Todos os alunos ativos</option>
            <option value="25">Risco médio ou maior</option>
            <option value="50">Risco alto ou maior</option>
            <option value="75">Só risco crítico</option>
          </Select>
        </div>
      }
    >
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {(['CRITICO', 'ALTO', 'MEDIO', 'BAIXO'] as const).map((k) => (
          <Card key={k} class="space-y-1">
            <div class="flex items-center gap-2 text-fg-muted text-xs">
              <span class={`w-2 h-2 rounded-full ${FAIXA[k]!.barra}`} /> {FAIXA[k]!.label}
            </div>
            <div class="text-2xl font-semibold text-fg">{data?.porFaixa?.[k] ?? 0}</div>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : linhas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TrendingDown size={24} />}
            title="Ninguém nessa faixa de risco"
            description="Nenhum aluno ativo atinge o score selecionado. Baixe o filtro para ver o restante da base."
          />
        </Card>
      ) : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {linhas.map((r) => {
            const f = FAIXA[r.faixa] ?? FAIXA.BAIXO!
            const expandido = aberto === r.vinculoId
            return (
              <div key={r.vinculoId}>
                <button
                  class="w-full px-4 py-3 text-left hover:bg-surface-2 flex items-center gap-4"
                  onClick={() => setAberto(expandido ? null : r.vinculoId)}
                >
                  <div class="w-12 text-center shrink-0">
                    <div class={`text-xl font-semibold ${r.faixa === 'CRITICO' || r.faixa === 'ALTO' ? 'text-danger' : r.faixa === 'MEDIO' ? 'text-warning' : 'text-fg'}`}>
                      {r.score}
                    </div>
                    <div class="text-[10px] text-fg-subtle">score</div>
                  </div>
                  <div class="flex-1 min-w-0 space-y-1.5">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-fg truncate">{r.nome}</span>
                      {r.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {r.ra}</span>}
                      <Badge tone={f.tone}>{f.label}</Badge>
                    </div>
                    <Barra risco={r} />
                    <div class="text-xs text-fg-muted">{r.acaoSugerida}</div>
                  </div>
                  <ChevronRight size={16} class={`shrink-0 text-fg-subtle transition-transform ${expandido ? 'rotate-90' : ''}`} />
                </button>

                {expandido && (
                  <div class="px-4 pb-4 pt-1 bg-surface-2/40 space-y-2">
                    <div class="text-xs font-medium text-fg-muted">O que somou pontos</div>
                    {r.fatores.length === 0 ? (
                      <p class="text-xs text-fg-subtle">Nenhum sinal de alerta — o score veio de fatores residuais.</p>
                    ) : (
                      <div class="space-y-1.5">
                        {[...r.fatores].sort((a, b) => b.pontos - a.pontos).map((ft) => (
                          <div key={ft.fator} class="flex items-start gap-3 text-xs">
                            <span class="w-8 text-right font-mono text-fg shrink-0">+{ft.pontos}</span>
                            <span class="w-40 shrink-0 text-fg-muted">{FATOR_LABEL[ft.fator] ?? ft.fator}</span>
                            <span class="flex-1 text-fg-subtle">{ft.detalhe}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div class="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/aca/vinculos/${r.vinculoId}`)}>
                        Ver vínculo
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/vinculos/${r.vinculoId}/integralizacao`)}>
                        Integralização
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <Card class="!p-4 mt-4 text-xs text-fg-muted space-y-1.5">
        <div class="flex items-center gap-2 text-fg font-medium"><MessageSquare size={15} /> O sinal que só existe aqui</div>
        <p>
          Além de nota, falta e dívida, o score lê o <strong class="text-fg">silêncio no WhatsApp</strong>: aluno que
          antes respondia e parou, com mensagens enviadas sem retorno. Esse fator não penaliza quem nunca foi
          contatado — sem tentativa da instituição, não há silêncio a interpretar.
        </p>
        <p class="flex items-center gap-1.5 text-fg-subtle">
          <Phone size={13} /> A ação sugerida vem do fator de maior peso, não da média — é o que o aluno vai ouvir na ligação.
        </p>
      </Card>
    </Page>
  )
}
