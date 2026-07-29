import { useState } from 'preact/hooks'
import { ShieldAlert, ShieldCheck, Save, Search, GraduationCap } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import {
  usePainelEnade, useEnadeMut, useRegularidadeAluno, ENADE_SITUACAO,
} from '@/hooks/useAcaRegulatorio'

// Regularidade no ENADE (RN-1104).
//
// A irregularidade é por omissão: aluno sem registro é irregular, não
// "indefinido". Isso importa porque a trava da colação de grau lê exatamente
// este painel — quem não aparece regular aqui não cola.

export function AcademicoEnadePage() {
  const painel = usePainelEnade()
  const mut = useEnadeMut()
  const [q, setQ] = useState('')
  const [soIrregulares, setSoIrregulares] = useState(true)
  const [alunoId, setAlunoId] = useState<number | null>(null)
  const detalhe = useRegularidadeAluno(alunoId)

  const anoAtual = new Date().getFullYear()
  const [f, setF] = useState({ ano: String(anoAtual), condicao: 'CONCLUINTE', situacao: 'INSCRITO', dispensaMotivo: '', observacao: '' })

  const linhas = (painel.data?.linhas ?? []).filter((l) => {
    if (soIrregulares && l.regular) return false
    if (!q.trim()) return true
    const alvo = `${l.nome} ${l.ra ?? ''}`.toLowerCase()
    return alvo.includes(q.trim().toLowerCase())
  })
  const selecionado = (painel.data?.linhas ?? []).find((l) => l.alunoId === alunoId)

  const registrar = () => {
    if (!alunoId) return
    mut.registrar.mutate(
      {
        alunoId, ano: Number(f.ano), condicao: f.condicao, situacao: f.situacao,
        ...(f.dispensaMotivo ? { dispensaMotivo: f.dispensaMotivo } : {}),
        ...(f.observacao ? { observacao: f.observacao } : {}),
      },
      {
        onSuccess: () => { toast('Registro do ciclo atualizado.', 'success'); setF((p) => ({ ...p, dispensaMotivo: '', observacao: '' })) },
        onError: (e: any) => toast(e?.message ?? 'Não foi possível registrar.', 'danger'),
      },
    )
  }

  return (
    <Page
      title="Regularidade ENADE"
      description="A trava da colação de grau lê este painel — quem não estiver regular aqui não cola."
      actions={
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs text-fg-muted">
            <input type="checkbox" checked={soIrregulares} onChange={(e) => setSoIrregulares((e.target as HTMLInputElement).checked)} />
            Só irregulares
          </label>
        </div>
      }
    >
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><ShieldAlert size={14} /> Irregulares</div>
          <div class={`text-2xl font-semibold ${(painel.data?.irregulares ?? 0) > 0 ? 'text-danger' : 'text-success'}`}>
            {painel.data?.irregulares ?? 0}
          </div>
          <div class="text-[11px] text-fg-subtle">Bloqueados para colação.</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><ShieldCheck size={14} /> Regulares</div>
          <div class="text-2xl font-semibold text-fg">{(painel.data?.total ?? 0) - (painel.data?.irregulares ?? 0)}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><GraduationCap size={14} /> Vínculos avaliados</div>
          <div class="text-2xl font-semibold text-fg">{painel.data?.total ?? 0}</div>
          <div class="text-[11px] text-fg-subtle">Ativos e formados.</div>
        </Card>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-3">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome ou RA…" />
          {painel.isLoading ? (
            <Skeleton class="h-64 w-full" />
          ) : linhas.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldCheck size={24} />}
                title={soIrregulares ? 'Nenhuma irregularidade' : 'Nenhum vínculo encontrado'}
                description={soIrregulares ? 'Todos os alunos ativos e formados estão regulares no ENADE.' : undefined}
              />
            </Card>
          ) : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {linhas.map((l) => (
                <button
                  key={l.vinculoId}
                  class={`w-full px-4 py-3 text-left hover:bg-surface-2 ${alunoId === l.alunoId ? 'bg-surface-2' : ''}`}
                  onClick={() => setAlunoId(l.alunoId)}
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg">{l.nome}</span>
                    {l.ra && <span class="text-[11px] font-mono text-fg-subtle">RA {l.ra}</span>}
                    <Badge tone={l.regular ? 'success' : 'danger'}>{l.regular ? 'Regular' : 'Irregular'}</Badge>
                    <Badge tone="neutral">{l.situacaoVinculo}</Badge>
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5">{l.motivo}</div>
                </button>
              ))}
            </Card>
          )}
        </div>

        <div class="space-y-4">
          <Card class="space-y-3 h-fit">
            <h2 class="text-sm font-semibold text-fg">Registrar ciclo</h2>
            {!alunoId ? (
              <p class="text-xs text-fg-subtle flex items-center gap-1.5">
                <Search size={13} /> Selecione um aluno na lista para registrar a condição no ciclo.
              </p>
            ) : (
              <>
                <div class="rounded-lg border border-border px-3 py-2">
                  <div class="text-sm text-fg">{selecionado?.nome ?? `Aluno #${alunoId}`}</div>
                  {detalhe.data && (
                    <div class="text-xs text-fg-muted mt-0.5">{detalhe.data.motivo}</div>
                  )}
                </div>
                {(detalhe.data?.registros ?? []).length > 0 && (
                  <div class="space-y-1">
                    <div class="text-xs font-medium text-fg-muted">Ciclos registrados</div>
                    {detalhe.data!.registros.map((r) => (
                      <div key={`${r.ano}-${r.condicao}`} class="flex items-center justify-between text-xs">
                        <span class="text-fg-muted">{r.ano} · {r.condicao.toLowerCase()}</span>
                        <Badge tone={ENADE_SITUACAO[r.situacao]?.tone ?? 'neutral'}>
                          {ENADE_SITUACAO[r.situacao]?.label ?? r.situacao}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                <div class="grid grid-cols-2 gap-2">
                  <Input label="Ano do ciclo" type="number" value={f.ano} onInput={(e) => setF((p) => ({ ...p, ano: (e.target as HTMLInputElement).value }))} />
                  <Select label="Condição" value={f.condicao} onChange={(e) => setF((p) => ({ ...p, condicao: (e.target as HTMLSelectElement).value }))}>
                    <option value="INGRESSANTE">Ingressante</option>
                    <option value="CONCLUINTE">Concluinte</option>
                  </Select>
                </div>
                <Select label="Situação" value={f.situacao} onChange={(e) => setF((p) => ({ ...p, situacao: (e.target as HTMLSelectElement).value }))}>
                  {Object.entries(ENADE_SITUACAO).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
                </Select>
                {f.situacao === 'DISPENSADO' && (
                  <Textarea
                    label="Motivo da dispensa" rows={2} value={f.dispensaMotivo}
                    hint="A dispensa precisa de fundamento registrado — é o que responde por ela na fiscalização."
                    onInput={(e) => setF((p) => ({ ...p, dispensaMotivo: (e.target as HTMLTextAreaElement).value }))}
                  />
                )}
                <Textarea label="Observação" rows={2} value={f.observacao} onInput={(e) => setF((p) => ({ ...p, observacao: (e.target as HTMLTextAreaElement).value }))} />
                <Button class="w-full" onClick={registrar} disabled={mut.registrar.isPending}>
                  <Save size={16} /> Registrar
                </Button>
              </>
            )}
          </Card>

          <Card class="!p-4 text-xs text-fg-muted space-y-1.5">
            <div class="flex items-center gap-2 text-fg font-medium"><ShieldAlert size={15} /> Por que aluno sem registro é irregular</div>
            <p>
              O ENADE é componente curricular obrigatório. Não haver registro não significa que o aluno está em dia —
              significa que a instituição não sabe. Tratar a ausência como irregularidade é o que evita colar grau de
              alguém pendente e ter o diploma questionado depois.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  )
}
