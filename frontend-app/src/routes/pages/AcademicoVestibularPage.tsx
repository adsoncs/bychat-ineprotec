import { useState } from 'preact/hooks'
import { ClipboardList, Trophy, Plus, Trash2 } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useProcessos, useCandidatos, useVestibularMut, useGruposInsc, useMotivosCanc, useEmpresasInsc, useExtrasInsc } from '@/hooks/useAcaVestibular'

type Tab = 'classificacao' | 'inscricao'
const ST_TONE: Record<string, any> = { inscrito: 'neutral', pago_taxa: 'info', classificado: 'success', convocado: 'accent', matriculado: 'success', desistente: 'neutral', reprovado: 'danger' }

export function AcademicoVestibularPage() {
  const procs = useProcessos()
  const [procId, setProcId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('classificacao')
  const processos = procs.data?.processos ?? []

  return (
    <Page title="Processo Seletivo" description="Consulta do resultado da classificação e dados da inscrição. Classificar e convocar é no Portal.">
      <Select label="Processo seletivo" value={procId ?? ''} onChange={(e: any) => setProcId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
        <option value="">Selecione…</option>
        {processos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.periodoLetivo ? ` · ${p.periodoLetivo}` : ''} ({p.candidatos} inscritos)</option>)}
      </Select>

      {procId === null ? <EmptyState icon={<ClipboardList size={28} />} title="Selecione um processo" description="Escolha um processo seletivo para gerenciar." /> : (
        <>
          <div class="flex gap-1 border-b border-border mt-3">
            {([['classificacao', 'Classificação'], ['inscricao', 'Inscrição']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'classificacao' && <ClassificacaoTab procId={procId} />}
          {tab === 'inscricao' && <InscricaoTab procId={procId} />}
        </>
      )}
    </Page>
  )
}

function ClassificacaoTab({ procId }: { procId: number }) {
  const cand = useCandidatos(procId)

  const candidatos = cand.data?.candidatos ?? []
  const counts = cand.data?.counts ?? {}
  const classificados = candidatos.filter((c) => c.posicao != null).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0))

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Trophy size={16} /> Resultado da classificação</div>
        <p class="text-sm text-fg-muted">
          Esta tela mostra o resultado. Quem classifica e convoca é o processo seletivo, no
          Portal — lá a nota de corte que vale é a do tipo de avaliação (redação, ENEM ou
          prova), com o ajuste por oferta, e toda mudança fica registrada no histórico do
          candidato.
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <a href="/app/educational/selection-processes" class="text-sm text-accent hover:underline flex items-center gap-1">
            <Trophy size={13} /> Abrir no Portal para classificar
          </a>
          <span class="text-xs text-fg-muted">
            Classificados: {counts.classificado ?? 0} · Convocados: {counts.convocado ?? 0} · Reprovados: {counts.reprovado ?? 0}
          </span>
        </div>
      </Card>

      {cand.isLoading ? <Skeleton class="h-40 w-full" /> : classificados.length === 0 ? <p class="text-sm text-fg-muted">Ninguém classificado neste processo ainda.</p> : (
        <Card class="p-0 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2 w-12">#</th><th class="text-left p-2">Candidato</th><th class="p-2 w-20">Nota</th><th class="text-center p-2 w-28">Situação</th></tr></thead>
            <tbody class="divide-y divide-border">
              {classificados.map((c) => (
                <tr key={c.id}><td class="p-2 font-medium">{c.posicao}º</td><td class="p-2">{c.nome}</td><td class="p-2 text-center">{c.notaFinal?.toFixed(2)}</td><td class="p-2 text-center"><Badge tone={ST_TONE[c.status]}>{c.statusLabel}</Badge></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}


function InscricaoTab({ procId }: { procId: number }) {
  const grupos = useGruposInsc(procId)
  const motivos = useMotivosCanc()
  const empresas = useEmpresasInsc()
  const cand = useCandidatos(procId)
  const extras = useExtrasInsc(procId)
  const mut = useVestibularMut()
  const [ng, setNg] = useState(''); const [nm, setNm] = useState(''); const [ne, setNe] = useState('')

  const listaGrupos = grupos.data?.grupos ?? []
  const listaEmpresas = empresas.data?.empresas ?? []
  const listaMotivos = motivos.data?.motivos ?? []
  const exMap = extras.data?.extras ?? {}
  const candidatos = (cand.data?.candidatos ?? []).filter((c) => c.status !== 'reprovado')

  return (
    <div class="space-y-3 mt-3">
      <div class="grid md:grid-cols-3 gap-3">
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Grupos de inscrição</div>
          <div class="flex gap-1"><Input placeholder="Novo grupo" value={ng} onInput={(e: any) => setNg(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!ng} onClick={() => mut.criarGrupo.mutate({ selectionProcessId: procId, nome: ng }, { onSuccess: () => setNg('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaGrupos.map((g) => <span key={g.id} class="text-xs px-2 py-1 bg-surface-2 rounded flex items-center gap-1">{g.nome}<button class="text-fg-muted hover:text-danger" onClick={() => mut.delGrupo.mutate(g.id)}><Trash2 size={11} /></button></span>)}</div>
        </Card>
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Motivos de cancelamento</div>
          <div class="flex gap-1"><Input placeholder="Novo motivo" value={nm} onInput={(e: any) => setNm(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!nm} onClick={() => mut.criarMotivo.mutate({ nome: nm }, { onSuccess: () => setNm('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaMotivos.map((m) => <span key={m.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{m.nome}</span>)}</div>
        </Card>
        <Card class="space-y-2">
          <div class="text-sm font-semibold text-fg">Empresas (inscrição B2B)</div>
          <div class="flex gap-1"><Input placeholder="Nova empresa" value={ne} onInput={(e: any) => setNe(e.currentTarget.value)} /><Button size="sm" variant="secondary" disabled={!ne} onClick={() => mut.criarEmpresa.mutate({ nome: ne }, { onSuccess: () => setNe('') })}><Plus size={14} /></Button></div>
          <div class="flex flex-wrap gap-1">{listaEmpresas.map((e) => <span key={e.id} class="text-xs px-2 py-1 bg-surface-2 rounded">{e.nome}</span>)}</div>
        </Card>
      </div>

      {cand.isLoading ? <Skeleton class="h-40 w-full" /> : candidatos.length === 0 ? <p class="text-sm text-fg-muted">Sem candidatos.</p> : (
        <Card class="p-0 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Candidato</th><th class="p-2">Grupo</th><th class="p-2">Empresa</th><th class="p-2 w-32"></th></tr></thead>
            <tbody class="divide-y divide-border">
              {candidatos.map((c) => {
                const ex = exMap[c.id]
                return (
                  <tr key={c.id}>
                    <td class="p-2">{c.nome}{c.status === 'desistente' && <Badge tone="danger" class="ml-1">cancelada</Badge>}</td>
                    <td class="p-1"><Select value={ex?.grupoId ?? ''} onChange={(e: any) => mut.setExtra.mutate({ regId: c.id, grupoId: e.currentTarget.value || null, empresaId: ex?.empresaId ?? null, comoConheceu: ex?.comoConheceu ?? null })} class="!py-1 text-xs"><option value="">—</option>{listaGrupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></td>
                    <td class="p-1"><Select value={ex?.empresaId ?? ''} onChange={(e: any) => mut.setExtra.mutate({ regId: c.id, empresaId: e.currentTarget.value || null, grupoId: ex?.grupoId ?? null, comoConheceu: ex?.comoConheceu ?? null })} class="!py-1 text-xs"><option value="">—</option>{listaEmpresas.map((em) => <option key={em.id} value={em.id}>{em.nome}</option>)}</Select></td>
                    <td class="p-1 text-right">{c.status !== 'desistente' && <CancelarInline regId={c.id} motivos={listaMotivos} onCancel={(motivoId) => mut.cancelarInscricao.mutate({ regId: c.id, motivoId })} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function CancelarInline({ motivos, onCancel }: { regId: number; motivos: Array<{ id: number; nome: string }>; onCancel: (motivoId?: number) => void }) {
  const [open, setOpen] = useState(false)
  const [mid, setMid] = useState('')
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Cancelar</Button>
  return (
    <div class="flex gap-1 items-center justify-end">
      <Select value={mid} onChange={(e: any) => setMid(e.currentTarget.value)} class="!py-1 text-xs !w-28"><option value="">Motivo…</option>{motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select>
      <Button size="sm" variant="danger" onClick={() => { onCancel(mid ? Number(mid) : undefined); setOpen(false) }}>OK</Button>
    </div>
  )
}
