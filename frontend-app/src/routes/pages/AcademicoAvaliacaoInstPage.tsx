import { useState } from 'preact/hooks'
import { BarChart3, Plus, Trash2, Link2, Copy, Check, ArrowLeft, Play, Square } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useAvaliacoesInst, useEstruturaAval, useResultadoAval, useAvalInstMut, TIPO_LABEL, AVAL_STATUS } from '@/hooks/useAcaAvaliacaoInst'

export function AcademicoAvaliacaoInstPage() {
  const [sel, setSel] = useState<number | null>(null)
  if (sel !== null) return <AvaliacaoDetalhe id={sel} onBack={() => setSel(null)} />
  return <Lista onOpen={setSel} />
}

function Lista({ onOpen }: { onOpen: (id: number) => void }) {
  const data = useAvaliacoesInst()
  const mut = useAvalInstMut()
  const [novo, setNovo] = useState({ nome: '', publico: 'TODOS' })
  const avs = data.data?.avaliacoes ?? []

  return (
    <Page title="Avaliação Institucional (CPA)" description="Questionários de avaliação institucional por dimensões, com aplicação por link e resultados.">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Nova avaliação</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Input placeholder="Nome (ex: CPA 2026/1)" value={novo.nome} onInput={(e: any) => setNovo({ ...novo, nome: e.currentTarget.value })} />
          <Select value={novo.publico} onChange={(e: any) => setNovo({ ...novo, publico: e.currentTarget.value })}><option value="TODOS">Todos</option><option value="ALUNO">Alunos</option><option value="PROFESSOR">Professores</option></Select>
          <Button size="sm" variant="secondary" disabled={!novo.nome || mut.criar.isPending} onClick={() => mut.criar.mutate(novo, { onSuccess: () => setNovo({ nome: '', publico: 'TODOS' }) })}><Plus size={14} /> Criar</Button>
        </div>
      </Card>

      {data.isLoading ? <Skeleton class="h-32 w-full" /> : avs.length === 0 ? <EmptyState icon={<BarChart3 size={28} />} title="Nenhuma avaliação" description="Crie a primeira avaliação institucional acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {avs.map((a) => (
            <button key={a.id} class="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-2 text-left" onClick={() => onOpen(a.id)}>
              <span class="flex-1 min-w-0"><span class="block truncate text-fg font-medium">{a.nome}</span><span class="block text-xs text-fg-muted">{a.dimensoes} dimensão(ões) · {a.participacoes} resposta(s) · público {a.publico.toLowerCase()}</span></span>
              <Badge tone={AVAL_STATUS[a.status]?.tone ?? 'neutral'}>{AVAL_STATUS[a.status]?.label ?? a.status}</Badge>
            </button>
          ))}
        </Card>
      )}
    </Page>
  )
}

function AvaliacaoDetalhe({ id, onBack }: { id: number; onBack: () => void }) {
  const lista = useAvaliacoesInst()
  const mut = useAvalInstMut()
  const [tab, setTab] = useState<'estrutura' | 'resultados'>('estrutura')
  const [link, setLink] = useState<string | null>(null)
  const av = lista.data?.avaliacoes.find((a) => a.id === id)

  return (
    <Page title={av?.nome ?? 'Avaliação'} description="Estrutura do questionário e resultados.">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        <div class="flex items-center gap-2">
          {av && <Badge tone={AVAL_STATUS[av.status]?.tone ?? 'neutral'}>{AVAL_STATUS[av.status]?.label}</Badge>}
          {av?.status !== 'ABERTA' && <Button size="sm" variant="primary" onClick={() => mut.atualizar.mutate({ id, status: 'ABERTA' })}><Play size={13} /> Abrir</Button>}
          {av?.status === 'ABERTA' && <Button size="sm" variant="secondary" onClick={() => mut.atualizar.mutate({ id, status: 'ENCERRADA' })}><Square size={13} /> Encerrar</Button>}
          <Button size="sm" variant="secondary" onClick={() => mut.gerarLink.mutate(id, { onSuccess: (d) => setLink(d.url) })}><Link2 size={13} /> Link</Button>
        </div>
      </div>

      <div class="flex gap-1 border-b border-border">
        {([['estrutura', 'Estrutura'], ['resultados', 'Resultados']] as const).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'estrutura' ? <Estrutura id={id} /> : <Resultados id={id} />}

      <Modal open={link !== null} onOpenChange={(o) => !o && setLink(null)} title="Link de resposta" description="Envie aos respondentes (anônimo).">
        {link && <LinkBox url={link} />}
      </Modal>
    </Page>
  )
}

function Estrutura({ id }: { id: number }) {
  const data = useEstruturaAval(id)
  const mut = useAvalInstMut()
  const [novaDim, setNovaDim] = useState('')
  const [perg, setPerg] = useState<Record<number, { tipo: string; enunciado: string }>>({})
  const dims = data.data?.dimensoes ?? []

  return (
    <div class="space-y-3 mt-3">
      <div class="flex gap-2">
        <Input placeholder="Nova dimensão (ex: Infraestrutura)" value={novaDim} onInput={(e: any) => setNovaDim(e.currentTarget.value)} />
        <Button size="sm" variant="secondary" disabled={!novaDim || mut.criarDimensao.isPending} onClick={() => mut.criarDimensao.mutate({ avaliacaoId: id, nome: novaDim }, { onSuccess: () => setNovaDim('') })}><Plus size={14} /> Dimensão</Button>
      </div>
      {data.isLoading ? <Skeleton class="h-32 w-full" /> : dims.length === 0 ? <p class="text-sm text-fg-muted">Crie uma dimensão para começar.</p> : dims.map((d) => {
        const p = perg[d.id] ?? { tipo: 'ESCALA', enunciado: '' }
        return (
          <Card key={d.id} class="space-y-2">
            <div class="flex items-center gap-2"><span class="flex-1 font-semibold text-fg">{d.nome}</span><Button size="sm" variant="ghost" onClick={() => mut.delDimensao.mutate(d.id)}><Trash2 size={13} /></Button></div>
            <div class="divide-y divide-border text-sm">
              {d.perguntas.map((q) => <div key={q.id} class="py-1.5 flex items-center gap-2"><Badge tone="neutral">{TIPO_LABEL[q.tipo] ?? q.tipo}</Badge><span class="flex-1">{q.enunciado}</span><button class="text-fg-muted hover:text-danger" onClick={() => mut.delPergunta.mutate(q.id)}><Trash2 size={12} /></button></div>)}
            </div>
            <div class="flex flex-wrap gap-2 items-end">
              <Select value={p.tipo} onChange={(e: any) => setPerg({ ...perg, [d.id]: { ...p, tipo: e.currentTarget.value } })} class="!w-40">{Object.entries(TIPO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              <Input class="flex-1 min-w-[12rem]" placeholder="Enunciado da pergunta" value={p.enunciado} onInput={(e: any) => setPerg({ ...perg, [d.id]: { ...p, enunciado: e.currentTarget.value } })} />
              <Button size="sm" variant="secondary" disabled={!p.enunciado || mut.criarPergunta.isPending} onClick={() => mut.criarPergunta.mutate({ dimensaoId: d.id, tipo: p.tipo, enunciado: p.enunciado }, { onSuccess: () => setPerg({ ...perg, [d.id]: { tipo: p.tipo, enunciado: '' } }) })}><Plus size={14} /></Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function Resultados({ id }: { id: number }) {
  const data = useResultadoAval(id)
  if (data.isLoading) return <Skeleton class="h-40 w-full mt-3" />
  const res = data.data
  if (!res || res.dimensoes.length === 0) return <p class="text-sm text-fg-muted mt-3">Sem estrutura/resultados ainda.</p>
  return (
    <div class="space-y-3 mt-3">
      <div class="text-sm text-fg-muted"><b class="text-fg">{res.participacoes}</b> participação(ões)</div>
      {res.dimensoes.map((d) => (
        <Card key={d.id} class="space-y-2">
          <div class="flex items-center gap-2"><span class="flex-1 font-semibold text-fg">{d.nome}</span>{d.mediaDim != null && <Badge tone="accent">média {d.mediaDim.toFixed(2)}</Badge>}</div>
          <div class="divide-y divide-border text-sm">
            {d.perguntas.map((q) => (
              <div key={q.id} class="py-2">
                <div class="text-fg">{q.enunciado} <span class="text-xs text-fg-subtle">({q.n} resp.)</span></div>
                {q.tipo === 'TEXTO' ? (
                  <ul class="text-xs text-fg-muted mt-1 list-disc pl-5">{(q.respostas ?? []).slice(0, 20).map((t, i) => <li key={i}>{t}</li>)}{(q.respostas ?? []).length === 0 && <li>—</li>}</ul>
                ) : (
                  <div class="text-xs text-fg-muted mt-0.5">
                    {q.media != null && <span class="mr-3">Média: <b class="text-fg">{q.media.toFixed(2)}</b></span>}
                    {q.nps != null && <span class="mr-3">NPS: <b class={q.nps >= 0 ? 'text-success' : 'text-danger'}>{q.nps}</b></span>}
                    {q.pctSim != null && <span>Sim: <b class="text-fg">{q.pctSim}%</b></span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function LinkBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div class="flex gap-2 items-center">
      <code class="flex-1 text-xs bg-surface-2 rounded px-2 py-2 break-all">{url}</code>
      <Button size="sm" variant="primary" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}</Button>
    </div>
  )
}
