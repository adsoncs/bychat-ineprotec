import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ChevronLeft, Send, UserPlus, Copy, Clock, Trophy } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { useProvas, useAplicacoes, useProvaMut, APLICACAO_STATUS } from '@/hooks/useAcaProva'

// Detalhe da prova: gerar o acesso de cada candidato e acompanhar a aplicação.
// O link é único por pessoa — é ele que identifica quem está respondendo, então
// compartilhar o link é compartilhar a prova de outra pessoa.

const urlDoToken = (token: string) => `${window.location.origin}/prova?t=${encodeURIComponent(token)}`

export function AcademicoProvaDetailPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const provaId = Number(params.id)
  const provas = useProvas()
  const aplicacoes = useAplicacoes(provaId)
  const mut = useProvaMut()

  const [novo, setNovo] = useState({ nome: '', cpf: '' })
  const prova = provas.data?.provas.find((p) => p.id === provaId)

  const gerar = () => {
    mut.gerarAcesso.mutate(
      { provaId, nome: novo.nome, ...(novo.cpf ? { cpf: novo.cpf } : {}) },
      {
        onSuccess: (r) => {
          setNovo({ nome: '', cpf: '' })
          void navigator.clipboard?.writeText(r.url).then(
            () => toast('Acesso gerado — link copiado.', 'success'),
            () => toast('Acesso gerado.', 'success'),
          )
        },
        onError: (e: any) => toast(e?.message ?? 'Não foi possível gerar o acesso.', 'danger'),
      },
    )
  }

  const copiar = (token: string) => {
    void navigator.clipboard?.writeText(urlDoToken(token)).then(
      () => toast('Link copiado.', 'success'),
      () => toast('Não foi possível copiar. Copie manualmente da barra de endereço do candidato.', 'danger'),
    )
  }

  const publicar = () => {
    mut.publicar.mutate(provaId, {
      onSuccess: () => toast('Prova publicada — os links já funcionam.', 'success'),
      onError: (e: any) => toast(e?.message ?? 'Não foi possível publicar.', 'danger'),
    })
  }

  if (provas.isLoading) return <Skeleton class="h-64 w-full" />
  if (!prova) {
    return (
      <Page title="Prova" actions={<Button variant="ghost" onClick={() => navigate('/aca/provas')}><ChevronLeft size={16} /> Voltar</Button>}>
        <Card class="text-sm text-fg-subtle text-center py-8">Prova não encontrada.</Card>
      </Page>
    )
  }

  const lista = aplicacoes.data?.aplicacoes ?? []
  const entregues = lista.filter((a) => a.status === 'ENTREGUE' || a.status === 'CORRIGIDA')
  const corrigidas = lista.filter((a) => a.notaFinal != null)
  const media = corrigidas.length
    ? (corrigidas.reduce((s, a) => s + (a.notaFinal ?? 0), 0) / corrigidas.length).toFixed(1)
    : null

  return (
    <Page
      title={prova.titulo}
      description={`${prova.duracaoMinutos} minutos · nota máxima ${prova.notaMaxima} · ${prova._count?.itens ?? 0} questão(ões)`}
      actions={
        <div class="flex items-center gap-2">
          {!prova.publicada && (
            <Button onClick={publicar} disabled={mut.publicar.isPending}><Send size={16} /> Publicar</Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/aca/provas')}><ChevronLeft size={16} /> Voltar</Button>
        </div>
      }
    >
      {!prova.publicada && (
        <Card class="!p-4 mb-4 border-warning/40 bg-warning/5 text-sm text-fg-muted">
          Esta prova está em <strong class="text-fg">rascunho</strong>. Você já pode gerar os acessos, mas o
          candidato só consegue abrir a prova depois de publicada.
        </Card>
      )}

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><UserPlus size={14} /> Candidatos</div>
          <div class="text-2xl font-semibold text-fg">{lista.length}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Clock size={14} /> Entregues</div>
          <div class="text-2xl font-semibold text-fg">{entregues.length}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Trophy size={14} /> Corrigidas</div>
          <div class="text-2xl font-semibold text-fg">{corrigidas.length}</div>
        </Card>
        <Card class="space-y-1">
          <div class="flex items-center gap-2 text-fg-muted text-xs"><Trophy size={14} /> Média</div>
          <div class="text-2xl font-semibold text-fg">{media ?? '—'}</div>
        </Card>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2">
          {aplicacoes.isLoading ? (
            <Skeleton class="h-48 w-full" />
          ) : lista.length === 0 ? (
            <Card>
              <EmptyState
                icon={<UserPlus size={24} />}
                title="Nenhum candidato"
                description="Gere um acesso por pessoa — o link identifica quem está respondendo."
              />
            </Card>
          ) : (
            <Card class="p-0 overflow-hidden divide-y divide-border">
              {lista.map((a) => {
                const s = APLICACAO_STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const }
                return (
                  <div key={a.id} class="px-4 py-3 flex items-center gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{a.candidatoNome}</span>
                        {a.candidatoCpf && <span class="text-[11px] font-mono text-fg-subtle">{a.candidatoCpf}</span>}
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </div>
                      <div class="text-xs text-fg-muted mt-0.5">
                        {a.iniciadoEm ? `Iniciou ${new Date(a.iniciadoEm).toLocaleString('pt-BR')}` : 'Ainda não iniciou'}
                        {a.entregueEm && ` · entregou ${new Date(a.entregueEm).toLocaleString('pt-BR')}`}
                        {a._count && ` · ${a._count.respostas} resposta(s)`}
                      </div>
                    </div>
                    <div class="text-right shrink-0 w-24">
                      {a.notaFinal != null ? (
                        <>
                          <div class="text-lg font-semibold text-fg">{a.notaFinal}</div>
                          <div class="text-[10px] text-fg-subtle">
                            obj {a.notaObjetiva ?? '—'}{a.notaDissertativa != null ? ` · dis ${a.notaDissertativa}` : ''}
                          </div>
                        </>
                      ) : a.notaObjetiva != null ? (
                        <>
                          <div class="text-sm text-fg-muted">obj {a.notaObjetiva}</div>
                          <div class="text-[10px] text-warning">aguarda correção</div>
                        </>
                      ) : (
                        <span class="text-xs text-fg-subtle">—</span>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" iconOnly title="Copiar link do candidato" onClick={() => copiar(a.token)}>
                      <Copy size={14} />
                    </Button>
                  </div>
                )
              })}
            </Card>
          )}
        </div>

        <div class="space-y-4">
          <Card class="space-y-3 h-fit">
            <h2 class="text-sm font-semibold text-fg">Gerar acesso</h2>
            <Input label="Nome do candidato" value={novo.nome} onInput={(e) => setNovo((p) => ({ ...p, nome: (e.target as HTMLInputElement).value }))} />
            <Input label="CPF (opcional)" value={novo.cpf} onInput={(e) => setNovo((p) => ({ ...p, cpf: (e.target as HTMLInputElement).value }))} />
            <Button class="w-full" onClick={gerar} disabled={!novo.nome.trim() || mut.gerarAcesso.isPending}>
              <UserPlus size={16} /> Gerar link
            </Button>
            <p class="text-xs text-fg-subtle">O link é copiado automaticamente ao gerar.</p>
          </Card>

          <Card class="!p-4 text-xs text-fg-muted space-y-1.5">
            <div class="flex items-center gap-2 text-fg font-medium"><Clock size={15} /> Sobre o tempo</div>
            <p>
              A contagem começa quando o <strong class="text-fg">candidato inicia</strong>, não quando a janela abre.
              Quem entra atrasado não perde o tempo que não usou, e fechar o navegador não devolve tempo — o prazo
              é controlado no servidor.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  )
}
