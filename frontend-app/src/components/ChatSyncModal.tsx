import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RefreshCw, CheckCircle2, AlertTriangle, Loader2, Smartphone, ImageDown, MessageSquare,
} from 'lucide-preact'
import { api, ApiError } from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'

/**
 * Sincronizar ESTA conversa com o histórico do celular.
 *
 * A tela geral de importação serve para o mutirão inicial; no dia a dia o que
 * acontece é outro: o operador abre um atendimento, vê que faltam as mensagens
 * que o cliente mandou pelo aparelho e precisa delas AGORA. Obrigá-lo a sair da
 * conversa, abrir a lista de mil chats e caçar o contato é o caminho que
 * ninguém percorre — então aqui a sincronização mora dentro da conversa.
 *
 * O modal se explica em qualquer desfecho: achou e trouxe (diz o quê), achou e
 * não havia nada novo (diz que está em dia), ou não achou (diz por quê). Um
 * "nada aconteceu" sem explicação é o que faz o operador clicar cinco vezes.
 */

interface Props {
  leadId: number
  nome?: string | null
  /** Conversa de grupo: muda os textos, porque "contato" não descreve um grupo. */
  isGroup?: boolean
  onClose: () => void
}

interface SyncJob {
  id: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled'
  totalNaOrigem: number
  importadas: number
  jaExistiam: number
  midiasPendentes: number
  erro: string | null
}

interface SyncResposta {
  ok: true
  encontrado?: boolean
  jaEstava?: boolean
  motivo?: string
  instancia?: string
  job?: SyncJob | null
}

export function ChatSyncModal({ leadId, nome, isGroup = false, onClose }: Props) {
  const alvo = isGroup ? 'grupo' : 'contato'
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<number | null>(null)
  const [semConversa, setSemConversa] = useState(false)
  const [erroFatal, setErroFatal] = useState<{ titulo: string; texto: string } | null>(null)
  const disparado = useRef(false)

  const iniciar = useMutation({
    mutationFn: () => api.post<SyncResposta>(`/atendimento/tickets/${leadId}/sync-whatsapp`),
    onSuccess: (r) => {
      if (r.encontrado === false) { setSemConversa(true); return }
      if (r.job?.id) setJobId(r.job.id)
    },
    onError: (e: unknown) => {
      const err = e as ApiError
      const motivo = (err.payload as { motivo?: string } | null)?.motivo
      setErroFatal({
        titulo:
          motivo === 'sem_telefone' ? 'Sem telefone para procurar'
            : motivo === 'sem_instancia' ? 'Nenhum número conectado por QR Code'
              : motivo === 'falha_provedor' ? 'O WhatsApp não respondeu'
                : 'Não foi possível sincronizar',
        texto: err.message,
      })
    },
  })

  // Dispara sozinho ao abrir: o clique no menu já foi a confirmação, e uma
  // segunda tela de "deseja mesmo?" só atrasaria quem já sabe o que quer.
  useEffect(() => {
    if (disparado.current) return
    disparado.current = true
    iniciar.mutate()
  }, [])

  const estado = useQuery({
    queryKey: ['chat-sync', leadId],
    queryFn: () => api.get<{ job: SyncJob | null }>(`/atendimento/tickets/${leadId}/sync-whatsapp`),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const j = (q.state.data as { job: SyncJob | null } | undefined)?.job
      return j && (j.status === 'pending' || j.status === 'running') ? 1500 : false
    },
  })

  const job = estado.data?.job ?? null
  const terminou = job?.status === 'done'
  const falhou = job?.status === 'failed' || job?.status === 'canceled'

  // Ao terminar, as mensagens novas precisam aparecer sem o operador recarregar.
  const jaAtualizou = useRef(false)
  useEffect(() => {
    if (!terminou || jaAtualizou.current) return
    jaAtualizou.current = true
    void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
    void qc.invalidateQueries({ queryKey: ['pending-media', leadId] })
    void qc.invalidateQueries({ queryKey: ['whatsapp-chats'] })
    void qc.invalidateQueries({ queryKey: ['chat-import-jobs'] })
  }, [terminou])

  const [restamMidias, setRestamMidias] = useState<number | null>(null)

  const baixarMidias = useMutation({
    // Lote curto de propósito: decifrar mídia antiga na Evolution é lento e o
    // proxy corta a requisição em 60s. Vários lotes pequenos sempre respondem;
    // um lote grande vira erro de rede com as mídias baixadas pela metade.
    mutationFn: () => api.post<{ baixadas: number; falharam: number; restantes: number; parcial?: boolean; expiradas?: number }>(
      `/atendimento/tickets/${leadId}/fetch-media`, { limite: 8 },
    ),
    onSuccess: (r) => {
      setRestamMidias(r.restantes)
      toast(
        r.baixadas
          ? `${r.baixadas} mídia(s) carregada(s)${r.restantes ? ` · faltam ${r.restantes}` : ''}`
          : r.expiradas
            ? `${r.expiradas} mídia(s) não voltam — o WhatsApp já expirou os arquivos.`
            : r.parcial
              ? 'O WhatsApp está lento agora — tente de novo em instantes.'
              : 'Não foi possível recuperar estas mídias agora.',
        r.baixadas ? 'success' : 'warning',
      )
      void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['pending-media', leadId] })
    },
    onError: (e: unknown) => {
      const err = e as ApiError
      // 502/503/504 aqui é o proxy cortando a espera pela Evolution, não uma
      // falha do painel — dizer "HTTP 503" não ajuda ninguém.
      toast(
        err.status >= 502
          ? 'O WhatsApp demorou demais para entregar os arquivos. Parte pode ter sido carregada — tente de novo.'
          : err.message,
        'danger',
      )
      void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['pending-media', leadId] })
    },
  })

  const procurando = iniciar.isPending
  const importando = !!job && (job.status === 'pending' || job.status === 'running')
  const lidas = job ? job.importadas + job.jaExistiam : 0
  const pct = job?.totalNaOrigem ? Math.min(100, Math.round((lidas / job.totalNaOrigem) * 100)) : null

  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title={isGroup ? 'Sincronizar grupo' : 'Sincronizar do celular'}
      description={nome ? `Histórico de ${nome} no aparelho conectado` : 'Histórico desta conversa no aparelho conectado'}
      size="md"
      footer={
        <div class="flex w-full items-center justify-between gap-2">
          <span class="text-xs text-fg-subtle">
            {importando ? 'Pode fechar — a sincronização continua em segundo plano.' : ''}
          </span>
          <div class="flex gap-2">
            {(semConversa || falhou || !!erroFatal) && (
              <Button
                variant="secondary"
                size="md"
                disabled={iniciar.isPending}
                onClick={() => {
                  setSemConversa(false); setErroFatal(null); setJobId(null)
                  jaAtualizou.current = false
                  iniciar.mutate()
                }}
              >
                <RefreshCw size={13} /> Tentar de novo
              </Button>
            )}
            <Button variant="primary" size="md" onClick={onClose}>
              {terminou ? 'Ver a conversa' : 'Fechar'}
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-3">
        {procurando && (
          <Estado
            icone={<Loader2 size={22} class="animate-spin text-accent" />}
            titulo="Procurando esta conversa no celular…"
            texto={`Estamos varrendo os números conectados por QR Code atrás do histórico deste ${alvo}.`}
          />
        )}

        {erroFatal && (
          <Estado
            tom="danger"
            icone={<AlertTriangle size={22} class="text-danger" />}
            titulo={erroFatal.titulo}
            texto={erroFatal.texto}
          />
        )}

        {semConversa && (
          <Estado
            tom="muted"
            icone={<Smartphone size={22} class="text-fg-muted" />}
            titulo="Nada para sincronizar"
            texto={isGroup
              ? 'Nenhum número conectado por QR Code participa deste grupo. Só quem é membro recebe o histórico — um número que entrou depois não enxerga o que foi conversado antes.'
              : 'Este contato não tem conversa nos números conectados por QR Code. Ou o histórico está em outro aparelho, ou a conversa nasceu aqui no painel — nos dois casos, não há mensagem antiga para trazer.'}
          >
            <ul class="mt-2 space-y-1 text-xs text-fg-subtle">
              <li>· Números do WhatsApp Oficial (Cloud API) não guardam histórico anterior à conexão.</li>
              {isGroup
                ? <li>· A API Oficial não enxerga grupos — grupo só existe em número conectado por QR Code.</li>
                : <li>· Se o contato só existe em outro número da empresa, conecte-o e repita.</li>}
            </ul>
          </Estado>
        )}

        {importando && (
          <Estado
            icone={<Loader2 size={22} class="animate-spin text-accent" />}
            titulo={job?.status === 'pending' ? 'Na fila…' : 'Trazendo as mensagens…'}
            texto={
              job?.totalNaOrigem
                ? `${lidas} de ${job.totalNaOrigem} mensagens lidas no celular.`
                : 'Abrindo o histórico do contato no aparelho.'
            }
          >
            <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                class="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: pct === null ? '35%' : `${Math.max(pct, 4)}%` }}
              />
            </div>
          </Estado>
        )}

        {terminou && job && (() => {
          // Depois de um lote, o que resta vem da resposta — o contador do job é
          // do momento da importação e ficaria mentindo na tela.
          const pendentesAgora = restamMidias ?? job.midiasPendentes
          return job.importadas > 0 ? (
            <Estado
              tom="success"
              icone={<CheckCircle2 size={22} class="text-success" />}
              titulo={`${job.importadas} mensagem(ns) trazida(s) do celular`}
              texto="O histórico já está na conversa, em ordem cronológica. Nada foi duplicado: o que já existia aqui foi reconhecido e mantido."
            >
              <ul class="mt-2 space-y-1 text-xs text-fg-muted">
                <li class="flex items-center gap-1.5">
                  <MessageSquare size={12} /> {job.importadas} nova(s)
                  {job.jaExistiam > 0 && ` · ${job.jaExistiam} já estavam no painel`}
                </li>
                {pendentesAgora > 0 && (
                  <li class="flex items-center gap-1.5">
                    <ImageDown size={12} /> {pendentesAgora} mídia(s) ainda sem o arquivo — o download é sob demanda,
                    em lotes de 8.
                  </li>
                )}
              </ul>
              {pendentesAgora > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  class="mt-3"
                  disabled={baixarMidias.isPending}
                  onClick={() => baixarMidias.mutate()}
                >
                  {baixarMidias.isPending
                    ? <><Loader2 size={12} class="animate-spin" /> Carregando…</>
                    : <><ImageDown size={12} /> Carregar {Math.min(pendentesAgora, 8)} mídia(s)</>}
                </Button>
              )}
            </Estado>
          ) : (
            <Estado
              tom="success"
              icone={<CheckCircle2 size={22} class="text-success" />}
              titulo="Já estava tudo aqui"
              texto={
                job.jaExistiam > 0
                  ? `Conferimos as ${job.jaExistiam} mensagens que o celular tem desta conversa e todas já estavam no painel. Nenhuma mensagem nova.`
                  : 'A conversa existe no celular, mas não há mensagem para trazer.'
              }
            />
          )
        })()}

        {falhou && job && (
          <Estado
            tom="danger"
            icone={<AlertTriangle size={22} class="text-danger" />}
            titulo={job.status === 'canceled' ? 'Sincronização cancelada' : 'A sincronização falhou'}
            texto={job.erro || 'O WhatsApp interrompeu a leitura do histórico. Tentar de novo costuma resolver.'}
          />
        )}
      </div>
    </Modal>
  )
}

function Estado({ icone, titulo, texto, tom = 'info', children }: {
  icone: ComponentChildren
  titulo: string
  texto: string
  tom?: 'info' | 'success' | 'danger' | 'muted'
  children?: ComponentChildren
}) {
  const borda = {
    info: 'border-border bg-surface-2',
    success: 'border-success/30 bg-success/5',
    danger: 'border-danger/30 bg-danger/5',
    muted: 'border-border bg-surface-2',
  }[tom]
  return (
    <div class={`flex gap-3 rounded-md border p-4 ${borda}`}>
      <div class="shrink-0 pt-0.5">{icone}</div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-fg">{titulo}</div>
        <p class="mt-1 text-xs leading-relaxed text-fg-muted">{texto}</p>
        {children}
      </div>
    </div>
  )
}
