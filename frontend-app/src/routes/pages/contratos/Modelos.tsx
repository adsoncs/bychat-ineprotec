// Modelos de contrato e configuração da assinatura eletrônica (Autentique).
//
// Os dados são do Portal de Matrículas: existem e funcionam sem o ERP. A tela
// do ERP (Assinatura de Contratos) usa estes mesmos componentes com a rota do
// ERP — é o mesmo cadastro, refletido lá. `erp` liga o que só faz sentido com
// o ERP instalado: tipo de negócio (gatilhos) e corpo em texto (sem Word).
import { useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, FileStack } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { TIPO_NEGOCIO, tipoNegocioLabel, type ContratoTemplate, type Variavel } from '@/hooks/useAcaAssinatura'
import { ArquivoWord, OndeVale, enviarWord } from './ContratoWord'

export interface ConfigAssinatura { modo: 'SIMULADO' | 'AUTENTIQUE'; sandbox: boolean; tokenConfigurado: boolean; webhookSecretConfigurado: boolean }

// Mesma chave de cache nas duas rotas: é o mesmo cadastro.
export const useModelos = (base: string) =>
  useQuery({ queryKey: ['ct-modelos'], queryFn: () => api.get<{ templates: ContratoTemplate[] }>(`${base}/templates`), staleTime: 10_000 })
const useVariaveisDe = (base: string) =>
  useQuery({ queryKey: ['ct-vars', base], queryFn: () => api.get<{ variaveis: Variavel[] }>(`${base}/variaveis`), staleTime: 120_000 })
export const useConfigAssinatura = (base: string) =>
  useQuery({ queryKey: ['ct-config'], queryFn: () => api.get<ConfigAssinatura>(`${base}/config`), staleTime: 30_000 })

function useModeloMut(base: string) {
  const qc = useQueryClient(); const inval = () => void qc.invalidateQueries({ queryKey: ['ct-modelos'] })
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post(`${base}/templates`, b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/templates/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`${base}/templates/${id}`), onSuccess: inval }),
  }
}

export function ListaDeModelos({ base, erp }: { base: string; erp: boolean }) {
  const q = useModelos(base)
  const [edit, setEdit] = useState<ContratoTemplate | 'novo' | null>(null)
  const ts = q.data?.templates ?? []
  return (
    <div class="space-y-3">
      <div class="flex justify-end"><Button variant="primary" size="sm" onClick={() => setEdit('novo')}><Plus size={14} /> Novo modelo</Button></div>
      {q.isLoading ? <Skeleton class="h-14 w-full" /> : ts.length === 0 ? (
        <EmptyState icon={<FileStack size={28} />} title="Nenhum modelo de contrato" description="Suba o contrato da instituição em Word e escolha em quais portais e cursos ele vale." />
      ) : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {ts.map((t) => (
            <div key={t.id} class="px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-surface-2" onClick={() => setEdit(t)}>
              <span class="flex-1 min-w-0"><span class="block truncate text-fg">{t.nome}</span><span class="block text-xs text-fg-muted">{t.descricao || (t.temWord ? t.arquivoDocxNome : 'Sem arquivo Word')}</span></span>
              {t.temWord ? <Badge tone="success">Word</Badge> : <Badge tone="neutral">texto</Badge>}
              {((t.portalIds?.length ?? 0) > 0 || (t.cursoIds?.length ?? 0) > 0)
                ? <Badge tone="accent">{t.cursoIds?.length ? `${t.cursoIds.length} curso(s)` : `${t.portalIds!.length} portal(is)`}</Badge>
                : <Badge tone="neutral">fora do portal</Badge>}
              {erp && <Badge tone="info">{tipoNegocioLabel(t.tipoNegocio)}</Badge>}
              {!t.ativo && <Badge tone="neutral">inativo</Badge>}
            </div>
          ))}
        </Card>
      )}
      {edit && <ModeloModal base={base} erp={erp} template={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function ModeloModal({ base, erp, template, onClose }: { base: string; erp: boolean; template: ContratoTemplate | null; onClose: () => void }) {
  const mut = useModeloMut(base)
  const vars = useVariaveisDe(base)
  const lista = useModelos(base)
  // O modal abre com a linha da lista; depois de subir/remover o Word, a lista
  // recarrega e é dela que vêm nome do arquivo e campos atualizados.
  const atual = (template && lista.data?.templates.find((t) => t.id === template.id)) || template
  const c = (template?.config as any) || {}
  const [f, setF] = useState<any>({
    nome: template?.nome || '', tipoNegocio: template?.tipoNegocio || 'OUTRO', descricao: template?.descricao || '',
    corpoTexto: template?.corpoTexto || '', ativo: template?.ativo ?? true,
    deadlineDias: c.deadlineDias ?? '', reminder: c.reminder || '', sortable: !!c.sortable, refusable: c.refusable !== false, mensagem: c.mensagem || '',
    portalIds: template?.portalIds ?? [], cursoIds: template?.cursoIds ?? [],
  })
  const [wordPendente, setWordPendente] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const temWord = !!atual?.temWord || !!wordPendente
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const salvar = async () => {
    const body: any = { nome: f.nome, tipoNegocio: f.tipoNegocio, descricao: f.descricao, corpoTexto: f.corpoTexto, ativo: f.ativo,
      portalIds: f.portalIds, cursoIds: f.cursoIds,
      config: { deadlineDias: f.deadlineDias ? Number(f.deadlineDias) : null, reminder: f.reminder || null, sortable: f.sortable, refusable: f.refusable, mensagem: f.mensagem || null },
      signatariosPadrao: template?.signatariosPadrao || [{ papel: 'ALUNO', acao: 'SIGN', deliveryMethod: 'EMAIL' }, { papel: 'RESPONSAVEL', acao: 'SIGN', deliveryMethod: 'EMAIL' }] }
    setSalvando(true)
    try {
      const r: any = template ? await mut.atualizar.mutateAsync({ id: template.id, ...body }) : await mut.criar.mutateAsync(body)
      if (wordPendente) {
        const w = await enviarWord(base, r.template.id, wordPendente)
        if (w.desconhecidos.length) toast(`Campos não reconhecidos no Word: ${w.desconhecidos.join(', ')}`, 'warning', 8000)
        await lista.refetch()
      }
      toast('Modelo salvo', 'success'); onClose()
    } catch (e: any) { toast(e?.message || 'Erro', 'danger') } finally { setSalvando(false) }
  }
  // Sem ERP, o contrato do portal é sempre o Word: texto puro só serve aos gatilhos do ERP.
  const podeSalvar = !!f.nome && (temWord || (erp && !!f.corpoTexto))
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={template ? 'Editar modelo de contrato' : 'Novo modelo de contrato'} size="lg"
      footer={<><div class="flex-1">{template && <Button variant="ghost" onClick={() => { if (confirm('Excluir este modelo de contrato?')) mut.excluir.mutate(template.id, { onSuccess: () => { toast('Excluído', 'success'); onClose() } }) }}><Trash2 size={14} /> Excluir</Button>}</div><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvando} disabled={!podeSalvar} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <div class={erp ? 'grid sm:grid-cols-2 gap-3' : ''}>
          <Input label="Nome" value={f.nome} onInput={(e: any) => set('nome', e.currentTarget.value)} placeholder="Ex.: Contrato — Cursos Técnicos EAD" />
          {erp && <Select label="Tipo de negócio (gatilhos do ERP)" value={f.tipoNegocio} onChange={(e: any) => set('tipoNegocio', e.currentTarget.value)}>{TIPO_NEGOCIO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>}
        </div>
        <Input label="Descrição" value={f.descricao} onInput={(e: any) => set('descricao', e.currentTarget.value)} />
        <ArquivoWord base={base} templateId={template?.id ?? null} nomeArquivo={atual?.arquivoDocxNome ?? null} campos={atual?.camposDocx ?? null}
          pendente={wordPendente} onPendente={setWordPendente} onMudou={() => void lista.refetch()} />
        <OndeVale base={base} portalIds={f.portalIds} cursoIds={f.cursoIds} onChange={(v) => setF({ ...f, ...v })} />
        {erp && !temWord && <div class="space-y-1">
          <Textarea label="Corpo do contrato em texto (sem arquivo Word; use variáveis {{...}})" rows={9} value={f.corpoTexto} onInput={(e: any) => set('corpoTexto', e.currentTarget.value)} />
          <div class="flex flex-wrap gap-1">{(vars.data?.variaveis ?? []).map((v) => <button key={v.chave} title={v.desc} class="text-[0.7rem] px-2 py-0.5 rounded bg-surface-2 border border-border text-fg-muted hover:text-fg" onClick={() => set('corpoTexto', `${f.corpoTexto}{{${v.chave}}}`)}>{`{{${v.chave}}}`}</button>)}</div>
        </div>}
        <div class="grid sm:grid-cols-2 gap-2">
          <Input label="Prazo para assinar (dias)" type="number" value={f.deadlineDias} onInput={(e: any) => set('deadlineDias', e.currentTarget.value)} />
          <Select label="Lembrete da Autentique" value={f.reminder} onChange={(e: any) => set('reminder', e.currentTarget.value)}><option value="">Sem lembrete</option><option value="DAILY">Diário</option><option value="WEEKLY">Semanal</option></Select>
          {erp && <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.sortable} onChange={(e: any) => set('sortable', e.currentTarget.checked)} /> Assinatura em ordem</label>}
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.refusable} onChange={(e: any) => set('refusable', e.currentTarget.checked)} /> Permitir recusar</label>
          <Input class="sm:col-span-2" label="Mensagem do convite" value={f.mensagem} onInput={(e: any) => set('mensagem', e.currentTarget.value)} />
          <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Ativo</label>
        </div>
      </div>
    </Modal>
  )
}

export function ConfigAssinaturaModal({ base, onClose }: { base: string; onClose: () => void }) {
  const q = useConfigAssinatura(base)
  const qc = useQueryClient()
  const salvarMut = useMutation({ mutationFn: (b: any) => api.put(`${base}/config`, b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ct-config'] }) })
  const c = q.data
  const [modo, setModo] = useState<string>('')
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const [sandbox, setSandbox] = useState<boolean | null>(null)
  if (!c) return null
  const modoVal = modo || c.modo
  const sandboxVal = sandbox === null ? c.sandbox : sandbox
  const onToken = (v: string) => { setToken(v); if (v.trim() && modoVal !== 'AUTENTIQUE') setModo('AUTENTIQUE') }
  const salvar = () => {
    const body: any = { modo: modoVal, sandbox: sandboxVal }
    if (token.trim()) body.token = token.trim()
    if (secret.trim()) body.webhookSecret = secret.trim()
    salvarMut.mutate(body, { onSuccess: () => { toast('Configuração salva', 'success'); onClose() }, onError: (e: any) => toast(e?.message || 'Erro', 'danger') })
  }
  const webhook = `${window.location.origin}/api/webhooks/autentique`
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Assinatura eletrônica" description="Autentique (assinatura real) ou simulado para testes."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvarMut.isPending} onClick={salvar}>Salvar</Button></>}>
      <div class="space-y-3">
        <div class="text-xs text-fg-muted">Situação: modo <b>{c.modo === 'AUTENTIQUE' ? 'Autentique' : 'Simulado'}</b> · token {c.tokenConfigurado ? '✓' : '—'} · segredo do webhook {c.webhookSecretConfigurado ? '✓' : '—'}{c.sandbox ? ' · sandbox (teste)' : ''}</div>
        <Select label="Modo" value={modoVal} onChange={(e: any) => setModo(e.currentTarget.value)}><option value="SIMULADO">Simulado — o aluno aceita no próprio portal</option><option value="AUTENTIQUE">Autentique — assinatura eletrônica real</option></Select>
        <Input label="Token da API Autentique" type="text" autocomplete="off" spellcheck={false} class="font-mono text-xs" value={token} onInput={(e: any) => onToken(e.currentTarget.value)} placeholder={c.tokenConfigurado ? 'configurado — cole um novo para substituir' : 'cole o token da Autentique'} />
        <Input label="Segredo do webhook" type="text" autocomplete="off" spellcheck={false} class="font-mono text-xs" value={secret} onInput={(e: any) => setSecret(e.currentTarget.value)} placeholder={c.webhookSecretConfigurado ? 'configurado — cole um novo para substituir' : 'secret do endpoint de webhook'} />
        <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={sandboxVal} onChange={(e: any) => setSandbox(e.currentTarget.checked)} /> Sandbox (teste: não consome documentos e não tem validade jurídica)</label>
        <p class="text-xs text-fg-muted">Token: painel da Autentique › Integrações › API. Webhook: <code class="select-all">{webhook}</code> (eventos de documento atualizado e finalizado). O segredo confere que o aviso veio mesmo da Autentique.</p>
      </div>
    </Modal>
  )
}
