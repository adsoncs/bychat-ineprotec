import { useState } from 'preact/hooks'
import { FileSignature, ArrowLeft, Plus, Send, RefreshCw, X, FileText, Settings, ExternalLink, Check, Trash2, Download, FileStack, Zap } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { useQuery } from '@tanstack/react-query'
import {
  useEnvelopes, useEnvelope, useAssinaturaConfig, useAssinaturaMut, abrirPdfContrato,
  useTemplates, useTemplateMut, useGatilhos, useGatilhoMut, useVariaveis,
  ENV_STATUS, SIG_STATUS, PAPEL_LABEL, ACAO_LABEL, TIPO_NEGOCIO, EVENTO_LABEL, tipoNegocioLabel,
  type ContratoTemplate, type ContratoGatilho,
} from '@/hooks/useAcaAssinatura'

type Aba = 'contratos' | 'templates' | 'gatilhos'

export function AcademicoAssinaturaPage() {
  const [aba, setAba] = useState<Aba>('contratos')
  const [sel, setSel] = useState<number | null>(null)
  if (sel !== null) return <Detalhe id={sel} onBack={() => setSel(null)} />
  return (
    <Page title="Assinatura de Contratos" description="Templates por negócio, criação (escrever/upload/template), gatilhos e assinatura via Autentique.">
      <div class="flex gap-1 border-b border-border">
        {([['contratos', 'Contratos', FileSignature], ['templates', 'Templates', FileStack], ['gatilhos', 'Gatilhos', Zap]] as [Aba, string, any][]).map(([k, l, Ico]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 flex items-center gap-1 ${aba === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setAba(k)}><Ico size={14} /> {l}</button>
        ))}
      </div>
      {aba === 'contratos' && <Contratos onOpen={setSel} />}
      {aba === 'templates' && <Templates />}
      {aba === 'gatilhos' && <Gatilhos />}
    </Page>
  )
}

// ───────────────────────── Contratos ─────────────────────────
const FILTROS = ['', 'RASCUNHO', 'ENVIADO', 'PARCIAL', 'ASSINADO', 'REJEITADO', 'CANCELADO']
function Contratos({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('')
  const [novo, setNovo] = useState(false)
  const [cfg, setCfg] = useState(false)
  const data = useEnvelopes(status)
  const envs = data.data?.envelopes ?? []
  const config = useAssinaturaConfig()
  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        {config.data && <Badge tone={config.data.modo === 'AUTENTIQUE' ? 'success' : 'warning'}>{config.data.modo === 'AUTENTIQUE' ? 'Autentique' : 'Modo simulado'}</Badge>}
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCfg(true)}><Settings size={14} /> Configurar</Button>
          <Button variant="primary" size="sm" onClick={() => setNovo(true)}><Plus size={14} /> Novo contrato</Button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1">
        {FILTROS.map((s) => <button key={s || 'all'} class={`text-xs px-3 py-1.5 rounded-md border ${status === s ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setStatus(s)}>{s === '' ? 'Todos' : ENV_STATUS[s].label}</button>)}
      </div>
      {data.isLoading ? <Skeleton class="h-14 w-full" /> : envs.length === 0 ? <EmptyState icon={<FileSignature size={28} />} title="Nenhum contrato" description="Crie um contrato para enviar à assinatura." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {envs.map((e) => (
            <div key={e.id} class="px-4 py-3 flex items-center gap-3 text-sm cursor-pointer hover:bg-surface-2" onClick={() => onOpen(e.id)}>
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{e.titulo}</span><span class="block text-xs text-fg-muted">{e.alunoNome ? `${e.alunoNome}${e.ra ? ` · RA ${e.ra}` : ''}` : 'Sem aluno'} · {e.assinados}/{e.totalSignatarios} assinaram</span></span>
              <Badge tone={ENV_STATUS[e.status]?.tone ?? 'neutral'}>{ENV_STATUS[e.status]?.label ?? e.status}</Badge>
            </div>
          ))}
        </Card>
      )}
      {novo && <NovoModal onClose={() => setNovo(false)} onCreated={(id) => { setNovo(false); onOpen(id) }} />}
      {cfg && <ConfigModal onClose={() => setCfg(false)} />}
    </div>
  )
}

function Detalhe({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useEnvelope(id)
  const mut = useAssinaturaMut()
  const e = q.data?.envelope
  if (q.isLoading || !e) return <Page title="Contrato"><Skeleton class="h-64 w-full" /></Page>
  const act = (fn: any, arg: any, msg: string) => fn.mutate(arg, { onSuccess: () => toast(msg, 'success'), onError: (err: any) => toast(err?.message || 'Erro', 'danger') })
  const simulado = e.provider === 'SIMULADO'
  return (
    <Page title={e.titulo} description={`${e.provider === 'AUTENTIQUE' ? 'Autentique' : 'Simulado'}${e.origem ? ` · ${e.origem.toLowerCase()}` : ''}${e.documentoExternoId ? ` · doc ${e.documentoExternoId}` : ''}`}>
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        <div class="flex items-center gap-2 flex-wrap">
          <Badge tone={ENV_STATUS[e.status]?.tone ?? 'neutral'}>{ENV_STATUS[e.status]?.label ?? e.status}</Badge>
          <Button variant="ghost" size="sm" onClick={() => abrirPdfContrato(id).catch(() => toast('PDF indisponível', 'danger'))}><FileText size={14} /> Ver PDF</Button>
          {e.arquivoAssinadoUrl && <a href={e.arquivoAssinadoUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><Download size={14} /> PDF assinado</Button></a>}
          {e.status === 'RASCUNHO' && <Button variant="primary" size="sm" loading={mut.enviar.isPending} onClick={() => act(mut.enviar, id, 'Enviado para assinatura')}><Send size={14} /> Enviar</Button>}
          {(e.status === 'ENVIADO' || e.status === 'PARCIAL') && <Button variant="secondary" size="sm" loading={mut.reenviar.isPending} onClick={() => act(mut.reenviar, id, 'Convites reenviados')}><Send size={14} /> Reenviar</Button>}
          {(e.status === 'ENVIADO' || e.status === 'PARCIAL') && e.provider === 'AUTENTIQUE' && <Button variant="secondary" size="sm" loading={mut.sincronizar.isPending} onClick={() => act(mut.sincronizar, id, 'Status atualizado')}><RefreshCw size={14} /> Sincronizar</Button>}
          {e.status !== 'ASSINADO' && e.status !== 'CANCELADO' && <Button variant="ghost" size="sm" onClick={() => act(mut.cancelar, id, 'Cancelado')}><X size={14} /> Cancelar</Button>}
        </div>
      </div>
      <div class="flex flex-wrap gap-3 text-xs text-fg-muted">
        {e.deadlineEm && <span>Prazo: {new Date(e.deadlineEm).toLocaleDateString('pt-BR')}</span>}
        {e.reminder && <span>Lembrete: {e.reminder === 'DAILY' ? 'diário' : 'semanal'}</span>}
        {e.sortable && <span>Assinatura em ordem</span>}
        {!e.refusable && <span>Não recusável</span>}
      </div>
      <Card class="p-0 overflow-hidden divide-y divide-border">
        <div class="px-4 py-2 text-xs font-semibold text-fg-muted">Signatários</div>
        {e.signatarios.map((s) => (
          <div key={s.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
            <span class="flex-1 min-w-0">
              <span class="block truncate text-fg">{s.nome} <span class="text-xs text-fg-muted">· {PAPEL_LABEL[s.papel] ?? s.papel} · {ACAO_LABEL[(s as any).acao] ?? 'Assinar'}</span></span>
              <span class="block text-xs text-fg-muted">{(s as any).deliveryMethod === 'EMAIL' ? (s.email || 'sem e-mail') : `${(s as any).deliveryMethod}: ${(s as any).telefone || '—'}`}</span>
            </span>
            {s.linkAssinatura && s.status !== 'ASSINADO' && <a href={s.linkAssinatura} target="_blank" rel="noreferrer" class="text-xs text-accent flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>link <ExternalLink size={11} /></a>}
            {simulado && s.status !== 'ASSINADO' && (e.status === 'ENVIADO' || e.status === 'PARCIAL') && <Button variant="ghost" size="sm" onClick={() => act(mut.simular, { id, sid: s.id }, `${s.nome} assinou (simulado)`)}><Check size={13} /> Simular</Button>}
            <Badge tone={SIG_STATUS[s.status]?.tone ?? 'neutral'}>{SIG_STATUS[s.status]?.label ?? s.status}</Badge>
          </div>
        ))}
      </Card>
    </Page>
  )
}

// ───────────────────────── Novo contrato (construtor) ─────────────────────────
type Origem = 'TEMPLATE' | 'ESCRITO' | 'UPLOAD'
function NovoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const mut = useAssinaturaMut()
  const templates = useTemplates()
  const vars = useVariaveis()
  const [origem, setOrigem] = useState<Origem>('TEMPLATE')
  const [q, setQ] = useState('')
  const [aluno, setAluno] = useState<{ id: number; nome: string } | null>(null)
  const [titulo, setTitulo] = useState('Contrato de Prestação de Serviços Educacionais')
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [corpo, setCorpo] = useState('')
  const [arquivo, setArquivo] = useState<{ base64: string; nome: string } | null>(null)
  // opções avançadas
  const [deadlineDias, setDeadlineDias] = useState('')
  const [reminder, setReminder] = useState('')
  const [sortable, setSortable] = useState(false)
  const [refusable, setRefusable] = useState(true)
  const [mensagem, setMensagem] = useState('')

  const busca = useQuery({ queryKey: ['aca-aluno-busca', q], enabled: q.trim().length >= 2, queryFn: () => api.get<{ alunos: Array<{ id: number; ra: string | null; lead: { nome: string } }> }>(`/admin/aca/alunos?q=${encodeURIComponent(q)}`) })

  const onFile = (e: any) => {
    const f = e.currentTarget.files?.[0]; if (!f) return
    if (f.type !== 'application/pdf') { toast('Envie um PDF', 'danger'); return }
    const reader = new FileReader()
    reader.onload = () => setArquivo({ base64: String(reader.result).split(',')[1] || '', nome: f.name })
    reader.readAsDataURL(f)
  }
  const podeCriar = !!titulo && (origem === 'TEMPLATE' ? !!templateId : origem === 'UPLOAD' ? !!arquivo : !!corpo)
  const opcoes = () => ({ deadlineEm: deadlineDias ? new Date(Date.now() + Number(deadlineDias) * 864e5).toISOString() : null, reminder: reminder || null, sortable, refusable, mensagem: mensagem || null })

  const criar = () => {
    const okFn = (r: any) => { toast('Contrato criado', 'success'); onCreated(r.envelope.id) }
    const errFn = (e: any) => toast(e?.message || 'Erro', 'danger')
    if (origem === 'TEMPLATE') {
      mut.criarDeTemplate.mutate({ templateId: Number(templateId), alunoId: aluno?.id, titulo: titulo || undefined }, { onSuccess: okFn, onError: errFn })
    } else {
      mut.criar.mutate({ titulo, origem, alunoId: aluno?.id, corpoTexto: origem === 'ESCRITO' ? corpo : undefined, arquivoBase64: origem === 'UPLOAD' ? arquivo?.base64 : undefined, arquivoNome: arquivo?.nome, ...opcoes() }, { onSuccess: okFn, onError: errFn })
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Novo contrato" description="A partir de um template, escrevendo do zero ou enviando um PDF." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.criar.isPending || mut.criarDeTemplate.isPending} disabled={!podeCriar} onClick={criar}>Criar contrato</Button></>}>
      <div class="space-y-3">
        <div class="flex gap-1">
          {([['TEMPLATE', 'A partir de template'], ['ESCRITO', 'Escrever'], ['UPLOAD', 'Upload de PDF']] as [Origem, string][]).map(([k, l]) => (
            <button key={k} class={`text-xs px-3 py-1.5 rounded-md border ${origem === k ? 'bg-accent/10 border-accent text-accent' : 'border-border text-fg-muted hover:bg-surface-2'}`} onClick={() => setOrigem(k)}>{l}</button>
          ))}
        </div>

        <Input label="Título do contrato" value={titulo} onInput={(e: any) => setTitulo(e.currentTarget.value)} />

        {/* aluno */}
        {aluno ? (
          <div class="flex items-center gap-2 text-sm bg-surface-2 rounded-md px-3 py-2"><span class="flex-1 text-fg">Aluno: <b>{aluno.nome}</b></span><button class="text-xs text-accent" onClick={() => setAluno(null)}>trocar</button></div>
        ) : (
          <div class="space-y-1">
            <Input label="Aluno (preenche as variáveis e os signatários)" value={q} onInput={(e: any) => setQ(e.currentTarget.value)} placeholder="Buscar por nome, RA, CPF…" />
            {(busca.data?.alunos?.length ?? 0) > 0 && (
              <Card class="p-0 overflow-hidden divide-y divide-border max-h-40 overflow-y-auto">
                {busca.data!.alunos.map((a) => <button key={a.id} class="w-full text-left px-3 py-2 text-sm hover:bg-surface-2" onClick={() => setAluno({ id: a.id, nome: a.lead.nome })}>{a.lead.nome}{a.ra && <span class="text-xs text-fg-muted"> · RA {a.ra}</span>}</button>)}
              </Card>
            )}
          </div>
        )}

        {origem === 'TEMPLATE' && (
          <Select label="Template" value={String(templateId)} onChange={(e: any) => setTemplateId(e.currentTarget.value ? Number(e.currentTarget.value) : '')}>
            <option value="">Selecione…</option>
            {(templates.data?.templates ?? []).filter((t) => t.ativo).map((t) => <option key={t.id} value={t.id}>{t.nome} ({tipoNegocioLabel(t.tipoNegocio)})</option>)}
          </Select>
        )}

        {origem === 'ESCRITO' && (
          <div class="space-y-1">
            <Textarea label="Texto do contrato" rows={9} value={corpo} onInput={(e: any) => setCorpo(e.currentTarget.value)} placeholder="Escreva o contrato. Use variáveis como {{aluno.nome}}." />
            <div class="flex flex-wrap gap-1">
              {(vars.data?.variaveis ?? []).map((v) => <button key={v.chave} title={v.desc} class="text-[0.7rem] px-2 py-0.5 rounded bg-surface-2 border border-border text-fg-muted hover:text-fg" onClick={() => setCorpo((c) => `${c}{{${v.chave}}}`)}>{`{{${v.chave}}}`}</button>)}
            </div>
          </div>
        )}

        {origem === 'UPLOAD' && (
          <div class="space-y-1">
            <label class="text-xs font-medium text-fg-muted">Arquivo PDF</label>
            <input type="file" accept="application/pdf" onChange={onFile} class="block text-sm text-fg-muted" />
            {arquivo && <p class="text-xs text-success">✓ {arquivo.nome}</p>}
          </div>
        )}

        {/* opções avançadas (não aplicáveis no template, que traz as suas) */}
        {origem !== 'TEMPLATE' && (
          <details class="rounded-md border border-border px-3 py-2">
            <summary class="text-xs font-medium text-fg-muted cursor-pointer">Opções de assinatura</summary>
            <div class="grid sm:grid-cols-2 gap-2 mt-2">
              <Input label="Prazo (dias)" type="number" value={deadlineDias} onInput={(e: any) => setDeadlineDias(e.currentTarget.value)} />
              <Select label="Lembrete" value={reminder} onChange={(e: any) => setReminder(e.currentTarget.value)}><option value="">Sem lembrete</option><option value="DAILY">Diário</option><option value="WEEKLY">Semanal</option></Select>
              <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={sortable} onChange={(e: any) => setSortable(e.currentTarget.checked)} /> Assinatura em ordem</label>
              <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={refusable} onChange={(e: any) => setRefusable(e.currentTarget.checked)} /> Permitir recusar</label>
              <Input class="sm:col-span-2" label="Mensagem do convite" value={mensagem} onInput={(e: any) => setMensagem(e.currentTarget.value)} />
            </div>
          </details>
        )}
        <p class="text-xs text-fg-muted">Os signatários (aluno + responsável) são incluídos automaticamente a partir do aluno. Você poderá acompanhar e reenviar na tela do contrato.</p>
      </div>
    </Modal>
  )
}

// ───────────────────────── Templates ─────────────────────────
function Templates() {
  const q = useTemplates()
  const [edit, setEdit] = useState<ContratoTemplate | 'novo' | null>(null)
  const ts = q.data?.templates ?? []
  return (
    <div class="space-y-3">
      <div class="flex justify-end"><Button variant="primary" size="sm" onClick={() => setEdit('novo')}><Plus size={14} /> Novo template</Button></div>
      {q.isLoading ? <Skeleton class="h-14 w-full" /> : ts.length === 0 ? <EmptyState icon={<FileStack size={28} />} title="Nenhum template" description="Crie modelos de contrato por tipo de negócio." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {ts.map((t) => (
            <div key={t.id} class="px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-surface-2" onClick={() => setEdit(t)}>
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{t.nome}</span><span class="block text-xs text-fg-muted">{t.descricao || '—'}</span></span>
              <Badge tone="info">{tipoNegocioLabel(t.tipoNegocio)}</Badge>
              {!t.ativo && <Badge tone="neutral">inativo</Badge>}
            </div>
          ))}
        </Card>
      )}
      {edit && <TemplateModal template={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function TemplateModal({ template, onClose }: { template: ContratoTemplate | null; onClose: () => void }) {
  const mut = useTemplateMut()
  const vars = useVariaveis()
  const c = (template?.config as any) || {}
  const [f, setF] = useState<any>({
    nome: template?.nome || '', tipoNegocio: template?.tipoNegocio || 'GRADUACAO', descricao: template?.descricao || '',
    corpoTexto: template?.corpoTexto || '', ativo: template?.ativo ?? true,
    deadlineDias: c.deadlineDias ?? '', reminder: c.reminder || '', sortable: !!c.sortable, refusable: c.refusable !== false, mensagem: c.mensagem || '',
  })
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const salvar = () => {
    const body: any = { nome: f.nome, tipoNegocio: f.tipoNegocio, descricao: f.descricao, corpoTexto: f.corpoTexto, ativo: f.ativo,
      config: { deadlineDias: f.deadlineDias ? Number(f.deadlineDias) : null, reminder: f.reminder || null, sortable: f.sortable, refusable: f.refusable, mensagem: f.mensagem || null },
      signatariosPadrao: template?.signatariosPadrao || [{ papel: 'ALUNO', acao: 'SIGN', deliveryMethod: 'EMAIL' }, { papel: 'RESPONSAVEL', acao: 'SIGN', deliveryMethod: 'EMAIL' }] }
    const opts = { onSuccess: () => { toast('Template salvo', 'success'); onClose() }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') }
    if (template) mut.atualizar.mutate({ id: template.id, ...body }, opts); else mut.criar.mutate(body, opts)
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={template ? 'Editar template' : 'Novo template'} size="lg"
      footer={<><div class="flex-1">{template && <Button variant="ghost" onClick={() => mut.excluir.mutate(template.id, { onSuccess: () => { toast('Excluído', 'success'); onClose() } })}><Trash2 size={14} /> Excluir</Button>}</div><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.criar.isPending || mut.atualizar.isPending} disabled={!f.nome || !f.corpoTexto} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <div class="grid sm:grid-cols-2 gap-3">
          <Input label="Nome" value={f.nome} onInput={(e: any) => set('nome', e.currentTarget.value)} />
          <Select label="Tipo de negócio" value={f.tipoNegocio} onChange={(e: any) => set('tipoNegocio', e.currentTarget.value)}>{TIPO_NEGOCIO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
        </div>
        <Input label="Descrição" value={f.descricao} onInput={(e: any) => set('descricao', e.currentTarget.value)} />
        <div class="space-y-1">
          <Textarea label="Corpo do contrato (use variáveis {{...}})" rows={9} value={f.corpoTexto} onInput={(e: any) => set('corpoTexto', e.currentTarget.value)} />
          <div class="flex flex-wrap gap-1">{(vars.data?.variaveis ?? []).map((v) => <button key={v.chave} title={v.desc} class="text-[0.7rem] px-2 py-0.5 rounded bg-surface-2 border border-border text-fg-muted hover:text-fg" onClick={() => set('corpoTexto', `${f.corpoTexto}{{${v.chave}}}`)}>{`{{${v.chave}}}`}</button>)}</div>
        </div>
        <div class="grid sm:grid-cols-2 gap-2">
          <Input label="Prazo padrão (dias)" type="number" value={f.deadlineDias} onInput={(e: any) => set('deadlineDias', e.currentTarget.value)} />
          <Select label="Lembrete" value={f.reminder} onChange={(e: any) => set('reminder', e.currentTarget.value)}><option value="">Sem lembrete</option><option value="DAILY">Diário</option><option value="WEEKLY">Semanal</option></Select>
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.sortable} onChange={(e: any) => set('sortable', e.currentTarget.checked)} /> Assinatura em ordem</label>
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.refusable} onChange={(e: any) => set('refusable', e.currentTarget.checked)} /> Permitir recusar</label>
          <Input class="sm:col-span-2" label="Mensagem do convite" value={f.mensagem} onInput={(e: any) => set('mensagem', e.currentTarget.value)} />
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Ativo</label>
        </div>
      </div>
    </Modal>
  )
}

// ───────────────────────── Gatilhos ─────────────────────────
function Gatilhos() {
  const q = useGatilhos()
  const [edit, setEdit] = useState<ContratoGatilho | 'novo' | null>(null)
  const gs = q.data?.gatilhos ?? []
  return (
    <div class="space-y-3">
      <div class="flex justify-end"><Button variant="primary" size="sm" onClick={() => setEdit('novo')}><Plus size={14} /> Novo gatilho</Button></div>
      {q.isLoading ? <Skeleton class="h-14 w-full" /> : gs.length === 0 ? <EmptyState icon={<Zap size={28} />} title="Nenhum gatilho" description="Dispare contratos automaticamente quando um evento ocorrer." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {gs.map((g) => (
            <div key={g.id} class="px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-surface-2" onClick={() => setEdit(g)}>
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{g.nome}</span><span class="block text-xs text-fg-muted">{EVENTO_LABEL[g.evento] ?? g.evento} → {g.autoPorTipo ? 'template do tipo do curso' : (g.templateNome || `template #${g.templateId}`)}{g.autoEnviar ? ' · envia automático' : ' · cria rascunho'}</span></span>
              {!g.ativo && <Badge tone="neutral">inativo</Badge>}
              <Badge tone={g.ativo ? 'success' : 'neutral'}>{g.ativo ? 'ativo' : 'off'}</Badge>
            </div>
          ))}
        </Card>
      )}
      {edit && <GatilhoModal gatilho={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function GatilhoModal({ gatilho, onClose }: { gatilho: ContratoGatilho | null; onClose: () => void }) {
  const mut = useGatilhoMut()
  const templates = useTemplates()
  const [f, setF] = useState<any>({ nome: gatilho?.nome || '', evento: gatilho?.evento || 'MATRICULA_CRIADA', autoPorTipo: gatilho?.autoPorTipo ?? true, templateId: gatilho?.templateId || '', filtroTipoNegocio: gatilho?.filtroTipoNegocio || '', autoEnviar: gatilho?.autoEnviar ?? false, ativo: gatilho?.ativo ?? true })
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const salvar = () => {
    const body = { ...f, templateId: f.autoPorTipo ? null : (f.templateId ? Number(f.templateId) : null), filtroTipoNegocio: f.filtroTipoNegocio || null }
    const opts = { onSuccess: () => { toast('Gatilho salvo', 'success'); onClose() }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') }
    if (gatilho) mut.atualizar.mutate({ id: gatilho.id, ...body }, opts); else mut.criar.mutate(body, opts)
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={gatilho ? 'Editar gatilho' : 'Novo gatilho'}
      footer={<><div class="flex-1">{gatilho && <Button variant="ghost" onClick={() => mut.excluir.mutate(gatilho.id, { onSuccess: () => { toast('Excluído', 'success'); onClose() } })}><Trash2 size={14} /> Excluir</Button>}</div><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.criar.isPending || mut.atualizar.isPending} disabled={!f.nome || (!f.autoPorTipo && !f.templateId)} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <Input label="Nome" value={f.nome} onInput={(e: any) => set('nome', e.currentTarget.value)} />
        <Select label="Evento (quando disparar)" value={f.evento} onChange={(e: any) => set('evento', e.currentTarget.value)}>{Object.entries(EVENTO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.autoPorTipo} onChange={(e: any) => set('autoPorTipo', e.currentTarget.checked)} /> Escolher o template pelo <b>tipo do curso</b> automaticamente</label>
        {!f.autoPorTipo && <Select label="Template do contrato" value={String(f.templateId)} onChange={(e: any) => set('templateId', e.currentTarget.value)}><option value="">Selecione…</option>{(templates.data?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>}
        <Select label="Filtrar por tipo de negócio (opcional)" value={f.filtroTipoNegocio} onChange={(e: any) => set('filtroTipoNegocio', e.currentTarget.value)}><option value="">Qualquer</option>{TIPO_NEGOCIO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.autoEnviar} onChange={(e: any) => set('autoEnviar', e.currentTarget.checked)} /> Enviar automaticamente (senão cria rascunho)</label>
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Ativo</label>
      </div>
    </Modal>
  )
}

// ───────────────────────── Config ─────────────────────────
function ConfigModal({ onClose }: { onClose: () => void }) {
  const q = useAssinaturaConfig()
  const mut = useAssinaturaMut()
  const c = q.data
  const [modo, setModo] = useState<string>('')
  const [token, setToken] = useState('')
  const [sandbox, setSandbox] = useState<boolean | null>(null)
  if (!c) return null
  const modoVal = modo || c.modo
  const sandboxVal = sandbox === null ? c.sandbox : sandbox
  const onToken = (v: string) => { setToken(v); if (v.trim() && modoVal !== 'AUTENTIQUE') setModo('AUTENTIQUE') }
  const salvar = () => {
    const body: any = { modo: modoVal, sandbox: sandboxVal }
    if (token.trim()) body.token = token.trim()
    mut.setConfig.mutate(body, { onSuccess: () => { toast('Configuração salva', 'success'); onClose() }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') })
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Configurar assinatura" description="Autentique (real) ou simulado para testes."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.setConfig.isPending} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <div class="text-xs text-fg-muted">Status: modo <b>{c.modo === 'AUTENTIQUE' ? 'Autentique' : 'Simulado'}</b> · token {c.tokenConfigurado ? '✓ configurado' : '— não configurado'}</div>
        <Select label="Modo" value={modoVal} onChange={(e: any) => setModo(e.currentTarget.value)}><option value="SIMULADO">Simulado (sem credencial)</option><option value="AUTENTIQUE">Autentique (assinatura real)</option></Select>
        <Input label="Token da API Autentique" type="text" autocomplete="off" spellcheck={false} class="font-mono text-xs" value={token} onInput={(e: any) => onToken(e.currentTarget.value)} placeholder={c.tokenConfigurado ? 'configurado — cole um novo para substituir' : 'cole o token da Autentique'} />
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={sandboxVal} onChange={(e: any) => setSandbox(e.currentTarget.checked)} /> Sandbox (não consome documentos)</label>
        <p class="text-xs text-fg-muted">O token é gerado no painel da Autentique (Configurações › Integrações › API). Webhook: aponte para <code>/api/webhooks/autentique</code>.</p>
      </div>
    </Modal>
  )
}
