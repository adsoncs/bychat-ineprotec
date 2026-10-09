// Integração com o SEI (ERP acadêmico) — Integrações › SEI.
//
// Envia ao SEI a inscrição concluída no portal: pessoa, matrícula (com a
// condição de pagamento), documentos aprovados e contrato assinado. O SEI só
// aceita os códigos DELE (curso, banner, unidade, turno, turma, processo,
// condição, tipo de documento) — por isso a aba "De-para" é o coração da tela.
//
// Endpoints: backend routes/seiIntegration.ts (/admin/sei/*).

import { useState, useEffect, useCallback } from 'preact/hooks'
import {
  GraduationCap, Save, PlugZap, CheckCircle2, AlertTriangle, Loader2, RefreshCw,
  Ban, ChevronDown, ChevronRight, DownloadCloud, Send, Eye,
} from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Switch } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

type AuthTipo = 'nenhum' | 'basic' | 'bearer' | 'header'

interface SeiConfig {
  baseUrl: string
  authTipo: AuthTipo
  username: string
  senhaConfigurada: boolean
  tokenConfigurado: boolean
  headerNome: string
  enabled: boolean
  autoEnviar: boolean
  enviarContrato: boolean
  camposExtras: boolean
  totais: { pendentes: number; erros: number; concluidos: number }
}

interface Opcao { codigo: string; nome?: string }

interface MapaOferta {
  codigoCurso?: string; codigoBanner?: string; codigoUnidadeEnsino?: string; codigoTurno?: string
  codigoGradeCurricular?: string; codigoTurma?: string; numeroPeriodoLetivo?: string
  codigoProcessoMatricula?: string; ano?: string; semestre?: string; codigoCondicaoPagamento?: string
  condicoesPorParcelas?: Record<string, string>; polos?: Record<string, string>; cupomDesconto?: string
}

interface OfertaRow {
  id: number; nome: string; complemento: string | null; turno: string | null; status: string
  curso: string | null; unidade: string | null; polos: Array<{ id: number; nome: string }>
  mapa: MapaOferta | null
}

interface DocRow { id: number; code: string; name: string; mapa: { codigoTipoDocumento?: string } | null }

interface Envio {
  id: number; registrationId: number; status: string; etapa: string; origem: string
  codigoPessoa: string | null; matricula: string | null; tentativas: number
  ultimoErro: string | null; proximaTentativaEm: string | null; concluidoEm: string | null
  updatedAt: string; avisos: string[] | null; documentosEnviados: Record<string, { nome: string; tipo: string }> | null
  candidateCode?: string | null; nome?: string | null
}

interface Chamada {
  id: number; servico: string; metodo: string; caminho: string; httpStatus: number | null
  duracaoMs: number | null; ok: boolean; request: unknown; response: unknown; erro: string | null; createdAt: string
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dataBr = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—')
const valor = (e: Event) => (e.target as HTMLInputElement).value

const TOM_STATUS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  CONCLUIDO: 'success', PENDENTE: 'info', PROCESSANDO: 'info', ERRO: 'danger', CANCELADO: 'neutral',
}
const ROTULO_STATUS: Record<string, string> = {
  CONCLUIDO: 'Concluído', PENDENTE: 'Na fila', PROCESSANDO: 'Enviando', ERRO: 'Erro', CANCELADO: 'Cancelado',
}
const ROTULO_ETAPA: Record<string, string> = {
  pessoa: 'Pessoa', matricula: 'Matrícula', documentos: 'Documentos', concluido: 'Concluído',
}

export function SeiIntegration() {
  const [aba, setAba] = useState<'conexao' | 'depara' | 'envios'>('conexao')
  return (
    <div class="space-y-4">
      <div class="flex gap-1 rounded-lg bg-surface-2 p-1 w-fit" role="tablist">
        {([['conexao', 'Conexão'], ['depara', 'De-para'], ['envios', 'Envios']] as const).map(([id, rot]) => (
          <button
            key={id} type="button" role="tab" aria-selected={aba === id}
            class={`rounded-md px-3 py-1.5 text-sm font-medium ${aba === id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
            onClick={() => setAba(id)}
          >{rot}</button>
        ))}
      </div>
      {aba === 'conexao' && <Conexao />}
      {aba === 'depara' && <DePara />}
      {aba === 'envios' && <Envios />}
    </div>
  )
}

// ── Conexão ─────────────────────────────────────────────────────────────────

function Conexao() {
  const [cfg, setCfg] = useState<SeiConfig | null>(null)
  const [senha, setSenha] = useState('')
  const [token, setToken] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<{ total: number; amostra: any[] } | null>(null)

  const carregar = useCallback(async () => {
    try { setCfg(await api.get<SeiConfig>('/admin/sei/config')) } catch (e) { toast(msg(e), 'danger') }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (!cfg) return <Card class="p-5"><div class="text-sm text-fg-muted">Carregando…</div></Card>
  const set = (p: Partial<SeiConfig>) => setCfg({ ...cfg, ...p })

  async function salvar() {
    if (!cfg) return
    setSalvando(true)
    try {
      await api.post('/admin/sei/config', {
        baseUrl: cfg.baseUrl, authTipo: cfg.authTipo, username: cfg.username, headerNome: cfg.headerNome,
        enabled: cfg.enabled, autoEnviar: cfg.autoEnviar, enviarContrato: cfg.enviarContrato, camposExtras: cfg.camposExtras,
        ...(senha ? { password: senha } : {}), ...(token ? { token } : {}),
      })
      setSenha(''); setToken('')
      toast('Configuração salva', 'success')
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }

  async function testar() {
    setTestando(true); setTeste(null)
    try {
      const r = await api.post<{ total: number; amostra: any[] }>('/admin/sei/testar', {})
      setTeste(r)
      toast(`Conectado — ${r.total} curso(s) ofertado(s) para matrícula on-line`, 'success')
    } catch (e) { toast(msg(e), 'danger') } finally { setTestando(false) }
  }

  return (
    <div class="space-y-4">
      <Card class="p-5 space-y-4">
        <div class="flex items-center gap-2">
          <GraduationCap size={16} class="text-accent" />
          <span class="text-sm font-semibold text-fg">Conexão</span>
          <Badge tone={cfg.enabled ? 'success' : 'neutral'}>{cfg.enabled ? 'Ativa' : 'Desativada'}</Badge>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <Input label="URL do SEI" value={cfg.baseUrl} placeholder="https://suaies.sei.edu.br" hint="O endereço base do SEI, sem /webservice no final." onInput={(e) => set({ baseUrl: valor(e) })} />
          <Select label="Autenticação" value={cfg.authTipo} onChange={(e) => set({ authTipo: valor(e) as AuthTipo })}>
            <option value="nenhum">Sem autenticação</option>
            <option value="basic">Usuário e senha (Basic)</option>
            <option value="bearer">Token (Bearer)</option>
            <option value="header">Token em header próprio</option>
          </Select>
          {cfg.authTipo === 'basic' && (
            <>
              <Input label="Usuário" value={cfg.username} onInput={(e) => set({ username: valor(e) })} />
              <Input label="Senha" type="password" value={senha} placeholder={cfg.senhaConfigurada ? '•••••••• (configurada)' : ''} onInput={(e) => setSenha(valor(e))} />
            </>
          )}
          {(cfg.authTipo === 'bearer' || cfg.authTipo === 'header') && (
            <Input label="Token" type="password" value={token} placeholder={cfg.tokenConfigurado ? '•••••••• (configurado)' : ''} onInput={(e) => setToken(valor(e))} />
          )}
          {cfg.authTipo === 'header' && (
            <Input label="Nome do header" value={cfg.headerNome} placeholder="Authorization" onInput={(e) => set({ headerNome: valor(e) })} />
          )}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Switch checked={cfg.enabled} onChange={(v) => set({ enabled: v })} label="Integração ativa" hint="Desligada, nada é enviado — nem manualmente." />
          <Switch checked={cfg.autoEnviar} onChange={(v) => set({ autoEnviar: v })} label="Enviar automaticamente" hint="Quando o contrato é assinado e a matrícula é efetivada no portal." />
          <Switch checked={cfg.enviarContrato} onChange={(v) => set({ enviarContrato: v })} label="Enviar o contrato assinado" hint="Como documento da matrícula no SEI." />
          <Switch checked={cfg.camposExtras} onChange={(v) => set({ camposExtras: v })} label="Enviar dados pessoais extras" hint="Nascimento, sexo, estado civil, naturalidade… Ligar só depois de o SEI confirmar os nomes dos campos." />
        </div>
        <div class="flex flex-wrap gap-2">
          <Button onClick={salvar} loading={salvando}><Save size={14} /> Salvar</Button>
          <Button variant="secondary" onClick={testar} loading={testando} disabled={!cfg.baseUrl}><PlugZap size={14} /> Testar conexão</Button>
        </div>
        {teste && (
          <div class="rounded-md border border-success/30 bg-success/10 p-3 text-xs text-fg">
            <div class="flex items-center gap-1.5 font-medium"><CheckCircle2 size={14} class="text-success" /> {teste.total} curso(s) com matrícula on-line ativa no SEI</div>
            {teste.amostra.length > 0 && (
              <ul class="mt-1.5 list-disc pl-5 text-fg-muted">
                {teste.amostra.map((b: any) => <li key={b.codigoBanner}>Banner {b.codigoBanner} · curso {b.curso?.codigo} — {b.descricao}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>
      <Card class="p-5 text-xs text-fg-muted space-y-1">
        <div class="font-medium text-fg">Fila</div>
        <div>{cfg.totais.pendentes} na fila · {cfg.totais.erros} com erro · {cfg.totais.concluidos} concluídos</div>
      </Card>
    </div>
  )
}

// ── De-para ─────────────────────────────────────────────────────────────────

interface Catalogo {
  banners: Array<{ codigoBanner: string; curso?: { codigo: string }; descricao?: string }>
}
interface OpcoesSei {
  unidades: Opcao[]; turnos: Opcao[]; turmas: Opcao[]; processos: Opcao[]; condicoes: Array<Opcao & { parcelas?: string }>
  gradeCurricular: string | null
}

function DePara() {
  const [dados, setDados] = useState<{ ofertas: OfertaRow[]; documentos: DocRow[]; contrato: { codigoTipoDocumento?: string } | null } | null>(null)
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  const [pessoaTeste, setPessoaTeste] = useState('')
  const [carregandoCat, setCarregandoCat] = useState(false)
  const [aberta, setAberta] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    try { setDados(await api.get('/admin/sei/mapeamentos')) } catch (e) { toast(msg(e), 'danger') }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function carregarCatalogo() {
    setCarregandoCat(true)
    try {
      setCatalogo(await api.get<Catalogo>('/admin/sei/catalogo/banners'))
    } catch (e) { toast(msg(e), 'danger') } finally { setCarregandoCat(false) }
  }

  if (!dados) return <Card class="p-5"><div class="text-sm text-fg-muted">Carregando…</div></Card>
  const mapeadas = dados.ofertas.filter((o) => o.mapa?.codigoCurso).length

  return (
    <div class="space-y-4">
      <Card class="p-5 space-y-3">
        <div class="text-sm font-semibold text-fg">Catálogo do SEI</div>
        <p class="text-xs text-fg-muted">
          Os cursos vêm da política de matrícula on-line do SEI ("banners"). Para enxergar unidades, turnos, turmas, processos e
          condições de pagamento, o SEI exige uma pessoa: informe o código de uma pessoa de teste cadastrada lá.
        </p>
        <div class="flex flex-wrap items-end gap-2">
          <Button variant="secondary" onClick={carregarCatalogo} loading={carregandoCat}><DownloadCloud size={14} /> Carregar cursos do SEI</Button>
          <div class="w-56"><Input label="Código da pessoa de teste no SEI" value={pessoaTeste} onInput={(e) => setPessoaTeste(valor(e))} /></div>
        </div>
        {catalogo && <div class="text-xs text-fg-muted">{catalogo.banners.length} curso(s) carregado(s).</div>}
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3 border-b border-border">
          <div class="text-sm font-semibold text-fg">Ofertas do portal → SEI</div>
          <Badge tone={mapeadas === dados.ofertas.length ? 'success' : 'warning'}>{mapeadas}/{dados.ofertas.length} mapeadas</Badge>
        </div>
        <div class="divide-y divide-border">
          {dados.ofertas.map((o) => (
            <OfertaDePara key={o.id} oferta={o} aberta={aberta === o.id} onToggle={() => setAberta(aberta === o.id ? null : o.id)}
              catalogo={catalogo} pessoaTeste={pessoaTeste} onSalvo={carregar} />
          ))}
          {dados.ofertas.length === 0 && <div class="px-5 py-4 text-sm text-fg-muted">Nenhuma oferta ativa.</div>}
        </div>
      </Card>

      <DocumentosDePara documentos={dados.documentos} contrato={dados.contrato} onSalvo={carregar} />
    </div>
  )
}

const CAMPOS_OFERTA: Array<[keyof MapaOferta, string, keyof OpcoesSei | null]> = [
  ['codigoUnidadeEnsino', 'Unidade de ensino', 'unidades'],
  ['codigoTurno', 'Turno', 'turnos'],
  ['codigoTurma', 'Turma', 'turmas'],
  ['codigoProcessoMatricula', 'Processo de matrícula', 'processos'],
  ['codigoCondicaoPagamento', 'Condição de pagamento (padrão)', 'condicoes'],
  ['codigoGradeCurricular', 'Grade curricular (opcional)', null],
  ['numeroPeriodoLetivo', 'Nº do período letivo', null],
  ['ano', 'Ano (semestral/anual)', null],
  ['semestre', 'Semestre (semestral)', null],
  ['cupomDesconto', 'Cupom de desconto (opcional)', null],
]

function OfertaDePara({ oferta, aberta, onToggle, catalogo, pessoaTeste, onSalvo }: {
  oferta: OfertaRow; aberta: boolean; onToggle: () => void; catalogo: Catalogo | null; pessoaTeste: string; onSalvo: () => void
}) {
  const [m, setM] = useState<MapaOferta>(oferta.mapa ?? {})
  const [condicoesTxt, setCondicoesTxt] = useState(
    Object.entries(oferta.mapa?.condicoesPorParcelas ?? {}).map(([p, c]) => `${p}=${c}`).join(', '),
  )
  const [opcoes, setOpcoes] = useState<OpcoesSei | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const set = (k: keyof MapaOferta, v: string) => setM({ ...m, [k]: v })
  const completa = !!(m.codigoCurso && m.codigoBanner && m.codigoUnidadeEnsino && m.codigoTurno && m.codigoTurma && m.codigoProcessoMatricula && m.codigoCondicaoPagamento)

  async function buscarOpcoes() {
    if (!m.codigoCurso || !m.codigoBanner) { toast('Escolha o curso/banner do SEI primeiro.', 'warning'); return }
    if (!pessoaTeste) { toast('Informe o código da pessoa de teste no topo da página.', 'warning'); return }
    setBuscando(true)
    try {
      const r = await api.get<OpcoesSei>(`/admin/sei/catalogo/opcoes?curso=${encodeURIComponent(m.codigoCurso)}&banner=${encodeURIComponent(m.codigoBanner)}&pessoa=${encodeURIComponent(pessoaTeste)}`)
      setOpcoes(r)
      if (r.gradeCurricular && !m.codigoGradeCurricular) setM((x) => ({ ...x, codigoGradeCurricular: String(r.gradeCurricular) }))
    } catch (e) { toast(msg(e), 'danger') } finally { setBuscando(false) }
  }

  async function salvar() {
    setSalvando(true)
    try {
      const condicoesPorParcelas: Record<string, string> = {}
      for (const par of condicoesTxt.split(',')) {
        const [p, c] = par.split('=').map((x) => x.trim())
        if (p && c) condicoesPorParcelas[p] = c
      }
      await api.put(`/admin/sei/mapeamentos/oferta/${oferta.id}`, { ...m, condicoesPorParcelas })
      toast('De-para salvo', 'success')
      onSalvo()
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }

  const bannerAtual = `${m.codigoCurso ?? ''}|${m.codigoBanner ?? ''}`
  return (
    <div>
      <button type="button" class="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-surface-2" onClick={onToggle} aria-expanded={aberta}>
        {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span class="flex-1 min-w-0">
          <span class="text-sm font-medium text-fg">{oferta.nome}</span>
          <span class="block text-xs text-fg-muted truncate">{[oferta.curso, oferta.unidade, oferta.turno, oferta.complemento].filter(Boolean).join(' · ')}</span>
        </span>
        <Badge tone={completa ? 'success' : m.codigoCurso ? 'warning' : 'neutral'}>{completa ? 'Mapeada' : m.codigoCurso ? 'Incompleta' : 'Sem de-para'}</Badge>
      </button>
      {aberta && (
        <div class="space-y-4 px-5 pb-5">
          <div class="grid gap-3 sm:grid-cols-3">
            {catalogo ? (
              <Select label="Curso / banner no SEI" value={bannerAtual} onChange={(e) => {
                const [curso, banner] = valor(e).split('|')
                setM({ ...m, codigoCurso: curso, codigoBanner: banner })
              }}>
                <option value="|">— escolha —</option>
                {catalogo.banners.map((b) => (
                  <option key={b.codigoBanner} value={`${b.curso?.codigo}|${b.codigoBanner}`}>{b.descricao || 'Curso'} (curso {b.curso?.codigo} · banner {b.codigoBanner})</option>
                ))}
              </Select>
            ) : (
              <>
                <Input label="Código do curso no SEI" value={m.codigoCurso ?? ''} onInput={(e) => set('codigoCurso', valor(e))} />
                <Input label="Código do banner" value={m.codigoBanner ?? ''} onInput={(e) => set('codigoBanner', valor(e))} />
              </>
            )}
            <div class="flex items-end">
              <Button variant="secondary" size="sm" onClick={buscarOpcoes} loading={buscando}><RefreshCw size={14} /> Buscar opções no SEI</Button>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            {CAMPOS_OFERTA.map(([k, rot, lista]) => {
              const ops = lista && opcoes ? (opcoes[lista] as Opcao[]) : null
              return ops && ops.length ? (
                <Select key={k} label={rot} value={(m[k] as string) ?? ''} onChange={(e) => set(k, valor(e))}>
                  <option value="">— escolha —</option>
                  {ops.map((o) => <option key={o.codigo} value={String(o.codigo)}>{o.nome} ({o.codigo})</option>)}
                </Select>
              ) : (
                <Input key={k} label={rot} value={(m[k] as string) ?? ''} onInput={(e) => set(k, valor(e))} />
              )
            })}
          </div>
          <Input
            label="Condição por nº de parcelas (opcional)" value={condicoesTxt} placeholder="12=1325, 6=1330"
            hint="Quando o portal oferece mais de um plano: nº de parcelas escolhido = código da condição no SEI. Sem correspondência, vale a condição padrão."
            onInput={(e) => setCondicoesTxt(valor(e))}
          />
          {oferta.polos.length > 0 && (
            <div class="space-y-2">
              <div class="text-xs font-medium text-fg">Polos (código da unidade-polo no SEI)</div>
              <div class="grid gap-3 sm:grid-cols-3">
                {oferta.polos.map((p) => (
                  <Input key={p.id} label={p.nome} value={m.polos?.[String(p.id)] ?? ''}
                    onInput={(e) => setM({ ...m, polos: { ...(m.polos ?? {}), [String(p.id)]: valor(e) } })} />
                ))}
              </div>
            </div>
          )}
          <Button onClick={salvar} loading={salvando}><Save size={14} /> Salvar de-para</Button>
        </div>
      )}
    </div>
  )
}

function DocumentosDePara({ documentos, contrato, onSalvo }: { documentos: DocRow[]; contrato: { codigoTipoDocumento?: string } | null; onSalvo: () => void }) {
  const [valores, setValores] = useState<Record<number, string>>(
    Object.fromEntries(documentos.map((d) => [d.id, d.mapa?.codigoTipoDocumento ?? ''])),
  )
  const [contratoCod, setContratoCod] = useState(contrato?.codigoTipoDocumento ?? '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      for (const d of documentos) {
        const atual = d.mapa?.codigoTipoDocumento ?? ''
        if ((valores[d.id] ?? '') !== atual) await api.put(`/admin/sei/mapeamentos/documento/${d.id}`, { codigoTipoDocumento: valores[d.id] ?? '' })
      }
      if (contratoCod !== (contrato?.codigoTipoDocumento ?? '')) await api.put('/admin/sei/mapeamentos/contrato/0', { codigoTipoDocumento: contratoCod })
      toast('De-para de documentos salvo', 'success')
      onSalvo()
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }

  return (
    <Card class="p-5 space-y-4">
      <div>
        <div class="text-sm font-semibold text-fg">Documentos do portal → tipo de documento no SEI</div>
        <p class="text-xs text-fg-muted">Só documentos <b>aprovados</b> e pedidos pelo SEI na matrícula são enviados. Sem código, o documento fica de fora.</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        {documentos.map((d) => (
          <Input key={d.id} label={d.name} value={valores[d.id] ?? ''} placeholder="código do tipo no SEI"
            onInput={(e) => setValores({ ...valores, [d.id]: valor(e) })} />
        ))}
        <Input label="Contrato assinado" value={contratoCod} placeholder="código do tipo no SEI"
          hint="Vazio: usa a documentação marcada como contrato no SEI." onInput={(e) => setContratoCod(valor(e))} />
      </div>
      <Button onClick={salvar} loading={salvando}><Save size={14} /> Salvar documentos</Button>
    </Card>
  )
}

// ── Envios ──────────────────────────────────────────────────────────────────

function Envios() {
  const [envios, setEnvios] = useState<Envio[] | null>(null)
  const [filtro, setFiltro] = useState('')
  const [detalhe, setDetalhe] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<{ envios: Envio[] }>(`/admin/sei/envios${filtro ? `?status=${filtro}` : ''}`)
      setEnvios(r.envios)
    } catch (e) { toast(msg(e), 'danger') }
  }, [filtro])
  useEffect(() => { carregar() }, [carregar])

  async function acao(id: number, qual: 'reprocessar' | 'cancelar') {
    try {
      await api.post(`/admin/sei/envios/${id}/${qual}`, {})
      toast(qual === 'reprocessar' ? 'Reenvio iniciado' : 'Envio cancelado', 'success')
      setTimeout(carregar, 1500)
    } catch (e) { toast(msg(e), 'danger') }
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <div class="text-sm font-semibold text-fg">Envios ao SEI</div>
        <div class="flex items-center gap-2">
          <Select value={filtro} onChange={(e) => setFiltro(valor(e))} aria-label="Filtrar por situação">
            <option value="">Todos</option>
            <option value="ERRO">Com erro</option>
            <option value="PENDENTE">Na fila</option>
            <option value="CONCLUIDO">Concluídos</option>
            <option value="CANCELADO">Cancelados</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={carregar} aria-label="Atualizar"><RefreshCw size={14} /></Button>
        </div>
      </div>
      {!envios ? (
        <div class="px-5 py-4 text-sm text-fg-muted">Carregando…</div>
      ) : envios.length === 0 ? (
        <div class="px-5 py-4 text-sm text-fg-muted">Nenhum envio ainda. Envie uma inscrição pela ficha dela ou ligue o envio automático.</div>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-fg-muted">
              <tr class="text-left">
                <th class="px-5 py-2 font-medium">Inscrição</th>
                <th class="px-3 py-2 font-medium">Situação</th>
                <th class="px-3 py-2 font-medium">Matrícula SEI</th>
                <th class="px-3 py-2 font-medium">Atualizado</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {envios.map((e) => (
                <tr key={e.id} class="align-top">
                  <td class="px-5 py-2.5">
                    <div class="font-medium text-fg">{e.nome || '—'}</div>
                    <div class="text-xs text-fg-muted">{e.candidateCode} · {e.origem === 'automatico' ? 'automático' : 'manual'}</div>
                  </td>
                  <td class="px-3 py-2.5">
                    <Badge tone={TOM_STATUS[e.status] ?? 'neutral'}>{ROTULO_STATUS[e.status] ?? e.status}</Badge>
                    {e.status !== 'CONCLUIDO' && <div class="mt-1 text-xs text-fg-muted">Etapa: {ROTULO_ETAPA[e.etapa] ?? e.etapa} · {e.tentativas} tentativa(s)</div>}
                    {e.ultimoErro && <div class="mt-1 max-w-md text-xs text-danger">{e.ultimoErro}</div>}
                    {e.status === 'PENDENTE' && e.proximaTentativaEm && <div class="mt-1 text-xs text-fg-muted">Próxima tentativa: {dataBr(e.proximaTentativaEm)}</div>}
                  </td>
                  <td class="px-3 py-2.5 text-fg">{e.matricula ?? '—'}</td>
                  <td class="px-3 py-2.5 text-xs text-fg-muted">{dataBr(e.updatedAt)}</td>
                  <td class="px-3 py-2.5">
                    <div class="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetalhe(e.id)}><Eye size={14} /> Detalhes</Button>
                      {['ERRO', 'PENDENTE', 'CANCELADO'].includes(e.status) && <Button variant="ghost" size="sm" onClick={() => acao(e.id, 'reprocessar')}><RefreshCw size={14} /> Reenviar</Button>}
                      {['ERRO', 'PENDENTE'].includes(e.status) && <Button variant="ghost" size="sm" onClick={() => acao(e.id, 'cancelar')}><Ban size={14} /> Cancelar</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detalhe !== null && <DetalheEnvio id={detalhe} onClose={() => setDetalhe(null)} />}
    </Card>
  )
}

function DetalheEnvio({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<{ envio: Envio; chamadas: Chamada[] } | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  useEffect(() => { api.get<{ envio: Envio; chamadas: Chamada[] }>(`/admin/sei/envios/${id}`).then(setD).catch((e) => toast(msg(e), 'danger')) }, [id])
  const docs = Object.entries(d?.envio.documentosEnviados ?? {})
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Envio ao SEI" size="xl">
      {!d ? <div class="text-sm text-fg-muted">Carregando…</div> : (
        <div class="space-y-4 text-sm">
          <div class="grid gap-2 sm:grid-cols-4 text-xs">
            <div><div class="text-fg-muted">Situação</div><Badge tone={TOM_STATUS[d.envio.status] ?? 'neutral'}>{ROTULO_STATUS[d.envio.status] ?? d.envio.status}</Badge></div>
            <div><div class="text-fg-muted">Pessoa no SEI</div><div class="text-fg">{d.envio.codigoPessoa ?? '—'}</div></div>
            <div><div class="text-fg-muted">Matrícula no SEI</div><div class="text-fg">{d.envio.matricula ?? '—'}</div></div>
            <div><div class="text-fg-muted">Concluído em</div><div class="text-fg">{dataBr(d.envio.concluidoEm)}</div></div>
          </div>
          {docs.length > 0 && (
            <div>
              <div class="text-xs font-medium text-fg mb-1">Documentos enviados</div>
              <ul class="list-disc pl-5 text-xs text-fg-muted">{docs.map(([k, v]) => <li key={k}>{v.tipo}: {v.nome}</li>)}</ul>
            </div>
          )}
          {(d.envio.avisos ?? []).length > 0 && (
            <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <div class="flex items-center gap-1.5 font-medium text-fg"><AlertTriangle size={14} class="text-warning" /> Avisos</div>
              <ul class="mt-1 list-disc pl-5 text-fg-muted">{(d.envio.avisos ?? []).map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          <div>
            <div class="text-xs font-medium text-fg mb-1">Chamadas ao SEI</div>
            <div class="divide-y divide-border rounded-md border border-border">
              {d.chamadas.map((c) => (
                <div key={c.id}>
                  <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2" onClick={() => setAberta(aberta === c.id ? null : c.id)}>
                    {c.ok ? <CheckCircle2 size={13} class="text-success shrink-0" /> : <AlertTriangle size={13} class="text-danger shrink-0" />}
                    <span class="flex-1 text-fg">{c.servico}</span>
                    <span class="text-fg-muted">{c.httpStatus ?? '—'} · {c.duracaoMs ?? 0} ms · {new Date(c.createdAt).toLocaleTimeString('pt-BR')}</span>
                  </button>
                  {aberta === c.id && (
                    <div class="space-y-2 px-3 pb-3 text-xs">
                      {c.erro && <div class="text-danger">{c.erro}</div>}
                      <div class="text-fg-muted">{c.metodo} {c.caminho}</div>
                      {c.request != null && <pre class="max-h-60 overflow-auto rounded bg-surface-2 p-2 text-3xs text-fg">{JSON.stringify(c.request, null, 2)}</pre>}
                      {c.response != null && <pre class="max-h-60 overflow-auto rounded bg-surface-2 p-2 text-3xs text-fg">{JSON.stringify(c.response, null, 2)}</pre>}
                    </div>
                  )}
                </div>
              ))}
              {d.chamadas.length === 0 && <div class="px-3 py-2 text-xs text-fg-muted">Nenhuma chamada ainda.</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Cartão na ficha da inscrição ────────────────────────────────────────────

interface Previa {
  pendencias: string[]; avisos: string[]; condicaoPagamento: string
  oferta: { nome: string } | null; pessoa: Record<string, unknown>
  documentos: Array<{ id: number; nome: string; codigoTipoDocumentoSei: string | null }>
  contrato: { nome: string } | null
}

/** Situação do envio ao SEI de uma inscrição, com prévia e botão de envio. */
export function SeiInscricaoCard({ registrationId }: { registrationId: number }) {
  const [estado, setEstado] = useState<{ habilitada: boolean; envio: Envio | null } | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [vendoPrevia, setVendoPrevia] = useState(false)

  const carregar = useCallback(async () => {
    try { setEstado(await api.get(`/admin/sei/inscricao/${registrationId}`)) } catch { setEstado(null) }
  }, [registrationId])
  useEffect(() => { carregar() }, [carregar])

  if (!estado?.habilitada) return null
  const e = estado.envio

  async function abrirPrevia() {
    setVendoPrevia(true)
    try { setPrevia(await api.get<Previa>(`/admin/sei/previa/${registrationId}`)) } catch (err) { toast(msg(err), 'danger'); setVendoPrevia(false) }
  }
  async function enviar() {
    setEnviando(true)
    try {
      await api.post('/admin/sei/envios', { registrationId })
      toast('Envio ao SEI iniciado', 'success')
      setTimeout(carregar, 2500)
    } catch (err) { toast(msg(err), 'danger') } finally { setEnviando(false) }
  }

  return (
    <Card class="p-4 space-y-2">
      <div class="flex items-center gap-2">
        <GraduationCap size={15} class="text-accent" />
        <span class="text-sm font-semibold text-fg flex-1">SEI (ERP acadêmico)</span>
        {e ? <Badge tone={TOM_STATUS[e.status] ?? 'neutral'}>{ROTULO_STATUS[e.status] ?? e.status}</Badge> : <Badge tone="neutral">Não enviado</Badge>}
      </div>
      {e?.matricula && <div class="text-xs text-fg">Matrícula no SEI: <b>{e.matricula}</b></div>}
      {e?.ultimoErro && <div class="text-xs text-danger">{e.ultimoErro}</div>}
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={abrirPrevia}><Eye size={14} /> Prévia do envio</Button>
        {e?.status !== 'CONCLUIDO' && (
          <Button size="sm" onClick={enviar} loading={enviando || e?.status === 'PROCESSANDO'}><Send size={14} /> {e ? 'Reenviar ao SEI' : 'Enviar ao SEI'}</Button>
        )}
      </div>
      {vendoPrevia && (
        <Modal open onOpenChange={(o) => { if (!o) { setVendoPrevia(false); setPrevia(null) } }} title="Prévia do envio ao SEI" size="lg">
          {!previa ? <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Montando…</div> : (
            <div class="space-y-3 text-sm">
              {previa.pendencias.length > 0 ? (
                <div class="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
                  <div class="font-medium text-fg">Impede o envio</div>
                  <ul class="mt-1 list-disc pl-5 text-fg-muted">{previa.pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              ) : (
                <div class="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={14} /> Pronta para enviar</div>
              )}
              {previa.avisos.length > 0 && (
                <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                  <ul class="list-disc pl-5 text-fg-muted">{previa.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
              )}
              <div class="text-xs text-fg-muted">Oferta: <span class="text-fg">{previa.oferta?.nome ?? '—'}</span> · Condição de pagamento no SEI: <span class="text-fg">{previa.condicaoPagamento || '—'}</span></div>
              <div class="text-xs text-fg-muted">Documentos: <span class="text-fg">{previa.documentos.filter((d) => d.codigoTipoDocumentoSei).map((d) => d.nome).join(', ') || 'nenhum'}</span>{previa.contrato ? ' + contrato assinado' : ''}</div>
              <pre class="max-h-72 overflow-auto rounded bg-surface-2 p-2 text-3xs text-fg">{JSON.stringify(previa.pessoa, null, 2)}</pre>
            </div>
          )}
        </Modal>
      )}
    </Card>
  )
}
