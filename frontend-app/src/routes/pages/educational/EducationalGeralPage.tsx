// Educacional › Configurações Gerais
//
// O que é da instituição toda: identidade, aparência base, a tela de entrar do
// portal (uma só para todos os portais) e atalhos para as configurações que
// continuam nas telas delas.
//
// Precedência: valor do portal › Configurações Gerais › padrão do sistema.
// Cada portal mantém as personalizações dele (aba Branding); daqui só vem o que
// o portal deixou em branco — e o que só existe aqui (cores neutras,
// espaçamento, tela de login, app do celular).
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import {
  Save, AlertCircle, Upload, Trash2, Plus, ExternalLink, Download,
  Building2, Palette, LogIn, LayoutGrid, ArrowUp, ArrowDown, Type, Search, RotateCcw, Globe, School,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { useCan } from '@/hooks/usePermissions'
import { ChavesDeHeranca, SECOES_HERANCA } from '@/components/educational/HerancaDoPortal'
import {
  useEduGeral, useSalvarEduGeral, useEnviarArquivoGeral, useRemoverArquivoGeral, importarDoPortal,
  type EduGeral, type PadroesLogin, type ArquivoGeral, type GrupoDeTextos,
} from '@/hooks/useEduGeral'

type Aba = 'identidade' | 'aparencia' | 'login' | 'textos' | 'seo' | 'portais' | 'atalhos'

const ABAS: { id: Aba; label: string; icon: preact.ComponentChildren }[] = [
  { id: 'identidade', label: 'Identidade', icon: <Building2 size={14} /> },
  { id: 'aparencia', label: 'Aparência', icon: <Palette size={14} /> },
  { id: 'login', label: 'Tela de login', icon: <LogIn size={14} /> },
  { id: 'textos', label: 'Textos do portal', icon: <Type size={14} /> },
  { id: 'seo', label: 'SEO e medição', icon: <Globe size={14} /> },
  { id: 'portais', label: 'Portais', icon: <School size={14} /> },
  { id: 'atalhos', label: 'Atalhos', icon: <LayoutGrid size={14} /> },
]

// Os padrões do estilo do portal (portal-app/src/estilo.css): a prévia mostra
// exatamente o que vale quando o campo fica vazio.
const NEUTRAS_PADRAO = {
  corTexto: '#16211f', corTextoSuave: '#5b6a66', corFundo: '#f4f6f5', corCartao: '#ffffff',
  corLinha: '#dfe5e2', corSucesso: '#2c7a4b', corPendente: '#d97000', corErro: '#a3372e',
}
const MARCA_PADRAO = '#1a73e8'

export function EducationalGeralPage() {
  const { data, isLoading } = useEduGeral()
  const salvar = useSalvarEduGeral()
  const [aba, setAba] = useState<Aba>('identidade')
  const [form, setForm] = useState<EduGeral | null>(null)
  const [sujo, setSujo] = useState(false)
  const [portalImport, setPortalImport] = useState<number | ''>('')

  // O formulário nasce do servidor uma vez; depois é da pessoa até salvar.
  useEffect(() => { if (data && !form) setForm(structuredClone(data.geral)) }, [data])

  useEffect(() => {
    if (!sujo) return
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [sujo])

  if (isLoading || !data || !form) {
    return <Page title="Configurações Gerais"><Skeleton class="h-64" /></Page>
  }

  function mudar<S extends keyof EduGeral>(secao: S, campo: keyof EduGeral[S], valor: unknown) {
    setForm((f) => f && ({ ...f, [secao]: { ...f[secao], [campo]: valor } }))
    setSujo(true)
  }

  // Arquivo enviado já está salvo no servidor: atualiza a tela sem sujar o formulário.
  function arquivoSalvo(secao: 'identidade' | 'login' | 'seo', campo: string, url: string | null) {
    setForm((f) => f && ({ ...f, [secao]: { ...f[secao], [campo]: url } }))
  }

  function gravar() {
    if (!form) return
    salvar.mutate(form, {
      onSuccess: (r) => { setForm(structuredClone(r.geral)); setSujo(false); toast('Configurações salvas', 'success') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  async function importar() {
    if (typeof portalImport !== 'number' || !form) return
    try {
      const r = await importarDoPortal(portalImport)
      // Só preenche o que veio com valor; o resto do formulário fica como está.
      const juntar = <T extends object>(atual: T, novo: Partial<T>): T => {
        const out: any = { ...atual }
        for (const [k, v] of Object.entries(novo)) if (v !== null && v !== undefined && v !== '') out[k] = v
        return out
      }
      setForm({
        identidade: juntar(form.identidade, r.identidade),
        aparencia: juntar(form.aparencia, r.aparencia),
        login: juntar(form.login, r.login),
        textos: { ...form.textos, ...r.textos },
        seo: form.seo,
        heranca: form.heranca,
      })
      setSujo(true)
      toast('Valores do portal carregados. Revise e clique em Salvar.', 'success')
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <Page
      title="Configurações Gerais"
      description="O que vale para a instituição toda. Portais personalizados mantêm o que é deles e recebem daqui só o que deixaram em branco; portais que seguem as Gerais (aba Portais) recebem daqui por cima. A tela de login e o app do celular são sempre daqui."
      actions={
        <div class="flex items-center gap-2 flex-wrap">
          <Select value={String(portalImport)} onChange={(e) => setPortalImport(Number((e.target as HTMLSelectElement).value) || '')} aria-label="Portal para importar">
            <option value="">Importar de um portal…</option>
            {data.portais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
          <Button size="sm" variant="secondary" onClick={importar} disabled={portalImport === ''}>
            <Download size={13} /> Importar
          </Button>
          <Button size="sm" variant="primary" onClick={gravar} disabled={!sujo || salvar.isPending}>
            <Save size={13} /> {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      }
    >
      {sujo && (
        <div class="sticky top-0 z-10 mb-3 px-3 py-2 rounded-md border border-warning/40 bg-warning/10 backdrop-blur flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 text-xs text-warning"><AlertCircle size={14} /> Alterações não salvas.</div>
          <Button size="sm" variant="primary" onClick={gravar} disabled={salvar.isPending}>
            <Save size={12} /> {salvar.isPending ? 'Salvando…' : 'Salvar agora'}
          </Button>
        </div>
      )}

      <div class="border-b border-border flex gap-1 mb-4 overflow-x-auto">
        {ABAS.map((t) => (
          <button key={t.id} type="button" onClick={() => setAba(t.id)}
            class={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-[1px] whitespace-nowrap',
              aba === t.id ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {aba === 'identidade' && <AbaIdentidade form={form} mudar={mudar} arquivoSalvo={arquivoSalvo} />}
      {aba === 'aparencia' && <AbaAparencia form={form} mudar={mudar} />}
      {aba === 'login' && <AbaLogin form={form} mudar={mudar} arquivoSalvo={arquivoSalvo} padroes={data.padroes.login} linkHoras={data.linkHoras} />}
      {aba === 'textos' && (
        <AbaTextos grupos={data.padroes.textos} textos={form.textos}
          mudar={(chave, valor) => {
            setForm((f) => {
              if (!f) return f
              const textos = { ...f.textos }
              if (valor.trim()) textos[chave] = valor; else delete textos[chave]
              return { ...f, textos }
            })
            setSujo(true)
          }} />
      )}
      {aba === 'seo' && <AbaSeo form={form} mudar={mudar} arquivoSalvo={arquivoSalvo} />}
      {aba === 'portais' && <AbaPortais portais={data.portais} />}
      {aba === 'atalhos' && <AbaAtalhos />}
    </Page>
  )
}

type Mudar = <S extends keyof EduGeral>(secao: S, campo: keyof EduGeral[S], valor: unknown) => void
type ArquivoSalvo = (secao: 'identidade' | 'login' | 'seo', campo: string, url: string | null) => void

const txt = (e: Event) => (e.target as HTMLInputElement).value
const ouNull = (v: string) => (v.trim() ? v : null)

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: preact.ComponentChildren }) {
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted">{titulo}</div>
      {descricao && <div class="text-xs text-fg-muted mt-1 mb-3">{descricao}</div>}
      <div class={descricao ? '' : 'mt-3'}>{children}</div>
    </Card>
  )
}

/** Cor que pode ficar sem valor (= padrão). */
function CorOpcional({ label, valor, padrao, onChange, hint }: {
  label: string; valor: string | null; padrao: string; onChange: (v: string | null) => void; hint?: string
}) {
  if (!valor) {
    return (
      <div>
        <div class="text-xs font-medium text-fg mb-1">{label}</div>
        <button type="button" onClick={() => onChange(padrao)}
          class="w-full flex items-center gap-2 h-9 px-2 rounded-md border border-dashed border-border text-xs text-fg-muted hover:text-fg hover:border-border-strong">
          <span class="size-5 rounded border border-border" style={{ background: padrao }} />
          Padrão · clique para definir
        </button>
        {hint && <div class="text-2xs text-fg-muted mt-1">{hint}</div>}
      </div>
    )
  }
  return (
    <div>
      <ColorPicker label={label} value={valor} onChange={onChange} hint={hint} />
      <button type="button" class="text-2xs text-fg-muted hover:text-fg underline mt-1" onClick={() => onChange(null)}>Voltar ao padrão</button>
    </div>
  )
}

function Arquivo({ kind, label, url, hint, aoMudar }: {
  kind: ArquivoGeral; label: string; url: string | null; hint: string; aoMudar: (url: string | null) => void
}) {
  const enviar = useEnviarArquivoGeral()
  const remover = useRemoverArquivoGeral()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div class="text-xs font-medium text-fg mb-1">{label}</div>
      <div class="flex items-center gap-3 flex-wrap">
        <div class={cn('h-16 rounded-md border border-border bg-surface flex items-center justify-center overflow-hidden', kind === 'painel' ? 'w-28' : kind === 'favicon' ? 'w-16' : 'w-36')}>
          {url
            ? <img src={url} alt="" class={kind === 'painel' ? 'w-full h-full object-cover' : 'max-h-12 max-w-[90%] object-contain'} />
            : <span class="text-2xs text-fg-muted">Sem arquivo</span>}
        </div>
        <input ref={ref} type="file" class="hidden"
          accept={kind === 'favicon' ? '.png,.ico,.svg' : kind === 'painel' ? '.png,.jpg,.jpeg,.webp' : '.png,.jpg,.jpeg,.webp,.svg'}
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0]
            if (!f) return
            enviar.mutate({ kind, file: f }, {
              onSuccess: (r) => { aoMudar(r.url); toast('Arquivo enviado', 'success') },
              onError: (err: unknown) => toast((err as Error).message, 'danger'),
            })
            ;(e.target as HTMLInputElement).value = ''
          }} />
        <Button size="sm" variant="secondary" onClick={() => ref.current?.click()} disabled={enviar.isPending}>
          <Upload size={12} /> {enviar.isPending ? 'Enviando…' : url ? 'Trocar' : 'Enviar'}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" disabled={remover.isPending}
            onClick={() => remover.mutate(kind, { onSuccess: () => aoMudar(null) })}>
            <Trash2 size={12} /> Remover
          </Button>
        )}
      </div>
      <div class="text-2xs text-fg-muted mt-1">{hint}</div>
    </div>
  )
}

// ───────────────────────── Identidade ─────────────────────────

function AbaIdentidade({ form, mudar, arquivoSalvo }: { form: EduGeral; mudar: Mudar; arquivoSalvo: ArquivoSalvo }) {
  const i = form.identidade
  return (
    <div class="space-y-3">
      <Secao titulo="Instituição" descricao="Aparece no app do celular, nos títulos das telas sem portal definido e onde a instituição é nomeada.">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome da instituição" value={i.nome ?? ''} maxLength={120}
            placeholder="Ex.: FABAD" onInput={(e) => mudar('identidade', 'nome', ouNull(txt(e)))}
            hint="Curto funciona melhor: vai no nome do app e depois do “|” nas abas." />
          <Input label="Link do logo" type="url" value={i.logoLink ?? ''} placeholder="https://www.suainstituicao.edu.br"
            onInput={(e) => mudar('identidade', 'logoLink', ouNull(txt(e)))}
            hint="Para onde vai quem clica no logo. Vazio = o logo não é link." />
        </div>
      </Secao>
      <Secao titulo="Logo e ícone" descricao="Usados pelos portais que não têm logo/ícone próprio no Branding e pela tela de login quando não há portal definido. O arquivo é salvo na hora.">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Arquivo kind="logo" label="Logo" url={i.logoUrl} hint="PNG, SVG, JPG ou WEBP até 1 MB. Fundo transparente fica melhor."
            aoMudar={(u) => arquivoSalvo('identidade', 'logoUrl', u)} />
          <Arquivo kind="favicon" label="Ícone da aba (favicon)" url={i.faviconUrl} hint="PNG, ICO ou SVG até 200 KB, quadrado."
            aoMudar={(u) => arquivoSalvo('identidade', 'faviconUrl', u)} />
        </div>
      </Secao>
      <Secao titulo="Rodapé" descricao="Texto pequeno no fim das telas do portal (portais sem rodapé próprio).">
        <Textarea rows={2} value={i.rodape ?? ''} maxLength={300} placeholder="© Instituição — CNPJ…"
          onInput={(e) => mudar('identidade', 'rodape', ouNull((e.target as HTMLTextAreaElement).value))} />
      </Secao>
    </div>
  )
}

// ───────────────────────── Aparência ─────────────────────────

function AbaAparencia({ form, mudar }: { form: EduGeral; mudar: Mudar }) {
  const a = form.aparencia
  const sel = (campo: keyof EduGeral['aparencia']) => (e: Event) => mudar('aparencia', campo, (e.target as HTMLSelectElement).value || null)
  return (
    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 items-start">
      <div class="space-y-3 min-w-0">
        <Secao titulo="Marca padrão" descricao="Vale por cima nos portais que seguem as Gerais em Aparência, e nos demais só onde o campo ficou em branco no Branding.">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CorOpcional label="Cor principal" valor={a.corPrincipal} padrao={MARCA_PADRAO} onChange={(v) => mudar('aparencia', 'corPrincipal', v)}
              hint="Botões, abas e destaques." />
            <CorOpcional label="Cor de apoio" valor={a.corApoio} padrao={a.corPrincipal || MARCA_PADRAO} onChange={(v) => mudar('aparencia', 'corApoio', v)}
              hint="Detalhes e o degradê do painel de login." />
            <Select label="Fonte" value={a.fonte ?? ''} onChange={sel('fonte')}>
              <option value="">Padrão do sistema</option>
              <option value="inter">Inter</option>
              <option value="roboto">Roboto</option>
              <option value="poppins">Poppins</option>
              <option value="system">Fonte do aparelho</option>
            </Select>
            <Select label="Arredondamento" value={a.raio ?? ''} onChange={sel('raio')}>
              <option value="">Padrão (médio)</option>
              <option value="sharp">Reto</option>
              <option value="medium">Médio</option>
              <option value="rounded">Bem arredondado</option>
            </Select>
            <Select label="Formato dos botões" value={a.botao ?? ''} onChange={sel('botao')}>
              <option value="">Padrão (reto)</option>
              <option value="reta">Reto</option>
              <option value="pill">Cápsula</option>
            </Select>
            <Select label="Texto dos botões" value={a.caixaAlta === null ? '' : a.caixaAlta ? 'sim' : 'nao'}
              onChange={(e) => { const v = (e.target as HTMLSelectElement).value; mudar('aparencia', 'caixaAlta', v === '' ? null : v === 'sim') }}>
              <option value="">Padrão (normal)</option>
              <option value="nao">Normal</option>
              <option value="sim">CAIXA ALTA</option>
            </Select>
            <Select label="Tamanho do texto" value={a.escala ?? ''} onChange={sel('escala')}>
              <option value="">Padrão</option>
              <option value="compacta">Compacto</option>
              <option value="padrao">Normal</option>
              <option value="ampla">Grande</option>
            </Select>
            <Select label="Largura do conteúdo" value={a.largura ?? ''} onChange={sel('largura')}>
              <option value="">Padrão</option>
              <option value="estreita">Estreita</option>
              <option value="padrao">Normal</option>
              <option value="ampla">Ampla</option>
            </Select>
          </div>
        </Secao>

        <Secao titulo="Espaçamento" descricao="Respiro dos cartões, campos e entre os blocos — em todas as telas do portal, inclusive o login.">
          <div class="grid grid-cols-3 gap-2">
            {([['compacto', 'Compacto'], [null, 'Padrão'], ['arejado', 'Arejado']] as const).map(([v, rotulo]) => (
              <button key={rotulo} type="button" onClick={() => mudar('aparencia', 'espacamento', v)}
                class={cn('rounded-md border px-3 py-2.5 text-sm text-left flex flex-col justify-between min-h-[68px]',
                  (a.espacamento ?? null) === v ? 'border-accent text-accent bg-accent/5' : 'border-border text-fg-muted hover:text-fg')}>
                <div class="font-medium">{rotulo}</div>
                <div class="flex flex-col mt-1.5" style={{ gap: v === 'compacto' ? '2px' : v === 'arejado' ? '7px' : '4px' }}>
                  {[0, 1, 2].map((n) => <span key={n} class="h-1 rounded bg-current opacity-40" />)}
                </div>
              </button>
            ))}
          </div>
        </Secao>

        <Secao titulo="Cores das telas" descricao="Valem em todas as telas do portal (os portais não têm estes campos). Vazio = as cores de hoje.">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CorOpcional label="Texto" valor={a.corTexto} padrao={NEUTRAS_PADRAO.corTexto} onChange={(v) => mudar('aparencia', 'corTexto', v)} />
            <CorOpcional label="Texto secundário" valor={a.corTextoSuave} padrao={NEUTRAS_PADRAO.corTextoSuave} onChange={(v) => mudar('aparencia', 'corTextoSuave', v)} />
            <CorOpcional label="Fundo da página" valor={a.corFundo} padrao={NEUTRAS_PADRAO.corFundo} onChange={(v) => mudar('aparencia', 'corFundo', v)} />
            <CorOpcional label="Fundo dos cartões e campos" valor={a.corCartao} padrao={NEUTRAS_PADRAO.corCartao} onChange={(v) => mudar('aparencia', 'corCartao', v)} />
            <CorOpcional label="Linhas e bordas" valor={a.corLinha} padrao={NEUTRAS_PADRAO.corLinha} onChange={(v) => mudar('aparencia', 'corLinha', v)} />
            <CorOpcional label="Concluído (verde)" valor={a.corSucesso} padrao={NEUTRAS_PADRAO.corSucesso} onChange={(v) => mudar('aparencia', 'corSucesso', v)} />
            <CorOpcional label="Pendente (laranja)" valor={a.corPendente} padrao={NEUTRAS_PADRAO.corPendente} onChange={(v) => mudar('aparencia', 'corPendente', v)} />
            <CorOpcional label="Erro / recusado (vermelho)" valor={a.corErro} padrao={NEUTRAS_PADRAO.corErro} onChange={(v) => mudar('aparencia', 'corErro', v)} />
          </div>
        </Secao>
      </div>
      <div class="xl:sticky xl:top-4"><PreviaAparencia form={form} /></div>
    </div>
  )
}

function PreviaAparencia({ form }: { form: EduGeral }) {
  const a = form.aparencia
  const marca = a.corPrincipal || MARCA_PADRAO
  const c = { ...NEUTRAS_PADRAO, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k in NEUTRAS_PADRAO && v)) } as typeof NEUTRAS_PADRAO
  const raio = a.raio === 'sharp' ? 2 : a.raio === 'rounded' ? 20 : 12
  const pad = a.espacamento === 'compacto' ? 12 : a.espacamento === 'arejado' ? 24 : 18
  const gap = a.espacamento === 'compacto' ? 8 : a.espacamento === 'arejado' ? 16 : 12
  const fonte = a.fonte === 'poppins' ? 'Poppins, system-ui' : a.fonte === 'roboto' ? 'Roboto, system-ui' : a.fonte === 'inter' ? 'Inter, system-ui' : 'system-ui'
  const selo = (cor: string, t: string) => (
    <span style={{ color: cor, background: `color-mix(in srgb, ${cor} 12%, white)`, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{t}</span>
  )
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Prévia</div>
      <div style={{ background: c.corFundo, padding: 14, borderRadius: 8, fontFamily: fonte, color: c.corTexto }}>
        <div style={{ background: c.corCartao, border: `1px solid ${c.corLinha}`, borderRadius: raio, padding: pad, display: 'grid', gap }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Seus dados</div>
            <div style={{ fontSize: 12, color: c.corTextoSuave }}>Confira antes de continuar.</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>E-mail</div>
            <div style={{ border: `1px solid ${c.corLinha}`, borderRadius: Math.max(raio - 4, 2), padding: '7px 9px', fontSize: 12, background: c.corCartao, color: c.corTextoSuave }}>aluno@email.com</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selo(c.corSucesso, 'Concluído')}{selo(c.corPendente, 'Pendente')}{selo(c.corErro, 'Recusado')}
          </div>
          <button type="button" style={{
            background: marca, color: '#fff', border: 0, padding: '9px 12px', fontWeight: 650, fontSize: 13, fontFamily: fonte,
            borderRadius: a.botao === 'pill' ? 999 : Math.max(raio - 4, 2),
            textTransform: a.caixaAlta ? 'uppercase' : 'none', letterSpacing: a.caixaAlta ? '.06em' : 0,
          }}>Continuar</button>
        </div>
      </div>
      <div class="text-2xs text-fg-muted mt-2">Aproximada. As cores de marca de um portal com Branding próprio continuam as dele.</div>
    </Card>
  )
}

// ───────────────────────── Tela de login ─────────────────────────

function AbaLogin({ form, mudar, arquivoSalvo, padroes, linkHoras }: {
  form: EduGeral; mudar: Mudar; arquivoSalvo: ArquivoSalvo; padroes: PadroesLogin; linkHoras: number
}) {
  const l = form.login
  const itens = l.painelItens ?? padroes.painelItens
  const setItens = (v: string[]) => mudar('login', 'painelItens', v)
  const mover = (i: number, d: number) => { const n = [...itens]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); setItens(n) }
  const campo = (c: keyof EduGeral['login']) => (e: Event) => mudar('login', c, ouNull((e.target as HTMLInputElement).value))
  return (
    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-3 items-start">
      <div class="space-y-3 min-w-0">
        <Secao titulo="Painel da marca" descricao="O lado colorido da tela de entrar (/portal/login). Campo vazio = o texto de exemplo.">
          <div class="space-y-3">
            <Input label="Título" value={l.painelTitulo ?? ''} placeholder={padroes.painelTitulo} maxLength={120} onInput={campo('painelTitulo')} />
            <Textarea label="Subtítulo" rows={2} value={l.painelSubtitulo ?? ''} placeholder={padroes.painelSubtitulo} maxLength={300}
              onInput={campo('painelSubtitulo')} />
            <div>
              <div class="flex items-center justify-between mb-1">
                <div class="text-xs font-medium text-fg">Itens com ✓ <span class="text-fg-muted font-normal">(até 6)</span></div>
                {l.painelItens !== null && (
                  <button type="button" class="text-2xs text-fg-muted hover:text-fg underline" onClick={() => mudar('login', 'painelItens', null)}>Voltar aos itens de exemplo</button>
                )}
              </div>
              <div class="space-y-1.5">
                {itens.map((it, i) => (
                  <div key={i} class="flex items-center gap-0.5 sm:gap-1.5">
                    <div class="flex-1 min-w-0">
                      <Input value={it} maxLength={120} aria-label={`Item ${i + 1}`}
                        onInput={(e) => { const n = [...itens]; n[i] = txt(e); setItens(n) }} />
                    </div>
                    <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={12} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === itens.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={12} /></Button>
                    <Button size="sm" variant="ghost" aria-label="Remover" onClick={() => setItens(itens.filter((_, j) => j !== i))}><Trash2 size={12} /></Button>
                  </div>
                ))}
                {itens.length === 0 && <div class="text-2xs text-fg-muted">Sem itens: o painel mostra só título e subtítulo.</div>}
                {itens.length < 6 && (
                  <Button size="sm" variant="secondary" onClick={() => setItens([...itens, ''])}><Plus size={12} /> Adicionar item</Button>
                )}
              </div>
            </div>
          </div>
        </Secao>

        <Secao titulo="Cores e imagem do painel" descricao="Sem cores definidas, o painel usa a cor da marca do portal. Com imagem, as cores viram um véu por cima dela.">
          <div class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CorOpcional label="Cor inicial do degradê" valor={l.painelCorDe} padrao={form.aparencia.corPrincipal || MARCA_PADRAO}
                onChange={(v) => mudar('login', 'painelCorDe', v)} hint="Vazio = cor principal do portal." />
              <CorOpcional label="Cor final do degradê" valor={l.painelCorPara} padrao={form.aparencia.corApoio || form.aparencia.corPrincipal || MARCA_PADRAO}
                onChange={(v) => mudar('login', 'painelCorPara', v)} hint="Vazio = mistura da cor principal com a de apoio." />
            </div>
            <Arquivo kind="painel" label="Imagem de fundo" url={l.painelImagemUrl}
              hint="JPG, PNG ou WEBP até 4 MB, de preferência na vertical. Sem imagem aqui, vale a capa do portal (se houver)."
              aoMudar={(u) => arquivoSalvo('login', 'painelImagemUrl', u)} />
            <div>
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium text-fg" for="veu">Força do véu sobre a imagem</label>
                <span class="text-2xs text-fg-muted">{l.painelVeu === null ? 'Padrão (81%)' : `${l.painelVeu}%`}</span>
              </div>
              <input id="veu" type="range" min={0} max={100} step={1} class="w-full accent-[var(--color-accent,currentColor)]"
                value={l.painelVeu ?? 81} onInput={(e) => mudar('login', 'painelVeu', Number((e.target as HTMLInputElement).value))} />
              <div class="text-2xs text-fg-muted">0% mostra a imagem pura; 100% cobre com a cor. Mais forte = texto mais legível.</div>
            </div>
            <Select label="Lado do painel" value={l.painelLado ?? 'esquerda'} onChange={(e) => mudar('login', 'painelLado', (e.target as HTMLSelectElement).value)}>
              <option value="esquerda">Painel à esquerda, formulário à direita</option>
              <option value="direita">Formulário à esquerda, painel à direita</option>
            </Select>
          </div>
        </Secao>

        <Secao titulo="Formulário" descricao="O lado de entrar. No celular, só ele aparece.">
          <div class="space-y-3">
            <Input label="Título" value={l.formTitulo ?? ''} placeholder={padroes.formTitulo} maxLength={120} onInput={campo('formTitulo')} />
            <Input label="Subtítulo" value={l.formSubtitulo ?? ''} placeholder={padroes.formSubtitulo} maxLength={300} onInput={campo('formSubtitulo')} />
            <div>
              <div class="text-xs font-medium text-fg mb-1.5">Formas de entrar</div>
              <div class="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox label="E-mail e senha" checked={l.modoEmail !== false}
                  disabled={l.modoEmail !== false && l.modoCodigo === false}
                  onChange={(e) => mudar('login', 'modoEmail', (e.target as HTMLInputElement).checked)} />
                <Checkbox label="Código da inscrição e CPF" checked={l.modoCodigo !== false}
                  disabled={l.modoCodigo !== false && l.modoEmail === false}
                  onChange={(e) => mudar('login', 'modoCodigo', (e.target as HTMLInputElement).checked)} />
              </div>
              <div class="text-2xs text-fg-muted mt-1">Pelo menos uma fica ligada. Com uma só, as abas somem.</div>
            </div>
            <Input label="Texto do link de recuperação" value={l.esqueciTexto ?? ''} placeholder={padroes.esqueciTexto} maxLength={80} onInput={campo('esqueciTexto')} />
          </div>
        </Secao>

        <Secao titulo="Recuperação de acesso" descricao="O que aparece depois de clicar no link de recuperação.">
          <div class="space-y-3">
            <Input label="Título" value={l.recuperarTitulo ?? ''} placeholder={padroes.recuperarTitulo} maxLength={120} onInput={campo('recuperarTitulo')} />
            <Textarea label="Texto" rows={3} value={l.recuperarTexto ?? ''} placeholder={padroes.recuperarTexto.replace('{horas}', String(linkHoras))} maxLength={400}
              onInput={campo('recuperarTexto')}
              hint={`Use {horas} para a validade do link (hoje: ${linkHoras} horas) — assim o texto acompanha se ela mudar.`} />
          </div>
        </Secao>
      </div>
      <div class="xl:sticky xl:top-4"><PreviaLogin form={form} padroes={padroes} /></div>
    </div>
  )
}

function PreviaLogin({ form, padroes }: { form: EduGeral; padroes: PadroesLogin }) {
  const l = form.login
  const a = form.aparencia
  const marca = a.corPrincipal || MARCA_PADRAO
  const de = l.painelCorDe || marca
  const para = l.painelCorPara || `color-mix(in srgb, ${marca} 55%, ${a.corApoio || marca})`
  const itens = l.painelItens ?? padroes.painelItens
  const ambas = l.modoEmail !== false && l.modoCodigo !== false
  const painel = (
    <div style={{
      position: 'relative', flex: 1, color: '#fff', padding: 16, display: 'flex', alignItems: 'center', overflow: 'hidden',
      background: l.painelImagemUrl ? `url("${l.painelImagemUrl}") center/cover` : `linear-gradient(150deg, ${de}, ${para})`,
    }}>
      {l.painelImagemUrl && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(150deg, ${de}, ${l.painelCorPara || de})`, opacity: (l.painelVeu ?? 81) / 100 }} />}
      <div style={{ position: 'relative' }}>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, marginBottom: 6 }}>{l.painelTitulo || padroes.painelTitulo}</div>
        <div style={{ fontSize: 10.5, opacity: .88, marginBottom: 10 }}>{l.painelSubtitulo || padroes.painelSubtitulo}</div>
        {itens.filter(Boolean).map((t, i) => <div key={i} style={{ fontSize: 10, marginBottom: 4 }}>✓ {t}</div>)}
      </div>
    </div>
  )
  const formulario = (
    <div style={{ flex: 1, background: '#fff', padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#16211f' }}>
      {form.identidade.logoUrl && <img src={form.identidade.logoUrl} alt="" style={{ maxHeight: 22, maxWidth: 90, margin: '0 auto 8px' }} />}
      <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{l.formTitulo || padroes.formTitulo}</div>
      <div style={{ fontSize: 9.5, color: '#5b6a66', textAlign: 'center', marginBottom: 8 }}>{l.formSubtitulo || padroes.formSubtitulo}</div>
      {ambas && <div style={{ display: 'flex', gap: 2, background: '#eef1f4', padding: 2, borderRadius: 6, fontSize: 9, marginBottom: 8 }}>
        <span style={{ flex: 1, background: '#fff', borderRadius: 4, padding: '3px 0', textAlign: 'center', fontWeight: 600 }}>E-mail e senha</span>
        <span style={{ flex: 1, padding: '3px 0', textAlign: 'center', color: '#5b6a66' }}>Código e CPF</span>
      </div>}
      {[0, 1].map((n) => <div key={n} style={{ height: 16, border: '1px solid #dfe5e2', borderRadius: 4, marginBottom: 6 }} />)}
      <div style={{ background: marca, borderRadius: a.botao === 'pill' ? 999 : 5, height: 18, marginTop: 2 }} />
      <div style={{ fontSize: 9, textAlign: 'center', color: marca, fontWeight: 600, marginTop: 6 }}>{l.esqueciTexto || padroes.esqueciTexto}</div>
    </div>
  )
  return (
    <Card>
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs uppercase tracking-wider text-fg-muted">Prévia</div>
        <a href="/portal/login" target="_blank" rel="noopener" class="text-2xs text-accent inline-flex items-center gap-1 hover:underline">
          Abrir a tela <ExternalLink size={11} />
        </a>
      </div>
      <div style={{ display: 'flex', minHeight: 240, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border, #ddd)' }}>
        {l.painelLado === 'direita' ? <>{formulario}{painel}</> : <>{painel}{formulario}</>}
      </div>
      <div class="text-2xs text-fg-muted mt-2">Aproximada e sem salvar. “Abrir a tela” mostra o que está salvo.</div>
    </Card>
  )
}

// ───────────────────────── Textos do portal ─────────────────────────

function AbaTextos({ grupos, textos, mudar }: {
  grupos: GrupoDeTextos[]; textos: Record<string, string>; mudar: (chave: string, valor: string) => void
}) {
  const [busca, setBusca] = useState('')
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set([grupos[0]?.id ?? '']))
  const termo = busca.trim().toLowerCase()
  const editados = Object.keys(textos).length
  return (
    <div class="space-y-3">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input type="search" value={busca} onInput={(e) => setBusca(txt(e))} placeholder="Procurar texto…"
            class="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-surface text-sm text-fg" aria-label="Procurar texto" />
        </div>
        <div class="text-xs text-fg-muted">
          {editados ? `${editados} texto(s) personalizado(s).` : 'Nenhum texto personalizado: o portal usa os textos padrão.'}
          {' '}Campo vazio = texto padrão.
        </div>
      </div>
      {grupos.map((g) => {
        const itens = g.textos.filter((x) => !termo || x.rotulo.toLowerCase().includes(termo) || x.padrao.toLowerCase().includes(termo) || (textos[x.chave] ?? '').toLowerCase().includes(termo))
        if (!itens.length) return null
        const aberto = !!termo || abertos.has(g.id)
        const nEditados = g.textos.filter((x) => textos[x.chave]).length
        return (
          <Card key={g.id}>
            <button type="button" class="w-full flex items-center justify-between gap-3 text-left"
              aria-expanded={aberto}
              onClick={() => setAbertos((a) => { const n = new Set(a); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })}>
              <div>
                <div class="text-sm font-medium text-fg">{g.titulo}</div>
                <div class="text-xs text-fg-muted mt-0.5">{g.descricao}</div>
              </div>
              <span class="text-2xs text-fg-muted whitespace-nowrap">{nEditados ? `${nEditados} de ${g.textos.length} personalizados` : `${g.textos.length} textos`} {aberto ? '▴' : '▾'}</span>
            </button>
            {aberto && (
              <div class="mt-3 pt-3 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-3">
                {itens.map((x) => {
                  const valor = textos[x.chave] ?? ''
                  const props = {
                    label: x.rotulo,
                    value: valor,
                    placeholder: x.padrao,
                    maxLength: 500,
                    hint: x.marcadores?.length ? `Use ${x.marcadores.join(', ')} para o dado da pessoa.` : undefined,
                  }
                  return (
                    <div key={x.chave} class={cn('min-w-0', x.longo && 'lg:col-span-2')}>
                      {x.longo
                        ? <Textarea rows={2} {...props} onInput={(e) => mudar(x.chave, (e.target as HTMLTextAreaElement).value)} />
                        : <Input {...props} onInput={(e) => mudar(x.chave, txt(e))} />}
                      {valor && (
                        <button type="button" class="mt-1 inline-flex items-center gap-1 text-2xs text-fg-muted hover:text-fg" onClick={() => mudar(x.chave, '')}>
                          <RotateCcw size={10} /> Voltar ao padrão
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ───────────────────────── SEO e medição ─────────────────────────

const PIXELS: Array<{ campo: 'ga4Id' | 'gtmId' | 'metaPixelId' | 'tiktokPixelId' | 'linkedinPartnerId'; label: string; exemplo: string }> = [
  { campo: 'ga4Id', label: 'Google Analytics 4', exemplo: 'G-XXXXXXXXXX' },
  { campo: 'gtmId', label: 'Google Tag Manager', exemplo: 'GTM-XXXXXXX' },
  { campo: 'metaPixelId', label: 'Meta (Facebook/Instagram) Pixel', exemplo: '123456789012345' },
  { campo: 'tiktokPixelId', label: 'TikTok Pixel', exemplo: 'C1ABCDEF2GHIJK3LMNOP' },
  { campo: 'linkedinPartnerId', label: 'LinkedIn Insight (Partner ID)', exemplo: '1234567' },
]

function AbaSeo({ form, mudar, arquivoSalvo }: { form: EduGeral; mudar: Mudar; arquivoSalvo: ArquivoSalvo }) {
  const seo = form.seo
  return (
    <div class="space-y-3">
      <Secao titulo="Imagem de compartilhamento" descricao="O preview quando alguém compartilha um link do portal no WhatsApp e nas redes. Vale nos portais sem imagem própria e nos que seguem as Gerais em SEO.">
        <Arquivo kind="og" label="Imagem" url={seo.ogImageUrl} hint="JPG, PNG ou WEBP até 4 MB. Ideal 1200×630."
          aoMudar={(u) => arquivoSalvo('seo', 'ogImageUrl', u)} />
      </Secao>
      <Secao titulo="Pixels e medição" descricao="Disparam na inscrição dos portais sem pixels próprios e dos que seguem as Gerais em SEO. Um portal com pixels próprios (e personalizado) continua só com os dele.">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PIXELS.map((px) => (
            <Input key={px.campo} label={px.label} value={seo.pixels[px.campo] ?? ''} placeholder={px.exemplo} maxLength={40}
              onInput={(e) => mudar('seo', 'pixels', { ...seo.pixels, [px.campo]: ouNull(txt(e).trim()) })}
              hint="ID em formato errado é ignorado ao salvar." />
          ))}
        </div>
      </Secao>
      <div class="text-xs text-fg-muted">
        O nome que vai depois do “|” nos títulos é o <b>Nome da instituição</b> da aba Identidade. Título, descrição e indexação de cada página seguem em cada portal (Configuração › Domínio + SEO).
      </div>
    </div>
  )
}

// ───────────────────────── Portais ─────────────────────────

function AbaPortais({ portais }: { portais: Array<{ id: number; nome: string; slug: string; active: boolean }> }) {
  return (
    <div class="space-y-3">
      <Card>
        <div class="text-sm text-fg">O que cada portal segue das Configurações Gerais</div>
        <div class="text-xs text-fg-muted mt-1">
          <b>Ligado:</b> o que está preenchido nas Gerais vale por cima do portal. <b>Desligado:</b> o portal usa a configuração dele, e as Gerais só completam o que ficou vazio.
          Portal novo já nasce ligado. A tela de login, o espaçamento e as cores das telas valem para todos, sempre. As chaves salvam na hora.
        </div>
      </Card>
      <Card>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-2xs uppercase tracking-wider text-fg-muted">
                <th class="py-2 pr-3 font-medium">Portal</th>
                {SECOES_HERANCA.map((s) => <th key={s.chave} class="py-2 px-3 font-medium text-center" title={s.texto}>{s.titulo}</th>)}
              </tr>
            </thead>
            <tbody>
              {portais.map((p) => (
                <tr key={p.id} class="border-t border-border">
                  <td class="py-2.5 pr-3">
                    <Link href={`/app/enrollment-portals/${p.id}`} class="text-fg hover:text-accent">{p.nome}</Link>
                    <div class="text-2xs text-fg-muted">/portal/{p.slug}{p.active ? '' : ' · desativado'}</div>
                  </td>
                  <LinhaDeChaves portalId={p.id} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {portais.length === 0 && <div class="text-xs text-fg-muted py-3">Nenhum portal cadastrado.</div>}
      </Card>
    </div>
  )
}

/** As chaves numa linha de tabela: cada uma na sua coluna. */
function LinhaDeChaves({ portalId }: { portalId: number }) {
  return (
    <td colSpan={3} class="py-2.5">
      <div class="grid grid-cols-3 justify-items-center">
        <ChavesDeHeranca portalId={portalId} compacto />
      </div>
    </td>
  )
}

// ───────────────────────── Atalhos ─────────────────────────

const ATALHOS: Array<{ grupo: string; itens: Array<{ titulo: string; texto: string; href: string; perm: string }> }> = [
  {
    grupo: 'Portal de Matrículas',
    itens: [
      { titulo: 'Portais', texto: 'Branding, formulário, etapas, pagamento, domínio e SEO de cada portal.', href: '/app/enrollment-portals', perm: 'enrollment_portals' },
      { titulo: 'Contratos e assinatura eletrônica', texto: 'Modelos de contrato e o provedor de assinatura (Autentique, Clicksign).', href: '/app/educational/contratos', perm: 'enrollment_portals' },
      { titulo: 'Financeiro do portal', texto: 'Cobranças das inscrições e matrículas.', href: '/app/educational/portal-financeiro', perm: 'enrollment_portals' },
      { titulo: 'Cupons', texto: 'Descontos aplicados na inscrição.', href: '/app/educational/cupons', perm: 'enrollment_portals' },
      { titulo: 'Conexões de pagamento', texto: 'Asaas, iugu, Pagar.me: chaves e ambiente.', href: '/app/integrations/payments', perm: 'settings' },
    ],
  },
  {
    grupo: 'Catálogo e processo seletivo',
    itens: [
      { titulo: 'Modos de ingresso', texto: 'Documentos exigidos por forma de ingresso.', href: '/app/educational/entry-modes', perm: 'educacional' },
      { titulo: 'Dados por etapa', texto: 'Quais dados pedir em cada etapa da inscrição.', href: '/app/educational/dados-etapas', perm: 'educacional' },
      { titulo: 'Processos seletivos', texto: 'Vestibulares, taxas e calendário.', href: '/app/educational/selection-processes', perm: 'educacional' },
    ],
  },
  {
    grupo: 'ERP Acadêmico',
    itens: [
      { titulo: 'Instituição', texto: 'Mantenedora, IES, e-MEC e atos regulatórios.', href: '/app/aca/instituicao', perm: 'aca_matriculas' },
      { titulo: 'Comunicação', texto: 'Avisos de vencimento, notas e régua de cobrança.', href: '/app/aca/comunicacao', perm: 'aca_comunicacao' },
      { titulo: 'Financeiro', texto: 'Multa, juros, carência, desconto e bloqueio.', href: '/app/aca/financeiro', perm: 'aca_financeiro' },
      { titulo: 'Diário de classe', texto: 'Média de aprovação, frequência e recuperação.', href: '/app/aca/diario', perm: 'aca_pedagogico' },
    ],
  },
]

function Atalho({ titulo, texto, href, perm }: { titulo: string; texto: string; href: string; perm: string }) {
  if (!useCan(perm)) return null
  return (
    <Link href={href} class="block rounded-md border border-border p-3 hover:border-accent hover:bg-accent/5 transition-colors">
      <div class="text-sm font-medium text-fg">{titulo}</div>
      <div class="text-xs text-fg-muted mt-0.5">{texto}</div>
    </Link>
  )
}

function AbaAtalhos() {
  return (
    <div class="space-y-3">
      <div class="text-xs text-fg-muted">Configurações que continuam nas telas delas — reunidas aqui para achar rápido.</div>
      {ATALHOS.map((g) => (
        <Secao key={g.grupo} titulo={g.grupo}>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {g.itens.map((a) => <Atalho key={a.href} {...a} />)}
          </div>
        </Secao>
      ))}
    </div>
  )
}
