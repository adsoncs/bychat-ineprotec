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
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

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

/**
 * Limiares de cada produtor, ao lado do produtor.
 *
 * Moram AQUI, e não numa tela de configuração separada, de propósito: se "este
 * alerta está errado" fica numa tela e o botão de consertar fica em outra,
 * ninguém ajusta. É a mesma lição que fez esta aba existir — o diagnóstico e a
 * alavanca precisam caber no mesmo olhar.
 */
const LIMIARES: Record<string, Array<{ key: string; label: string; hint: string }>> = {
  'lead.stale': [
    { key: 'alertas.lead_parado_dias', label: 'Dias sem resposta', hint: 'quanto tempo sem retorno nosso vira alerta' },
    { key: 'alertas.lead_janela_dias', label: 'Janela (dias)', hint: 'mais velho que isto é acervo, não alerta' },
  ],
  'negotiation.stalled': [
    { key: 'alertas.negociacao_parada_dias', label: 'Dias sem movimento', hint: 'proposta parada por este tempo vira alerta' },
    { key: 'alertas.negociacao_janela_dias', label: 'Janela (dias)', hint: 'mais velho que isto é acervo' },
  ],
  'activity.overdue': [
    { key: 'alertas.atividade_janela_dias', label: 'Janela (dias)', hint: 'venceu há mais que isto: vira acervo' },
  ],
}

/** O que não pertence a nenhum produtor: vale para o sino inteiro. */
const GLOBAIS: Array<{ key: string; label: string; hint: string; tipo: 'bool' | 'num' }> = [
  { key: 'alertas.digest_ativo', label: 'Resumo diário', hint: 'manda as pendências por WhatsApp/e-mail uma vez ao dia', tipo: 'bool' },
  { key: 'alertas.digest_hora', label: 'Hora do resumo', hint: '0 a 23', tipo: 'num' },
  { key: 'alertas.escalonamento_ativo', label: 'Escalonar crítico', hint: 'crítico que ninguém abriu sai do painel — no máximo 2 avisos', tipo: 'bool' },
  { key: 'alertas.escalonamento_horas', label: 'Carência (horas)', hint: 'espera antes do primeiro aviso fora do painel', tipo: 'num' },
  { key: 'alertas.escalonamento_reforco_horas', label: 'Reforço (horas)', hint: 'entre o primeiro e o segundo aviso', tipo: 'num' },
  { key: 'alertas.retencao_dias', label: 'Retenção (dias)', hint: 'apaga alerta já RESOLVIDO; aberto nunca é apagado', tipo: 'num' },
]

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function AlertsHealthSettings() {
  const [dias, setDias] = useState('30')
  const { data, isLoading } = useAlertHealth(Number(dias))
  const alternar = useToggleAlertProducer()
  const settings = useSettings()
  const salvar = useUpdateSettings()
  // Rascunho por chave: o campo é numérico e salvar a cada tecla mandaria
  // `alertas.lead_parado_dias = 1` no caminho de digitar "10".
  const [draft, setDraft] = useState<Record<string, string>>({})

  const valorDe = (key: string): string => {
    if (draft[key] !== undefined) return draft[key]!
    const raw = settings.data?.settings.find((x: any) => x.key === key)?.value
    return String(raw ?? '').replace(/"/g, '')
  }
  const sujo = Object.keys(draft).some((k) => {
    const raw = settings.data?.settings.find((x: any) => x.key === k)?.value
    return draft[k] !== String(raw ?? '').replace(/"/g, '')
  })

  function gravar() {
    const mudou: Record<string, string> = {}
    for (const k of Object.keys(draft)) {
      const raw = String(settings.data?.settings.find((x: any) => x.key === k)?.value ?? '').replace(/"/g, '')
      if (draft[k] !== raw) mudou[k] = draft[k]!
    }
    if (!Object.keys(mudou).length) return
    salvar.mutate(mudou as any, {
      onSuccess: () => { setDraft({}); toast('Limiares salvos — valem na próxima varredura', 'success') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

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

                {/* O limiar mora junto do veredicto: quem acabou de ler
                    "60% descartado" tem o ajuste na mesma altura do olho. */}
                {LIMIARES[t.kind] && (
                  <div class="mt-3 pt-3 border-t border-border flex flex-wrap gap-4">
                    {LIMIARES[t.kind]!.map((l) => (
                      <label key={l.key} class="block">
                        <span class="block text-3xs text-fg-muted mb-1">{l.label}</span>
                        <Input
                          type="number"
                          min="1"
                          class="w-24"
                          value={valorDe(l.key)}
                          disabled={!t.ativo}
                          onInput={(e) => setDraft((d) => ({ ...d, [l.key]: (e.target as HTMLInputElement).value }))}
                        />
                        <span class="block text-3xs text-fg-muted mt-1 max-w-[14rem]">{l.hint}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Card>
        <div class="mb-3">
          <h3 class="text-sm font-semibold">Vale para o sino inteiro</h3>
          <p class="text-xs text-fg-muted mt-1 max-w-2xl">
            Resumo diário e escalonamento nascem <strong>desligados</strong>: canal externo é
            intrusivo, e ninguém pediu WhatsApp diário ao ligar o sino. O escalonamento só sai
            do painel para <strong>crítico que ninguém abriu</strong>, com teto de dois avisos.
          </p>
        </div>
        <div class="flex flex-wrap gap-5">
          {GLOBAIS.map((g) => (
            <div key={g.key} class="max-w-[15rem]">
              <span class="block text-3xs text-fg-muted mb-1">{g.label}</span>
              {g.tipo === 'bool' ? (
                <Switch
                  checked={valorDe(g.key) === 'true'}
                  ariaLabel={g.label}
                  onChange={(v) => setDraft((d) => ({ ...d, [g.key]: v ? 'true' : 'false' }))}
                />
              ) : (
                <Input
                  type="number"
                  min="0"
                  class="w-24"
                  value={valorDe(g.key)}
                  onInput={(e) => setDraft((d) => ({ ...d, [g.key]: (e.target as HTMLInputElement).value }))}
                />
              )}
              <span class="block text-3xs text-fg-muted mt-1">{g.hint}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* A barra só aparece com mudança pendente: botão salvo permanente na
          tela ensina que há algo por salvar mesmo quando não há. */}
      {sujo && (
        <div class="sticky bottom-0 flex items-center justify-end gap-3 py-3 bg-surface-1 border-t border-border">
          <span class="text-xs text-fg-muted">Alterações não salvas</span>
          <Button variant="ghost" onClick={() => setDraft({})} disabled={salvar.isPending}>Descartar</Button>
          <Button onClick={gravar} disabled={salvar.isPending}>Salvar</Button>
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
