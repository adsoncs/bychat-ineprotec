import { useState } from 'preact/hooks'
import { useQuery } from '@tanstack/react-query'
import { Download } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { LineChart } from '@/components/charts/LineChart'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { toast } from '@/lib/toast'

/**
 * Relatório de e-mail por período: todos os envios do painel (campanhas,
 * workflows, cadências, e-mails da equipe e avisos do sistema), com o que a
 * Resend devolveu. Espelha GET /api/email-campanhas/relatorio.
 */

interface Metricas { enviados: number; falhas: number; entregues: number; abertos: number; clicados: number; bounces: number; spam: number }
interface Relatorio {
  periodo: { de: string; ate: string }
  total: Metricas
  descadastros: number
  serie: Array<{ dia: string; enviados: number }>
  porOrigem: Array<Metricas & { origem: string }>
  porCampanha: Array<Metricas & { id: number; nome: string; status: string; modelo: string | null }>
  porModelo: Array<Metricas & { modelo: string; campanhas: number }>
}

const ORIGENS: Record<string, string> = {
  campanha: 'Campanhas', workflow: 'Workflows', cadence: 'Cadências', atividade: 'E-mails da equipe',
  system: 'Avisos do sistema', teste: 'Testes', manual: 'Envio manual',
  redefinicao_senha: 'Redefinição de senha',
}
const n = (v: number) => v.toLocaleString('pt-BR')
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toLocaleString('pt-BR')}%` : '—')
const diaBR = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)

function intervalo(preset: string): { de: string; ate: string } {
  const hoje = new Date()
  const ate = diaBR(hoje)
  if (preset === 'mes') return { de: `${ate.slice(0, 7)}-01`, ate }
  const dias = Number(preset) || 30
  return { de: diaBR(new Date(hoje.getTime() - (dias - 1) * 86400_000)), ate }
}

export function RelatoriosDeEmail({ onAbrirCampanha }: { onAbrirCampanha: (id: number) => void }) {
  const [preset, setPreset] = useState('30')
  const [manual, setManual] = useState(intervalo('30'))
  const [origem, setOrigem] = useState('')
  const { de, ate } = preset === 'custom' ? manual : intervalo(preset)
  const qs = `de=${de}&ate=${ate}${origem ? `&origem=${origem}` : ''}`
  const { data: r, isLoading } = useQuery({ queryKey: ['email-relatorio', qs], queryFn: () => api.get<Relatorio>(`/email-campanhas/relatorio?${qs}`) })

  async function exportar() {
    try {
      const token = localStorage.getItem(env.authTokenKey)
      const res = await fetch(`${env.apiBase}/email-campanhas/relatorio.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
      if (!res.ok) throw new Error('Não foi possível gerar o arquivo')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await res.blob())
      a.download = `email-relatorio-${de}-a-${ate}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  const t = r?.total
  return (
    <div class="grid gap-4">
      <div class="flex flex-wrap items-end gap-2">
        <Select label="Período" value={preset} onChange={(e) => setPreset((e.target as HTMLSelectElement).value)}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="mes">Este mês</option>
          <option value="custom">Escolher datas</option>
        </Select>
        {preset === 'custom' && (
          <>
            <Input label="De" type="date" value={manual.de} onInput={(e) => setManual((m) => ({ ...m, de: (e.target as HTMLInputElement).value }))} />
            <Input label="Até" type="date" value={manual.ate} onInput={(e) => setManual((m) => ({ ...m, ate: (e.target as HTMLInputElement).value }))} />
          </>
        )}
        <Select label="Origem" value={origem} onChange={(e) => setOrigem((e.target as HTMLSelectElement).value)}>
          <option value="">Todas</option>
          {Object.entries(ORIGENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <div class="ml-auto"><Button variant="secondary" size="sm" disabled={!r} onClick={() => void exportar()}><Download size={14} /> Exportar CSV</Button></div>
      </div>

      {isLoading || !r || !t ? <div class="text-sm text-fg-muted">Carregando…</div> : (
        <>
          <div class="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            <Kpi rotulo="Enviados" valor={n(t.enviados)} sub={t.falhas ? `${n(t.falhas)} falharam` : 'no período'} />
            <Kpi rotulo="Entrega" valor={pct(t.entregues, t.enviados)} sub={`${n(t.entregues)} entregues`} />
            <Kpi rotulo="Abertura" valor={pct(t.abertos, t.entregues)} sub={`${n(t.abertos)} dos entregues`} />
            <Kpi rotulo="Clique" valor={pct(t.clicados, t.entregues)} sub={`${n(t.clicados)} dos entregues`} />
            <Kpi rotulo="Devolvidos" valor={pct(t.bounces, t.enviados)} sub={`${n(t.bounces)} e-mails`} alerta={t.enviados >= 50 && t.bounces / t.enviados > 0.04} />
            <Kpi rotulo="Spam" valor={pct(t.spam, t.entregues)} sub={`${n(t.spam)} reclamações`} alerta={t.entregues >= 50 && t.spam / t.entregues > 0.001} />
            <Kpi rotulo="Descadastros" valor={n(r.descadastros)} sub="no período" />
          </div>
          <p class="text-2xs text-fg-muted -mt-2">
            Abertura é aproximada: alguns leitores (como o Apple Mail) abrem as imagens sozinhos e contam como abertura. Clique é mais confiável.
          </p>

          <Card>
            <h3 class="text-sm font-semibold">E-mails enviados por dia</h3>
            <p class="text-2xs text-fg-muted mb-2">{new Date(`${r.periodo.de}T12:00:00`).toLocaleDateString('pt-BR')} a {new Date(`${r.periodo.ate}T12:00:00`).toLocaleDateString('pt-BR')}</p>
            <LineChart data={r.serie.map((d) => ({ label: new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: d.enviados }))} />
          </Card>

          <Tabela titulo="Por origem" vazio="Nenhum e-mail no período."
            linhas={r.porOrigem.map((o) => ({ chave: o.origem, nome: ORIGENS[o.origem] ?? o.origem, m: o }))} />
          <Tabela titulo="Por campanha" vazio="Nenhuma campanha enviou neste período."
            linhas={r.porCampanha.map((c) => ({ chave: String(c.id), nome: c.nome, extra: c.modelo ?? '', m: c, onClick: () => onAbrirCampanha(c.id) }))} extraCab="Modelo" />
          <Tabela titulo="Por modelo de e-mail (campanhas)" vazio="Nenhuma campanha enviou neste período."
            linhas={r.porModelo.map((m) => ({ chave: m.modelo, nome: m.modelo, extra: `${m.campanhas} campanha(s)`, m }))} extraCab="Campanhas" />
        </>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, sub, alerta }: { rotulo: string; valor: string; sub: string; alerta?: boolean }) {
  return (
    <Card class={alerta ? 'border-danger/60' : ''}>
      <div class="text-2xs text-fg-muted">{rotulo}</div>
      <div class="text-xl font-semibold tabular-nums">{valor}</div>
      <div class={`text-2xs ${alerta ? 'text-danger' : 'text-fg-muted'}`}>{alerta ? 'acima do limite seguro · ' : ''}{sub}</div>
    </Card>
  )
}

function Tabela({ titulo, vazio, linhas, extraCab }: {
  titulo: string; vazio: string; extraCab?: string
  linhas: Array<{ chave: string; nome: string; extra?: string; m: Metricas; onClick?: () => void }>
}) {
  return (
    <Card>
      <h3 class="text-sm font-semibold mb-2">{titulo}</h3>
      {!linhas.length ? <div class="text-sm text-fg-muted">{vazio}</div> : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-fg-muted">
                <th class="py-1.5 pr-3 font-medium">Nome</th>
                {extraCab && <th class="py-1.5 pr-3 font-medium">{extraCab}</th>}
                <th class="py-1.5 pr-3 font-medium text-right">Enviados</th>
                <th class="py-1.5 pr-3 font-medium text-right">Entrega</th>
                <th class="py-1.5 pr-3 font-medium text-right">Abertura</th>
                <th class="py-1.5 pr-3 font-medium text-right">Clique</th>
                <th class="py-1.5 pr-3 font-medium text-right">Devolvidos</th>
                <th class="py-1.5 font-medium text-right">Spam</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} class={`border-t border-border ${l.onClick ? 'cursor-pointer hover:bg-surface-2' : ''}`} onClick={l.onClick}>
                  <td class="py-1.5 pr-3">{l.nome}</td>
                  {extraCab && <td class="py-1.5 pr-3 text-fg-muted">{l.extra}</td>}
                  <td class="py-1.5 pr-3 text-right tabular-nums">{n(l.m.enviados)}</td>
                  <td class="py-1.5 pr-3 text-right tabular-nums">{pct(l.m.entregues, l.m.enviados)}</td>
                  <td class="py-1.5 pr-3 text-right tabular-nums">{pct(l.m.abertos, l.m.entregues)}</td>
                  <td class="py-1.5 pr-3 text-right tabular-nums">{pct(l.m.clicados, l.m.entregues)}</td>
                  <td class="py-1.5 pr-3 text-right tabular-nums">{n(l.m.bounces)}</td>
                  <td class="py-1.5 text-right tabular-nums">{n(l.m.spam)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
