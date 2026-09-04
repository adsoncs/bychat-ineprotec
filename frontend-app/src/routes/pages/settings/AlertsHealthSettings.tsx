// AlertsHealthSettings — o sino está ajudando ou virando ruído?
//
// Esta tela existe por um motivo específico e vale registrar: em um único dia
// de uso real, três produtores de alerta acusaram coisa errada. O "lead sem
// resposta" abriu 99 alertas numa instalação e só 11 procediam — os outros
// cobravam de pessoas com nome conversas que elas já tinham resolvido. A raiz
// era sempre a mesma: o produtor lia um campo do banco como se fosse um fato de
// comportamento, e isso acerta numa operação e erra na outra.
//
// A diferença entre acertar e errar não está no código, está na casa. Por isso
// o instrumento vem ANTES do próximo produtor: sem medir descarte e leitura por
// tipo, cada alerta novo é uma aposta que só o cliente paga. Um tipo
// majoritariamente descartado está errado, e o número diz sem precisar de
// reunião.
//
// Desligar é por instalação, não por pessoa: silenciar um tipo na própria caixa
// é decisão de quem recebe e mora no sino. Aqui é outra pergunta — "este tipo
// faz sentido nesta empresa?" — e ela é de quem administra.

import { useState } from 'preact/hooks'
import { Bell } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useAlertHealth, useToggleAlertProducer, type SaudeDoTipo } from '@/hooks/useAlerts'

const PERIODOS = [
  { value: '7', label: 'últimos 7 dias' },
  { value: '30', label: 'últimos 30 dias' },
  { value: '90', label: 'últimos 90 dias' },
]

const VEREDICTO: Record<SaudeDoTipo['veredicto'], { rotulo: string; tone: 'danger' | 'warning' | 'success' | 'neutral' }> = {
  ruido: { rotulo: 'Ruído', tone: 'danger' },
  irrelevante: { rotulo: 'Ninguém lê', tone: 'warning' },
  saudavel: { rotulo: 'Saudável', tone: 'success' },
  sem_amostra: { rotulo: 'Sem amostra', tone: 'neutral' },
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function AlertsHealthSettings() {
  const [dias, setDias] = useState('30')
  const { data, isLoading } = useAlertHealth(Number(dias))
  const alternar = useToggleAlertProducer()

  const tipos = data?.tipos ?? []
  const desligados = tipos.filter((t) => !t.ativo).length

  function alternarTipo(t: SaudeDoTipo) {
    alternar.mutate(
      { kind: t.kind, ativo: !t.ativo },
      {
        onSuccess: (r) => {
          toast(
            r.ativo
              ? `"${t.oque || t.kind}" voltou a avisar`
              : `"${t.oque || t.kind}" desligado${r.fechados ? ` — ${r.fechados} alerta(s) aberto(s) fechado(s) junto` : ''}`,
            'success',
          )
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 class="text-base font-semibold flex items-center gap-2">
            <Bell size={16} /> Saúde dos alertas
          </h2>
          <p class="text-xs text-fg-muted mt-1 max-w-2xl">
            Um alerta que as pessoas descartam sem resolver não está ajudando — está gastando
            a atenção que o próximo alerta vai precisar. Aqui dá para ver qual tipo virou ruído
            e desligá-lo nesta instalação.
          </p>
        </div>
        <Select value={dias} onChange={(e) => setDias((e.target as HTMLSelectElement).value)}>
          {PERIODOS.map((p) => <option value={p.value}>{p.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div class="space-y-2">
          <Skeleton class="h-16" />
          <Skeleton class="h-16" />
          <Skeleton class="h-16" />
        </div>
      ) : (
        <div class="space-y-2">
          {tipos.map((t) => {
            const v = VEREDICTO[t.veredicto]
            return (
              <Card key={t.kind} class={t.ativo ? undefined : 'opacity-60'}>
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-medium text-sm">{t.oque || t.kind}</span>
                      <Badge tone={v.tone}>{v.rotulo}</Badge>
                      {!t.ativo && <Badge tone="neutral">desligado</Badge>}
                    </div>
                    <div class="text-3xs text-fg-muted mt-0.5 font-mono">{t.kind}</div>
                    <p class="text-xs text-fg-muted mt-2">{t.recomendacao}</p>
                  </div>
                  <Switch
                    checked={t.ativo}
                    disabled={alternar.isPending}
                    ariaLabel={`${t.ativo ? 'Desligar' : 'Ligar'} ${t.oque || t.kind}`}
                    onChange={() => alternarTipo(t)}
                  />
                </div>

                {/* Os números crus embaixo da frase: quem discorda da recomendação
                    precisa poder conferir a conta sem abrir o banco. */}
                <div class="mt-3 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <Numero rotulo="Abertos agora" valor={String(t.abertos)} />
                  <Numero rotulo="Resolvidos" valor={String(t.resolvidos)} />
                  <Numero
                    rotulo="Descartados"
                    valor={t.destinatarios ? `${t.descartes} (${pct(t.taxaDescarte)})` : String(t.descartes)}
                    alerta={t.taxaDescarte >= 0.5 && t.destinatarios > 0}
                  />
                  <Numero
                    rotulo="Nunca abertos"
                    valor={t.destinatarios ? `${t.naoLidos} (${pct(t.taxaNaoLido)})` : String(t.naoLidos)}
                    alerta={t.taxaNaoLido >= 0.7 && t.destinatarios > 0}
                  />
                  <Numero
                    rotulo="Até resolver"
                    valor={t.horasAteResolver !== null ? `~${t.horasAteResolver}h` : '—'}
                  />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <p class="text-xs text-fg-muted">
        Desligar um tipo fecha também os alertas que ele já tinha aberto — sem isso eles
        ficariam de pé para sempre, porque não sobra produtor que os resolva.
        {desligados > 0 && ` ${desligados} tipo(s) desligado(s) nesta instalação.`}
      </p>
    </div>
  )
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <div class="text-3xs text-fg-muted">{rotulo}</div>
      <div class={alerta ? 'font-medium text-danger' : 'font-medium'}>{valor}</div>
    </div>
  )
}
