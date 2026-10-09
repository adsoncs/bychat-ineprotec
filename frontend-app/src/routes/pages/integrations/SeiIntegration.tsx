// Integração com o SEI (ERP acadêmico) — Integrações › SEI.
//
// Envia ao SEI a inscrição concluída no portal: pessoa, matrícula (com a
// condição de pagamento), documentos aprovados e contrato assinado. O SEI só
// aceita os códigos DELE (curso, banner, unidade, turno, turma, processo,
// condição, tipo de documento) — por isso a aba "De-para" é o coração da tela.
//
// Quando enviar (Regras de envio): manual, automático, automático com carência
// ou programado — em todos, só sai inscrição APTA (etapas concluídas + o que o
// SEI exige). Backend: services/seiEnvios.ts.
//
// Endpoints: backend routes/seiIntegration.ts (/admin/sei/*).

import { useState, useEffect, useCallback } from 'preact/hooks'
import {
  GraduationCap, Save, PlugZap, CheckCircle2, AlertTriangle, Loader2, RefreshCw,
  Ban, ChevronDown, ChevronRight, DownloadCloud, Send, Eye, CalendarClock, Pause, Play, ListChecks, XCircle,
} from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Switch, Checkbox } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

type AuthTipo = 'nenhum' | 'basic' | 'bearer' | 'header'
type ModoEnvio = 'manual' | 'automatico' | 'carencia' | 'programado'

interface RegrasEnvio {
  modo: ModoEnvio; carenciaHoras: number; horarios: string[]; diasSemana: number[]; loteMaximo: number
  portais: number[]; exigirEfetivacao: boolean; validarNoSei: boolean; pessoaTeste: string
}

interface ItemChecagem { grupo: 'portal' | 'cadastro' | 'depara' | 'sei'; ok: boolean; texto: string }
interface Elegibilidade { apto: boolean; itens: ItemChecagem[]; bloqueios: string[]; avisos: string[]; conferidoNoSei: boolean | null }

const ROTULO_MODO: Record<ModoEnvio, string> = {
  manual: 'Manual', automatico: 'Automático', carencia: 'Automático com carência', programado: 'Programado',
}

interface SeiConfig {
  baseUrl: string
  authTipo: AuthTipo
  username: string
  senhaConfigurada: boolean
  tokenConfigurado: boolean
  headerNome: string
  enabled: boolean
  modo: ModoEnvio
  enviarContrato: boolean
  camposExtras: boolean
  totais: { pendentes: number; erros: number; concluidos: number; agendados: number; retidos: number; bloqueados: number }
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
  AGENDADO: 'info', RETIDO: 'warning', BLOQUEADO: 'warning',
}
const ROTULO_STATUS: Record<string, string> = {
  CONCLUIDO: 'Concluído', PENDENTE: 'Na fila', PROCESSANDO: 'Enviando', ERRO: 'Erro', CANCELADO: 'Cancelado',
  AGENDADO: 'Agendado', RETIDO: 'Retido', BLOQUEADO: 'Não apta',
}
const ROTULO_ORIGEM: Record<string, string> = {
  manual: 'manual', lote: 'em lote', agendado: 'agendado', automatico: 'automático', programado: 'programado',
}
const ROTULO_GRUPO: Record<ItemChecagem['grupo'], string> = {
  portal: 'Etapas do portal', cadastro: 'Cadastro exigido pelo SEI', depara: 'De-para e arquivos', sei: 'Conferência no SEI',
}
/** "2026-10-09T14:30" (datetime-local) → ISO com o fuso do navegador. */
const isoDoCampo = (v: string) => (v ? new Date(v).toISOString() : '')
const ROTULO_ETAPA: Record<string, string> = {
  pessoa: 'Pessoa', matricula: 'Matrícula', documentos: 'Documentos', concluido: 'Concluído',
}

export function SeiIntegration() {
  const [aba, setAba] = useState<'conexao' | 'depara' | 'regras' | 'prontas' | 'envios'>('conexao')
  return (
    <div class="space-y-4">
      <div class="flex gap-1 rounded-lg bg-surface-2 p-1 w-fit" role="tablist">
        {([['conexao', 'Conexão'], ['depara', 'De-para'], ['regras', 'Regras de envio'], ['prontas', 'Prontas para envio'], ['envios', 'Envios']] as const).map(([id, rot]) => (
          <button
            key={id} type="button" role="tab" aria-selected={aba === id}
            class={`rounded-md px-3 py-1.5 text-sm font-medium ${aba === id ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
            onClick={() => setAba(id)}
          >{rot}</button>
        ))}
      </div>
      {aba === 'conexao' && <Conexao />}
      {aba === 'depara' && <DePara />}
      {aba === 'regras' && <Regras />}
      {aba === 'prontas' && <Prontas />}
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
        enabled: cfg.enabled, enviarContrato: cfg.enviarContrato, camposExtras: cfg.camposExtras,
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
        <div class="font-medium text-fg">Fila · modo de envio: {ROTULO_MODO[cfg.modo]}</div>
        <div>
          {cfg.totais.pendentes} na fila · {cfg.totais.agendados} agendado(s) · {cfg.totais.retidos} retido(s) · {cfg.totais.bloqueados} não apta(s) ·{' '}
          {cfg.totais.erros} com erro · {cfg.totais.concluidos} concluído(s)
        </div>
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
  useEffect(() => {
    api.get<{ regras: RegrasEnvio }>('/admin/sei/regras').then((r) => setPessoaTeste((p) => p || r.regras.pessoaTeste)).catch(() => {})
  }, [])

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

// ── Regras de envio ─────────────────────────────────────────────────────────

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const MODOS: Array<{ id: ModoEnvio; titulo: string; texto: string }> = [
  { id: 'manual', titulo: 'Manual', texto: 'Nada sai sozinho. A secretaria envia pela ficha da inscrição (1 por 1) ou escolhe várias em "Prontas para envio" — na hora ou agendadas.' },
  { id: 'automatico', titulo: 'Automático', texto: 'Assim que a inscrição fica apta (todas as etapas concluídas e tudo o que o SEI exige), ela vai para o SEI.' },
  { id: 'carencia', titulo: 'Automático com carência', texto: 'Ficou apta → agenda o envio para daqui a algumas horas. Nesse intervalo a secretaria pode reter ou cancelar.' },
  { id: 'programado', titulo: 'Programado', texto: 'Nos dias e horários escolhidos, envia de uma vez todas as inscrições aptas acumuladas desde a última janela.' },
]

function Regras() {
  const [r, setR] = useState<RegrasEnvio | null>(null)
  const [portais, setPortais] = useState<Array<{ id: number; nome: string }>>([])
  const [janelas, setJanelas] = useState<string[]>([])
  const [horariosTxt, setHorariosTxt] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const d = await api.get<{ regras: RegrasEnvio; portais: Array<{ id: number; nome: string }>; proximasJanelas: string[] }>('/admin/sei/regras')
      setR(d.regras); setPortais(d.portais); setJanelas(d.proximasJanelas); setHorariosTxt(d.regras.horarios.join(', '))
    } catch (e) { toast(msg(e), 'danger') }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (!r) return <Card class="p-5"><div class="text-sm text-fg-muted">Carregando…</div></Card>
  const set = (p: Partial<RegrasEnvio>) => setR({ ...r, ...p })
  const automatico = r.modo !== 'manual'

  async function salvar() {
    if (!r) return
    setSalvando(true)
    try {
      const horarios = horariosTxt.split(/[,;\s]+/).map((h) => h.trim()).filter(Boolean)
      const d = await api.post<{ regras: RegrasEnvio; proximasJanelas: string[] }>('/admin/sei/regras', { ...r, horarios })
      setR(d.regras); setJanelas(d.proximasJanelas); setHorariosTxt(d.regras.horarios.join(', '))
      toast('Regras de envio salvas', 'success')
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }

  return (
    <div class="space-y-4">
      <Card class="p-5 space-y-4">
        <div>
          <div class="text-sm font-semibold text-fg">Quando enviar ao SEI</div>
          <p class="text-xs text-fg-muted">
            Em qualquer modo, só vai para o SEI a inscrição <b>apta</b>: todas as etapas do portal concluídas (documentos obrigatórios
            aprovados, pagamento confirmado, contrato assinado…), o cadastro que o SEI exige completo e o de-para feito. O envio manual,
            em lote e agendado continua disponível em todos os modos.
          </p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modo de envio">
          {MODOS.map((m) => (
            <button
              key={m.id} type="button" role="radio" aria-checked={r.modo === m.id}
              class={`rounded-lg border p-3 text-left transition-colors ${r.modo === m.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-2'}`}
              onClick={() => set({ modo: m.id })}
            >
              <div class="flex items-center gap-2 text-sm font-medium text-fg">
                <span class={`h-3.5 w-3.5 rounded-full border-2 ${r.modo === m.id ? 'border-accent bg-accent' : 'border-border'}`} />
                {m.titulo}
              </div>
              <div class="mt-1 text-xs text-fg-muted">{m.texto}</div>
            </button>
          ))}
        </div>

        {r.modo === 'carencia' && (
          <div class="w-56">
            <Input label="Carência (horas)" type="number" min={1} max={720} value={String(r.carenciaHoras)}
              hint="Entre ficar apta e ir para o SEI." onInput={(e) => set({ carenciaHoras: Number(valor(e)) })} />
          </div>
        )}

        {r.modo === 'programado' && (
          <div class="space-y-3">
            <div>
              <div class="mb-1 text-xs font-medium text-fg">Dias da semana</div>
              <div class="flex flex-wrap gap-1">
                {DIAS.map((d, i) => {
                  const on = r.diasSemana.includes(i)
                  return (
                    <button key={i} type="button" aria-pressed={on}
                      class={`rounded-md border px-2.5 py-1 text-xs ${on ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-muted'}`}
                      onClick={() => set({ diasSemana: on ? r.diasSemana.filter((x) => x !== i) : [...r.diasSemana, i].sort() })}
                    >{d}</button>
                  )
                })}
              </div>
            </div>
            <div class="w-72">
              <Input label="Horários (Brasília)" value={horariosTxt} placeholder="08:00, 13:00, 18:00"
                hint="Separados por vírgula." onInput={(e) => setHorariosTxt(valor(e))} />
            </div>
            {janelas.length > 0 && <div class="text-xs text-fg-muted">Próximas janelas: {janelas.join(' · ')}</div>}
          </div>
        )}

        {automatico && (
          <div class="grid gap-4 sm:grid-cols-2">
            <Input label="Máximo por rodada" type="number" min={1} max={500} value={String(r.loteMaximo)}
              hint="Quantas inscrições, no máximo, entram na fila de uma vez." onInput={(e) => set({ loteMaximo: Number(valor(e)) })} />
            <div>
              <div class="mb-1 text-xs font-medium text-fg">Portais que entram no envio automático</div>
              <div class="space-y-1">
                {portais.map((p) => (
                  <Checkbox key={p.id} label={p.nome} checked={r.portais.includes(p.id)}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked
                      set({ portais: on ? [...r.portais, p.id] : r.portais.filter((x) => x !== p.id) })
                    }} />
                ))}
              </div>
              <div class="mt-1 text-2xs text-fg-muted">Nenhum marcado = todos os portais.</div>
            </div>
          </div>
        )}
      </Card>

      <Card class="p-5 space-y-4">
        <div class="text-sm font-semibold text-fg">O que conta como "apta"</div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Switch checked={r.exigirEfetivacao} onChange={(v) => set({ exigirEfetivacao: v })} label="Exigir matrícula efetivada no portal"
            hint="Além das etapas concluídas, espera a efetivação (contrato do ERP assinado)." />
          <Switch checked={r.validarNoSei} onChange={(v) => set({ validarNoSei: v })} label="Conferir a oferta no próprio SEI"
            hint="Antes de liberar, pergunta ao SEI se ele aceita o curso, unidade, turno, turma, processo e condição do de-para." />
        </div>
        {r.validarNoSei && (
          <div class="w-72">
            <Input label="Código da pessoa de teste no SEI" value={r.pessoaTeste} onInput={(e) => set({ pessoaTeste: valor(e) })}
              hint="O SEI só mostra as opções de matrícula para uma pessoa. Peça ao fornecedor uma pessoa de teste." />
          </div>
        )}
      </Card>

      <Button onClick={salvar} loading={salvando}><Save size={14} /> Salvar regras</Button>
    </div>
  )
}

// ── Prontas para envio ──────────────────────────────────────────────────────

interface Candidata {
  registrationId: number; candidateCode: string; nome: string | null
  portal: { id: number; nome: string } | null; oferta: string | null; atualizadoEm: string
  envio: { id: number; status: string; ultimoErro: string | null } | null
  apto: boolean; bloqueios: string[]; avisos: string[]; conferidoNoSei: boolean | null
}

function Prontas() {
  const [linhas, setLinhas] = useState<Candidata[] | null>(null)
  const [filtro, setFiltro] = useState<'aptas' | 'pendentes' | 'todas'>('aptas')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [quando, setQuando] = useState('')
  const [online, setOnline] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Array<{ registrationId: number; ok: boolean; erro?: string }> | null>(null)
  const [checklist, setChecklist] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const r = await api.get<{ linhas: Candidata[] }>(`/admin/sei/candidatas${online ? '?online=1' : ''}`)
      setLinhas(r.linhas); setSel(new Set())
    } catch (e) { toast(msg(e), 'danger') } finally { setCarregando(false) }
  }, [online])
  useEffect(() => { carregar() }, [carregar])

  const visiveis = (linhas ?? []).filter((l) => filtro === 'todas' || (filtro === 'aptas' ? l.apto : !l.apto))
  const aptasVisiveis = visiveis.filter((l) => l.apto)
  const todasMarcadas = aptasVisiveis.length > 0 && aptasVisiveis.every((l) => sel.has(l.registrationId))

  async function enviar(agendar: boolean) {
    if (!sel.size) return
    if (agendar && !quando) { toast('Escolha a data e a hora do agendamento.', 'warning'); return }
    setEnviando(true); setResultado(null)
    try {
      const r = await api.post<{ resultados: Array<{ registrationId: number; ok: boolean; erro?: string }>; enviadas: number; recusadas: number }>(
        '/admin/sei/envios/lote', { registrationIds: [...sel], ...(agendar ? { quando: isoDoCampo(quando) } : {}) },
      )
      toast(`${r.enviadas} ${agendar ? 'agendada(s)' : 'na fila'}${r.recusadas ? ` · ${r.recusadas} recusada(s)` : ''}`, r.recusadas ? 'warning' : 'success')
      setResultado(r.resultados.filter((x) => !x.ok))
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setEnviando(false) }
  }

  async function reterSelecionadas() {
    setEnviando(true)
    try {
      for (const id of sel) await api.post(`/admin/sei/inscricao/${id}/reter`, { motivo: 'retida na lista de prontas' })
      toast(`${sel.size} retida(s): ficam fora do envio automático e programado`, 'success')
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setEnviando(false) }
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="space-y-3 px-5 py-3 border-b border-border">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-fg">Prontas para envio</div>
            <div class="text-xs text-fg-muted">Inscrições com contrato aceito ou matrícula no portal que ainda não foram ao SEI.</div>
          </div>
          <div class="flex items-center gap-2">
            <Select value={filtro} onChange={(e) => setFiltro(valor(e) as typeof filtro)} aria-label="Filtrar">
              <option value="aptas">Aptas</option>
              <option value="pendentes">Com pendência</option>
              <option value="todas">Todas</option>
            </Select>
            <Button variant="ghost" size="sm" onClick={carregar} loading={carregando} aria-label="Atualizar"><RefreshCw size={14} /></Button>
          </div>
        </div>
        <Switch checked={online} onChange={setOnline} label="Conferir também no SEI ao listar"
          hint="Mais lento. Mesmo desligado, cada envio é conferido no SEI antes de sair." />
        {sel.size > 0 && (
          <div class="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-3">
            <span class="self-center text-xs text-fg">{sel.size} selecionada(s)</span>
            <Button size="sm" onClick={() => enviar(false)} loading={enviando}><Send size={14} /> Enviar agora</Button>
            <div class="w-52"><Input type="datetime-local" label="Agendar para" value={quando} onInput={(e) => setQuando(valor(e))} /></div>
            <Button size="sm" variant="secondary" onClick={() => enviar(true)} loading={enviando}><CalendarClock size={14} /> Agendar</Button>
            <Button size="sm" variant="ghost" onClick={reterSelecionadas} loading={enviando}><Pause size={14} /> Reter</Button>
          </div>
        )}
        {resultado && resultado.length > 0 && (
          <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <div class="font-medium text-fg">Não saíram</div>
            <ul class="mt-1 list-disc pl-5 text-fg-muted">
              {resultado.map((x) => <li key={x.registrationId}>#{x.registrationId}: {x.erro}</li>)}
            </ul>
          </div>
        )}
      </div>
      {!linhas ? (
        <div class="px-5 py-4 text-sm text-fg-muted">Conferindo as inscrições…</div>
      ) : visiveis.length === 0 ? (
        <div class="px-5 py-4 text-sm text-fg-muted">{filtro === 'aptas' ? 'Nenhuma inscrição apta agora.' : 'Nada por aqui.'}</div>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-fg-muted">
              <tr class="text-left">
                <th class="w-8 px-5 py-2">
                  <input type="checkbox" aria-label="Marcar todas as aptas" checked={todasMarcadas} disabled={!aptasVisiveis.length}
                    onChange={() => setSel(todasMarcadas ? new Set() : new Set(aptasVisiveis.map((l) => l.registrationId)))} />
                </th>
                <th class="px-3 py-2 font-medium">Inscrição</th>
                <th class="px-3 py-2 font-medium">Aptidão</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {visiveis.map((l) => (
                <tr key={l.registrationId} class="align-top">
                  <td class="px-5 py-2.5">
                    <input type="checkbox" aria-label={`Selecionar ${l.candidateCode}`} disabled={!l.apto} checked={sel.has(l.registrationId)}
                      onChange={() => { const n = new Set(sel); n.has(l.registrationId) ? n.delete(l.registrationId) : n.add(l.registrationId); setSel(n) }} />
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="font-medium text-fg">{l.nome || '—'}</div>
                    <div class="text-xs text-fg-muted">{l.candidateCode} · {[l.oferta, l.portal?.nome].filter(Boolean).join(' · ')}</div>
                    {l.envio && <div class="mt-1"><Badge tone={TOM_STATUS[l.envio.status] ?? 'neutral'}>{ROTULO_STATUS[l.envio.status] ?? l.envio.status}</Badge></div>}
                  </td>
                  <td class="px-3 py-2.5">
                    {l.apto ? (
                      <div class="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={14} /> Apta{l.conferidoNoSei ? ' · conferida no SEI' : ''}</div>
                    ) : (
                      <ul class="max-w-lg list-disc pl-4 text-xs text-fg-muted">
                        {l.bloqueios.slice(0, 3).map((b, i) => <li key={i}>{b}</li>)}
                        {l.bloqueios.length > 3 && <li>+{l.bloqueios.length - 3} pendência(s)</li>}
                      </ul>
                    )}
                  </td>
                  <td class="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setChecklist(l.registrationId)}><ListChecks size={14} /> Checklist</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {checklist !== null && (
        <Modal open onOpenChange={(o) => { if (!o) setChecklist(null) }} title="Aptidão para o SEI" size="lg">
          <ChecklistAptidao registrationId={checklist} />
        </Modal>
      )}
    </Card>
  )
}

/** Checklist agrupado: etapas do portal, cadastro, de-para e conferência no SEI. */
function ChecklistAptidao({ registrationId, onCarregado }: { registrationId: number; onCarregado?: (e: Elegibilidade) => void }) {
  const [el, setEl] = useState<Elegibilidade | null>(null)
  useEffect(() => {
    setEl(null)
    api.get<Elegibilidade>(`/admin/sei/elegibilidade/${registrationId}?online=1`)
      .then((r) => { setEl(r); onCarregado?.(r) })
      .catch((e) => toast(msg(e), 'danger'))
  }, [registrationId])
  if (!el) return <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Conferindo (inclusive no SEI)…</div>
  const grupos = (['portal', 'cadastro', 'depara', 'sei'] as const).filter((g) => el.itens.some((i) => i.grupo === g))
  return (
    <div class="space-y-3 text-sm">
      {el.apto
        ? <div class="flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 size={14} /> Apta para o SEI</div>
        : <div class="flex items-center gap-1.5 text-xs font-medium text-danger"><XCircle size={14} /> Ainda não pode ir para o SEI — {el.bloqueios.length} pendência(s)</div>}
      {grupos.map((g) => (
        <div key={g}>
          <div class="mb-1 text-xs font-medium text-fg">{ROTULO_GRUPO[g]}</div>
          <ul class="space-y-1">
            {el.itens.filter((i) => i.grupo === g).map((i, k) => (
              <li key={k} class="flex items-start gap-1.5 text-xs">
                {i.ok ? <CheckCircle2 size={13} class="mt-px shrink-0 text-success" /> : <XCircle size={13} class="mt-px shrink-0 text-danger" />}
                <span class={i.ok ? 'text-fg-muted' : 'text-fg'}>{i.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {el.avisos.length > 0 && (
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <div class="flex items-center gap-1.5 font-medium text-fg"><AlertTriangle size={14} class="text-warning" /> Avisos (não impedem o envio)</div>
          <ul class="mt-1 list-disc pl-5 text-fg-muted">{el.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </div>
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

  async function liberarInscricao(registrationId: number) {
    try {
      await api.post(`/admin/sei/inscricao/${registrationId}/liberar`, {})
      toast('Liberada: volta a valer o modo de envio configurado', 'success')
      setTimeout(carregar, 1000)
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
            <option value="AGENDADO">Agendados</option>
            <option value="RETIDO">Retidos</option>
            <option value="BLOQUEADO">Não aptas</option>
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
                    <div class="text-xs text-fg-muted">{e.candidateCode} · {ROTULO_ORIGEM[e.origem] ?? e.origem}</div>
                  </td>
                  <td class="px-3 py-2.5">
                    <Badge tone={TOM_STATUS[e.status] ?? 'neutral'}>{ROTULO_STATUS[e.status] ?? e.status}</Badge>
                    {e.status !== 'CONCLUIDO' && <div class="mt-1 text-xs text-fg-muted">Etapa: {ROTULO_ETAPA[e.etapa] ?? e.etapa} · {e.tentativas} tentativa(s)</div>}
                    {e.ultimoErro && <div class="mt-1 max-w-md text-xs text-danger">{e.ultimoErro}</div>}
                    {e.status === 'PENDENTE' && e.proximaTentativaEm && <div class="mt-1 text-xs text-fg-muted">Próxima tentativa: {dataBr(e.proximaTentativaEm)}</div>}
                    {e.status === 'AGENDADO' && e.proximaTentativaEm && <div class="mt-1 text-xs text-fg-muted">Sai em: {dataBr(e.proximaTentativaEm)}</div>}
                  </td>
                  <td class="px-3 py-2.5 text-fg">{e.matricula ?? '—'}</td>
                  <td class="px-3 py-2.5 text-xs text-fg-muted">{dataBr(e.updatedAt)}</td>
                  <td class="px-3 py-2.5">
                    <div class="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetalhe(e.id)}><Eye size={14} /> Detalhes</Button>
                      {['ERRO', 'PENDENTE', 'CANCELADO', 'BLOQUEADO'].includes(e.status) && <Button variant="ghost" size="sm" onClick={() => acao(e.id, 'reprocessar')}><RefreshCw size={14} /> Reenviar</Button>}
                      {e.status === 'AGENDADO' && <Button variant="ghost" size="sm" onClick={() => acao(e.id, 'reprocessar')}><Send size={14} /> Enviar agora</Button>}
                      {e.status === 'RETIDO' && <Button variant="ghost" size="sm" onClick={() => liberarInscricao(e.registrationId)}><Play size={14} /> Liberar</Button>}
                      {['ERRO', 'PENDENTE', 'AGENDADO', 'BLOQUEADO', 'RETIDO'].includes(e.status) && <Button variant="ghost" size="sm" onClick={() => acao(e.id, 'cancelar')}><Ban size={14} /> Cancelar</Button>}
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

/**
 * Envio ao SEI de uma inscrição: aptidão (checklist), envio manual na hora ou
 * agendado, reter/liberar e a prévia do que vai.
 */
export function SeiInscricaoCard({ registrationId }: { registrationId: number }) {
  const [estado, setEstado] = useState<{ habilitada: boolean; envio: Envio | null; modo: ModoEnvio } | null>(null)
  const [aptidao, setAptidao] = useState<Elegibilidade | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [vendo, setVendo] = useState<'checklist' | 'previa' | 'agendar' | null>(null)
  const [quando, setQuando] = useState('')

  const carregar = useCallback(async () => {
    try { setEstado(await api.get(`/admin/sei/inscricao/${registrationId}`)) } catch { setEstado(null) }
    api.get<Elegibilidade>(`/admin/sei/elegibilidade/${registrationId}`).then(setAptidao).catch(() => setAptidao(null))
  }, [registrationId])
  useEffect(() => { carregar() }, [carregar])

  if (!estado?.habilitada) return null
  const e = estado.envio
  const concluido = e?.status === 'CONCLUIDO'
  const retido = e?.status === 'RETIDO'
  const jaComecou = !!e?.codigoPessoa

  async function abrirPrevia() {
    setVendo('previa')
    try { setPrevia(await api.get<Previa>(`/admin/sei/previa/${registrationId}`)) } catch (err) { toast(msg(err), 'danger'); setVendo(null) }
  }
  async function enviar(agendado: boolean) {
    if (agendado && !quando) { toast('Escolha a data e a hora.', 'warning'); return }
    setOcupado(true)
    try {
      await api.post('/admin/sei/envios', { registrationId, ...(agendado ? { quando: isoDoCampo(quando) } : {}) })
      toast(agendado ? 'Envio agendado' : 'Envio ao SEI iniciado', 'success')
      setVendo(null)
      setTimeout(carregar, agendado ? 300 : 2500)
    } catch (err) { toast(msg(err), 'danger') } finally { setOcupado(false) }
  }
  async function reterOuLiberar() {
    setOcupado(true)
    try {
      if (retido) await api.post(`/admin/sei/inscricao/${registrationId}/liberar`, {})
      else await api.post(`/admin/sei/inscricao/${registrationId}/reter`, { motivo: 'retida na ficha da inscrição' })
      toast(retido ? 'Liberada' : 'Retida: fica fora do envio automático e programado', 'success')
      await carregar()
    } catch (err) { toast(msg(err), 'danger') } finally { setOcupado(false) }
  }

  const podeEnviar = !concluido && (jaComecou || !!aptidao?.apto)
  return (
    <Card class="p-4 space-y-2">
      <div class="flex items-center gap-2">
        <GraduationCap size={15} class="text-accent" />
        <span class="text-sm font-semibold text-fg flex-1">SEI (ERP acadêmico)</span>
        {e ? <Badge tone={TOM_STATUS[e.status] ?? 'neutral'}>{ROTULO_STATUS[e.status] ?? e.status}</Badge> : <Badge tone="neutral">Não enviado</Badge>}
      </div>
      {e?.matricula && <div class="text-xs text-fg">Matrícula no SEI: <b>{e.matricula}</b></div>}
      {e?.status === 'AGENDADO' && e.proximaTentativaEm && <div class="text-xs text-fg-muted">Agendado para {dataBr(e.proximaTentativaEm)}</div>}
      {e?.ultimoErro && <div class="text-xs text-danger">{e.ultimoErro}</div>}
      {!concluido && aptidao && (
        aptidao.apto
          ? <div class="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={13} /> Apta para o SEI · modo {ROTULO_MODO[estado.modo].toLowerCase()}</div>
          : <div class="flex items-center gap-1.5 text-xs text-fg-muted"><XCircle size={13} class="text-danger" /> Não apta: {aptidao.bloqueios.length} pendência(s)</div>
      )}
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setVendo('checklist')}><ListChecks size={14} /> Checklist</Button>
        <Button variant="ghost" size="sm" onClick={abrirPrevia}><Eye size={14} /> Prévia</Button>
        {!concluido && (
          <>
            <Button size="sm" onClick={() => enviar(false)} disabled={!podeEnviar} loading={ocupado || e?.status === 'PROCESSANDO'}
              title={podeEnviar ? undefined : 'Só sai para o SEI quando estiver apta — veja o checklist'}>
              <Send size={14} /> {e && e.status !== 'RETIDO' ? 'Enviar agora' : 'Enviar ao SEI'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVendo('agendar')} disabled={!podeEnviar}><CalendarClock size={14} /> Agendar</Button>
            {e?.status !== 'PROCESSANDO' && (
              <Button variant="ghost" size="sm" onClick={reterOuLiberar} loading={ocupado}>
                {retido ? <><Play size={14} /> Liberar</> : <><Pause size={14} /> Reter</>}
              </Button>
            )}
          </>
        )}
      </div>
      {vendo === 'checklist' && (
        <Modal open onOpenChange={(o) => { if (!o) setVendo(null) }} title="Aptidão para o SEI" size="lg">
          <ChecklistAptidao registrationId={registrationId} onCarregado={setAptidao} />
        </Modal>
      )}
      {vendo === 'agendar' && (
        <Modal open onOpenChange={(o) => { if (!o) setVendo(null) }} title="Agendar envio ao SEI" size="sm">
          <div class="space-y-3">
            <Input type="datetime-local" label="Enviar em" value={quando} onInput={(ev) => setQuando(valor(ev))}
              hint="Na hora marcada a aptidão é conferida de novo; se algo mudou, o envio fica parado com o motivo." />
            <Button onClick={() => enviar(true)} loading={ocupado}><CalendarClock size={14} /> Agendar</Button>
          </div>
        </Modal>
      )}
      {vendo === 'previa' && (
        <Modal open onOpenChange={(o) => { if (!o) { setVendo(null); setPrevia(null) } }} title="Prévia do envio ao SEI" size="lg">
          {!previa ? <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Montando…</div> : (
            <div class="space-y-3 text-sm">
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
