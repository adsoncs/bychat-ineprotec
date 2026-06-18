import { useState } from 'preact/hooks'
import { GraduationCap, Plus, Hash, UserPlus, X, ArrowLeft, Search } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useAcaMeta, useAlunos, useAluno, useLeadSearch, usePromoteLead, useResponsavelActions,
  type AlunoLead, type Aluno,
} from '@/hooks/useAcaAluno'

const TIPO_RESP: Record<string, string> = { FINANCEIRO: 'Financeiro', PEDAGOGICO: 'Pedagógico', LEGAL: 'Legal' }

export function AcademicoAlunosPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [promoting, setPromoting] = useState(false)
  const meta = useAcaMeta()
  const list = useAlunos(search)

  if (selectedId !== null) return <AlunoDetail id={selectedId} onBack={() => setSelectedId(null)} />

  const alunos = list.data?.alunos ?? []
  return (
    <Page
      title="Alunos"
      description="Cadastro de alunos — o aluno é o mesmo contato do CRM (sem cadastro duplicado)."
      actions={<Button variant="primary" size="sm" onClick={() => setPromoting(true)}><UserPlus size={14} /> Promover contato a aluno</Button>}
    >
      <div class="flex flex-wrap items-center gap-3">
        {meta.data && <span class="text-xs text-fg-muted">{meta.data.alunos} aluno(s) · {meta.data.turmas} turma(s) ativa(s)</span>}
        <div class="ml-auto w-64"><SearchInput value={search} onChange={setSearch} placeholder="Buscar por RA, CPF, nome, e-mail…" /></div>
      </div>

      {list.isLoading ? (
        <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-14 w-full" />)}</div>
      ) : alunos.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} />}
          title="Nenhum aluno"
          description="Promova um contato do CRM a aluno para começar."
          action={<Button variant="primary" size="sm" onClick={() => setPromoting(true)}><UserPlus size={14} /> Promover contato</Button>}
        />
      ) : (
        <Card class="divide-y divide-border p-0 overflow-hidden">
          {alunos.map((a) => (
            <button key={a.id} class="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-2 text-left" onClick={() => setSelectedId(a.id)}>
              <span class="text-fg-muted text-xs font-mono inline-flex items-center gap-0.5 w-24 shrink-0"><Hash size={11} />{a.ra}</span>
              <span class="flex-1 min-w-0">
                <span class="block truncate text-sm font-medium text-fg">{a.lead.nome}</span>
                <span class="block truncate text-xs text-fg-muted">{[a.lead.email, a.lead.whatsapp].filter(Boolean).join(' · ')}</span>
              </span>
              {!a.ativo && <Badge tone="neutral">inativo</Badge>}
            </button>
          ))}
        </Card>
      )}

      <PromoteModal open={promoting} onClose={() => setPromoting(false)} onDone={(id) => { setPromoting(false); setSelectedId(id) }} />
    </Page>
  )
}

function PromoteModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: number) => void }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<AlunoLead | null>(null)
  const [cpf, setCpf] = useState('')
  const [sexo, setSexo] = useState('')
  const [nasc, setNasc] = useState('')
  const search = useLeadSearch(q)
  const promote = usePromoteLead()

  function reset() { setQ(''); setPicked(null); setCpf(''); setSexo(''); setNasc('') }
  function submit() {
    if (!picked) return
    promote.mutate({ leadId: picked.id, cpf: cpf || undefined, sexo: sexo || undefined, dataNascimento: nasc || undefined }, {
      onSuccess: (r) => { reset(); onDone(r.aluno.id) },
    })
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Promover contato a aluno">
      <div class="space-y-3">
        {!picked ? (
          <>
            <Input label="Buscar contato (nome, e-mail, WhatsApp)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Digite ao menos 2 letras…" />
            <div class="max-h-56 overflow-auto divide-y divide-border rounded-md border border-border">
              {q.trim().length < 2 ? (
                <p class="text-xs text-fg-muted p-3 inline-flex items-center gap-1"><Search size={12} /> Busque um contato do CRM ainda não vinculado.</p>
              ) : (search.data?.leads ?? []).length === 0 ? (
                <p class="text-xs text-fg-muted p-3">Nenhum contato disponível para este termo.</p>
              ) : (
                (search.data?.leads ?? []).map((l) => (
                  <button key={l.id} class="w-full text-left px-3 py-2 hover:bg-surface-2" onClick={() => setPicked(l)}>
                    <span class="block text-sm text-fg">{l.nome}</span>
                    <span class="block text-xs text-fg-muted">{[l.email, l.whatsapp].filter(Boolean).join(' · ')}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div class="rounded-md bg-surface-2 p-3 flex items-center gap-2">
              <div class="flex-1">
                <div class="text-sm font-medium text-fg">{picked.nome}</div>
                <div class="text-xs text-fg-muted">{[picked.email, picked.whatsapp].filter(Boolean).join(' · ')}</div>
              </div>
              <button class="text-fg-muted hover:text-danger" onClick={() => setPicked(null)}><X size={14} /></button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Input label="CPF" value={cpf} onInput={(e) => setCpf((e.target as HTMLInputElement).value)} placeholder="000.000.000-00" />
              <Input label="Nascimento" type="date" value={nasc} onInput={(e) => setNasc((e.target as HTMLInputElement).value)} />
            </div>
            <Select label="Sexo" value={sexo} onChange={(e) => setSexo((e.target as HTMLSelectElement).value)}>
              <option value="">—</option>
              <option value="MASCULINO">Masculino</option>
              <option value="FEMININO">Feminino</option>
              <option value="OUTROS">Outros</option>
            </Select>
            {promote.isError && <p class="text-xs text-danger">{(promote.error as any)?.message || 'Falha ao promover.'}</p>}
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { reset(); onClose() }}>Cancelar</Button>
              <Button variant="primary" size="sm" disabled={promote.isPending} onClick={submit}>{promote.isPending ? 'Gerando RA…' : 'Promover a aluno'}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function AlunoDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const detail = useAluno(id)
  const a = detail.data?.aluno
  return (
    <Page title={a ? `${a.lead.nome}` : 'Aluno'} actions={<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>}>
      {!a ? (
        <Skeleton class="h-40 w-full" />
      ) : (
        <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div class="space-y-4">
            <Card class="space-y-2">
              <div class="flex items-center gap-2">
                <Badge tone="info"><Hash size={11} /> RA {a.ra}</Badge>
                {a.ativo ? <Badge tone="success">ativo</Badge> : <Badge tone="neutral">inativo</Badge>}
              </div>
              <dl class="text-sm text-fg-muted grid grid-cols-2 gap-y-1 pt-1">
                <dt>Nome</dt><dd class="text-fg text-right">{a.lead.nome}</dd>
                <dt>E-mail</dt><dd class="text-fg text-right truncate">{a.lead.email || '—'}</dd>
                <dt>WhatsApp</dt><dd class="text-fg text-right">{a.lead.whatsapp || '—'}</dd>
                <dt>CPF</dt><dd class="text-fg text-right">{a.cpf || '—'}</dd>
                <dt>Sexo</dt><dd class="text-fg text-right">{a.sexo || '—'}</dd>
              </dl>
              <p class="text-[11px] text-fg-subtle pt-1">Contato do CRM #{a.lead.id} — sem cadastro duplicado.</p>
            </Card>
            <Card>
              <h3 class="text-sm font-semibold text-fg mb-2">Matrículas</h3>
              {(a.matriculas?.length ?? 0) === 0 ? (
                <p class="text-xs text-fg-muted">Nenhuma matrícula ainda. (Módulo de Matrícula — P4.)</p>
              ) : (
                <ul class="text-sm space-y-1">{a.matriculas!.map((m) => <li key={m.id} class="text-fg">Turma #{m.turmaId} · <Badge tone="info">{m.status}</Badge></li>)}</ul>
              )}
            </Card>
          </div>
          <ResponsaveisCard aluno={a} />
        </div>
      )}
    </Page>
  )
}

function ResponsaveisCard({ aluno }: { aluno: Aluno }) {
  const act = useResponsavelActions(aluno.id)
  const [adding, setAdding] = useState(false)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('FINANCEIRO')
  const [tel, setTel] = useState('')
  function add() {
    if (!nome.trim()) return
    act.add.mutate({ nome: nome.trim(), tipo, telefone: tel.trim() || undefined }, { onSuccess: () => { setNome(''); setTel(''); setAdding(false) } })
  }
  return (
    <Card class="space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">Responsáveis</h3>
      {(aluno.responsaveis ?? []).map((r) => (
        <div key={r.id} class="flex items-center gap-2 text-sm">
          <span class="flex-1 truncate text-fg">{r.nome} <span class="text-fg-subtle text-xs">({TIPO_RESP[r.tipo] || r.tipo})</span></span>
          <button class="text-fg-muted hover:text-danger" onClick={() => act.remove.mutate(r.id)}><X size={13} /></button>
        </div>
      ))}
      {!adding ? (
        <button class="text-xs text-accent hover:underline" onClick={() => setAdding(true)}>+ Adicionar responsável</button>
      ) : (
        <div class="space-y-1.5 border-t border-border pt-2">
          <Input value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Nome do responsável" />
          <div class="flex gap-1.5">
            <Select value={tipo} onChange={(e) => setTipo((e.target as HTMLSelectElement).value)}>
              <option value="FINANCEIRO">Financeiro</option>
              <option value="PEDAGOGICO">Pedagógico</option>
              <option value="LEGAL">Legal</option>
            </Select>
            <Input value={tel} onInput={(e) => setTel((e.target as HTMLInputElement).value)} placeholder="Telefone" />
          </div>
          <div class="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button variant="primary" size="sm" disabled={!nome.trim() || act.add.isPending} onClick={add}>Adicionar</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
