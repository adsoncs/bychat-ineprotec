// Painel da integração CRM Educacional / Wakeme
// (Configurações → Integrações → CRM Educacional).
//
// A integração é de MÃO ÚNICA: só traz leads de lá para cá; nada é escrito no
// CRM. Por isso a tela fala em "importação", não em "sincronização".
//
// Endpoints (backend routes/crmEduIntegration.ts):
//   GET  /admin/crmedu/config   POST /admin/crmedu/config
//   POST /admin/crmedu/test     POST /admin/crmedu/sync   GET /admin/crmedu/status

import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import {
  GraduationCap, Save, Eye, EyeOff, PlugZap, DownloadCloud, CheckCircle2,
  AlertTriangle, Loader2, Users, Info,
} from '@/components/ui/icon-set'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'

interface CrmEduConfig {
  baseUrl: string | null
  username: string | null
  senhaConfigurada: boolean
  enabled: boolean
  leadsImportados: number
  ultimaSincronizacao: string | null
  ultimaVerificacao: string | null
  ultimaPassadaProfunda: string | null
  pollMinutos: number
  inicioPadrao: string
}

interface Progresso {
  janelas: number; janelaAtual: number
  lidos: number; criados: number; atualizados: number; ignorados: number; erros: number
  de: string; ate: string
  iniciadoEm: string; concluidoEm?: string; ultimoErro?: string
}

interface StatusResp {
  emAndamento: boolean
  progresso: Progresso | null
  percentual?: number
}

interface TesteResp {
  ok: boolean
  leadsNaJanela: number
  comTelefone: number
  comEmail: number
  amostra: Array<{ nome: string | null; email: string | null; telefone: string | null; criadoEm: string | null }>
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function dataBr(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR')
}

export function CrmEducacionalIntegration() {
  const [loading, setLoading] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [senhaConfigurada, setSenhaConfigurada] = useState(false)
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [importados, setImportados] = useState(0)
  const [ultima, setUltima] = useState<string | null>(null)
  const [ultimaVerificacao, setUltimaVerificacao] = useState<string | null>(null)
  const [pollMin, setPollMin] = useState(10)
  const [inicioPadrao, setInicioPadrao] = useState('2025-02-01')

  const [de, setDe] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<TesteResp | null>(null)
  const [status, setStatus] = useState<StatusResp | null>(null)
  const pollRef = useRef<number | null>(null)

  const carregarConfig = useCallback(async () => {
    try {
      const c = await api.get<CrmEduConfig>('/admin/crmedu/config')
      setBaseUrl(c.baseUrl ?? '')
      setUsername(c.username ?? '')
      setSenhaConfigurada(c.senhaConfigurada)
      setEnabled(c.enabled)
      setImportados(c.leadsImportados)
      setUltima(c.ultimaSincronizacao)
      setUltimaVerificacao(c.ultimaVerificacao)
      setPollMin(c.pollMinutos ?? 10)
      setInicioPadrao(c.inicioPadrao)
      setDe((d) => d || c.inicioPadrao)
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setLoading(false)
    }
  }, [])

  const carregarStatus = useCallback(async () => {
    try {
      setStatus(await api.get<StatusResp>('/admin/crmedu/status'))
    } catch {
      /* silencioso — status é best-effort */
    }
  }, [])

  useEffect(() => {
    carregarConfig()
    carregarStatus()
  }, [carregarConfig, carregarStatus])

  // Enquanto a importação roda, acompanha de perto; ao terminar, para de pedir.
  useEffect(() => {
    if (status?.emAndamento) {
      if (pollRef.current === null) {
        pollRef.current = window.setInterval(() => { carregarStatus() }, 5000)
      }
    } else if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
      carregarConfig() // atualiza o total importado ao fim
    }
    return () => {
      if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [status?.emAndamento, carregarStatus, carregarConfig])

  async function salvar() {
    setSalvando(true)
    try {
      await api.post('/admin/crmedu/config', {
        baseUrl: baseUrl.trim(),
        username: username.trim(),
        ...(password ? { password } : {}),
        enabled,
      })
      setPassword('')
      toast('Configuração salva', 'success')
      await carregarConfig()
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    setTeste(null)
    try {
      const r = await api.post<TesteResp>('/admin/crmedu/test', {})
      setTeste(r)
      toast(`Conectado — ${r.leadsNaJanela} lead(s) nos últimos 2 dias`, 'success')
    } catch (e) {
      toast(msg(e), 'danger')
    } finally {
      setTestando(false)
    }
  }

  async function importar(forcar: boolean) {
    try {
      await api.post('/admin/crmedu/sync', { de: de || inicioPadrao, janelaDias: 15, forcar })
      toast(forcar ? 'Reprocessamento iniciado' : 'Importação iniciada', 'success')
      await carregarStatus()
    } catch (e) {
      toast(msg(e), 'danger')
    }
  }

  if (loading) {
    return <Card class="p-5"><div class="text-sm text-fg-muted">Carregando…</div></Card>
  }

  const p = status?.progresso
  const rodando = !!status?.emAndamento

  return (
    <div class="space-y-4">
      {/* ── Credenciais ── */}
      <Card class="p-5 space-y-4">
        <div class="flex items-center gap-2">
          <GraduationCap size={16} class="text-accent" />
          <span class="text-sm font-semibold text-fg">Conexão</span>
          <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Ativa' : 'Desativada'}</Badge>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <Input
            label="URL do CRM" value={baseUrl} placeholder="https://cliente.crmeducacional.com.br"
            onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
            hint="A mesma que a instituição usa no navegador — costuma ser .com.br"
          />
          <Input
            label="Usuário de integração" value={username} placeholder="userapi"
            onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
            hint="Usuário do tipo APICRMEducacional"
          />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <Input
                label="Senha" type={mostrarSenha ? 'text' : 'password'} value={password}
                placeholder={senhaConfigurada ? '•••••••• (salva)' : 'informe a senha'}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                {...(senhaConfigurada ? { hint: 'Deixe vazio para manter a atual' } : {})}
              />
            </div>
            <button
              type="button" title={mostrarSenha ? 'Ocultar' : 'Mostrar'}
              class="h-9 w-9 shrink-0 mb-[1.35rem] grid place-items-center rounded-md border border-border text-fg-muted hover:text-fg"
              onClick={() => setMostrarSenha((v) => !v)}
            >
              {mostrarSenha ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <label class="flex items-center gap-2 text-sm text-fg self-end mb-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)} />
            Integração ativa (importa sozinha 1× por dia)
          </label>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <Button variant="primary" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 size={14} class="animate-spin" /> : <Save size={14} />} Salvar
          </Button>
          <Button variant="ghost" onClick={testar} disabled={testando}>
            {testando ? <Loader2 size={14} class="animate-spin" /> : <PlugZap size={14} />} Testar conexão
          </Button>
        </div>

        {teste && (
          <div class="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-fg">
            <div class="flex items-center gap-1.5 font-medium">
              <CheckCircle2 size={13} class="text-success" />
              Conectado · {teste.leadsNaJanela} lead(s) nos últimos 2 dias · {teste.comTelefone} com telefone · {teste.comEmail} com e-mail
            </div>
            {teste.amostra.length > 0 && (
              <ul class="mt-1.5 space-y-0.5 text-fg-muted">
                {teste.amostra.map((a, i) => (
                  <li key={i}>· {a.nome || '(sem nome)'} — {a.telefone || 'sem telefone'} — {dataBr(a.criadoEm)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* ── Importação ── */}
      <Card class="p-5 space-y-4">
        <div class="flex items-center gap-2">
          <DownloadCloud size={16} class="text-accent" />
          <span class="text-sm font-semibold text-fg">Importação de leads</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div class="rounded-md border border-border bg-surface-2 p-3">
            <div class="text-lg font-semibold text-fg tabular-nums">{importados.toLocaleString('pt-BR')}</div>
            <div class="text-2xs text-fg-muted">Leads já importados</div>
          </div>
          <div class="rounded-md border border-border bg-surface-2 p-3">
            <div class="text-sm font-semibold text-fg">{dataBr(ultima)}</div>
            <div class="text-2xs text-fg-muted">Último lead gravado</div>
          </div>
          <div class="rounded-md border border-border bg-surface-2 p-3">
            <div class="text-sm font-semibold text-fg">{rodando ? 'Importando…' : dataBr(ultimaVerificacao)}</div>
            <div class="text-2xs text-fg-muted">Última verificação</div>
          </div>
        </div>

        {enabled && (
          <div class="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 size={13} />
            Poll ativo — verifica o CRM a cada {pollMin} minutos, com uma varredura mais larga por dia de madrugada.
          </div>
        )}

        <div class="flex items-end gap-2 flex-wrap">
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Importar desde</span>
            <input
              type="date" value={de}
              class="h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
              onInput={(e) => setDe((e.target as HTMLInputElement).value)}
            />
          </div>
          <Button variant="primary" onClick={() => importar(false)} disabled={rodando || !enabled}>
            <DownloadCloud size={14} /> Importar agora
          </Button>
          <Button variant="ghost" onClick={() => importar(true)} disabled={rodando || !enabled}
            title="Regrava todos os leads do período, mesmo sem alteração no CRM">
            <Users size={14} /> Reprocessar campos
          </Button>
        </div>

        {p && (
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs text-fg-muted">
              <span>Janela {p.janelaAtual} de {p.janelas} ({p.de} → {p.ate})</span>
              <span>{status?.percentual ?? 0}%</span>
            </div>
            <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div class="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${status?.percentual ?? 0}%` }} />
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              {([
                ['Lidos', p.lidos, 'text-fg'],
                ['Novos', p.criados, 'text-success'],
                ['Atualizados', p.atualizados, 'text-info'],
                ['Sem mudança', p.ignorados, 'text-fg-muted'],
                ['Erros', p.erros, p.erros > 0 ? 'text-danger' : 'text-fg-muted'],
              ] as Array<[string, number, string]>).map(([rot, val, cor]) => (
                <div key={rot} class="rounded-md border border-border bg-surface-2 p-2">
                  <div class={`text-sm font-semibold tabular-nums ${cor}`}>{val.toLocaleString('pt-BR')}</div>
                  <div class="text-3xs text-fg-muted">{rot}</div>
                </div>
              ))}
            </div>
            {p.ultimoErro && (
              <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-fg">
                <AlertTriangle size={13} class="text-danger shrink-0 mt-0.5" />
                <span class="break-all">{p.ultimoErro}</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── O que esta integração faz e não faz ── */}
      <Card class="p-4">
        <div class="flex items-start gap-2 text-xs text-fg-muted">
          <Info size={14} class="text-info shrink-0 mt-0.5" />
          <div class="space-y-1">
            <p><b class="text-fg">Mão única:</b> os dados só vêm do CRM Educacional para cá. Nada é criado ou alterado lá.</p>
            <p>
              <b class="text-fg">Só leads em "Potencial".</b> A API não expõe quem já se inscreveu ou matriculou —
              um lead que avança some da listagem sem aviso. Para receber as inscrições, a CRM Educacional precisa
              configurar, no concurso, as "URL's Post Lead/Inscrição" apontando para este sistema.
            </p>
            <p>O consultor do CRM vira o responsável do lead aqui, cadastrado como operador.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
