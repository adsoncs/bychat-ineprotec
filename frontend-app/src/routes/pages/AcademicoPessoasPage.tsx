import { useState, useEffect } from 'preact/hooks'
import { Users, ArrowLeft, Save, IdCard, FileText, Home, Coins, UserSquare } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { usePessoas, useFichaAluno, useSalvarFicha, PAPEL_LABEL, type FichaAluno } from '@/hooks/useAcaPessoas'

const PAPEIS = ['', 'ALUNO', 'PROFESSOR', 'COORDENADOR', 'CANDIDATO']

export function AcademicoPessoasPage() {
  const [alunoId, setAlunoId] = useState<number | null>(null)
  if (alunoId !== null) return <FichaCompleta id={alunoId} onBack={() => setAlunoId(null)} />
  return <Lista onOpenAluno={setAlunoId} />
}

function Lista({ onOpenAluno }: { onOpenAluno: (id: number) => void }) {
  const [papel, setPapel] = useState('')
  const [q, setQ] = useState('')
  const data = usePessoas(papel, q)
  const pessoas = data.data?.pessoas ?? []
  const counts = data.data?.counts ?? {}

  return (
    <Page title="Pessoas" description="Cadastro unificado de pessoas por papel: aluno, professor, coordenador e candidato.">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome, CPF ou RA…" />
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
            {pessoas.map((p) => (
              <div key={`${p.papel}-${p.refId}`} class={`px-4 py-2.5 flex items-center gap-3 text-sm ${p.papel === 'ALUNO' ? 'cursor-pointer hover:bg-surface-2' : ''}`} onClick={() => p.papel === 'ALUNO' && p.alunoId && onOpenAluno(p.alunoId)}>
                <span class="flex-1 min-w-0">
                  <span class="block truncate text-fg">{p.nome}</span>
                  <span class="block text-xs text-fg-muted">{p.ra ? `RA ${p.ra}` : ''}{p.documento ? ` · CPF ${p.documento}` : ''}{p.email ? ` · ${p.email}` : ''}{p.extra ? ` · ${p.extra}` : ''}</span>
                </span>
                {p.ativo === false && <Badge tone="neutral">inativo</Badge>}
                <Badge tone={PAPEL_LABEL[p.papel]?.tone ?? 'neutral'}>{PAPEL_LABEL[p.papel]?.label ?? p.papel}</Badge>
                {p.papel === 'ALUNO' && <span class="text-xs text-accent">abrir ficha →</span>}
              </div>
            ))}
          </Card>
        )}
      <p class="text-xs text-fg-muted">A ficha completa (documentos, dados complementares, sócio-econômico, endereço) é editável para <b>Aluno</b>. Professor/Coordenador/Candidato são geridos em seus próprios módulos.</p>
    </Page>
  )
}

type Tab = 'identidade' | 'complementares' | 'documentos' | 'socio' | 'endereco'

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

  const TABS: [Tab, string, any][] = [['identidade', 'Identidade', IdCard], ['complementares', 'Complementares', UserSquare], ['documentos', 'Documentos', FileText], ['socio', 'Sócio-econômico', Coins], ['endereco', 'Endereço & contatos', Home]]

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
        <Card class="grid sm:grid-cols-2 gap-3">
          <Input label="Nome do pai" value={f.nomePai} onInput={(e: any) => set('nomePai', e.currentTarget.value)} />
          <Input label="Nome da mãe" value={f.nomeMae} onInput={(e: any) => set('nomeMae', e.currentTarget.value)} />
          <Input label="Código INEP" value={f.codigoInep} onInput={(e: any) => set('codigoInep', e.currentTarget.value)} />
          <label class="flex items-center gap-2 text-sm text-fg-muted self-end pb-2"><input type="checkbox" checked={f.emancipado} onChange={(e: any) => set('emancipado', e.currentTarget.checked)} /> Emancipado(a)</label>
        </Card>
      )}

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
    doc: a.documentosJson ?? {}, socio: a.socioEconomicoJson ?? {}, end: a.enderecoJson ?? {},
  }
}
function payload(f: any): any {
  return {
    nomeSocial: f.nomeSocial, cpf: f.cpf, rg: f.rg, rgOrgaoEmissor: f.rgOrgaoEmissor, dataNascimento: f.dataNascimento || null,
    sexo: f.sexo, racaCor: f.racaCor, nacionalidade: f.nacionalidade, naturalidade: f.naturalidade, estadoCivil: f.estadoCivil,
    religiao: f.religiao, nomePai: f.nomePai, nomeMae: f.nomeMae, codigoInep: f.codigoInep, emancipado: f.emancipado, ativo: f.ativo,
    documentosJson: f.doc, socioEconomicoJson: f.socio, enderecoJson: f.end,
  }
}
