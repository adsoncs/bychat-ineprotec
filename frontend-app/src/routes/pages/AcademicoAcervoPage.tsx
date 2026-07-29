import { useState } from 'preact/hooks'
import { Archive, ShieldCheck, Tags, Trash2, FileCheck2, AlertTriangle, Fingerprint } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import {
  usePanoramaAcervo, useTabelaTemporalidade, useElegiveisEliminacao,
  useTermosEliminacao, useAcervoMut,
} from '@/hooks/useAcaRegulatorio'

// Acervo acadêmico (Portaria MEC 315/2018).
//
// Duas obrigações que a portaria cria e que quase todo acervo digitalizado
// ignora: cada documento precisa de uma classificação com prazo de guarda, e
// eliminar exige termo com comissão — não é apagar arquivo.

const TABS = [
  { id: 'panorama', label: 'Panorama' },
  { id: 'temporalidade', label: 'Tabela de temporalidade' },
  { id: 'eliminacao', label: 'Eliminação' },
  { id: 'termos', label: 'Termos emitidos' },
] as const

type Aba = (typeof TABS)[number]['id']

function Kpi({ icon, label, value, hint, tone }: { icon: any; label: string; value: number | string; hint?: string; tone?: string }) {
  return (
    <Card class="space-y-1">
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icon}<span>{label}</span></div>
      <div class={`text-2xl font-semibold ${tone ?? 'text-fg'}`}>{value}</div>
      {hint && <div class="text-[11px] text-fg-subtle">{hint}</div>}
    </Card>
  )
}

export function AcademicoAcervoPage() {
  const [aba, setAba] = useState<Aba>('panorama')
  const panorama = usePanoramaAcervo()
  const tabela = useTabelaTemporalidade()
  const elegiveis = useElegiveisEliminacao()
  const termos = useTermosEliminacao()
  const mut = useAcervoMut()

  const [selecao, setSelecao] = useState<number[]>([])
  const [termo, setTermo] = useState({ comissao: '', responsavel: '', observacao: '' })

  const p = panorama.data
  const alternar = (id: number) => setSelecao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const classificar = () => {
    mut.classificar.mutate({}, {
      onSuccess: (r) => toast(
        r.classificados > 0
          ? `${r.classificados} documento(s) classificado(s).`
          : 'Nada a classificar — todo o acervo já tem prazo de guarda.',
        'success',
      ),
      onError: (e: any) => toast(e?.message ?? 'Falha ao classificar.', 'danger'),
    })
  }

  const eliminar = () => {
    if (selecao.length === 0 || !termo.comissao.trim()) return
    mut.eliminar.mutate(
      {
        arquivoIds: selecao, comissao: termo.comissao,
        ...(termo.responsavel ? { responsavel: termo.responsavel } : {}),
        ...(termo.observacao ? { observacao: termo.observacao } : {}),
      },
      {
        onSuccess: (r) => {
          toast(`Termo ${r.termo.numero} emitido — ${r.eliminados} documento(s) eliminado(s).`, 'success')
          setSelecao([]); setTermo({ comissao: '', responsavel: '', observacao: '' })
        },
        onError: (e: any) => toast(e?.message ?? 'Falha na eliminação.', 'danger'),
      },
    )
  }

  return (
    <Page
      title="Acervo acadêmico"
      description="Classificação, temporalidade e eliminação com termo — Portaria MEC nº 315/2018."
      actions={
        aba === 'panorama' && (p?.semClassificacao ?? 0) > 0 ? (
          <Button onClick={classificar} disabled={mut.classificar.isPending}>
            <Tags size={16} /> Classificar pendentes
          </Button>
        ) : undefined
      }
    >
      <div class="flex gap-1 mb-4 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${aba === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
            onClick={() => setAba(t.id)}
          >
            {t.label}
            {t.id === 'eliminacao' && (elegiveis.data?.total ?? 0) > 0 && (
              <span class="ml-1.5 text-[10px] rounded-full bg-warning/15 text-warning px-1.5 py-0.5">{elegiveis.data?.total}</span>
            )}
          </button>
        ))}
      </div>

      {aba === 'panorama' && (
        panorama.isLoading || !p ? <Skeleton class="h-40 w-full" /> : (
          <div class="space-y-4">
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={<Archive size={14} />} label="Documentos no acervo" value={p.total} />
              <Kpi
                icon={<Tags size={14} />} label="Sem classificação" value={p.semClassificacao}
                tone={p.semClassificacao > 0 ? 'text-warning' : 'text-fg'}
                hint="Sem prazo de guarda definido."
              />
              <Kpi
                icon={<Fingerprint size={14} />} label="Sem hash" value={p.semHash}
                tone={p.semHash > 0 ? 'text-warning' : 'text-fg'}
                hint="Sem hash não há como provar que o arquivo não foi alterado."
              />
              <Kpi
                icon={<AlertTriangle size={14} />} label="Prazo vencido" value={p.vencidos}
                tone={p.vencidos > 0 ? 'text-danger' : 'text-fg'}
                hint="Elegíveis para eliminação com termo."
              />
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={<ShieldCheck size={14} />} label="Guarda permanente" value={p.permanentes} hint="Nunca podem ser eliminados." />
              <Kpi icon={<FileCheck2 size={14} />} label="Classificados" value={p.classificados} />
              <Kpi icon={<Fingerprint size={14} />} label="Com hash" value={p.comHash} />
              <Kpi icon={<Trash2 size={14} />} label="Eliminados" value={p.eliminados} hint="Registro preservado no termo." />
            </div>
            {p.semClassificacao > 0 && (
              <Card class="!p-4 border-warning/40 bg-warning/5 text-sm text-fg-muted">
                Há <strong class="text-fg">{p.semClassificacao}</strong> documento(s) sem classificação. Sem ela, o
                documento não tem prazo de guarda — e numa fiscalização não há como demonstrar que a instituição
                sabe o que guarda e por quanto tempo. A classificação automática usa o tipo do arquivo; o que não
                for reconhecido vira <strong class="text-fg">permanente</strong>, porque errar para o lado de guardar
                é reversível e eliminar não é.
              </Card>
            )}
          </div>
        )
      )}

      {aba === 'temporalidade' && (
        tabela.isLoading ? <Skeleton class="h-64 w-full" /> : (
          <Card class="p-0 overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-xs text-fg-muted border-b border-border">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Tipo de documento</th>
                  <th class="text-left px-4 py-2 font-medium">Classificação</th>
                  <th class="text-left px-4 py-2 font-medium">Temporalidade</th>
                  <th class="text-right px-4 py-2 font-medium">Prazo de guarda</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {(tabela.data?.tabela ?? []).map((l) => (
                  <tr key={l.tipo}>
                    <td class="px-4 py-2 text-fg">{l.tipo}</td>
                    <td class="px-4 py-2 text-fg-muted">{l.classificacao}</td>
                    <td class="px-4 py-2">
                      <Badge tone={l.temporalidade === 'PERMANENTE' ? 'info' : 'neutral'}>
                        {l.temporalidade === 'PERMANENTE' ? 'Permanente' : 'Temporário'}
                      </Badge>
                    </td>
                    <td class="px-4 py-2 text-right text-fg-muted">
                      {l.prazoGuardaAnos == null ? '—' : `${l.prazoGuardaAnos} ano(s)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {aba === 'eliminacao' && (
        elegiveis.isLoading ? <Skeleton class="h-48 w-full" /> : (elegiveis.data?.arquivos ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldCheck size={24} />}
              title="Nenhum documento elegível"
              description="Nada no acervo passou do prazo de guarda. Documentos de guarda permanente nunca aparecem aqui."
            />
          </Card>
        ) : (
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card class="lg:col-span-2 p-0 overflow-hidden">
              <div class="px-4 py-2.5 border-b border-border flex items-center justify-between">
                <span class="text-sm font-medium text-fg">Prazo de guarda vencido</span>
                <button
                  class="text-xs text-accent hover:underline"
                  onClick={() => setSelecao(selecao.length === (elegiveis.data?.arquivos.length ?? 0) ? [] : (elegiveis.data?.arquivos ?? []).map((a) => a.id))}
                >
                  {selecao.length === (elegiveis.data?.arquivos.length ?? 0) ? 'Limpar seleção' : 'Selecionar todos'}
                </button>
              </div>
              <div class="divide-y divide-border max-h-[28rem] overflow-auto">
                {(elegiveis.data?.arquivos ?? []).map((a) => (
                  <label key={a.id} class="px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2 cursor-pointer">
                    <input type="checkbox" checked={selecao.includes(a.id)} onChange={() => alternar(a.id)} />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm text-fg truncate">{a.nome}</div>
                      <div class="text-xs text-fg-subtle">
                        {a.tipo} · {a.classificacao ?? 'sem classificação'}
                        {a.guardaAte && ` · guarda até ${new Date(a.guardaAte).toLocaleDateString('pt-BR')}`}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </Card>

            <Card class="space-y-3 h-fit">
              <h2 class="text-sm font-semibold text-fg">Termo de eliminação</h2>
              <p class="text-xs text-fg-muted">
                A eliminação não apaga o rastro: gera um termo com a lista do que saiu e quem decidiu. É esse
                documento que a instituição apresenta se perguntarem pelo que não existe mais.
              </p>
              <Input
                label="Comissão responsável" value={termo.comissao}
                placeholder="Ex.: Comissão Permanente de Avaliação de Documentos"
                onInput={(e) => setTermo((t) => ({ ...t, comissao: (e.target as HTMLInputElement).value }))}
              />
              <Input
                label="Responsável" value={termo.responsavel} placeholder="Quem assina"
                onInput={(e) => setTermo((t) => ({ ...t, responsavel: (e.target as HTMLInputElement).value }))}
              />
              <Textarea
                label="Observação" rows={3} value={termo.observacao}
                onInput={(e) => setTermo((t) => ({ ...t, observacao: (e.target as HTMLTextAreaElement).value }))}
              />
              <Button
                variant="danger" class="w-full"
                onClick={eliminar}
                disabled={selecao.length === 0 || !termo.comissao.trim() || mut.eliminar.isPending}
              >
                <Trash2 size={16} /> Eliminar {selecao.length > 0 ? `${selecao.length} documento(s)` : ''}
              </Button>
            </Card>
          </div>
        )
      )}

      {aba === 'termos' && (
        termos.isLoading ? <Skeleton class="h-40 w-full" /> : (termos.data?.termos ?? []).length === 0 ? (
          <Card><EmptyState icon={<FileCheck2 size={24} />} title="Nenhum termo emitido" description="Nenhuma eliminação foi realizada até aqui." /></Card>
        ) : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {(termos.data?.termos ?? []).map((t) => (
              <div key={t.id} class="px-4 py-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg">Termo {t.numero}</span>
                  <Badge tone="neutral">{t.qtdItens} documento(s)</Badge>
                  <span class="text-xs text-fg-subtle">{new Date(t.dataTermo).toLocaleString('pt-BR')}</span>
                </div>
                <div class="text-xs text-fg-muted mt-0.5">
                  {t.comissao}{t.responsavel ? ` · ${t.responsavel}` : ''}
                </div>
                {t.observacao && <div class="text-xs text-fg-subtle mt-1">{t.observacao}</div>}
              </div>
            ))}
          </Card>
        )
      )}
    </Page>
  )
}
