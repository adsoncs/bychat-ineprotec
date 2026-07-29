import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { HeartPulse, Plus, Check, X, Archive, Scale } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import {
  useRegimesEspeciais, useRegimeMut, useTiposRegime, REGIME_STATUS,
  type RegimeEspecial,
} from '@/hooks/useAcaRegimeEspecial'

// Regime de exercícios domiciliares (Dec-Lei 1.044/69 e Lei 6.202/75).
//
// No ensino superior não existe abono de faltas — o que existe é este amparo,
// e ele só vale quando DEFERIDO. Por isso o deferimento aparece aqui como ação
// destacada, com o aviso de que muda o cálculo de frequência do aluno.

const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

export function AcademicoRegimeEspecialPage() {
  const [, navigate] = useLocation()
  const [status, setStatus] = useState('')
  const { data, isLoading } = useRegimesEspeciais(status ? { status } : {})
  const tipos = useTiposRegime()
  const mut = useRegimeMut()

  const regimes = data?.regimes ?? []
  const aguardando = regimes.filter((r) => r.status === 'SOLICITADO').length
  const vigentes = regimes.filter((r) => r.vigente).length
  const labelTipo = (id: string) => tipos.data?.tipos.find((t) => t.id === id)?.label ?? id

  const decidir = (r: RegimeEspecial, novo: string) => {
    mut.status.mutate({ id: r.id, status: novo }, {
      onSuccess: () => toast(
        novo === 'DEFERIDO'
          ? 'Regime deferido — as faltas justificadas do período saem do cálculo de frequência.'
          : `Regime ${REGIME_STATUS[novo]?.label.toLowerCase() ?? novo}.`,
        'success',
      ),
      onError: (e: any) => toast(e?.message ?? 'Não foi possível alterar o status.', 'danger'),
    })
  }

  return (
    <Page
      title="Regime especial"
      description="Exercícios domiciliares e tratamento excepcional — o amparo legal que substitui a presença em sala."
      actions={
        <div class="flex items-center gap-2">
          <div class="w-48">
            <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
              <option value="">Todos os status</option>
              {Object.entries(REGIME_STATUS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
            </Select>
          </div>
          <Button onClick={() => navigate('/aca/regime-especial/novo')}>
            <Plus size={16} /> Novo regime
          </Button>
        </div>
      }
    >
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><HeartPulse size={14} /> Aguardando análise</div>
          <div class={`text-2xl font-semibold ${aguardando > 0 ? 'text-warning' : 'text-fg'}`}>{aguardando}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Check size={14} /> Vigentes hoje</div>
          <div class="text-2xl font-semibold text-fg">{vigentes}</div>
          <div class="text-[11px] text-fg-subtle">Alunos com o cálculo de frequência ajustado agora.</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Archive size={14} /> Total registrado</div>
          <div class="text-2xl font-semibold text-fg">{regimes.length}</div>
        </Card>
      </div>

      {isLoading ? (
        <Skeleton class="h-48 w-full" />
      ) : regimes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HeartPulse size={24} />}
            title="Nenhum regime registrado"
            description="Gestante, tratamento de saúde ou convocação militar: registre o amparo para que as faltas do período não reprovem o aluno."
            action={<Button onClick={() => navigate('/aca/regime-especial/novo')}><Plus size={16} /> Novo regime</Button>}
          />
        </Card>
      ) : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {regimes.map((r) => {
            const s = REGIME_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
            return (
              <div key={r.id} class="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">
                      {r.aluno?.lead?.nome ?? `Aluno #${r.alunoId}`}
                    </span>
                    {r.aluno?.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {r.aluno.ra}</span>}
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {r.vigente && <Badge tone="info">Vigente hoje</Badge>}
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5">
                    {labelTipo(r.tipo)} · {dia(r.dataInicio)} a {dia(r.dataFim)}
                    {r.amparoLegal && <span class="text-fg-subtle"> · {r.amparoLegal}</span>}
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  {r.status === 'SOLICITADO' && (
                    <>
                      <Button size="sm" onClick={() => decidir(r, 'DEFERIDO')} disabled={mut.status.isPending}>
                        <Check size={14} /> Deferir
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decidir(r, 'INDEFERIDO')} disabled={mut.status.isPending}>
                        <X size={14} /> Indeferir
                      </Button>
                    </>
                  )}
                  {r.status === 'DEFERIDO' && (
                    <Button size="sm" variant="ghost" onClick={() => decidir(r, 'ENCERRADO')} disabled={mut.status.isPending}>
                      <Archive size={14} /> Encerrar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/aca/regime-especial/${r.id}`)}>
                    Editar
                  </Button>
                </div>
              </div>
            )
          })}
        </Card>
      )}

      <Card class="!p-4 mt-4 text-xs text-fg-muted flex gap-2">
        <Scale size={16} class="shrink-0 mt-0.5 text-fg-subtle" />
        <span>
          Só o status <strong class="text-fg">Deferido</strong> altera o cálculo. E o que sai da base de frequência
          são as <strong class="text-fg">faltas</strong> do período amparado — as aulas que o aluno assistiu continuam
          contando a favor dele.
        </span>
      </Card>
    </Page>
  )
}
