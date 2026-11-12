// Integração com o Moodle — Integrações › Moodle.
//
// Libera o curso no Moodle quando a inscrição do portal está PAGA e com o
// CONTRATO aceito/assinado. Suspender é sempre manual (cartão da inscrição).
//
// Abas: Conexão · De-para (oferta do portal → curso do Moodle) · Acessos.
// Backend: routes/moodleIntegration.ts, services/moodleAcessos.ts.

import { useState, useEffect, useCallback, useMemo } from 'preact/hooks'
import {
  BookOpen, Save, PlugZap, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Wand2,
  Play, Pause, ListChecks, XCircle, ExternalLink, Repeat, Link2, GraduationCap,
} from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Switch, Checkbox } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import { ProgressoAvaPainel, ResumoDoProgresso, useProgressoAva } from '@/components/educational/ProgressoAvaPainel'

interface Config {
  baseUrl: string; tokenConfigurado: boolean; senhaConfigurada: boolean; enabled: boolean; sso: boolean
  papelId: number; portais: number[]; desde: string | null
  todosPortais: { id: number; nome: string; active: boolean }[]; totais: Record<string, number>
}
interface Curso { id: number; nome: string; categoria: string; visivel: boolean }
interface LinhaDepara {
  chave: string; portalId: number; portalNome: string; offeringId: number; ofertaNome: string
  courseId: number | null; cursoNome: string | null; sugestao: { courseId: number; nome: string; categoria: string } | null
}
interface Acesso {
  id: number; registrationId: number; status: string; origem: string; username: string | null; cursoNome: string | null
  moodleCourseId: number | null; ultimoErro: string | null; liberadoEm: string | null; tentativas: number
  codigo: string | null; aluno: string | null; portal: string | null; portalId: number | null; updatedAt: string
}
interface ItemAptidao { ok: boolean; texto: string; regra: boolean; curso?: boolean }
interface Aptidao { apta: boolean; liberavel: boolean; itens: ItemAptidao[]; courseId: number | null; cursoNome: string | null }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const valor = (e: Event) => (e.target as HTMLInputElement).value
const dataBr = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

const ROTULO: Record<string, string> = { PENDENTE: 'Pendente', LIBERADO: 'Liberado', ERRO: 'Erro', SUSPENSO: 'Suspenso', SEM_CURSO: 'Sem curso no de-para' }
const TOM: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { PENDENTE: 'info', LIBERADO: 'success', ERRO: 'danger', SUSPENSO: 'warning', SEM_CURSO: 'warning' }

export function MoodleIntegration() {
  const [aba, setAba] = useState<'conexao' | 'depara' | 'acessos'>('conexao')
  return (
    <div class="space-y-4">
      <div class="flex gap-1 border-b border-border">
        {([['conexao', 'Conexão'], ['depara', 'De-para de cursos'], ['acessos', 'Acessos']] as const).map(([k, r]) => (
          <button type="button" key={k} onClick={() => setAba(k)}
            class={`px-3 py-2 text-sm -mb-px border-b-2 ${aba === k ? 'border-accent text-fg font-semibold' : 'border-transparent text-fg-muted hover:text-fg'}`}>{r}</button>
        ))}
      </div>
      {aba === 'conexao' && <AbaConexao />}
      {aba === 'depara' && <AbaDepara />}
      {aba === 'acessos' && <AbaAcessos />}
    </div>
  )
}

// ── Conexão ─────────────────────────────────────────────────────────────────

function AbaConexao() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [token, setToken] = useState('')
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    try { setCfg(await api.get<Config>('/admin/moodle/config')) } catch (e) { toast(msg(e), 'danger') }
  }, [])
  useEffect(() => { carregar() }, [carregar])
  if (!cfg) return <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Carregando…</div>
  const set = (p: Partial<Config>) => setCfg({ ...cfg, ...p })

  async function salvar() {
    setSalvando(true)
    try {
      await api.post('/admin/moodle/config', {
        baseUrl: cfg!.baseUrl, sso: cfg!.sso, papelId: cfg!.papelId, portais: cfg!.portais, enabled: cfg!.enabled,
        ...(token ? { token } : {}), ...(senha ? { senha } : {}),
      })
      setToken(''); setSenha('')
      toast('Configuração salva', 'success')
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }
  async function testar() {
    setTestando(true); setTeste(null)
    try {
      const r = await api.post<{ site: string | null; versao: string | null; cursos: number }>('/admin/moodle/testar', {})
      setTeste({ ok: true, texto: `Conectado${r.site ? ` a "${r.site}"` : ''}${r.versao ? ` (Moodle ${r.versao})` : ''} · ${r.cursos} cursos encontrados.` })
    } catch (e) { setTeste({ ok: false, texto: msg(e) }) } finally { setTestando(false) }
  }
  const alternarPortal = (id: number, sim: boolean) => set({ portais: sim ? [...new Set([...cfg.portais, id])] : cfg.portais.filter((p) => p !== id) })
  const t = cfg.totais || {}

  return (
    <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card class="p-4 space-y-4">
        <div class="flex items-center gap-2"><BookOpen size={16} class="text-accent" /><span class="font-semibold text-fg">Conexão com o Moodle</span></div>
        <Input label="URL do Moodle" value={cfg.baseUrl} placeholder="https://ava.suaescola.com.br" onInput={(e) => set({ baseUrl: valor(e) })}
          hint="O endereço do Moodle, sem /webservice no final." />
        <Input label="Token do serviço externo" type="password" value={token} placeholder={cfg.tokenConfigurado ? '•••••••• (configurado)' : ''}
          onInput={(e) => setToken(valor(e))} hint="Moodle › Administração › Servidor › Serviços web › Gerenciar tokens. Fica guardado cifrado." />
        <Input label="Senha inicial do aluno" type="password" value={senha} placeholder={cfg.senhaConfigurada ? '•••••••• (configurada)' : ''}
          onInput={(e) => setSenha(valor(e))} hint="Usada só para o aluno novo (sem troca obrigatória no primeiro acesso). O usuário é o CPF (só números)." />
        <Input label="Papel do aluno no curso (id)" type="number" value={String(cfg.papelId)} onInput={(e) => set({ papelId: Number(valor(e)) || 5 })}
          hint="5 = Estudante, no Moodle padrão." />
        <Switch checked={cfg.sso} onChange={(v) => set({ sso: v })} label="Entrar no Moodle já logado"
          hint='Exige o plugin "User key authentication" (auth_userkey) instalado no Moodle e a função auth_userkey_request_login_url no serviço. Sem ele, o botão abre o curso e o aluno entra com CPF e senha.' />
        <div class="space-y-2">
          <div class="text-xs font-semibold text-fg-muted">Portais cujas inscrições liberam acesso</div>
          {cfg.todosPortais.map((p) => (
            <Checkbox key={p.id} checked={cfg.portais.includes(p.id)} onChange={(e) => alternarPortal(p.id, (e.target as HTMLInputElement).checked)}
              label={`${p.nome}${p.active ? '' : ' (inativo)'}`} />
          ))}
        </div>
        <Switch checked={cfg.enabled} onChange={(v) => set({ enabled: v })} label="Liberação automática"
          hint={`Libera sozinho quando a inscrição fica PAGA e com o CONTRATO aceito (confere de 2 em 2 minutos). Nunca suspende sozinho.${cfg.desde ? ` Vale para o que ficou apto desde ${dataBr(cfg.desde)}; o que veio antes se libera pela ficha da inscrição.` : ' Ao ligar, vale para o que ficar apto daqui em diante.'}`} />
        <div class="flex flex-wrap gap-2">
          <Button onClick={salvar} loading={salvando}><Save size={14} /> Salvar</Button>
          <Button variant="secondary" onClick={testar} loading={testando} disabled={!cfg.baseUrl || !cfg.tokenConfigurado}><PlugZap size={14} /> Testar conexão</Button>
        </div>
        {teste && (
          <div class={`flex items-start gap-2 rounded-md border p-3 text-sm ${teste.ok ? 'border-success/40 bg-success/10' : 'border-danger/40 bg-danger/10'}`}>
            {teste.ok ? <CheckCircle2 size={15} class="text-success mt-0.5" /> : <AlertTriangle size={15} class="text-danger mt-0.5" />}
            <span class="text-fg">{teste.texto}</span>
          </div>
        )}
      </Card>
      <Card class="p-4 space-y-2 h-fit">
        <div class="text-sm font-semibold text-fg">Acessos</div>
        {(['LIBERADO', 'PENDENTE', 'ERRO', 'SEM_CURSO', 'SUSPENSO'] as const).map((s) => (
          <div key={s} class="flex items-center justify-between text-sm"><Badge tone={TOM[s]}>{ROTULO[s]}</Badge><span class="text-fg font-semibold">{t[s] ?? 0}</span></div>
        ))}
      </Card>
      <VincularAlunosCard aoVincular={carregar} />
    </div>
  )
}

// ── Vincular alunos que já estudavam no Moodle (pelo CPF) ──────────────────

interface CandidatoVinculo {
  registrationId: number; codigo: string; aluno: string | null; portal: string | null; portalId: number | null
  situacao: 'vinculavel' | 'sem_usuario' | 'sem_cpf' | 'fora_do_curso' | 'sem_curso_no_depara' | 'erro'
  usuario: string | null; curso: string | null; cursosNoMoodle: string[]; erro?: string
}
const SITUACAO_VINCULO: Record<CandidatoVinculo['situacao'], { rotulo: string; tom: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  vinculavel: { rotulo: 'Pode vincular', tom: 'success' },
  fora_do_curso: { rotulo: 'No Moodle, mas não neste curso', tom: 'warning' },
  sem_usuario: { rotulo: 'Não está no Moodle', tom: 'neutral' },
  sem_cpf: { rotulo: 'Sem CPF na inscrição', tom: 'neutral' },
  sem_curso_no_depara: { rotulo: 'Oferta sem curso no de-para', tom: 'warning' },
  erro: { rotulo: 'Erro ao consultar', tom: 'danger' },
}

function VincularAlunosCard({ aoVincular }: { aoVincular: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState<CandidatoVinculo[] | null>(null)
  const [marcadas, setMarcadas] = useState<number[]>([])
  const [carregando, setCarregando] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [filtro, setFiltro] = useState<'todas' | 'vinculavel'>('vinculavel')

  async function procurar() {
    setAberto(true); setCarregando(true); setLista(null)
    try {
      const r = await api.get<{ candidatos: CandidatoVinculo[] }>('/admin/moodle/vincular')
      setLista(r.candidatos)
      setMarcadas(r.candidatos.filter((c) => c.situacao === 'vinculavel').map((c) => c.registrationId))
    } catch (e) { toast(msg(e), 'danger'); setAberto(false) } finally { setCarregando(false) }
  }
  async function vincularMarcadas() {
    setGravando(true)
    try {
      const r = await api.post<{ vinculadas: number; ignoradas: number }>('/admin/moodle/vincular', { ids: marcadas })
      toast(`${r.vinculadas} aluno(s) vinculado(s)${r.ignoradas ? ` · ${r.ignoradas} ignorado(s)` : ''}`, 'success')
      setAberto(false); aoVincular()
    } catch (e) { toast(msg(e), 'danger') } finally { setGravando(false) }
  }
  const vinculaveis = (lista ?? []).filter((c) => c.situacao === 'vinculavel')
  const mostradas = (lista ?? []).filter((c) => filtro === 'todas' || c.situacao === 'vinculavel')

  return (
    <Card class="p-4 space-y-2 h-fit lg:col-start-2">
      <div class="flex items-center gap-2"><Link2 size={15} class="text-accent" /><span class="text-sm font-semibold text-fg">Alunos que já estudam no Moodle</span></div>
      <p class="text-xs text-fg-muted">Procura, pelo CPF (ou e-mail), as inscrições dos portais ligados que ainda não estão vinculadas e cujo aluno já está no curso certo do Moodle. Vincular não inscreve ninguém no Moodle: só liga a inscrição ao aluno que já existe, para o andamento aparecer no Meu Portal e na ficha.</p>
      <Button variant="secondary" size="sm" onClick={procurar} loading={carregando}><GraduationCap size={14} /> Procurar e vincular</Button>
      {aberto && (
        <Modal open onOpenChange={(o) => { if (!o) setAberto(false) }} title="Vincular alunos que já estão no Moodle" size="xl"
          footer={
            <div class="flex flex-wrap items-center justify-between gap-2 w-full">
              <span class="text-xs text-fg-muted">{marcadas.length} selecionada(s)</span>
              <div class="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAberto(false)}>Cancelar</Button>
                <Button size="sm" onClick={vincularMarcadas} loading={gravando} disabled={!marcadas.length}><Link2 size={13} /> Vincular selecionadas</Button>
              </div>
            </div>
          }>
          {!lista ? <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Consultando o Moodle… (pode levar alguns segundos)</div> : (
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-3 text-xs">
                <span class="text-fg-muted">{lista.length} inscrição(ões) sem vínculo · <b class="text-fg">{vinculaveis.length}</b> podem ser vinculadas</span>
                <Select value={filtro} onChange={(e) => setFiltro(valor(e) as 'todas' | 'vinculavel')}>
                  <option value="vinculavel">Só as que podem vincular</option>
                  <option value="todas">Todas (com o motivo)</option>
                </Select>
                {vinculaveis.length > 0 && <button class="text-accent hover:underline" onClick={() => setMarcadas(marcadas.length === vinculaveis.length ? [] : vinculaveis.map((c) => c.registrationId))}>{marcadas.length === vinculaveis.length ? 'Desmarcar todas' : 'Marcar todas'}</button>}
              </div>
              {!mostradas.length ? <div class="text-sm text-fg-muted py-4 text-center">Nenhuma inscrição para vincular agora.</div> : (
                <div class="rounded-lg border border-border overflow-hidden">
                  <table class="w-full text-sm">
                    <thead class="bg-surface-2 text-2xs uppercase tracking-wider text-fg-muted"><tr>
                      <th class="px-3 py-2 w-8"></th><th class="text-left px-3 py-2">Aluno</th><th class="text-left px-3 py-2">Curso no Moodle</th><th class="text-left px-3 py-2">Situação</th>
                    </tr></thead>
                    <tbody class="divide-y divide-border">
                      {mostradas.map((c) => (
                        <tr key={c.registrationId}>
                          <td class="px-3 py-2">{c.situacao === 'vinculavel' && <input type="checkbox" checked={marcadas.includes(c.registrationId)} onChange={(e) => setMarcadas((x) => (e.target as HTMLInputElement).checked ? [...x, c.registrationId] : x.filter((k) => k !== c.registrationId))} />}</td>
                          <td class="px-3 py-2"><div class="text-fg">{c.aluno ?? '—'}</div><div class="text-2xs text-fg-muted">{c.codigo} · {c.portal}{c.usuario ? ` · usuário ${c.usuario}` : ''}</div></td>
                          <td class="px-3 py-2 text-xs">{c.curso ?? '—'}{c.cursosNoMoodle.length > 0 && <div class="text-2xs text-fg-muted">No Moodle: {c.cursosNoMoodle.slice(0, 3).join(' · ')}{c.cursosNoMoodle.length > 3 ? '…' : ''}</div>}</td>
                          <td class="px-3 py-2"><Badge tone={SITUACAO_VINCULO[c.situacao].tom}>{SITUACAO_VINCULO[c.situacao].rotulo}</Badge>{c.erro && <div class="text-2xs text-danger mt-0.5">{c.erro}</div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p class="text-2xs text-fg-muted">"No Moodle, mas não neste curso": o aluno existe no Moodle, mas não está no curso do de-para desta oferta. Use "Trocar curso" na ficha da inscrição se ele estuda em outro curso.</p>
            </div>
          )}
        </Modal>
      )}
    </Card>
  )
}

// ── De-para ─────────────────────────────────────────────────────────────────

function SeletorCurso({ cursos, valor: v, onChange, filtro }: { cursos: Curso[]; valor: number | null; onChange: (id: number | null) => void; filtro: string }) {
  const f = filtro.trim().toLowerCase()
  const lista = f ? cursos.filter((c) => (c.nome + ' ' + c.categoria).toLowerCase().includes(f) || c.id === v) : cursos
  const grupos = useMemo(() => {
    const m = new Map<string, Curso[]>()
    for (const c of lista) { const k = c.categoria || 'Sem categoria'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(c) }
    return [...m.entries()]
  }, [lista])
  return (
    <Select value={v ? String(v) : ''} onChange={(e) => onChange(Number(valor(e)) || null)} class="w-full">
      <option value="">— sem curso (não libera) —</option>
      {grupos.map(([cat, cs]) => (
        <optgroup key={cat} label={cat}>
          {cs.map((c) => <option key={c.id} value={String(c.id)}>{c.nome}{c.visivel ? '' : ' (oculto)'} · #{c.id}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

function AbaDepara() {
  const [linhas, setLinhas] = useState<LinhaDepara[] | null>(null)
  const [cursos, setCursos] = useState<Curso[]>([])
  const [mudou, setMudou] = useState<Record<string, number | null>>({})
  const [filtro, setFiltro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async (atualizar = false) => {
    try {
      const [d, c] = await Promise.all([
        api.get<{ linhas: LinhaDepara[] }>('/admin/moodle/depara'),
        api.get<{ cursos: Curso[] }>(`/admin/moodle/cursos${atualizar ? '?atualizar=1' : ''}`),
      ])
      setLinhas(d.linhas); setCursos(c.cursos); setMudou({})
    } catch (e) { toast(msg(e), 'danger'); setLinhas([]) }
  }, [])
  useEffect(() => { carregar() }, [carregar])
  if (!linhas) return <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Carregando ofertas e cursos…</div>
  if (!linhas.length) return <Card class="p-4 text-sm text-fg-muted">Marque os portais na aba Conexão para aparecerem as ofertas aqui.</Card>

  const atual = (l: LinhaDepara): number | null => (l.chave in mudou ? mudou[l.chave] ?? null : l.courseId)
  const pendentes = linhas.filter((l) => !atual(l)).length
  const comSugestao = linhas.filter((l) => !atual(l) && l.sugestao).length
  function aplicarSugestoes() {
    const n: Record<string, number | null> = { ...mudou }
    for (const l of linhas!) if (!atual(l) && l.sugestao) n[l.chave] = l.sugestao.courseId
    setMudou(n)
  }
  async function salvar() {
    setSalvando(true)
    try {
      await api.put('/admin/moodle/depara', { itens: mudou })
      toast('De-para salvo', 'success')
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setSalvando(false) }
  }
  const porPortal = new Map<string, LinhaDepara[]>()
  for (const l of linhas) { if (!porPortal.has(l.portalNome)) porPortal.set(l.portalNome, []); porPortal.get(l.portalNome)!.push(l) }

  return (
    <div class="space-y-3">
      <Card class="p-3 flex flex-wrap items-center gap-2">
        <div class="relative flex-1 min-w-[200px]">
          <Input value={filtro} placeholder="Filtrar cursos do Moodle (ex.: ITECC, Competência)" onInput={(e) => setFiltro(valor(e))} />
        </div>
        <span class="text-xs text-fg-muted">{pendentes} oferta(s) sem curso</span>
        <Button variant="secondary" size="sm" onClick={aplicarSugestoes} disabled={!comSugestao}><Wand2 size={14} /> Aplicar {comSugestao} sugestão(ões)</Button>
        <Button variant="ghost" size="sm" onClick={() => carregar(true)}><RefreshCw size={14} /> Recarregar cursos</Button>
        <Button size="sm" onClick={salvar} loading={salvando} disabled={!Object.keys(mudou).length}><Save size={14} /> Salvar ({Object.keys(mudou).length})</Button>
      </Card>
      {[...porPortal.entries()].map(([portal, ls]) => (
        <Card key={portal} class="p-0 overflow-hidden">
          <div class="px-4 py-2 bg-surface-2 text-sm font-semibold text-fg">{portal}</div>
          <div class="divide-y divide-border">
            {ls.map((l) => {
              const v = atual(l)
              return (
                <div key={l.chave} class="grid gap-2 px-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center">
                  <div class="text-sm text-fg">
                    {l.ofertaNome} <span class="text-2xs text-fg-muted">#{l.offeringId}</span>
                    {!v && l.sugestao && <div class="text-2xs text-fg-muted flex items-center gap-1"><Wand2 size={11} /> Sugestão: {l.sugestao.nome}</div>}
                  </div>
                  <SeletorCurso cursos={cursos} valor={v} filtro={filtro} onChange={(id) => setMudou({ ...mudou, [l.chave]: id })} />
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Acessos ─────────────────────────────────────────────────────────────────

function AbaAcessos() {
  const [status, setStatus] = useState('')
  const [lista, setLista] = useState<Acesso[] | null>(null)
  const [rodando, setRodando] = useState(false)
  const carregar = useCallback(async () => {
    try { setLista((await api.get<{ acessos: Acesso[] }>(`/admin/moodle/acessos${status ? `?status=${status}` : ''}`)).acessos) } catch (e) { toast(msg(e), 'danger'); setLista([]) }
  }, [status])
  useEffect(() => { carregar() }, [carregar])
  async function varrerAgora() {
    setRodando(true)
    try {
      const r = await api.post<{ avaliadas: number; liberadas: number; erros: number }>('/admin/moodle/varrer', {})
      toast(`${r.avaliadas} avaliada(s) · ${r.liberadas} liberada(s) · ${r.erros} com erro`, r.erros ? 'warning' : 'success')
      await carregar()
    } catch (e) { toast(msg(e), 'danger') } finally { setRodando(false) }
  }
  async function reenviar(a: Acesso) {
    try { await api.post(`/admin/moodle/inscricao/${a.registrationId}/liberar`, {}); toast('Liberado', 'success') } catch (e) { toast(msg(e), 'danger') }
    await carregar()
  }
  return (
    <div class="space-y-3">
      <Card class="p-3 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(valor(e))}>
          <option value="">Todos</option>
          {Object.entries(ROTULO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </Select>
        <Button variant="secondary" size="sm" onClick={varrerAgora} loading={rodando}><Play size={14} /> Conferir agora</Button>
        <Button variant="ghost" size="sm" onClick={carregar}><RefreshCw size={14} /> Atualizar</Button>
      </Card>
      {!lista ? <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Carregando…</div>
        : !lista.length ? <Card class="p-4 text-sm text-fg-muted">Nenhum acesso ainda.</Card>
        : (
          <Card class="p-0 overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-2 text-xs text-fg-muted"><tr>
                <th class="text-left px-3 py-2">Aluno</th><th class="text-left px-3 py-2">Curso no Moodle</th><th class="text-left px-3 py-2">Situação</th>
                <th class="text-left px-3 py-2">Liberado em</th><th class="px-3 py-2"></th>
              </tr></thead>
              <tbody class="divide-y divide-border">
                {lista.map((a) => (
                  <tr key={a.id}>
                    <td class="px-3 py-2"><a class="text-accent hover:underline" href={`/app/enrollment-portals/${a.portalId}/registrations/${a.registrationId}`}>{a.aluno || `Inscrição #${a.registrationId}`}</a>
                      <div class="text-2xs text-fg-muted">{a.codigo} · {a.portal}{a.username ? ` · usuário ${a.username}` : ''}</div></td>
                    <td class="px-3 py-2 text-fg">{a.cursoNome || '—'}</td>
                    <td class="px-3 py-2"><Badge tone={TOM[a.status] ?? 'neutral'}>{ROTULO[a.status] ?? a.status}</Badge>
                      {a.ultimoErro && <div class="text-2xs text-danger mt-1 max-w-xs">{a.ultimoErro}</div>}</td>
                    <td class="px-3 py-2 text-xs text-fg-muted">{dataBr(a.liberadoEm)}</td>
                    <td class="px-3 py-2 text-right">{(a.status === 'ERRO' || a.status === 'PENDENTE') && <Button size="sm" variant="ghost" onClick={() => reenviar(a)}><Repeat size={13} /> Reenviar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
    </div>
  )
}

// ── Cartão na ficha da inscrição ────────────────────────────────────────────

interface EstadoInscricao {
  habilitada: boolean; automatico: boolean; urlCurso: string | null
  acesso: (Acesso & { cursoEscolhido: boolean }) | null; aptidao: Aptidao | null
}

export function MoodleInscricaoCard({ registrationId }: { registrationId: number }) {
  const [estado, setEstado] = useState<EstadoInscricao | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [vendo, setVendo] = useState<'checklist' | 'curso' | 'progresso' | null>(null)
  const [cursos, setCursos] = useState<Curso[]>([])
  const [filtro, setFiltro] = useState('')
  const [novoCurso, setNovoCurso] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    try { setEstado(await api.get<EstadoInscricao>(`/admin/moodle/inscricao/${registrationId}`)) } catch { setEstado(null) }
  }, [registrationId])
  useEffect(() => { carregar() }, [carregar])
  if (!estado?.habilitada) return null
  const a = estado.acesso
  const apt = estado.aptidao
  const st = a?.status ?? 'PENDENTE'
  const liberado = st === 'LIBERADO'
  const suspenso = st === 'SUSPENSO'

  async function acao(caminho: string, corpo: Record<string, unknown> = {}, ok = 'Feito') {
    setOcupado(true)
    try { await api.post(`/admin/moodle/inscricao/${registrationId}/${caminho}`, corpo); toast(ok, 'success'); setVendo(null); await carregar() }
    catch (e) { toast(msg(e), 'danger'); await carregar() } finally { setOcupado(false) }
  }
  async function abrirTroca() {
    setVendo('curso'); setNovoCurso(a?.moodleCourseId ?? apt?.courseId ?? null)
    try { setCursos((await api.get<{ cursos: Curso[] }>('/admin/moodle/cursos')).cursos) } catch (e) { toast(msg(e), 'danger') }
  }
  function liberarAgora() {
    if (apt && !apt.apta) {
      const falta = apt.itens.filter((i) => !i.ok && i.regra).map((i) => i.texto.toLowerCase()).join(' e ')
      if (!confirm(`Esta inscrição ainda não tem ${falta}. Liberar o acesso mesmo assim? Fica registrado no histórico que você liberou.`)) return
      return acao('liberar', { forcar: true }, 'Acesso liberado no Moodle')
    }
    return acao('liberar', {}, 'Acesso liberado no Moodle')
  }

  return (
    <Card class="p-4 space-y-2">
      <div class="flex items-center gap-2">
        <BookOpen size={15} class="text-accent" />
        <span class="text-sm font-semibold text-fg flex-1">Moodle (AVA)</span>
        <Badge tone={TOM[st] ?? 'neutral'}>{a ? ROTULO[st] ?? st : 'Não liberado'}</Badge>
      </div>
      {(a?.cursoNome || apt?.cursoNome) && <div class="text-xs text-fg">Curso: <b>{a?.cursoNome || apt?.cursoNome}</b>{a?.cursoEscolhido ? ' (escolhido pelo agente)' : ''}</div>}
      {a?.username && <div class="text-xs text-fg-muted">Usuário no Moodle: <b class="text-fg">{a.username}</b>{a.liberadoEm ? ` · liberado em ${dataBr(a.liberadoEm)}` : ''}</div>}
      {a?.ultimoErro && st !== 'LIBERADO' && <div class="text-xs text-danger">{a.ultimoErro}</div>}
      {(liberado || suspenso) && <ProgressoNoCartao registrationId={registrationId} aoAbrir={() => setVendo('progresso')} />}
      {!liberado && !suspenso && apt && (
        apt.apta
          ? <div class="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={13} /> Pago e com contrato aceito{estado.automatico ? ': libera sozinho em até 2 minutos' : ''}</div>
          : <div class="flex items-center gap-1.5 text-xs text-fg-muted"><XCircle size={13} class="text-danger" /> Ainda não libera: {apt.itens.filter((i) => !i.ok).length} pendência(s)</div>
      )}
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setVendo('checklist')}><ListChecks size={14} /> Checklist</Button>
        {!liberado && !suspenso && <Button size="sm" onClick={liberarAgora} loading={ocupado} disabled={!apt?.liberavel || !apt?.courseId}
          title={!apt?.courseId ? 'Defina o curso do Moodle (de-para ou Trocar curso)' : undefined}><Play size={14} /> Liberar agora</Button>}
        <Button variant="ghost" size="sm" onClick={abrirTroca}><Repeat size={14} /> {a?.moodleCourseId || apt?.courseId ? 'Trocar curso' : 'Escolher curso'}</Button>
        {liberado && <Button variant="ghost" size="sm" loading={ocupado} onClick={() => { if (confirm('Suspender o acesso deste aluno ao curso no Moodle?')) acao('suspender', {}, 'Acesso suspenso') }}><Pause size={14} /> Suspender</Button>}
        {suspenso && <Button size="sm" loading={ocupado} onClick={() => acao('reativar', {}, 'Acesso reativado')}><Play size={14} /> Reativar</Button>}
        {estado.urlCurso && <a class="inline-flex items-center gap-1 text-xs text-accent hover:underline" href={estado.urlCurso} target="_blank" rel="noopener"><ExternalLink size={13} /> Abrir no Moodle</a>}
      </div>
      {vendo === 'progresso' && (
        <Modal open onOpenChange={(o) => { if (!o) setVendo(null) }} title="Andamento no Moodle" size="lg">
          <ProgressoAvaPainel registrationId={registrationId} />
        </Modal>
      )}
      {vendo === 'checklist' && apt && (
        <Modal open onOpenChange={(o) => { if (!o) setVendo(null) }} title="Liberação no Moodle" size="md">
          <ul class="space-y-1.5 text-sm">
            {apt.itens.map((i, k) => (
              <li key={k} class="flex items-start gap-2">
                {i.ok ? <CheckCircle2 size={15} class="text-success mt-0.5" /> : <XCircle size={15} class="text-danger mt-0.5" />}
                <span class="text-fg">{i.texto}{i.regra && !i.ok ? <span class="text-2xs text-fg-muted"> (o agente pode liberar mesmo assim)</span> : null}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {vendo === 'curso' && (
        <Modal open onOpenChange={(o) => { if (!o) setVendo(null) }} title="Curso no Moodle" size="lg">
          <div class="space-y-3">
            <Input value={filtro} placeholder="Filtrar (ex.: Competência, ITECC)" onInput={(e) => setFiltro(valor(e))} />
            {cursos.length ? <SeletorCurso cursos={cursos} valor={novoCurso} filtro={filtro} onChange={setNovoCurso} />
              : <div class="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} class="animate-spin" /> Carregando cursos…</div>}
            {(liberado || suspenso) && <div class="text-xs text-fg-muted">O aluno é inscrito no curso novo e o acesso ao curso atual fica suspenso.</div>}
            <Button onClick={() => novoCurso && acao('curso', { courseId: novoCurso }, 'Curso definido')} loading={ocupado} disabled={!novoCurso}><Save size={14} /> Salvar curso</Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

function ProgressoNoCartao({ registrationId, aoAbrir }: { registrationId: number; aoAbrir: () => void }) {
  const q = useProgressoAva(registrationId, true)
  if (q.isLoading) return <div class="flex items-center gap-2 text-2xs text-fg-muted"><Loader2 size={12} class="animate-spin" /> Lendo o andamento no Moodle…</div>
  if (q.isError || !q.data) return null
  return (
    <button type="button" class="block w-full text-left rounded-md border border-border p-2 hover:bg-surface-2" onClick={aoAbrir} title="Ver progresso, avaliações e requisitos de conclusão">
      <ResumoDoProgresso p={q.data} />
      <span class="text-2xs text-accent">Ver andamento completo →</span>
    </button>
  )
}
