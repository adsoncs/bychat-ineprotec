// StatusIntegracoesSettings — o que aparece na barra de status do topbar.
//
// Cada cliente tem um conjunto diferente de integrações: um usa só WhatsApp,
// outro tem IA, Google, Instagram e SMS. Por isso a barra nunca liga "tudo":
// item não configurado no sistema nem aparece, e cada item configurado tem duas
// chaves —
//   Na barra    → o quadradinho aparece no topbar;
//   Aviso fixo  → quando fica fora do ar, abre a faixa vermelha para todos.
//
// Quem VÊ a barra e quem configura é decidido em Permissões (módulo "Status
// das integrações"): Ver = enxerga a barra; Editar = esta tela, o detalhe
// técnico e o botão de resolver.

import { Activity, RefreshCw } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Switch, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import {
  useConfigStatusIntegracoes, useSalvarConfigStatus, useVerificarStatusAgora, desdeQuando, haQuanto,
  type ItemDeConfig, type EstadoIntegracao,
} from '@/hooks/useStatusIntegracoes'

const ESTADO: Record<EstadoIntegracao, { rotulo: string; cor: string }> = {
  ok: { rotulo: 'Funcionando', cor: 'var(--color-success)' },
  atencao: { rotulo: 'Atenção', cor: 'var(--color-warning)' },
  fora: { rotulo: 'Fora do ar', cor: 'var(--color-danger)' },
}

const FAIXA = [
  { value: 'todos', label: 'Todos que veem a barra' },
  { value: 'gestao', label: 'Só quem configura (gestão)' },
]

export function StatusIntegracoesSettings() {
  const { data, isLoading, error } = useConfigStatusIntegracoes()
  const salvar = useSalvarConfigStatus()
  const verificar = useVerificarStatusAgora()

  function gravar(body: Parameters<typeof salvar.mutate>[0], ok: string) {
    salvar.mutate(body, {
      onSuccess: () => toast(ok, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function item(it: ItemDeConfig, campo: 'mostrar' | 'avisoFixo', v: boolean) {
    const nome = campo === 'mostrar' ? 'na barra' : 'com aviso fixo'
    gravar({ itens: { [it.id]: { [campo]: v } } }, `${it.rotulo}: ${v ? 'aparece' : 'não aparece'} ${nome}`)
  }

  if (isLoading) return <Skeleton class="h-64" />
  if (error || !data) {
    return <Card class="p-4 text-sm text-fg-muted">Sem permissão para configurar a barra de status, ou ela não respondeu.</Card>
  }

  const configurados = data.itens.filter((i) => i.configurado)
  const ausentes = data.itens.filter((i) => !i.configurado)

  return (
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-base font-semibold flex items-center gap-2">
            <Activity size={16} /> Barra de status
          </h2>
          <p class="text-sm text-fg-muted max-w-2xl">
            Quadradinhos no topo da tela com o estado de cada integração e uma faixa vermelha fixa quando uma delas para.
            Só aparecem as integrações que este sistema usa. Quem vê e quem configura é definido em Permissões › Status das integrações.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={verificar.isPending}
          onClick={() => verificar.mutate(undefined, {
            onSuccess: () => toast('Verificado agora', 'success'),
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        >
          <RefreshCw size={14} class={verificar.isPending ? 'animate-spin' : ''} />
          {verificar.isPending ? 'Verificando…' : 'Verificar agora'}
        </Button>
      </div>

      <Card class="p-4 space-y-4">
        <Switch
          checked={data.ativo}
          onChange={(v) => gravar({ ativo: v }, v ? 'Barra de status ligada' : 'Barra de status desligada')}
          label="Mostrar a barra de status"
          hint="Desligada, some do topo para todos e nenhuma integração é verificada."
        />
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-sm text-fg">Quem vê a faixa vermelha</span>
          <Select
            value={data.faixaPara}
            onChange={(e: any) => gravar({ faixaPara: e.currentTarget.value }, 'Preferência da faixa salva')}
            disabled={!data.ativo}
          >
            {FAIXA.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <p class="text-3xs text-fg-muted">
          Verificado {haQuanto(data.verificadoEm)} · a cada {data.intervaloMin} min. A IA é testada de hora em hora com uma chamada mínima (cerca de 5 tokens).
        </p>
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-2 text-3xs uppercase tracking-wider text-fg-muted font-semibold border-b border-border">
          <span>Integração</span>
          <span>Na barra</span>
          <span>Aviso fixo</span>
        </div>
        {configurados.length === 0 && (
          <div class="px-4 py-6 text-sm text-fg-muted">Nenhuma integração configurada neste sistema ainda.</div>
        )}
        {configurados.map((it) => {
          const e = it.estado ? ESTADO[it.estado] : null
          return (
            <div key={it.id} class="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-3 border-b border-border last:border-b-0">
              <div class="min-w-0 space-y-0.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-fg">{it.rotulo}</span>
                  {e && it.mostrar && data.ativo ? (
                    <span class="inline-flex items-center gap-1.5 text-3xs font-semibold" style={{ color: e.cor }}>
                      <span class="size-2 rounded-full" style={{ background: e.cor }} />
                      {e.rotulo}
                    </span>
                  ) : (
                    <span class="text-3xs text-fg-muted">não verificado (fora da barra)</span>
                  )}
                </div>
                {it.motivo && it.mostrar && data.ativo && (
                  <div class="text-xs text-fg-muted">
                    {it.motivo}{it.estado !== 'ok' && it.desde ? ` — desde ${desdeQuando(it.desde)}` : ''}
                  </div>
                )}
                {it.detalhe && it.mostrar && data.ativo && (
                  <div class="text-3xs text-fg-muted font-mono break-words line-clamp-2" title={it.detalhe}>{it.detalhe}</div>
                )}
              </div>
              <Switch
                checked={it.mostrar}
                disabled={!data.ativo || salvar.isPending}
                onChange={(v) => item(it, 'mostrar', v)}
                ariaLabel={`${it.rotulo} na barra`}
              />
              <Switch
                checked={it.avisoFixo}
                disabled={!data.ativo || !it.mostrar || salvar.isPending}
                onChange={(v) => item(it, 'avisoFixo', v)}
                ariaLabel={`${it.rotulo} com aviso fixo`}
              />
            </div>
          )
        })}
      </Card>

      {ausentes.length > 0 && (
        <p class="text-xs text-fg-muted">
          Não configurado neste sistema (não aparece na barra): {ausentes.map((i) => i.rotulo).join(', ')}.
          Ao configurar, entra na barra sozinho — dá para tirar aqui.
        </p>
      )}
    </div>
  )
}
