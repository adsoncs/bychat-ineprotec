import { useState } from 'preact/hooks'
import { FileText, Printer, Trash2, FileBadge, Search, Link as LinkIcon } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAlunos } from '@/hooks/useAcaAluno'
import { useHistorico, useDocumentos, useDocumentoMut, abrirDocumentoPdf, gerarLinkPortal, TIPO_DOC_LABEL } from '@/hooks/useAcaSecretaria'
import { SITUACAO_LABEL, situacaoTone } from '@/hooks/useAcaFechamento'

export function AcademicoSecretariaPage() {
  const [q, setQ] = useState('')
  const [alunoId, setAlunoId] = useState<number | null>(null)
  const alunos = useAlunos(q)

  return (
    <Page title="Secretaria" description="Histórico escolar e emissão de documentos oficiais.">
      <div class="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card class="space-y-2 self-start">
          <div class="relative">
            <Search size={14} class="absolute left-2 top-2.5 text-fg-subtle" />
            <Input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar aluno…" class="pl-7" />
          </div>
          <div class="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {alunos.isLoading ? <Skeleton class="h-24 w-full" /> : (alunos.data?.alunos ?? []).length === 0 ? <p class="text-xs text-fg-muted py-3">Nenhum aluno.</p> : (alunos.data?.alunos ?? []).map((a) => (
              <button key={a.id} class={`w-full text-left px-2 py-2 text-sm hover:bg-surface-2 ${alunoId === a.id ? 'bg-surface-2 font-medium' : ''}`} onClick={() => setAlunoId(a.id)}>
                <div class="text-fg truncate">{a.lead.nome}</div>
                <div class="text-[11px] text-fg-subtle">RA {a.ra || '—'}</div>
              </button>
            ))}
          </div>
        </Card>
        {alunoId ? <SecretariaAluno alunoId={alunoId} /> : <Card class="flex items-center justify-center text-sm text-fg-muted min-h-[200px]">Selecione um aluno.</Card>}
      </div>
    </Page>
  )
}

function SecretariaAluno({ alunoId }: { alunoId: number }) {
  const hist = useHistorico(alunoId)
  const docs = useDocumentos({ alunoId })
  const mut = useDocumentoMut({ alunoId })
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const h = hist.data

  function emitir(tipo: string) {
    mut.emitir.mutate({ tipo, alunoId }, { onSuccess: (r) => abrirDocumentoPdf(r.documento.id).catch(() => {}) })
  }
  async function gerarLink() {
    setGerando(true)
    try { const url = await gerarLinkPortal('aluno', alunoId); setPortalUrl(url); try { await navigator.clipboard.writeText(url) } catch {} }
    finally { setGerando(false) }
  }

  return (
    <div class="space-y-4">
      <Card class="space-y-2">
        <h3 class="text-xs font-semibold uppercase text-fg-muted">Portal do Aluno</h3>
        <div class="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" disabled={gerando} onClick={gerarLink}><LinkIcon size={14} /> Gerar link de acesso</Button>
          {portalUrl && <span class="text-[11px] text-success">Copiado!</span>}
        </div>
        {portalUrl && <input class="w-full text-xs px-2 py-1.5 rounded border border-border bg-surface-2 text-fg-muted" readonly value={portalUrl} onFocus={(e) => (e.target as HTMLInputElement).select()} />}
        <p class="text-[11px] text-fg-subtle">Link temporário (30 dias) com boletim, frequência, financeiro (2ª via) e documentos.</p>
      </Card>
      <Card class="space-y-1">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase text-fg-muted">Emitir documento</h3>
          {mut.emitir.isPending && <span class="text-xs text-fg-subtle">Gerando…</span>}
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={mut.emitir.isPending} onClick={() => emitir('HISTORICO')}><FileText size={14} /> Histórico Escolar</Button>
          <Button variant="secondary" size="sm" disabled={mut.emitir.isPending} onClick={() => emitir('DECLARACAO_MATRICULA')}><FileBadge size={14} /> Decl. de Matrícula</Button>
          <Button variant="secondary" size="sm" disabled={mut.emitir.isPending} onClick={() => emitir('DECLARACAO_FREQUENCIA')}><FileBadge size={14} /> Decl. de Frequência</Button>
        </div>
        <p class="text-[11px] text-fg-subtle">O PDF abre em nova aba e fica registrado abaixo com número oficial.</p>
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Histórico — prévia</div>
        {hist.isLoading ? <Skeleton class="h-32 w-full" /> : !h ? <p class="text-xs text-fg-muted p-4">Sem dados.</p> : (
          <div class="p-4 space-y-3">
            <div class="text-sm"><b>{h.aluno.nome}</b> · RA {h.aluno.ra || '—'} · {h.curso}</div>
            {h.periodos.length === 0 ? <p class="text-xs text-fg-muted">Nenhum resultado fechado ainda. Feche os diários para compor o histórico.</p> : h.periodos.map((p, i) => (
              <div key={i}>
                <div class="text-xs font-semibold text-accent mb-1">{p.periodo} — {p.turma}</div>
                <table class="w-full text-sm">
                  <tbody class="divide-y divide-border">
                    {p.disciplinas.map((d, j) => (
                      <tr key={j}>
                        <td class="py-1 text-fg">{d.nome}</td>
                        <td class="py-1 text-right text-fg-muted text-xs w-16">{d.cargaHoraria}h</td>
                        <td class="py-1 text-right w-16">{d.media != null ? d.media.toFixed(1) : '—'}</td>
                        <td class="py-1 text-right w-16 text-xs text-fg-muted">{d.freqPct != null ? `${d.freqPct}%` : '—'}</td>
                        <td class="py-1 text-right w-32"><Badge tone={situacaoTone(d.situacao)}>{SITUACAO_LABEL[d.situacao] ?? d.situacao}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {h.periodos.length > 0 && <div class="text-xs font-medium text-fg-muted">Carga horária cursada: {h.chTotal}h</div>}
          </div>
        )}
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted">Documentos emitidos</div>
        {docs.isLoading ? <Skeleton class="h-20 w-full" /> : (docs.data?.documentos ?? []).length === 0 ? <p class="text-xs text-fg-muted p-4">Nenhum documento emitido.</p> : (docs.data?.documentos ?? []).map((d) => (
          <div key={d.id} class="px-4 py-2 flex items-center gap-3 border-t border-border text-sm">
            <Badge tone="neutral">{d.numero}</Badge>
            <span class="flex-1 text-fg">{TIPO_DOC_LABEL[d.tipo] ?? d.tipo}</span>
            <span class="text-xs text-fg-subtle">{new Date(d.emitidoEm).toLocaleDateString('pt-BR')}</span>
            <button class="text-fg-muted hover:text-accent" title="Abrir PDF" onClick={() => abrirDocumentoPdf(d.id).catch(() => {})}><Printer size={15} /></button>
            <button class="text-fg-subtle hover:text-danger" title="Excluir" onClick={() => mut.excluir.mutate(d.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
    </div>
  )
}
