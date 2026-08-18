import { useMemo, useState } from 'preact/hooks'
import { MessagesSquare, Save, HelpCircle, RotateCcw, Users as UsersIcon, User as UserIcon } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useConversationAccess,
  useSaveConversationAccess,
  CANAL_QUALQUER,
  type CanalDaMatriz,
  type RegraDeAcesso,
  type RegraParaSalvar,
  type SujeitoTipo,
  type TipoConversa,
} from '@/hooks/useConversationAccess'
import { ROLE_LABELS } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'

// As quatro ações, na mesma ordem e com as mesmas cores da tela de Permissões
// por Módulo — é a mesma gramática, e trocar a ordem aqui faria o superadmin
// reaprender a ler a matriz.
const ACOES = ['canView', 'canCreate', 'canEdit', 'canDelete'] as const
type Acao = typeof ACOES[number]

const ACAO_LABEL: Record<Acao, string> = {
  canView: 'Ver',
  canCreate: 'Enviar',
  canEdit: 'Gerir',
  canDelete: 'Excluir',
}

// "Enviar" e "Gerir" em vez de "Criar" e "Editar": no Conversas o que se cria é
// mensagem e o que se edita é o andamento da conversa (assumir, transferir,
// encerrar, adormecer). Os nomes genéricos faziam o superadmin marcar errado.
const ACAO_HINT: Record<Acao, string> = {
  canView: 'Abrir a conversa e ler o histórico',
  canCreate: 'Enviar mensagem e iniciar conversa',
  canEdit: 'Assumir, transferir, encerrar, adormecer',
  canDelete: 'Excluir a conversa e apagar mensagem',
}

const ACAO_COR: Record<Acao, string> = {
  canView: 'var(--color-info)',
  canCreate: 'var(--color-success)',
  canEdit: 'var(--color-warning)',
  canDelete: 'var(--color-danger)',
}

const TIPO_LABEL: Record<TipoConversa, string> = {
  contact: 'Contatos',
  group: 'Grupos',
}

/** Chave de uma célula da matriz. */
const celula = (channelKey: string, kind: TipoConversa) => `${channelKey}|${kind}`

type Rascunho = Map<string, RegraParaSalvar>

function rascunhoDe(regras: RegraDeAcesso[]): Rascunho {
  const m: Rascunho = new Map()
  for (const r of regras) {
    m.set(celula(r.channelKey, r.kind), {
      channelKey: r.channelKey, kind: r.kind,
      canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete,
    })
  }
  return m
}

/** Só as linhas com alguma marca viram regra — o resto nem vai para o servidor. */
function paraSalvar(r: Rascunho): RegraParaSalvar[] {
  return [...r.values()].filter((x) => x.canView || x.canCreate || x.canEdit || x.canDelete)
}

function iguais(a: RegraParaSalvar[], b: RegraParaSalvar[]): boolean {
  if (a.length !== b.length) return false
  const chave = (x: RegraParaSalvar) =>
    `${x.channelKey}|${x.kind}|${+x.canView}${+x.canCreate}${+x.canEdit}${+x.canDelete}`
  const sa = a.map(chave).sort()
  const sb = b.map(chave).sort()
  return sa.every((v, i) => v === sb[i])
}

export function ConversationAccessPage() {
  const { user } = useAuth()
  const [comoFunciona, setComoFunciona] = useState(false)
  const { data, isLoading } = useConversationAccess()

  // Sujeito em edição: um papel, ou uma pessoa (exceção nominal).
  const [sujeitoTipo, setSujeitoTipo] = useState<SujeitoTipo>('role')
  const [sujeitoId, setSujeitoId] = useState<string>('MANAGER')

  const salvar = useSaveConversationAccess()

  const regrasDoSujeito = useMemo(
    () => (data?.regras ?? []).filter((r) => r.subjectType === sujeitoTipo && r.subjectId === sujeitoId),
    [data?.regras, sujeitoTipo, sujeitoId],
  )

  // Rascunho local por sujeito. A chave no `useState` inicial não basta —
  // trocar de sujeito precisa recarregar, e é o que o `key` no componente
  // filho resolve sem efeito colateral.
  return (
    <Page
      title="Acesso ao Conversas"
      description="Quem acompanha quais números, e o que pode fazer neles"
      actions={
        <Button variant="ghost" size="sm" onClick={() => setComoFunciona(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      {user?.role !== 'SUPERADMIN' ? (
        <EmptyState
          icon={<MessagesSquare size={24} />}
          title="Apenas o Super Admin gerencia o acesso ao Conversas"
          description="Esta matriz pode ampliar o alcance de um papel para além do escopo dele, então fica com quem administra a instalação."
        />
      ) : isLoading || !data ? (
        <div class="space-y-4">
          <Skeleton class="h-20 w-full" />
          <Skeleton class="h-96 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <div class="flex flex-wrap items-end gap-3">
              <div class="min-w-[180px]">
                <label class="block text-xs text-fg-subtle mb-1">Configurar para</label>
                <Select
                  value={sujeitoTipo}
                  onChange={(e) => {
                    const t = (e.target as HTMLSelectElement).value as SujeitoTipo
                    setSujeitoTipo(t)
                    setSujeitoId(t === 'role' ? 'MANAGER' : String(data.usuarios[0]?.id ?? ''))
                  }}
                >
                  <option value="role">Um papel</option>
                  <option value="user">Uma pessoa (exceção)</option>
                </Select>
              </div>
              <div class="min-w-[220px]">
                <label class="block text-xs text-fg-subtle mb-1">
                  {sujeitoTipo === 'role' ? 'Papel' : 'Pessoa'}
                </label>
                <Select value={sujeitoId} onChange={(e) => setSujeitoId((e.target as HTMLSelectElement).value)}>
                  {sujeitoTipo === 'role'
                    ? data.papeis.map((p) => (
                        <option key={p} value={p}>
                          {ROLE_LABELS[p] ?? p}
                          {data.configurados.roles.includes(p) ? ' • configurado' : ''}
                        </option>
                      ))
                    : data.usuarios.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.name || u.email} ({ROLE_LABELS[u.role] ?? u.role})
                          {data.configurados.users.includes(u.id) ? ' • configurado' : ''}
                        </option>
                      ))}
                </Select>
              </div>
              <div class="flex items-center gap-2 pb-1">
                {sujeitoTipo === 'role'
                  ? <Badge tone="neutral"><UsersIcon size={12} /> vale para todos deste papel</Badge>
                  : <Badge tone="warning"><UserIcon size={12} /> substitui as regras do papel</Badge>}
              </div>
            </div>

            <p class="mt-3 text-sm text-fg-subtle">
              {regrasDoSujeito.length === 0 ? (
                <>
                  <strong>Nada configurado.</strong> Este sujeito segue exatamente o comportamento
                  atual do sistema — escopo do papel (só meus / meu setor / todos) e números
                  reservados. Marcar qualquer caixa abaixo passa a comandá-lo por aqui.
                </>
              ) : (
                <>
                  <strong>Regido por esta matriz.</strong> O escopo do papel e a reserva de números
                  não valem para ele: o que está marcado abaixo é o que vale.
                </>
              )}
            </p>
          </Card>

          <MatrizDoSujeito
            key={`${sujeitoTipo}:${sujeitoId}`}
            canais={data.canais}
            regras={regrasDoSujeito}
            salvando={salvar.isPending}
            onSalvar={async (rules) => {
              try {
                const r = await salvar.mutateAsync({ subjectType: sujeitoTipo, subjectId: sujeitoId, rules })
                toast(
                  r.configurado
                    ? `Acesso salvo — ${r.rules} ${r.rules === 1 ? 'regra ativa' : 'regras ativas'}.`
                    : 'Regras removidas. Voltou ao comportamento padrão do sistema.',
                  'success',
                )
              } catch (e) {
                toast(e instanceof ApiError ? e.message : 'Falha ao salvar o acesso', 'danger')
              }
            }}
          />
        </>
      )}

      <HowItWorksModal
        open={comoFunciona}
        onClose={() => setComoFunciona(false)}
        title="Como funciona o acesso ao Conversas?"
        problem={<>
          Quem vê o quê no Conversas era decidido em três lugares que não conversam entre si: a
          permissão do <strong>módulo</strong>, o <strong>escopo</strong> do papel (só meus / meu
          setor / todos) e a <strong>reserva</strong> de cada número. Nenhum deles responde ao
          pedido que o cliente faz em voz alta — "o gestor acompanha os grupos da recepção, e só
          isso". Aqui a pergunta é feita direto.
        </>}
        steps={[
          {
            title: '🈳 Vazio significa "como está hoje"',
            body: <>Papel sem nenhuma marca continua funcionando pelo escopo dele e pelos números reservados, exatamente como antes. Nada nesta tela muda a instalação enquanto você não marcar a primeira caixa.</>,
          },
          {
            title: '📱 Uma linha por número, duas colunas por linha',
            body: <>Cada número aparece como uma linha, dividida em <strong>Contatos</strong> e <strong>Grupos</strong> — porque quase sempre a resposta é diferente para os dois. "Todos os canais" é a linha coringa, e é a única que cobre Instagram, Messenger e conversa que ainda não tem número.</>,
          },
          {
            title: '✅ Marcou, mandou',
            body: <>Dentro de um número marcado o alcance por dono e por setor <strong>não se aplica</strong>: a pessoa vê todas as conversas daquele número. É isso que resolve o grupo que ninguém do setor dono atende.</>,
          },
          {
            title: '🔓 A reserva do número sai de cena',
            body: <>Para quem é regido por esta matriz, a marca de "número reservado" deixa de valer — senão a regra mais restritiva venceria sempre e a marcação não serviria para nada. Quem você marcar aqui vê o que marcou, inclusive de uma linha reservada.</>,
          },
          {
            title: '👤 Exceção por pessoa vence o papel',
            body: <>Se alguém tem regras próprias, elas substituem <strong>inteiras</strong> as do papel — não se somam. Use com parcimônia: duas fontes para a mesma pergunta é o que torna permissão difícil de auditar.</>,
          },
          {
            title: '↩️ Para voltar atrás, desmarque tudo',
            body: <>Salvar com todas as caixas vazias apaga as regras do sujeito e o devolve ao comportamento padrão. Não há botão especial — desmarcar é o caminho.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 "Ver" é a base de tudo',
          body: <>Enviar, gerir e excluir só ficam disponíveis onde há "Ver" — toda ação começa por abrir a conversa. Desmarcar "Ver" apaga as outras três da linha.</>,
        }}
      />
    </Page>
  )
}

// ── A matriz ──────────────────────────────────────────────────────────────

function MatrizDoSujeito({ canais, regras, salvando, onSalvar }: {
  canais: CanalDaMatriz[]
  regras: RegraDeAcesso[]
  salvando: boolean
  onSalvar: (rules: RegraParaSalvar[]) => void
}) {
  const original = useMemo(() => paraSalvar(rascunhoDe(regras)), [regras])
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(regras))

  const atual = paraSalvar(rascunho)
  const mudou = !iguais(atual, original)

  function ler(channelKey: string, kind: TipoConversa): RegraParaSalvar {
    return rascunho.get(celula(channelKey, kind)) ?? {
      channelKey, kind, canView: false, canCreate: false, canEdit: false, canDelete: false,
    }
  }

  function marcar(channelKey: string, kind: TipoConversa, acao: Acao, valor: boolean) {
    setRascunho((antes) => {
      const proximo = new Map(antes)
      const linha = { ...ler(channelKey, kind), [acao]: valor }
      // Ver é a base: sem ele nenhuma das outras três descreve algo possível,
      // já que toda ação começa por abrir a conversa. Desmarcar Ver limpa a
      // linha; marcar qualquer outra liga o Ver junto.
      if (acao === 'canView' && !valor) {
        linha.canCreate = false; linha.canEdit = false; linha.canDelete = false
      } else if (acao !== 'canView' && valor) {
        linha.canView = true
      }
      proximo.set(celula(channelKey, kind), linha)
      return proximo
    })
  }

  /** Liga/desliga a linha inteira de um canal+tipo. */
  function alternarTudo(channelKey: string, kind: TipoConversa) {
    const linha = ler(channelKey, kind)
    const ligado = linha.canView && linha.canCreate && linha.canEdit && linha.canDelete
    setRascunho((antes) => {
      const proximo = new Map(antes)
      proximo.set(celula(channelKey, kind), {
        channelKey, kind,
        canView: !ligado, canCreate: !ligado, canEdit: !ligado, canDelete: !ligado,
      })
      return proximo
    })
  }

  return (
    <Card class="mt-4">
      <CardHeader>
        <CardTitle>Números e tipos de conversa</CardTitle>
        <div class="flex items-center gap-2">
          {mudou && (
            <Button variant="ghost" size="sm" onClick={() => setRascunho(rascunhoDe(regras))}>
              <RotateCcw size={14} /> Descartar
            </Button>
          )}
          <Button size="sm" disabled={!mudou || salvando} onClick={() => onSalvar(atual)}>
            <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </CardHeader>

      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="border-b border-border">
              <th class="text-left py-2 pr-3 font-medium min-w-[200px]">Número</th>
              <th class="text-left py-2 px-3 font-medium">Tipo</th>
              {ACOES.map((a) => (
                <th key={a} class="py-2 px-2 font-medium text-center min-w-[74px]">
                  <div>{ACAO_LABEL[a]}</div>
                  <div class="text-[10px] font-normal text-fg-subtle leading-tight mt-0.5">
                    {ACAO_HINT[a]}
                  </div>
                </th>
              ))}
              <th class="py-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {canais.map((c) => (
              (['contact', 'group'] as TipoConversa[]).map((kind, i) => {
                const linha = ler(c.key, kind)
                // Grupo em canal que não recebe grupo não é uma escolha real:
                // a Cloud API oficial não entrega grupos e a instância com o
                // toggle desligado descarta na entrada. Marcar ali seria uma
                // permissão que nunca vale para nada.
                const indisponivel = kind === 'group' && !c.recebeGrupos
                return (
                  <tr
                    key={`${c.key}-${kind}`}
                    class={`border-b border-border/50 ${indisponivel ? 'opacity-45' : ''}`}
                  >
                    {i === 0 && (
                      <td class="py-2 pr-3 align-top" rowSpan={2}>
                        <div class="flex items-center gap-2">
                          {c.color && (
                            <span
                              class="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ background: c.color }}
                            />
                          )}
                          <span class="font-medium">{c.label}</span>
                        </div>
                        {c.number && <div class="text-xs text-fg-subtle">{c.number}</div>}
                        {c.hint && <div class="text-xs text-fg-subtle italic mt-0.5">{c.hint}</div>}
                        {c.key === CANAL_QUALQUER && (
                          <Badge tone="neutral" class="mt-1">coringa</Badge>
                        )}
                      </td>
                    )}
                    <td class="py-2 px-3 whitespace-nowrap">
                      {TIPO_LABEL[kind]}
                      {indisponivel && (
                        <div class="text-[10px] text-fg-subtle leading-tight">não recebe grupos</div>
                      )}
                    </td>
                    {ACOES.map((a) => (
                      <td key={a} class="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={linha[a]}
                          disabled={indisponivel}
                          onChange={(e) => marcar(c.key, kind, a, (e.target as HTMLInputElement).checked)}
                          class={indisponivel ? '' : 'cursor-pointer'}
                          style={{ width: '18px', height: '18px', accentColor: ACAO_COR[a] }}
                          aria-label={`${ACAO_LABEL[a]} — ${TIPO_LABEL[kind]} de ${c.label}`}
                        />
                      </td>
                    ))}
                    <td class="py-2 pl-2 text-right">
                      {!indisponivel && (
                        <button
                          type="button"
                          class="text-xs text-fg-subtle hover:text-fg underline underline-offset-2"
                          onClick={() => alternarTudo(c.key, kind)}
                        >
                          {linha.canView && linha.canCreate && linha.canEdit && linha.canDelete
                            ? 'limpar'
                            : 'tudo'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            ))}
          </tbody>
        </table>
      </div>

      {atual.length === 0 && (
        <p class="mt-3 text-sm text-fg-subtle">
          Sem nenhuma marca, salvar apaga as regras deste sujeito e o devolve ao comportamento
          padrão do sistema.
        </p>
      )}
    </Card>
  )
}
