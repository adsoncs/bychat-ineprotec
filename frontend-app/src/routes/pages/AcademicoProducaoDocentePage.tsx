import { useState } from 'preact/hooks'
import { School, Download, Clock, Wallet, FileSpreadsheet } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { useProducaoDocente } from '@/hooks/useAcaInteligencia'
import { money } from '@/hooks/useAcaBi'

// Fechamento mensal da produção docente. O que a folha precisa não é a lista de
// atividades — é o consolidado por professor, somando aula de diário com o que
// foi lançado à mão. Sem isso, alguém refaz a conta em planilha todo mês.

const competenciaAtual = () => new Date().toISOString().slice(0, 7)

export function AcademicoProducaoDocentePage() {
  const [competencia, setCompetencia] = useState(competenciaAtual())
  const { data, isLoading, isError, error } = useProducaoDocente(competencia)
  const [baixando, setBaixando] = useState(false)

  const baixarCsv = async () => {
    setBaixando(true)
    try {
      // O endpoint devolve texto puro; o download é montado no cliente para
      // preservar o cabeçalho de autenticação da sessão.
      const csv = await api.get<string>(`/admin/aca/producao-docente/csv?competencia=${competencia}`)
      const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `producao-docente-${competencia}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e: any) {
      toast(e?.message ?? 'Não foi possível gerar o CSV.', 'danger')
    } finally {
      setBaixando(false)
    }
  }

  const linhas = data?.linhas ?? []

  return (
    <Page
      title="Produção docente"
      description="Consolidação por competência: aulas do diário + atividades lançadas, no formato que o RH importa."
      actions={
        <div class="flex items-center gap-2">
          <div class="w-40">
            <Input type="month" value={competencia} onInput={(e) => setCompetencia((e.target as HTMLInputElement).value)} />
          </div>
          <Button variant="secondary" onClick={baixarCsv} disabled={baixando || linhas.length === 0}>
            <Download size={16} /> CSV
          </Button>
        </div>
      }
    >
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><School size={14} /> Docentes com produção</div>
          <div class="text-2xl font-semibold text-fg">{linhas.length}</div>
          <div class="text-[11px] text-fg-subtle">Quem não produziu no mês não vai para a folha.</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Clock size={14} /> Horas no período</div>
          <div class="text-2xl font-semibold text-fg">{data?.totalHoras ?? 0}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Wallet size={14} /> Total a pagar</div>
          <div class="text-2xl font-semibold text-fg">{money(data?.totalCentavos ?? 0)}</div>
        </Card>
      </div>

      {isError ? (
        <Card class="!p-4 border-danger/40 bg-danger/5 text-sm text-fg-muted">
          {(error as any)?.message ?? 'Não foi possível consolidar a competência.'}
        </Card>
      ) : isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : linhas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet size={24} />}
            title="Nenhuma produção nesta competência"
            description="Nenhuma aula registrada em diário nem atividade lançada no mês selecionado."
          />
        </Card>
      ) : (
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-fg-muted border-b border-border">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Docente</th>
                <th class="text-left px-4 py-2 font-medium">Turmas</th>
                <th class="text-right px-4 py-2 font-medium">Aulas</th>
                <th class="text-right px-4 py-2 font-medium">H. atividades</th>
                <th class="text-right px-4 py-2 font-medium">H. total</th>
                <th class="text-right px-4 py-2 font-medium">Valor-hora</th>
                <th class="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {linhas.map((l) => (
                <tr key={l.docenteId} class="hover:bg-surface-2">
                  <td class="px-4 py-2">
                    <div class="text-fg">{l.nome}</div>
                    <div class="text-[11px] text-fg-subtle">
                      {l.titulacao ?? 'sem titulação'} · {l.regime}
                    </div>
                  </td>
                  <td class="px-4 py-2">
                    {l.turmas.length === 0 ? (
                      <span class="text-xs text-fg-subtle">—</span>
                    ) : (
                      <div class="flex flex-wrap gap-1">
                        {l.turmas.slice(0, 3).map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
                        {l.turmas.length > 3 && <span class="text-[11px] text-fg-subtle">+{l.turmas.length - 3}</span>}
                      </div>
                    )}
                  </td>
                  <td class="px-4 py-2 text-right text-fg-muted">{l.aulasMinistradas}</td>
                  <td class="px-4 py-2 text-right text-fg-muted">{l.horasAtividades}</td>
                  <td class="px-4 py-2 text-right text-fg font-medium">{l.horasTotal}</td>
                  <td class="px-4 py-2 text-right text-fg-muted">{money(l.valorHoraCentavos)}</td>
                  <td class="px-4 py-2 text-right text-fg font-medium">{money(l.valorTotalCentavos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot class="border-t border-border">
              <tr>
                <td class="px-4 py-2 text-xs text-fg-muted" colSpan={4}>Total da competência</td>
                <td class="px-4 py-2 text-right text-fg font-semibold">{data?.totalHoras ?? 0}</td>
                <td />
                <td class="px-4 py-2 text-right text-fg font-semibold">{money(data?.totalCentavos ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </Page>
  )
}
