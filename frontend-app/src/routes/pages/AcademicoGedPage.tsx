import { useState } from 'preact/hooks'
import { FileArchive, Plus, Trash2, ExternalLink } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { useAlunos } from '@/hooks/useAcaAluno'
import { useGed, useGedMut, GED_STATUS } from '@/hooks/useAcaGed'

export function AcademicoGedPage() {
  const [q, setQ] = useState('')
  const alunos = useAlunos(q)
  const [alunoId, setAlunoId] = useState<number | null>(null)
  const ged = useGed(alunoId)
  const mut = useGedMut()
  const [f, setF] = useState({ tipo: '', nome: '', url: '' })

  const lista = alunos.data?.alunos ?? []
  const arquivos = ged.data?.arquivos ?? []
  const add = () => { if (!alunoId || !f.nome || !f.url) return; mut.criar.mutate({ alunoId, tipo: f.tipo || 'Documento', nome: f.nome, url: f.url }, { onSuccess: () => setF({ tipo: '', nome: '', url: '' }) }) }

  return (
    <Page title="GED — Documentos do Aluno" description="Gestão eletrônica de documentos: anexe por link, classifique e confira.">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno por nome ou RA…" />
      {alunos.isLoading ? <Skeleton class="h-16 w-full" /> : lista.length > 0 && alunoId === null ? (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {lista.map((a: any) => (
            <button key={a.id} class="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-surface-2 text-left text-sm" onClick={() => setAlunoId(a.id)}>
              <span class="text-fg-muted text-xs font-mono w-20">RA {a.ra ?? '—'}</span>
              <span class="flex-1 text-fg">{a.lead?.nome ?? a.nome ?? '—'}</span>
            </button>
          ))}
        </Card>
      ) : null}

      {alunoId !== null && (
        <>
          <div class="flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setAlunoId(null)}>← Trocar aluno</Button></div>
          <Card class="space-y-2">
            <div class="text-sm font-semibold text-fg flex items-center gap-2"><FileArchive size={16} /> Anexar documento</div>
            <div class="grid sm:grid-cols-[1fr_1fr_2fr_auto] gap-2">
              <Input placeholder="Tipo (ex: RG)" value={f.tipo} onInput={(e: any) => setF({ ...f, tipo: e.currentTarget.value })} />
              <Input placeholder="Nome do arquivo" value={f.nome} onInput={(e: any) => setF({ ...f, nome: e.currentTarget.value })} />
              <Input placeholder="URL (link do arquivo)" value={f.url} onInput={(e: any) => setF({ ...f, url: e.currentTarget.value })} />
              <Button size="sm" variant="secondary" disabled={!f.nome || !f.url || mut.criar.isPending} onClick={add}><Plus size={14} /></Button>
            </div>
          </Card>

          {ged.isLoading ? <Skeleton class="h-24 w-full" /> : arquivos.length === 0 ? <EmptyState icon={<FileArchive size={26} />} title="Sem documentos" description="Anexe o primeiro documento acima." /> : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {arquivos.map((a) => (
                <div key={a.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span class="flex-1 min-w-0"><span class="block truncate text-fg">{a.nome} <a href={a.url} target="_blank" rel="noopener" class="text-accent inline-flex"><ExternalLink size={12} /></a></span><span class="block text-xs text-fg-muted">{a.tipo}</span></span>
                  <Badge tone={GED_STATUS[a.status]?.tone ?? 'neutral'}>{GED_STATUS[a.status]?.label ?? a.status}</Badge>
                  {a.status !== 'CONFERIDO' && <Button size="sm" variant="ghost" onClick={() => mut.status.mutate({ id: a.id, status: 'CONFERIDO' })}>Conferir</Button>}
                  <button class="text-fg-muted hover:text-danger" onClick={() => mut.excluir.mutate(a.id)}><Trash2 size={14} /></button>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </Page>
  )
}
