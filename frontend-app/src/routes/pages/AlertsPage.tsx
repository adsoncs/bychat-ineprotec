// AlertsPage — a caixa de alertas por inteiro.
//
// O sino continua sendo o lugar certo para AGIR: alerta se lê de onde a pessoa
// está, e quem navega até uma página de alertas já sabia que eles existiam.
// Esta tela responde as três perguntas que a gaveta não responde e que não
// cabem nela sem virar outra coisa:
//
//   1. "o que já foi resolvido, e em quanto tempo?" — a gaveta só mostra o que
//      está de pé, porque é uma caixa de entrada, não um histórico;
//   2. "de quem são os alertas abertos da empresa?" — isso não é a soma das
//      caixas individuais. A CONDIÇÃO existe uma vez e chega a várias pessoas;
//      o sino de cada um mostra a fatia dele e ninguém vê o todo;
//   3. "o que está no acervo?" — o passivo antigo era um número no rodapé
//      justamente porque não havia onde listá-lo. Número que ninguém pode abrir
//      é número morto.
//
// Uma tela e três recortes, não três telas: filtros, paginação e as ações
// seriam idênticos, e duplicá-los é como duas telas ficam diferentes com o
// tempo.

import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  Bell, AlertTriangle, AlertCircle, Info, Check, Clock, ExternalLink, Archive, Users, Inbox,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  useAlertList, useAlertKinds, useAcervoItens, useAlertAction, useMarkAlertRead, useAckAlert,
  type AlertaDaLista, type AlertSeverity, type EscopoDaLista,
} from '@/hooks/useAlerts'

const GESTAO = new Set(['SUPERADMIN', 'ADMIN', 'MANAGER'])
const POR_PAGINA = 50

const ICONE: Record<AlertSeverity, typeof Bell> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}
// Sem tinta por severidade — a forma do ícone e o `aria-label` já a dizem.
// Ver o mesmo comentário em components/alerts/AlertInbox.tsx.
const ROTULO_TIPO: Record<string, string> = {
  'integration.token': 'Integrações',
  'integration.error': 'Integrações',
  'channel.down': 'Canais',
  'meeting.no_outcome': 'Reuniões sem desfecho',
  'meeting.bot_failed': 'Gravação de reunião',
  'activity.overdue': 'Atividades atrasadas',
  'negotiation.stalled': 'Propostas paradas',
  'lead.stale': 'Leads sem resposta',
}

type Aba = EscopoDaLista | 'acervo'

function quandoTexto(iso: string | null): string {
  if (!iso) return '—'
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}

export function AlertsPage() {
  const { user } = useAuth()
  const podeVerEmpresa = GESTAO.has(String(user?.role || ''))

  const [aba, setAba] = useState<Aba>('minha')
  const [status, setStatus] = useState('open')
  const [kind, setKind] = useState('')
  const [severity, setSeverity] = useState('')
  const [busca, setBusca] = useState('')
  const [offset, setOffset] = useState(0)
  const [tipoAcervo, setTipoAcervo] = useState('')

  const kinds = useAlertKinds()
  // Resolvido só vale por poucos dias: "o que eu fechei esta semana". Depois
  // vira histórico que ninguém lê, e alerta não é arquivo. A janela é da TELA;
  // o banco guarda 30 dias, porque a saúde do sino mede nessa janela.
  const DIAS_RESOLVIDO = 7
  const desde = status === 'resolved'
    ? new Date(Date.now() - DIAS_RESOLVIDO * 86400_000).toISOString()
    : undefined
  const lista = useAlertList(
    { escopo: aba === 'acervo' ? 'minha' : aba, status, kind, severity, busca, desde, limit: POR_PAGINA, offset },
    aba !== 'acervo',
  )
  const acervo = useAcervoItens(tipoAcervo || undefined, offset, aba === 'acervo')

  // Qualquer mudança de recorte volta para a primeira página: manter o offset
  // ao trocar de filtro mostra a página 3 de uma lista que agora tem uma.
  function trocar<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setOffset(0) }
  }

  const abas: Array<{ id: Aba; label: string; icon: typeof Bell }> = [
    { id: 'minha', label: 'Minha caixa', icon: Inbox },
    ...(podeVerEmpresa ? [{ id: 'empresa' as Aba, label: 'Da empresa', icon: Users }] : []),
    { id: 'acervo', label: 'Acervo', icon: Archive },
  ]

  return (
    <Page
      title="Alertas"
      description="O que precisa de atenção, o que já foi resolvido, e o passivo que ficou fora do sino."
    >
      <div class="flex items-center gap-1 border-b border-border">
        {abas.map((a) => (
          <button
            key={a.id}
            class={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
              aba === a.id
                ? 'border-accent text-fg font-medium'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
            onClick={() => { setAba(a.id); setOffset(0) }}
          >
            <a.icon size={14} /> {a.label}
          </button>
        ))}
      </div>

      {aba === 'acervo' ? (
        <>
          {/* O acervo é passivo, não novidade: não tem status nem severidade —
              tudo aqui está de pé há tempo demais. Só o tipo recorta. */}
          <div class="flex items-end gap-3 flex-wrap">
            <Campo rotulo="Tipo">
              <Select value={tipoAcervo} onChange={(e) => trocar(setTipoAcervo)((e.target as HTMLSelectElement).value)}>
                <option value="">todos</option>
                {Object.entries(ROTULO_TIPO)
                  .filter(([k]) => k !== 'integration.token' && k !== 'integration.error' && k !== 'channel.down')
                  .map(([k, v]) => <option value={k}>{v}</option>)}
              </Select>
            </Campo>
            <p class="text-xs text-fg-muted max-w-xl">
              Pendências velhas demais para virar novidade. Não avisam ninguém de propósito —
              precisam de uma decisão, não de notificação. Sem ação em massa: alerta se resolve
              porque a condição acabou, não porque alguém marcou.
            </p>
          </div>

          {acervo.isLoading ? (
            <Carregando />
          ) : !acervo.data?.itens.length ? (
            <EmptyState icon={<Archive size={22} />} title="Nada no acervo" description="Todo o passivo está dentro das janelas de alerta." />
          ) : (
            <div class="space-y-2">
              {acervo.data.itens.map((i) => (
                <LinhaDoAcervo key={`${i.tipo}:${i.entityId}`} item={i} />
              ))}
              <Pagination
                total={acervo.data.total}
                limit={acervo.data.limite}
                offset={acervo.data.offset}
                onChange={setOffset}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div class="flex items-end gap-3 flex-wrap">
            <Campo rotulo="Situação">
              <Select value={status} onChange={(e) => trocar(setStatus)((e.target as HTMLSelectElement).value)}>
                <option value="open">Em aberto</option>
                <option value="resolved">Resolvidos (7 dias)</option>
                <option value="todos">Todos</option>
              </Select>
            </Campo>
            <Campo rotulo="Tipo">
              <Select value={kind} onChange={(e) => trocar(setKind)((e.target as HTMLSelectElement).value)}>
                <option value="">todos</option>
                {(kinds.data?.tipos ?? []).map((t) => (
                  <option value={t.kind}>{ROTULO_TIPO[t.kind] || t.kind} ({t.total})</option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Severidade">
              <Select value={severity} onChange={(e) => trocar(setSeverity)((e.target as HTMLSelectElement).value)}>
                <option value="">todas</option>
                <option value="critical">Crítico</option>
                <option value="warning">Atenção</option>
                <option value="info">Informação</option>
              </Select>
            </Campo>
            <div class="flex-1 min-w-[12rem]">
              <Campo rotulo="Buscar">
                <SearchInput value={busca} onChange={(v: string) => trocar(setBusca)(v)} placeholder="título do alerta…" />
              </Campo>
            </div>
          </div>

          {lista.isLoading ? (
            <Carregando />
          ) : !lista.data?.itens.length ? (
            <EmptyState
              icon={<Bell size={22} />}
              title={status === 'resolved' ? 'Nada resolvido nos últimos 7 dias' : 'Nada pedindo atenção'}
              description={aba === 'empresa'
                ? 'Nenhuma condição aberta na empresa com esses filtros.'
                : 'Sua caixa está limpa com esses filtros.'}
            />
          ) : (
            <div class="space-y-2">
              {lista.data.itens.map((a) => (
                <LinhaDeAlerta key={a.id} alerta={a} mostrarDono={aba === 'empresa'} />
              ))}
              <Pagination
                total={lista.data.total}
                limit={lista.data.limite}
                offset={lista.data.offset}
                onChange={setOffset}
              />
            </div>
          )}
        </>
      )}
    </Page>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: preact.ComponentChildren }) {
  return (
    <label class="block">
      <span class="block text-3xs text-fg-muted mb-1">{rotulo}</span>
      {children}
    </label>
  )
}

function Carregando() {
  return <div class="space-y-2"><Skeleton class="h-16" /><Skeleton class="h-16" /><Skeleton class="h-16" /></div>
}

function LinhaDeAlerta({ alerta, mostrarDono }: { alerta: AlertaDaLista; mostrarDono: boolean }) {
  const [, navigate] = useLocation()
  const acao = useAlertAction()
  const marcarLido = useMarkAlertRead()
  const ciente = useAckAlert()
  const Icone = ICONE[alerta.severity] ?? Info
  const resolvido = alerta.status === 'resolved'

  return (
    <Card class={cn('flex items-start gap-3', resolvido && 'opacity-70')}>
      <Icone size={16} class="shrink-0 mt-0.5" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class={cn('text-sm', !alerta.readAt && !resolvido && 'font-semibold')}>{alerta.title}</span>
          <Badge tone="neutral">{ROTULO_TIPO[alerta.kind] || alerta.kind}</Badge>
          {resolvido && <Badge tone="success">resolvido {quandoTexto(alerta.resolvedAt)}</Badge>}
        </div>
        {alerta.body && <p class="text-xs text-fg-muted mt-1">{alerta.body}</p>}
        <div class="text-3xs text-fg-muted mt-1.5 flex items-center gap-3 flex-wrap">
          <span>apareceu {quandoTexto(alerta.firstSeenAt)}</span>
          {alerta.occurrences > 1 && <span>verificado {alerta.occurrences}x</span>}
          {mostrarDono && (
            <span>{alerta.dono ? `de ${alerta.dono.nome}` : 'sem responsável'}</span>
          )}
          {/* Na visão da empresa o que importa é se a condição CHEGOU a alguém:
              um crítico aberto que ninguém leu é o pior caso, e é o número que
              o escalonamento usa para decidir sair do painel. */}
          {mostrarDono && alerta.destinatarios > 0 && (
            <span class={alerta.naoLidos === alerta.destinatarios ? 'text-warning' : undefined}>
              {alerta.naoLidos} de {alerta.destinatarios} não leram
            </span>
          )}
        </div>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        {alerta.acoes?.map((a) => (
          <button
            key={a.action}
            class={cn(
              'text-xs px-2 py-1 rounded border transition-colors',
              a.tom === 'primary'
                ? 'border-accent text-accent hover:bg-accent hover:text-fg-on-brand'
                : 'border-border text-fg-muted hover:text-fg',
            )}
            disabled={acao.isPending}
            onClick={() => acao.mutate(
              { id: alerta.id, action: a.action },
              {
                onSuccess: () => toast('Pronto', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              },
            )}
          >
            {a.label}
          </button>
        ))}
        {!alerta.readAt && !resolvido && (
          <button
            class="p-1 text-fg-muted hover:text-fg"
            title="Marcar como lido"
            onClick={() => marcarLido.mutate(alerta.id)}
          >
            <Check size={14} />
          </button>
        )}
        {/*
          "Ciente por hoje" existe em TODO alerta aberto, inclusive nos seis
          tipos que não têm botão de ação — proposta parada, lead sem resposta,
          linha caída, integração, gravação falhada. Sem isso a única saída
          deles era não fazer nada, e o aviso ficava na caixa até alguém
          resolver o problema lá fora.
        */}
        {!resolvido && (
          <button
            class="p-1 text-fg-muted hover:text-fg"
            title="Ciente por hoje — sai da sua caixa e volta amanhã se o problema continuar"
            disabled={ciente.isPending}
            onClick={() => ciente.mutate(alerta.id, {
              onSuccess: () => toast('Ciente. Volta amanhã se o problema continuar.', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          >
            <Clock size={14} />
          </button>
        )}
        {alerta.link && (
          <button
            class="p-1 text-fg-muted hover:text-fg"
            title="Abrir"
            onClick={() => navigate(alerta.link!)}
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>
    </Card>
  )
}

function LinhaDoAcervo({ item }: { item: { tipo: string; rotulo: string; entityId: number; titulo: string; detalhe: string | null; dias: number | null; link: string | null; dono: string | null } }) {
  const [, navigate] = useLocation()
  return (
    <Card class="flex items-start gap-3">
      <Archive size={16} class="shrink-0 mt-0.5 text-fg-muted" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm">{item.titulo}</span>
          <Badge tone="neutral">{item.rotulo}</Badge>
        </div>
        <div class="text-3xs text-fg-muted mt-1 flex items-center gap-3 flex-wrap">
          {item.dias !== null && <span>há {item.dias} dias</span>}
          {item.detalhe && <span>{item.detalhe}</span>}
          <span>{item.dono ? `de ${item.dono}` : 'sem responsável'}</span>
        </div>
      </div>
      {item.link && (
        <button class="p-1 text-fg-muted hover:text-fg shrink-0" title="Abrir" onClick={() => navigate(item.link!)}>
          <ExternalLink size={14} />
        </button>
      )}
    </Card>
  )
}
