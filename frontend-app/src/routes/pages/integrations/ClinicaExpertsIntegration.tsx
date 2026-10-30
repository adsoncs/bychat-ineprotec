// Painel da integração com a Clinica Experts (Configurações → Integrações).
//
// A tela existe para responder três perguntas na ordem em que elas aparecem:
//   1. a ligação com a clínica funciona?  → token + botão Testar
//   2. qual profissional atende cada tipo de agendamento? → o de-para
//   3. está funcionando de verdade?  → contadores + reimportar agora
//
// Endpoints (backend routes/clinicaExperts.ts):
//   GET|PUT /admin/clinica-experts/config · POST .../testar
//   GET .../profissionais · .../procedimentos · .../tipos · .../status
//   POST .../importar-ocupacao · GET .../webhook-url

import { useState, useEffect, useCallback } from 'preact/hooks'
import {
  Stethoscope, Save, Eye, EyeOff, RefreshCw, CheckCircle2, AlertTriangle,
  Loader2, Copy, CalendarClock,
} from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'

interface Config {
  token: string
  ativo: boolean
  profissionalPorTipo: Record<string, string>
  profissionalPorUsuario: Record<string, string>
  linhas: Record<string, Linha>
  procedimentoPadraoId: number | null
  salaPadraoId: number | null
  importarOcupacao: boolean
  diasDeOcupacao: number
  tokenConfigurado: boolean
}

interface Profissional { uuid: string; nome: string; email: string | null }
interface Procedimento { id: number; nome: string; duracao: number | null }
interface Tipo { id: number; name: string; durationMin: number; ownerUserId: number | null }
interface Status { agendamentosEspelhados: number; pacientesLigados: number; horariosBloqueados: number }
interface Usuario { id: number; name: string; email: string; role: string }
interface Linha { procedimentos: number[]; usuarios: number[]; deixarEscolherProfissional: boolean }

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ClinicaExpertsIntegration() {
  const [carregando, setCarregando] = useState(true)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [token, setToken] = useState('')
  const [mostrarToken, setMostrarToken] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [profissionais, setProfissionais] = useState<Profissional[]>([])
  const [procedimentos, setProcedimentos] = useState<Procedimento[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [urlWebhook, setUrlWebhook] = useState('')
  const [erroListas, setErroListas] = useState('')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [tipoAberto, setTipoAberto] = useState<number | null>(null)
  const [buscaProc, setBuscaProc] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<{ config: Config }>('/admin/clinica-experts/config')
      setCfg(r.config)
      const t = await api.get<{ itens: Tipo[] }>('/admin/clinica-experts/tipos')
      setTipos(t.itens ?? [])
      const s = await api.get<Status>('/admin/clinica-experts/status')
      setStatus(s)
      const us = await api.get<{ itens: Usuario[] }>('/admin/clinica-experts/usuarios')
      setUsuarios(us.itens ?? [])
      // Listas da clínica só existem com token válido — falham em silêncio até lá.
      if (r.config.tokenConfigurado) void carregarListas()
    } catch (e) {
      toast(`Não consegui ler a configuração: ${msg(e)}`, 'danger')
    } finally {
      setCarregando(false)
    }
  }, [])

  const carregarListas = useCallback(async () => {
    try {
      const [p, pr, w] = await Promise.all([
        api.get<{ ok: boolean; itens: Profissional[]; erro?: string }>('/admin/clinica-experts/profissionais'),
        api.get<{ ok: boolean; itens: Procedimento[]; erro?: string }>('/admin/clinica-experts/procedimentos'),
        api.get<{ url: string }>('/admin/clinica-experts/webhook-url').catch(() => ({ url: '' })),
      ])
      setProfissionais(p.itens ?? [])
      setProcedimentos(pr.itens ?? [])
      setUrlWebhook(w.url ?? '')
      setErroListas(p.ok ? '' : (p.erro ?? ''))
    } catch (e) {
      setErroListas(msg(e))
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  async function salvar(parcial: Partial<Config>) {
    if (!cfg) return
    setSalvando(true)
    try {
      const corpo: Record<string, unknown> = { ...parcial }
      // Token só viaja quando o operador digitou um novo.
      if (token.trim()) corpo.token = token.trim()
      const r = await api.put<{ config: Config }>('/admin/clinica-experts/config', corpo)
      setCfg(r.config)
      setToken('')
      toast('Configuração salva', 'success')
      if (r.config.tokenConfigurado) void carregarListas()
    } catch (e) {
      toast(`Não salvou: ${msg(e)}`, 'danger')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    try {
      const r = await api.post<{ ok: boolean; mensagem?: string; erro?: string }>('/admin/clinica-experts/testar', {})
      if (r.ok) { toast(r.mensagem ?? 'Conexão certa', 'success'); void carregarListas() }
      else toast(r.erro ?? 'Falhou', 'danger')
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setTestando(false)
    }
  }

  async function reimportar() {
    setImportando(true)
    try {
      const r = await api.post<{ ok: boolean; importados: number; removidos: number; erro?: string }>('/admin/clinica-experts/importar-ocupacao', {})
      if (r.ok) toast(`${r.importados} horário(s) da clínica bloqueados aqui`, 'success')
      else toast(r.erro ?? 'Não importou', 'danger')
      const s = await api.get<Status>('/admin/clinica-experts/status')
      setStatus(s)
      const us = await api.get<{ itens: Usuario[] }>('/admin/clinica-experts/usuarios')
      setUsuarios(us.itens ?? [])
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setImportando(false)
    }
  }

  function definirPessoa(usuarioId: number, uuid: string) {
    if (!cfg) return
    const mapa = { ...cfg.profissionalPorUsuario }
    if (uuid) mapa[String(usuarioId)] = uuid
    else delete mapa[String(usuarioId)]
    setCfg({ ...cfg, profissionalPorUsuario: mapa })
  }

  function linhaDe(tipoId: number): Linha {
    return cfg?.linhas?.[String(tipoId)] ?? { procedimentos: [], usuarios: [], deixarEscolherProfissional: true }
  }

  function mudarLinha(tipoId: number, parcial: Partial<Linha>) {
    if (!cfg) return
    setCfg({ ...cfg, linhas: { ...cfg.linhas, [String(tipoId)]: { ...linhaDe(tipoId), ...parcial } } })
  }

  function alternar<T>(lista: T[], item: T): T[] {
    return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]
  }

  function definirProfissional(tipoId: number, uuid: string) {
    if (!cfg) return
    const mapa = { ...cfg.profissionalPorTipo }
    if (uuid) mapa[String(tipoId)] = uuid
    else delete mapa[String(tipoId)]
    setCfg({ ...cfg, profissionalPorTipo: mapa })
  }

  if (carregando) {
    return <div class="flex items-center gap-2 p-6 text-fg-muted"><Loader2 size={16} class="animate-spin" /> Carregando…</div>
  }
  if (!cfg) return null

  const semDono = tipos.filter((t) => cfg.profissionalPorTipo[String(t.id)] && !t.ownerUserId)

  return (
    <div class="space-y-4">
      {/* ── Conexão ── */}
      <Card class="p-4 space-y-3">
        <div class="flex items-center gap-2">
          <Stethoscope size={18} class="text-info" />
          <h3 class="font-medium">Conexão</h3>
          {cfg.tokenConfigurado
            ? <Badge tone={cfg.ativo ? 'success' : 'neutral'}>{cfg.ativo ? 'Ativa' : 'Configurada, desligada'}</Badge>
            : <Badge tone="neutral">Sem token</Badge>}
        </div>

        <div class="space-y-1">
          <label class="text-sm text-fg-muted">
            Token da API <span class="text-xs">(gerado na Clinica Experts, em Configurações → Integrações)</span>
          </label>
          <div class="flex gap-2">
            <Input
              type={mostrarToken ? 'text' : 'password'}
              value={token}
              onInput={(e: any) => setToken(e.currentTarget.value)}
              placeholder={cfg.tokenConfigurado ? cfg.token : 'Cole o token aqui'}
              class="flex-1"
            />
            <Button variant="ghost" onClick={() => setMostrarToken((v) => !v)} title={mostrarToken ? 'Esconder' : 'Mostrar'}>
              {mostrarToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          <p class="text-xs text-fg-subtle">Salvar sem digitar nada mantém o token atual.</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button onClick={() => salvar({})} disabled={salvando}>
            {salvando ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
          </Button>
          <Button variant="secondary" onClick={testar} disabled={testando || !cfg.tokenConfigurado}>
            {testando ? <Loader2 size={14} class="animate-spin" /> : <CheckCircle2 size={14} />} Testar conexão
          </Button>
          <label class="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cfg.ativo}
              onChange={(e: any) => salvar({ ativo: e.currentTarget.checked })}
              disabled={!cfg.tokenConfigurado}
            />
            Espelhar os agendamentos na clínica
          </label>
        </div>

        {erroListas && (
          <div class="flex items-start gap-2 rounded-md border-l-2 border-danger bg-danger/10 p-2 text-sm text-danger">
            <AlertTriangle size={14} class="mt-0.5 shrink-0" />
            <span>A clínica recusou a consulta: {erroListas}</span>
          </div>
        )}
      </Card>

      {/* ── De-para ── */}
      <Card class="p-4 space-y-3">
        <h3 class="font-medium">Qual profissional atende cada agendamento</h3>
        <p class="text-sm text-fg-muted">
          Sem isso o agendamento não tem para quem ir na clínica — e a agenda de lá não é lida para bloquear horário aqui.
        </p>

        {tipos.length === 0 && <p class="text-sm text-fg-subtle">Nenhum tipo de agendamento ativo.</p>}

        <div class="space-y-2">
          {tipos.map((t) => (
            <div key={t.id} class="flex flex-wrap items-center gap-2">
              <div class="min-w-48 flex-1">
                <div class="text-sm">{t.name}</div>
                <div class="text-xs text-fg-subtle">{t.durationMin} min</div>
              </div>
              <select
                class="min-w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                value={cfg.profissionalPorTipo[String(t.id)] ?? ''}
                onChange={(e: any) => definirProfissional(t.id, e.currentTarget.value)}
              >
                <option value="">— não espelhar —</option>
                {profissionais.map((p) => <option key={p.uuid} value={p.uuid}>{p.nome}</option>)}
              </select>
            </div>
          ))}
        </div>

        {semDono.length > 0 && (
          <div class="flex items-start gap-2 rounded-md border-l-2 border-warning bg-warning/10 p-2 text-sm">
            <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
            <span>
              {semDono.map((t) => `"${t.name}"`).join(', ')} {semDono.length > 1 ? 'não têm' : 'não tem'} operador
              responsável. O espelho funciona, mas a agenda da clínica não vai bloquear horário aqui — defina o responsável
              em Agendamento → Tipos.
            </span>
          </div>
        )}

        <div class="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <label class="text-sm text-fg-muted">Procedimento padrão</label>
          <select
            class="min-w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            value={cfg.procedimentoPadraoId ?? ''}
            onChange={(e: any) => setCfg({ ...cfg, procedimentoPadraoId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
          >
            <option value="">— nenhum —</option>
            {procedimentos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}{p.duracao ? ` (${p.duracao} min)` : ''}</option>
            ))}
          </select>
          <Button onClick={() => salvar({ profissionalPorTipo: cfg.profissionalPorTipo, procedimentoPadraoId: cfg.procedimentoPadraoId })} disabled={salvando}>
            {salvando ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
          </Button>
        </div>
      </Card>

      {/* ── Quem é quem ── */}
      <Card class="p-4 space-y-3">
        <h3 class="font-medium">Quem é quem</h3>
        <p class="text-sm text-fg-muted">
          Ligue cada pessoa da equipe ao profissional dela na clínica. É isso que permite o paciente escolher com quem
          se atender: a agenda mostrada é a daqui, e o agendamento é criado no nome do profissional de lá.
        </p>

        <div class="space-y-2">
          {usuarios.map((u) => (
            <div key={u.id} class="flex flex-wrap items-center gap-2">
              <div class="min-w-48 flex-1">
                <div class="text-sm">{u.name}</div>
                <div class="text-xs text-fg-subtle">{u.email}</div>
              </div>
              <select
                class="min-w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                value={cfg.profissionalPorUsuario?.[String(u.id)] ?? ''}
                onChange={(e: any) => definirPessoa(u.id, e.currentTarget.value)}
              >
                <option value="">— não atende na clínica —</option>
                {profissionais.map((p) => <option key={p.uuid} value={p.uuid}>{p.nome}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div class="border-t border-border pt-3">
          <Button onClick={() => salvar({ profissionalPorUsuario: cfg.profissionalPorUsuario })} disabled={salvando}>
            {salvando ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
          </Button>
        </div>
      </Card>

      {/* ── Linhas de serviço ── */}
      <Card class="p-4 space-y-3">
        <h3 class="font-medium">O que cada agendamento oferece</h3>
        <p class="text-sm text-fg-muted">
          Escolha os procedimentos e quem atende. Assim o paciente passa a escolher o que quer fazer e com quem, antes
          do horário — e a duração vem do procedimento, não do tipo. Deixar em branco mantém o agendamento como é hoje.
        </p>

        {tipos.map((tipo) => {
          const linha = linhaDe(tipo.id)
          const aberto = tipoAberto === tipo.id
          const filtrados = buscaProc.trim()
            ? procedimentos.filter((p) => p.nome.toLowerCase().includes(buscaProc.trim().toLowerCase()))
            : procedimentos
          const ligados = usuarios.filter((u) => !!cfg.profissionalPorUsuario?.[String(u.id)])
          return (
            <div key={tipo.id} class="rounded-md border border-border">
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => { setTipoAberto(aberto ? null : tipo.id); setBuscaProc('') }}
              >
                <span class="flex-1 text-sm font-medium">{tipo.name}</span>
                <span class="text-xs text-fg-subtle">
                  {linha.procedimentos.length
                    ? `${linha.procedimentos.length} procedimento(s) · ${linha.usuarios.length} pessoa(s)`
                    : 'sem procedimentos'}
                </span>
                <span class="text-fg-subtle">{aberto ? '−' : '+'}</span>
              </button>

              {aberto && (
                <div class="space-y-3 border-t border-border p-3">
                  <div>
                    <div class="mb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">Quem atende</div>
                    {ligados.length === 0
                      ? <p class="text-sm text-fg-subtle">Ligue as pessoas aos profissionais da clínica no bloco acima.</p>
                      : (
                        <div class="flex flex-wrap gap-2">
                          {ligados.map((u) => (
                            <label key={u.id} class="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
                              <input
                                type="checkbox"
                                checked={linha.usuarios.includes(u.id)}
                                onChange={() => mudarLinha(tipo.id, { usuarios: alternar(linha.usuarios, u.id) })}
                              />
                              {u.name}
                            </label>
                          ))}
                        </div>
                      )}
                  </div>

                  <label class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={linha.deixarEscolherProfissional !== false}
                      onChange={(e: any) => mudarLinha(tipo.id, { deixarEscolherProfissional: e.currentTarget.checked })}
                    />
                    O paciente escolhe com quem se atender
                  </label>

                  <div>
                    <div class="mb-1 flex items-center gap-2">
                      <span class="text-xs font-medium uppercase tracking-wide text-fg-subtle">Procedimentos</span>
                      <span class="text-xs text-fg-subtle">{linha.procedimentos.length} escolhido(s)</span>
                    </div>
                    <Input
                      value={buscaProc}
                      onInput={(e: any) => setBuscaProc(e.currentTarget.value)}
                      placeholder="Buscar procedimento…"
                      class="mb-2"
                    />
                    <div class="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-2">
                      {filtrados.length === 0 && <p class="text-sm text-fg-subtle">Nenhum procedimento encontrado.</p>}
                      {filtrados.map((p) => (
                        <label key={p.id} class="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={linha.procedimentos.includes(p.id)}
                            onChange={() => mudarLinha(tipo.id, { procedimentos: alternar(linha.procedimentos, p.id) })}
                          />
                          <span class="flex-1">{p.nome}</span>
                          {p.duracao ? <span class="text-xs text-fg-subtle">{p.duracao} min</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button onClick={() => salvar({ linhas: cfg.linhas })} disabled={salvando}>
                    {salvando ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {/* ── Agenda da clínica ── */}
      <Card class="p-4 space-y-3">
        <div class="flex items-center gap-2">
          <CalendarClock size={18} class="text-info" />
          <h3 class="font-medium">Agenda da clínica</h3>
        </div>
        <p class="text-sm text-fg-muted">
          O que a recepção marca direto na Clinica Experts vira bloqueio aqui, para o agendamento não oferecer um horário
          que já está ocupado lá. A leitura é automática a cada 15 minutos.
        </p>

        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cfg.importarOcupacao}
              onChange={(e: any) => salvar({ importarOcupacao: e.currentTarget.checked })}
            />
            Trazer a ocupação da clínica
          </label>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            Janela
            <Input
              type="number"
              min={1}
              max={180}
              value={String(cfg.diasDeOcupacao)}
              onInput={(e: any) => setCfg({ ...cfg, diasDeOcupacao: Number(e.currentTarget.value) })}
              onBlur={() => salvar({ diasDeOcupacao: cfg.diasDeOcupacao })}
              class="w-20"
            />
            dias
          </label>
          <Button variant="secondary" onClick={reimportar} disabled={importando || !cfg.ativo}>
            {importando ? <Loader2 size={14} class="animate-spin" /> : <RefreshCw size={14} />} Reimportar agora
          </Button>
        </div>

        {status && (
          <div class="grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
            <div>
              <div class="text-lg font-medium">{status.agendamentosEspelhados}</div>
              <div class="text-xs text-fg-subtle">agendamentos espelhados</div>
            </div>
            <div>
              <div class="text-lg font-medium">{status.pacientesLigados}</div>
              <div class="text-xs text-fg-subtle">pacientes ligados</div>
            </div>
            <div>
              <div class="text-lg font-medium">{status.horariosBloqueados}</div>
              <div class="text-xs text-fg-subtle">horários bloqueados aqui</div>
            </div>
          </div>
        )}
      </Card>

      {/* ── Webhook ── */}
      {urlWebhook && (
        <Card class="p-4 space-y-2">
          <h3 class="font-medium">Aviso instantâneo (opcional)</h3>
          <p class="text-sm text-fg-muted">
            Cole esta URL no painel da Clinica Experts, em Webhooks, e assine os eventos de agendamento. Com ela, o que
            muda lá chega aqui na hora, em vez de esperar os 15 minutos.
          </p>
          <div class="flex gap-2">
            <Input value={urlWebhook} readOnly class="flex-1 font-mono text-xs" />
            <Button
              variant="ghost"
              onClick={() => { void navigator.clipboard.writeText(urlWebhook); toast('URL copiada', 'success') }}
              title="Copiar"
            >
              <Copy size={16} />
            </Button>
          </div>
          <p class="text-xs text-fg-subtle">
            A URL contém um segredo — é ela que autentica o aviso, porque a Clinica Experts não assina o que envia.
            Trate como senha.
          </p>
        </Card>
      )}
    </div>
  )
}
