// Uma mensagem da Equipe: texto (com @menções e links), resposta citada,
// anexos, cartão de ação, links de lead colados, reações e ações.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import {
  CornerUpLeft, Smile, Pencil, Trash2, ExternalLink, MessageSquare, Paperclip, Lock, ArrowRightLeft, Briefcase,
  CheckSquare, UserPlus, Check, X, Users2,
} from '@/components/ui/icon-set'
import { useAcoesDaEquipe, type CartaoEquipe, type MensagemEquipe, type ResumoDoLeadEquipe } from '@/hooks/useEquipe'
import { useEquipeStore } from '@/stores/equipe'

export const EMOJIS_DA_EQUIPE = ['👍', '❤️', '😂', '😮', '🙏', '✅', '👀', '🎉']

export const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const brl = (v: number, moeda?: string | null) => v.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' })

/** Navega dentro do painel sem recarregar; links externos abrem em outra aba. */
function useAbrirLink() {
  const [, navigate] = useLocation()
  return (href: string) => {
    try {
      const u = new URL(href, window.location.origin)
      if (u.origin === window.location.origin && u.pathname.startsWith('/app/')) {
        navigate(u.pathname.replace(/^\/app/, '') + u.search)
        // No celular o painel cobre a tela: fecha para mostrar o destino.
        if (window.innerWidth < 1024) useEquipeStore.getState().fechar()
        return
      }
    } catch { /* cai no window.open */ }
    window.open(href, '_blank', 'noopener')
  }
}

/** Texto com @menções destacadas e links clicáveis. */
export function TextoDaEquipe({ corpo, minha = false }: { corpo: string; minha?: boolean | undefined }) {
  const abrir = useAbrirLink()
  const partes: Array<{ t: 'txt' | 'men' | 'url'; v: string; extra?: string }> = []
  const re = /@\[([^\]]{1,80})\]\(([ut]):(\d{1,9})\)|(https?:\/\/[^\s<]+)/g
  let i = 0
  for (const m of corpo.matchAll(re)) {
    if (m.index! > i) partes.push({ t: 'txt', v: corpo.slice(i, m.index) })
    if (m[1]) partes.push({ t: 'men', v: `@${m[1]}`, ...(m[2] ? { extra: m[2] } : {}) })
    else partes.push({ t: 'url', v: m[4]! })
    i = m.index! + m[0].length
  }
  if (i < corpo.length) partes.push({ t: 'txt', v: corpo.slice(i) })
  return (
    <span class="whitespace-pre-wrap break-words">
      {partes.map((p, k) => p.t === 'txt' ? <span key={k}>{p.v}</span>
        // Na própria bolha (fundo da cor de destaque) a menção não pode usar essa cor.
        : p.t === 'men' ? <span key={k} class={cn('font-semibold', minha ? 'underline' : p.extra === 't' ? 'text-warning' : 'text-accent')}>{p.v}</span>
        : <a key={k} href={p.v} class="underline break-all" onClick={(e) => { e.preventDefault(); abrir(p.v) }}>{p.v.replace(/^https?:\/\/[^/]+/, '') || p.v}</a>)}
    </span>
  )
}

function LinhaDoLead({ lead, compacto = false }: { lead: ResumoDoLeadEquipe; compacto?: boolean | undefined }) {
  const abrir = useAbrirLink()
  if (lead.restrito) {
    return <div class="flex items-center gap-1.5 text-xs text-fg-muted"><Lock size={12} /> Lead restrito — você não tem acesso a este lead.</div>
  }
  return (
    <div class="space-y-1">
      <div class="text-sm font-semibold text-fg truncate">{lead.nome}</div>
      {!compacto && (
        <div class="text-2xs text-fg-muted flex flex-wrap gap-x-2">
          {lead.etapa && <span>{lead.funil ? `${lead.funil} › ` : ''}{lead.etapa}</span>}
          <span>· {lead.atendente ? `com ${lead.atendente}` : 'sem atendente'}</span>
        </div>
      )}
      <div class="flex flex-wrap gap-1.5 pt-0.5">
        <button type="button" class="inline-flex items-center gap-1 text-2xs text-accent hover:underline" onClick={() => abrir(`/app/leads/${lead.id}`)}><ExternalLink size={11} /> Abrir lead</button>
        <button type="button" class="inline-flex items-center gap-1 text-2xs text-accent hover:underline" onClick={() => abrir(`/app/conversations?leadId=${lead.id}`)}><MessageSquare size={11} /> Abrir conversa</button>
      </div>
    </div>
  )
}

const ROTULO_STATUS_TR: Record<string, string> = { pending: 'Aguardando resposta', accepted: 'Aceita', rejected: 'Recusada', cancelled: 'Cancelada', expired: 'Expirou' }
const ROTULO_STATUS_NEG: Record<string, string> = { rascunho: 'Rascunho', enviada: 'Enviada', em_negociacao: 'Em negociação', aceita: 'Aceita', recusada: 'Recusada', expirada: 'Expirada' }

export function CartaoDaEquipe({ cartao, mensagemId, conversaId }: { cartao: CartaoEquipe; mensagemId: number; conversaId: number }) {
  const { acaoDoCartao } = useAcoesDaEquipe()
  const abrir = useAbrirLink()
  const agir = (acao: string) => acaoDoCartao.mutate({ id: mensagemId, acao, conversaId }, {
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const cab = (Icone: any, titulo: string, tom = 'text-accent') => (
    <div class={cn('flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide', tom)}><Icone size={12} /> {titulo}</div>
  )
  const caixa = 'rounded-lg border border-border bg-surface p-2.5 space-y-1.5 min-w-[14rem] text-fg'

  if (cartao.tipo === 'lead' && cartao.lead) return <div class={caixa}>{cab(Users2, 'Lead')}<LinhaDoLead lead={cartao.lead} /></div>
  if (cartao.tipo === 'indicacao') {
    return (
      <div class={caixa}>
        {cab(UserPlus, `Indicação${cartao.para ? ` para ${cartao.para}` : ''}`)}
        {cartao.lead && <LinhaDoLead lead={cartao.lead} />}
        {cartao.motivo && <div class="text-xs text-fg-muted">“{cartao.motivo}”</div>}
        {cartao.assumidoPor ? <div class="text-2xs text-success">✓ Assumido por {cartao.assumidoPor}</div>
          : cartao.podeAssumir && <Button size="sm" onClick={() => agir('assumir')} loading={acaoDoCartao.isPending}>Assumir o lead</Button>}
      </div>
    )
  }
  if (cartao.tipo === 'transferencia') {
    const st = cartao.status ?? 'pending'
    return (
      <div class={caixa}>
        {cab(ArrowRightLeft, 'Pedido de transferência')}
        {cartao.lead && <LinhaDoLead lead={cartao.lead} compacto />}
        <div class="text-xs text-fg-muted">{cartao.de} → <b class="text-fg">{cartao.para}</b>{cartao.motivo ? ` · “${cartao.motivo}”` : ''}</div>
        <div class={cn('text-2xs font-semibold', st === 'accepted' ? 'text-success' : st === 'pending' ? 'text-warning' : 'text-fg-muted')}>{ROTULO_STATUS_TR[st] ?? st}{cartao.resposta ? ` — “${cartao.resposta}”` : ''}</div>
        {cartao.podeResponder && (
          <div class="flex gap-1.5">
            <Button size="sm" onClick={() => agir('aceitar')} loading={acaoDoCartao.isPending}><Check size={12} /> Aceitar</Button>
            <Button size="sm" variant="secondary" onClick={() => agir('recusar')} disabled={acaoDoCartao.isPending}><X size={12} /> Recusar</Button>
          </div>
        )}
        {cartao.podeCancelar && <button type="button" class="text-2xs text-fg-muted hover:text-danger" onClick={() => agir('cancelar')}>Cancelar pedido</button>}
      </div>
    )
  }
  if (cartao.tipo === 'negociacao') {
    if (cartao.restrito || !cartao.negociacao) return <div class={caixa}>{cab(Briefcase, 'Negociação')}<div class="flex items-center gap-1.5 text-xs text-fg-muted"><Lock size={12} /> Negociação restrita.</div></div>
    const n = cartao.negociacao
    return (
      <div class={caixa}>
        {cab(Briefcase, 'Negociação')}
        <div class="text-sm font-semibold">{n.titulo}</div>
        <div class="text-2xs text-fg-muted">{ROTULO_STATUS_NEG[n.status] ?? n.status}{n.valor != null ? ` · ${brl(n.valor, n.moeda)}` : ''}{cartao.lead?.nome ? ` · ${cartao.lead.nome}` : ''}</div>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class="inline-flex items-center gap-1 text-2xs text-accent hover:underline" onClick={() => abrir('/app/negotiations')}><ExternalLink size={11} /> Negociações</button>
          {cartao.lead && !cartao.lead.restrito && <button type="button" class="inline-flex items-center gap-1 text-2xs text-accent hover:underline" onClick={() => abrir(`/app/leads/${cartao.lead!.id}`)}><ExternalLink size={11} /> Abrir lead</button>}
        </div>
      </div>
    )
  }
  if (cartao.tipo === 'tarefa') {
    const feita = cartao.status === 'concluida'
    const vencida = !feita && cartao.prazo && new Date(cartao.prazo).getTime() < Date.now()
    return (
      <div class={cn(caixa, feita && 'opacity-80')}>
        {cab(CheckSquare, `Tarefa${cartao.para ? ` para ${cartao.para}` : ''}`, feita ? 'text-success' : 'text-accent')}
        <div class={cn('text-sm font-semibold', feita && 'line-through')}>{cartao.titulo}</div>
        {cartao.detalhe && <div class="text-xs text-fg-muted whitespace-pre-wrap">{cartao.detalhe}</div>}
        {cartao.prazo && <div class={cn('text-2xs', vencida ? 'text-danger font-semibold' : 'text-fg-muted')}>Prazo: {new Date(cartao.prazo).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{vencida ? ' (atrasada)' : ''}</div>}
        {cartao.lead && <LinhaDoLead lead={cartao.lead} compacto />}
        {feita && <div class="text-2xs text-success">✓ Concluída{cartao.concluidaPor ? ` por ${cartao.concluidaPor}` : ''}</div>}
        {cartao.podeConcluir && <Button size="sm" onClick={() => agir('concluir')} loading={acaoDoCartao.isPending}><Check size={12} /> Concluir</Button>}
        {cartao.podeReabrir && <button type="button" class="text-2xs text-fg-muted hover:text-fg" onClick={() => agir('reabrir')}>Reabrir</button>}
      </div>
    )
  }
  return null
}

export function MensagemDaEquipe(props: {
  msg: MensagemEquipe
  conversaId: number
  agrupada: boolean
  destaque?: boolean | undefined
  podeApagarAlheia: boolean
  onResponder: () => void
  onEditar: () => void
  onIrPara: (id: number) => void
}) {
  const { msg } = props
  const { reagir, apagar } = useAcoesDaEquipe()
  const [acoes, setAcoes] = useState(false)
  const [emojis, setEmojis] = useState(false)
  const autorNome = msg.autor?.nome ?? ''

  if (msg.sistema) {
    return <div class="flex justify-center py-1"><span class="text-2xs text-fg-muted bg-surface-2 rounded-full px-2.5 py-0.5">{msg.corpo}</span></div>
  }

  const reacoes = Object.entries(msg.reacoes ?? {}).filter(([, ids]) => ids.length)
  return (
    <div id={`equipe-msg-${msg.id}`} class={cn('group flex gap-2', msg.minha ? 'flex-row-reverse' : 'flex-row', props.agrupada ? 'mt-0.5' : 'mt-3')}>
      <div class="w-7 shrink-0">{!msg.minha && !props.agrupada && <Avatar name={autorNome} seed={msg.autor?.id} size="md" round />}</div>
      <div class={cn('min-w-0 max-w-[82%] flex flex-col', msg.minha ? 'items-end' : 'items-start')}>
        {!props.agrupada && !msg.minha && <div class="text-2xs text-fg-muted mb-0.5 px-1">{autorNome}</div>}
        <div
          class={cn(
            'relative rounded-2xl px-3 py-2 text-sm',
            msg.apagada ? 'bg-surface-2 text-fg-muted italic border border-border'
              : msg.minha ? 'bg-accent text-fg-on-brand rounded-tr-md' : 'bg-surface-2 text-fg rounded-tl-md border border-border',
            msg.mencionaMim && !msg.minha && 'ring-2 ring-warning/60',
            props.destaque && 'ring-2 ring-accent',
          )}
          onClick={() => setAcoes((v) => !v)}
        >
          {msg.resposta && (
            <button
              type="button"
              class={cn('block w-full text-left mb-1.5 rounded-md border-l-2 px-2 py-1 text-2xs', msg.minha ? 'border-white/70 bg-white/15' : 'border-accent bg-surface')}
              onClick={(e) => { e.stopPropagation(); props.onIrPara(msg.resposta!.id) }}
            >
              <b>{msg.resposta.autor ?? '—'}</b>
              <div class="truncate opacity-80">{msg.resposta.trecho}</div>
            </button>
          )}
          {msg.apagada ? 'Mensagem apagada' : (
            <>
              {msg.corpo && <TextoDaEquipe corpo={msg.corpo} minha={msg.minha} />}
              {msg.anexos.length > 0 && (
                <div class={cn('space-y-1.5', msg.corpo && 'mt-1.5')}>
                  {msg.anexos.map((a) => a.tipo.startsWith('image/')
                    ? <a key={a.url} href={a.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}><img src={a.url} alt={a.nome} class="max-h-56 rounded-lg" loading="lazy" /></a>
                    : <a key={a.url} href={a.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} class={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-xs underline', msg.minha ? 'bg-white/15' : 'bg-surface')}><Paperclip size={12} /> {a.nome}</a>)}
                </div>
              )}
              {msg.cartao && <div class={cn(msg.corpo && 'mt-1.5')} onClick={(e) => e.stopPropagation()}><CartaoDaEquipe cartao={msg.cartao} mensagemId={msg.id} conversaId={props.conversaId} /></div>}
              {msg.linksDeLead.length > 0 && (
                <div class="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  {msg.linksDeLead.map((l) => <div key={l.id} class="rounded-lg border border-border bg-surface p-2 text-fg"><LinhaDoLead lead={l} /></div>)}
                </div>
              )}
            </>
          )}
          <span class={cn('ml-2 text-[0.65rem] align-bottom', msg.minha && !msg.apagada ? 'text-fg-on-brand/75' : 'text-fg-muted')}>{msg.editada ? 'editada · ' : ''}{hora(msg.createdAt)}</span>
        </div>
        {reacoes.length > 0 && (
          <div class="flex flex-wrap gap-1 mt-0.5">
            {reacoes.map(([e, ids]) => (
              <button key={e} type="button" class="rounded-full border border-border bg-surface px-1.5 text-xs hover:bg-surface-3" onClick={() => reagir.mutate({ id: msg.id, emoji: e, conversaId: props.conversaId })}>
                {e} <span class="text-2xs text-fg-muted">{ids.length}</span>
              </button>
            ))}
          </div>
        )}
        {!msg.apagada && (
          <div class={cn('flex items-center gap-0.5 mt-0.5 text-fg-muted transition-opacity', acoes ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
            <button type="button" class="size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-fg" title="Responder" aria-label="Responder" onClick={props.onResponder}><CornerUpLeft size={13} /></button>
            <div class="relative">
              <button type="button" class="size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-fg" title="Reagir" aria-label="Reagir" onClick={() => setEmojis((v) => !v)}><Smile size={13} /></button>
              {emojis && (
                <div class={cn('absolute bottom-7 z-20 flex gap-0.5 rounded-full border border-border bg-surface-2 p-1 shadow-lg', msg.minha ? 'right-0' : 'left-0')}>
                  {EMOJIS_DA_EQUIPE.map((e) => (
                    <button key={e} type="button" class="size-7 rounded-full hover:bg-surface-3 text-base" onClick={() => { reagir.mutate({ id: msg.id, emoji: e, conversaId: props.conversaId }); setEmojis(false) }}>{e}</button>
                  ))}
                </div>
              )}
            </div>
            {msg.minha && msg.corpo && <button type="button" class="size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-fg" title="Editar" aria-label="Editar" onClick={props.onEditar}><Pencil size={12} /></button>}
            {(msg.minha || props.podeApagarAlheia) && (
              <button
                type="button" class="size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-danger" title="Apagar" aria-label="Apagar"
                onClick={() => { if (window.confirm('Apagar esta mensagem para todos?')) apagar.mutate({ id: msg.id, conversaId: props.conversaId }) }}
              ><Trash2 size={12} /></button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
