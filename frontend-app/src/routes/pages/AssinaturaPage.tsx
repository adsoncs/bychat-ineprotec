// src/routes/pages/AssinaturaPage.tsx
//
// Painel do dono do produto: o que está pago, o que está vencendo, e as duas
// ações que só ele faz — dar baixa num mês que entrou por fora (PIX,
// transferência) e esticar a carência de quem avisou que paga depois.
//
// Fica FORA de Configurações de propósito. Configurações é a tela do cliente; o
// superadmin dele não pode alcançar nada da loja — nem descobrir que existe.
// Por isso a API responde 404, e não 403, para quem não é dono.

import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

type Estado = 'sem_direito' | 'vigente' | 'em_carencia' | 'sem_prazo'

interface Pacote {
  id: string
  rotulo: string
  instalado: boolean
  modulos: number
  modulosComDireito: number
  exige: Array<{ id: string; rotulo: string }>
  estado: Estado
  expiraEm: string | null
  diasRestantes: number | null
  /**
   * A assinatura comprada, separada do acesso. Podem discordar: quem já era
   * cliente antes da loja tem acesso sem prazo, e mesmo assim assina.
   */
  assinatura: { expiraEm: string; diasRestantes: number; vencida: boolean } | null
}

interface Evento {
  id: number
  tipo: string
  pacote: string | null
  competencia: string | null
  vencimentoNovo: string | null
  valorCentavos: number | null
  meio: string | null
  observacao: string | null
  feitoPor: string | null
  createdAt: string
}

interface Retrato {
  pacotes: Pacote[]
  eventos: Evento[]
  config: { carenciaDias: number; testeDias: number }
  instalacao: { modulos: number; vendaveis: number }
}

// O estado é o que a tela precisa dizer em uma palavra. "Em carência" não é
// "vencido": é o cliente que ainda trabalha e precisa ser cobrado hoje.
const ESTADO: Record<Estado, { texto: string; tom: 'success' | 'warning' | 'danger' | 'neutral'; ajuda: string }> = {
  vigente: { texto: 'Em dia', tom: 'success', ajuda: 'Pago e dentro do prazo.' },
  em_carencia: {
    texto: 'Em carência', tom: 'warning',
    ajuda: 'Venceu, mas continua funcionando pelos dias de carência. É agora que se cobra.',
  },
  // "Sem prazo" é o estado de quem já era cliente antes da loja: a migração deu
  // direito sem data. Em cinza, isso parecia falta de algo — é o contrário.
  sem_prazo: {
    texto: 'Liberado', tom: 'success',
    ajuda: 'Direito sem data de vencimento — não expira enquanto não for trocado por uma assinatura.',
  },
  sem_direito: { texto: 'Sem direito', tom: 'danger', ajuda: 'Os módulos deste pacote não abrem.' },
}

const MEIOS = [
  { v: 'pix', r: 'PIX' },
  { v: 'transferencia', r: 'Transferência' },
  { v: 'dinheiro', r: 'Dinheiro' },
  { v: 'outro', r: 'Outro' },
]

const TIPO_EVENTO: Record<string, string> = {
  teste: 'Teste iniciado',
  pago_manual: 'Pago por fora',
  carencia_estendida: 'Carência ajustada',
  renovado: 'Renovado',
  cancelado: 'Cancelado',
}

function dinheiro(centavos: number | null): string {
  if (centavos === null || centavos === undefined) return '—'
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function data(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

/** "2026-09" → "setembro de 2026", porque ninguém fala em AAAA-MM. */
function competenciaPorExtenso(c: string | null): string {
  if (!c) return '—'
  const [ano, mes] = c.split('-')
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${nomes[Number(mes) - 1] ?? mes} de ${ano}`
}

/** O mês corrente em AAAA-MM — o padrão do campo de competência. */
function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function AssinaturaPage() {
  const qc = useQueryClient()
  const [pagando, setPagando] = useState<Pacote | null>(null)
  const [ajustandoCarencia, setAjustandoCarencia] = useState(false)

  const { data: retrato, isLoading } = useQuery<Retrato>({
    queryKey: ['dono', 'assinatura'],
    queryFn: () => api.get<Retrato>('/dono/assinatura'),
  })

  const recarregar = () => qc.invalidateQueries({ queryKey: ['dono', 'assinatura'] })

  const pagar = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/dono/assinatura/pago', body),
    onSuccess: () => { toast('Pagamento registrado', 'success'); setPagando(null); recarregar() },
    onError: (e: Error) => toast(e.message || 'Não foi possível registrar', 'danger'),
  })

  const ajustarCarencia = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/dono/assinatura/carencia', body),
    onSuccess: () => { toast('Carência ajustada', 'success'); setAjustandoCarencia(false); recarregar() },
    onError: (e: Error) => toast(e.message || 'Não foi possível ajustar', 'danger'),
  })

  const iniciarTeste = useMutation({
    mutationFn: (pacote: string) => api.post('/dono/assinatura/teste', { pacote }),
    onSuccess: () => { toast('Teste iniciado', 'success'); recarregar() },
    onError: (e: Error) => toast(e.message || 'Não foi possível iniciar', 'danger'),
  })

  if (isLoading || !retrato) {
    return <Page title="Assinatura"><div class="text-sm text-fg-muted">Carregando…</div></Page>
  }

  const instalados = retrato.pacotes.filter((p) => p.instalado)
  const ausentes = retrato.pacotes.filter((p) => !p.instalado)
  // Vencendo primeiro: é a única informação da tela que pede ação hoje.
  const emCarencia = instalados.filter((p) => p.estado === 'em_carencia')

  return (
    <Page
      title="Assinatura"
      description="O que esta instalação tem direito de usar, e o que você pode ajustar à mão."
      actions={
        <Button variant="secondary" size="sm" onClick={() => setAjustandoCarencia(true)}>
          Carência: {retrato.config.carenciaDias} dias
        </Button>
      }
    >
      {emCarencia.length > 0 && (
        <Card class="border-warning/40 bg-warning/5 p-4">
          <div class="text-sm">
            <strong class="text-warning">
              {emCarencia.length === 1 ? '1 pacote em carência' : `${emCarencia.length} pacotes em carência`}
            </strong>{' '}
            — continua funcionando, mas o prazo está correndo:{' '}
            {emCarencia.map((p) => `${p.rotulo} (${p.diasRestantes}d)`).join(', ')}.
          </div>
        </Card>
      )}

      <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {instalados.map((p) => {
          const e = ESTADO[p.estado]
          return (
            <Card key={p.id} class="p-4 flex flex-col gap-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h3 class="font-medium text-fg truncate">{p.rotulo}</h3>
                  <p class="text-xs text-fg-muted mt-0.5">
                    {p.modulosComDireito} de {p.modulos}{' '}
                    {p.modulos === 1 ? 'módulo liberado' : 'módulos liberados'}
                  </p>
                </div>
                <Badge tone={e.tom} title={e.ajuda}>{e.texto}</Badge>
              </div>

              <dl class="text-xs space-y-1">
                <div class="flex justify-between gap-2">
                  <dt class="text-fg-muted">Vencimento</dt>
                  <dd class="tabular-nums">
                    {p.estado === 'sem_prazo' ? 'não vence' : data(p.expiraEm)}
                  </dd>
                </div>
                {p.diasRestantes !== null && (
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">
                      {p.estado === 'em_carencia' ? 'Carência restante' : 'Dias restantes'}
                    </dt>
                    <dd class="tabular-nums">{p.diasRestantes} dias</dd>
                  </div>
                )}
                {p.assinatura && (
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Assinatura paga até</dt>
                    <dd class={`tabular-nums ${p.assinatura.vencida ? 'text-warning' : ''}`}>
                      {data(p.assinatura.expiraEm)}
                    </dd>
                  </div>
                )}
                {p.exige.length > 0 && (
                  <div class="flex justify-between gap-2">
                    <dt class="text-fg-muted">Precisa de</dt>
                    <dd>{p.exige.map((x) => x.rotulo).join(', ')}</dd>
                  </div>
                )}
              </dl>

              <div class="flex gap-2 mt-auto pt-1">
                <Button size="sm" variant="secondary" onClick={() => setPagando(p)}>
                  Marcar como pago
                </Button>
                {p.estado === 'sem_direito' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={iniciarTeste.isPending}
                    onClick={() => iniciarTeste.mutate(p.id)}
                  >
                    Testar {retrato.config.testeDias}d
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </section>

      {ausentes.length > 0 && (
        <Card class="p-4">
          <h3 class="text-sm font-medium text-fg mb-1">Não instalado aqui</h3>
          {/* "Não instalado" não é "não pago": são coisas diferentes, e a
              distinção evita vender ERP a quem não roda ERP. */}
          <p class="text-xs text-fg-muted mb-2">
            Esta instalação não roda estes pacotes — não há o que liberar, e a loja não os oferece.
          </p>
          <div class="flex flex-wrap gap-1.5">
            {ausentes.map((p) => <Badge key={p.id} tone="neutral">{p.rotulo}</Badge>)}
          </div>
        </Card>
      )}

      <Card class="p-4">
        <h3 class="text-sm font-medium text-fg mb-3">O que foi feito à mão</h3>
        {retrato.eventos.length === 0 ? (
          <p class="text-xs text-fg-muted">
            Nada ainda. Pagamento por fora e ajuste de prazo aparecem aqui, com data e autor.
          </p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="text-fg-muted">
                <tr class="text-left">
                  <th class="pb-2 pr-3 font-medium">Quando</th>
                  <th class="pb-2 pr-3 font-medium">O quê</th>
                  <th class="pb-2 pr-3 font-medium">Pacote</th>
                  <th class="pb-2 pr-3 font-medium">Competência</th>
                  <th class="pb-2 pr-3 font-medium text-right">Valor</th>
                  <th class="pb-2 pr-3 font-medium">Meio</th>
                  <th class="pb-2 font-medium">Quem</th>
                </tr>
              </thead>
              <tbody>
                {retrato.eventos.map((ev) => (
                  <tr key={ev.id} class="border-t border-border">
                    <td class="py-2 pr-3 tabular-nums whitespace-nowrap">{data(ev.createdAt)}</td>
                    <td class="py-2 pr-3">{TIPO_EVENTO[ev.tipo] ?? ev.tipo}</td>
                    <td class="py-2 pr-3">
                      {retrato.pacotes.find((p) => p.id === ev.pacote)?.rotulo ?? ev.pacote ?? '—'}
                    </td>
                    <td class="py-2 pr-3">{competenciaPorExtenso(ev.competencia)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums">{dinheiro(ev.valorCentavos)}</td>
                    <td class="py-2 pr-3">{MEIOS.find((m) => m.v === ev.meio)?.r ?? '—'}</td>
                    <td class="py-2 text-fg-muted truncate max-w-[14rem]" title={ev.feitoPor ?? ''}>
                      {ev.feitoPor ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ModalPagamento
        pacote={pagando}
        onFechar={() => setPagando(null)}
        onConfirmar={(body) => pagar.mutate(body)}
        salvando={pagar.isPending}
      />

      <ModalCarencia
        aberto={ajustandoCarencia}
        atual={retrato.config.carenciaDias}
        onFechar={() => setAjustandoCarencia(false)}
        onConfirmar={(body) => ajustarCarencia.mutate(body)}
        salvando={ajustarCarencia.isPending}
      />
    </Page>
  )
}

function ModalPagamento({ pacote, onFechar, onConfirmar, salvando }: {
  pacote: Pacote | null
  onFechar: () => void
  onConfirmar: (body: Record<string, unknown>) => void
  salvando: boolean
}) {
  const [competencia, setCompetencia] = useState(mesAtual())
  const [meses, setMeses] = useState('1')
  const [valor, setValor] = useState('')
  const [meio, setMeio] = useState('pix')
  const [observacao, setObservacao] = useState('')

  function confirmar() {
    // Reais na tela, centavos no banco: guardar decimal é como se perde
    // centavo na conferência de caixa.
    const limpo = valor.replace(/\./g, '').replace(',', '.')
    const centavos = limpo ? Math.round(Number(limpo) * 100) : undefined
    onConfirmar({
      pacote: pacote?.id,
      competencia,
      meses: Number(meses),
      ...(centavos !== undefined && Number.isFinite(centavos) ? { valorCentavos: centavos } : {}),
      meio,
      ...(observacao ? { observacao } : {}),
    })
  }

  return (
    <Modal
      open={!!pacote}
      onOpenChange={(o) => !o && onFechar()}
      title={`Marcar como pago — ${pacote?.rotulo ?? ''}`}
      description="Para o dinheiro que entra por fora e não passa pelo provedor."
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando ? 'Registrando…' : 'Registrar pagamento'}
          </Button>
        </div>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <Input
            label="Competência" type="month" value={competencia}
            onInput={(e) => setCompetencia((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Meses pagos" type="number" min="1" max="36" value={meses}
            onInput={(e) => setMeses((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <Input
            label="Valor recebido (R$)" inputMode="decimal" placeholder="499,00" value={valor}
            onInput={(e) => setValor((e.target as HTMLInputElement).value)}
          />
          <label class="block">
            <span class="text-xs text-fg-muted block mb-1">Como entrou</span>
            <select
              class="w-full h-9 px-3 text-sm rounded-md bg-surface-2 border border-border text-fg"
              value={meio}
              onChange={(e) => setMeio((e.target as HTMLSelectElement).value)}
            >
              {MEIOS.map((m) => <option key={m.v} value={m.v}>{m.r}</option>)}
            </select>
          </label>
        </div>

        <Input
          label="Observação" placeholder="PIX recebido em 11/09, comprovante no e-mail"
          value={observacao}
          onInput={(e) => setObservacao((e.target as HTMLInputElement).value)}
        />

        <p class="text-xs text-fg-muted">
          O vencimento anda a partir da data que já valia, não de hoje — dar baixa com atraso
          não custa dias ao cliente nem o presenteia com um mês.
        </p>
      </div>
    </Modal>
  )
}

function ModalCarencia({ aberto, atual, onFechar, onConfirmar, salvando }: {
  aberto: boolean
  atual: number
  onFechar: () => void
  onConfirmar: (body: Record<string, unknown>) => void
  salvando: boolean
}) {
  const [dias, setDias] = useState(String(atual))
  const [motivo, setMotivo] = useState('')

  return (
    <Modal
      open={aberto}
      onOpenChange={(o) => !o && onFechar()}
      title="Carência após o vencimento"
      description="Quantos dias o acesso continua valendo depois da data de vencimento."
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button
            onClick={() => onConfirmar({ dias: Number(dias), ...(motivo ? { motivo } : {}) })}
            disabled={salvando}
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      <div class="space-y-3">
        <Input
          label="Dias de carência" type="number" min="0" max="365" value={dias}
          onInput={(e) => setDias((e.target as HTMLInputElement).value)}
        />
        <Input
          label="Motivo" placeholder="Cliente avisou que paga na sexta"
          value={motivo}
          onInput={(e) => setMotivo((e.target as HTMLInputElement).value)}
        />
        <p class="text-xs text-fg-muted">
          Vale para todos os pacotes. Fica registrado com data e autor — esticar prazo sem
          registro vira favor invisível na conferência de caixa.
        </p>
      </div>
    </Modal>
  )
}
