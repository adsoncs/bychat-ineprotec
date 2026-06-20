import { useState } from 'preact/hooks'
import { FileSignature, ArrowLeft, Plus, Send, RefreshCw, X, FileText, Settings, ExternalLink, Check } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { useQuery } from '@tanstack/react-query'
import {
  useEnvelopes, useEnvelope, useAssinaturaConfig, useAssinaturaMut, abrirPdfContrato,
  ENV_STATUS, SIG_STATUS, PAPEL_LABEL,
} from '@/hooks/useAcaAssinatura'

const FILTROS = ['', 'RASCUNHO', 'ENVIADO', 'PARCIAL', 'ASSINADO', 'REJEITADO', 'CANCELADO']

export function AcademicoAssinaturaPage() {
  const [sel, setSel] = useState<number | null>(null)
  if (sel !== null) return <Detalhe id={sel} onBack={() => setSel(null)} />
  return <Lista onOpen={setSel} />
}

function Lista({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('')
  const [novo, setNovo] = useState(false)
  const [cfg, setCfg] = useState(false)
  const data = useEnvelopes(status)
  const envs = data.data?.envelopes ?? []
  const config = useAssinaturaConfig()

  return (
    <Page title="Assinatura de Contratos" description="Assinatura eletrônica de contratos do aluno via Autentique.">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          {config.data && <Badge tone={config.data.modo === 'AUTENTIQUE' ? 'success' : 'warning'}>{config.data.modo === 'AUTENTIQUE' ? 'Autentique' : 'Modo simulado'}</Badge>}
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCfg(true)}><Settings size={14} /> Configurar</Button>
          <Button variant="primary" size="sm" onClick={() => setNovo(true)}><Plus size={14} /> Novo contrato</Button>
        </div>
      </div>

      <div class="flex flex-wrap gap-1">
        {FILTROS.map((s) => (
          <button key={s || 'all'} class={`text-xs px-3 py-1.5 rounded-md border ${status === s ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setStatus(s)}>
            {s === '' ? 'Todos' : ENV_STATUS[s].label}
          </button>
        ))}
      </div>

      {data.isLoading ? <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-14 w-full" />)}</div> :
        envs.length === 0 ? <EmptyState icon={<FileSignature size={28} />} title="Nenhum contrato" description="Crie um contrato para enviar à assinatura." /> : (
          <Card class="p-0 overflow-hidden divide-y divide-border">
            {envs.map((e) => (
              <div key={e.id} class="px-4 py-3 flex items-center gap-3 text-sm cursor-pointer hover:bg-surface-2" onClick={() => onOpen(e.id)}>
                <span class="flex-1 min-w-0">
                  <span class="block truncate text-fg">{e.titulo}</span>
                  <span class="block text-xs text-fg-muted">{e.alunoNome ? `${e.alunoNome}${e.ra ? ` · RA ${e.ra}` : ''}` : 'Sem aluno'} · {e.assinados}/{e.totalSignatarios} assinaram</span>
                </span>
                <Badge tone={ENV_STATUS[e.status]?.tone ?? 'neutral'}>{ENV_STATUS[e.status]?.label ?? e.status}</Badge>
              </div>
            ))}
          </Card>
        )}

      {novo && <NovoModal onClose={() => setNovo(false)} onCreated={(id) => { setNovo(false); onOpen(id) }} />}
      {cfg && <ConfigModal onClose={() => setCfg(false)} />}
    </Page>
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
    <Page title={e.titulo} description={`${e.provider === 'AUTENTIQUE' ? 'Autentique' : 'Simulado'}${e.documentoExternoId ? ` · doc ${e.documentoExternoId}` : ''}`}>
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        <div class="flex items-center gap-2 flex-wrap">
          <Badge tone={ENV_STATUS[e.status]?.tone ?? 'neutral'}>{ENV_STATUS[e.status]?.label ?? e.status}</Badge>
          <Button variant="ghost" size="sm" onClick={() => abrirPdfContrato(id).catch(() => toast('PDF indisponível', 'danger'))}><FileText size={14} /> Ver PDF</Button>
          {e.status === 'RASCUNHO' && <Button variant="primary" size="sm" loading={mut.enviar.isPending} onClick={() => act(mut.enviar, id, 'Enviado para assinatura')}><Send size={14} /> Enviar para assinatura</Button>}
          {(e.status === 'ENVIADO' || e.status === 'PARCIAL') && e.provider === 'AUTENTIQUE' && <Button variant="secondary" size="sm" loading={mut.sincronizar.isPending} onClick={() => act(mut.sincronizar, id, 'Status atualizado')}><RefreshCw size={14} /> Sincronizar</Button>}
          {e.status !== 'ASSINADO' && e.status !== 'CANCELADO' && <Button variant="ghost" size="sm" onClick={() => act(mut.cancelar, id, 'Cancelado')}><X size={14} /> Cancelar</Button>}
        </div>
      </div>

      <Card class="p-0 overflow-hidden divide-y divide-border">
        <div class="px-4 py-2 text-xs font-semibold text-fg-muted">Signatários</div>
        {e.signatarios.map((s) => (
          <div key={s.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
            <span class="flex-1 min-w-0">
              <span class="block truncate text-fg">{s.nome} <span class="text-xs text-fg-muted">· {PAPEL_LABEL[s.papel] ?? s.papel}</span></span>
              <span class="block text-xs text-fg-muted">{s.email || 'sem e-mail'}</span>
            </span>
            {s.linkAssinatura && s.status !== 'ASSINADO' && (
              <a href={s.linkAssinatura} target="_blank" rel="noreferrer" class="text-xs text-accent flex items-center gap-1" onClick={(ev) => ev.stopPropagation()}>link <ExternalLink size={11} /></a>
            )}
            {simulado && s.status !== 'ASSINADO' && (e.status === 'ENVIADO' || e.status === 'PARCIAL') && (
              <Button variant="ghost" size="sm" onClick={() => act(mut.simular, { id, sid: s.id }, `${s.nome} assinou (simulado)`)}><Check size={13} /> Simular</Button>
            )}
            <Badge tone={SIG_STATUS[s.status]?.tone ?? 'neutral'}>{SIG_STATUS[s.status]?.label ?? s.status}</Badge>
          </div>
        ))}
      </Card>
      {simulado && (e.status === 'ENVIADO' || e.status === 'PARCIAL') && <p class="text-xs text-fg-muted">Modo simulado: use "Simular" para marcar a assinatura de cada parte. Configure a Autentique para assinaturas reais.</p>}
    </Page>
  )
}

function NovoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const mut = useAssinaturaMut()
  const [q, setQ] = useState('')
  const [aluno, setAluno] = useState<{ id: number; nome: string } | null>(null)
  const [titulo, setTitulo] = useState('Contrato de Prestação de Serviços Educacionais')
  const busca = useQuery({
    queryKey: ['aca-aluno-busca', q], enabled: q.trim().length >= 2,
    queryFn: () => api.get<{ alunos: Array<{ id: number; ra: string | null; lead: { nome: string } }> }>(`/admin/aca/alunos?q=${encodeURIComponent(q)}`),
  })
  const criar = () => mut.criar.mutate(
    { alunoId: aluno?.id, titulo },
    { onSuccess: (r: any) => { toast('Contrato criado', 'success'); onCreated(r.envelope.id) }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') },
  )
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Novo contrato" description="Selecione o aluno; o aluno e o responsável financeiro entram como signatários automaticamente."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.criar.isPending} disabled={!titulo || !aluno} onClick={criar}>Criar</Button></>}>
      <div class="space-y-3">
        <Input label="Título do contrato" value={titulo} onInput={(e: any) => setTitulo(e.currentTarget.value)} />
        {aluno ? (
          <div class="flex items-center gap-2 text-sm bg-surface-2 rounded-md px-3 py-2">
            <span class="flex-1 text-fg">Aluno: <b>{aluno.nome}</b></span>
            <button class="text-xs text-accent" onClick={() => setAluno(null)}>trocar</button>
          </div>
        ) : (
          <div class="space-y-2">
            <Input label="Buscar aluno (nome, RA, CPF)" value={q} onInput={(e: any) => setQ(e.currentTarget.value)} placeholder="Digite ao menos 2 letras…" />
            {(busca.data?.alunos?.length ?? 0) > 0 && (
              <Card class="p-0 overflow-hidden divide-y divide-border max-h-48 overflow-y-auto">
                {busca.data!.alunos.map((a) => (
                  <button key={a.id} class="w-full text-left px-3 py-2 text-sm hover:bg-surface-2" onClick={() => setAluno({ id: a.id, nome: a.lead.nome })}>
                    <span class="text-fg">{a.lead.nome}</span>{a.ra && <span class="text-xs text-fg-muted"> · RA {a.ra}</span>}
                  </button>
                ))}
              </Card>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

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
  // colar token implica modo Autentique
  const onToken = (v: string) => { setToken(v); if (v.trim() && modoVal !== 'AUTENTIQUE') setModo('AUTENTIQUE') }
  const salvar = () => {
    const body: any = { modo: modoVal, sandbox: sandboxVal }
    if (token.trim()) body.token = token.trim()
    mut.setConfig.mutate(body, { onSuccess: () => { toast('Configuração salva', 'success'); onClose() }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') })
  }
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Configurar assinatura" description="Autentique (assinatura real) ou modo simulado para testes."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={mut.setConfig.isPending} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <div class="text-xs text-fg-muted">Status atual: modo <b>{c.modo === 'AUTENTIQUE' ? 'Autentique' : 'Simulado'}</b> · token {c.tokenConfigurado ? '✓ configurado' : '— não configurado'}</div>
        <Select label="Modo" value={modoVal} onChange={(e: any) => setModo(e.currentTarget.value)}>
          <option value="SIMULADO">Simulado (sem credencial)</option>
          <option value="AUTENTIQUE">Autentique (assinatura real)</option>
        </Select>
        {/* campo texto (não 'password') p/ evitar interferência de gerenciador de senhas ao colar */}
        <Input label="Token da API Autentique" type="text" autocomplete="off" autocorrect="off" spellcheck={false} class="font-mono text-xs"
          value={token} onInput={(e: any) => onToken(e.currentTarget.value)}
          placeholder={c.tokenConfigurado ? 'configurado — cole um novo para substituir' : 'cole o token da Autentique'} />
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={sandboxVal} onChange={(e: any) => setSandbox(e.currentTarget.checked)} /> Sandbox (não consome documentos no teste)</label>
        <p class="text-xs text-fg-muted">No modo Autentique, o contrato é enviado de verdade e os signatários recebem o e-mail/link para assinar. O token é gerado no painel da Autentique (Configurações › Integrações › API).</p>
      </div>
    </Modal>
  )
}
