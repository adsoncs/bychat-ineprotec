import { useEffect, useState } from 'preact/hooks'
import { Save, Copy, Check, MapPin, QrCode, Download } from 'lucide-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { env } from '@/lib/env'

interface Identidade {
  endereco: string
  cidade: string
  estado: string
  cep: string
  latitude: number | null
  longitude: number | null
  mapaUrl: string
  pixChave: string
  pixTipo: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'
  pixBeneficiario: string
  pixCidade: string
  pixBanco: string
}

const PADRAO: Identidade = {
  endereco: '', cidade: '', estado: '', cep: '',
  latitude: null, longitude: null, mapaUrl: '',
  pixChave: '', pixTipo: 'cnpj', pixBeneficiario: '', pixCidade: '', pixBanco: '',
}

export function CompanyIdentitySettings() {
  const qc = useQueryClient()
  const [d, setD] = useState<Identidade>(PADRAO)
  const [copiado, setCopiado] = useState(false)
  const [verQr, setVerQr] = useState(false)

  const q = useQuery({
    queryKey: ['company-identity'],
    queryFn: () => api.get<{ dados: Identidade; pixCopiaECola: string; enderecoLinha: string }>('/admin/company-identity'),
  })

  useEffect(() => { if (q.data?.dados) setD({ ...PADRAO, ...q.data.dados }) }, [q.data])

  const salvar = useMutation({
    mutationFn: (v: Identidade) => api.put<{ ok: true; pixCopiaECola: string }>('/admin/company-identity', v),
    onSuccess: () => {
      toast('Dados da empresa salvos', 'success')
      void qc.invalidateQueries({ queryKey: ['company-identity'] })
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast('Não foi possível copiar — selecione o texto manualmente.', 'warning')
    }
  }

  if (q.isLoading) return <Skeleton class="h-96 w-full" />

  const codigo = q.data?.pixCopiaECola || ''
  const qrUrl = `${env.apiBase}/admin/company-identity/pix-qrcode.png?size=320`

  return (
    <div class="space-y-6">
      <section class="rounded-lg border border-border bg-surface p-4">
        <header class="mb-3 flex items-center gap-2">
          <MapPin size={16} class="text-fg-muted" />
          <h3 class="font-medium">Endereço e localização</h3>
        </header>
        <p class="mb-4 text-sm text-fg-muted">
          Preenchido aqui uma vez, fica disponível como variável em qualquer modelo de mensagem
          — sem ninguém redigitar endereço e sem versões diferentes espalhadas.
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <Input
              label="Endereço"
              value={d.endereco}
              placeholder="Rua, número, complemento e bairro"
              onInput={(e) => setD({ ...d, endereco: (e.target as HTMLInputElement).value })}
            />
          </div>
          <Input label="Cidade" value={d.cidade} onInput={(e) => setD({ ...d, cidade: (e.target as HTMLInputElement).value })} />
          <div class="grid grid-cols-2 gap-3">
            <Input label="UF" value={d.estado} maxLength={2} onInput={(e) => setD({ ...d, estado: (e.target as HTMLInputElement).value.toUpperCase() })} />
            <Input label="CEP" value={d.cep} onInput={(e) => setD({ ...d, cep: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="sm:col-span-2">
            <Input
              label="Link do mapa"
              value={d.mapaUrl}
              placeholder="https://maps.app.goo.gl/…"
              hint="Cole o link curto do Google Maps."
              onInput={(e) => setD({ ...d, mapaUrl: (e.target as HTMLInputElement).value })}
            />
          </div>
          <Input
            label="Latitude"
            value={d.latitude ?? ''}
            placeholder="-16.6869"
            hint="Opcional — permite enviar a localização no WhatsApp."
            onInput={(e) => setD({ ...d, latitude: Number((e.target as HTMLInputElement).value) || null })}
          />
          <Input
            label="Longitude"
            value={d.longitude ?? ''}
            placeholder="-49.2648"
            onInput={(e) => setD({ ...d, longitude: Number((e.target as HTMLInputElement).value) || null })}
          />
        </div>

        {d.latitude && d.longitude && (
          <a
            class="mt-2 inline-block text-xs text-accent hover:underline"
            href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`}
            target="_blank"
            rel="noopener"
          >
            Conferir estas coordenadas no mapa →
          </a>
        )}
      </section>

      <section class="rounded-lg border border-border bg-surface p-4">
        <header class="mb-3 flex items-center gap-2">
          <QrCode size={16} class="text-fg-muted" />
          <h3 class="font-medium">PIX da empresa</h3>
        </header>
        <p class="mb-4 text-sm text-fg-muted">
          Gera o código <strong>copia e cola</strong> que o cliente cola no aplicativo do banco.
          É o mesmo conteúdo do QR Code — um para colar, outro para apontar a câmera.
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <Select
            label="Tipo da chave"
            value={d.pixTipo}
            onChange={(e) => setD({ ...d, pixTipo: (e.target as HTMLSelectElement).value as Identidade['pixTipo'] })}
          >
            <option value="cnpj">CNPJ</option>
            <option value="cpf">CPF</option>
            <option value="email">E-mail</option>
            <option value="telefone">Telefone</option>
            <option value="aleatoria">Chave aleatória</option>
          </Select>
          <Input label="Chave PIX" value={d.pixChave} onInput={(e) => setD({ ...d, pixChave: (e.target as HTMLInputElement).value })} />
          <Input
            label="Nome do recebedor"
            value={d.pixBeneficiario}
            maxLength={25}
            hint="Como aparece no app de quem paga (até 25 caracteres)."
            onInput={(e) => setD({ ...d, pixBeneficiario: (e.target as HTMLInputElement).value })}
          />
          <Input
            label="Cidade do recebedor"
            value={d.pixCidade}
            maxLength={15}
            hint="Até 15 caracteres, sem acento."
            onInput={(e) => setD({ ...d, pixCidade: (e.target as HTMLInputElement).value })}
          />
          <Input
            label="Banco"
            value={d.pixBanco}
            placeholder="Itaú, Nubank…"
            hint="Só informativo — aparece na mensagem enviada."
            onInput={(e) => setD({ ...d, pixBanco: (e.target as HTMLInputElement).value })}
          />
        </div>

        {codigo ? (
          <div class="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div class="mb-2 text-xs uppercase tracking-wider text-fg-subtle">PIX copia e cola</div>
            <div class="flex flex-wrap items-start gap-3">
              <code class="min-w-0 flex-1 break-all rounded bg-surface p-2 text-xs">{codigo}</code>
              <div class="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => copiar(codigo)}>
                  {copiado ? <Check size={13} /> : <Copy size={13} />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setVerQr((v) => !v)}>
                  <QrCode size={13} /> {verQr ? 'Ocultar QR' : 'Ver QR'}
                </Button>
              </div>
            </div>

            {verQr && (
              <div class="mt-3 flex items-center gap-3">
                <img src={qrUrl} alt="QR Code do PIX" class="size-40 rounded bg-white p-1" />
                <a href={`${qrUrl.replace('size=320', 'size=1024')}`} download="pix.png" class="text-xs text-accent hover:underline">
                  <Download size={12} class="inline" /> Baixar em alta resolução
                </a>
              </div>
            )}

            <p class="mt-2 text-xs text-fg-subtle">
              Código sem valor definido: o cliente escolhe quanto pagar. Nas mensagens, use a
              variável <code>{'{{pix_copia_cola}}'}</code>.
            </p>
          </div>
        ) : (
          <p class="mt-3 text-xs text-fg-subtle">Preencha a chave para gerar o código copia e cola.</p>
        )}
      </section>

      <section class="rounded-lg border border-border bg-surface-2 p-4 text-xs text-fg-muted">
        <div class="mb-2 font-medium text-fg">Variáveis disponíveis nos modelos de mensagem</div>
        <div class="grid gap-1 sm:grid-cols-2">
          {[
            ['{{empresa_nome}}', 'nome da empresa'],
            ['{{empresa_endereco}}', 'endereço completo em uma linha'],
            ['{{empresa_cidade}}', 'cidade'],
            ['{{empresa_cep}}', 'CEP'],
            ['{{empresa_mapa}}', 'link do mapa'],
            ['{{pix_copia_cola}}', 'código PIX para colar no banco'],
            ['{{pix_chave}}', 'chave PIX'],
            ['{{pix_beneficiario}}', 'nome do recebedor'],
            ['{{pix_banco}}', 'banco'],
          ].map(([v, desc]) => (
            <div key={v}><code class="text-accent">{v}</code> — {desc}</div>
          ))}
        </div>
      </section>

      <div class="flex justify-end">
        <Button variant="primary" size="md" onClick={() => salvar.mutate(d)} disabled={salvar.isPending}>
          <Save size={14} /> {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
