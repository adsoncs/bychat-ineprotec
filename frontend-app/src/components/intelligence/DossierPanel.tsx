import {
  Building2, Mail, Phone, MapPin, Globe, Briefcase, FileBadge, Users,
  Briefcase as BriefcaseIcon, Camera, Users as UsersAlt, AtSign, Video, Code,
  MessageCircle, Copy, MessageSquareQuote, Send, Sparkles, AlertTriangle,
  Settings, RefreshCw, Loader2,
} from 'lucide-preact'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { toast } from '@/lib/toast'
import { useGenerateApproach, type DossierResponse } from '@/hooks/useIntelligence'

const SOCIAL_ICONS: Record<string, typeof Globe> = {
  linkedin: BriefcaseIcon,
  instagram: Camera,
  facebook: UsersAlt,
  twitter: AtSign,
  youtube: Video,
  github: Code,
  tiktok: MessageCircle,
  lattes: FileBadge,
}

const SOCIAL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  github: 'GitHub',
  tiktok: 'TikTok',
  lattes: 'Lattes',
}

function copy(text: string, label = 'Copiado') {
  navigator.clipboard.writeText(text)
    .then(() => toast(label, 'success'))
    .catch(() => toast('Falha ao copiar', 'danger'))
}

function digits(s: string) {
  return s.replace(/\D/g, '')
}

function openWhatsapp(phone: string) {
  const d = digits(phone)
  if (!d) return
  window.open(`https://wa.me/${d}`, '_blank', 'noopener')
}

export function DossierPanel({ data }: { data: DossierResponse }) {
  const { identity, company, contact, socials, iceBreakers, approachMissingContext, approachGeneratedAt, approachReason } = data
  const initials = (identity.name ?? data.lead.nome ?? '?').slice(0, 2).toUpperCase()
  const primaryPhone: string | null = contact.phones[0]?.value ?? data.lead.whatsapp ?? null

  const generateApproach = useGenerateApproach()

  function sendIceBreaker(text: string) {
    if (!primaryPhone) {
      copy(text, 'Mensagem copiada (sem telefone para enviar)')
      return
    }
    const d = digits(primaryPhone)
    if (!d) return
    window.open(`https://wa.me/${d}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  async function handleGenerate() {
    try {
      const r = await generateApproach.mutateAsync(data.lead.id)
      if (r.suggestions.length) toast(`${r.suggestions.length} sugestões geradas`, 'success')
      else if (r.missingContext.length) toast('Contexto incompleto — preencha pra gerar', 'warning')
      else toast('Não foi possível gerar — tente novamente', 'danger')
    } catch (err) {
      toast('Falha ao gerar sugestões', 'danger')
    }
  }

  const isGenerating = generateApproach.isPending
  const hasContextGap = approachMissingContext.length > 0
  const hasSuggestions = iceBreakers.length > 0
  const generatedLabel = approachGeneratedAt
    ? new Date(approachGeneratedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <div class="space-y-3">
      {/* Header de identidade */}
      <Card class="p-4">
        <div class="flex items-start gap-4">
          {identity.photo_url ? (
            <img
              src={identity.photo_url}
              alt={identity.name ?? ''}
              class="size-16 rounded-full object-cover border border-border shrink-0"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div class="size-16 rounded-full bg-surface-3 grid place-items-center text-lg font-semibold text-fg-muted shrink-0">
              {initials}
            </div>
          )}
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-fg truncate">
              {identity.name ?? data.lead.nome ?? `Lead #${data.lead.id}`}
            </h3>
            {identity.position && (
              <div class="text-xs text-fg-muted flex items-center gap-1 mt-0.5">
                <Briefcase size={11} /> {identity.position}
              </div>
            )}
            {identity.location && (
              <div class="text-xs text-fg-muted flex items-center gap-1 mt-0.5">
                <MapPin size={11} /> {identity.location}
              </div>
            )}
            {identity.bio && (
              <p class="text-xs text-fg-muted mt-2 line-clamp-3 leading-relaxed">{identity.bio}</p>
            )}
          </div>
          <div class="text-right shrink-0">
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Score</div>
            <div class="text-2xl font-semibold text-fg tabular-nums">
              {data.lead.enrichmentScore ?? '—'}
              <span class="text-xs text-fg-muted">/100</span>
            </div>
            <div class="text-[0.6875rem] text-fg-subtle">{data.totalFacts} fatos</div>
          </div>
        </div>
      </Card>

      {/* Sugestões de abordagem por IA — 3 estados:
            1) contexto faltando → painel "preencha contexto" com link p/ Configurações
            2) sem geração ainda (ou houve falha) → card com botão "Gerar com IA"
            3) já gerado → cards das mensagens + botão "Regenerar"
          A IA nunca é chamada com contexto incompleto, então nunca inventa marca/oferta. */}
      <Card class={`p-3 ${hasContextGap ? 'border-warning/40 bg-warning/5' : 'border-accent/30 bg-accent/5'}`}>
        <div class="flex items-center justify-between mb-2">
          <div class={`text-xs uppercase tracking-wider font-semibold flex items-center gap-1 ${hasContextGap ? 'text-warning' : 'text-accent'}`}>
            <MessageSquareQuote size={11} /> Sugestões de abordagem
          </div>
          {hasSuggestions && (
            <button
              type="button"
              class="inline-flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40"
              onClick={handleGenerate}
              disabled={isGenerating || hasContextGap}
              title="Regenerar com IA"
            >
              {isGenerating ? <Loader2 size={10} class="animate-spin" /> : <RefreshCw size={10} />}
              {isGenerating ? 'Gerando…' : 'Regenerar'}
            </button>
          )}
        </div>

        {hasContextGap ? (
          <div class="space-y-2">
            <div class="flex items-start gap-2 text-xs text-fg">
              <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
              <div class="leading-relaxed">
                Para evitar mensagens genéricas ou inventadas, a IA precisa do contexto da sua empresa antes de sugerir abordagens. Preencha os itens abaixo e clique em <strong>Gerar com IA</strong>.
              </div>
            </div>
            <ul class="text-xs text-fg-muted list-disc pl-5 space-y-0.5">
              {approachMissingContext.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
            <div class="flex items-center gap-2 pt-1">
              <a
                href="/app/settings?tab=intelligence"
                class="inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium bg-warning text-white hover:bg-warning/90"
              >
                <Settings size={12} /> Preencher contexto
              </a>
              <button
                type="button"
                class="inline-flex items-center gap-1 h-7 px-2.5 rounded text-xs font-medium border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40"
                onClick={handleGenerate}
                disabled={isGenerating}
                title="Verificar novamente depois de preencher"
              >
                {isGenerating ? <Loader2 size={12} class="animate-spin" /> : <RefreshCw size={12} />}
                Verificar de novo
              </button>
            </div>
          </div>
        ) : hasSuggestions ? (
          <div class="space-y-2">
            {iceBreakers.map((ib, i) => (
              <div key={i} class="rounded-md bg-surface border border-border p-2.5">
                <p class="text-xs text-fg leading-relaxed mb-2 whitespace-pre-wrap">{ib}</p>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium border border-border bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => copy(ib, 'Mensagem copiada')}
                  >
                    <Copy size={10} /> Copiar
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium bg-success text-white hover:bg-success/90 disabled:opacity-40"
                    onClick={() => sendIceBreaker(ib)}
                    disabled={!primaryPhone}
                    title={primaryPhone ? `Enviar para ${primaryPhone}` : 'Sem telefone validado'}
                  >
                    <Send size={10} /> Enviar via WhatsApp
                  </button>
                </div>
              </div>
            ))}
            {generatedLabel && (
              <div class="text-[0.6875rem] text-fg-subtle pt-1">
                Gerado por IA em {generatedLabel}
              </div>
            )}
          </div>
        ) : (
          <div class="space-y-2">
            <p class="text-xs text-fg-muted leading-relaxed">
              {approachReason === 'ai_call_failed' || approachReason === 'ai_parse_failed'
                ? 'A última tentativa falhou. Clique em Gerar para tentar novamente.'
                : 'A IA vai ler o contexto do seu negócio, o funil em que o lead está e as respostas dele para sugerir 3 formas de abordagem realistas — sem inventar fatos.'}
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? <Loader2 size={12} class="animate-spin" /> : <Sparkles size={12} />}
              {isGenerating ? 'Gerando sugestões…' : 'Gerar sugestões com IA'}
            </button>
          </div>
        )}
      </Card>

      {/* Contato */}
      {(contact.phones.length > 0 || contact.emails.length > 0 || contact.addresses.length > 0) && (
        <Card class="p-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2">Contato</div>
          <div class="space-y-1.5">
            {contact.phones.map((p, i) => (
              <div key={`p-${i}`} class="flex items-center gap-2 text-xs">
                <Phone size={12} class="text-fg-subtle shrink-0" />
                <span class="text-fg font-mono">{p.value}</span>
                {p.type && <Badge tone="neutral">{p.type}</Badge>}
                {p.region && <span class="text-fg-subtle">· {p.region}</span>}
                <div class="flex-1" />
                <button
                  type="button"
                  class="size-6 rounded grid place-items-center text-fg-muted hover:text-success hover:bg-surface-3"
                  onClick={() => openWhatsapp(p.value)}
                  title="Iniciar conversa no WhatsApp"
                  aria-label="Iniciar conversa no WhatsApp"
                >
                  <MessageCircle size={11} />
                </button>
                <button
                  type="button"
                  class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                  onClick={() => copy(p.value, 'Telefone copiado')}
                  title="Copiar telefone"
                  aria-label="Copiar telefone"
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
            {contact.emails.map((e, i) => (
              <div key={`e-${i}`} class="flex items-center gap-2 text-xs">
                <Mail size={12} class="text-fg-subtle shrink-0" />
                <a href={`mailto:${e}`} class="text-fg hover:text-accent truncate">{e}</a>
                <div class="flex-1" />
                <button
                  type="button"
                  class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                  onClick={() => copy(e, 'Email copiado')}
                  title="Copiar email"
                  aria-label="Copiar email"
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
            {contact.addresses.map((a, i) => (
              <div key={`a-${i}`} class="flex items-start gap-2 text-xs">
                <MapPin size={12} class="text-fg-subtle shrink-0 mt-0.5" />
                <span class="text-fg flex-1">{a}</span>
                <button
                  type="button"
                  class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0"
                  onClick={() => copy(a, 'Endereço copiado')}
                  title="Copiar endereço"
                  aria-label="Copiar endereço"
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empresa */}
      {(company.name ?? company.cnpj ?? company.sector ?? company.partners?.length) && (
        <Card class="p-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
            <Building2 size={11} /> Empresa
          </div>
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 text-xs">
            <KV label="Nome" value={company.name} />
            <KV label="Razão social" value={company.legal_name} />
            <KV label="Nome fantasia" value={company.trade_name} />
            <KV label="CNPJ" value={company.cnpj} mono onCopy={company.cnpj ? () => copy(company.cnpj!, 'CNPJ copiado') : undefined} />
            <KV label="Setor / CNAE" value={company.sector} />
            <KV label="Cidade/UF" value={[company.city, company.state].filter(Boolean).join(' / ') || undefined} />
            {company.website && (
              <div class="sm:col-span-2 flex items-center gap-2 min-w-0">
                <span class="text-fg-subtle shrink-0">Site:</span>
                <a
                  href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                  target="_blank"
                  rel="noopener"
                  class="text-accent hover:underline flex items-center gap-1 truncate"
                >
                  <Globe size={11} class="shrink-0" /> <span class="truncate">{company.website}</span>
                </a>
              </div>
            )}
          </div>
          {company.partners && company.partners.length > 0 && (
            <div class="mt-3 pt-3 border-t border-border">
              <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-1.5 flex items-center gap-1">
                <Users size={11} /> Sócios ({company.partners.length})
              </div>
              <div class="flex flex-wrap gap-1.5">
                {company.partners.map((p, i) => (
                  <Badge key={i} tone="info">{p}</Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Redes sociais */}
      {socials.length > 0 && (
        <Card class="p-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2">
            Presença digital ({socials.length})
          </div>
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {socials.map((s) => {
              const Icon = SOCIAL_ICONS[s.platform] ?? Globe
              const label = SOCIAL_LABELS[s.platform] ?? s.platform
              return (
                <a
                  key={s.platform}
                  href={s.url}
                  target="_blank"
                  rel="noopener"
                  class="flex items-start gap-2 p-2 rounded-md border border-border bg-surface hover:bg-surface-3 hover:border-accent transition-colors group"
                >
                  <Icon size={14} class="text-fg-muted shrink-0 mt-0.5 group-hover:text-accent" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs font-medium text-fg">{label}</span>
                      <Badge tone={s.confidence >= 0.7 ? 'success' : 'neutral'}>
                        {Math.round(s.confidence * 100)}%
                      </Badge>
                    </div>
                    {s.title && <div class="text-[0.6875rem] text-fg-muted truncate">{s.title}</div>}
                    <div class="text-[0.6875rem] text-fg-subtle truncate">{s.url.replace(/^https?:\/\//, '')}</div>
                  </div>
                </a>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function KV({
  label, value, mono = false, onCopy,
}: {
  label: string
  value?: string | undefined
  mono?: boolean
  onCopy?: (() => void) | undefined
}) {
  if (!value) return null
  return (
    <div class="flex items-baseline gap-2 min-w-0">
      <span class="text-fg-subtle shrink-0">{label}:</span>
      <span class={`text-fg flex-1 truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
      {onCopy && (
        <button
          type="button"
          class="size-5 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0"
          onClick={onCopy}
          aria-label="Copiar"
          title="Copiar"
        >
          <Copy size={10} />
        </button>
      )}
    </div>
  )
}
