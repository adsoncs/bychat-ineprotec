import { useState } from 'preact/hooks'
import {
  Search, Link2, ShieldCheck, Tag as TagIcon, AlertCircle, ArrowRight, CheckCircle2, Image as ImageIcon,
  Clock, Server, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { useInspectUrl, type UrlInspectResponse } from '@/hooks/useTools'
import { toast } from '@/lib/toast'

export function UrlInspectorPage() {
  const [url, setUrl] = useState('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const mut = useInspectUrl()
  const data = mut.data as UrlInspectResponse | undefined

  function inspect() {
    if (!url.trim()) { toast('Cole uma URL', 'danger'); return }
    let normalized = url.trim()
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`
    mut.mutate(normalized, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="URL Inspector"
      description="Audita uma URL antes de divulgar: UTMs aplicadas, pixels de tracking detectados, redirecionamentos, OG tags, SEO. Útil pra validar landing pages e anúncios."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-3">
        <div class="flex gap-2">
          <input
            type="url"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') inspect() }}
            placeholder="https://site.com/pagina?utm_source=..."
            class="flex-1 text-sm font-mono rounded-md border border-border bg-surface px-3 py-2 focus:outline-none focus:border-accent"
          />
          <Button variant="primary" size="sm" onClick={inspect} disabled={mut.isPending}>
            {mut.isPending ? 'Analisando…' : <><Search size={12} /> Analisar</>}
          </Button>
        </div>
      </Card>

      {mut.isPending && (
        <div class="space-y-3 mt-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}

      {data && data.ok === false && (
        <Card class="border-danger/40 bg-danger/10 mt-4">
          <div class="flex items-start gap-3">
            <AlertCircle size={18} class="text-danger shrink-0 mt-0.5" />
            <div class="flex-1">
              <div class="text-sm font-semibold text-fg">Falha ao buscar URL</div>
              <div class="text-xs font-mono text-fg-muted mt-1">{data.error}</div>
            </div>
          </div>
        </Card>
      )}

      {data && data.ok && (
        <div class="space-y-3 mt-4">
          <StatusCard data={data} />
          <RedirectsCard data={data} />
          <UtmsAndClickIdsCard data={data} />
          <TrackersCard data={data} />
          <SeoOgCard data={data} />
          {data.jsonLd.length > 0 && <JsonLdCard data={data} />}
        </div>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o URL Inspector?"
        problem={<>
          Você vai mandar tráfego pago pra uma landing page. Ela tem o pixel certo? As UTMs estão
          chegando? Tem redirecionamento perdendo parâmetros? OG tag está válida pro WhatsApp/Facebook?
          Em vez de adivinhar (e perder dinheiro descobrindo depois), <strong>cole a URL aqui</strong> e
          o inspector responde tudo.
        </>}
        steps={[
          {
            title: '🔗 Cole a URL',
            body: <>URL completa (com UTMs se houver). Pode ser sua landing, anúncio, post do blog, link rastreável. O sistema acessa a página como se fosse um navegador real.</>,
          },
          {
            title: '🔄 Vê os redirecionamentos',
            body: <>Se a URL passa por 1, 2, 3 redirects antes do destino final, mostra cada salto. Se algum salto <strong>perde UTMs</strong>, o inspetor avisa — é causa comum de "tráfego anônimo".</>,
          },
          {
            title: '🏷️ UTMs e Click IDs',
            body: <>Lista de todos os parâmetros detectados na URL final: utm_source, utm_campaign, fbclid, gclid, etc. Confirma que os identificadores do Meta/Google estão chegando.</>,
          },
          {
            title: '👁️ Pixels e trackers',
            body: <>Detecta pixels instalados na página: Meta Pixel, Google Analytics, GA4, Google Tag Manager, Hotjar, Mixpanel, e mais. Se o pixel não aparecer, ele não tá funcionando.</>,
          },
          {
            title: '📱 SEO e Open Graph',
            body: <>Title, meta description, OG title/image/description. Mostra como o link aparece quando alguém compartilha no WhatsApp/Facebook. Imagem de OG quebrada = compartilhamento sem visual.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Caso de uso comum',
          body: <>Antes de subir uma campanha nova com R$ 5k de orçamento, cole 5 URLs de criativos no inspector. Confere se: pixel tá instalado, UTM tá vindo correto, OG tá funcionando. 5 minutos aqui salvam dias de mídia perdida.</>,
        }}
      />
    </Page>
  )
}

function StatusCard({ data }: { data: UrlInspectResponse }) {
  const ok = data.finalStatus >= 200 && data.finalStatus < 300
  return (
    <Card class="p-3">
      <div class="flex items-start gap-3">
        {ok ? <CheckCircle2 size={18} class="text-success shrink-0 mt-0.5" />
            : <AlertCircle size={18} class="text-warning shrink-0 mt-0.5" />}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <Badge tone={ok ? 'success' : 'warning'} solid>HTTP {data.finalStatus}</Badge>
            <span class="text-xs text-fg-muted flex items-center gap-1"><Clock size={11} /> {data.elapsedMs}ms</span>
            {data.headers.strictTransport && <Badge tone="success">HSTS</Badge>}
            {data.headers.server && <span class="text-xs text-fg-subtle flex items-center gap-1"><Server size={11} /> {data.headers.server}</span>}
          </div>
          <div class="text-xs text-fg-muted">URL final:</div>
          <code class="block text-xs font-mono text-fg break-all">{data.finalUrl}</code>
          {data.headers.contentType && <div class="text-[0.6875rem] text-fg-subtle mt-1">Content-Type: <code class="font-mono">{data.headers.contentType}</code></div>}
        </div>
      </div>
    </Card>
  )
}

function RedirectsCard({ data }: { data: UrlInspectResponse }) {
  if (data.redirects.length === 0) return null
  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
        <ArrowRight size={11} /> Redirecionamentos ({data.redirects.length})
      </div>
      <ol class="space-y-1.5 text-xs">
        {data.redirects.map((r, i) => (
          <li key={i} class="flex items-start gap-2">
            <Badge tone={r.status === 301 ? 'success' : 'warning'}>{r.status}</Badge>
            <div class="flex-1 min-w-0">
              <code class="block font-mono text-fg-muted break-all">{r.from}</code>
              <div class="text-fg-subtle pl-2">↳</div>
              <code class="block font-mono text-fg break-all pl-2">{r.to}</code>
            </div>
          </li>
        ))}
      </ol>
      {data.redirects.length > 3 && (
        <div class="text-[0.6875rem] text-warning mt-2">
          ⚠ Muitos redirects (perde tempo de carregamento e pode invalidar tracking — Meta/Google podem perder UTM em chains longas).
        </div>
      )}
    </Card>
  )
}

function UtmsAndClickIdsCard({ data }: { data: UrlInspectResponse }) {
  const utmEntries = Object.entries(data.utms).filter(([_, v]) => v != null)
  const clickEntries = Object.entries(data.clickIds).filter(([_, v]) => v != null)
  const hasNone = utmEntries.length === 0 && clickEntries.length === 0
  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
        <TagIcon size={11} /> UTMs &amp; Click IDs
      </div>
      {hasNone && (
        <div class="text-xs text-warning">⚠ Nenhuma UTM ou Click ID detectado. Tráfego pode ficar como "direto/orgânico" no relatório.</div>
      )}
      {utmEntries.length > 0 && (
        <div class="mb-2">
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">UTMs</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {utmEntries.map(([k, v]) => (
              <div key={k} class="text-xs flex items-center gap-2">
                <code class="font-mono text-fg-muted bg-surface-2 rounded px-1.5 py-0.5">{k}</code>
                <span class="text-fg truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {clickEntries.length > 0 && (
        <div>
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">Click IDs (atribuição cross-device)</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {clickEntries.map(([k, v]) => (
              <div key={k} class="text-xs flex items-center gap-2">
                <Badge tone="info">{k}</Badge>
                <code class="font-mono text-fg truncate">{v}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function TrackersCard({ data }: { data: UrlInspectResponse }) {
  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
        <ShieldCheck size={11} /> Tags &amp; Pixels detectados ({data.trackers.length})
      </div>
      {data.trackers.length === 0 && (
        <div class="text-xs text-warning">⚠ Nenhum tracker conhecido detectado. Se essa página deveria capturar leads, faltam Meta Pixel/GA4/GTM.</div>
      )}
      {data.trackers.length > 0 && (
        <ul class="space-y-1.5">
          {data.trackers.map(t => (
            <li key={t.id} class="flex items-start gap-2 text-xs">
              <Badge tone="success">{t.name}</Badge>
              {t.ids && t.ids.length > 0 && (
                <div class="flex flex-wrap gap-1">
                  {t.ids.map(id => <code key={id} class="font-mono text-fg bg-surface-2 rounded px-1.5 py-0.5">{id}</code>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function SeoOgCard({ data }: { data: UrlInspectResponse }) {
  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
        <Link2 size={11} /> SEO &amp; Social Preview
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">Meta tags</div>
          <KV k="Título" v={data.seo.title} />
          <KV k="Descrição" v={data.seo.description} />
          <KV k="Idioma" v={data.seo.lang} />
          <KV k="Robots" v={data.seo.robots} />
          <KV k="Canonical" v={data.seo.canonical} />
          <KV k="Theme color" v={data.seo.themeColor} />
        </div>
        <div>
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">Open Graph (Facebook/WhatsApp)</div>
          <KV k="og:title" v={data.og.title} />
          <KV k="og:description" v={data.og.description} />
          <KV k="og:type" v={data.og.type} />
          <KV k="og:site_name" v={data.og.siteName} />
          {data.og.image && (
            <div class="mt-2">
              <div class="text-[0.6875rem] text-fg-subtle mb-1">og:image</div>
              <img src={data.og.image} alt="og:image preview" class="rounded border border-border max-h-32 object-cover" />
            </div>
          )}
        </div>
      </div>
      {!data.og.image && (
        <div class="text-[0.6875rem] text-warning mt-2 flex items-center gap-1">
          <AlertCircle size={11} /> Sem <code class="font-mono">og:image</code> — link vai aparecer sem prévia no WhatsApp/Facebook.
        </div>
      )}
    </Card>
  )
}

function JsonLdCard({ data }: { data: UrlInspectResponse }) {
  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
        <ImageIcon size={11} /> Schema.org / JSON-LD ({data.jsonLd.length})
      </div>
      <details>
        <summary class="text-xs cursor-pointer text-fg-muted">Ver blocos detectados</summary>
        <pre class="text-[0.6875rem] font-mono bg-surface-2 rounded p-2 mt-2 overflow-auto max-h-64">
{JSON.stringify(data.jsonLd, null, 2)}
        </pre>
      </details>
    </Card>
  )
}

function KV({ k, v }: { k: string; v: string | null }) {
  return (
    <div class="text-xs flex items-start gap-2 py-0.5">
      <span class="text-fg-muted shrink-0 w-24">{k}</span>
      <span class={v ? 'text-fg break-all' : 'text-fg-subtle italic'}>{v || '—'}</span>
    </div>
  )
}
