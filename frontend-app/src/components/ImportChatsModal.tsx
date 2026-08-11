import { useMemo, useState } from 'preact/hooks'
import { Smartphone, Users, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'

export interface ChatDoAparelho {
  remoteJid: string
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  isGroup: boolean
  naoLidas: number
  ultimaMensagemEm: string | null
  previa: string | null
  leadId: number | null
  leadNome: string | null
  mensagensNoPainel: number
  importavel: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ImportJob {
  id: number
  remoteJid: string
  telefone: string
  nome: string | null
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled'
  totalNaOrigem: number
  importadas: number
  jaExistiam: number
  midiasPendentes: number
  erro: string | null
  leadId: number | null
  lead?: { id: number; nome: string | null } | null
}

export interface ContatoDaAgenda {
  remoteJid: string
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  isGroup: boolean
  leadId: number | null
  importavel: boolean
}
export interface ResumoAgenda {
  total: number
  importaveis: number
  jaNoPainel: number
  semTelefone: number
}

type Filtro = 'todos' | 'novos' | 'existentes'

function quando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function ImportChatsModal({ open, onOpenChange }: Props) {
  const [instancia, setInstancia] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aba, setAba] = useState<'conversas' | 'agenda'>('conversas')
  const [dias, setDias] = useState(90)
  const [marcadosContatos, setMarcadosContatos] = useState<Set<string>>(new Set())
  const qc = useQueryClient()

  // Progresso: enquanto houver job rodando, recarrega sozinho. Importar milhares
  // de mensagens leva minutos e o operador precisa ver andar.
  const jobs = useQuery({
    queryKey: ['chat-import-jobs'],
    queryFn: () => api.get<{ jobs: ImportJob[] }>('/atendimento/whatsapp-chats/import'),
    enabled: open,
    refetchInterval: (q) => {
      const lista = (q.state.data as { jobs: ImportJob[] } | undefined)?.jobs ?? []
      return lista.some((j) => j.status === 'pending' || j.status === 'running') ? 2000 : false
    },
  })

  const sincronizar = useMutation({
    mutationFn: (payload: { instance: string; chats: unknown[] }) =>
      api.post<{ ok: true; jobs: { id: number }[] }>('/atendimento/whatsapp-chats/import', payload),
    onSuccess: (r) => {
      toast(`${r.jobs.length} conversa(s) na fila de sincronização`, 'success')
      setMarcados(new Set())
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const contatos = useQuery({
    queryKey: ['whatsapp-contacts', instancia],
    queryFn: () => api.get<{ contatos: ContatoDaAgenda[]; resumo: ResumoAgenda }>(
      `/atendimento/whatsapp-contacts${instancia ? `?instance=${encodeURIComponent(instancia)}` : ''}`,
    ),
    enabled: open && aba === 'agenda',
    staleTime: 60_000,
  })

  const sincronizarTudo = useMutation({
    mutationFn: (payload: { instance?: string; dias: number }) =>
      api.post<{ enfileiradas: number; totalNoAparelho: number; naoImportaveis: number; foraDoPeriodo: number; acimaDoTeto: number }>(
        '/atendimento/whatsapp-chats/import-all', payload,
      ),
    onSuccess: (r) => {
      toast(
        r.enfileiradas
          ? `${r.enfileiradas} conversa(s) na fila. Fora do período: ${r.foraDoPeriodo}. Sem telefone/grupo: ${r.naoImportaveis}.`
          : 'Nenhuma conversa no período escolhido.',
        r.enfileiradas ? 'success' : 'warning',
      )
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const importarContatos = useMutation({
    mutationFn: (payload: { contatos: { telefone: string; nome: string | null }[] }) =>
      api.post<{ criados: number; jaExistiam: number }>('/atendimento/whatsapp-contacts/import', payload),
    onSuccess: (r) => {
      toast(`${r.criados} contato(s) criado(s)${r.jaExistiam ? ` · ${r.jaExistiam} já existia(m)` : ''}`, 'success')
      setMarcadosContatos(new Set())
      void qc.invalidateQueries({ queryKey: ['whatsapp-contacts'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const emAndamento = (jobs.data?.jobs ?? []).filter((j) => j.status === 'pending' || j.status === 'running')
  const concluidos = (jobs.data?.jobs ?? []).filter((j) => j.status === 'done' || j.status === 'failed')

  const insts = useQuery({
    queryKey: ['whatsapp-instances-import'],
    queryFn: () => api.get<{ instances: { id: number; name: string; instanceName: string; phone: string | null }[] }>('/atendimento/whatsapp-instances'),
    enabled: open,
  })

  const chats = useQuery({
    queryKey: ['whatsapp-chats', instancia],
    queryFn: () => api.get<{ instance: string; chats: ChatDoAparelho[] }>(
      `/atendimento/whatsapp-chats${instancia ? `?instance=${encodeURIComponent(instancia)}` : ''}`,
    ),
    enabled: open,
    staleTime: 60_000,
  })

  const lista = chats.data?.chats ?? []

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((c) => {
      if (filtro === 'novos' && c.leadId) return false
      if (filtro === 'existentes' && !c.leadId) return false
      if (!q) return true
      return (c.nome || '').toLowerCase().includes(q) || (c.telefone || '').includes(q)
    })
  }, [lista, busca, filtro])

  const selecionaveis = filtrados.filter((c) => c.importavel)
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((c) => marcados.has(c.remoteJid))

  function alternar(jid: string) {
    const n = new Set(marcados)
    n.has(jid) ? n.delete(jid) : n.add(jid)
    setMarcados(n)
  }

  function alternarTodos() {
    if (todosMarcados) { setMarcados(new Set()); return }
    setMarcados(new Set(selecionaveis.map((c) => c.remoteJid)))
  }

  const naoImportaveis = lista.filter((c) => !c.importavel).length
  const escolhidos = lista.filter((c) => marcados.has(c.remoteJid))

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Importar conversas do celular"
      description="Conversas que já existem no WhatsApp conectado. Escolha o que trazer para o painel."
      size="full"
      unconstrained
      footer={
        <div class="flex w-full items-center justify-between gap-2">
          <span class="text-xs text-fg-muted">
            {aba === 'agenda'
              ? `${contatos.data?.resumo.importaveis ?? 0} contato(s) com telefone`
              : marcados.size > 0 ? `${marcados.size} selecionada(s)` : `${filtrados.length} conversa(s)`}
          </span>
          <div class="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button
              variant="primary"
              size="md"
              class={aba === 'agenda' ? 'hidden' : ''}
              disabled={!marcados.size || sincronizar.isPending}
              onClick={() => sincronizar.mutate({
                instance: chats.data?.instance || instancia,
                chats: escolhidos.map((c) => ({ remoteJid: c.remoteJid, telefone: c.telefone, nome: c.nome, leadId: c.leadId })),
              })}
            >
              {sincronizar.isPending ? 'Enviando…' : `Sincronizar ${marcados.size || ''}`}
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-3">
        {(emAndamento.length > 0 || concluidos.length > 0) && (
          <div class="rounded-md border border-border bg-surface-2 p-3">
            <div class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-fg-subtle">
              {emAndamento.length > 0 && <Loader2 size={12} class="animate-spin" />}
              {emAndamento.length > 0 ? `Sincronizando ${emAndamento.length}` : 'Últimas sincronizações'}
            </div>
            <ul class="max-h-40 space-y-1 overflow-y-auto text-xs">
              {[...emAndamento, ...concluidos].slice(0, 12).map((j) => (
                <li key={j.id} class="flex items-center gap-2">
                  <span class="w-40 shrink-0 truncate">{j.nome || j.telefone}</span>
                  <span class={
                    j.status === 'done' ? 'text-success'
                      : j.status === 'failed' ? 'text-danger'
                        : 'text-fg-muted'
                  }>
                    {j.status === 'done' ? 'concluída'
                      : j.status === 'failed' ? 'falhou'
                        : j.status === 'running' ? 'importando…'
                          : 'na fila'}
                  </span>
                  <span class="text-fg-subtle">
                    {j.importadas > 0 && `+${j.importadas} nova(s)`}
                    {j.jaExistiam > 0 && ` · ${j.jaExistiam} já existia(m)`}
                    {j.midiasPendentes > 0 && ` · ${j.midiasPendentes} mídia(s)`}
                  </span>
                  {j.erro && <span class="truncate text-danger" title={j.erro}>{j.erro.slice(0, 40)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div class="flex gap-1 border-b border-border">
          {(['conversas', 'agenda'] as const).map((t) => (
            <button
              key={t}
              type="button"
              class={`px-3 py-1.5 text-sm ${aba === t ? 'border-b-2 border-accent font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}
              onClick={() => setAba(t)}
            >
              {t === 'conversas' ? 'Conversas' : 'Agenda de contatos'}
            </button>
          ))}
        </div>

        {aba === 'conversas' && (
          <div class="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2 p-3">
            <div>
              <label class="mb-1 block text-xs text-fg-subtle">Sincronizar todas com atividade nos últimos</label>
              <Select value={String(dias)} onChange={(e) => setDias(Number((e.target as HTMLSelectElement).value))}>
                <option value="7">7 dias</option>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">1 ano</option>
                <option value="3650">Tudo</option>
              </Select>
            </div>
            <Button
              variant="secondary"
              size="md"
              disabled={sincronizarTudo.isPending}
              onClick={() => sincronizarTudo.mutate({ instance: instancia || undefined, dias })}
            >
              {sincronizarTudo.isPending ? 'Enfileirando…' : 'Sincronizar todas'}
            </Button>
            <p class="w-full text-xs text-fg-subtle">
              Traz o histórico de todas as conversas com mensagem no período. Grupos e contatos sem
              telefone ficam de fora, e o limite por disparo é 300 conversas.
            </p>
          </div>
        )}

        <div class={`flex flex-wrap gap-2 ${aba === 'agenda' ? 'hidden' : ''}`}>
          {(insts.data?.instances?.length ?? 0) > 1 && (
            <Select value={instancia} onChange={(e) => { setInstancia((e.target as HTMLSelectElement).value); setMarcados(new Set()) }}>
              <option value="">Número principal</option>
              {insts.data?.instances.map((i) => (
                <option key={i.instanceName} value={i.instanceName}>{i.name || i.instanceName}</option>
              ))}
            </Select>
          )}
          <div class="min-w-48 flex-1">
            <Input
              placeholder="Buscar por nome ou telefone…"
              value={busca}
              onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
            />
          </div>
          <Select value={filtro} onChange={(e) => setFiltro((e.target as HTMLSelectElement).value as Filtro)}>
            <option value="todos">Todas</option>
            <option value="novos">Só as que não estão no painel</option>
            <option value="existentes">Só as que já estão</option>
          </Select>
        </div>

        {aba === 'agenda' ? (
          contatos.isLoading ? (
            <Skeleton class="h-96 w-full" />
          ) : contatos.isError ? (
            <EmptyState icon={<AlertTriangle size={24} />} title="Não foi possível ler a agenda" description="A agenda só existe em número conectado por QR Code." />
          ) : (
            <div class="space-y-3">
              <div class="rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
                <strong class="text-fg">{contatos.data?.resumo.total ?? 0}</strong> contatos no aparelho ·{' '}
                <strong class="text-fg">{contatos.data?.resumo.importaveis ?? 0}</strong> com telefone ·{' '}
                {contatos.data?.resumo.jaNoPainel ?? 0} já no painel
                <p class="mt-1">
                  {contatos.data?.resumo.semTelefone ?? 0} contatos não têm telefone visível — o WhatsApp
                  os identifica por um código de privacidade, e sem uma conversa não há como descobrir o número.
                  Contato importado vira lead <strong>sem histórico</strong>: use quando quiser a base de
                  números, não para trazer conversa (para isso, use a aba Conversas).
                </p>
              </div>

              {(() => {
                const novos = (contatos.data?.contatos ?? []).filter((c) => c.importavel && !c.leadId)
                if (!novos.length) {
                  return <EmptyState icon={<CheckCircle2 size={24} />} title="Nada novo na agenda" description="Todos os contatos com telefone já estão no painel." />
                }
                const todosSel = novos.every((c) => marcadosContatos.has(c.remoteJid))
                return (
                  <>
                    <div class="flex items-center justify-between">
                      <label class="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={todosSel}
                          onChange={() => setMarcadosContatos(todosSel ? new Set() : new Set(novos.map((c) => c.remoteJid)))}
                        />
                        <span>Selecionar os {novos.length} contatos novos</span>
                      </label>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!marcadosContatos.size || importarContatos.isPending}
                        onClick={() => importarContatos.mutate({
                          contatos: novos.filter((c) => marcadosContatos.has(c.remoteJid)).map((c) => ({ telefone: c.telefone!, nome: c.nome })),
                        })}
                      >
                        {importarContatos.isPending ? 'Criando…' : `Criar ${marcadosContatos.size || ''} lead(s)`}
                      </Button>
                    </div>
                    <ul class="max-h-[24rem] divide-y divide-border overflow-y-auto rounded-md border border-border">
                      {novos.map((c) => (
                        <li key={c.remoteJid} class="flex items-center gap-3 px-3 py-2 hover:bg-surface-2">
                          <input
                            type="checkbox"
                            checked={marcadosContatos.has(c.remoteJid)}
                            onChange={() => {
                              const n = new Set(marcadosContatos)
                              n.has(c.remoteJid) ? n.delete(c.remoteJid) : n.add(c.remoteJid)
                              setMarcadosContatos(n)
                            }}
                          />
                          {c.fotoUrl
                            ? <img src={c.fotoUrl} alt="" class="size-8 shrink-0 rounded-full object-cover" />
                            : <div class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-fg-muted"><Smartphone size={14} /></div>}
                          <span class="min-w-0 flex-1 truncate text-sm">{c.nome || c.telefone}</span>
                          <span class="shrink-0 text-xs text-fg-subtle">{c.telefone}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              })()}
            </div>
          )
        ) : chats.isLoading ? (
          <Skeleton class="h-96 w-full" />
        ) : chats.isError ? (
          <EmptyState
            icon={<AlertTriangle size={24} />}
            title="Não foi possível ler as conversas"
            description="Confira se o número está conectado por QR Code. Números do WhatsApp Oficial (Cloud API) não têm histórico para importar."
          />
        ) : !filtrados.length ? (
          <EmptyState icon={<Smartphone size={24} />} title="Nenhuma conversa encontrada" description="Ajuste a busca ou o filtro." />
        ) : (
          <>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} />
              <span>Selecionar todas as importáveis desta lista ({selecionaveis.length})</span>
            </label>

            <ul class="max-h-[26rem] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filtrados.map((c) => (
                <li
                  key={c.remoteJid}
                  class={`flex items-center gap-3 px-3 py-2 ${c.importavel ? 'hover:bg-surface-2' : 'opacity-60'}`}
                >
                  <input
                    type="checkbox"
                    class="shrink-0"
                    disabled={!c.importavel}
                    checked={marcados.has(c.remoteJid)}
                    onChange={() => alternar(c.remoteJid)}
                  />
                  {c.fotoUrl ? (
                    <img src={c.fotoUrl} alt="" class="size-9 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-fg-muted">
                      {c.isGroup ? <Users size={16} /> : <Smartphone size={16} />}
                    </div>
                  )}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-medium">{c.nome || c.telefone || c.remoteJid.split('@')[0]}</span>
                      {c.isGroup && <span class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[0.625rem] text-fg-muted">Grupo</span>}
                      {!c.isGroup && !c.importavel && (
                        <span class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[0.625rem] text-fg-muted" title="O WhatsApp não revelou o telefone deste contato">
                          Sem telefone
                        </span>
                      )}
                    </div>
                    <div class="truncate text-xs text-fg-muted">{c.previa || '—'}</div>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="text-[0.6875rem] text-fg-subtle">{quando(c.ultimaMensagemEm)}</div>
                    {c.leadId ? (
                      <div class="flex items-center gap-1 text-[0.6875rem] text-success">
                        <CheckCircle2 size={11} /> no painel
                        {c.mensagensNoPainel > 0 && <span class="text-fg-subtle">({c.mensagensNoPainel})</span>}
                      </div>
                    ) : (
                      <div class="text-[0.6875rem] text-accent">nova</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {naoImportaveis > 0 && (
              <p class="text-xs text-fg-subtle">
                {naoImportaveis} conversa(s) não podem ser importadas: grupos, ou contatos cujo telefone
                o WhatsApp não revelou (identificador de privacidade).
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
