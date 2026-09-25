import { useState, useEffect, useMemo } from 'preact/hooks'
import { Save, AlertCircle, ExternalLink } from '@/components/ui/icon-set'
import {
  useUpdateEnrollmentPortal,
  type EnrollmentPortal,
  type EnrollmentPortalInput,
  type PaymentProvider,
  type PaymentMode,
} from '@/hooks/useEnrollmentPortals'
import { usePaymentConnections } from '@/hooks/usePayments'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

/**
 * Regras de pagamento do portal. Espelha services/portalPagamento.ts no backend
 * — que é quem valida e prende cada número na faixa válida antes de gravar.
 */
export interface RegrasPagamento {
  pix: { ativo: boolean; descontoPct: number; expiraHoras: number }
  boleto: { ativo: boolean; parcelado: boolean; parcelasMax: number; diaVencimento: number; jurosMesPct: number; taxaPorParcela: number }
  cartao: { ativo: boolean; parcelasMax: number; semJurosAte: number; jurosMesPct: number; parcelaMinima: number }
}

const REGRAS_PADRAO: RegrasPagamento = {
  pix: { ativo: true, descontoPct: 0, expiraHoras: 24 },
  boleto: { ativo: true, parcelado: false, parcelasMax: 12, diaVencimento: 10, jurosMesPct: 0, taxaPorParcela: 0 },
  cartao: { ativo: false, parcelasMax: 12, semJurosAte: 6, jurosMesPct: 1.99, parcelaMinima: 30 },
}

const comPadrao = (r: RegrasPagamento | null | undefined): RegrasPagamento => ({
  pix: { ...REGRAS_PADRAO.pix, ...(r?.pix ?? {}) },
  boleto: { ...REGRAS_PADRAO.boleto, ...(r?.boleto ?? {}) },
  cartao: { ...REGRAS_PADRAO.cartao, ...(r?.cartao ?? {}) },
})

const PROVIDER_LABEL: Record<Exclude<PaymentProvider, null>, string> = {
  asaas: 'Asaas',
  pagarme: 'Pagar.me',
}

const SectionTitle = ({ children }: { children: preact.ComponentChildren }) => (
  <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">{children}</div>
)

/**
 * Aba de Pagamento do portal.
 *
 * Vive separada da Configuração de propósito: cobrança não tem parentesco com
 * captcha, filtro de curso, funil ou código customizado, e misturar as duas
 * fazia um salvar mexer no que a outra tinha acabado de ajustar. Aqui o payload
 * carrega SÓ os campos de pagamento — nada mais é tocado.
 */
export function PortalPaymentTab({ portal }: { portal: EnrollmentPortal }) {
  const update = useUpdateEnrollmentPortal()
  const { data: paymentConnectionsData, isLoading: loadingConnections } = usePaymentConnections()
  const paymentConnections = useMemo(
    () => (paymentConnectionsData?.connections ?? []).filter((c) => c.active),
    [paymentConnectionsData],
  )

  const pag = portal as unknown as { paymentScope?: string | null; paymentMethodsConfig?: RegrasPagamento | null }
  const [requirePayment, setRequirePayment] = useState(portal.requirePayment)
  const [paymentConnectionId, setPaymentConnectionId] = useState<number | null>(portal.paymentConnectionId)
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState(String(portal.paymentDeadlineHours))
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(portal.paymentMode ?? 'link')
  const [paymentScope, setPaymentScope] = useState(pag.paymentScope ?? 'taxa')
  const [regras, setRegras] = useState<RegrasPagamento>(comPadrao(pag.paymentMethodsConfig))
  const [dirty, setDirty] = useState(false)

  // Recarrega quando o portal muda por fora (outra aba salvou, refetch).
  useEffect(() => {
    setRequirePayment(portal.requirePayment)
    setPaymentConnectionId(portal.paymentConnectionId)
    setPaymentDeadlineHours(String(portal.paymentDeadlineHours))
    setPaymentMode(portal.paymentMode ?? 'link')
    setPaymentScope(pag.paymentScope ?? 'taxa')
    setRegras(comPadrao(pag.paymentMethodsConfig))
    setDirty(false)
  }, [
    portal.requirePayment,
    portal.paymentConnectionId,
    portal.paymentDeadlineHours,
    portal.paymentMode,
    pag.paymentScope,
    pag.paymentMethodsConfig,
  ])

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true) }
  }

  // Avisa antes de sair com alteração pendente.
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function salvar() {
    const selectedConnection = paymentConnectionId
      ? paymentConnections.find((c) => c.id === paymentConnectionId) ?? null
      : null
    const derivedProvider: PaymentProvider = selectedConnection?.provider ?? null

    // Só o que é de pagamento. A aba de Configuração cuida do resto, e nenhuma
    // das duas manda campo da outra.
    const payload: EnrollmentPortalInput = {
      requirePayment,
      paymentConnectionId: paymentConnectionId ?? null,
      paymentProvider: derivedProvider,
      paymentMode,
      paymentDeadlineHours: parseInt(paymentDeadlineHours) || 48,
      paymentScope,
      paymentMethodsConfig: regras,
    }
    update.mutate({ id: portal.id, ...payload }, {
      onSuccess: () => {
        toast('Pagamento salvo', 'success')
        setDirty(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      {dirty && (
        <div class="flex items-center gap-2 text-xs text-warning">
          <AlertCircle size={14} /> Alterações de pagamento não salvas.
        </div>
      )}

<Card>
        <SectionTitle>Pagamento</SectionTitle>
        <div class="space-y-3">
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={requirePayment}
              onChange={(e) => mark(setRequirePayment)((e.target as HTMLInputElement).checked)}
            />
            Exigir pagamento para concluir a inscrição
          </label>
          {/* O que é cobrado depende do campo "O que este portal cobra", logo
              abaixo: dizer "taxa de inscrição" aqui seria falso sempre que o
              portal estiver cobrando o curso. */}
          <p class="text-2xs text-fg-muted -mt-1">
            O valor e a origem da cobrança vêm do que estiver escolhido em
            <strong> O que este portal cobra</strong>.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Provedor"
              value={paymentConnectionId === null ? '' : String(paymentConnectionId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                mark(setPaymentConnectionId)(v ? Number(v) : null)
              }}
              disabled={!requirePayment || loadingConnections}
              hint={
                loadingConnections
                  ? 'Carregando conexões…'
                  : paymentConnections.length === 0
                  ? 'Nenhuma conexão ativa — cadastre em Pagamentos'
                  : ''
              }
            >
              <option value="">Selecionar…</option>
              {paymentConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({PROVIDER_LABEL[c.provider]} • {c.environment === 'production' ? 'Produção' : 'Sandbox'})
                </option>
              ))}
            </Select>
            <Input
              label="Prazo de pagamento (horas)"
              type="number"
              value={paymentDeadlineHours}
              onInput={(e) => mark(setPaymentDeadlineHours)((e.target as HTMLInputElement).value)}
              disabled={!requirePayment}
              hint="Após esse prazo a inscrição expira"
            />
          </div>
          {requirePayment && paymentConnections.length === 0 && !loadingConnections && (
            <div class="text-2xs text-warning flex items-center gap-1.5">
              <AlertCircle size={12} />
              <span>
                Nenhuma conexão de pagamento ativa.{' '}
                <a href="/app/payments" class="underline inline-flex items-center gap-1">
                  Cadastrar agora <ExternalLink size={10} />
                </a>
              </span>
            </div>
          )}
          <Select
            label="Modo de cobrança"
            value={paymentMode}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              mark(setPaymentMode)((v === 'transparent' ? 'transparent' : 'link') as PaymentMode)
            }}
            disabled={!requirePayment}
            hint={
              paymentMode === 'transparent'
                ? 'Candidato paga sem sair do portal (PIX/boleto/cartão). Exige checkout transparente implementado por método.'
                : 'Candidato é redirecionado para a página hospedada do provedor (PaymentLink Pagar.me / invoiceUrl Asaas).'
            }
          >
            <option value="link">Link de pagamento (redirect ao provedor)</option>
            <option value="transparent">Checkout no portal (transparente)</option>
          </Select>
          <Select
            label="O que este portal cobra"
            value={paymentScope}
            onChange={(e) => mark(setPaymentScope)((e.target as HTMLSelectElement).value)}
            disabled={!requirePayment}
            hint={paymentScope === 'curso'
              ? 'O plano de pagamento da oferta: entrada agora e o restante como parcelas do contrato no financeiro.'
              : 'A taxa de inscrição do processo seletivo (`taxaInscricao`).'}
          >
            <option value="taxa">Taxa de inscrição</option>
            <option value="curso">Curso (plano de pagamento da oferta)</option>
          </Select>

          <div class="text-2xs text-fg-muted">
            Conexões são gerenciadas em <a href="/app/payments" class="underline">Pagamentos</a>.
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Meios de pagamento</SectionTitle>
        <p class="text-xs text-fg-muted mb-3">
          Quais o candidato pode usar e as regras de cada um. Meio desligado não aparece no portal.
        </p>
        <div class="space-y-4">

          {/* PIX */}
          <div class="rounded-md border border-border p-3">
            <label class="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={regras.pix.ativo}
                onChange={(e) => mark(setRegras)({ ...regras, pix: { ...regras.pix, ativo: (e.target as HTMLInputElement).checked } })}
              />
              PIX
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Input
                label="Desconto à vista (%)"
                type="number"
                value={String(regras.pix.descontoPct)}
                disabled={!regras.pix.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, pix: { ...regras.pix, descontoPct: Number((e.target as HTMLInputElement).value) } })}
                hint="0 a 50. Aparece no botão do PIX."
              />
              <Input
                label="Código válido por (horas)"
                type="number"
                value={String(regras.pix.expiraHoras)}
                disabled={!regras.pix.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, pix: { ...regras.pix, expiraHoras: Number((e.target as HTMLInputElement).value) } })}
              />
            </div>
          </div>

          {/* Boleto */}
          <div class="rounded-md border border-border p-3">
            <label class="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={regras.boleto.ativo}
                onChange={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, ativo: (e.target as HTMLInputElement).checked } })}
              />
              Boleto
            </label>
            <label class="flex items-center gap-2 text-sm text-fg-muted mt-2">
              <input
                type="checkbox"
                checked={regras.boleto.parcelado}
                disabled={!regras.boleto.ativo}
                onChange={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, parcelado: (e.target as HTMLInputElement).checked } })}
              />
              Permitir parcelar
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Input
                label="Parcelas máximas"
                type="number"
                value={String(regras.boleto.parcelasMax)}
                disabled={!regras.boleto.ativo || !regras.boleto.parcelado}
                onInput={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, parcelasMax: Number((e.target as HTMLInputElement).value) } })}
                hint="1 a 48"
              />
              <Input
                label="Dia de vencimento das seguintes"
                type="number"
                value={String(regras.boleto.diaVencimento)}
                disabled={!regras.boleto.ativo || !regras.boleto.parcelado}
                onInput={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, diaVencimento: Number((e.target as HTMLInputElement).value) } })}
                hint="1 a 28"
              />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Input
                label="Juros ao mês (%)"
                type="number"
                value={String(regras.boleto.jurosMesPct)}
                disabled={!regras.boleto.ativo || !regras.boleto.parcelado}
                onInput={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, jurosMesPct: Number((e.target as HTMLInputElement).value) } })}
                hint="0 = parcelar sai pelo preço do à vista"
              />
              <Input
                label="Acréscimo fixo por parcela (R$)"
                type="number"
                value={String(regras.boleto.taxaPorParcela)}
                disabled={!regras.boleto.ativo || !regras.boleto.parcelado}
                onInput={(e) => mark(setRegras)({ ...regras, boleto: { ...regras.boleto, taxaPorParcela: Number((e.target as HTMLInputElement).value) } })}
                hint="Repassa a tarifa de emissão, cobrada por boleto"
              />
            </div>
            {regras.boleto.parcelado && (
              <p class="text-2xs text-fg-muted mt-2">
                A primeira é cobrada no ato. As demais viram parcelas do contrato no financeiro,
                onde valem bolsa, acordo, renegociação e os encargos de atraso. Juros e acréscimo
                fixo somam e aparecem para o candidato antes de ele escolher.
              </p>
            )}
          </div>

          {/* Cartão */}
          <div class="rounded-md border border-border p-3">
            <label class="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={regras.cartao.ativo}
                onChange={(e) => mark(setRegras)({ ...regras, cartao: { ...regras.cartao, ativo: (e.target as HTMLInputElement).checked } })}
              />
              Cartão de crédito
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Input
                label="Parcelas máximas"
                type="number"
                value={String(regras.cartao.parcelasMax)}
                disabled={!regras.cartao.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, cartao: { ...regras.cartao, parcelasMax: Number((e.target as HTMLInputElement).value) } })}
                hint="Teto do Asaas: 21"
              />
              <Input
                label="Sem juros até"
                type="number"
                value={String(regras.cartao.semJurosAte)}
                disabled={!regras.cartao.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, cartao: { ...regras.cartao, semJurosAte: Number((e.target as HTMLInputElement).value) } })}
                hint="Até aqui a instituição absorve a taxa"
              />
              <Input
                label="Juros ao mês (%)"
                type="number"
                value={String(regras.cartao.jurosMesPct)}
                disabled={!regras.cartao.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, cartao: { ...regras.cartao, jurosMesPct: Number((e.target as HTMLInputElement).value) } })}
                hint="Aplicado acima do limite sem juros"
              />
              <Input
                label="Parcela mínima (R$)"
                type="number"
                value={String(regras.cartao.parcelaMinima)}
                disabled={!regras.cartao.ativo}
                onInput={(e) => mark(setRegras)({ ...regras, cartao: { ...regras.cartao, parcelaMinima: Number((e.target as HTMLInputElement).value) } })}
                hint="Corta as vezes que dariam parcela menor que isso"
              />
            </div>
            <p class="text-2xs text-fg-muted mt-2">
              Com o Asaas, o cartão é pago na página do provedor e quem oferece as vezes é a
              operadora — os valores acima aparecem no portal como simulação. Para o
              parcelamento valer na transação, o cartão precisa ser transparente (Pagar.me).
            </p>
          </div>
        </div>
      </Card>

      <div class="flex justify-end">
        <Button onClick={salvar} disabled={update.isPending}>
          <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar pagamento'}
        </Button>
      </div>
    </div>
  )
}
