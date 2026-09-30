// Contrato em Word no modelo de contrato: o arquivo da instituição (.docx com
// {{campos}}), a pré-visualização em PDF e onde o modelo vale na inscrição do
// portal (portais e cursos). Backend: routes/acaAssinatura.ts (…/word, …/previa).
import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { FileText, Upload, Download, Trash2, Eye, AlertTriangle, ChevronDown, ChevronRight, Copy } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface CampoContrato { chave: string; rotulo: string; grupo: string; exemplo: string }
interface Opcoes { portais: Array<{ id: number; nome: string; slug: string }>; cursos: Array<{ id: number; nome: string }> }

const token = () => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } }
const autorizacao = (): Record<string, string> => { const t = token(); return t ? { Authorization: `Bearer ${t}` } : {} }

export const useCamposWord = () => useQuery({ queryKey: ['aca-ct-campos-word'], queryFn: () => api.get<{ campos: CampoContrato[] }>('/admin/aca/assinatura/campos-word'), staleTime: 300_000 })
export const useOpcoesVinculo = () => useQuery({ queryKey: ['aca-ct-opcoes-vinculo'], queryFn: () => api.get<Opcoes>('/admin/aca/assinatura/opcoes-vinculo'), staleTime: 60_000 })

/** Lê o arquivo escolhido como base64 (sem o prefixo data:). */
export function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''))
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo'))
    r.readAsDataURL(arquivo)
  })
}

export async function enviarWord(templateId: number, arquivo: File): Promise<{ campos: string[]; desconhecidos: string[] }> {
  return api.put(`/admin/aca/assinatura/templates/${templateId}/word`, { nome: arquivo.name, base64: await lerBase64(arquivo) })
}

async function baixar(caminho: string, nome: string) {
  const res = await fetch(`${env.apiBase}${caminho}`, { headers: autorizacao() })
  if (!res.ok) throw new Error('Arquivo indisponível')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Seção "Arquivo Word" do modelo. `templateId` nulo = modelo novo (o arquivo sobe ao salvar). */
export function ArquivoWord(p: {
  templateId: number | null
  nomeArquivo: string | null
  campos: string[] | null
  pendente: File | null
  onPendente: (f: File | null) => void
  onMudou: () => void
}) {
  const camposQ = useCamposWord()
  const [enviando, setEnviando] = useState(false)
  const [desconhecidos, setDesconhecidos] = useState<string[]>([])
  const [inscricao, setInscricao] = useState('')
  const [gerando, setGerando] = useState(false)
  const [legenda, setLegenda] = useState(false)
  const conhecidos = new Set((camposQ.data?.campos ?? []).map((c) => c.chave.toLowerCase()))
  const usados = p.campos ?? []
  const estranhos = desconhecidos.length ? desconhecidos : usados.filter((c) => conhecidos.size && !conhecidos.has(c.toLowerCase()) && !['aluno.nome', 'aluno.cpf', 'aluno.email', 'aluno.ra', 'valor', 'parcelas'].includes(c.toLowerCase()))

  const escolher = async (e: any) => {
    const f: File | undefined = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!f) return
    if (!/\.docx$/i.test(f.name)) { toast('Envie um arquivo Word no formato .docx (no Word: Salvar como › Documento do Word).', 'danger'); return }
    if (!p.templateId) { p.onPendente(f); return }
    setEnviando(true)
    try {
      const r = await enviarWord(p.templateId, f)
      setDesconhecidos(r.desconhecidos)
      toast(r.desconhecidos.length ? `Arquivo salvo — ${r.desconhecidos.length} campo(s) não reconhecido(s)` : `Arquivo salvo — ${r.campos.length} campo(s) encontrados`, r.desconhecidos.length ? 'warning' : 'success')
      p.onMudou()
    } catch (err: any) { toast(err?.message || 'Falha ao enviar', 'danger') } finally { setEnviando(false) }
  }

  const remover = async () => {
    if (!p.templateId || !confirm('Remover o arquivo Word deste modelo? Ele deixa de ser usado nos contratos novos.')) return
    try { await api.delete(`/admin/aca/assinatura/templates/${p.templateId}/word`); setDesconhecidos([]); p.onMudou() }
    catch (err: any) { toast(err?.message || 'Falha', 'danger') }
  }

  const previa = async () => {
    if (!p.templateId) return
    setGerando(true)
    const janela = window.open('', '_blank')
    try {
      const res = await fetch(`${env.apiBase}/admin/aca/assinatura/templates/${p.templateId}/previa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...autorizacao() }, body: JSON.stringify({ inscricao: inscricao.trim() || undefined }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Falha ao gerar a prévia')
      const faltando = decodeURIComponent(res.headers.get('X-Campos-Faltando') || '').split(',').filter(Boolean)
      const url = URL.createObjectURL(await res.blob())
      if (janela) janela.location.href = url; else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (faltando.length) toast(`Sem valor nesta ${inscricao.trim() ? 'inscrição' : 'prévia'}: ${faltando.join(', ')}`, 'warning')
    } catch (err: any) { janela?.close(); toast(err?.message || 'Falha', 'danger') } finally { setGerando(false) }
  }

  const grupos = new Map<string, CampoContrato[]>()
  for (const c of camposQ.data?.campos ?? []) grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c])
  const copiar = (chave: string) => { void navigator.clipboard?.writeText(`{{${chave}}}`); toast(`{{${chave}}} copiado`, 'success') }

  return (
    <div class="space-y-3 rounded-lg border border-border p-3">
      <div class="flex items-start gap-3">
        <FileText size={20} class="text-accent mt-0.5 shrink-0" />
        <div class="flex-1 min-w-0 text-sm">
          <div class="font-semibold text-fg">Contrato em Word</div>
          <p class="text-xs text-fg-muted">
            Suba o contrato da instituição (.docx) com os campos escritos entre chaves duplas — por exemplo <code>{'{{nome}}'}</code>, <code>{'{{cpf}}'}</code>, <code>{'{{curso}}'}</code>, <code>{'{{valor_total}}'}</code>.
            O sistema preenche com os dados da inscrição, gera o PDF mantendo a formatação do Word e envia para assinatura na Autentique.
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        {p.nomeArquivo || p.pendente ? (
          <span class="flex items-center gap-2 text-sm text-fg">
            <Badge tone={p.pendente ? 'warning' : 'success'}>{p.pendente ? 'será enviado ao salvar' : 'arquivo atual'}</Badge>
            <span class="truncate max-w-[16rem]">{p.pendente?.name ?? p.nomeArquivo}</span>
          </span>
        ) : <span class="text-sm text-fg-muted">Nenhum arquivo — o modelo usa o texto abaixo.</span>}
        <div class="flex-1" />
        <label class="inline-flex">
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden" onChange={escolher} />
          <span class={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-border cursor-pointer hover:bg-surface-2 ${enviando ? 'opacity-60 pointer-events-none' : ''}`}>
            <Upload size={14} /> {enviando ? 'Enviando…' : p.nomeArquivo || p.pendente ? 'Trocar arquivo' : 'Subir Word'}
          </span>
        </label>
        {p.nomeArquivo && p.templateId && <Button size="sm" variant="ghost" onClick={() => baixar(`/admin/aca/assinatura/templates/${p.templateId}/word`, p.nomeArquivo || 'contrato.docx').catch((e) => toast(e.message, 'danger'))}><Download size={14} /> Baixar</Button>}
        {p.nomeArquivo && p.templateId && <Button size="sm" variant="ghost" onClick={remover}><Trash2 size={14} /> Remover</Button>}
        {p.pendente && <Button size="sm" variant="ghost" onClick={() => p.onPendente(null)}>Desfazer</Button>}
      </div>

      {!p.nomeArquivo && !p.pendente && (
        <button class="text-xs text-accent hover:underline inline-flex items-center gap-1" onClick={() => baixar('/admin/aca/assinatura/modelo-exemplo.docx', 'modelo-de-contrato.docx').catch((e) => toast(e.message, 'danger'))}>
          <Download size={12} /> Baixar um modelo de exemplo com todos os campos
        </button>
      )}

      {estranhos.length > 0 && (
        <div class="flex gap-2 rounded-md bg-warning/10 border border-warning/30 p-2 text-xs text-fg">
          <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
          <span>O arquivo usa campos que o sistema não conhece e que sairão <b>em branco</b>: {estranhos.map((c) => <code key={c} class="mx-0.5">{`{{${c}}}`}</code>)}. Confira a grafia na lista de campos abaixo.</span>
        </div>
      )}

      {p.nomeArquivo && p.templateId && (
        <div class="flex flex-wrap items-end gap-2">
          <div class="w-56"><Input label="Prévia com uma inscrição real (opcional)" placeholder="Código da inscrição" value={inscricao} onInput={(e: any) => setInscricao(e.currentTarget.value)} /></div>
          <Button size="sm" variant="secondary" loading={gerando} onClick={previa}><Eye size={14} /> Pré-visualizar PDF</Button>
          <span class="text-2xs text-fg-muted pb-2">{inscricao.trim() ? 'Com os dados dessa inscrição.' : 'Com dados de exemplo.'}</span>
        </div>
      )}

      <div>
        <button class="text-xs font-semibold text-fg-muted hover:text-fg inline-flex items-center gap-1" onClick={() => setLegenda(!legenda)}>
          {legenda ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Campos disponíveis ({camposQ.data?.campos.length ?? '…'}) — clique para copiar
        </button>
        {legenda && (
          <div class="mt-2 max-h-72 overflow-auto space-y-2 pr-1">
            {[...grupos.entries()].map(([g, cs]) => (
              <div key={g}>
                <div class="text-2xs uppercase tracking-wide text-fg-muted mb-1">{g}</div>
                <div class="grid sm:grid-cols-2 gap-x-3 gap-y-0.5">
                  {cs.map((c) => (
                    <button key={c.chave} class="flex items-center gap-2 text-left text-xs py-0.5 hover:bg-surface-2 rounded px-1" onClick={() => copiar(c.chave)} title={c.exemplo ? `Ex.: ${c.exemplo}` : ''}>
                      <code class={`shrink-0 ${usados.includes(c.chave) ? 'text-success' : 'text-accent'}`}>{`{{${c.chave}}}`}</code>
                      <span class="truncate text-fg-muted">{c.rotulo}</span>
                      <Copy size={10} class="ml-auto text-fg-muted shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Onde o modelo vale na inscrição: portais e cursos (curso tem prioridade). */
export function OndeVale(p: { portalIds: number[]; cursoIds: number[]; onChange: (v: { portalIds: number[]; cursoIds: number[] }) => void }) {
  const q = useOpcoesVinculo()
  const [busca, setBusca] = useState('')
  const alterna = (lista: number[], id: number) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id])
  const cursos = (q.data?.cursos ?? []).filter((c) => !busca.trim() || c.nome.toLowerCase().includes(busca.trim().toLowerCase()))
  const semVinculo = !p.portalIds.length && !p.cursoIds.length
  return (
    <div class="space-y-2 rounded-lg border border-border p-3">
      <div class="text-sm font-semibold text-fg">Onde este contrato vale na inscrição</div>
      <p class="text-xs text-fg-muted">
        Marque os portais em que ele é o contrato padrão. Para um curso com contrato próprio, crie outro modelo marcando o curso — <b>o do curso ganha do do portal</b>.
        {semVinculo && ' Sem portal nem curso marcado, o modelo não aparece na inscrição: fica só para os gatilhos do ERP (pelo tipo de negócio).'}
      </p>
      <div>
        <div class="text-2xs uppercase tracking-wide text-fg-muted mb-1">Portais {p.portalIds.length ? `(${p.portalIds.length})` : ''}</div>
        <div class="flex flex-wrap gap-1.5">
          {(q.data?.portais ?? []).map((po) => {
            const on = p.portalIds.includes(po.id)
            return (
              <button key={po.id} onClick={() => p.onChange({ ...p, portalIds: alterna(p.portalIds, po.id) })}
                class={`text-xs px-2 py-1 rounded-md border ${on ? 'bg-accent/15 border-accent text-fg' : 'border-border text-fg-muted hover:text-fg'}`}>
                {on ? '✓ ' : ''}{po.nome}
              </button>
            )
          })}
          {q.data && !q.data.portais.length && <span class="text-xs text-fg-muted">Nenhum portal cadastrado.</span>}
        </div>
      </div>
      <div>
        <div class="flex items-center gap-2 mb-1">
          <div class="text-2xs uppercase tracking-wide text-fg-muted">Cursos {p.cursoIds.length ? `(${p.cursoIds.length})` : '— opcional, para contrato próprio de um curso'}</div>
          <div class="flex-1" />
          <input class="h-7 px-2 text-xs rounded-md bg-surface-inset border border-border w-44" placeholder="Filtrar cursos" value={busca} onInput={(e: any) => setBusca(e.currentTarget.value)} />
        </div>
        <div class="max-h-40 overflow-auto grid sm:grid-cols-2 gap-x-3">
          {cursos.map((c) => (
            <label key={c.id} class="flex items-center gap-2 text-xs text-fg-muted py-0.5 cursor-pointer hover:text-fg">
              <input type="checkbox" checked={p.cursoIds.includes(c.id)} onChange={() => p.onChange({ ...p, cursoIds: alterna(p.cursoIds, c.id) })} />
              <span class="truncate">{c.nome}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
