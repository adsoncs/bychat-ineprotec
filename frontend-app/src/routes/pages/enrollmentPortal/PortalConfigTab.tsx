import { useState, useEffect, useMemo } from 'preact/hooks'
import { Save, AlertCircle, ExternalLink } from '@/components/ui/icon-set'
import {
  useUpdateEnrollmentPortal,
  type EnrollmentPortal,
  type EnrollmentPortalInput,
  type CaptchaType,
  type PaymentProvider,
  type PaymentMode,
  type PixelConfig,
} from '@/hooks/useEnrollmentPortals'
import {
  useEducationalLevels,
  useCourses,
  useCampuses,
  useModalities,
} from '@/hooks/useEducational'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { usePaymentConnections } from '@/hooks/usePayments'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

const PROVIDER_LABEL: Record<Exclude<PaymentProvider, null>, string> = {
  asaas: 'Asaas',
  pagarme: 'Pagar.me',
}

export function PortalConfigTab({ portal }: { portal: EnrollmentPortal }) {
  // Filtros (allowed*Ids)
  const { data: levelsData } = useEducationalLevels()
  const { data: coursesData } = useCourses()
  const { data: campusesData } = useCampuses()
  const { data: modalitiesData } = useModalities()
  const { data: funnelsData } = useFunnels()

  // Pagamento — conexões cadastradas em /app/payments
  const { data: paymentConnectionsData, isLoading: loadingConnections } = usePaymentConnections()
  const paymentConnections = useMemo(
    () => (paymentConnectionsData?.connections ?? []).filter((c) => c.active),
    [paymentConnectionsData],
  )
  const [requirePayment, setRequirePayment] = useState(portal.requirePayment)
  const [paymentConnectionId, setPaymentConnectionId] = useState<number | null>(portal.paymentConnectionId)
  const [paymentDeadlineHours, setPaymentDeadlineHours] = useState(String(portal.paymentDeadlineHours))
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(portal.paymentMode ?? 'link')

  // Captcha
  const [captchaType, setCaptchaType] = useState<CaptchaType>(portal.captchaType)
  const [captchaSiteKey, setCaptchaSiteKey] = useState(portal.captchaSiteKey ?? '')
  const [captchaSecret, setCaptchaSecret] = useState('')
  const [captchaSecretChanged, setCaptchaSecretChanged] = useState(false)

  // Filtros
  const [allowedLevelIds, setAllowedLevelIds] = useState<number[]>(portal.allowedLevelIds ?? [])
  const [allowedCourseIds, setAllowedCourseIds] = useState<number[]>(portal.allowedCourseIds ?? [])
  const [allowedCampusIds, setAllowedCampusIds] = useState<number[]>(portal.allowedCampusIds ?? [])
  const [allowedModalityIds, setAllowedModalityIds] = useState<number[]>(portal.allowedModalityIds ?? [])
  const [filtersAllOpen, setFiltersAllOpen] = useState({
    levels: portal.allowedLevelIds === null,
    courses: portal.allowedCourseIds === null,
    campuses: portal.allowedCampusIds === null,
    modalities: portal.allowedModalityIds === null,
  })

  // Funil + stages
  const [funnelId, setFunnelId] = useState<number | ''>(portal.funnelId ?? '')
  const [stageKey, setStageKey] = useState(portal.stageKey ?? '')
  const [docsCompleteStageKey, setDocsCompleteStageKey] = useState(portal.docsCompleteStageKey ?? '')
  const [finalApprovalStageKey, setFinalApprovalStageKey] = useState(portal.finalApprovalStageKey ?? '')

  // Domínio + SEO
  const [customDomain, setCustomDomain] = useState(portal.customDomain ?? '')
  const [ogImageUrl, setOgImageUrl] = useState(portal.ogImageUrl ?? '')

  // Custom code
  const [customCss, setCustomCss] = useState(portal.customCss ?? '')
  const [customHeadJs, setCustomHeadJs] = useState(portal.customHeadJs ?? '')
  const [customBodyJs, setCustomBodyJs] = useState(portal.customBodyJs ?? '')

  // Tracking / Pixels
  const initialPixel: PixelConfig = portal.pixelConfig ?? {}
  const [ga4Id, setGa4Id] = useState(initialPixel.ga4Id ?? '')
  const [gtmId, setGtmId] = useState(initialPixel.gtmId ?? '')
  const [metaPixelId, setMetaPixelId] = useState(initialPixel.metaPixelId ?? '')
  const [tiktokPixelId, setTiktokPixelId] = useState(initialPixel.tiktokPixelId ?? '')
  const [linkedinPartnerId, setLinkedinPartnerId] = useState(initialPixel.linkedinPartnerId ?? '')

  const [dirty, setDirty] = useState(false)
  const update = useUpdateEnrollmentPortal()

  useEffect(() => { setDirty(false) }, [portal.id, portal.updatedAt])

  // beforeunload: avisa o usuário antes de sair com mudanças não salvas
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true) }
  }

  const { data: funnelDetail } = useFunnel(typeof funnelId === 'number' ? funnelId : null)
  const stages = funnelDetail?.stages ?? []

  function handleSave() {
    const selectedConnection = paymentConnectionId
      ? paymentConnections.find((c) => c.id === paymentConnectionId) ?? null
      : null
    const derivedProvider: PaymentProvider = selectedConnection?.provider ?? null
    const payload: EnrollmentPortalInput = {
      requirePayment,
      paymentConnectionId: paymentConnectionId ?? null,
      paymentProvider: derivedProvider,
      paymentMode,
      paymentDeadlineHours: parseInt(paymentDeadlineHours) || 48,
      captchaType,
      captchaSiteKey: captchaSiteKey.trim() || null,
      // Só envia secret se mudou — evita sobrescrever com vazio.
      ...(captchaSecretChanged ? { captchaSecret: captchaSecret.trim() || null } : {}),
      allowedLevelIds: filtersAllOpen.levels ? null : allowedLevelIds,
      allowedCourseIds: filtersAllOpen.courses ? null : allowedCourseIds,
      allowedCampusIds: filtersAllOpen.campuses ? null : allowedCampusIds,
      allowedModalityIds: filtersAllOpen.modalities ? null : allowedModalityIds,
      funnelId: typeof funnelId === 'number' ? funnelId : null,
      stageKey: stageKey || null,
      docsCompleteStageKey: docsCompleteStageKey || null,
      finalApprovalStageKey: finalApprovalStageKey || null,
      customDomain: customDomain.trim() || null,
      ogImageUrl: ogImageUrl.trim() || null,
      customCss: customCss || null,
      customHeadJs: customHeadJs || null,
      customBodyJs: customBodyJs || null,
      pixelConfig: buildPixelConfig({ ga4Id, gtmId, metaPixelId, tiktokPixelId, linkedinPartnerId }),
    }
    update.mutate({ id: portal.id, ...payload }, {
      onSuccess: () => {
        toast('Configuração salva', 'success')
        setDirty(false)
        setCaptchaSecretChanged(false)
        setCaptchaSecret('')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      {dirty && (
        <div class="sticky top-0 z-10 -mx-2 px-2 py-2 rounded-md border border-warning/40 bg-warning/10 backdrop-blur flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 text-xs text-warning">
            <AlertCircle size={14} /> Alterações não salvas nesta tela.
          </div>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={update.isPending}>
            <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar agora'}
          </Button>
        </div>
      )}
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-sm font-medium text-fg">Configuração avançada</div>
            <div class="text-xs text-fg-muted mt-0.5">
              Pagamento, captcha, filtros, funil, tracking e custom code. Salva todas as seções de uma vez.
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={!dirty || update.isPending}>
            <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Pagamento</SectionTitle>
        <div class="space-y-3">
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={requirePayment}
              onChange={(e) => mark(setRequirePayment)((e.target as HTMLInputElement).checked)}
            />
            Exigir pagamento da taxa de inscrição
          </label>
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
          <div class="text-2xs text-fg-muted">
            Conexões são gerenciadas em <a href="/app/payments" class="underline">Pagamentos</a>.
            O valor da taxa vem do processo seletivo (`taxaInscricao`).
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Captcha (anti-spam)</SectionTitle>
        <div class="space-y-3">
          <Select
            label="Tipo"
            value={captchaType ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              mark(setCaptchaType)((v || null) as CaptchaType)
            }}
          >
            <option value="">Sem captcha</option>
            <option value="recaptcha">reCAPTCHA</option>
            <option value="hcaptcha">hCaptcha</option>
          </Select>
          {captchaType && (
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Site key"
                value={captchaSiteKey ?? ''}
                onInput={(e) => mark(setCaptchaSiteKey)((e.target as HTMLInputElement).value)}
              />
              <Input
                label="Secret key"
                type="password"
                value={captchaSecret}
                onInput={(e) => {
                  setCaptchaSecret((e.target as HTMLInputElement).value)
                  setCaptchaSecretChanged(true)
                  setDirty(true)
                }}
                placeholder="(deixe em branco para manter atual)"
                hint="Só envia o novo valor se você digitar algo"
              />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle>Filtros (o que aparece no portal)</SectionTitle>
        <div class="text-xs text-fg-muted mb-3">
          Restringe níveis/cursos/campus/modalidades visíveis. <strong>Vazio = mostra todos</strong>.
        </div>
        <div class="space-y-3">
          <FilterPicker
            label="Níveis permitidos"
            items={levelsData?.levels ?? []}
            allOpen={filtersAllOpen.levels}
            onAllOpenChange={(v) => { setFiltersAllOpen((s) => ({ ...s, levels: v })); setDirty(true) }}
            selectedIds={allowedLevelIds}
            onChange={(ids) => mark(setAllowedLevelIds)(ids)}
          />
          <FilterPicker
            label="Cursos permitidos"
            items={coursesData?.courses ?? []}
            allOpen={filtersAllOpen.courses}
            onAllOpenChange={(v) => { setFiltersAllOpen((s) => ({ ...s, courses: v })); setDirty(true) }}
            selectedIds={allowedCourseIds}
            onChange={(ids) => mark(setAllowedCourseIds)(ids)}
          />
          <FilterPicker
            label="Campus permitidos"
            items={campusesData?.campuses ?? []}
            allOpen={filtersAllOpen.campuses}
            onAllOpenChange={(v) => { setFiltersAllOpen((s) => ({ ...s, campuses: v })); setDirty(true) }}
            selectedIds={allowedCampusIds}
            onChange={(ids) => mark(setAllowedCampusIds)(ids)}
          />
          <FilterPicker
            label="Modalidades permitidas"
            items={modalitiesData?.modalities ?? []}
            allOpen={filtersAllOpen.modalities}
            onAllOpenChange={(v) => { setFiltersAllOpen((s) => ({ ...s, modalities: v })); setDirty(true) }}
            selectedIds={allowedModalityIds}
            onChange={(ids) => mark(setAllowedModalityIds)(ids)}
          />
        </div>
      </Card>

      <Card>
        <SectionTitle>Funil de leads</SectionTitle>
        <div class="space-y-3">
          <Select
            label="Funil destino"
            value={funnelId === '' ? '' : String(funnelId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              mark(setFunnelId)(v ? Number(v) : '')
              // Se mudou o funil, limpa stage keys (podem não existir lá)
              setStageKey('')
              setDocsCompleteStageKey('')
              setFinalApprovalStageKey('')
            }}
          >
            <option value="">Sem funil destino (usa default)</option>
            {(funnelsData?.funnels ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
            ))}
          </Select>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StageSelect
              label="Etapa inicial"
              hint="Lead entra nesta etapa ao se inscrever"
              value={stageKey}
              onChange={mark(setStageKey)}
              stages={stages}
            />
            <StageSelect
              label="Etapa pós-docs"
              hint="Move para cá quando todos os docs forem aprovados"
              value={docsCompleteStageKey}
              onChange={mark(setDocsCompleteStageKey)}
              stages={stages}
            />
            <StageSelect
              label="Etapa pós-aprovação"
              hint="Move quando docs OK + avaliação aprovada"
              value={finalApprovalStageKey}
              onChange={mark(setFinalApprovalStageKey)}
              stages={stages}
            />
          </div>
          {funnelId && stages.length === 0 && (
            <div class="text-2xs text-warning">
              Funil sem etapas. Cadastre etapas em <a href="/app/funnels" class="underline">Funis</a>.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle>Domínio + SEO</SectionTitle>
        <div class="space-y-3">
          <Input
            label="Domínio próprio"
            value={customDomain ?? ''}
            onInput={(e) => mark(setCustomDomain)((e.target as HTMLInputElement).value)}
            placeholder="inscricoes.suainstituicao.com.br"
            hint="Configurar SSL via DNS é responsabilidade do operador"
          />
          {portal.sslStatus && (
            <div class="text-2xs text-fg-muted">
              SSL: <code class="text-fg">{portal.sslStatus}</code>
            </div>
          )}
          <Input
            label="OG Image URL"
            type="url"
            value={ogImageUrl ?? ''}
            onInput={(e) => mark(setOgImageUrl)((e.target as HTMLInputElement).value)}
            placeholder="https://"
            hint="Imagem de preview ao compartilhar em redes sociais"
          />
        </div>
      </Card>

      <Card>
        <SectionTitle>Tracking · Pixels</SectionTitle>
        <div class="text-xs text-fg-muted mb-3">
          IDs disparam scripts oficiais no portal público (server-rendered). Deixe vazio para desativar.
          Para tags customizadas use o campo <strong>JS no &lt;head&gt;</strong> abaixo.
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Google Analytics 4"
            value={ga4Id}
            onInput={(e) => mark(setGa4Id)((e.target as HTMLInputElement).value)}
            placeholder="G-XXXXXXXXXX"
            hint="Measurement ID"
          />
          <Input
            label="Google Tag Manager"
            value={gtmId}
            onInput={(e) => mark(setGtmId)((e.target as HTMLInputElement).value)}
            placeholder="GTM-XXXXXXX"
            hint="Container ID"
          />
          <Input
            label="Meta Pixel (Facebook)"
            value={metaPixelId}
            onInput={(e) => mark(setMetaPixelId)((e.target as HTMLInputElement).value)}
            placeholder="1234567890"
            hint="Apenas dígitos"
          />
          <Input
            label="TikTok Pixel"
            value={tiktokPixelId}
            onInput={(e) => mark(setTiktokPixelId)((e.target as HTMLInputElement).value)}
            placeholder="C4XXXXXXXXXXXXXXXXXX"
          />
          <Input
            label="LinkedIn Insight (Partner ID)"
            value={linkedinPartnerId}
            onInput={(e) => mark(setLinkedinPartnerId)((e.target as HTMLInputElement).value)}
            placeholder="1234567"
          />
        </div>
      </Card>

      <Card>
        <SectionTitle>Código personalizado (avançado)</SectionTitle>
        <div class="text-2xs text-warning mb-3">
          ⚠ Conteúdo injetado é executado no navegador do candidato. Não cole código de fontes
          desconhecidas — risco de XSS, vazamento de dados ou manipulação do formulário.
        </div>
        <div class="space-y-3">
          <CodeArea
            label="CSS personalizado"
            value={customCss}
            onChange={mark(setCustomCss)}
            placeholder=".portal-hero { color: red; }"
          />
          <CodeArea
            label="JS no <head>"
            value={customHeadJs}
            onChange={mark(setCustomHeadJs)}
            placeholder='<script>fbq("init", "...");</script>'
          />
          <CodeArea
            label="JS no fim do <body>"
            value={customBodyJs}
            onChange={mark(setCustomBodyJs)}
            placeholder='<script>document.addEventListener("DOMContentLoaded", () => { ... });</script>'
          />
        </div>
      </Card>
    </div>
  )
}

function SectionTitle({ children }: { children: preact.ComponentChildren }) {
  return <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">{children}</div>
}

interface FilterableItem {
  id: number
  nome?: string
  name?: string
}

function FilterPicker({
  label, items, allOpen, onAllOpenChange, selectedIds, onChange,
}: {
  label: string
  items: FilterableItem[]
  allOpen: boolean
  onAllOpenChange: (v: boolean) => void
  selectedIds: number[]
  onChange: (ids: number[]) => void
}) {
  const summary = useMemo(() => {
    if (allOpen) return 'Todos'
    if (selectedIds.length === 0) return 'Nenhum (portal não exibirá nenhum item desta categoria)'
    return `${selectedIds.length} selecionado(s)`
  }, [allOpen, selectedIds])

  function toggle(id: number) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  return (
    <details class="rounded-md border border-border bg-surface">
      <summary class="cursor-pointer px-3 py-2 text-sm flex items-center justify-between gap-2">
        <span class="text-fg-muted">{label}</span>
        <span class="text-xs text-fg-muted">{summary}</span>
      </summary>
      <div class="px-3 py-2 border-t border-border space-y-2">
        <label class="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={allOpen}
            onChange={(e) => onAllOpenChange((e.target as HTMLInputElement).checked)}
          />
          Permitir todos (sem restrição)
        </label>
        {!allOpen && (
          items.length === 0 ? (
            <div class="text-xs text-fg-muted">Nada cadastrado.</div>
          ) : (
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {items.map((it) => (
                <label key={it.id} class="flex items-center gap-2 text-sm text-fg-muted px-2 py-1 rounded hover:bg-surface-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(it.id)}
                    onChange={() => toggle(it.id)}
                  />
                  <span class="truncate">{it.nome ?? it.name ?? `#${it.id}`}</span>
                </label>
              ))}
            </div>
          )
        )}
      </div>
    </details>
  )
}

function StageSelect({
  label, hint, value, onChange, stages,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  stages: { key: string; name: string }[]
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      hint={hint}
    >
      <option value="">— sem ação —</option>
      {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
    </Select>
  )
}

function buildPixelConfig(input: {
  ga4Id: string
  gtmId: string
  metaPixelId: string
  tiktokPixelId: string
  linkedinPartnerId: string
}): PixelConfig | null {
  const out: PixelConfig = {}
  const ga4 = input.ga4Id.trim()
  const gtm = input.gtmId.trim()
  const meta = input.metaPixelId.trim()
  const tt = input.tiktokPixelId.trim()
  const li = input.linkedinPartnerId.trim()
  if (ga4) out.ga4Id = ga4
  if (gtm) out.gtmId = gtm
  if (meta) out.metaPixelId = meta
  if (tt) out.tiktokPixelId = tt
  if (li) out.linkedinPartnerId = li
  return Object.keys(out).length === 0 ? null : out
}

function CodeArea({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string | undefined }) {
  return (
    <div>
      <div class="text-xs font-medium text-fg-muted mb-1">{label}</div>
      <textarea
        class="w-full font-mono text-xs px-2 py-2 rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent min-h-32"
        value={value}
        onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder ?? ''}
        spellcheck={false}
      />
    </div>
  )
}
