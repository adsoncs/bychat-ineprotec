import { useEffect, useRef, useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea, Switch } from '@/components/ui/Input'
import { RefreshCw, Upload, X, AlertTriangle } from '@/components/ui/icon-set'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  DEFAULT_QR_STYLE, KIND_LABEL, renderQrSvg, useCreateQrCode, useUpdateQrCode,
  type QrCodeItem, type QrKind, type QrStyle,
} from '@/hooks/useQrCodes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = novo QR */
  editing: QrCodeItem | null
  folders: string[]
}

const KINDS: QrKind[] = ['url', 'whatsapp', 'vcard', 'text', 'email', 'sms', 'tel', 'wifi']

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label class="text-xs text-fg-muted block mb-1">{label}</label>
      <div class="flex gap-2 items-center">
        <input type="color" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} class="h-8 w-10 rounded border border-border bg-surface" />
        <input type="text" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} class="flex-1 min-w-0 text-sm font-mono rounded-md border border-border bg-surface px-2 py-1.5" />
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div class="inline-flex rounded-md border border-border overflow-hidden">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          class={cn('px-2.5 py-1 text-xs', v === value ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:text-fg')}
        >{l}</button>
      ))}
    </div>
  )
}

/** Luminância relativa — para avisar quando o contraste não deixa a câmera ler. */
function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.length === 4 ? '#' + hex.slice(1).split('').map(c => c + c).join('') : hex)
  if (!m) return 0
  const n = parseInt(m[1]!, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

export function QrEditorModal({ open, onOpenChange, editing, folders }: Props) {
  const create = useCreateQrCode()
  const update = useUpdateQrCode()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<QrKind>('url')
  const [slug, setSlug] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [payload, setPayload] = useState<Record<string, any>>({})
  const [style, setStyle] = useState<QrStyle>(DEFAULT_QR_STYLE)
  const [folder, setFolder] = useState('')
  const [utm, setUtm] = useState({ utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '' })
  const [expiresAt, setExpiresAt] = useState('')
  const [expiredUrl, setExpiredUrl] = useState('')
  const [active, setActive] = useState(true)
  const [tab, setTab] = useState<'conteudo' | 'visual' | 'rastreio'>('conteudo')

  const [svg, setSvg] = useState('')
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const debounce = useRef<any>(null)

  // Carrega o QR em edição (ou zera para um novo) toda vez que o modal abre.
  useEffect(() => {
    if (!open) return
    const e = editing
    setName(e?.name ?? '')
    setKind(e?.kind ?? 'url')
    setSlug(e?.slug ?? '')
    setDestinationUrl(e?.destinationUrl ?? '')
    setPayload(e?.payload ?? {})
    setStyle({ ...DEFAULT_QR_STYLE, ...(e?.style ?? {}) })
    setFolder(e?.folder ?? '')
    setUtm({
      utmSource: e?.utmSource ?? '', utmMedium: e?.utmMedium ?? '', utmCampaign: e?.utmCampaign ?? '',
      utmContent: e?.utmContent ?? '', utmTerm: e?.utmTerm ?? '',
    })
    setExpiresAt(e?.expiresAt ? e.expiresAt.slice(0, 16) : '')
    setExpiredUrl(e?.expiredUrl ?? '')
    setActive(e?.active ?? true)
    setTab('conteudo')
  }, [open, editing])

  // Prévia ao vivo. QR dinâmico: o desenho só depende do endereço curto (o
  // destino pode mudar à vontade). Wi-Fi: depende do conteúdo.
  useEffect(() => {
    if (!open) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        setSvg(await renderQrSvg({ kind, slug: editing?.slug || slug || 'previa', payload, style, size: 320 }))
        setPreviewErr(null)
      } catch (err: any) {
        setPreviewErr(err?.message || 'Falha na prévia')
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => debounce.current && clearTimeout(debounce.current)
  }, [open, kind, slug, payload, style, editing])

  const p = (k: string) => String(payload[k] ?? '')
  const setP = (k: string, v: any) => setPayload((cur) => ({ ...cur, [k]: v }))
  const setS = <K extends keyof QrStyle>(k: K, v: QrStyle[K]) => setStyle((cur) => ({ ...cur, [k]: v }))

  function onLogo(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    ;(e.target as HTMLInputElement).value = ''
    if (!file) return
    if (file.size > 300 * 1024) { toast('Logo muito grande — use até 300 KB (PNG ou SVG de preferência)', 'danger'); return }
    const reader = new FileReader()
    reader.onload = () => setS('logo', String(reader.result))
    reader.readAsDataURL(file)
  }

  const ratio = contrast(style.foreground, style.background)
  const lowContrast = ratio < 3
  const inverted = lum(style.foreground) > lum(style.background)
  const isStatic = kind === 'wifi'
  const busy = create.isPending || update.isPending

  async function save() {
    const body = {
      name: name.trim(), kind, destinationUrl: kind === 'url' ? destinationUrl.trim() : null, payload, style,
      folder: folder.trim() || null, ...Object.fromEntries(Object.entries(utm).map(([k, v]) => [k, v.trim() || null])),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, expiredUrl: expiredUrl.trim() || null, active,
    }
    try {
      if (editing) await update.mutateAsync({ id: editing.id, ...body })
      else await create.mutateAsync({ ...body, slug: slug.trim() || undefined })
      toast(editing ? 'QR Code atualizado' : 'QR Code criado', 'success')
      onOpenChange(false)
    } catch (err: any) {
      toast(err?.message || 'Não foi possível salvar', 'danger')
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Editar: ${editing.name}` : 'Novo QR Code'}
      description={isStatic
        ? 'Wi-Fi é gravado direto no código: o celular conecta sem passar pelo sistema, então não há contagem de leituras.'
        : 'O QR aponta para um endereço curto do sistema, que conta cada leitura e leva ao destino. Dá para trocar o destino depois sem reimprimir.'}
      size="full"
      unconstrained
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Salvando…' : editing ? 'Salvar' : 'Criar QR Code'}</Button>
        </div>
      }
    >
      <div class="grid gap-5 lg:grid-cols-[1fr_340px] max-w-5xl mx-auto w-full">
        <div class="space-y-4 min-w-0">
          <div class="flex gap-1 border-b border-border">
            {([['conteudo', 'Conteúdo'], ['visual', 'Visual'], ['rastreio', 'Rastreio e validade']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                class={cn('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg')}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'conteudo' && (
            <div class="space-y-3">
              <Input label="Nome *" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Panfleto feira de novembro" hint="Só para você identificar na lista e no relatório." />
              <div>
                <label class="text-xs text-fg-muted block mb-1">Tipo</label>
                <div class="flex flex-wrap gap-1.5">
                  {KINDS.map((k) => {
                    const blocked = !!editing && ((k === 'wifi') !== (editing.kind === 'wifi'))
                    return (
                      <button key={k} type="button" disabled={blocked} onClick={() => setKind(k)}
                        title={blocked ? 'Não dá para trocar de/para Wi-Fi depois de criado — o QR impresso mudaria' : undefined}
                        class={cn('px-3 py-1.5 rounded-md border text-xs', kind === k ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-muted hover:text-fg', blocked && 'opacity-40 cursor-not-allowed')}>
                        {KIND_LABEL[k]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {kind === 'url' && (
                <Input label="Endereço de destino *" value={destinationUrl} onInput={(e) => setDestinationUrl((e.target as HTMLInputElement).value)} placeholder="https://seusite.com.br/pagina" />
              )}
              {kind === 'whatsapp' && (<>
                <Input label="Número do WhatsApp *" value={p('phone')} onInput={(e) => setP('phone', (e.target as HTMLInputElement).value)} placeholder="55 62 99999-9999" hint="Com DDI e DDD." />
                <Textarea label="Mensagem pronta" rows={3} value={p('message')} onInput={(e) => setP('message', (e.target as HTMLTextAreaElement).value)} placeholder="Olá! Vi o panfleto e quero saber mais." />
              </>)}
              {kind === 'vcard' && (
                <div class="grid grid-cols-2 gap-2">
                  <Input label="Nome" value={p('firstName')} onInput={(e) => setP('firstName', (e.target as HTMLInputElement).value)} />
                  <Input label="Sobrenome" value={p('lastName')} onInput={(e) => setP('lastName', (e.target as HTMLInputElement).value)} />
                  <Input label="Empresa" value={p('company')} onInput={(e) => setP('company', (e.target as HTMLInputElement).value)} />
                  <Input label="Cargo" value={p('title')} onInput={(e) => setP('title', (e.target as HTMLInputElement).value)} />
                  <Input label="Telefone" value={p('phone')} onInput={(e) => setP('phone', (e.target as HTMLInputElement).value)} placeholder="+55 62 99999-9999" />
                  <Input label="E-mail" value={p('email')} onInput={(e) => setP('email', (e.target as HTMLInputElement).value)} />
                  <Input label="Site" value={p('website')} onInput={(e) => setP('website', (e.target as HTMLInputElement).value)} class="col-span-2" />
                  <Input label="Endereço" value={p('address')} onInput={(e) => setP('address', (e.target as HTMLInputElement).value)} class="col-span-2" />
                </div>
              )}
              {kind === 'text' && (
                <Textarea label="Texto *" rows={5} value={p('text')} onInput={(e) => setP('text', (e.target as HTMLTextAreaElement).value)} hint="Abre numa página simples com este texto." />
              )}
              {kind === 'email' && (<>
                <Input label="Para (e-mail) *" value={p('to')} onInput={(e) => setP('to', (e.target as HTMLInputElement).value)} />
                <Input label="Assunto" value={p('subject')} onInput={(e) => setP('subject', (e.target as HTMLInputElement).value)} />
                <Textarea label="Mensagem" rows={3} value={p('body')} onInput={(e) => setP('body', (e.target as HTMLTextAreaElement).value)} />
              </>)}
              {kind === 'sms' && (<>
                <Input label="Número *" value={p('phone')} onInput={(e) => setP('phone', (e.target as HTMLInputElement).value)} placeholder="55 62 99999-9999" />
                <Textarea label="Mensagem" rows={3} value={p('message')} onInput={(e) => setP('message', (e.target as HTMLTextAreaElement).value)} />
              </>)}
              {kind === 'tel' && (
                <Input label="Número *" value={p('phone')} onInput={(e) => setP('phone', (e.target as HTMLInputElement).value)} placeholder="55 62 3333-3333" />
              )}
              {kind === 'wifi' && (
                <div class="grid grid-cols-2 gap-2">
                  <Input label="Nome da rede (SSID) *" value={p('ssid')} onInput={(e) => setP('ssid', (e.target as HTMLInputElement).value)} />
                  <Input label="Senha" value={p('password')} onInput={(e) => setP('password', (e.target as HTMLInputElement).value)} />
                  <Select label="Segurança" value={p('auth') || 'WPA'} onChange={(e) => setP('auth', (e.target as HTMLSelectElement).value)}>
                    <option value="WPA">WPA/WPA2/WPA3</option>
                    <option value="WEP">WEP</option>
                    <option value="nopass">Sem senha</option>
                  </Select>
                  <div class="flex items-end pb-1"><Switch checked={!!payload.hidden} onChange={(v) => setP('hidden', v)} label="Rede oculta" /></div>
                </div>
              )}

              <div class="grid grid-cols-2 gap-2">
                <div>
                  <Input label="Pasta" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} list="qr-folders" placeholder="Ex.: Eventos 2026" />
                  <datalist id="qr-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
                </div>
                {!isStatic && (
                  <Input
                    label="Endereço curto"
                    value={editing ? editing.slug : slug}
                    disabled={!!editing}
                    onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
                    placeholder="gerado automaticamente"
                    hint={editing ? 'Fixo — já pode estar impresso.' : 'Opcional: letras, números e hífen.'}
                  />
                )}
              </div>
            </div>
          )}

          {tab === 'visual' && (
            <div class="space-y-4">
              <div class="grid grid-cols-3 gap-2">
                <ColorField label="Cor do código" value={style.foreground} onChange={(v) => setStyle((s) => ({ ...s, foreground: v, eyeColor: s.eyeColor === s.foreground ? v : s.eyeColor, frameColor: s.frameColor === s.foreground ? v : s.frameColor }))} />
                <ColorField label="Cor dos cantos" value={style.eyeColor} onChange={(v) => setS('eyeColor', v)} />
                <ColorField label="Fundo" value={style.background} onChange={(v) => setS('background', v)} />
              </div>
              {(lowContrast || inverted) && (
                <div class="flex gap-2 text-xs rounded-md border border-warning/40 bg-warning/10 p-2">
                  <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
                  <span>
                    {lowContrast && <>Contraste baixo ({ratio.toFixed(1)}:1). Muitos celulares não leem — use código escuro em fundo claro. </>}
                    {inverted && <>Código claro em fundo escuro: câmeras antigas e alguns leitores não leem QR invertido.</>}
                  </span>
                </div>
              )}

              <div class="space-y-1">
                <label class="text-xs text-fg-muted block">Formato dos pontos</label>
                <Segmented value={style.dotStyle} onChange={(v) => setS('dotStyle', v)} options={[['square', 'Quadrado'], ['rounded', 'Arredondado'], ['dots', 'Bolinhas']]} />
                {style.dotStyle === 'dots' && <div class="text-2xs text-fg-muted">Bolinhas é o estilo mais delicado: a correção sobe sozinha para Alta. Teste no celular antes de imprimir.</div>}
              </div>
              <div class="space-y-1">
                <label class="text-xs text-fg-muted block">Formato dos cantos</label>
                <Segmented value={style.eyeStyle} onChange={(v) => setS('eyeStyle', v)} options={[['square', 'Quadrado'], ['rounded', 'Arredondado'], ['circle', 'Círculo']]} />
              </div>

              <div>
                <label class="text-xs text-fg-muted block mb-1">Logo no centro</label>
                <div class="flex items-center gap-2">
                  <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs cursor-pointer hover:bg-surface-2">
                    <Upload size={12} /> {style.logo ? 'Trocar logo' : 'Enviar logo'}
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hidden" onChange={onLogo} />
                  </label>
                  {style.logo && (<>
                    <img src={style.logo} alt="" class="h-8 w-8 object-contain rounded border border-border bg-white" />
                    <button type="button" onClick={() => setS('logo', null)} class="text-xs text-danger inline-flex items-center gap-1"><X size={12} /> remover</button>
                  </>)}
                </div>
                {style.logo && (
                  <div class="mt-2">
                    <label class="text-2xs text-fg-muted">Tamanho do logo: {Math.round(style.logoSize * 100)}%</label>
                    <input type="range" min={12} max={30} value={Math.round(style.logoSize * 100)} onInput={(e) => setS('logoSize', Number((e.target as HTMLInputElement).value) / 100)} class="w-full" />
                    <div class="text-2xs text-fg-muted">Com logo a correção fica no máximo (30%) para o código continuar lendo.</div>
                  </div>
                )}
              </div>

              <div class="space-y-2">
                <Input label="Chamada na moldura" value={style.frameText ?? ''} onInput={(e) => setS('frameText', (e.target as HTMLInputElement).value || null)} placeholder="Ex.: ESCANEIE E GANHE 10%" maxLength={40} hint="Vazio = sem moldura. Até 40 caracteres." />
                {style.frameText && (
                  <div class="grid grid-cols-2 gap-2">
                    <ColorField label="Cor da moldura" value={style.frameColor} onChange={(v) => setS('frameColor', v)} />
                    <ColorField label="Cor do texto" value={style.frameTextColor} onChange={(v) => setS('frameTextColor', v)} />
                  </div>
                )}
              </div>

              <div class="grid grid-cols-2 gap-2">
                <Select label="Correção de erro" value={style.errorCorrection} disabled={!!style.logo} onChange={(e) => setS('errorCorrection', (e.target as HTMLSelectElement).value as QrStyle['errorCorrection'])} hint="Mais alta = aguenta sujeira e dobra; código mais denso.">
                  <option value="L">Baixa (7%)</option>
                  <option value="M">Média (15%)</option>
                  <option value="Q">Alta (25%)</option>
                  <option value="H">Máxima (30%)</option>
                </Select>
                <Input label="Margem (módulos)" type="number" value={String(style.margin)} onInput={(e) => setS('margin', Math.max(0, Math.min(8, parseInt((e.target as HTMLInputElement).value) || 0)))} hint="Espaço em branco em volta. Mínimo recomendado: 2." />
              </div>
            </div>
          )}

          {tab === 'rastreio' && (
            <div class="space-y-4">
              {isStatic ? (
                <div class="text-sm text-fg-muted">Wi-Fi não passa pelo sistema, então não tem rastreio nem validade.</div>
              ) : (<>
                {kind === 'url' && (
                  <div class="space-y-2">
                    <div class="text-xs text-fg-muted">UTMs somadas ao destino, para o Google Analytics saber de onde veio a visita. As que já estiverem na URL de destino são mantidas. Sem "meio", a leitura do QR entra como <code>utm_medium=qrcode</code>.</div>
                    <div class="grid grid-cols-2 gap-2">
                      <Input label="Origem (utm_source)" value={utm.utmSource} onInput={(e) => setUtm({ ...utm, utmSource: (e.target as HTMLInputElement).value })} placeholder="panfleto, outdoor, cartao" />
                      <Input label="Meio (utm_medium)" value={utm.utmMedium} onInput={(e) => setUtm({ ...utm, utmMedium: (e.target as HTMLInputElement).value })} placeholder="qrcode" />
                      <Input label="Campanha (utm_campaign)" value={utm.utmCampaign} onInput={(e) => setUtm({ ...utm, utmCampaign: (e.target as HTMLInputElement).value })} />
                      <Input label="Conteúdo (utm_content)" value={utm.utmContent} onInput={(e) => setUtm({ ...utm, utmContent: (e.target as HTMLInputElement).value })} />
                    </div>
                  </div>
                )}
                <div class="grid grid-cols-2 gap-2">
                  <Input label="Válido até" type="datetime-local" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} hint="Vazio = sem validade." />
                  <Input label="Depois de vencer, levar para" value={expiredUrl} onInput={(e) => setExpiredUrl((e.target as HTMLInputElement).value)} placeholder="https://… (opcional)" hint="Sem endereço, mostra “QR expirado”." />
                </div>
                <Switch checked={active} onChange={setActive} label="QR Code ativo" hint="Desativado, quem ler vê “QR Code não está mais ativo”. O histórico continua guardado." />
              </>)}
            </div>
          )}
        </div>

        <div class="lg:sticky lg:top-0 self-start">
          <div class="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1">
            Prévia {loading && <RefreshCw size={10} class="animate-spin ml-auto" />}
          </div>
          <div class="rounded-lg border border-border p-4 grid place-items-center min-h-[18rem]" style={{ background: style.frameText ? '#f4f5f7' : style.background }}>
            {previewErr
              ? <div class="text-xs text-danger text-center">{previewErr}</div>
              : svg
                ? <div class="w-full max-w-[280px] [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
                : <div class="text-xs text-fg-muted">Gerando…</div>}
          </div>
          {!isStatic && (
            <div class="text-2xs text-fg-muted mt-2">
              {editing ? <>Este QR leva a <code class="break-all">{editing.qrUrl}</code>. O desenho não muda quando você troca o destino.</> : <>O endereço curto definitivo é criado ao salvar.</>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
