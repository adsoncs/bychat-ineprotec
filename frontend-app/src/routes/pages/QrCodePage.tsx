import { useEffect, useRef, useState } from 'preact/hooks'
import { QrCode, Download, Copy, Check, RefreshCw, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { env } from '@/lib/env'

type Format = 'png' | 'svg'
type Ec = 'L' | 'M' | 'Q' | 'H'

function readUrlParam(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('url') ?? ''
}

async function postQr(payload: any): Promise<Blob> {
  const token = localStorage.getItem(env.authTokenKey) || ''
  const res = await fetch(`${env.apiBase}/admin/tools/qrcode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  return await res.blob()
}

export function QrCodePage() {
  const [data, setData] = useState(readUrlParam())
  const [format, setFormat] = useState<Format>('png')
  const [size, setSize] = useState(512)
  const [margin, setMargin] = useState(2)
  const [foreground, setForeground] = useState('#000000')
  const [background, setBackground] = useState('#FFFFFF')
  const [errorCorrection, setEc] = useState<Ec>('M')

  // Para PNG: blob URL exibido via <img>. Para SVG: texto inline via innerHTML
  // (mais robusto que <object> com blob URL, que falha silenciosamente em alguns navegadores).
  const [pngUrl, setPngUrl] = useState<string>('')
  const [svgMarkup, setSvgMarkup] = useState<string>('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<any>(null)
  const lastBlob = useRef<Blob | null>(null)

  // Cleanup do blob URL anterior pra evitar leak
  useEffect(() => {
    return () => { if (pngUrl) URL.revokeObjectURL(pngUrl) }
  }, [pngUrl])

  useEffect(() => {
    if (!data) {
      setPngUrl(''); setSvgMarkup(''); setError(null)
      return
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const blob = await postQr({ data, format, size, margin, foreground, background, errorCorrection })
        lastBlob.current = blob
        if (format === 'svg') {
          const text = await blob.text()
          setSvgMarkup(text)
          if (pngUrl) { URL.revokeObjectURL(pngUrl); setPngUrl('') }
        } else {
          if (pngUrl) URL.revokeObjectURL(pngUrl)
          setPngUrl(URL.createObjectURL(blob))
          setSvgMarkup('')
        }
      } catch (e: any) {
        setError(e?.message || 'Falha ao gerar')
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => debounce.current && clearTimeout(debounce.current)
  }, [data, format, size, margin, foreground, background, errorCorrection])

  function download() {
    if (!lastBlob.current) { toast('Aguarde o preview', 'danger'); return }
    const ext = format === 'svg' ? 'svg' : 'png'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(lastBlob.current)
    a.download = `qrcode.${ext}`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    toast(`QR ${ext.toUpperCase()} baixado`, 'success')
  }

  const [copied, setCopied] = useState(false)
  function copyData() {
    if (!data) return
    navigator.clipboard.writeText(data).then(() => {
      setCopied(true); toast('Conteúdo copiado', 'success')
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => toast('Falha ao copiar', 'danger'))
  }

  const dataLen = data.length

  return (
    <Page
      title="QR Code"
      description="Gera QR Code de qualquer URL ou texto. Customize cor, tamanho e nível de correção. Ideal pra panfletos, eventos, embalagens, balcão."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-3">
            <div>
              <label class="text-xs text-fg-muted block mb-1 flex items-center justify-between">
                <span>Conteúdo (URL ou texto) *</span>
                {data && (
                  <button
                    type="button"
                    onClick={copyData}
                    class="text-[0.6875rem] text-info hover:underline flex items-center gap-1"
                  >
                    {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'copiado' : 'copiar'}
                  </button>
                )}
              </label>
              <textarea
                value={data}
                onInput={(e) => setData((e.target as HTMLTextAreaElement).value)}
                placeholder="https://site.com/pagina?utm_source=..."
                rows={3}
                class="w-full text-sm font-mono rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
                maxLength={2048}
              />
              <div class="text-[0.6875rem] text-fg-subtle mt-0.5">{dataLen}/2048 caracteres</div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <Select label="Formato" value={format} onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}>
                <option value="png">PNG (raster)</option>
                <option value="svg">SVG (vetor)</option>
              </Select>
              <Select label="Correção de erro" value={errorCorrection} onChange={(e) => setEc((e.target as HTMLSelectElement).value as Ec)} hint="Maior nível = mais robusto a manchas/dano, QR mais denso">
                <option value="L">Baixa (7%)</option>
                <option value="M">Média (15%) — padrão</option>
                <option value="Q">Alta (25%)</option>
                <option value="H">Máxima (30%)</option>
              </Select>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <Input
                label="Tamanho (px)"
                type="number"
                value={String(size)}
                onInput={(e) => setSize(Math.max(64, Math.min(1024, parseInt((e.target as HTMLInputElement).value) || 512)))}
                hint="64 a 1024 — só afeta PNG (SVG é vetor)"
              />
              <Input
                label="Margem (módulos)"
                type="number"
                value={String(margin)}
                onInput={(e) => setMargin(Math.max(0, Math.min(8, parseInt((e.target as HTMLInputElement).value) || 2)))}
                hint="0 a 8 — espaço em branco ao redor"
              />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs text-fg-muted block mb-1">Cor (frente)</label>
                <div class="flex gap-2 items-center">
                  <input
                    type="color"
                    value={foreground}
                    onInput={(e) => setForeground((e.target as HTMLInputElement).value)}
                    class="h-8 w-12 rounded border border-border bg-surface"
                  />
                  <input
                    type="text"
                    value={foreground}
                    onInput={(e) => setForeground((e.target as HTMLInputElement).value)}
                    class="flex-1 text-sm font-mono rounded-md border border-border bg-surface px-2 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label class="text-xs text-fg-muted block mb-1">Cor (fundo)</label>
                <div class="flex gap-2 items-center">
                  <input
                    type="color"
                    value={background}
                    onInput={(e) => setBackground((e.target as HTMLInputElement).value)}
                    class="h-8 w-12 rounded border border-border bg-surface"
                  />
                  <input
                    type="text"
                    value={background}
                    onInput={(e) => setBackground((e.target as HTMLInputElement).value)}
                    class="flex-1 text-sm font-mono rounded-md border border-border bg-surface px-2 py-1.5"
                  />
                </div>
              </div>
            </div>

            <div class="text-[0.6875rem] text-fg-subtle">
              <strong>Dica:</strong> contraste alto é importante — preto/branco é o mais legível pra scanners de qualquer celular. Se quiser cor da marca, garanta que o frente seja escuro e o fundo seja claro (ou inverso).
            </div>
          </div>

          <div>
            <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-1 flex items-center gap-1">
              <QrCode size={11} /> Preview
              {loading && <RefreshCw size={10} class="animate-spin ml-auto" />}
            </div>
            <Card class="p-4 grid place-items-center min-h-[20rem]" style={{ background }}>
              {error && (
                <div class="text-xs text-danger text-center">{error}</div>
              )}
              {!error && !data && (
                <div class="text-xs text-fg-muted text-center">Digite a URL ou texto para gerar o QR.</div>
              )}
              {!error && format === 'png' && pngUrl && (
                <img src={pngUrl} alt="QR Code preview" class="max-w-full max-h-80 object-contain" />
              )}
              {!error && format === 'svg' && svgMarkup && (
                <div
                  class="max-w-full max-h-80 [&>svg]:max-w-full [&>svg]:max-h-80 [&>svg]:w-full [&>svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
                />
              )}
            </Card>
            <div class="flex gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={download} disabled={!lastBlob.current || loading}>
                <Download size={12} /> Baixar {format.toUpperCase()}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o QR Code?"
        problem={<>
          QR Code transforma qualquer link/texto em um <strong>código que cliente escaneia com a
          câmera do celular</strong>. Ideal pra usar offline: panfletos, vitrines, embalagens, totens,
          cartões de visita, balcão. Cliente aponta a câmera, toca no link, abre direto.
        </>}
        steps={[
          {
            title: '✍️ Digite o conteúdo',
            body: <>Pode ser uma URL (https://...), o link de WhatsApp (wa.me/...), um texto, um e-mail, um número de telefone. O QR aceita qualquer string até ~3000 caracteres.</>,
          },
          {
            title: '🎨 Customize as cores',
            body: <>Cor de fundo e cor das marcas. Cuidado: <strong>contraste alto</strong> é obrigatório pra câmera ler. Branco com preto é o mais seguro. Cinza com cinza não funciona.</>,
          },
          {
            title: '📐 Defina tamanho e margem',
            body: <>Pra impressão grande (cartaz, vitrine), use 512px+. Margem ao redor é obrigatória pra câmera "enxergar" o código — não corte rente ao desenho.</>,
          },
          {
            title: '🛡️ Correção de erro',
            body: <>L/M/Q/H define quanto o QR resiste a sujeira/rasgo/logo no meio. <strong>L</strong> é fino (denso), <strong>H</strong> é grosso (resistente). Pra cartaz que vai pegar chuva ou sujeira, use H.</>,
          },
          {
            title: '⬇️ Baixe e use',
            body: <>PNG: pra usar em imagens, posts, embalagens. SVG: pra impressão profissional (não pixela em nenhum tamanho). Teste sempre escaneando antes de mandar pra gráfica.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Teste antes de imprimir',
          body: <>Imprima uma amostra pequena, escaneie com 3 celulares diferentes (Android, iPhone, iPhone antigo). Câmera de iPhone velho é o mais exigente — se funcionar lá, funciona em todos. Erro caro: imprimir 1000 panfletos com QR que ninguém consegue ler.</>,
        }}
      />
    </Page>
  )
}
