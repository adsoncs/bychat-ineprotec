import { useState } from 'preact/hooks'
import { Users, GraduationCap, Link2, Copy, Check, UserCog, Plus } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { SearchInput } from '@/components/ui/SearchInput'
import {
  useAlunosPortal, useCandidatosPortal, useCursosPortal, useCoordenadores, useCoordenadorMut, useGerarLinkPlus, type LinkGerado,
} from '@/hooks/useAcaPortaisPlus'

type Tab = 'familia' | 'candidato' | 'coordenador'

export function AcademicoPortaisPlusPage() {
  const [tab, setTab] = useState<Tab>('familia')
  const [link, setLink] = useState<{ titulo: string; url: string; expiraEm?: string } | null>(null)
  return (
    <Page title="Centrais por perfil" description="Gere links de acesso (magic link) às centrais do responsável, ex-aluno, candidato e coordenador.">
      <div class="flex gap-1 border-b border-border">
        {([['familia', 'Responsável / Ex-aluno'], ['candidato', 'Candidato'], ['coordenador', 'Coordenador']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'familia' && <FamiliaTab onLink={setLink} />}
      {tab === 'candidato' && <CandidatoTab onLink={setLink} />}
      {tab === 'coordenador' && <CoordenadorTab onLink={setLink} />}

      <Modal open={link !== null} onOpenChange={(o) => !o && setLink(null)} title="Link de acesso" description={link?.titulo}>
        {link && <LinkBox url={link.url} expiraEm={link.expiraEm} />}
      </Modal>
    </Page>
  )
}

type OnLink = (l: { titulo: string; url: string; expiraEm?: string }) => void

function FamiliaTab({ onLink }: { onLink: OnLink }) {
  const [q, setQ] = useState('')
  const data = useAlunosPortal(q)
  const gerar = useGerarLinkPlus()
  const onGerar = (tipo: 'responsavel' | 'exaluno', id: number, titulo: string) =>
    gerar.mutate({ tipo, id }, { onSuccess: (d: LinkGerado) => onLink({ titulo, url: d.url, expiraEm: d.expiraEm }) })

  const alunos = data.data?.alunos ?? []
  return (
    <div class="space-y-3 mt-3">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno por nome ou RA…" />
      {data.isLoading ? <Skeleton class="h-20 w-full" /> : alunos.length === 0 ? <EmptyState icon={<Users size={28} />} title="Nenhum aluno" description="Busque um aluno para gerar os links." /> : (
        <div class="space-y-2">
          {alunos.map((a) => (
            <Card key={a.id} class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="flex-1 min-w-0"><span class="text-sm font-medium text-fg">{a.nome}</span><span class="block text-xs text-fg-muted">RA {a.ra || '—'}</span></span>
                {a.concluido && <Badge tone="accent">egresso</Badge>}
              </div>
              <div class="flex flex-wrap gap-2 items-center">
                {a.responsaveis.length === 0 ? <span class="text-xs text-fg-subtle">Sem responsável cadastrado.</span> :
                  a.responsaveis.map((r) => (
                    <Button key={r.id} size="sm" variant="secondary" disabled={gerar.isPending} onClick={() => onGerar('responsavel', r.id, `Responsável — ${r.nome}`)}>
                      <Users size={13} /> {r.nome}{r.parentesco ? ` (${r.parentesco})` : ''}
                    </Button>
                  ))}
                {a.concluido && <Button size="sm" variant="secondary" disabled={gerar.isPending} onClick={() => onGerar('exaluno', a.id, `Ex-aluno — ${a.nome}`)}><GraduationCap size={13} /> Link do ex-aluno</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

const CAND_STATUS: Record<string, string> = { pending: 'Pendente', paid: 'Pago', docs_uploaded: 'Docs enviados', docs_approved: 'Docs aprovados', approved: 'Aprovado', rejected: 'Rejeitado', enrolled: 'Matriculado', cancelled: 'Cancelado', expired: 'Expirado' }

function CandidatoTab({ onLink }: { onLink: OnLink }) {
  const [q, setQ] = useState('')
  const data = useCandidatosPortal(q)
  const candidatos = data.data?.candidatos ?? []
  return (
    <div class="space-y-3 mt-3">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar por código do candidato…" />
      <p class="text-xs text-fg-muted">A Central do Candidato usa o portal de inscrição existente (<code>/candidato/:código</code>): acompanhamento da inscrição, documentos, prova/redação online e resultado.</p>
      {data.isLoading ? <Skeleton class="h-20 w-full" /> : candidatos.length === 0 ? <EmptyState icon={<GraduationCap size={28} />} title="Nenhum candidato" description="Inscrições do portal aparecem aqui." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {candidatos.map((c) => (
            <div key={c.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0">
                <span class="block truncate text-fg">{c.nome || 'Candidato'}</span>
                <span class="block text-xs text-fg-muted"><code>{c.candidateCode}</code></span>
              </span>
              <Badge tone="neutral">{CAND_STATUS[c.status] || c.status}</Badge>
              <Button size="sm" variant="secondary" onClick={() => onLink({ titulo: `Candidato — ${c.candidateCode}`, url: c.url })}><Link2 size={13} /> Link</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function CoordenadorTab({ onLink }: { onLink: OnLink }) {
  const coords = useCoordenadores()
  const cursos = useCursosPortal()
  const mut = useCoordenadorMut()
  const gerar = useGerarLinkPlus()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [courseId, setCourseId] = useState('')

  const add = () => {
    if (!nome.trim() || !courseId) return
    mut.criar.mutate({ nome, email: email || undefined, courseId: Number(courseId) }, { onSuccess: () => { setNome(''); setEmail(''); setCourseId('') } })
  }
  const lista = coords.data?.coordenadores ?? []
  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><UserCog size={16} /> Novo coordenador</div>
        <div class="grid sm:grid-cols-3 gap-2">
          <Input label="Nome" value={nome} onInput={(e: any) => setNome(e.currentTarget.value)} />
          <Input label="E-mail" value={email} onInput={(e: any) => setEmail(e.currentTarget.value)} />
          <Select label="Curso" value={courseId} onChange={(e: any) => setCourseId(e.currentTarget.value)}>
            <option value="">Selecione…</option>
            {(cursos.data?.cursos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </div>
        <div><Button size="sm" variant="secondary" disabled={!nome.trim() || !courseId || mut.criar.isPending} onClick={add}><Plus size={14} /> Adicionar</Button></div>
      </Card>

      {coords.isLoading ? <Skeleton class="h-20 w-full" /> : lista.length === 0 ? <EmptyState icon={<UserCog size={28} />} title="Nenhum coordenador" description="Cadastre um coordenador de curso acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {lista.map((c) => (
            <div key={c.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0">
                <span class="block truncate text-fg">{c.nome}{!c.ativo && <span class="text-xs text-danger ml-1">(inativo)</span>}</span>
                <span class="block text-xs text-fg-muted">{c.cursoNome}{c.email ? ` · ${c.email}` : ''}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => mut.atualizar.mutate({ id: c.id, ativo: !c.ativo })}>{c.ativo ? 'Desativar' : 'Ativar'}</Button>
              <Button size="sm" variant="secondary" disabled={!c.ativo || gerar.isPending} onClick={() => gerar.mutate({ tipo: 'coord', id: c.id }, { onSuccess: (d: LinkGerado) => onLink({ titulo: `Coordenador — ${c.nome}`, url: d.url, expiraEm: d.expiraEm }) })}><Link2 size={13} /> Link</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function LinkBox({ url, expiraEm }: { url: string; expiraEm?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  return (
    <div class="space-y-2">
      <div class="flex gap-2 items-center">
        <code class="flex-1 text-xs bg-surface-2 rounded px-2 py-2 break-all">{url}</code>
        <Button size="sm" variant="primary" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}</Button>
      </div>
      <p class="text-xs text-fg-muted"><Link2 size={12} class="inline" /> {expiraEm ? `Expira em ${new Date(expiraEm).toLocaleDateString('pt-BR')}. ` : ''}Envie por WhatsApp ou e-mail.</p>
    </div>
  )
}
