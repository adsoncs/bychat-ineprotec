import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Smartphone, Users, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Search, X,
  BookUser, MessagesSquare, Ban, Trash2, ChevronDown, Download, CircleSlash,
} from '@/components/ui/icon-set'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'

/**
 * Importar histórico e agenda do celular conectado.
 *
 * A versão anterior tinha dois problemas de fundo:
 *
 *  1. Escala. O painel obrigava a marcar conversa por conversa e o servidor
 *     recusava lotes acima de 100 (conversas) e 500 (contatos). Quem tinha 1.200
 *     contatos precisava repetir a seleção manualmente, três vezes. Agora a
 *     seleção é resolvida no SERVIDOR — "sincronizar tudo que está no filtro" e
 *     "importar a agenda inteira" são um clique, com o recorte explícito na tela.
 *
 *  2. Leitura. A lista misturava o que já veio, o que nunca veio e o que não
 *     pode vir, sem dizer qual é qual. Agora cada conversa carrega sua situação
 *     (nova / já no painel / sincronizada em tal dia / na fila), o resumo do
 *     topo funciona como filtro, e o que já foi sincronizado sai da lista por
 *     padrão — que é o que o operador espera de uma fila de trabalho.
 */

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
  sincronizadoEm: string | null
  sincronizacaoStatus: 'pending' | 'running' | 'done' | 'failed' | 'canceled' | null
  ultimaImportacao: number
}

export interface ResumoChats {
  total: number
  importaveis: number
  novos: number
  jaNoPainel: number
  sincronizados: number
  naoSincronizados: number
  grupos: number
  semTelefone: number
  emFila: number
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

interface FilaResumo {
  naFila: number
  rodando: number
  concluidos: number
  falharam: number
  cancelados: number
  mensagensImportadas: number
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

/** Recortes da lista de conversas. Cada um responde a uma pergunta real. */
type Situacao =
  | 'pendentes'   // ainda não trazidas — o trabalho do dia
  | 'todas'
  | 'novas'       // sem lead no painel
  | 'no-painel'
  | 'sincronizadas'
  | 'nao-importaveis'

type Ordem = 'recentes' | 'antigas' | 'nome' | 'nao-lidas'

const SITUACOES: Array<{ v: Situacao; rotulo: string }> = [
  { v: 'pendentes', rotulo: 'A sincronizar' },
  { v: 'todas', rotulo: 'Todas' },
  { v: 'novas', rotulo: 'Sem lead no painel' },
  { v: 'no-painel', rotulo: 'Já têm lead' },
  { v: 'sincronizadas', rotulo: 'Já sincronizadas' },
  { v: 'nao-importaveis', rotulo: 'Sem telefone' },
]

/** Quantos itens vão ao DOM de uma vez. Milhares de linhas travam o modal. */
const PAGINA = 200

function quando(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date()
  if (d.toDateString() === hoje.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function diasAtras(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export function ImportChatsModal({ open, onOpenChange }: Props) {
  const [instancia, setInstancia] = useState('')
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<Situacao>('pendentes')
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const [dias, setDias] = useState(90)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aba, setAba] = useState<'conversas' | 'agenda'>('conversas')
  const [marcadosContatos, setMarcadosContatos] = useState<Set<string>>(new Set())
  const [buscaContatos, setBuscaContatos] = useState('')
  const [limite, setLimite] = useState(PAGINA)
  const [filaAberta, setFilaAberta] = useState(false)
  const qc = useQueryClient()

  // Trocar de recorte reinicia a paginação: senão a lista abre no meio.
  useEffect(() => { setLimite(PAGINA) }, [situacao, busca, dias, instancia, ordem])

  // ── Consultas ────────────────────────────────────────────────────────────

  const insts = useQuery({
    queryKey: ['whatsapp-instances-import'],
    queryFn: () => api.get<{ instances: { id: number; name: string; instanceName: string; phone: string | null }[] }>('/atendimento/whatsapp-instances'),
    enabled: open,
  })

  const chats = useQuery({
    queryKey: ['whatsapp-chats', instancia],
    queryFn: () => api.get<{ instance: string; chats: ChatDoAparelho[]; resumo: ResumoChats }>(
      `/atendimento/whatsapp-chats${instancia ? `?instance=${encodeURIComponent(instancia)}` : ''}`,
    ),
    enabled: open,
    staleTime: 60_000,
  })

  const contatos = useQuery({
    queryKey: ['whatsapp-contacts', instancia],
    queryFn: () => api.get<{ contatos: ContatoDaAgenda[]; resumo: ResumoAgenda }>(
      `/atendimento/whatsapp-contacts${instancia ? `?instance=${encodeURIComponent(instancia)}` : ''}`,
    ),
    enabled: open && aba === 'agenda',
    staleTime: 60_000,
  })

  // Progresso: enquanto houver job rodando, recarrega sozinho. Importar milhares
  // de mensagens leva minutos e o operador precisa ver andar.
  const jobs = useQuery({
    queryKey: ['chat-import-jobs'],
    queryFn: () => api.get<{ jobs: ImportJob[]; fila: FilaResumo }>('/atendimento/whatsapp-chats/import'),
    enabled: open,
    refetchInterval: (q) => {
      const f = (q.state.data as { fila?: FilaResumo } | undefined)?.fila
      return f && (f.naFila > 0 || f.rodando > 0) ? 2000 : false
    },
  })

  const fila = jobs.data?.fila
  const trabalhando = !!fila && (fila.naFila > 0 || fila.rodando > 0)

  // Terminou a fila → a lista precisa refletir o que já foi sincronizado.
  const [estavaTrabalhando, setEstavaTrabalhando] = useState(false)
  useEffect(() => {
    if (trabalhando) { setEstavaTrabalhando(true); return }
    if (estavaTrabalhando) {
      setEstavaTrabalhando(false)
      void qc.invalidateQueries({ queryKey: ['whatsapp-chats'] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    }
  }, [trabalhando])

  // ── Ações ────────────────────────────────────────────────────────────────

  const sincronizar = useMutation({
    mutationFn: (payload: { instance: string; chats: unknown[] }) =>
      api.post<{ ok: true; enfileiradas: number; jaEstavamNaFila: number }>('/atendimento/whatsapp-chats/import', payload),
    onSuccess: (r) => {
      toast(
        r.enfileiradas
          ? `${r.enfileiradas} conversa(s) na fila${r.jaEstavamNaFila ? ` · ${r.jaEstavamNaFila} já estavam` : ''}`
          : 'Estas conversas já estavam na fila.',
        r.enfileiradas ? 'success' : 'warning',
      )
      setMarcados(new Set())
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
      setFilaAberta(true)
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const sincronizarTudo = useMutation({
    mutationFn: (payload: { instance?: string | undefined; dias: number; somenteNovas?: boolean; somenteComLead?: boolean; incluirSincronizadas?: boolean; busca?: string | undefined }) =>
      api.post<{
        enfileiradas: number; jaEstavamNaFila: number; totalNoAparelho: number
        naoImportaveis: number; foraDoPeriodo: number; jaSincronizadas: number; acimaDoTeto: number
      }>('/atendimento/whatsapp-chats/import-all', payload),
    onSuccess: (r) => {
      const detalhes = [
        r.jaEstavamNaFila ? `${r.jaEstavamNaFila} já estavam na fila` : '',
        r.jaSincronizadas ? `${r.jaSincronizadas} já sincronizadas antes` : '',
        r.foraDoPeriodo ? `${r.foraDoPeriodo} fora do período` : '',
        r.naoImportaveis ? `${r.naoImportaveis} sem telefone` : '',
        r.acimaDoTeto ? `${r.acimaDoTeto} acima do teto de 5.000` : '',
      ].filter(Boolean).join(' · ')
      toast(
        r.enfileiradas
          ? `${r.enfileiradas} conversa(s) na fila${detalhes ? `. ${detalhes}` : ''}`
          : `Nada novo para sincronizar${detalhes ? `. ${detalhes}` : ''}`,
        r.enfileiradas ? 'success' : 'warning',
      )
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
      setFilaAberta(true)
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const importarContatos = useMutation({
    mutationFn: (payload: { contatos?: { telefone: string; nome: string | null }[]; todos?: boolean; instance?: string | undefined; busca?: string | undefined }) =>
      api.post<{ criados: number; jaExistiam: number; ignorados: number }>('/atendimento/whatsapp-contacts/import', payload),
    onSuccess: (r) => {
      toast(
        r.criados
          ? `${r.criados} lead(s) criado(s)${r.jaExistiam ? ` · ${r.jaExistiam} já existia(m)` : ''}`
          : 'Nenhum contato novo — todos já estavam no painel.',
        r.criados ? 'success' : 'warning',
      )
      setMarcadosContatos(new Set())
      void qc.invalidateQueries({ queryKey: ['whatsapp-contacts'] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const cancelarTudo = useMutation({
    mutationFn: () => api.post<{ cancelados: number }>('/atendimento/whatsapp-chats/import/cancelar-tudo'),
    onSuccess: (r) => {
      toast(`${r.cancelados} sincronização(ões) cancelada(s)`, 'success')
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const limparHistorico = useMutation({
    mutationFn: () => api.delete<{ removidos: number }>('/atendimento/whatsapp-chats/import/historico'),
    onSuccess: (r) => {
      toast(`${r.removidos} registro(s) removido(s) do histórico`, 'success')
      void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
      void qc.invalidateQueries({ queryKey: ['whatsapp-chats'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  const cancelarUm = useMutation({
    mutationFn: (id: number) => api.delete(`/atendimento/whatsapp-chats/import/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] }),
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  // ── Recorte da lista ─────────────────────────────────────────────────────

  const lista = chats.data?.chats ?? []
  const resumo = chats.data?.resumo

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const corte = Date.now() - dias * 86_400_000
    const saida = lista.filter((c) => {
      switch (situacao) {
        case 'pendentes': if (!c.importavel || c.sincronizadoEm) return false; break
        case 'novas': if (!c.importavel || c.leadId) return false; break
        case 'no-painel': if (!c.leadId) return false; break
        case 'sincronizadas': if (!c.sincronizadoEm) return false; break
        case 'nao-importaveis': if (c.importavel) return false; break
        case 'todas': break
      }
      // O período só vale onde há data; conversa sem data nunca é escondida.
      if (dias < 3650 && c.ultimaMensagemEm && new Date(c.ultimaMensagemEm).getTime() < corte) return false
      if (!q) return true
      return (c.nome || '').toLowerCase().includes(q)
        || (c.telefone || '').includes(q)
        || (c.leadNome || '').toLowerCase().includes(q)
    })

    const cmp: Record<Ordem, (a: ChatDoAparelho, b: ChatDoAparelho) => number> = {
      recentes: (a, b) => (b.ultimaMensagemEm || '').localeCompare(a.ultimaMensagemEm || ''),
      antigas: (a, b) => (a.ultimaMensagemEm || '').localeCompare(b.ultimaMensagemEm || ''),
      nome: (a, b) => (a.nome || a.telefone || '').localeCompare(b.nome || b.telefone || '', 'pt-BR'),
      'nao-lidas': (a, b) => b.naoLidas - a.naoLidas || (b.ultimaMensagemEm || '').localeCompare(a.ultimaMensagemEm || ''),
    }
    return [...saida].sort(cmp[ordem])
  }, [lista, busca, situacao, dias, ordem])

  const selecionaveis = useMemo(() => filtrados.filter((c) => c.importavel), [filtrados])
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((c) => marcados.has(c.remoteJid))
  const escolhidos = useMemo(() => lista.filter((c) => marcados.has(c.remoteJid)), [lista, marcados])
  const visiveis = filtrados.slice(0, limite)

  function alternar(jid: string) {
    const n = new Set(marcados)
    n.has(jid) ? n.delete(jid) : n.add(jid)
    setMarcados(n)
  }

  // Marca TODAS as do recorte, não só as que estão na tela — é justamente o que
  // faltava: a seleção acompanha o filtro, não a rolagem.
  function alternarTodos() {
    if (todosMarcados) { setMarcados(new Set()); return }
    setMarcados(new Set(selecionaveis.map((c) => c.remoteJid)))
  }

  // ── Agenda ───────────────────────────────────────────────────────────────

  const listaContatos = contatos.data?.contatos ?? []
  const contatosNovos = useMemo(() => {
    const q = buscaContatos.trim().toLowerCase()
    return listaContatos
      .filter((c) => c.importavel && !c.leadId)
      .filter((c) => !q || (c.nome || '').toLowerCase().includes(q) || (c.telefone || '').includes(q))
  }, [listaContatos, buscaContatos])
  const contatosVisiveis = contatosNovos.slice(0, limite)
  const todosContatosMarcados = contatosNovos.length > 0 && contatosNovos.every((c) => marcadosContatos.has(c.remoteJid))

  const carregando = aba === 'conversas' ? chats.isLoading : contatos.isLoading

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Importar do celular"
      description="Histórico e agenda do WhatsApp conectado por QR Code. Escolha o recorte e traga tudo de uma vez."
      size="full"
      unconstrained
      footer={
        <div class="flex w-full flex-wrap items-center justify-between gap-2">
          <span class="text-xs text-fg-muted">
            {aba === 'agenda'
              ? `${contatosNovos.length} contato(s) novo(s) no recorte${marcadosContatos.size ? ` · ${marcadosContatos.size} marcado(s)` : ''}`
              : `${filtrados.length} conversa(s) no recorte${marcados.size ? ` · ${marcados.size} marcada(s)` : ''}`}
          </span>
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>Fechar</Button>
            {aba === 'conversas' ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={sincronizarTudo.isPending || !selecionaveis.length}
                  title="Enfileira todas as conversas do recorte atual, sem precisar marcar uma a uma"
                  onClick={() => sincronizarTudo.mutate({
                    // O recorte da tela vira o recorte do servidor: o botão só
                    // pode enfileirar o que o número ao lado dele promete.
                    instance: instancia || undefined,
                    dias,
                    somenteNovas: situacao === 'novas',
                    somenteComLead: situacao === 'no-painel',
                    incluirSincronizadas: situacao === 'sincronizadas' || situacao === 'todas' || situacao === 'no-painel',
                    busca: busca.trim() || undefined,
                  })}
                >
                  {sincronizarTudo.isPending
                    ? <><Loader2 size={13} class="animate-spin" /> Enfileirando…</>
                    : <><Download size={13} /> Sincronizar todas ({selecionaveis.length})</>}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={!marcados.size || sincronizar.isPending}
                  onClick={() => sincronizar.mutate({
                    instance: chats.data?.instance || instancia,
                    chats: escolhidos.map((c) => ({ remoteJid: c.remoteJid, telefone: c.telefone, nome: c.nome, leadId: c.leadId })),
                  })}
                >
                  {sincronizar.isPending ? 'Enviando…' : `Sincronizar ${marcados.size || 'marcadas'}`}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={importarContatos.isPending || !contatosNovos.length}
                  title="Cria lead para todos os contatos novos do recorte, sem teto de seleção"
                  onClick={() => importarContatos.mutate({
                    todos: true,
                    instance: instancia || undefined,
                    busca: buscaContatos.trim() || undefined,
                  })}
                >
                  {importarContatos.isPending
                    ? <><Loader2 size={13} class="animate-spin" /> Criando…</>
                    : <><Download size={13} /> Importar todos ({contatosNovos.length})</>}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={!marcadosContatos.size || importarContatos.isPending}
                  onClick={() => importarContatos.mutate({
                    contatos: contatosNovos
                      .filter((c) => marcadosContatos.has(c.remoteJid))
                      .map((c) => ({ telefone: c.telefone!, nome: c.nome })),
                  })}
                >
                  {`Criar ${marcadosContatos.size || ''} lead(s)`}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div class="flex h-full min-h-0 flex-col gap-3">
        {/* ── Fila de sincronização ───────────────────────────────────────── */}
        {!!fila && (fila.naFila + fila.rodando + fila.concluidos + fila.falharam) > 0 && (
          <div class="rounded-md border border-border bg-surface-2">
            <div class="flex flex-wrap items-center gap-2 p-2.5">
              {trabalhando
                ? <Loader2 size={14} class="shrink-0 animate-spin text-accent" />
                : <CheckCircle2 size={14} class="shrink-0 text-success" />}
              <span class="text-xs font-medium text-fg">
                {trabalhando
                  ? `Sincronizando — ${fila.rodando} em curso, ${fila.naFila} na fila`
                  : 'Fila vazia'}
              </span>
              <span class="text-xs text-fg-muted">
                {fila.concluidos > 0 && `${fila.concluidos} concluída(s)`}
                {fila.mensagensImportadas > 0 && ` · ${fila.mensagensImportadas.toLocaleString('pt-BR')} mensagem(ns) trazida(s)`}
                {fila.falharam > 0 && ` · ${fila.falharam} com falha`}
              </span>
              <div class="ml-auto flex items-center gap-1.5">
                {trabalhando && (
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-danger hover:bg-surface-3 disabled:opacity-50"
                    disabled={cancelarTudo.isPending}
                    onClick={() => cancelarTudo.mutate()}
                  >
                    <Ban size={11} /> Parar tudo
                  </button>
                )}
                {!trabalhando && (fila.concluidos + fila.falharam + fila.cancelados) > 0 && (
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-3 disabled:opacity-50"
                    disabled={limparHistorico.isPending}
                    title="Some com o histórico das sincronizações já terminadas"
                    onClick={() => limparHistorico.mutate()}
                  >
                    <Trash2 size={11} /> Limpar histórico
                  </button>
                )}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-3"
                  onClick={() => setFilaAberta((v) => !v)}
                >
                  {filaAberta ? 'Ocultar' : 'Detalhes'}
                  <ChevronDown size={11} class={filaAberta ? 'rotate-180' : ''} />
                </button>
              </div>
            </div>

            {filaAberta && (
              <ul class="max-h-44 divide-y divide-border overflow-y-auto border-t border-border text-xs">
                {(jobs.data?.jobs ?? []).map((j) => {
                  const lidas = j.importadas + j.jaExistiam
                  const pct = j.totalNaOrigem ? Math.min(100, Math.round((lidas / j.totalNaOrigem) * 100)) : 0
                  return (
                    <li key={j.id} class="flex items-center gap-2 px-2.5 py-1.5">
                      <span class="w-44 shrink-0 truncate">{j.nome || j.telefone}</span>
                      <span class={
                        j.status === 'done' ? 'w-24 shrink-0 text-success'
                          : j.status === 'failed' ? 'w-24 shrink-0 text-danger'
                            : j.status === 'canceled' ? 'w-24 shrink-0 text-fg-muted'
                              : 'w-24 shrink-0 text-fg-muted'
                      }>
                        {j.status === 'done' ? 'concluída'
                          : j.status === 'failed' ? 'falhou'
                            : j.status === 'canceled' ? 'cancelada'
                              : j.status === 'running' ? 'importando…'
                                : 'na fila'}
                      </span>
                      {(j.status === 'running' || j.status === 'pending') && (
                        <div class="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3">
                          <div class="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(pct, 3)}%` }} />
                        </div>
                      )}
                      <span class="min-w-0 flex-1 truncate text-fg-muted">
                        {j.importadas > 0 && `+${j.importadas} nova(s)`}
                        {j.jaExistiam > 0 && ` · ${j.jaExistiam} já existia(m)`}
                        {j.midiasPendentes > 0 && ` · ${j.midiasPendentes} mídia(s)`}
                        {j.erro && ` · ${j.erro.slice(0, 60)}`}
                      </span>
                      {(j.status === 'pending' || j.status === 'running') && (
                        <button
                          type="button"
                          class="shrink-0 rounded p-1 text-fg-muted hover:bg-surface-3 hover:text-danger"
                          title="Cancelar esta conversa"
                          onClick={() => cancelarUm.mutate(j.id)}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── Abas ────────────────────────────────────────────────────────── */}
        <div class="flex items-center gap-1 border-b border-border">
          {([
            { v: 'conversas' as const, rotulo: 'Conversas', icone: <MessagesSquare size={13} />, n: resumo?.total },
            { v: 'agenda' as const, rotulo: 'Agenda de contatos', icone: <BookUser size={13} />, n: contatos.data?.resumo.total },
          ]).map((t) => (
            <button
              key={t.v}
              type="button"
              class={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${aba === t.v ? 'border-b-2 border-accent font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}
              onClick={() => { setAba(t.v); setLimite(PAGINA) }}
            >
              {t.icone}{t.rotulo}
              {typeof t.n === 'number' && <span class="text-xs text-fg-muted">({t.n})</span>}
            </button>
          ))}
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-3"
            title="Consulta o aparelho agora e traz a lista atualizada. Nada é importado neste passo — só depois de você escolher."
            onClick={() => {
              void qc.invalidateQueries({ queryKey: aba === 'agenda' ? ['whatsapp-contacts'] : ['whatsapp-chats'] })
            }}
          >
            <RefreshCw size={11} class={carregando ? 'animate-spin' : ''} /> {carregando ? 'Consultando o aparelho…' : 'Atualizar do aparelho'}
          </button>
        </div>

        {aba === 'conversas' ? (
          <>
            {/* ── Resumo clicável: cada número é um filtro ───────────────── */}
            {resumo && (
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Cartao rotulo="No aparelho" valor={resumo.total} ativo={situacao === 'todas'} onClick={() => setSituacao('todas')} />
                <Cartao rotulo="A sincronizar" valor={resumo.naoSincronizados} tom="accent" ativo={situacao === 'pendentes'} onClick={() => setSituacao('pendentes')} />
                <Cartao rotulo="Sem lead no painel" valor={resumo.novos} ativo={situacao === 'novas'} onClick={() => setSituacao('novas')} />
                <Cartao rotulo="Já têm lead" valor={resumo.jaNoPainel} ativo={situacao === 'no-painel'} onClick={() => setSituacao('no-painel')} />
                <Cartao rotulo="Já sincronizadas" valor={resumo.sincronizados} tom="success" ativo={situacao === 'sincronizadas'} onClick={() => setSituacao('sincronizadas')} />
                <Cartao rotulo="Sem telefone" valor={resumo.semTelefone} tom="muted" ativo={situacao === 'nao-importaveis'} onClick={() => setSituacao('nao-importaveis')} />
              </div>
            )}

            {/* ── Filtros ────────────────────────────────────────────────── */}
            <div class="flex flex-wrap items-center gap-2">
              {(insts.data?.instances?.length ?? 0) > 1 && (
                <Select
                  value={instancia}
                  onChange={(e) => { setInstancia((e.target as HTMLSelectElement).value); setMarcados(new Set()) }}
                  title="Número conectado"
                >
                  <option value="">Número principal</option>
                  {insts.data?.instances.map((i) => (
                    <option key={i.instanceName} value={i.instanceName}>{i.name || i.instanceName}</option>
                  ))}
                </Select>
              )}
              <div class="relative min-w-48 flex-1">
                <Search size={13} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                <Input
                  class="pl-8"
                  placeholder="Buscar por nome, telefone ou lead…"
                  value={busca}
                  onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
                />
              </div>
              <Select value={situacao} onChange={(e) => setSituacao((e.target as HTMLSelectElement).value as Situacao)}>
                {SITUACOES.map((s) => <option key={s.v} value={s.v}>{s.rotulo}</option>)}
              </Select>
              <Select value={String(dias)} onChange={(e) => setDias(Number((e.target as HTMLSelectElement).value))} title="Recorte por última mensagem">
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="365">Último ano</option>
                <option value="3650">Qualquer data</option>
              </Select>
              <Select value={ordem} onChange={(e) => setOrdem((e.target as HTMLSelectElement).value as Ordem)} title="Ordenação">
                <option value="recentes">Mais recentes</option>
                <option value="antigas">Mais antigas</option>
                <option value="nome">Nome (A-Z)</option>
                <option value="nao-lidas">Não lidas primeiro</option>
              </Select>
            </div>

            {/* ── Lista ──────────────────────────────────────────────────── */}
            {chats.isLoading ? (
              <Skeleton class="h-96 w-full" />
            ) : chats.isError ? (
              <EmptyState
                icon={<AlertTriangle size={24} />}
                title="Não foi possível ler as conversas"
                description="Confira se o número está conectado por QR Code. Números do WhatsApp Oficial (Cloud API) não têm histórico para importar."
              />
            ) : !filtrados.length ? (
              <EmptyState
                icon={situacao === 'pendentes' ? <CheckCircle2 size={24} /> : <Smartphone size={24} />}
                title={situacao === 'pendentes' ? 'Nada pendente' : 'Nenhuma conversa neste recorte'}
                description={
                  situacao === 'pendentes'
                    ? 'Todas as conversas do período já foram trazidas para o painel. Troque o recorte para rever o que já veio.'
                    : 'Ajuste a busca, o período ou a situação.'
                }
              />
            ) : (
              <>
                <div class="flex flex-wrap items-center gap-3">
                  <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} />
                    <span>
                      Marcar as {selecionaveis.length} conversas deste recorte
                      <span class="text-fg-muted"> (não só as visíveis)</span>
                    </span>
                  </label>
                  {marcados.size > 0 && (
                    <button type="button" class="text-xs text-fg-muted underline hover:text-fg" onClick={() => setMarcados(new Set())}>
                      limpar seleção ({marcados.size})
                    </button>
                  )}
                </div>

                <ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {visiveis.map((c) => {
                    const naFila = c.sincronizacaoStatus === 'pending' || c.sincronizacaoStatus === 'running'
                    return (
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
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="truncate text-sm font-medium">
                              {c.nome
                                || c.telefone
                                // Grupo sem assunto conhecido: o mesmo rótulo que o
                                // painel dá a ele ao receber a primeira mensagem,
                                // em vez dos 18 dígitos crus do JID.
                                || (c.isGroup ? `Grupo ${c.remoteJid.replace(/\D/g, '').slice(-6)}` : c.remoteJid.split('@')[0])}
                            </span>
                            {c.isGroup && <Badge tone="neutral">Grupo</Badge>}
                            {!c.isGroup && !c.importavel && (
                              <Badge tone="neutral" title="O WhatsApp não revelou o telefone deste contato (identificador de privacidade @lid)">
                                Sem telefone
                              </Badge>
                            )}
                            {c.naoLidas > 0 && <Badge tone="warning">{c.naoLidas} não lida(s)</Badge>}
                          </div>
                          <div class="truncate text-xs text-fg-muted">{c.previa || '—'}</div>
                        </div>
                        <div class="w-40 shrink-0 text-right">
                          <div class="text-2xs text-fg-muted">
                            {quando(c.ultimaMensagemEm)}
                            {(() => { const d = diasAtras(c.ultimaMensagemEm); return d !== null && d > 0 ? ` · ${d}d` : '' })()}
                          </div>
                          <div class="mt-0.5 flex justify-end gap-1">
                            {naFila ? (
                              <Badge tone="info">{c.sincronizacaoStatus === 'running' ? 'importando…' : 'na fila'}</Badge>
                            ) : c.sincronizadoEm ? (
                              <Badge tone="success" title={`Sincronizada em ${new Date(c.sincronizadoEm).toLocaleString('pt-BR')}`}>
                                sincronizada {quando(c.sincronizadoEm)}
                              </Badge>
                            ) : c.leadId ? (
                              <Badge tone="neutral" title={c.leadNome || undefined}>
                                no painel{c.mensagensNoPainel > 0 ? ` (${c.mensagensNoPainel})` : ''}
                              </Badge>
                            ) : (
                              <Badge tone="accent">nova</Badge>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>

                {filtrados.length > visiveis.length && (
                  <button
                    type="button"
                    class="mx-auto rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2"
                    onClick={() => setLimite((v) => v + PAGINA)}
                  >
                    Mostrar mais {Math.min(PAGINA, filtrados.length - visiveis.length)} de {filtrados.length - visiveis.length} restantes
                  </button>
                )}

                {situacao !== 'nao-importaveis' && !!resumo && resumo.semTelefone > 0 && (
                  <p class="flex items-start gap-1.5 text-xs text-fg-muted">
                    <CircleSlash size={12} class="mt-0.5 shrink-0" />
                    {resumo.semTelefone} contato(s) sem telefone ficam de fora: sem número não há como criar o lead. O
                    WhatsApp esconde o telefone atrás de um identificador de privacidade quando o contato nunca escreveu
                    para você. Grupos entram normalmente — viram conversa de grupo no painel.
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          /* ── Agenda de contatos ─────────────────────────────────────────── */
          contatos.isLoading ? (
            <Skeleton class="h-96 w-full" />
          ) : contatos.isError ? (
            <EmptyState icon={<AlertTriangle size={24} />} title="Não foi possível ler a agenda" description="A agenda só existe em número conectado por QR Code." />
          ) : (
            <>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Cartao rotulo="Na agenda" valor={contatos.data?.resumo.total ?? 0} />
                <Cartao rotulo="Com telefone" valor={contatos.data?.resumo.importaveis ?? 0} tom="accent" />
                <Cartao rotulo="Já no painel" valor={contatos.data?.resumo.jaNoPainel ?? 0} tom="success" />
                <Cartao rotulo="Sem telefone visível" valor={contatos.data?.resumo.semTelefone ?? 0} tom="muted" />
              </div>

              <p class="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted">
                Contato importado vira lead <strong class="text-fg">sem histórico de conversa</strong> — use quando
                quiser a base de números; para trazer mensagem, use a aba Conversas. Os
                {' '}{contatos.data?.resumo.semTelefone ?? 0} contatos sem telefone visível não podem ser importados: o
                WhatsApp os identifica por um código de privacidade e, sem uma conversa, não há como descobrir o número.
              </p>

              <div class="relative">
                <Search size={13} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                <Input
                  class="pl-8"
                  placeholder="Buscar contato por nome ou telefone…"
                  value={buscaContatos}
                  onInput={(e) => { setBuscaContatos((e.target as HTMLInputElement).value); setLimite(PAGINA) }}
                />
              </div>

              {!contatosNovos.length ? (
                <EmptyState
                  icon={<CheckCircle2 size={24} />}
                  title="Nada novo na agenda"
                  description={buscaContatos ? 'Nenhum contato novo bate com a busca.' : 'Todos os contatos com telefone já estão no painel.'}
                />
              ) : (
                <>
                  <div class="flex flex-wrap items-center gap-3">
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={todosContatosMarcados}
                        onChange={() => setMarcadosContatos(todosContatosMarcados ? new Set() : new Set(contatosNovos.map((c) => c.remoteJid)))}
                      />
                      <span>Marcar os {contatosNovos.length} contatos novos deste recorte</span>
                    </label>
                    {marcadosContatos.size > 0 && (
                      <button type="button" class="text-xs text-fg-muted underline hover:text-fg" onClick={() => setMarcadosContatos(new Set())}>
                        limpar seleção ({marcadosContatos.size})
                      </button>
                    )}
                  </div>

                  <ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {contatosVisiveis.map((c) => (
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
                        <span class="shrink-0 text-xs text-fg-muted">{c.telefone}</span>
                      </li>
                    ))}
                  </ul>

                  {contatosNovos.length > contatosVisiveis.length && (
                    <button
                      type="button"
                      class="mx-auto rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2"
                      onClick={() => setLimite((v) => v + PAGINA)}
                    >
                      Mostrar mais {Math.min(PAGINA, contatosNovos.length - contatosVisiveis.length)} de {contatosNovos.length - contatosVisiveis.length} restantes
                    </button>
                  )}
                </>
              )}
            </>
          )
        )}
      </div>
    </Modal>
  )
}

/** Número do resumo que também é filtro — clicar troca o recorte da lista. */
function Cartao({ rotulo, valor, tom = 'neutral', ativo, onClick }: {
  rotulo: string
  valor: number
  tom?: 'neutral' | 'accent' | 'success' | 'muted'
  ativo?: boolean
  onClick?: () => void
}) {
  const cor = {
    neutral: 'text-fg',
    accent: 'text-accent',
    success: 'text-success',
    muted: 'text-fg-muted',
  }[tom]
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      class={`rounded-md border p-2.5 text-left transition-colors disabled:cursor-default ${
        ativo ? 'border-accent bg-accent/5' : 'border-border bg-surface-2'
      } ${onClick ? 'hover:border-accent/60' : ''}`}
    >
      <div class={`text-lg font-semibold tabular-nums ${cor}`}>{valor.toLocaleString('pt-BR')}</div>
      <div class="text-2xs leading-tight text-fg-muted">{rotulo}</div>
    </button>
  )
}
