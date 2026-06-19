import { useState } from 'preact/hooks'
import { Users, GraduationCap, Link2, Copy, Check } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { SearchInput } from '@/components/ui/SearchInput'
import { useAlunosPortal, useGerarLinkPlus, type LinkGerado } from '@/hooks/useAcaPortaisPlus'

export function AcademicoPortaisPlusPage() {
  const [q, setQ] = useState('')
  const data = useAlunosPortal(q)
  const gerar = useGerarLinkPlus()
  const [link, setLink] = useState<{ titulo: string; data: LinkGerado } | null>(null)

  const onGerar = (tipo: 'responsavel' | 'exaluno', id: number, titulo: string) =>
    gerar.mutate({ tipo, id }, { onSuccess: (d) => setLink({ titulo, data: d }) })

  const alunos = data.data?.alunos ?? []
  return (
    <Page title="Centrais (Responsável / Ex-aluno)" description="Gere links de acesso (magic link) às centrais do responsável e do ex-aluno.">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno por nome ou RA…" />

      {data.isLoading ? <div class="space-y-2 mt-3">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-20 w-full" />)}</div> :
        alunos.length === 0 ? <EmptyState icon={<Users size={28} />} title="Nenhum aluno" description="Busque um aluno para gerar os links das centrais." /> : (
          <div class="space-y-2 mt-3">
            {alunos.map((a) => (
              <Card key={a.id} class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="flex-1 min-w-0">
                    <span class="text-sm font-medium text-fg">{a.nome}</span>
                    <span class="block text-xs text-fg-muted">RA {a.ra || '—'}</span>
                  </span>
                  {a.concluido && <Badge tone="accent">egresso</Badge>}
                </div>

                <div class="flex flex-wrap gap-2 items-center">
                  {a.responsaveis.length === 0 ? <span class="text-xs text-fg-subtle">Sem responsável cadastrado.</span> :
                    a.responsaveis.map((r) => (
                      <Button key={r.id} size="sm" variant="secondary" disabled={gerar.isPending} onClick={() => onGerar('responsavel', r.id, `Responsável — ${r.nome}`)}>
                        <Users size={13} /> {r.nome}{r.parentesco ? ` (${r.parentesco})` : ''}
                      </Button>
                    ))}
                  {a.concluido && (
                    <Button size="sm" variant="secondary" disabled={gerar.isPending} onClick={() => onGerar('exaluno', a.id, `Ex-aluno — ${a.nome}`)}>
                      <GraduationCap size={13} /> Link do ex-aluno
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

      <Modal open={link !== null} onOpenChange={(o) => !o && setLink(null)} title="Link de acesso gerado" description={link?.titulo}>
        {link && <LinkBox url={link.data.url} expiraEm={link.data.expiraEm} />}
      </Modal>
    </Page>
  )
}

function LinkBox({ url, expiraEm }: { url: string; expiraEm: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }
  return (
    <div class="space-y-2">
      <div class="flex gap-2 items-center">
        <code class="flex-1 text-xs bg-surface-2 rounded px-2 py-2 break-all">{url}</code>
        <Button size="sm" variant="primary" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}</Button>
      </div>
      <p class="text-xs text-fg-muted"><Link2 size={12} class="inline" /> Expira em {new Date(expiraEm).toLocaleDateString('pt-BR')}. Envie ao responsável/ex-aluno por WhatsApp ou e-mail.</p>
    </div>
  )
}
