import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Repeat, AlertTriangle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { useVinculo, useMoverVinculo, SITUACAO_LABEL, SITUACAO_TONE, type VinculoSituacao } from '@/hooks/useAcaFundacao'
import { toast } from '@/lib/toast'

// Movimentação de situação em tela dedicada. Só aparecem os destinos que a
// máquina de estados aceita a partir da situação atual — o que não é permitido
// nem chega a ser oferecido.

/** O que cada destino provoca, em linguagem de secretaria. */
const EFEITO: Partial<Record<VinculoSituacao, string>> = {
  ATIVO: 'O aluno passa a constar como cursando; volta a receber cobrança e comunicação.',
  TRANCADO: 'Vínculo preservado, sem cursar no período. Confira a política de títulos futuros.',
  EVADIDO: 'Marca abandono. Costuma ser precedido de tentativa de retenção.',
  TRANSFERIDO: 'Encerra o vínculo por transferência externa — gere a guia e o histórico.',
  CANCELADO: 'Encerra o vínculo por desistência/rescisão. Verifique multa e títulos futuros.',
  FORMADO: 'Conclusão do curso: registra a data e habilita a esteira de diplomação.',
  DIPLOMADO: 'Diploma registrado e publicado.',
  FALECIDO: 'Encerra com sensibilidade: suspende cobrança e disparos automáticos.',
}

export function AcademicoVinculoMoverPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const { data, isLoading } = useVinculo(id)
  const mover = useMoverVinculo()

  const [para, setPara] = useState<VinculoSituacao | ''>('')
  const [motivo, setMotivo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [dataEfeito, setDataEfeito] = useState(new Date().toISOString().slice(0, 10))

  const voltar = () => navigate(`/aca/vinculos/${id}`)

  if (isLoading) return <Skeleton class="h-64 w-full" />
  if (!data?.vinculo) {
    return (
      <Page title="Vínculo não encontrado">
        <Card class="text-sm text-fg-subtle text-center py-8">O vínculo #{id} não foi encontrado.</Card>
      </Page>
    )
  }

  const v = data.vinculo
  const destinos = data.proximasSituacoes ?? []
  const nome = v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`
  const irreversivel = para === 'FALECIDO' || para === 'CANCELADO' || para === 'TRANSFERIDO'

  function confirmar() {
    if (!para) { toast('Escolha a situação de destino', 'warning'); return }
    if (!motivo.trim()) { toast('Informe o motivo — ele fica registrado no histórico', 'warning'); return }
    mover.mutate(
      // exactOptionalPropertyTypes: observação só entra quando preenchida.
      { id, para, motivo: motivo.trim(), dataEfeito, ...(observacao.trim() ? { observacao: observacao.trim() } : {}) },
      {
        onSuccess: () => { toast(`Situação alterada para ${SITUACAO_LABEL[para]}`, 'success'); voltar() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title="Movimentar situação"
      description={`${nome} · vínculo #${v.id}`}
      actions={
        <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={voltar}>
          <ChevronLeft size={15} /> Voltar
        </button>
      }
    >
      <Card class="max-w-3xl space-y-4">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-fg-muted">Situação atual:</span>
          <Badge tone={SITUACAO_TONE[v.situacao]}>{SITUACAO_LABEL[v.situacao]}</Badge>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">Nova situação</div>
          {destinos.length === 0 ? (
            <p class="text-sm text-fg-subtle">
              Esta é uma situação terminal — não há movimentação possível a partir dela.
            </p>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {destinos.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPara(s)}
                  class={cn(
                    'text-left px-3 py-2 rounded-md border transition-colors',
                    para === s ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-3',
                  )}
                >
                  <div class="text-sm text-fg">{SITUACAO_LABEL[s]}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {para && (
          <>
            {EFEITO[para] && (
              <div class="text-xs text-fg-muted bg-surface-2/60 rounded-md px-3 py-2">{EFEITO[para]}</div>
            )}
            {irreversivel && (
              <div class="flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/30 rounded-md px-3 py-2">
                <AlertTriangle size={14} class="shrink-0 mt-0.5" />
                <span>
                  {SITUACAO_LABEL[para]} é uma situação terminal: só volta atrás por estorno da movimentação,
                  que fica registrado no histórico.
                </span>
              </div>
            )}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Motivo *"
                placeholder="Ex.: solicitação do aluno (protocolo 123)"
                value={motivo}
                onInput={(e) => setMotivo((e.target as HTMLInputElement).value)}
              />
              <Input
                type="date"
                label="Data do efeito"
                value={dataEfeito}
                onInput={(e) => setDataEfeito((e.target as HTMLInputElement).value)}
              />
            </div>
            <Textarea
              label="Observação"
              rows={3}
              placeholder="Detalhes que a secretaria precisa ver depois"
              value={observacao}
              onInput={(e) => setObservacao((e.target as HTMLTextAreaElement).value)}
            />

            <div class="flex gap-2">
              <Button variant="primary" onClick={confirmar} disabled={mover.isPending}>
                <Repeat size={14} /> {mover.isPending ? 'Movimentando…' : `Confirmar: ${SITUACAO_LABEL[para]}`}
              </Button>
              <Button variant="ghost" onClick={voltar}>Cancelar</Button>
            </div>
          </>
        )}
      </Card>
    </Page>
  )
}
