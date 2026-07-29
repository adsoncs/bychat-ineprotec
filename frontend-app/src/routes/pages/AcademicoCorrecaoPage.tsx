import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, PenLine, CheckCircle2 } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { useFilaCorrecao, useProvaMut } from '@/hooks/useAcaProva'

// Fila de correção das dissertativas. Uma tela por vez, com a resposta inteira
// à vista — corrigir texto em linha de tabela é como o corretor deixa passar o
// que deveria ler.

export function AcademicoCorrecaoPage() {
  const [, navigate] = useLocation()
  const fila = useFilaCorrecao()
  const mut = useProvaMut()
  const [nota, setNota] = useState('')
  const [parecer, setParecer] = useState('')
  /** Pontos por critério quando a questão é corrigida por rubrica. */
  const [pontos, setPontos] = useState<Record<string, string>>({})

  const itens = fila.data?.fila ?? []
  const atual = itens[0]
  const criterios = atual?.rubrica ?? []
  const usaRubrica = criterios.length > 0

  const somaRubrica = criterios.reduce((s, c) => s + (Number(pontos[c.id] ?? '') || 0), 0)
  const maxRubrica = criterios.reduce((s, c) => s + c.pontosMax, 0)
  const notaPrevista = maxRubrica > 0 ? Number(((somaRubrica / maxRubrica) * 10).toFixed(2)) : 0
  const rubricaCompleta = criterios.every((c) => {
    const v = Number(pontos[c.id] ?? '')
    return (pontos[c.id] ?? '') !== '' && Number.isFinite(v) && v >= 0 && v <= c.pontosMax
  })

  const corrigir = () => {
    if (!atual) return
    let corpo: { aplicacaoId: number; questaoId: number; nota?: number; rubrica?: Record<string, number>; parecer?: string }
    if (usaRubrica) {
      if (!rubricaCompleta) { toast('Pontue todos os critérios dentro do máximo de cada um.', 'danger'); return }
      const r: Record<string, number> = {}
      for (const c of criterios) r[c.id] = Number(pontos[c.id])
      corpo = { aplicacaoId: atual.aplicacaoId, questaoId: atual.questaoId, rubrica: r }
    } else {
      const n = Number(nota.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > 10) { toast('A nota precisa estar entre 0 e 10.', 'danger'); return }
      corpo = { aplicacaoId: atual.aplicacaoId, questaoId: atual.questaoId, nota: n }
    }
    mut.corrigir.mutate(
      { ...corpo, ...(parecer ? { parecer } : {}) },
      {
        onSuccess: (r) => {
          setNota(''); setParecer(''); setPontos({})
          toast(
            r.aplicacao?.notaFinal != null
              ? `Corrigida — nota final ${r.aplicacao.notaFinal}.`
              : 'Corrigida. A prova ainda tem dissertativas pendentes.',
            'success',
          )
        },
        onError: (e: any) => toast(e?.message ?? 'Não foi possível salvar a correção.', 'danger'),
      },
    )
  }

  return (
    <Page
      title="Correção de dissertativas"
      {...(itens.length > 0 ? { description: `${itens.length} resposta(s) na fila` } : {})}
      actions={<Button variant="ghost" onClick={() => navigate('/aca/provas')}><ChevronLeft size={16} /> Voltar</Button>}
    >
      {fila.isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : !atual ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={24} />}
            title="Fila vazia"
            description="Nenhuma dissertativa aguardando correção. As provas só entram aqui depois de entregues."
          />
        </Card>
      ) : (
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="lg:col-span-2 space-y-4">
            <Card class="space-y-3">
              <div class="flex items-center gap-2 flex-wrap">
                <Badge tone="neutral">{atual.prova}</Badge>
                <span class="text-sm font-medium text-fg">{atual.candidato}</span>
              </div>
              <div>
                <div class="text-xs font-medium text-fg-muted mb-1">Enunciado</div>
                <p class="text-sm text-fg">{atual.enunciado}</p>
              </div>
              <div>
                <div class="text-xs font-medium text-fg-muted mb-1">Resposta do candidato</div>
                {atual.resposta?.trim() ? (
                  <div class="text-sm text-fg whitespace-pre-wrap rounded-lg border border-border bg-surface-2/40 p-3 max-h-[26rem] overflow-auto">
                    {atual.resposta}
                  </div>
                ) : (
                  <p class="text-sm text-fg-subtle italic rounded-lg border border-border p-3">
                    Em branco — o candidato entregou sem responder esta questão.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <div class="space-y-4">
            <Card class="space-y-3 h-fit">
              <h2 class="text-sm font-semibold text-fg flex items-center gap-2"><PenLine size={15} /> Avaliar</h2>
              {usaRubrica ? (
                <div class="space-y-2">
                  <p class="text-xs text-fg-muted">
                    Esta questão é corrigida por critérios. Pontue cada um: a nota sai da soma, e é isso que
                    o candidato vê se pedir revisão.
                  </p>
                  {criterios.map((c) => {
                    const v = pontos[c.id] ?? ''
                    const num = Number(v)
                    const invalido = v !== '' && (!Number.isFinite(num) || num < 0 || num > c.pontosMax)
                    return (
                      <div key={c.id} class="flex items-start gap-2">
                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-fg">{c.criterio}</div>
                          {c.descricao && <div class="text-[11px] text-fg-subtle">{c.descricao}</div>}
                        </div>
                        <div class="w-20 shrink-0">
                          <Input
                            type="number" step="0.5" min="0" max={c.pontosMax} value={v}
                            {...(invalido ? { error: `máx ${c.pontosMax}` } : {})}
                            onInput={(e) => {
                              const val = (e.target as HTMLInputElement).value
                              setPontos((p) => ({ ...p, [c.id]: val }))
                            }}
                          />
                        </div>
                        <span class="text-xs text-fg-subtle w-10 pt-2">/ {c.pontosMax}</span>
                      </div>
                    )
                  })}
                  <div class="flex items-center justify-between border-t border-border pt-2 text-sm">
                    <span class="text-fg-muted">{somaRubrica} de {maxRubrica} ponto(s)</span>
                    <span class="text-fg font-semibold">nota {notaPrevista}</span>
                  </div>
                </div>
              ) : (
                <Input
                  label="Nota (0 a 10)" type="number" step="0.1" min="0" max="10" value={nota}
                  onInput={(e) => setNota((e.target as HTMLInputElement).value)}
                />
              )}
              <Textarea
                label="Parecer" rows={4} value={parecer}
                placeholder="O que sustentou a nota…"
                hint="Fica registrado com a correção — é o que responde a um recurso do candidato."
                onInput={(e) => setParecer((e.target as HTMLTextAreaElement).value)}
              />
              <Button
                class="w-full" onClick={corrigir}
                disabled={(usaRubrica ? !rubricaCompleta : !nota.trim()) || mut.corrigir.isPending}
              >
                <CheckCircle2 size={16} /> Salvar e ir para a próxima
              </Button>
            </Card>

            <Card class="!p-4 text-xs text-fg-muted">
              A nota da dissertativa entra ponderada pelo peso da questão dentro da prova. A prova só passa a
              <strong class="text-fg"> corrigida</strong> quando não sobra nenhuma dissertativa sem nota — até lá, a
              nota final fica em aberto de propósito.
            </Card>
          </div>
        </div>
      )}
    </Page>
  )
}
