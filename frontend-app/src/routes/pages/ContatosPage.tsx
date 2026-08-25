// Contatos — quem já falou com a empresa e ainda não virou Lead.
//
// Estes registros sempre existiram: são a ficha com `qualifiedAt = null`, criada
// quando alguém manda mensagem. O que não existia era um lugar para vê-los. Sem
// isso, a conversa acontecia, ficava guardada no módulo Conversas e não
// alcançava o resto do sistema — em algumas instalações, quatro de cada cinco
// registros estavam nessa situação.
//
// Duas regras desenham a lista, e as duas vêm do servidor:
//   · só entra quem JÁ MANDOU mensagem (contato de agenda que nunca falou fica
//     de fora — é porta de entrada e base legal ao mesmo tempo);
//   · número reservado continua reservado (quem não vê aquela linha no Conversas
//     também não vê os contatos dela aqui).

import { useState, useEffect } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { useLocation } from 'wouter-preact'
import {
  BookUser, Search, MessageSquare, Star, Users as UsersIcon, X,
  CheckSquare, Square, Phone, Mail, HelpCircle, Plus, Pencil, Trash2,
} from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { PromoteLeadDialog } from '@/components/PromoteLeadDialog'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useCan, useMyPermissions } from '@/hooks/usePermissions'
import {
  useContatos, useResumoContatos, useFiltrosDeContato,
  useCriarContato, useEditarContato, useApagarContato,
  type Contato,
} from '@/hooks/useContatos'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const POR_PAGINA = 50

/** Rótulo do canal de entrada. O que interessa é por onde a pessoa chegou. */
function origemLabel(source: string | null): string {
  switch (source) {
    case 'whatsapp': return 'WhatsApp'
    case 'whatsapp_import': return 'Importado do celular'
    case 'whatsapp_contacts': return 'Agenda do celular'
    case 'instagram': return 'Instagram'
    case 'messenger': return 'Messenger'
    case 'telegram': return 'Telegram'
    case 'manual': return 'Cadastro manual'
    default: return source || 'Origem desconhecida'
  }
}

function quandoFoi(iso: string | null): string {
  if (!iso) return '—'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return '—'
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} d`
  return new Date(ts).toLocaleDateString('pt-BR')
}

export function ContatosPage() {
  const [, navigate] = useLocation()
  const [busca, setBusca] = useState('')
  const [buscaAtiva, setBuscaAtiva] = useState('')
  const [canal, setCanal] = useState('')
  const [origem, setOrigem] = useState('')
  const [grupos, setGrupos] = useState<'excluir' | 'incluir' | 'apenas'>('excluir')
  const [respondeu, setRespondeu] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [promover, setPromover] = useState<
    { kind: 'single'; leadId: number; leadName?: string | null } | { kind: 'bulk'; leadIds: number[] } | null
  >(null)
  const [comoFunciona, setComoFunciona] = useState(false)
  const [editando, setEditando] = useState<Contato | 'novo' | null>(null)
  const [apagando, setApagando] = useState<Contato | null>(null)

  // Cada ação tem a sua permissão: o administrador decide quem cadastra, quem
  // corrige e quem apaga sem precisar mexer no acesso a Leads.
  const podeCriar = useCan('contatos', 'create')
  const podeEditar = useCan('contatos', 'edit')
  const podeApagarQuando = useCan('contatos', 'delete')
  // `useCan` devolve true enquanto as permissões carregam (para a tela não
  // piscar vazia). Para APAGAR isso é o avesso do que se quer: a lixeira
  // aparecia por um instante para quem não pode apagar. Aqui o botão só surge
  // depois da resposta.
  const { data: permsCarregadas } = useMyPermissions()
  const podeApagar = !!permsCarregadas && podeApagarQuando
  const apagar = useApagarContato()

  // O recorte que vale para a lista E para os contadores do topo. Um só objeto
  // para os dois não poderem divergir.
  const recorte = {
    search: buscaAtiva || undefined,
    canal: canal || undefined,
    origem: origem || undefined,
  }
  const { data, isLoading } = useContatos({
    ...recorte,
    grupos,
    respondeu: respondeu || undefined,
    limit: POR_PAGINA,
    offset: pagina * POR_PAGINA,
  })
  const { data: resumo } = useResumoContatos(recorte)
  const { data: filtrosData } = useFiltrosDeContato()

  const contatos = data?.contatos ?? []
  const total = data?.total ?? 0
  const canais = filtrosData?.canais ?? []
  const origens = filtrosData?.origens ?? []
  const paginas = Math.ceil(total / POR_PAGINA)

  function alternar(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // Grupo de WhatsApp não vira Lead: não é pessoa, não tem telefone próprio e
  // não entra em funil. Fica selecionável para nada — então nem é oferecido.
  const promoviveis = contatos.filter((c) => !c.isGroup)
  const todosMarcados = promoviveis.length > 0 && promoviveis.every((c) => selecionados.has(c.id))
  const selecionadosPromoviveis = promoviveis.filter((c) => selecionados.has(c.id))

  function alternarTodos() {
    setSelecionados((prev) => {
      if (todosMarcados) return new Set()
      const next = new Set(prev)
      promoviveis.forEach((c) => next.add(c.id))
      return next
    })
  }

  function aplicarBusca(e: Event) {
    e.preventDefault()
    setBuscaAtiva(busca.trim())
    setPagina(0)
  }

  function trocarFiltro(fn: () => void) {
    fn()
    setPagina(0)
    setSelecionados(new Set())
  }

  return (
    <Page
      title="Contatos"
      description="Quem já conversou com a empresa e ainda não virou Lead. Promova quando houver intenção — o histórico da conversa vai junto."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setComoFunciona(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          {podeCriar && (
            <Button variant="primary" size="sm" onClick={() => setEditando('novo')}>
              <Plus size={14} /> Novo contato
            </Button>
          )}
        </div>
      }
    >
      {/* Contadores: o acúmulo deixa de ser invisível. */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Resumo rotulo="Contatos" valor={resumo?.total} destaque />
        <Resumo rotulo="Já respondidos" valor={resumo?.respondeu} />
        <Resumo rotulo="Sem resposta" valor={resumo?.semResposta} alerta={!!resumo?.semResposta} />
        <Resumo rotulo="Grupos" valor={resumo?.grupos} />
      </div>

      {/* Filtros */}
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <form onSubmit={aplicarBusca} class="flex items-center gap-2">
          <div class="relative">
            <Search size={14} class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={busca}
              onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
              placeholder="Nome, telefone ou e-mail"
              class="pl-7 w-56"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">Buscar</Button>
          {buscaAtiva && (
            <Button variant="ghost" size="sm" onClick={() => trocarFiltro(() => { setBusca(''); setBuscaAtiva('') })}>
              <X size={12} /> Limpar
            </Button>
          )}
        </form>

        <span class="h-5 w-px bg-border mx-1" aria-hidden="true" />

        {canais.length > 1 && (
          <Select value={canal} onChange={(e) => trocarFiltro(() => setCanal((e.target as HTMLSelectElement).value))}>
            <option value="">Todos os números</option>
            {canais.map((c) => (
              <option key={c.instanceName} value={c.instanceName}>
                {c.label} ({c.contatos})
              </option>
            ))}
          </Select>
        )}

        {origens.length > 1 && (
          <Select value={origem} onChange={(e) => trocarFiltro(() => setOrigem((e.target as HTMLSelectElement).value))}>
            <option value="">Todas as origens</option>
            {origens.map((o) => (
              <option key={o.source} value={o.source}>
                {origemLabel(o.source)} ({o.contatos})
              </option>
            ))}
          </Select>
        )}

        <Select value={grupos} onChange={(e) => trocarFiltro(() => setGrupos((e.target as HTMLSelectElement).value as typeof grupos))}>
          <option value="excluir">Sem grupos</option>
          <option value="incluir">Com grupos</option>
          <option value="apenas">Só grupos</option>
        </Select>

        <Button
          variant={respondeu ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => trocarFiltro(() => setRespondeu(!respondeu))}
          title="Mostrar apenas quem a empresa já respondeu"
        >
          Já respondidos
        </Button>
      </div>

      {/* Barra de seleção */}
      {selecionadosPromoviveis.length > 0 && (
        <div class="flex items-center gap-2 rounded-md border border-border bg-accent/5 px-3 py-2 mb-3">
          <span class="text-xs text-fg flex-1">
            <strong>{selecionadosPromoviveis.length}</strong> selecionado{selecionadosPromoviveis.length > 1 ? 's' : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>Limpar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setPromover({ kind: 'bulk', leadIds: selecionadosPromoviveis.map((c) => c.id) })}
          >
            <Star size={12} /> Promover {selecionadosPromoviveis.length} a Lead
          </Button>
        </div>
      )}

      {isLoading && (
        <div class="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}

      {!isLoading && contatos.length === 0 && (
        <EmptyState
          icon={<BookUser size={24} />}
          title={buscaAtiva ? 'Nenhum contato encontrado' : 'Nenhum contato por aqui'}
          description={
            buscaAtiva
              ? 'Nenhum contato bate com essa busca.'
              : 'Contato é quem mandou mensagem e ainda não virou Lead. Quando alguém escrever pela primeira vez, aparece aqui.'
          }
        />
      )}

      {!isLoading && contatos.length > 0 && (
        <div class="rounded-md border border-border overflow-hidden">
          <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-2 text-[0.6875rem] text-fg-muted">
            <button
              type="button"
              onClick={alternarTodos}
              class="inline-flex items-center gap-1 hover:text-fg"
              disabled={promoviveis.length === 0}
            >
              {todosMarcados ? <CheckSquare size={13} class="text-accent" /> : <Square size={13} />}
              <span>{todosMarcados ? 'Desmarcar' : 'Selecionar'} os desta página</span>
            </button>
            <span class="text-fg-subtle">·</span>
            <span>{total} no total</span>
          </div>
          <ul>
            {contatos.map((c) => (
              <LinhaContato
                key={c.id}
                contato={c}
                marcado={selecionados.has(c.id)}
                onMarcar={() => alternar(c.id)}
                onAbrirConversa={() => navigate(`/conversations?leadId=${c.id}`)}
                onPromover={() => setPromover({ kind: 'single', leadId: c.id, leadName: c.nome })}
                onEditar={podeEditar ? () => setEditando(c) : undefined}
                onApagar={podeApagar ? () => setApagando(c) : undefined}
              />
            ))}
          </ul>
        </div>
      )}

      {paginas > 1 && (
        <div class="flex items-center justify-between mt-3 text-xs text-fg-muted">
          <span>Página {pagina + 1} de {paginas}</span>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={pagina === 0} onClick={() => { setPagina((p) => p - 1); setSelecionados(new Set()) }}>
              Anterior
            </Button>
            <Button variant="ghost" size="sm" disabled={pagina + 1 >= paginas} onClick={() => { setPagina((p) => p + 1); setSelecionados(new Set()) }}>
              Próxima
            </Button>
          </div>
        </div>
      )}

      <PromoteLeadDialog
        open={promover !== null}
        mode={promover}
        onOpenChange={(o) => { if (!o) setPromover(null) }}
        onDone={(r) => {
          setSelecionados(new Set())
          setPromover(null)
          toast(
            r.qualified === 1
              ? 'Contato promovido a Lead'
              : `${r.qualified} contatos promovidos a Lead`,
            'success',
          )
        }}
      />

      <ContatoFormModal
        alvo={editando}
        onClose={() => setEditando(null)}
      />

      <ConfirmDialog
        open={apagando !== null}
        onOpenChange={(o) => { if (!o) setApagando(null) }}
        title={`Apagar "${apagando?.nome ?? 'contato'}"?`}
        description={
          'O contato vai para a lixeira junto com o histórico da conversa, e pode ser restaurado de lá. '
          + 'Quem já é Lead não é apagado por aqui.'
        }
        confirmLabel="Apagar contato"
        destructive
        loading={apagar.isPending}
        onConfirm={() => {
          if (!apagando) return
          apagar.mutate(apagando.id, {
            onSuccess: (r) => {
              toast(
                r.mensagensApagadas > 0
                  ? `Contato apagado (${r.mensagensApagadas} mensagens foram junto)`
                  : 'Contato apagado',
                'success',
              )
              setApagando(null)
            },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })
        }}
      />

      <HowItWorksModal
        open={comoFunciona}
        onClose={() => setComoFunciona(false)}
        title="O que é um Contato?"
        problem={
          <>
            Quem manda mensagem vira uma ficha na hora, mas essa ficha só aparecia dentro do
            Conversas — invisível para o resto do sistema. Em algumas instalações, quatro de cada
            cinco registros estavam nessa situação, com todo o histórico guardado e fora de
            alcance. Contatos é a porta que faltava.
          </>
        }
        steps={[
          {
            title: 'Contato é o Lead antes de ser Lead',
            body: 'É a mesma ficha, num estado anterior. Por isso, ao promover, o histórico da conversa, as etiquetas e os eventos vão junto — nada é recriado nem migrado.',
          },
          {
            title: 'Só entra quem já mandou mensagem',
            body: 'Número que está na agenda do celular mas nunca escreveu não aparece aqui. É o que impede alguém sem relacionamento com a empresa de ser selecionado por engano para um disparo.',
          },
          {
            title: 'Número reservado continua reservado',
            body: 'Se você não vê uma linha no Conversas, também não vê os contatos dela nesta lista. A regra é a mesma, aplicada aos dois lugares.',
          },
          {
            title: 'Promover é opcional',
            body: 'Boa parte dos contatos nunca vai virar Lead, e está tudo bem. A lista serve também para achar uma conversa antiga e retomar sem passar pelo funil.',
          },
        ]}
        tip={{
          tone: 'info',
          title: 'Grupos não viram Lead',
          body: 'Grupo de WhatsApp não é pessoa, não tem telefone próprio e não entra em funil. Aparece na lista para consulta, sem a ação de promover.',
        }}
      />
    </Page>
  )
}

function Resumo({ rotulo, valor, destaque, alerta }: { rotulo: string; valor?: number | undefined; destaque?: boolean | undefined; alerta?: boolean | undefined }) {
  return (
    <div class={cn('rounded-md border p-3', destaque ? 'border-accent/40 bg-accent/5' : 'border-border bg-surface-2')}>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{rotulo}</div>
      <div class={cn('text-xl font-semibold tabular-nums mt-0.5', alerta ? 'text-warning' : 'text-fg')}>
        {valor == null ? '—' : valor.toLocaleString('pt-BR')}
      </div>
    </div>
  )
}

function LinhaContato({
  contato, marcado, onMarcar, onAbrirConversa, onPromover, onEditar, onApagar,
}: {
  contato: Contato
  marcado: boolean
  onMarcar: () => void
  onAbrirConversa: () => void
  onPromover: () => void
  onEditar?: (() => void) | undefined
  onApagar?: (() => void) | undefined
}) {
  const nome = contato.nome || contato.whatsapp || 'Sem nome'
  const inicial = nome.trim()[0]?.toUpperCase() ?? '?'
  return (
    <li class="group flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors">
      {contato.isGroup ? (
        <span class="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <button
          type="button"
          onClick={onMarcar}
          class="size-4 grid place-items-center text-fg-muted hover:text-fg shrink-0"
          aria-label={marcado ? 'Desmarcar' : 'Marcar'}
          aria-pressed={marcado}
        >
          {marcado ? <CheckSquare size={14} class="text-accent" /> : <Square size={14} />}
        </button>
      )}

      <span class="size-8 rounded-full bg-surface-3 grid place-items-center text-fg-muted text-xs font-semibold overflow-hidden shrink-0">
        {contato.profilePicUrl
          ? <img src={contato.profilePicUrl} alt="" class="w-full h-full object-cover" />
          : contato.isGroup ? <UsersIcon size={14} /> : inicial}
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-sm text-fg truncate">{nome}</span>
          {contato.isGroup && <Badge tone="neutral">grupo</Badge>}
          {contato.unreadMessages > 0 && <Badge tone="warning">{contato.unreadMessages}</Badge>}
        </div>
        <div class="flex items-center gap-2.5 text-xs text-fg-muted flex-wrap mt-0.5">
          {contato.whatsapp && !contato.isGroup && (
            <span class="inline-flex items-center gap-1 tabular-nums">
              <Phone size={10} class="text-fg-subtle shrink-0" /> {contato.whatsapp}
            </span>
          )}
          {contato.email && (
            <span class="inline-flex items-center gap-1 max-w-[16rem] truncate">
              <Mail size={10} class="text-fg-subtle shrink-0" /> <span class="truncate">{contato.email}</span>
            </span>
          )}
          <span class="text-fg-subtle">{origemLabel(contato.source)}</span>
          {contato.assignedUser && <span class="text-fg-subtle">· {contato.assignedUser.name}</span>}
        </div>
      </div>

      <span class="text-xs text-fg-subtle tabular-nums shrink-0 hidden sm:block">
        {quandoFoi(contato.lastMessageAt)}
      </span>

      <div class="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={onAbrirConversa} title="Abrir a conversa">
          <MessageSquare size={13} /> <span class="hidden md:inline">Conversa</span>
        </Button>
        {!contato.isGroup && (
          <Button variant="secondary" size="sm" onClick={onPromover} title="Promover a Lead">
            <Star size={13} /> <span class="hidden md:inline">Promover</span>
          </Button>
        )}
        {/* Corrigir e apagar aparecem no hover: são ações de manutenção, e um
          * botão vermelho fixo em cada linha faria a lista parecer perigosa. */}
        {onEditar && !contato.isGroup && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onEditar}
            title="Editar contato"
            aria-label="Editar contato"
            class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <Pencil size={13} />
          </Button>
        )}
        {onApagar && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onApagar}
            title="Apagar contato"
            aria-label="Apagar contato"
            class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-danger hover:text-danger"
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * Cadastro e edição no mesmo formulário: os campos são os mesmos, e manter dois
 * componentes faria a correção de um esquecer o outro.
 */
function ContatoFormModal({ alvo, onClose }: { alvo: Contato | 'novo' | null; onClose: () => void }) {
  const criando = alvo === 'novo'
  const contato = alvo && alvo !== 'novo' ? alvo : null
  const criar = useCriarContato()
  const editar = useEditarContato()

  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [empresa, setEmpresa] = useState('')

  // Recarrega os campos a cada abertura: sem isto o formulário abriria com os
  // dados do contato anterior.
  useEffect(() => {
    if (!alvo) return
    setNome(contato?.nome ?? '')
    setTelefone(contato?.whatsapp ?? '')
    setEmail(contato?.email ?? '')
    setEmpresa(contato?.empresa ?? '')
  }, [alvo])

  const salvando = criar.isPending || editar.isPending

  function salvar() {
    if (!nome.trim()) { toast('Informe o nome do contato', 'warning'); return }
    if (!telefone.replace(/\D/g, '')) { toast('Informe o telefone', 'warning'); return }

    if (criando) {
      criar.mutate(
        { nome: nome.trim(), telefone, email: email.trim(), empresa: empresa.trim() },
        {
          onSuccess: () => { toast('Contato cadastrado', 'success'); onClose() },
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        },
      )
    } else if (contato) {
      editar.mutate(
        { id: contato.id, nome: nome.trim(), telefone, email: email.trim(), empresa: empresa.trim() },
        {
          onSuccess: (r) => { toast(r.alterado ? 'Contato atualizado' : 'Nada mudou', 'success'); onClose() },
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        },
      )
    }
  }

  return (
    <Modal
      open={alvo !== null}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={criando ? 'Novo contato' : 'Editar contato'}
      description={
        criando
          ? 'Cadastre alguém que a empresa já conhece, antes de haver conversa. Ele entra como contato — não vira Lead nem entra em funil.'
          : 'O nome digitado aqui passa a valer sobre o da agenda do celular.'
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : criando ? 'Cadastrar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Campo rotulo="Nome">
          <Input value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Como a empresa chama essa pessoa" />
        </Campo>
        <Campo rotulo="Telefone (com DDD)">
          <Input value={telefone} onInput={(e) => setTelefone((e.target as HTMLInputElement).value)} placeholder="62 99999-0000" />
        </Campo>
        <Campo rotulo="E-mail" opcional>
          <Input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="pessoa@empresa.com" />
        </Campo>
        <Campo rotulo="Empresa" opcional>
          <Input value={empresa} onInput={(e) => setEmpresa((e.target as HTMLInputElement).value)} />
        </Campo>
      </div>
    </Modal>
  )
}

function Campo({ rotulo, opcional, children }: { rotulo: string; opcional?: boolean; children: ComponentChildren }) {
  return (
    <label class="block">
      <span class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">
        {rotulo}{opcional && <span class="text-fg-subtle/70 normal-case tracking-normal"> · opcional</span>}
      </span>
      <div class="mt-1">{children}</div>
    </label>
  )
}
