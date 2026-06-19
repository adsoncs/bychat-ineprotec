import { useState } from 'preact/hooks'
import { DoorOpen, KeyRound, ScanLine, Plus, CheckCircle2, XCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { useAlunos } from '@/hooks/useAcaAluno'
import { usePontosAcesso, useCredenciais, useAcessoLogs, useAcessoMut } from '@/hooks/useAcaAcesso'

type Tab = 'pontos' | 'credenciais' | 'acessos'

export function AcademicoAcessoPage() {
  const [tab, setTab] = useState<Tab>('credenciais')
  return (
    <Page title="Controle de Acesso" description="Catracas/pontos de acesso, credenciais (QR) e registro de acessos. A catraca física é o ponto de integração.">
      <p class="text-xs text-fg-muted">⚠️ A catraca/leitor físico chama o endpoint de decisão com o token do QR. Aqui você cadastra os pontos, gera as credenciais e pode <b>simular uma leitura</b> para testar a liberação (credencial válida + sem bloqueio).</p>
      <div class="flex gap-1 border-b border-border">
        {([['credenciais', 'Credenciais'], ['pontos', 'Pontos de acesso'], ['acessos', 'Acessos']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'credenciais' && <CredenciaisTab />}
      {tab === 'pontos' && <PontosTab />}
      {tab === 'acessos' && <AcessosTab />}
    </Page>
  )
}

function PontosTab() {
  const pontos = usePontosAcesso()
  const mut = useAcessoMut()
  const [f, setF] = useState({ nome: '', local: '' })
  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><DoorOpen size={16} /> Novo ponto</div>
        <div class="flex gap-2"><Input placeholder="Nome (ex: Catraca Principal)" value={f.nome} onInput={(e: any) => setF({ ...f, nome: e.currentTarget.value })} /><Input placeholder="Local" value={f.local} onInput={(e: any) => setF({ ...f, local: e.currentTarget.value })} /><Button size="sm" variant="secondary" disabled={!f.nome} onClick={() => mut.criarPonto.mutate(f, { onSuccess: () => setF({ nome: '', local: '' }) })}><Plus size={14} /></Button></div>
      </Card>
      {pontos.isLoading ? <Skeleton class="h-20 w-full" /> : (pontos.data?.pontos ?? []).length === 0 ? <EmptyState icon={<DoorOpen size={26} />} title="Sem pontos" description="Cadastre as catracas/pontos de acesso." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {(pontos.data?.pontos ?? []).map((p) => (
            <div key={p.id} class="px-4 py-2.5 flex items-center gap-3 text-sm"><span class="flex-1">{p.nome}{p.local ? <span class="text-xs text-fg-muted"> · {p.local}</span> : ''}</span>{!p.ativo && <Badge tone="neutral">inativo</Badge>}<Button size="sm" variant="ghost" onClick={() => mut.atualizarPonto.mutate({ id: p.id, ativo: !p.ativo })}>{p.ativo ? 'Inativar' : 'Ativar'}</Button></div>
          ))}
        </Card>
      )}
    </div>
  )
}

function CredenciaisTab() {
  const [q, setQ] = useState('')
  const alunos = useAlunos(q)
  const creds = useCredenciais()
  const pontos = usePontosAcesso()
  const mut = useAcessoMut()
  const [sim, setSim] = useState<{ token: string; pontoId: string }>({ token: '', pontoId: '' })
  const [result, setResult] = useState<{ autorizado: boolean; motivo: string | null; alunoNome: string | null } | null>(null)

  const simular = () => mut.registrar.mutate({ token: sim.token, pontoId: sim.pontoId ? Number(sim.pontoId) : undefined }, { onSuccess: (r) => setResult(r) })
  const lista = creds.data?.credenciais ?? []

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><KeyRound size={16} /> Gerar credencial (QR)</div>
        <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno…" />
        {q && (alunos.data?.alunos ?? []).length > 0 && (
          <div class="divide-y divide-border border border-border rounded-md max-h-48 overflow-auto">
            {(alunos.data?.alunos ?? []).map((a: any) => (
              <div key={a.id} class="px-3 py-1.5 flex items-center gap-2 text-sm"><span class="flex-1">{a.lead?.nome ?? a.nome} <span class="text-xs text-fg-muted">RA {a.ra ?? '—'}</span></span><Button size="sm" variant="ghost" onClick={() => mut.gerarCredencial.mutate(a.id)}>Gerar / renovar</Button></div>
            ))}
          </div>
        )}
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><ScanLine size={16} /> Simular leitura (teste da catraca)</div>
        <div class="flex flex-wrap gap-2 items-end">
          <Input class="flex-1 min-w-[14rem]" placeholder="Token do QR (cole de uma credencial)" value={sim.token} onInput={(e: any) => setSim({ ...sim, token: e.currentTarget.value })} />
          <Select value={sim.pontoId} onChange={(e: any) => setSim({ ...sim, pontoId: e.currentTarget.value })} class="!w-48"><option value="">Ponto…</option>{(pontos.data?.pontos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select>
          <Button size="sm" variant="primary" disabled={!sim.token || mut.registrar.isPending} onClick={simular}>Ler</Button>
        </div>
        {result && <div class={`text-sm flex items-center gap-2 ${result.autorizado ? 'text-success' : 'text-danger'}`}>{result.autorizado ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {result.autorizado ? `Liberado: ${result.alunoNome}` : `Negado: ${result.motivo}`}</div>}
      </Card>

      {creds.isLoading ? <Skeleton class="h-24 w-full" /> : lista.length === 0 ? <p class="text-sm text-fg-muted">Nenhuma credencial gerada.</p> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {lista.map((c) => (
            <div key={c.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{c.alunoNome} <span class="text-xs text-fg-muted">RA {c.ra ?? '—'}</span></span><code class="text-[11px] text-fg-subtle break-all">{c.token}</code></span>
              {!c.ativo && <Badge tone="neutral">inativa</Badge>}
              <Button size="sm" variant="ghost" onClick={() => { setSim({ ...sim, token: c.token }); navigator.clipboard?.writeText(c.token).catch(() => {}) }}>Usar no teste</Button>
              <Button size="sm" variant="ghost" onClick={() => mut.toggleCredencial.mutate({ id: c.id, ativo: !c.ativo })}>{c.ativo ? 'Inativar' : 'Ativar'}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function AcessosTab() {
  const logs = useAcessoLogs()
  const lista = logs.data?.logs ?? []
  return (
    <div class="space-y-3 mt-3">
      {logs.isLoading ? <Skeleton class="h-40 w-full" /> : lista.length === 0 ? <EmptyState icon={<ScanLine size={26} />} title="Sem acessos" description="Os registros de acesso aparecem aqui." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {lista.map((l) => (
            <div key={l.id} class="px-4 py-2 flex items-center gap-3 text-sm">
              {l.autorizado ? <Badge tone="success">{l.tipo === 'SAIDA' ? 'Saída' : 'Entrada'}</Badge> : <Badge tone="danger">Negado</Badge>}
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{l.alunoNome}</span><span class="block text-xs text-fg-muted">{l.pontoNome ?? '—'}{l.motivo ? ` · ${l.motivo}` : ''}</span></span>
              <span class="text-xs text-fg-muted shrink-0">{new Date(l.createdAt).toLocaleString('pt-BR')}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
