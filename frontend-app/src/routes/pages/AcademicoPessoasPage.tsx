import { useState, useEffect } from 'preact/hooks'
import { Users, ArrowLeft, Save, IdCard, FileText, Home, Coins, UserSquare, Trash2, Plus, Briefcase, UserPlus } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import {
  usePessoas, useFichaAluno, useSalvarFicha, useResponsavelMut, useFichaProfessor, useSalvarProfessor,
  usePessoasRefs, useCriarPessoa, useBuscarLeads, PAPEL_LABEL, RESP_TIPOS, type FichaAluno,
} from '@/hooks/useAcaPessoas'

const PAPEIS = ['', 'ALUNO', 'PROFESSOR', 'ORIENTADOR', 'COORDENADOR', 'CANDIDATO']

export function AcademicoPessoasPage() {
  const [aberto, setAberto] = useState<{ tipo: 'aluno' | 'prof'; id: number } | null>(null)
  if (aberto?.tipo === 'aluno') return <FichaCompleta id={aberto.id} onBack={() => setAberto(null)} />
  if (aberto?.tipo === 'prof') return <FichaProfessor id={aberto.id} onBack={() => setAberto(null)} />
  return <Lista onOpen={(tipo, id) => setAberto({ tipo, id })} />
}

function Lista({ onOpen }: { onOpen: (tipo: 'aluno' | 'prof', id: number) => void }) {
  const [papel, setPapel] = useState('')
  const [q, setQ] = useState('')
  const [novo, setNovo] = useState(false)
  const data = usePessoas(papel, q)
  const pessoas = data.data?.pessoas ?? []
  const counts = data.data?.counts ?? {}

  return (
    <Page title="Pessoas" description="Cadastro unificado de pessoas por papel: aluno, professor, coordenador e candidato.">
      <div class="flex items-center gap-2">
        <div class="flex-1"><SearchInput value={q} onChange={setQ} placeholder="Buscar por nome, CPF ou RA…" /></div>
        <Button variant="primary" onClick={() => setNovo(true)}><UserPlus size={15} /> Novo</Button>
      </div>
      {novo && <NovaPessoaModal onClose={() => setNovo(false)} onCreated={onOpen} />}
      <div class="flex flex-wrap gap-1">
        {PAPEIS.map((p) => (
          <button key={p || 'all'} class={`text-xs px-3 py-1.5 rounded-md border ${papel === p ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setPapel(p)}>
            {p === '' ? 'Todos' : PAPEL_LABEL[p].label}{p && counts[p] ? ` (${counts[p]})` : ''}
          </button>
        ))}
      </div>

      {data.isLoading ? <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-12 w-full" />)}</div> :
        pessoas.length === 0 ? <EmptyState icon={<Users size={28} />} title="Nenhuma pessoa" description="Ajuste a busca ou o filtro de papel." /> : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {pessoas.map((p) => {
              const abrivel = (p.papel === 'ALUNO' && p.alunoId) || p.papel === 'PROFESSOR' || p.papel === 'ORIENTADOR'
              const abrir = () => { if (p.papel === 'ALUNO' && p.alunoId) onOpen('aluno', p.alunoId); else if (p.papel === 'PROFESSOR' || p.papel === 'ORIENTADOR') onOpen('prof', p.refId) }
              return (
                <div key={`${p.papel}-${p.refId}`} class={`px-4 py-2.5 flex items-center gap-3 text-sm ${abrivel ? 'cursor-pointer hover:bg-surface-2' : ''}`} onClick={abrir}>
                  <span class="flex-1 min-w-0">
                    <span class="block truncate text-fg">{p.nome}</span>
                    <span class="block text-xs text-fg-muted">{p.ra ? `RA ${p.ra}` : ''}{p.documento ? ` · CPF ${p.documento}` : ''}{p.email ? ` · ${p.email}` : ''}{p.extra ? ` · ${p.extra}` : ''}</span>
                  </span>
                  {p.ativo === false && <Badge tone="neutral">inativo</Badge>}
                  <Badge tone={PAPEL_LABEL[p.papel]?.tone ?? 'neutral'}>{PAPEL_LABEL[p.papel]?.label ?? p.papel}</Badge>
                  {abrivel && <span class="text-xs text-accent">abrir ficha →</span>}
                </div>
              )
            })}
          </Card>
        )}
      <p class="text-xs text-fg-muted">A ficha completa (documentos, dados complementares, sócio-econômico, endereço) é editável para <b>Aluno</b>. Professor/Coordenador/Candidato são geridos em seus próprios módulos.</p>
    </Page>
  )
}

function NovaPessoaModal({ onClose, onCreated }: { onClose: () => void; onCreated: (tipo: 'aluno' | 'prof', id: number) => void }) {
  const refs = usePessoasRefs(true)
  const mut = useCriarPessoa()
  const [papel, setPapel] = useState('ALUNO')
  const [f, setF] = useState<any>({ regime: 'HORISTA' })
  const [modo, setModo] = useState<'novo' | 'existente'>('novo') // só ALUNO
  const [leadQ, setLeadQ] = useState('')
  const buscaLeads = useBuscarLeads(leadQ)
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const r = refs.data
  const alunoExistente = papel === 'ALUNO' && modo === 'existente'
  const podeSalvar = papel === 'ALUNO' ? (alunoExistente ? !!f.leadId : !!f.nome) : papel === 'COORDENADOR' ? (!!f.nome && !!f.courseId) : papel === 'CANDIDATO' ? (!!f.nome && !!f.selectionProcessId && !!f.offeringId) : !!f.userId
  const submit = () => {
    const body: any = { papel, ...f }
    if (papel === 'ALUNO') { if (alunoExistente) { delete body.nome; delete body.email; delete body.whatsapp } else delete body.leadId }
    if (papel === 'PROFESSOR' || papel === 'ORIENTADOR') body.valorHoraCentavos = Math.round(parseFloat((f.valorHora || '0').replace(',', '.')) * 100)
    mut.mutate(body, {
      onSuccess: (res: any) => { toast('Pessoa criada', 'success'); onClose(); if (res.alunoId) onCreated('aluno', res.alunoId); else if (res.docenteId) onCreated('prof', res.docenteId) },
      onError: (e: any) => toast(e?.message || 'Erro ao criar', 'danger'),
    })
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Nova pessoa" description="Escolha o papel e preencha os dados."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.isPending} disabled={!podeSalvar} onClick={submit}>Criar</Button></>}>
      <div class="space-y-3">
        <div class="flex flex-wrap gap-1">
          {['ALUNO', 'PROFESSOR', 'ORIENTADOR', 'COORDENADOR', 'CANDIDATO'].map((p) => (
            <button key={p} class={`text-xs px-3 py-1.5 rounded-md border ${papel === p ? 'bg-accent/10 border-accent text-accent' : 'border-border text-fg-muted hover:bg-surface-2'}`} onClick={() => setPapel(p)}>{PAPEL_LABEL[p].label}</button>
          ))}
        </div>
        {papel === 'ALUNO' && (
          <div class="space-y-3">
            <div class="flex gap-1">
              <button class={`text-xs px-3 py-1.5 rounded-md border ${modo === 'novo' ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => { setModo('novo'); setF({ ...f, leadId: undefined, leadNome: undefined }) }}>Novo contato</button>
              <button class={`text-xs px-3 py-1.5 rounded-md border ${modo === 'existente' ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setModo('existente')}>Contato existente</button>
            </div>
            {modo === 'novo' ? (
              <div class="grid sm:grid-cols-2 gap-3">
                <Input label="Nome*" value={f.nome || ''} onInput={(e: any) => set('nome', e.currentTarget.value)} />
                <Input label="E-mail" value={f.email || ''} onInput={(e: any) => set('email', e.currentTarget.value)} />
                <Input label="WhatsApp" value={f.whatsapp || ''} onInput={(e: any) => set('whatsapp', e.currentTarget.value)} />
                <Input label="CPF" value={f.cpf || ''} onInput={(e: any) => set('cpf', e.currentTarget.value)} />
              </div>
            ) : f.leadId ? (
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-sm bg-surface-2 rounded-md px-3 py-2">
                  <span class="flex-1 text-fg">Contato selecionado: <b>{f.leadNome}</b></span>
                  <button class="text-xs text-accent" onClick={() => setF({ ...f, leadId: undefined, leadNome: undefined })}>trocar</button>
                </div>
                <Input label="CPF (opcional)" value={f.cpf || ''} onInput={(e: any) => set('cpf', e.currentTarget.value)} />
              </div>
            ) : (
              <div class="space-y-2">
                <Input label="Buscar contato (nome, e-mail, WhatsApp)" value={leadQ} onInput={(e: any) => setLeadQ(e.currentTarget.value)} placeholder="Digite ao menos 2 letras…" />
                {buscaLeads.isLoading && leadQ.trim().length >= 2 && <p class="text-xs text-fg-muted">Buscando…</p>}
                {(buscaLeads.data?.leads?.length ?? 0) > 0 && (
                  <Card class="p-0 overflow-hidden divide-y divide-border max-h-48 overflow-y-auto">
                    {buscaLeads.data!.leads.map((l) => (
                      <button key={l.id} class="w-full text-left px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setF({ ...f, leadId: l.id, leadNome: l.nome }); setLeadQ('') }}>
                        <span class="block text-fg">{l.nome}</span>
                        <span class="block text-xs text-fg-muted">{l.email}{l.whatsapp ? ` · ${l.whatsapp}` : ''}</span>
                      </button>
                    ))}
                  </Card>
                )}
                {buscaLeads.data && leadQ.trim().length >= 2 && buscaLeads.data.leads.length === 0 && <p class="text-xs text-fg-muted">Nenhum contato (sem aluno) encontrado. Use "Novo contato".</p>}
              </div>
            )}
          </div>
        )}
        {papel === 'CANDIDATO' && (
          <div class="grid sm:grid-cols-2 gap-3">
            <Input label="Nome*" value={f.nome || ''} onInput={(e: any) => set('nome', e.currentTarget.value)} />
            <Input label="E-mail" value={f.email || ''} onInput={(e: any) => set('email', e.currentTarget.value)} />
            <Input label="WhatsApp" value={f.whatsapp || ''} onInput={(e: any) => set('whatsapp', e.currentTarget.value)} />
          </div>
        )}
        {papel === 'CANDIDATO' && (
          <div class="grid sm:grid-cols-2 gap-3">
            <Select label="Processo seletivo*" value={f.selectionProcessId || ''} onChange={(e: any) => set('selectionProcessId', e.currentTarget.value)}><option value="">—</option>{r?.processos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select>
            <Select label="Oferta*" value={f.offeringId || ''} onChange={(e: any) => set('offeringId', e.currentTarget.value)}><option value="">—</option>{r?.offerings.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</Select>
          </div>
        )}
        {(papel === 'PROFESSOR' || papel === 'ORIENTADOR') && (
          <div class="grid sm:grid-cols-2 gap-3">
            <Select label="Usuário*" value={f.userId || ''} onChange={(e: any) => set('userId', e.currentTarget.value)}><option value="">—</option>{r?.usuarios.filter((u) => !u.jaDocente).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            <Input label="Titulação" value={f.titulacao || ''} onInput={(e: any) => set('titulacao', e.currentTarget.value)} />
            <Select label="Regime" value={f.regime} onChange={(e: any) => set('regime', e.currentTarget.value)}><option value="HORISTA">Horista</option><option value="PARCIAL">Parcial</option><option value="INTEGRAL">Integral</option></Select>
            <Input label="Valor/hora (R$)" value={f.valorHora || ''} onInput={(e: any) => set('valorHora', e.currentTarget.value)} />
            <p class="text-xs text-fg-muted sm:col-span-2">Só usuários do sistema que ainda não são docentes aparecem na lista.</p>
          </div>
        )}
        {papel === 'COORDENADOR' && (
          <div class="grid sm:grid-cols-2 gap-3">
            <Input label="Nome*" value={f.nome || ''} onInput={(e: any) => set('nome', e.currentTarget.value)} />
            <Input label="E-mail" value={f.email || ''} onInput={(e: any) => set('email', e.currentTarget.value)} />
            <Select label="Curso*" class="sm:col-span-2" value={f.courseId || ''} onChange={(e: any) => set('courseId', e.currentTarget.value)}><option value="">—</option>{r?.cursos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>
          </div>
        )}
      </div>
    </Modal>
  )
}

type Tab = 'identidade' | 'complementares' | 'responsaveis' | 'documentos' | 'socio' | 'endereco'

function FichaCompleta({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useFichaAluno(id)
  const mut = useSalvarFicha(id)
  const [tab, setTab] = useState<Tab>('identidade')
  const [f, setF] = useState<any>(null)
  const a = q.data?.aluno

  useEffect(() => { if (a && f === null) setF(montar(a)) }, [a])
  if (q.isLoading || !a || f === null) return <Page title="Ficha"><Skeleton class="h-64 w-full" /></Page>

  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const setJ = (grupo: 'doc' | 'socio' | 'end', k: string, v: any) => setF({ ...f, [grupo]: { ...f[grupo], [k]: v } })
  const setJ2 = (grupo: 'doc', sub: string, k: string, v: any) => setF({ ...f, [grupo]: { ...f[grupo], [sub]: { ...(f[grupo][sub] || {}), [k]: v } } })
  const salvar = () => mut.mutate(payload(f), { onSuccess: onBack })

  const TABS: [Tab, string, any][] = [['identidade', 'Identidade', IdCard], ['complementares', 'Complementares', UserSquare], ['responsaveis', 'Responsáveis', Users], ['documentos', 'Documentos', FileText], ['socio', 'Sócio-econômico', Coins], ['endereco', 'Endereço & contatos', Home]]

  return (
    <Page title={`Ficha — ${a.lead.nome}`} description={`RA ${a.ra || '—'} · ${a.matriculas.length} matrícula(s)`}>
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        <Button variant="primary" size="sm" loading={mut.isPending} onClick={salvar}><Save size={14} /> Salvar ficha</Button>
      </div>
      <div class="flex gap-1 border-b border-border flex-wrap">
        {TABS.map(([k, l, Ico]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 flex items-center gap-1 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}><Ico size={13} /> {l}</button>
        ))}
      </div>

      {tab === 'identidade' && (
        <Card class="grid sm:grid-cols-3 gap-3">
          <Input label="Nome" value={a.lead.nome} disabled />
          <Input label="Nome social" value={f.nomeSocial} onInput={(e: any) => set('nomeSocial', e.currentTarget.value)} />
          <Input label="CPF" value={f.cpf} onInput={(e: any) => set('cpf', e.currentTarget.value)} />
          <Input label="RG" value={f.rg} onInput={(e: any) => set('rg', e.currentTarget.value)} />
          <Input label="Órgão emissor RG" value={f.rgOrgaoEmissor} onInput={(e: any) => set('rgOrgaoEmissor', e.currentTarget.value)} />
          <Input label="Data de nascimento" type="date" value={f.dataNascimento} onInput={(e: any) => set('dataNascimento', e.currentTarget.value)} />
          <Select label="Sexo" value={f.sexo} onChange={(e: any) => set('sexo', e.currentTarget.value)}><option value="">—</option><option>Masculino</option><option>Feminino</option><option>Outro</option></Select>
          <Select label="Cor/Raça/Etnia" value={f.racaCor} onChange={(e: any) => set('racaCor', e.currentTarget.value)}><option value="">—</option><option>Branca</option><option>Preta</option><option>Parda</option><option>Amarela</option><option>Indígena</option><option>Não declarada</option></Select>
          <Input label="Nacionalidade" value={f.nacionalidade} onInput={(e: any) => set('nacionalidade', e.currentTarget.value)} />
          <Input label="Naturalidade (município/UF)" value={f.naturalidade} onInput={(e: any) => set('naturalidade', e.currentTarget.value)} />
          <Input label="Estado civil" value={f.estadoCivil} onInput={(e: any) => set('estadoCivil', e.currentTarget.value)} />
          <Input label="Religião" value={f.religiao} onInput={(e: any) => set('religiao', e.currentTarget.value)} />
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Ativo</label>
        </Card>
      )}

      {tab === 'complementares' && (
        <div class="space-y-3">
          <Card class="grid sm:grid-cols-2 gap-3">
            <Input label="Nome do pai" value={f.nomePai} onInput={(e: any) => set('nomePai', e.currentTarget.value)} />
            <Input label="Nome da mãe" value={f.nomeMae} onInput={(e: any) => set('nomeMae', e.currentTarget.value)} />
            <Input label="Código INEP" value={f.codigoInep} onInput={(e: any) => set('codigoInep', e.currentTarget.value)} />
            <Input label="Código GDAE" value={f.codigoGdae} onInput={(e: any) => set('codigoGdae', e.currentTarget.value)} />
            <label class="flex items-center gap-2 text-sm text-fg-muted self-end pb-2"><input type="checkbox" checked={f.emancipado} onChange={(e: any) => set('emancipado', e.currentTarget.checked)} /> Emancipado(a)</label>
          </Card>
          <Card class="space-y-2">
            <div class="text-sm font-semibold text-fg">ENEM</div>
            <div class="grid sm:grid-cols-3 gap-2">
              <Input label="Ano" type="number" value={f.enemAno} onInput={(e: any) => set('enemAno', e.currentTarget.value)} />
              <Input label="Código de inscrição" value={f.enemInscricao} onInput={(e: any) => set('enemInscricao', e.currentTarget.value)} />
              <Input label="Nota" type="number" step="0.1" value={f.enemNota} onInput={(e: any) => set('enemNota', e.currentTarget.value)} />
            </div>
          </Card>
          <Card class="space-y-2">
            <div class="text-sm font-semibold text-fg">Saída do aluno</div>
            <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.podeSairSozinho} onChange={(e: any) => set('podeSairSozinho', e.currentTarget.checked)} /> Pode sair sozinho</label>
            <div class="text-xs text-fg-muted">Pessoas autorizadas a retirar o aluno:</div>
            {(f.autorizados as any[]).map((p: any, i: number) => (
              <div key={i} class="flex gap-2 items-center">
                <Input class="flex-1" placeholder="Nome" value={p.nome} onInput={(e: any) => { const arr = [...f.autorizados]; arr[i] = { ...arr[i], nome: e.currentTarget.value }; set('autorizados', arr) }} />
                <Input class="!w-32" placeholder="Parentesco" value={p.parentesco} onInput={(e: any) => { const arr = [...f.autorizados]; arr[i] = { ...arr[i], parentesco: e.currentTarget.value }; set('autorizados', arr) }} />
                <Input class="!w-32" placeholder="Documento" value={p.documento} onInput={(e: any) => { const arr = [...f.autorizados]; arr[i] = { ...arr[i], documento: e.currentTarget.value }; set('autorizados', arr) }} />
                <button class="text-fg-muted hover:text-danger" onClick={() => set('autorizados', f.autorizados.filter((_: any, j: number) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => set('autorizados', [...f.autorizados, { nome: '', parentesco: '', documento: '' }])}><Plus size={14} /> Adicionar pessoa</Button>
          </Card>
        </div>
      )}

      {tab === 'responsaveis' && <ResponsaveisTab alunoId={id} responsaveis={a.responsaveis} />}

      {tab === 'documentos' && (
        <div class="space-y-3">
          <Card class="grid sm:grid-cols-3 gap-3">
            <Input label="CNH" value={f.doc.cnh} onInput={(e: any) => setJ('doc', 'cnh', e.currentTarget.value)} />
            <Input label="Categoria CNH" value={f.doc.cnhCategoria} onInput={(e: any) => setJ('doc', 'cnhCategoria', e.currentTarget.value)} />
            <Input label="PIS" value={f.doc.pis} onInput={(e: any) => setJ('doc', 'pis', e.currentTarget.value)} />
            <Input label="Currículo Lattes" class="sm:col-span-2" value={f.doc.lattes} onInput={(e: any) => setJ('doc', 'lattes', e.currentTarget.value)} />
            <Input label="RNM (estrangeiro)" value={f.doc.rnm} onInput={(e: any) => setJ('doc', 'rnm', e.currentTarget.value)} />
          </Card>
          <Card class="space-y-2">
            <div class="text-sm font-semibold text-fg">Título de eleitor</div>
            <div class="grid sm:grid-cols-4 gap-2">
              <Input label="Número" value={f.doc.tituloEleitor?.numero} onInput={(e: any) => setJ2('doc', 'tituloEleitor', 'numero', e.currentTarget.value)} />
              <Input label="Zona" value={f.doc.tituloEleitor?.zona} onInput={(e: any) => setJ2('doc', 'tituloEleitor', 'zona', e.currentTarget.value)} />
              <Input label="Seção" value={f.doc.tituloEleitor?.secao} onInput={(e: any) => setJ2('doc', 'tituloEleitor', 'secao', e.currentTarget.value)} />
              <Input label="Município" value={f.doc.tituloEleitor?.municipio} onInput={(e: any) => setJ2('doc', 'tituloEleitor', 'municipio', e.currentTarget.value)} />
            </div>
          </Card>
          <Card class="space-y-2">
            <div class="text-sm font-semibold text-fg">Certidão civil</div>
            <div class="grid sm:grid-cols-3 gap-2">
              <Input label="Tipo" value={f.doc.certidaoCivil?.tipo} onInput={(e: any) => setJ2('doc', 'certidaoCivil', 'tipo', e.currentTarget.value)} />
              <Input label="Número" value={f.doc.certidaoCivil?.numero} onInput={(e: any) => setJ2('doc', 'certidaoCivil', 'numero', e.currentTarget.value)} />
              <Input label="Livro" value={f.doc.certidaoCivil?.livro} onInput={(e: any) => setJ2('doc', 'certidaoCivil', 'livro', e.currentTarget.value)} />
              <Input label="Folha" value={f.doc.certidaoCivil?.folha} onInput={(e: any) => setJ2('doc', 'certidaoCivil', 'folha', e.currentTarget.value)} />
              <Input label="Cartório" class="sm:col-span-2" value={f.doc.certidaoCivil?.cartorio} onInput={(e: any) => setJ2('doc', 'certidaoCivil', 'cartorio', e.currentTarget.value)} />
            </div>
          </Card>
        </div>
      )}

      {tab === 'socio' && (
        <Card class="grid sm:grid-cols-2 gap-3">
          <Input label="Renda familiar" value={f.socio.renda} onInput={(e: any) => setJ('socio', 'renda', e.currentTarget.value)} />
          <Input label="Moradia (própria/alugada…)" value={f.socio.moradia} onInput={(e: any) => setJ('socio', 'moradia', e.currentTarget.value)} />
          <Input label="Com quem mora" value={f.socio.comQuemMora} onInput={(e: any) => setJ('socio', 'comQuemMora', e.currentTarget.value)} />
          <Input label="Povo indígena (se houver)" value={f.socio.povoIndigena} onInput={(e: any) => setJ('socio', 'povoIndigena', e.currentTarget.value)} />
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.socio.beneficioGov} onChange={(e: any) => setJ('socio', 'beneficioGov', e.currentTarget.checked)} /> Recebe benefício governamental</label>
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.socio.transporteEscolarPublico} onChange={(e: any) => setJ('socio', 'transporteEscolarPublico', e.currentTarget.checked)} /> Usa transporte escolar público</label>
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.socio.internetDomicilio} onChange={(e: any) => setJ('socio', 'internetDomicilio', e.currentTarget.checked)} /> Internet no domicílio</label>
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.socio.refeicaoInstituicao} onChange={(e: any) => setJ('socio', 'refeicaoInstituicao', e.currentTarget.checked)} /> Faz refeição na instituição</label>
        </Card>
      )}

      {tab === 'endereco' && (
        <Card class="grid sm:grid-cols-3 gap-3">
          <Input label="CEP" value={f.end.cep} onInput={(e: any) => setJ('end', 'cep', e.currentTarget.value)} />
          <Input label="Logradouro" class="sm:col-span-2" value={f.end.logradouro} onInput={(e: any) => setJ('end', 'logradouro', e.currentTarget.value)} />
          <Input label="Número" value={f.end.numero} onInput={(e: any) => setJ('end', 'numero', e.currentTarget.value)} />
          <Input label="Bairro" value={f.end.bairro} onInput={(e: any) => setJ('end', 'bairro', e.currentTarget.value)} />
          <Input label="Complemento" value={f.end.complemento} onInput={(e: any) => setJ('end', 'complemento', e.currentTarget.value)} />
          <Input label="Município" value={f.end.municipio} onInput={(e: any) => setJ('end', 'municipio', e.currentTarget.value)} />
          <Input label="UF" value={f.end.uf} onInput={(e: any) => setJ('end', 'uf', e.currentTarget.value)} />
          <Select label="Zona" value={f.end.zona} onChange={(e: any) => setJ('end', 'zona', e.currentTarget.value)}><option value="">—</option><option>Urbana</option><option>Rural</option></Select>
          <Input label="Tel. residencial" value={f.end.telResidencial} onInput={(e: any) => setJ('end', 'telResidencial', e.currentTarget.value)} />
          <Input label="Tel. celular" value={f.end.telCelular} onInput={(e: any) => setJ('end', 'telCelular', e.currentTarget.value)} />
          <Input label="E-mail alternativo" value={f.end.emailAlternativo} onInput={(e: any) => setJ('end', 'emailAlternativo', e.currentTarget.value)} />
        </Card>
      )}
    </Page>
  )
}

function montar(a: FichaAluno): any {
  return {
    nomeSocial: a.nomeSocial ?? '', cpf: a.cpf ?? '', rg: a.rg ?? '', rgOrgaoEmissor: a.rgOrgaoEmissor ?? '',
    dataNascimento: a.dataNascimento ? a.dataNascimento.slice(0, 10) : '', sexo: a.sexo ?? '', racaCor: a.racaCor ?? '',
    nacionalidade: a.nacionalidade ?? '', naturalidade: a.naturalidade ?? '', estadoCivil: a.estadoCivil ?? '', religiao: a.religiao ?? '',
    nomePai: a.nomePai ?? '', nomeMae: a.nomeMae ?? '', codigoInep: a.codigoInep ?? '', emancipado: !!a.emancipado, ativo: a.ativo,
    codigoGdae: a.codigoGdae ?? '', enemAno: a.enemAno ?? '', enemInscricao: a.enemInscricao ?? '', enemNota: a.enemNota ?? '',
    podeSairSozinho: a.podeSairSozinho ?? true, autorizados: Array.isArray(a.pessoasAutorizadasJson) ? a.pessoasAutorizadasJson : [],
    doc: a.documentosJson ?? {}, socio: a.socioEconomicoJson ?? {}, end: a.enderecoJson ?? {},
  }
}
function payload(f: any): any {
  return {
    nomeSocial: f.nomeSocial, cpf: f.cpf, rg: f.rg, rgOrgaoEmissor: f.rgOrgaoEmissor, dataNascimento: f.dataNascimento || null,
    sexo: f.sexo, racaCor: f.racaCor, nacionalidade: f.nacionalidade, naturalidade: f.naturalidade, estadoCivil: f.estadoCivil,
    religiao: f.religiao, nomePai: f.nomePai, nomeMae: f.nomeMae, codigoInep: f.codigoInep, emancipado: f.emancipado, ativo: f.ativo,
    codigoGdae: f.codigoGdae, enemAno: f.enemAno || null, enemInscricao: f.enemInscricao, enemNota: f.enemNota === '' ? null : f.enemNota,
    podeSairSozinho: f.podeSairSozinho, pessoasAutorizadasJson: f.autorizados,
    documentosJson: f.doc, socioEconomicoJson: f.socio, enderecoJson: f.end,
  }
}

function ResponsaveisTab({ alunoId, responsaveis }: { alunoId: number; responsaveis: any[] }) {
  const mut = useResponsavelMut(alunoId)
  const [novo, setNovo] = useState({ nome: '', tipo: 'CONTRATO', parentesco: '', telefone: '', cpf: '' })
  const add = () => { if (!novo.nome) return; mut.criar.mutate(novo, { onSuccess: () => setNovo({ nome: '', tipo: 'CONTRATO', parentesco: '', telefone: '', cpf: '' }) }) }
  const tipoLabel = (t: string) => RESP_TIPOS.find((x) => x.key === t)?.label ?? t
  return (
    <div class="space-y-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Novo responsável</div>
        <div class="grid sm:grid-cols-5 gap-2">
          <Input class="sm:col-span-2" placeholder="Nome" value={novo.nome} onInput={(e: any) => setNovo({ ...novo, nome: e.currentTarget.value })} />
          <Select value={novo.tipo} onChange={(e: any) => setNovo({ ...novo, tipo: e.currentTarget.value })}>{RESP_TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
          <Input placeholder="Parentesco" value={novo.parentesco} onInput={(e: any) => setNovo({ ...novo, parentesco: e.currentTarget.value })} />
          <Input placeholder="Telefone" value={novo.telefone} onInput={(e: any) => setNovo({ ...novo, telefone: e.currentTarget.value })} />
        </div>
        <Button size="sm" variant="secondary" disabled={!novo.nome || mut.criar.isPending} onClick={add}><Plus size={14} /> Adicionar</Button>
      </Card>
      {responsaveis.length === 0 ? <p class="text-sm text-fg-muted">Nenhum responsável cadastrado.</p> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {responsaveis.map((r) => (
            <div key={r.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{r.nome}</span><span class="block text-xs text-fg-muted">{r.parentesco || '—'}{r.telefone ? ` · ${r.telefone}` : ''}</span></span>
              <Badge tone="info">{tipoLabel(r.tipo)}</Badge>
              <button class="text-fg-muted hover:text-danger" onClick={() => mut.excluir.mutate(r.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function FichaProfessor({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useFichaProfessor(id)
  const mut = useSalvarProfessor(id)
  const [f, setF] = useState<any>(null)
  const d = q.data?.docente
  useEffect(() => { if (d && f === null) setF({ titulacao: d.titulacao ?? '', regime: d.regime, valorHora: (d.valorHoraCentavos / 100).toString(), ativo: d.ativo, orientador: d.orientador, dados: d.dadosJson ?? {} }) }, [d])
  if (q.isLoading || !d || f === null) return <Page title="Ficha"><Skeleton class="h-64 w-full" /></Page>
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const setD = (k: string, v: any) => setF({ ...f, dados: { ...f.dados, [k]: v } })
  const salvar = () => mut.mutate({ titulacao: f.titulacao, regime: f.regime, valorHoraCentavos: Math.round(parseFloat(f.valorHora.replace(',', '.') || '0') * 100), ativo: f.ativo, orientador: f.orientador, dadosJson: f.dados }, { onSuccess: onBack })
  return (
    <Page title={`Ficha — ${d.nome}`} description="Professor / Colaborador">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        <Button variant="primary" size="sm" loading={mut.isPending} onClick={salvar}><Save size={14} /> Salvar</Button>
      </div>
      <Card class="grid sm:grid-cols-3 gap-3">
        <Input label="Titulação" value={f.titulacao} onInput={(e: any) => set('titulacao', e.currentTarget.value)} />
        <Select label="Regime" value={f.regime} onChange={(e: any) => set('regime', e.currentTarget.value)}><option value="HORISTA">Horista</option><option value="PARCIAL">Parcial</option><option value="INTEGRAL">Integral</option></Select>
        <Input label="Valor/hora (R$)" value={f.valorHora} onInput={(e: any) => set('valorHora', e.currentTarget.value)} />
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Ativo</label>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.orientador} onChange={(e: any) => set('orientador', e.currentTarget.checked)} /> É orientador</label>
      </Card>
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Briefcase size={16} /> Dados profissionais</div>
        <div class="grid sm:grid-cols-2 gap-3">
          <Input label="Conta bancária" value={f.dados.contaBancaria ?? ''} onInput={(e: any) => setD('contaBancaria', e.currentTarget.value)} hint="banco / agência / conta" />
          <Input label="Tipo de professor" value={f.dados.tipoProfessor ?? ''} onInput={(e: any) => setD('tipoProfessor', e.currentTarget.value)} />
          <Input label="Registro estadual" value={f.dados.registroEstadual ?? ''} onInput={(e: any) => setD('registroEstadual', e.currentTarget.value)} />
          <Input label="Departamento" value={f.dados.departamento ?? ''} onInput={(e: any) => setD('departamento', e.currentTarget.value)} />
          <Input label="CTPS (nº/série)" value={f.dados.ctps ?? ''} onInput={(e: any) => setD('ctps', e.currentTarget.value)} />
          <Input label="Qualificação profissional" value={f.dados.qualificacao ?? ''} onInput={(e: any) => setD('qualificacao', e.currentTarget.value)} />
        </div>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.dados.credenciadoPos} onChange={(e: any) => setD('credenciadoPos', e.currentTarget.checked)} /> Credenciado para ministrar na Pós-graduação</label>
      </Card>
    </Page>
  )
}
