// components/shell/StatusIntegracoes.tsx
//
// Barra de status das integrações — a "Opção B" aprovada em 19/10/2026:
//
//   BlocoDeStatus  → no topbar, entre a busca e os ícones: um quadradinho por
//                    integração + o resumo em texto ("Tudo funcionando",
//                    "1 fora do ar · 1 em atenção"). Hover no quadradinho mostra
//                    o detalhe; clique abre o painel com todas.
//   FaixaDeStatus  → logo abaixo do topbar, vermelha, enquanto houver
//                    integração fora do ar. Some sozinha quando o problema é
//                    resolvido.
//
// A faixa fecha (pedido de 19/10), mas só até o próximo login: o sino já era
// fechável para sempre e foi assim que a IA de terram e ineprotec ficou três
// semanas fora (29/09→19/10) sem ninguém ver. Fechar também não cala problema
// NOVO — o que fica gravado é a lista do que estava fora; se outra integração
// cair (ou a mesma cair de novo), a faixa volta. Quem não quer a faixa para um
// item desliga o "aviso fixo" dele em Configurações › Barra de status.

import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useLocation } from 'wouter-preact'
import { AlertTriangle, RefreshCw, X } from '@/components/ui/icon-set'
import { useState } from 'preact/hooks'
import { FAIXA_FECHADA_KEY } from '@/lib/apiClient'
import { Icon } from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/icons'
import { ICON_SIZE } from '@/components/ui/Icon'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { cn } from '@/lib/cn'
import {
  useStatusIntegracoes, useVerificarStatusAgora, usePainelDeStatus, desdeQuando, haQuanto,
  type EstadoIntegracao, type ItemDaBarra,
} from '@/hooks/useStatusIntegracoes'

const ICONE: Record<string, IconName> = {
  ia: 'Sparkles',
  whatsapp_api: 'Cloud',
  whatsapp: 'Phone',
  instagram: 'Instagram',
  meta: 'Megaphone',
  google: 'Globe',
  email: 'Mail',
  sms: 'MessageSquare',
}

const COR: Record<EstadoIntegracao, string> = {
  ok: 'var(--color-success)',
  atencao: 'var(--color-warning)',
  fora: 'var(--color-danger)',
}

/**
 * Vermelho da faixa: fixo nos dois temas. O `--color-danger` do tema escuro é
 * claro (feito para texto sobre fundo escuro) e, como fundo, deixa o texto
 * branco ilegível — e esta é a única faixa que não pode ser ilegível.
 */
const VERMELHO_FAIXA = '#B42323'

const ROTULO_ESTADO: Record<EstadoIntegracao, string> = {
  ok: 'Funcionando',
  atencao: 'Atenção',
  fora: 'Fora do ar',
}

/** Fundo suave da cor do estado — funciona nos dois temas sem cor nova. */
function tinta(estado: EstadoIntegracao, pct: number): string {
  return `color-mix(in srgb, ${COR[estado]} ${pct}%, transparent)`
}

function pior(itens: ItemDaBarra[]): EstadoIntegracao {
  if (itens.some((i) => i.estado === 'fora')) return 'fora'
  if (itens.some((i) => i.estado === 'atencao')) return 'atencao'
  return 'ok'
}

function resumo(itens: ItemDaBarra[]): string {
  const f = itens.filter((i) => i.estado === 'fora').length
  const a = itens.filter((i) => i.estado === 'atencao').length
  if (!f && !a) return 'Tudo funcionando'
  return [f && `${f} fora do ar`, a && `${a} em atenção`].filter(Boolean).join(' · ')
}

function Quadradinho({ item, tamanho = 22 }: { item: ItemDaBarra; tamanho?: number }) {
  return (
    <span
      class="grid place-items-center rounded-md shrink-0"
      style={{
        width: `${tamanho}px`,
        height: `${tamanho}px`,
        color: item.estado === 'ok' ? COR.ok : '#fff',
        background: item.estado === 'ok' ? tinta('ok', 14) : COR[item.estado],
      }}
      aria-hidden="true"
    >
      <Icon name={ICONE[item.id] ?? 'Globe'} size="xs" />
    </span>
  )
}

function DetalheDoItem({ item, compacto }: { item: ItemDaBarra; compacto?: boolean }) {
  return (
    <div class="space-y-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-fg">{item.rotulo}</span>
        <span
          class="text-3xs font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: tinta(item.estado, 18), color: COR[item.estado] }}
        >
          {ROTULO_ESTADO[item.estado]}
        </span>
      </div>
      <div class="text-xs text-fg leading-snug">{item.motivo}</div>
      {item.estado !== 'ok' && (
        <div class="text-3xs text-fg-muted">desde {desdeQuando(item.desde)}</div>
      )}
      {!compacto && item.detalhe && (
        <div class="text-3xs text-fg-muted font-mono break-words line-clamp-3" title={item.detalhe}>{item.detalhe}</div>
      )}
    </div>
  )
}

/** Bloco do topbar: quadradinhos + resumo. Clique abre o painel. */
export function BlocoDeStatus() {
  const { data } = useStatusIntegracoes()
  const layout = useShellLayout()
  const aberto = usePainelDeStatus((s) => s.aberto)
  const abrir = usePainelDeStatus((s) => s.abrir)
  const itens = data?.ativo ? data.itens : []
  if (!data || itens.length === 0) return null

  const estado = pior(itens)
  const texto = resumo(itens)
  const celular = layout === 'mobile'

  return (
    <Popover.Root open={aberto} onOpenChange={abrir}>
      <Tooltip.Provider delayDuration={150}>
        <Popover.Trigger asChild>
          <button
            type="button"
            class="flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-lg border shrink-0 transition-colors"
            style={{ borderColor: tinta(estado, 40), background: tinta(estado, 10) }}
            aria-label={`Status das integrações: ${texto}`}
          >
            {celular ? (
              <span class="size-2.5 rounded-full" style={{ background: COR[estado] }} />
            ) : (
              <span class="hidden lg:inline text-xs font-semibold whitespace-nowrap" style={{ color: estado === 'ok' ? 'var(--color-fg)' : COR[estado] }}>
                {texto}
              </span>
            )}
            <span class="flex items-center gap-1">
              {(celular ? itens.filter((i) => i.estado !== 'ok') : itens).map((it) => (
                <Tooltip.Root key={it.id}>
                  <Tooltip.Trigger asChild>
                    <span><Quadradinho item={it} /></span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="bottom"
                      sideOffset={8}
                      class="w-[18rem] rounded-lg bg-surface-2 border border-border shadow-xl surface-raised p-3"
                      style={{ zIndex: 'var(--z-tooltip)' }}
                    >
                      <DetalheDoItem item={it} compacto />
                      <Tooltip.Arrow class="fill-[color:var(--color-surface-2)]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ))}
            </span>
          </button>
        </Popover.Trigger>
      </Tooltip.Provider>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          class="w-[22rem] max-w-[calc(100vw-2rem)] rounded-panel bg-surface-2 border border-border shadow-xl surface-raised overflow-hidden"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <PainelDeStatus itens={itens} verificadoEm={data.verificadoEm} intervaloMin={data.intervaloMin} podeConfigurar={data.podeConfigurar} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function PainelDeStatus(
  { itens, verificadoEm, intervaloMin, podeConfigurar }:
  { itens: ItemDaBarra[]; verificadoEm: string; intervaloMin: number; podeConfigurar: boolean },
) {
  const [, navigate] = useLocation()
  const abrir = usePainelDeStatus((s) => s.abrir)
  const verificar = useVerificarStatusAgora()
  // Problema primeiro: é o que a pessoa veio ver.
  const ordem: Record<EstadoIntegracao, number> = { fora: 0, atencao: 1, ok: 2 }
  const lista = [...itens].sort((a, b) => ordem[a.estado] - ordem[b.estado])

  return (
    <div>
      <div class="px-4 pt-3 pb-2 text-3xs uppercase tracking-wider text-fg-muted font-semibold">Status das integrações</div>
      <ul class="max-h-[60vh] overflow-y-auto">
        {lista.map((it) => (
          <li key={it.id} class="flex items-start gap-3 px-4 py-2.5 border-t border-border">
            <Quadradinho item={it} tamanho={26} />
            <div class="flex-1 min-w-0 space-y-1.5">
              <DetalheDoItem item={it} />
              {it.acao && it.estado !== 'ok' && (
                <button
                  type="button"
                  class="h-7 px-2.5 rounded-md text-xs font-semibold bg-surface-3 hover:bg-border text-fg"
                  onClick={() => { abrir(false); navigate(it.acao!.href) }}
                >
                  {it.acao.rotulo}
                </button>
              )}
              {!it.acao && it.estado === 'fora' && (
                <div class="text-3xs text-fg-muted">Avise o administrador do sistema.</div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div class="flex items-center gap-2 px-4 py-2.5 border-t border-border text-3xs text-fg-muted">
        <span class="flex-1">Verificado {haQuanto(verificadoEm)} · atualiza a cada {intervaloMin} min</span>
        {podeConfigurar && (
          <>
            <button
              type="button"
              class="inline-flex items-center gap-1 h-6 px-2 rounded hover:bg-surface-3 text-fg"
              disabled={verificar.isPending}
              onClick={() => verificar.mutate()}
            >
              <RefreshCw size={ICON_SIZE.xs} class={cn(verificar.isPending && 'animate-spin')} />
              {verificar.isPending ? 'Verificando…' : 'Verificar agora'}
            </button>
            <button
              type="button"
              class="h-6 px-2 rounded hover:bg-surface-3 text-fg"
              onClick={() => { abrir(false); navigate('/app/settings?tab=integration-status') }}
            >
              Configurar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function lerFechada(): string | null {
  try { return localStorage.getItem(FAIXA_FECHADA_KEY) } catch { return null }
}

/** Faixa vermelha fixa abaixo do topbar — enquanto algo estiver fora do ar. */
export function FaixaDeStatus() {
  const { data } = useStatusIntegracoes()
  const [, navigate] = useLocation()
  const abrir = usePainelDeStatus((s) => s.abrir)
  // O apiClient apaga esta chave ao entrar e ao sair: fechar vale até o próximo login.
  const [fechada, setFechada] = useState<string | null>(lerFechada)
  if (!data?.ativo || !data.faixa) return null
  const fora = data.itens.filter((i) => i.estado === 'fora' && i.avisoFixo)
  if (fora.length === 0) return null
  const assinatura = fora.map((i) => `${i.id}@${i.desde}`).sort().join('|')
  if (fechada === assinatura) return null
  function fechar() {
    try { localStorage.setItem(FAIXA_FECHADA_KEY, assinatura) } catch { /* sem storage: fecha só nesta tela */ }
    setFechada(assinatura)
  }
  const [primeiro] = fora
  const it = primeiro!

  return (
    <div
      role="alert"
      class="app-faixa-status flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm"
      style={{ background: VERMELHO_FAIXA, color: '#fff' }}
    >
      <AlertTriangle size={ICON_SIZE.md} class="shrink-0" />
      <span class="font-semibold">{it.rotulo} fora do ar</span>
      <span class="min-w-0">
        {it.motivo.charAt(0).toUpperCase() + it.motivo.slice(1)}. Desde {desdeQuando(it.desde)}.
        {!it.acao && ' Avise o administrador do sistema.'}
      </span>
      <span class="ml-auto flex items-center gap-2">
        {it.acao && (
          <button
            type="button"
            class="h-7 px-3 rounded-md text-xs font-semibold"
            style={{ background: '#fff', color: VERMELHO_FAIXA }}
            onClick={() => navigate(it.acao!.href)}
          >
            {it.acao.rotulo}
          </button>
        )}
        {fora.length > 1 && (
          <button type="button" class="h-7 px-2 text-xs font-semibold underline" onClick={() => abrir(true)}>
            Ver todas ({fora.length})
          </button>
        )}
        <button
          type="button"
          class="size-7 grid place-items-center rounded-md hover:bg-white/15"
          onClick={fechar}
          aria-label="Fechar aviso até o próximo login"
          title="Fechar até o próximo login"
        >
          <X size={ICON_SIZE.md} />
        </button>
      </span>
    </div>
  )
}
