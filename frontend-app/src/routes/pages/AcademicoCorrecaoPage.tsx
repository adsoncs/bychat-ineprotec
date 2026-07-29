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

  const itens = fila.data?.fila ?? []
  const atual = itens[0]

  const corrigir = () => {
    if (!atual) return
    const n = Number(nota.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > 10) { toast('A nota precisa estar entre 0 e 10.', 'danger'); return }
    mut.corrigir.mutate(
      { aplicacaoId: atual.aplicacaoId, questaoId: atual.questaoId, nota: n, ...(parecer ? { parecer } : {}) },
      {
        onSuccess: (r) => {
          setNota(''); setParecer('')
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
              <Input
                label="Nota (0 a 10)" type="number" step="0.1" min="0" max="10" value={nota}
                onInput={(e) => setNota((e.target as HTMLInputElement).value)}
              />
              <Textarea
                label="Parecer" rows={4} value={parecer}
                placeholder="O que sustentou a nota…"
                hint="Fica registrado com a correção — é o que responde a um recurso do candidato."
                onInput={(e) => setParecer((e.target as HTMLTextAreaElement).value)}
              />
              <Button class="w-full" onClick={corrigir} disabled={!nota.trim() || mut.corrigir.isPending}>
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
