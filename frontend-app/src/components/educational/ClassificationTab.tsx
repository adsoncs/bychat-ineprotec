import { useState } from 'preact/hooks'
import { Trophy, Megaphone, AlertTriangle } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useClassificacao, useClassificacaoMut } from '@/hooks/useClassificacao'

// Classificação do processo seletivo. Fase 4 da consolidação ERP × Portal: esta
// decisão morava também em Acadêmico › Processo Seletivo, com régua própria.
// Aqui o corte é o do tipo de avaliação e cada mudança fica no histórico.

const TOM: Record<string, any> = {
  inscrito: 'neutral', pago_taxa: 'info', classificado: 'success',
  convocado: 'accent', matriculado: 'success', desistente: 'neutral', reprovado: 'danger',
}
const ROTULO: Record<string, string> = {
  inscrito: 'Inscrito', pago_taxa: 'Taxa paga', classificado: 'Classificado',
  convocado: 'Convocado', matriculado: 'Matriculado', desistente: 'Desistente', reprovado: 'Reprovado',
}

export function ClassificationTab({ processId }: { processId: number }) {
  const { data, isLoading } = useClassificacao(processId)
  const mut = useClassificacaoMut(processId)
  const [criterio, setCriterio] = useState('inscricao')
  const [vagas, setVagas] = useState('')

  const proc = data?.process
  const candidatos = data?.registrations ?? []
  const resumo = data?.resumo
  const porStatus = resumo?.porStatus ?? {}

  const classificar = () => {
    mut.classificar.mutate({ criterio }, {
      onSuccess: (r) => {
        const partes = [`${r.classificados} classificado(s)`, `${r.reprovados} reprovado(s)`]
        if (r.preservados) partes.push(`${r.preservados} já convocado(s)/matriculado(s), mantidos`)
        if (r.semNota) partes.push(`${r.semNota} ainda sem nota, fora da lista`)
        toast(partes.join(' · '), 'success')
      },
      onError: (e: any) => toast(e?.message ?? 'Falha ao classificar.', 'danger'),
    })
  }

  const convocar = () => {
    mut.convocar.mutate({ qtdVagas: Number(vagas) }, {
      onSuccess: (r) => {
        toast(
          r.vagasOciosas > 0
            ? `${r.convocados} convocado(s). Faltaram ${r.vagasOciosas} — não há classificados suficientes.`
            : `${r.convocados} candidato(s) convocado(s).`,
          'success',
        )
        setVagas('')
      },
      onError: (e: any) => toast(e?.message ?? 'Falha ao convocar.', 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Trophy size={16} /> Classificar</div>

        <p class="text-xs text-fg-subtle">
          Ordena por nota e aplica o corte deste processo
          {proc?.corte != null
            ? <> — <strong class="text-fg">{proc.corte}</strong> ({proc.criterioCorte}). Ofertas com corte próprio usam o delas.</>
            : <> — sem corte definido ({proc?.criterioCorte}): todos com nota entram na lista.</>}
        </p>

        <div class="flex flex-wrap gap-2 items-end">
          <Select label="Critério de desempate" value={criterio} onChange={(e: any) => setCriterio(e.currentTarget.value)} class="!w-56">
            <option value="inscricao">Ordem de inscrição</option>
            <option value="nota">Só a nota</option>
          </Select>
          <Button size="sm" variant="primary" loading={mut.classificar.isPending} onClick={classificar}>Classificar</Button>
        </div>

        {!!resumo?.semNota && (
          <p class="text-xs text-warning flex items-start gap-1.5">
            <AlertTriangle size={13} class="mt-0.5 shrink-0" />
            <span>
              {resumo.semNota} candidato(s) ainda sem nota. Eles ficam de fora da classificação —
              não são reprovados por falta de avaliação.
            </span>
          </p>
        )}

        <div class="flex flex-wrap gap-2 items-end pt-3 border-t border-border">
          <Input class="!w-36" type="number" min="1" label="Vagas a convocar" value={vagas} onInput={(e: any) => setVagas(e.currentTarget.value)} />
          <Button size="sm" variant="secondary" disabled={!vagas || mut.convocar.isPending} loading={mut.convocar.isPending} onClick={convocar}>
            <Megaphone size={14} /> Convocar
          </Button>
          <span class="text-xs text-fg-muted">
            Classificados: {porStatus.classificado ?? 0} · Convocados: {porStatus.convocado ?? 0}
            {' '}· Matriculados: {porStatus.matriculado ?? 0} · Reprovados: {porStatus.reprovado ?? 0}
          </span>
        </div>
        <p class="text-xs text-fg-subtle">
          Convocar chama, na ordem da classificação, quem ainda não foi chamado. Reclassificar não
          rebaixa quem já foi convocado ou matriculado.
        </p>
      </Card>

      {isLoading ? <Skeleton class="h-40 w-full" /> : candidatos.length === 0 ? (
        <p class="text-sm text-fg-muted">Nenhuma inscrição neste processo ainda.</p>
      ) : (
        <Card class="p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-2 text-xs text-fg-muted">
                <tr>
                  <th class="text-left p-2 w-14">#</th>
                  <th class="text-left p-2">Candidato</th>
                  <th class="text-left p-2">Oferta</th>
                  <th class="p-2 w-24 text-center">Nota</th>
                  <th class="p-2 w-20 text-center">Corte</th>
                  <th class="p-2 w-28 text-center">Situação</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {candidatos.map((c) => (
                  <tr key={c.id} class={c.notaClassificacao === null ? 'opacity-60' : undefined}>
                    <td class="p-2 font-medium">{c.posicaoClassificacao ? `${c.posicaoClassificacao}º` : '—'}</td>
                    <td class="p-2">{c.lead?.nome ?? '—'}</td>
                    <td class="p-2 text-fg-muted text-xs">{c.offering?.nome ?? '—'}</td>
                    <td class="p-2 text-center">
                      {c.notaClassificacao != null
                        ? c.notaClassificacao.toFixed(1)
                        : <span class="text-xs text-fg-subtle">sem nota</span>}
                    </td>
                    <td class="p-2 text-center text-xs text-fg-muted">{c.corteAplicavel ?? '—'}</td>
                    <td class="p-2 text-center"><Badge tone={TOM[c.status]}>{ROTULO[c.status] ?? c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
