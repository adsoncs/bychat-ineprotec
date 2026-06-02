import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Phone, Copy, Check, Link2, QrCode, MessageSquare, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useUtms } from '@/hooks/useUtms'
import { toast } from '@/lib/toast'

// Aceita ?phone=... e ?text=... e ?utmId=... pra ser chamado de outras telas
function readQuery() {
  if (typeof window === 'undefined') return { phone: '', text: '', utmId: '' }
  const p = new URLSearchParams(window.location.search)
  return {
    phone: p.get('phone') ?? '',
    text: p.get('text') ?? '',
    utmId: p.get('utmId') ?? '',
  }
}

function digitsOnly(s: string): string { return s.replace(/\D/g, '') }

function buildWaLink(phoneDigits: string, message: string, attachUrl: string | null): string {
  if (!phoneDigits) return ''
  const finalMessage = attachUrl
    ? (message ? `${message}\n\n${attachUrl}` : attachUrl)
    : message
  const encoded = finalMessage ? `?text=${encodeURIComponent(finalMessage)}` : ''
  return `https://wa.me/${phoneDigits}${encoded}`
}

export function WhatsappLinkPage() {
  const q = readQuery()
  const [phoneInput, setPhoneInput] = useState(q.phone)
  const [message, setMessage] = useState(q.text)
  const [attachedUtmId, setAttachedUtmId] = useState<number | null>(q.utmId ? Number(q.utmId) : null)
  const [, setLocation] = useLocation()

  const utmsQ = useUtms({ active: true })
  const attachedUtm = useMemo(
    () => utmsQ.data?.data.find(u => u.id === attachedUtmId) ?? null,
    [utmsQ.data, attachedUtmId],
  )

  const phoneDigits = digitsOnly(phoneInput)
  const phoneValid = phoneDigits.length >= 10 // BR aceita 10–13 dígitos com DDI
  const link = buildWaLink(phoneDigits, message, attachedUtm?.fullUrl ?? null)
  const [copied, setCopied] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  function copy() {
    if (!link) { toast('Informe um telefone válido', 'danger'); return }
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      toast('Link copiado', 'success')
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => toast('Falha ao copiar', 'danger'))
  }

  function openInWhatsapp() {
    if (!link) { toast('Informe um telefone válido', 'danger'); return }
    window.open(link, '_blank', 'noopener')
  }

  function generateQr() {
    if (!link) { toast('Informe um telefone válido', 'danger'); return }
    setLocation(`/qr?url=${encodeURIComponent(link)}`)
  }

  return (
    <Page
      title="Link de WhatsApp"
      description="Gera o link wa.me com mensagem pré-preenchida. Atribua uma UTM salva pra rastrear a origem do contato."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-3">
            <Input
              label="Telefone com DDI *"
              value={phoneInput}
              onInput={(e) => setPhoneInput((e.target as HTMLInputElement).value)}
              placeholder="55 11 98765-4321"
              hint="Pode colar com espaços, traços e parênteses — só os dígitos importam. Sempre comece com o DDI (Brasil = 55)."
            />
            {phoneInput && !phoneValid && (
              <div class="text-xs text-danger">Telefone precisa de pelo menos 10 dígitos (com DDI).</div>
            )}

            <div>
              <label class="text-xs text-fg-muted block mb-1">Mensagem pré-preenchida</label>
              <textarea
                value={message}
                onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
                placeholder="Olá! Vi seu anúncio e gostaria de saber mais sobre…"
                rows={4}
                class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
                maxLength={1024}
              />
              <div class="text-[0.6875rem] text-fg-subtle mt-0.5">{message.length}/1024</div>
            </div>

            <div>
              <label class="text-xs text-fg-muted block mb-1 flex items-center gap-1">
                <Link2 size={11} /> Anexar UTM (opcional)
              </label>
              <select
                value={attachedUtmId ?? ''}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setAttachedUtmId(v ? Number(v) : null)
                }}
                class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5"
              >
                <option value="">— Nenhuma —</option>
                {utmsQ.data?.data.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.utmCampaign})</option>
                ))}
              </select>
              <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
                A URL taggeada será anexada ao final da mensagem. Crie novas em <strong>Ferramentas → UTMs</strong>.
              </div>
            </div>
          </div>

          <div>
            <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-1 flex items-center gap-1">
              <MessageSquare size={11} /> Preview
            </div>
            <Card class="p-3 bg-success/5 border-success/30">
              <div class="text-xs text-fg-muted mb-1">Para: <code class="font-mono text-fg">{phoneValid ? `+${phoneDigits}` : '—'}</code></div>
              <div class="text-sm text-fg whitespace-pre-wrap min-h-[3rem]">
                {message || <em class="text-fg-subtle">(sem mensagem)</em>}
                {attachedUtm && <>{'\n\n'}<a href="#" class="text-info underline break-all">{attachedUtm.fullUrl}</a></>}
              </div>
            </Card>

            <div class="mt-3">
              <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-1 flex items-center gap-1">
                <Link2 size={11} /> Link gerado
              </div>
              <code class="block text-xs font-mono bg-surface-2 rounded px-2 py-1.5 break-all">
                {link || <em class="text-fg-subtle font-sans">(informe um telefone válido)</em>}
              </code>
            </div>

            <div class="flex flex-wrap gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={copy} disabled={!link}>
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar link'}
              </Button>
              <Button variant="secondary" size="sm" onClick={openInWhatsapp} disabled={!link}>
                <Phone size={12} /> Abrir no WhatsApp
              </Button>
              <Button variant="secondary" size="sm" onClick={generateQr} disabled={!link}>
                <QrCode size={12} /> Gerar QR
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card class="p-3 mt-3 bg-info/5 border-info/30">
        <div class="text-xs text-fg-muted">
          <strong>Onde usar este link:</strong> botão "Fale agora" em landing pages, CTA de anúncios, assinatura de e-mail, QR code impresso em panfleto/evento, post nas redes sociais. Quando o cliente clica, o WhatsApp abre já com sua mensagem pronta — basta ele apertar enviar.
        </div>
      </Card>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Link de WhatsApp?"
        problem={<>
          Cliente clica em "Fale conosco" e cai numa tela vazia do WhatsApp, sem saber o que escrever
          — e nem você sabe de onde ele veio. Esta tela gera o link <code>wa.me/...</code> com
          <strong> mensagem pré-preenchida</strong> e marca a origem. Cliente clica, aperta enviar,
          conversa começa.
        </>}
        steps={[
          {
            title: '📞 Informe o telefone',
            body: <>DDI + DDD + número (ex.: 5562999998888). Só números, sem espaços ou hífen. É o telefone que vai receber a mensagem do cliente.</>,
          },
          {
            title: '💬 Escreva a mensagem padrão',
            body: <>Texto que aparece pronto pra o cliente enviar. Ex.: <em>"Olá! Tenho interesse no curso X"</em>. Quanto mais específico, melhor — facilita identificar a origem depois.</>,
          },
          {
            title: '🏷️ Vincule uma UTM',
            body: <>Escolha uma UTM salva pra marcar a origem do clique. Quando o lead virar lead no CRM, a origem fica gravada. Sem UTM, você sabe que veio do link mas não de qual lugar específico.</>,
          },
          {
            title: '📋 Copie e use',
            body: <>Botão <strong>Copiar</strong>: cole no seu botão, anúncio, link na bio, assinatura de e-mail. Botão <strong>Abrir no WhatsApp</strong>: testa antes pra ver se a mensagem aparece correta.</>,
          },
          {
            title: '📲 Gere QR Code',
            body: <>Botão <strong>Gerar QR</strong> abre a tela de QR Code com este link já preenchido. Útil pra panfleto, cartaz, vitrine, totem de evento — cliente escaneia e abre a conversa.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Boa prática',
          body: <>Crie um link <strong>por canal</strong>: um pro Instagram bio, outro pro anúncio do Facebook, outro pro panfleto do evento. Mensagem pré-preenchida pode ser diferente em cada um (ex.: "Vim do Instagram"). Assim você sabe sem precisar perguntar.</>,
        }}
      />
    </Page>
  )
}
