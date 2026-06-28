import { useEffect, useState } from 'preact/hooks'
import { Inbox, CheckCircle2, XCircle, FileText, Clock, Settings, Send, DollarSign, Plus } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import {
  useRequerimentos, useRequerimento, useRequerimentoMut, useTramitarMut,
  useReqTipos, useReqTipoMut, useReqCategorias, useReqCategoriaMut,
  REQ_STATUS_LABEL, reqTone, type Requerimento, type ReqTipo,
} from '@/hooks/useAcaRequerimento'
import { abrirDocumentoPdf } from '@/hooks/useAcaSecretaria'

const FILTROS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'Todos' }, { key: 'ABERTO', label: 'Abertos' }, { key: 'EM_ANALISE', label: 'Em análise' },
  { key: 'DEFERIDO', label: 'Deferidos' }, { key: 'INDEFERIDO', label: 'Indeferidos' }, { key: 'CONCLUIDO', label: 'Concluídos' },
]

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function AcademicoRequerimentosPage() {
  const [status, setStatus] = useState<string | null>('ABERTO')
  const [aberto, setAberto] = useState<number | null>(null)
  const [config, setConfig] = useState(false)
  const data = useRequerimentos(status)
  const itens = data.data?.itens ?? []
  const counts = data.data?.counts ?? {}

  return (
    <Page title="Requerimentos" description="Secretaria virtual — solicitações dos alunos com protocolo, prazo, custo e trâmites.">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex gap-1 border-b border-border flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.label} class={`text-sm px-3 py-2 -mb-px border-b-2 ${status === f.key ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setStatus(f.key)}>
              {f.label}{f.key && counts[f.key] ? <span class="ml-1 text-xs text-fg-subtle">({counts[f.key]})</span> : ''}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setConfig(true)}><Settings size={14} /> Tipos & categorias</Button>
      </div>

      <Card class="mt-3 p-0 overflow-hidden">
        {data.isLoading ? <Skeleton class="h-40 w-full" /> : itens.length === 0 ? <p class="text-sm text-fg-muted p-6 text-center"><Inbox size={18} class="inline mr-1" /> Nenhuma solicitação.</p> : (
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Protocolo</th><th class="text-left p-2">Aluno</th><th class="text-left p-2">Tipo / assunto</th><th class="text-left p-2">Prazo</th><th class="text-center p-2">Situação</th></tr></thead>
            <tbody class="divide-y divide-border">
              {itens.map((r) => <LinhaReq key={r.id} r={r} onOpen={() => setAberto(r.id)} />)}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={aberto !== null} onOpenChange={(o) => !o && setAberto(null)} title="Requerimento" size="lg">
        {aberto !== null && <ReqDetalhe id={aberto} onClose={() => setAberto(null)} />}
      </Modal>

      <Modal open={config} onOpenChange={setConfig} title="Tipos & categorias de requerimento" size="lg">
        <ConfigTipos />
      </Modal>
    </Page>
  )
}

function prazoBadge(r: Requerimento) {
  if (!r.prazoEm || ['DEFERIDO', 'INDEFERIDO', 'CONCLUIDO', 'CANCELADO'].includes(r.status)) return null
  const dias = Math.ceil((new Date(r.prazoEm).getTime() - Date.now()) / 86400_000)
  return <span class={`text-xs ${dias < 0 ? 'text-danger' : dias <= 1 ? 'text-warning' : 'text-fg-muted'}`}><Clock size={11} class="inline" /> {dias < 0 ? `${-dias}d atrasado` : `${dias}d`}</span>
}

function LinhaReq({ r, onOpen }: { r: Requerimento; onOpen: () => void }) {
  return (
    <tr class="hover:bg-surface-2 cursor-pointer" onClick={onOpen}>
      <td class="p-2"><code class="text-xs">{r.protocolo}</code></td>
      <td class="p-2">{r.alunoNome}<span class="block text-[11px] text-fg-subtle">RA {r.ra || '—'}</span></td>
      <td class="p-2"><span class="text-fg">{r.tipoNome}</span><span class="block text-xs text-fg-muted truncate max-w-[16rem]">{r.assunto}</span></td>
      <td class="p-2">{prazoBadge(r)}</td>
      <td class="p-2 text-center"><Badge tone={reqTone(r.status)}>{REQ_STATUS_LABEL[r.status] ?? r.status}</Badge></td>
    </tr>
  )
}

function ReqDetalhe({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useRequerimento(id)
  const mut = useRequerimentoMut()
  const tramitar = useTramitarMut()
  const [resposta, setResposta] = useState('')
  const [comentario, setComentario] = useState('')
  const r = q.data?.requerimento
  const tipo = q.data?.tipo
  const tramites = q.data?.tramites ?? []
  useEffect(() => { if (r) setResposta(r.resposta ?? '') }, [r?.id])
  if (q.isLoading || !r) return <Skeleton class="h-48 w-full" />
  const fechado = ['DEFERIDO', 'INDEFERIDO', 'CONCLUIDO', 'CANCELADO'].includes(r.status)

  const acao = (status: string) => mut.mutate({ id, status, resposta }, { onSuccess: () => { if (status !== 'EM_ANALISE') onClose() } })
  return (
    <div class="space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <code class="text-xs">{r.protocolo}</code>
        <Badge tone={reqTone(r.status)}>{REQ_STATUS_LABEL[r.status] ?? r.status}</Badge>
        {prazoBadge(r)}
        {tipo && tipo.custoCentavos > 0 && <Badge tone="warning"><DollarSign size={11} class="inline" /> taxa {brl(tipo.custoCentavos)}</Badge>}
        {r.custoParcelaId && <Badge tone="success">taxa gerada</Badge>}
      </div>
      <div class="text-sm"><b>{r.alunoNome}</b> · RA {r.ra || '—'} {r.email && <span class="text-fg-muted">· {r.email}</span>}</div>
      <Card class="space-y-1">
        <div class="text-xs text-fg-muted uppercase">{r.tipoNome}</div>
        <div class="font-medium text-fg">{r.assunto}</div>
        {r.descricao && <p class="text-sm text-fg-muted whitespace-pre-wrap">{r.descricao}</p>}
      </Card>
      {r.documentoId && <Button variant="secondary" size="sm" onClick={() => abrirDocumentoPdf(r.documentoId!).catch(() => {})}><FileText size={14} /> Abrir documento gerado</Button>}

      {/* Trâmites */}
      <div class="space-y-1.5">
        <div class="text-xs font-medium text-fg-muted">Trâmites</div>
        {tramites.length === 0 ? <p class="text-xs text-fg-subtle">Sem trâmites registrados.</p> : (
          <ol class="space-y-1.5">
            {tramites.map((t) => (
              <li key={t.id} class="text-xs flex gap-2">
                <span class="text-fg-subtle shrink-0">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                <span class="text-fg-muted">
                  {t.deNome ? <b>{t.deNome}</b> : 'Sistema'}{t.estado ? ` · ${REQ_STATUS_LABEL[t.estado] ?? t.estado}` : ''}{t.comentario ? `: ${t.comentario}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
        {!fechado && (
          <div class="flex gap-2 items-end">
            <Input class="flex-1" placeholder="Comentário / encaminhamento interno" value={comentario} onInput={(e: any) => setComentario(e.currentTarget.value)} />
            <Button size="sm" variant="ghost" disabled={tramitar.isPending || !comentario.trim()} onClick={() => tramitar.mutate({ id, comentario }, { onSuccess: () => setComentario('') })}><Send size={14} /> Registrar</Button>
          </div>
        )}
      </div>

      <div>
        <label class="block text-xs font-medium text-fg-muted mb-1">Resposta ao aluno</label>
        <Textarea rows={3} value={resposta} onInput={(e) => setResposta((e.target as HTMLTextAreaElement).value)} placeholder="Mensagem que o aluno verá no portal…" disabled={fechado} />
      </div>
      {!fechado && (
        <div class="flex justify-end gap-2 flex-wrap">
          {r.status === 'ABERTO' && <Button variant="ghost" size="sm" disabled={mut.isPending} onClick={() => acao('EM_ANALISE')}>Marcar em análise</Button>}
          <Button variant="ghost" size="sm" disabled={mut.isPending} onClick={() => acao('INDEFERIDO')}><XCircle size={14} /> Indeferir</Button>
          <Button variant="primary" size="sm" disabled={mut.isPending} onClick={() => acao('DEFERIDO')}><CheckCircle2 size={14} /> Deferir{tipo && tipo.custoCentavos > 0 ? ` (gera taxa ${brl(tipo.custoCentavos)})` : ''}</Button>
        </div>
      )}
      {fechado && r.status !== 'CONCLUIDO' && <div class="flex justify-end"><Button variant="secondary" size="sm" disabled={mut.isPending} onClick={() => acao('CONCLUIDO')}>Concluir</Button></div>}
    </div>
  )
}

function ConfigTipos() {
  const cats = useReqCategorias()
  const tipos = useReqTipos()
  const catMut = useReqCategoriaMut()
  const [novaCat, setNovaCat] = useState('')
  const [editTipo, setEditTipo] = useState<ReqTipo | null>(null)
  const [criando, setCriando] = useState(false)
  const categorias = cats.data?.categorias ?? []
  const catNome = (id: number | null) => categorias.find((c) => c.id === id)?.nome ?? '—'

  return (
    <div class="space-y-4">
      {/* Categorias */}
      <div class="space-y-2">
        <div class="text-sm font-semibold text-fg">Categorias</div>
        <div class="flex flex-wrap gap-1">
          {categorias.map((c) => <Badge key={c.id} tone={c.ativo ? 'neutral' : 'danger'}>{c.nome}</Badge>)}
          {categorias.length === 0 && <span class="text-xs text-fg-subtle">Nenhuma categoria.</span>}
        </div>
        <div class="flex gap-2">
          <Input class="flex-1" placeholder="Nova categoria" value={novaCat} onInput={(e: any) => setNovaCat(e.currentTarget.value)} />
          <Button size="sm" variant="secondary" disabled={catMut.criar.isPending || !novaCat.trim()} onClick={() => catMut.criar.mutate({ nome: novaCat }, { onSuccess: () => setNovaCat('') })}><Plus size={14} /> Adicionar</Button>
        </div>
      </div>

      {/* Tipos */}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-fg">Tipos de requerimento</div>
          <Button size="sm" variant="ghost" onClick={() => { setEditTipo(null); setCriando(true) }}><Plus size={14} /> Novo tipo</Button>
        </div>
        {tipos.isLoading ? <Skeleton class="h-24 w-full" /> : (
          <div class="divide-y divide-border border border-border rounded-md">
            {(tipos.data?.tipos ?? []).map((t) => (
              <button key={t.id} class="w-full text-left px-3 py-2 hover:bg-surface-2 flex items-center gap-2" onClick={() => { setEditTipo(t); setCriando(true) }}>
                <span class="flex-1 min-w-0">
                  <span class="text-sm text-fg">{t.nome}{!t.ativo && <span class="text-xs text-danger ml-1">(inativo)</span>}</span>
                  <span class="block text-xs text-fg-muted">{catNome(t.categoriaId)} · SLA {t.slaDias}d{t.geraDocumento ? ` · gera ${t.geraDocumento}` : ''}{t.deferimentoAutomatico ? ' · auto' : ''}</span>
                </span>
                {t.custoCentavos > 0 && <Badge tone="warning">{brl(t.custoCentavos)}</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>

      {criando && <TipoForm tipo={editTipo} categorias={categorias} onClose={() => setCriando(false)} />}
    </div>
  )
}

function TipoForm({ tipo, categorias, onClose }: { tipo: ReqTipo | null; categorias: Array<{ id: number; nome: string }>; onClose: () => void }) {
  const mut = useReqTipoMut()
  const [nome, setNome] = useState(tipo?.nome ?? '')
  const [categoriaId, setCategoriaId] = useState(tipo?.categoriaId ?? '')
  const [slaDias, setSlaDias] = useState(String(tipo?.slaDias ?? 5))
  const [custoReais, setCustoReais] = useState(tipo ? (tipo.custoCentavos / 100).toString() : '0')
  const [geraDocumento, setGeraDocumento] = useState(tipo?.geraDocumento ?? '')
  const [auto, setAuto] = useState(tipo?.deferimentoAutomatico ?? false)
  const [ativo, setAtivo] = useState(tipo?.ativo ?? true)

  const save = () => {
    const body: any = {
      nome, categoriaId: categoriaId ? Number(categoriaId) : null, slaDias: Number(slaDias) || 5,
      custoCentavos: Math.round(parseFloat(custoReais.replace(',', '.') || '0') * 100),
      geraDocumento: geraDocumento || null, deferimentoAutomatico: auto, ativo,
    }
    const m = tipo ? mut.atualizar : mut.criar
    m.mutate(tipo ? { id: tipo.id, ...body } : body, { onSuccess: onClose })
  }
  const pending = mut.criar.isPending || mut.atualizar.isPending

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={tipo ? 'Editar tipo' : 'Novo tipo'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={pending} disabled={!nome.trim()} onClick={save}>Salvar</Button></>}>
      <div class="space-y-3">
        <Input label="Nome" value={nome} onInput={(e: any) => setNome(e.currentTarget.value)} />
        <div class="grid grid-cols-2 gap-3">
          <Select label="Categoria" value={categoriaId} onChange={(e: any) => setCategoriaId(e.currentTarget.value)}>
            <option value="">— Sem categoria —</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Input label="SLA (dias)" type="number" value={slaDias} onInput={(e: any) => setSlaDias(e.currentTarget.value)} />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <Input label="Custo (R$)" type="number" step="0.01" value={custoReais} onInput={(e: any) => setCustoReais(e.currentTarget.value)} hint="Gera parcela (taxa) ao deferir" />
          <Input label="Gera documento (tipo)" value={geraDocumento} onInput={(e: any) => setGeraDocumento(e.currentTarget.value)} placeholder="ex.: DECLARACAO_MATRICULA" />
        </div>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={auto} onChange={(e: any) => setAuto(e.currentTarget.checked)} /> Deferimento automático na criação</label>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={ativo} onChange={(e: any) => setAtivo(e.currentTarget.checked)} /> Ativo</label>
      </div>
    </Modal>
  )
}
