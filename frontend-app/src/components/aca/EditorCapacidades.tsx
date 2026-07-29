import { useState } from 'preact/hooks'
import { Plus, Trash2, Target, Copy } from 'lucide-preact'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { useCapacidades, useCompetenciaMut, CAPACIDADE_TIPO } from '@/hooks/useAcaCompetencia'

// Desenho das capacidades e critérios de um componente.
//
// É o trabalho mais caro da implantação por competências — por isso existe a
// cópia de outro componente: disciplina equivalente em outra matriz costuma
// servir com ajuste, e reescrever tudo à mão é o que faz a escola desistir.

export function EditorCapacidades({ componenteId, editavel }: { componenteId: number; editavel: boolean }) {
  const [aberto, setAberto] = useState(false)
  const { data, isLoading } = useCapacidades(aberto ? componenteId : null)
  const mut = useCompetenciaMut()

  const [nova, setNova] = useState({ tipo: 'TECNICA', descricao: '' })
  const [criterioDe, setCriterioDe] = useState<number | null>(null)
  const [fk, setFk] = useState({ descricao: '', evidencia: '', peso: 'CRITICO' })
  const [origemCopia, setOrigemCopia] = useState('')

  const capacidades = data?.capacidades ?? []

  if (!aberto) {
    return (
      <button type="button" class="text-[11px] text-accent hover:underline mt-1 ml-3" onClick={() => setAberto(true)}>
        Capacidades e critérios
      </button>
    )
  }

  const criarCapacidade = () => {
    mut.criarCapacidade.mutate(
      { componenteId, tipo: nova.tipo, descricao: nova.descricao },
      {
        onSuccess: () => { setNova({ tipo: nova.tipo, descricao: '' }); toast('Capacidade adicionada.', 'success') },
        onError: (e: any) => toast(e?.message ?? 'Falha ao adicionar.', 'danger'),
      },
    )
  }

  const criarCriterio = (capacidadeId: number) => {
    mut.criarCriterio.mutate(
      { capacidadeId, descricao: fk.descricao, ...(fk.evidencia ? { evidencia: fk.evidencia } : {}), peso: fk.peso },
      {
        onSuccess: () => { setFk({ descricao: '', evidencia: '', peso: 'CRITICO' }); setCriterioDe(null); toast('Critério adicionado.', 'success') },
        onError: (e: any) => toast(e?.message ?? 'Falha ao adicionar.', 'danger'),
      },
    )
  }

  const copiar = () => {
    const origem = Number(origemCopia)
    if (!origem) return
    mut.copiarCapacidades.mutate({ destinoId: componenteId, origemComponenteId: origem }, {
      onSuccess: (r) => { setOrigemCopia(''); toast(`${r.capacidades} capacidade(s) e ${r.criterios} critério(s) copiados.`, 'success') },
      onError: (e: any) => toast(e?.message ?? 'Falha ao copiar.', 'danger'),
    })
  }

  return (
    <div class="mt-2 bg-surface-2/40 rounded-md p-3 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-xs text-fg-muted">
          <Target size={13} />
          <span>
            {capacidades.length} capacidade(s) · <strong class="text-fg">{data?.criticos ?? 0}</strong> critério(s) crítico(s)
          </span>
        </div>
        <button class="text-[11px] text-fg-subtle hover:text-fg" onClick={() => setAberto(false)}>fechar</button>
      </div>

      {isLoading ? (
        <Skeleton class="h-20 w-full" />
      ) : (
        <>
          {capacidades.length === 0 && (
            <p class="text-xs text-fg-subtle">
              Nenhuma capacidade. Sem elas, a avaliação por competências não tem o que apurar neste componente.
            </p>
          )}

          {capacidades.map((cap) => (
            <div key={cap.id} class="rounded-md border border-border bg-surface p-2.5 space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-start gap-2 min-w-0">
                  <Badge tone="neutral">{CAPACIDADE_TIPO[cap.tipo] ?? cap.tipo}</Badge>
                  <span class="text-sm text-fg">{cap.descricao}</span>
                </div>
                {editavel && (
                  <button
                    class="text-fg-subtle hover:text-danger shrink-0"
                    onClick={() => mut.excluirCapacidade.mutate(cap.id, {
                      onSuccess: () => toast('Capacidade removida.', 'success'),
                      onError: (e: any) => toast(e?.message ?? 'Falha ao remover.', 'danger'),
                    })}
                  ><Trash2 size={13} /></button>
                )}
              </div>

              {cap.criterios.length > 0 && (
                <ul class="space-y-1">
                  {cap.criterios.map((k) => (
                    <li key={k.id} class="flex items-start justify-between gap-2 text-xs">
                      <div class="min-w-0">
                        <div class="flex items-start gap-1.5">
                          {k.peso === 'CRITICO'
                            ? <Badge tone="danger">crítico</Badge>
                            : <Badge tone="neutral">desejável</Badge>}
                          <span class="text-fg">{k.descricao}</span>
                        </div>
                        {k.evidencia && <div class="text-fg-subtle mt-0.5 ml-1">Observar: {k.evidencia}</div>}
                      </div>
                      {editavel && (
                        <button
                          class="text-fg-subtle hover:text-danger shrink-0"
                          onClick={() => mut.excluirCriterio.mutate(k.id)}
                        ><Trash2 size={12} /></button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {editavel && (
                criterioDe === cap.id ? (
                  <div class="space-y-2 border-t border-border pt-2">
                    <Input
                      label="Critério" value={fk.descricao} placeholder="O que o aluno precisa demonstrar"
                      onInput={(e) => setFk({ ...fk, descricao: (e.target as HTMLInputElement).value })}
                    />
                    <Input
                      label="Evidência a observar" value={fk.evidencia} placeholder="Como o docente verifica"
                      onInput={(e) => setFk({ ...fk, evidencia: (e.target as HTMLInputElement).value })}
                    />
                    <Select
                      label="Peso" value={fk.peso}
                      hint="Crítico: sem atender, o aluno não está apto — independentemente do resto."
                      onChange={(e) => setFk({ ...fk, peso: (e.target as HTMLSelectElement).value })}
                    >
                      <option value="CRITICO">Crítico</option>
                      <option value="DESEJAVEL">Desejável</option>
                    </Select>
                    <div class="flex gap-2">
                      <Button size="sm" onClick={() => criarCriterio(cap.id)} disabled={!fk.descricao.trim() || mut.criarCriterio.isPending}>
                        Adicionar critério
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCriterioDe(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <button class="text-[11px] text-accent hover:underline" onClick={() => setCriterioDe(cap.id)}>
                    + critério
                  </button>
                )
              )}
            </div>
          ))}

          {editavel && (
            <div class="space-y-2 border-t border-border pt-3">
              <div class="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2">
                <Select label="Tipo" value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: (e.target as HTMLSelectElement).value })}>
                  {Object.entries(CAPACIDADE_TIPO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Textarea
                  label="Nova capacidade" rows={2} value={nova.descricao}
                  placeholder="Ex.: Operar estação total em levantamento planimétrico"
                  onInput={(e) => setNova({ ...nova, descricao: (e.target as HTMLTextAreaElement).value })}
                />
              </div>
              <div class="flex flex-wrap items-end gap-2">
                <Button size="sm" onClick={criarCapacidade} disabled={!nova.descricao.trim() || mut.criarCapacidade.isPending}>
                  <Plus size={14} /> Capacidade
                </Button>
                {capacidades.length === 0 && (
                  <div class="flex items-end gap-1.5">
                    <div class="w-32">
                      <Input
                        label="Copiar do componente" inputMode="numeric" value={origemCopia} placeholder="id"
                        onInput={(e) => setOrigemCopia((e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <Button size="sm" variant="secondary" onClick={copiar} disabled={!origemCopia || mut.copiarCapacidades.isPending}>
                      <Copy size={14} /> Copiar
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
