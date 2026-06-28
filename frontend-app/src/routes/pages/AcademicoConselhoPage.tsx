import { useEffect, useState } from 'preact/hooks'
import { Gavel, Save, FileText, Megaphone } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTurmas } from '@/hooks/useAcaCatalogo'
import { useConselho, useConselhoMut, SITUACAO_LABEL, situacaoTone } from '@/hooks/useAcaFechamento'
import { useDocumentoMut, abrirDocumentoPdf } from '@/hooks/useAcaSecretaria'
import { useComunicacaoAcoes } from '@/hooks/useAcaComunicacao'

export function AcademicoConselhoPage() {
  const turmas = useTurmas()
  const [turmaId, setTurmaId] = useState<number | null>(null)
  return (
    <Page title="Conselho de Classe" description="Resultado consolidado por aluno e disciplina, com ata da reunião.">
      <div class="flex items-center gap-2">
        <span class="text-xs text-fg-muted">Turma:</span>
        <div class="w-80">
          <Select value={turmaId ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setTurmaId(v ? Number(v) : null) }}>
            <option value="">— Selecione a turma —</option>
            {(turmas.data?.turmas ?? []).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        </div>
      </div>
      {turmaId && <ConselhoView turmaId={turmaId} />}
    </Page>
  )
}

function ConselhoView({ turmaId }: { turmaId: number }) {
  const data = useConselho(turmaId)
  const mut = useConselhoMut(turmaId)
  const docMut = useDocumentoMut({ turmaId })
  const comAcoes = useComunicacaoAcoes()
  const [ata, setAta] = useState('')
  const [avisoMsg, setAvisoMsg] = useState<string | null>(null)
  useEffect(() => { setAta(data.data?.ata ?? '') }, [data.data?.ata])

  if (data.isLoading) return <Skeleton class="h-48 w-full mt-3" />
  const d = data.data
  if (!d) return null
  const discs = d.disciplinas

  return (
    <div class="space-y-4 mt-3">
      <Card class="p-0 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-2 text-xs text-fg-muted">
            <tr>
              <th class="text-left p-2 font-medium sticky left-0 bg-surface-2">Aluno</th>
              {discs.map((di) => <th key={di.id} class="p-2 font-medium text-center min-w-[90px]">{di.nome}</th>)}
              <th class="p-2 font-medium text-center">Situação final</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {d.linhas.length === 0 ? <tr><td colspan={discs.length + 2} class="p-4 text-center text-xs text-fg-muted">Sem matriculados.</td></tr> : d.linhas.map((l) => (
              <tr key={l.matriculaId} class="hover:bg-surface-2">
                <td class="p-2 text-fg truncate max-w-[12rem] sticky left-0 bg-surface">{l.nome}</td>
                {discs.map((di) => {
                  const c = l.cells[di.id]
                  return (
                    <td key={di.id} class="p-2 text-center">
                      {c ? (
                        <div class="inline-flex flex-col items-center gap-0.5">
                          <Badge tone={situacaoTone(c.situacao)}>{c.media != null ? c.media : '—'}</Badge>
                          <span class="text-[10px] text-fg-subtle">{c.freqPct}%</span>
                        </div>
                      ) : <span class="text-fg-subtle text-xs">—</span>}
                    </td>
                  )
                })}
                <td class="p-2 text-center"><Badge tone={situacaoTone(l.situacaoGeral)}>{SITUACAO_LABEL[l.situacaoGeral] ?? l.situacaoGeral}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p class="text-[11px] text-fg-subtle">Cada célula mostra a média e a frequência da disciplina. Feche cada diário (aba Fechamento) para preencher o quadro.</p>

      <Card class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-semibold uppercase text-fg-muted flex items-center gap-1"><Gavel size={13} /> Ata do conselho</h3>
          {d.fechadoEm && <Badge tone="success">Fechado em {new Date(d.fechadoEm).toLocaleDateString('pt-BR')}</Badge>}
        </div>
        <Textarea rows={6} value={ata} onInput={(e) => setAta((e.target as HTMLTextAreaElement).value)} placeholder="Registre as deliberações do conselho de classe…" />
        <div class="flex justify-end gap-2 flex-wrap items-center">
          {avisoMsg && <span class="text-xs text-success mr-auto">{avisoMsg}</span>}
          <Button variant="ghost" size="sm" disabled={comAcoes.notificarNotas.isPending} onClick={() => comAcoes.notificarNotas.mutate(turmaId, { onSuccess: (r) => setAvisoMsg(`Aviso de notas: ${r.enviados} envio(s) para ${r.alunos} aluno(s).`) })}><Megaphone size={14} /> Avisar alunos (notas)</Button>
          <Button variant="ghost" size="sm" disabled={docMut.emitir.isPending} onClick={() => mut.salvarAta.mutate({ ata }, { onSuccess: () => docMut.emitir.mutate({ tipo: 'ATA_RESULTADOS', turmaId }, { onSuccess: (r) => abrirDocumentoPdf(r.documento.id).catch(() => {}) }) })}><FileText size={14} /> Emitir ata (PDF)</Button>
          <Button variant="secondary" size="sm" disabled={mut.salvarAta.isPending} onClick={() => mut.salvarAta.mutate({ ata })}><Save size={14} /> Salvar ata</Button>
          <Button variant="primary" size="sm" disabled={mut.salvarAta.isPending} onClick={() => mut.salvarAta.mutate({ ata, fechar: true })}>Salvar e encerrar conselho</Button>
        </div>
      </Card>
    </div>
  )
}
