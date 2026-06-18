import { useEffect, useState } from 'preact/hooks'
import { Inbox, CheckCircle2, XCircle, FileText, Clock } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { useRequerimentos, useRequerimento, useRequerimentoMut, REQ_STATUS_LABEL, reqTone, type Requerimento } from '@/hooks/useAcaRequerimento'
import { abrirDocumentoPdf } from '@/hooks/useAcaSecretaria'

const FILTROS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'Todos' }, { key: 'ABERTO', label: 'Abertos' }, { key: 'EM_ANALISE', label: 'Em análise' },
  { key: 'DEFERIDO', label: 'Deferidos' }, { key: 'INDEFERIDO', label: 'Indeferidos' }, { key: 'CONCLUIDO', label: 'Concluídos' },
]

export function AcademicoRequerimentosPage() {
  const [status, setStatus] = useState<string | null>('ABERTO')
  const [aberto, setAberto] = useState<number | null>(null)
  const data = useRequerimentos(status)
  const itens = data.data?.itens ?? []
  const counts = data.data?.counts ?? {}

  return (
    <Page title="Requerimentos" description="Secretaria virtual — solicitações dos alunos com protocolo e prazo.">
      <div class="flex gap-1 border-b border-border flex-wrap">
        {FILTROS.map((f) => (
          <button key={f.label} class={`text-sm px-3 py-2 -mb-px border-b-2 ${status === f.key ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setStatus(f.key)}>
            {f.label}{f.key && counts[f.key] ? <span class="ml-1 text-xs text-fg-subtle">({counts[f.key]})</span> : ''}
          </button>
        ))}
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
  const [resposta, setResposta] = useState('')
  const r = q.data?.requerimento
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
      </div>
      <div class="text-sm"><b>{r.alunoNome}</b> · RA {r.ra || '—'} {r.email && <span class="text-fg-muted">· {r.email}</span>}</div>
      <Card class="space-y-1">
        <div class="text-xs text-fg-muted uppercase">{r.tipoNome}</div>
        <div class="font-medium text-fg">{r.assunto}</div>
        {r.descricao && <p class="text-sm text-fg-muted whitespace-pre-wrap">{r.descricao}</p>}
      </Card>
      {r.documentoId && <Button variant="secondary" size="sm" onClick={() => abrirDocumentoPdf(r.documentoId!).catch(() => {})}><FileText size={14} /> Abrir documento gerado</Button>}
      <div>
        <label class="block text-xs font-medium text-fg-muted mb-1">Resposta ao aluno</label>
        <Textarea rows={3} value={resposta} onInput={(e) => setResposta((e.target as HTMLTextAreaElement).value)} placeholder="Mensagem que o aluno verá no portal…" disabled={fechado} />
      </div>
      {!fechado && (
        <div class="flex justify-end gap-2 flex-wrap">
          {r.status === 'ABERTO' && <Button variant="ghost" size="sm" disabled={mut.isPending} onClick={() => acao('EM_ANALISE')}>Marcar em análise</Button>}
          <Button variant="ghost" size="sm" disabled={mut.isPending} onClick={() => acao('INDEFERIDO')}><XCircle size={14} /> Indeferir</Button>
          <Button variant="primary" size="sm" disabled={mut.isPending} onClick={() => acao('DEFERIDO')}><CheckCircle2 size={14} /> Deferir</Button>
        </div>
      )}
      {fechado && r.status !== 'CONCLUIDO' && <div class="flex justify-end"><Button variant="secondary" size="sm" disabled={mut.isPending} onClick={() => acao('CONCLUIDO')}>Concluir</Button></div>}
    </div>
  )
}
