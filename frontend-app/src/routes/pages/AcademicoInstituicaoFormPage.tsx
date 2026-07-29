import { useState, useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Save } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useMantenedoras, useSaveMantenedora, useIesList, useSaveIes, useCreateAto,
} from '@/hooks/useAcaFundacao'
import { toast } from '@/lib/toast'

// Formulários da hierarquia institucional em TELA DEDICADA (sem modal):
//   /aca/instituicao/mantenedora/:id   ('nova' para criar)
//   /aca/instituicao/ies/:id           ('nova' + ?mantenedora=N)
//   /aca/instituicao/ato/:escopo/:entidadeId

const CATEGORIAS = [
  ['privada_com_fins', 'Privada com fins lucrativos'],
  ['privada_sem_fins', 'Privada sem fins lucrativos'],
  ['publica_federal', 'Pública federal'],
  ['publica_estadual', 'Pública estadual'],
  ['publica_municipal', 'Pública municipal'],
] as const

const ORGANIZACOES = [
  ['faculdade', 'Faculdade'],
  ['centro_universitario', 'Centro universitário'],
  ['universidade', 'Universidade'],
  ['if_cefet', 'IF / CEFET'],
] as const

const TIPOS_ATO = [
  ['credenciamento', 'Credenciamento'],
  ['recredenciamento', 'Recredenciamento'],
  ['autorizacao', 'Autorização'],
  ['reconhecimento', 'Reconhecimento'],
  ['renovacao', 'Renovação de reconhecimento'],
] as const

function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" class="flex items-center gap-1 text-sm text-fg-muted hover:text-fg" onClick={onClick}>
      <ChevronLeft size={15} /> Voltar
    </button>
  )
}

export function AcademicoInstituicaoFormPage({ params }: { params: { tipo: string; id?: string; entidadeId?: string } }) {
  const [, navigate] = useLocation()
  const voltar = () => navigate('/aca/instituicao')
  const tipo = params.tipo

  if (tipo === 'mantenedora') return <FormMantenedora id={params.id ?? 'nova'} onVoltar={voltar} />
  if (tipo === 'ies') return <FormIes id={params.id ?? 'nova'} onVoltar={voltar} />
  return <FormAto escopo={(params.id ?? 'IES') as 'IES' | 'CURSO'} entidadeId={Number(params.entidadeId)} onVoltar={voltar} />
}

// ── Mantenedora ──

function FormMantenedora({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const criando = id === 'nova'
  const lista = useMantenedoras()
  const save = useSaveMantenedora()
  const atual = criando ? null : (lista.data?.mantenedoras ?? []).find((m) => m.id === Number(id))
  const [f, setF] = useState({ razaoSocial: '', nomeFantasia: '', cnpj: '', repNome: '', repCpf: '', repCargo: '', telefone: '', email: '' })
  const [pronto, setPronto] = useState(criando)

  useEffect(() => {
    if (criando || pronto || !atual) return
    setF({
      razaoSocial: atual.razaoSocial ?? '', nomeFantasia: atual.nomeFantasia ?? '', cnpj: atual.cnpj ?? '',
      repNome: atual.repNome ?? '', repCpf: atual.repCpf ?? '', repCargo: atual.repCargo ?? '',
      telefone: atual.telefone ?? '', email: atual.email ?? '',
    })
    setPronto(true)
  }, [atual, criando, pronto])

  function submeter() {
    if (!f.razaoSocial.trim()) { toast('Informe a razão social', 'warning'); return }
    save.mutate({ ...(criando ? {} : { id: Number(id) }), ...f }, {
      onSuccess: () => { toast(criando ? 'Mantenedora criada' : 'Mantenedora salva', 'success'); onVoltar() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (!criando && lista.isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <Page title={criando ? 'Nova mantenedora' : 'Editar mantenedora'} description="Pessoa jurídica que mantém a instituição de ensino." actions={<Voltar onClick={onVoltar} />}>
      <Card class="space-y-4 max-w-3xl">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="md:col-span-2">
            <Input label="Razão social *" value={f.razaoSocial} onInput={(e) => setF({ ...f, razaoSocial: (e.target as HTMLInputElement).value })} />
          </div>
          <Input label="Nome fantasia" value={f.nomeFantasia} onInput={(e) => setF({ ...f, nomeFantasia: (e.target as HTMLInputElement).value })} />
          <Input label="CNPJ" value={f.cnpj} onInput={(e) => setF({ ...f, cnpj: (e.target as HTMLInputElement).value })} />
        </div>

        <div>
          <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">Representante legal</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Nome" value={f.repNome} onInput={(e) => setF({ ...f, repNome: (e.target as HTMLInputElement).value })} />
            <Input label="CPF" value={f.repCpf} onInput={(e) => setF({ ...f, repCpf: (e.target as HTMLInputElement).value })} />
            <Input label="Cargo" value={f.repCargo} onInput={(e) => setF({ ...f, repCargo: (e.target as HTMLInputElement).value })} />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="Telefone" value={f.telefone} onInput={(e) => setF({ ...f, telefone: (e.target as HTMLInputElement).value })} />
          <Input label="E-mail" value={f.email} onInput={(e) => setF({ ...f, email: (e.target as HTMLInputElement).value })} />
        </div>

        <div class="flex gap-2 pt-1">
          <Button variant="primary" onClick={submeter} disabled={save.isPending}>
            <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button variant="ghost" onClick={onVoltar}>Cancelar</Button>
        </div>
      </Card>
    </Page>
  )
}

// ── IES ──

function FormIes({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const criando = id === 'nova'
  const mantenedoras = useMantenedoras()
  const lista = useIesList()
  const save = useSaveIes()
  const atual = criando ? null : (lista.data?.ies ?? []).find((i) => i.id === Number(id))
  // ?mantenedora=N vem do botão "IES" na listagem.
  const preSelecionada = typeof window !== 'undefined'
    ? Number(new URLSearchParams(window.location.search).get('mantenedora') || '') || null
    : null

  const [f, setF] = useState({
    mantenedoraId: preSelecionada ? String(preSelecionada) : '', nome: '', sigla: '', codigoEmec: '',
    categoriaAdmin: '', organizacaoAcad: '',
    dirigenteNome: '', dirigenteCpf: '', dirigenteEmail: '',
    piNome: '', piCpf: '', piEmail: '',
  })
  const [pronto, setPronto] = useState(criando)

  useEffect(() => {
    if (criando || pronto || !atual) return
    setF({
      mantenedoraId: String(atual.mantenedoraId), nome: atual.nome ?? '', sigla: atual.sigla ?? '',
      codigoEmec: atual.codigoEmec ?? '', categoriaAdmin: atual.categoriaAdmin ?? '', organizacaoAcad: atual.organizacaoAcad ?? '',
      dirigenteNome: atual.dirigenteNome ?? '', dirigenteCpf: atual.dirigenteCpf ?? '', dirigenteEmail: atual.dirigenteEmail ?? '',
      piNome: atual.piNome ?? '', piCpf: atual.piCpf ?? '', piEmail: atual.piEmail ?? '',
    })
    setPronto(true)
  }, [atual, criando, pronto])

  function submeter() {
    if (!f.nome.trim()) { toast('Informe o nome da IES', 'warning'); return }
    if (!f.mantenedoraId) { toast('Selecione a mantenedora', 'warning'); return }
    save.mutate(
      { ...(criando ? {} : { id: Number(id) }), ...f, mantenedoraId: Number(f.mantenedoraId) } as any,
      {
        onSuccess: () => { toast(criando ? 'IES criada' : 'IES salva', 'success'); onVoltar() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  if (!criando && lista.isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <Page
      title={criando ? 'Nova IES' : 'Editar IES'}
      description="A mantida — é ela que tem código e-MEC e responde pelo Censo e pelo diploma."
      actions={<Voltar onClick={onVoltar} />}
    >
      <Card class="space-y-4 max-w-3xl">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select label="Mantenedora *" value={f.mantenedoraId} onChange={(e) => setF({ ...f, mantenedoraId: (e.target as HTMLSelectElement).value })}>
            <option value="">Selecione…</option>
            {(mantenedoras.data?.mantenedoras ?? []).map((m) => <option key={m.id} value={m.id}>{m.razaoSocial}</option>)}
          </Select>
          <Input label="Código e-MEC" value={f.codigoEmec} onInput={(e) => setF({ ...f, codigoEmec: (e.target as HTMLInputElement).value })} />
          <div class="md:col-span-2">
            <Input label="Nome da IES *" value={f.nome} onInput={(e) => setF({ ...f, nome: (e.target as HTMLInputElement).value })} />
          </div>
          <Input label="Sigla" value={f.sigla} onInput={(e) => setF({ ...f, sigla: (e.target as HTMLInputElement).value })} />
          <Select label="Organização acadêmica" value={f.organizacaoAcad} onChange={(e) => setF({ ...f, organizacaoAcad: (e.target as HTMLSelectElement).value })}>
            <option value="">Selecione…</option>
            {ORGANIZACOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select label="Categoria administrativa" value={f.categoriaAdmin} onChange={(e) => setF({ ...f, categoriaAdmin: (e.target as HTMLSelectElement).value })}>
            <option value="">Selecione…</option>
            {CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">Dirigente</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Nome" value={f.dirigenteNome} onInput={(e) => setF({ ...f, dirigenteNome: (e.target as HTMLInputElement).value })} />
            <Input label="CPF" value={f.dirigenteCpf} onInput={(e) => setF({ ...f, dirigenteCpf: (e.target as HTMLInputElement).value })} />
            <Input label="E-mail" value={f.dirigenteEmail} onInput={(e) => setF({ ...f, dirigenteEmail: (e.target as HTMLInputElement).value })} />
          </div>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">
            Procurador / Recenseador Institucional (PI/RI)
          </div>
          <p class="text-[11px] text-fg-subtle mb-2">Responsável pelo Censo e pelos processos e-MEC.</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Nome" value={f.piNome} onInput={(e) => setF({ ...f, piNome: (e.target as HTMLInputElement).value })} />
            <Input label="CPF" value={f.piCpf} onInput={(e) => setF({ ...f, piCpf: (e.target as HTMLInputElement).value })} />
            <Input label="E-mail" value={f.piEmail} onInput={(e) => setF({ ...f, piEmail: (e.target as HTMLInputElement).value })} />
          </div>
        </div>

        <div class="flex gap-2 pt-1">
          <Button variant="primary" onClick={submeter} disabled={save.isPending}>
            <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button variant="ghost" onClick={onVoltar}>Cancelar</Button>
        </div>
      </Card>
    </Page>
  )
}

// ── Ato autorizativo ──

function FormAto({ escopo, entidadeId, onVoltar }: { escopo: 'IES' | 'CURSO'; entidadeId: number; onVoltar: () => void }) {
  const criar = useCreateAto()
  const [f, setF] = useState({ tipo: 'credenciamento', numero: '', dataPublicacao: '', dataDou: '', validadeAte: '', observacao: '' })

  function submeter() {
    if (!f.tipo) { toast('Selecione o tipo do ato', 'warning'); return }
    criar.mutate(
      {
        escopo, entidadeId, tipo: f.tipo,
        numero: f.numero || null,
        dataPublicacao: f.dataPublicacao || null,
        dataDou: f.dataDou || null,
        validadeAte: f.validadeAte || null,
        observacao: f.observacao || null,
      } as any,
      {
        onSuccess: () => { toast('Ato registrado', 'success'); onVoltar() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Page
      title="Novo ato autorizativo"
      description="Credenciamento, autorização, reconhecimento ou renovação. O vencimento gera alerta em 180, 90 e 30 dias."
      actions={<Voltar onClick={onVoltar} />}
    >
      <Card class="space-y-4 max-w-2xl">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select label="Tipo *" value={f.tipo} onChange={(e) => setF({ ...f, tipo: (e.target as HTMLSelectElement).value })}>
            {TIPOS_ATO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Input label="Número (ex.: Portaria 123)" value={f.numero} onInput={(e) => setF({ ...f, numero: (e.target as HTMLInputElement).value })} />
          <Input type="date" label="Data de publicação" value={f.dataPublicacao} onInput={(e) => setF({ ...f, dataPublicacao: (e.target as HTMLInputElement).value })} />
          <Input type="date" label="Data no DOU" value={f.dataDou} onInput={(e) => setF({ ...f, dataDou: (e.target as HTMLInputElement).value })} />
          <Input type="date" label="Validade até" value={f.validadeAte} onInput={(e) => setF({ ...f, validadeAte: (e.target as HTMLInputElement).value })} />
        </div>
        <Textarea label="Observação" rows={3} value={f.observacao} onInput={(e) => setF({ ...f, observacao: (e.target as HTMLTextAreaElement).value })} />
        <div class="flex gap-2">
          <Button variant="primary" onClick={submeter} disabled={criar.isPending}>
            <Save size={14} /> {criar.isPending ? 'Salvando…' : 'Registrar ato'}
          </Button>
          <Button variant="ghost" onClick={onVoltar}>Cancelar</Button>
        </div>
      </Card>
    </Page>
  )
}
