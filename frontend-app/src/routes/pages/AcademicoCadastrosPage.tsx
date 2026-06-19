import { useState } from 'preact/hooks'
import { FolderTree, Plus, Trash2 } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCadastrosAux, useCadastrosMut, CAD_TIPOS } from '@/hooks/useAcaCadastros'

export function AcademicoCadastrosPage() {
  const [tipo, setTipo] = useState(CAD_TIPOS[0].key)
  const data = useCadastrosAux(tipo)
  const mut = useCadastrosMut()
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const itens = data.data?.itens ?? []

  return (
    <Page title="Cadastros Auxiliares" description="Listas de apoio acadêmicas: áreas de conhecimento, formações, atendimentos especiais e tipos de documento.">
      <div class="flex gap-1 border-b border-border flex-wrap">
        {CAD_TIPOS.map((t) => (
          <button key={t.key} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tipo === t.key ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTipo(t.key)}>{t.label}</button>
        ))}
      </div>

      <Card class="space-y-2 mt-3">
        <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <Input placeholder="Nome" value={nome} onInput={(e: any) => setNome(e.currentTarget.value)} />
          <Input placeholder="Descrição (opcional)" value={descricao} onInput={(e: any) => setDescricao(e.currentTarget.value)} />
          <Button size="sm" variant="secondary" disabled={!nome || mut.criar.isPending} onClick={() => mut.criar.mutate({ tipo, nome, descricao: descricao || undefined }, { onSuccess: () => { setNome(''); setDescricao('') } })}><Plus size={14} /> Adicionar</Button>
        </div>
      </Card>

      {data.isLoading ? <Skeleton class="h-32 w-full" /> : itens.length === 0 ? <Card><p class="text-sm text-fg-muted flex items-center gap-2"><FolderTree size={16} /> Nenhum item nesta lista.</p></Card> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {itens.map((i) => (
            <div key={i.id} class="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0"><span class="text-fg">{i.nome}</span>{i.descricao && <span class="block text-xs text-fg-muted truncate">{i.descricao}</span>}</span>
              {!i.ativo && <Badge tone="neutral">inativo</Badge>}
              <Button size="sm" variant="ghost" onClick={() => mut.atualizar.mutate({ id: i.id, ativo: !i.ativo })}>{i.ativo ? 'Inativar' : 'Ativar'}</Button>
              <button class="text-fg-muted hover:text-danger" onClick={() => mut.excluir.mutate(i.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}
    </Page>
  )
}
