// LegalSettings — dados do controlador (LGPD) exibidos nas páginas públicas
// /privacidade, /termos e /cookies (SSR em backend/src/routes/legal.ts).
// Cada tenant é controlador dos seus titulares → editável por instalação.
// Os campos *_html são opcionais: vazios = usa o texto-modelo embutido.

import { useEffect, useState } from 'preact/hooks'
import { Scale, ExternalLink, Inbox, AlertTriangle, Mic, ShieldCheck } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import {
  useLegalSettings, useUpdateLegalSettings, type LegalConfig,
  useDsarRequests, useUpdateDsar, useDeleteDsarLead, type DsarRequest,
  useMeetingsRecordingConfig, useUpdateMeetingsRecordingConfig,
} from '@/hooks/useSettings'

const DSAR_TYPE_LABEL: Record<string, string> = {
  access: 'Acesso', correction: 'Correção', deletion: 'Eliminação',
  portability: 'Portabilidade', revocation: 'Revogação',
}
const DSAR_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', in_progress: 'Em andamento', done: 'Concluída', rejected: 'Rejeitada',
}
const DSAR_STATUS_CLASS: Record<string, string> = {
  pending: 'bg-warning-soft text-warning', in_progress: 'bg-info-soft text-info',
  done: 'bg-success-soft text-success', rejected: 'bg-surface-2 text-fg-muted',
}

function DsarInbox() {
  const [filter, setFilter] = useState('open')
  const statusParam = filter === 'open' ? '' : filter
  const { data, isLoading } = useDsarRequests(statusParam)
  const update = useUpdateDsar()
  const del = useDeleteDsarLead()

  // 'open' = client-side filter dos não concluídos quando status vazio.
  const rows = (data?.requests || []).filter((r) =>
    filter === 'open' ? r.status === 'pending' || r.status === 'in_progress' : true,
  )

  function setStatus(r: DsarRequest, status: string) {
    update.mutate({ id: r.id, status }, {
      onSuccess: () => toast(`Requisição #${r.id} → ${DSAR_STATUS_LABEL[status]}`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function deleteLead(r: DsarRequest) {
    if (!confirm(`Eliminar definitivamente os dados do lead #${r.leadId}? Vai para a lixeira (restaurável por 90 dias) e a requisição será concluída.`)) return
    del.mutate({ id: r.id }, {
      onSuccess: () => toast('Dados enviados à lixeira e requisição concluída', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const overdue = data?.counts.overdue || 0
  const now = Date.now()

  return (
    <Card>
      <div class="flex items-start gap-3 mb-4">
        <Inbox size={18} class="text-info shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-fg">Requisições de titulares (art. 18)</div>
          <p class="text-xs text-fg-muted mt-0.5">
            Pedidos recebidos pelo portal <a class="text-info hover:underline" href="/meus-dados" target="_blank" rel="noopener">/meus-dados</a>.
            Prazo legal de atendimento: <strong>15 dias</strong>.
            {data ? <> · {data.counts.pending} em aberto{overdue > 0 ? <span class="text-danger font-medium"> · {overdue} em atraso</span> : null}</> : null}
          </p>
        </div>
        <Select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)} class="w-40 shrink-0">
          <option value="open">Em aberto</option>
          <option value="pending">Pendentes</option>
          <option value="in_progress">Em andamento</option>
          <option value="done">Concluídas</option>
          <option value="rejected">Rejeitadas</option>
          <option value="all">Todas</option>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton class="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p class="text-sm text-fg-muted py-6 text-center">Nenhuma requisição{filter === 'open' ? ' em aberto' : ''}.</p>
      ) : (
        <div class="flex flex-col gap-3">
          {rows.map((r) => {
            const isOverdue = ['pending', 'in_progress'].includes(r.status) && new Date(r.dueAt).getTime() < now
            return (
              <div key={r.id} class="border border-border rounded-lg p-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-2">{DSAR_TYPE_LABEL[r.type] || r.type}</span>
                  <span class={`text-xs px-2 py-0.5 rounded-full ${DSAR_STATUS_CLASS[r.status] || 'bg-surface-2'}`}>{DSAR_STATUS_LABEL[r.status]}</span>
                  <span class="text-sm font-medium text-fg">{r.name || '(sem nome)'} {r.leadId ? <span class="text-fg-muted font-normal">· lead #{r.leadId}</span> : null}</span>
                  {isOverdue ? <span class="inline-flex items-center gap-1 text-xs text-danger font-medium"><AlertTriangle size={12} /> em atraso</span> : null}
                </div>
                <div class="text-xs text-fg-muted mt-1">
                  {r.email || '—'} · {r.whatsapp || '—'} · prazo {new Date(r.dueAt).toLocaleDateString('pt-BR')}
                </div>
                {r.details?.message ? <div class="text-sm text-fg mt-2 bg-surface-2 rounded p-2">{r.details.message}</div> : null}
                {r.response ? <div class="text-xs text-fg-muted mt-2">Resposta: {r.response}</div> : null}
                {['pending', 'in_progress'].includes(r.status) ? (
                  <div class="flex flex-wrap gap-2 mt-3">
                    {r.status === 'pending' ? <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'in_progress')} disabled={update.isPending}>Em andamento</Button> : null}
                    <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'done')} disabled={update.isPending}>Concluir</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'rejected')} disabled={update.isPending}>Rejeitar</Button>
                    {r.type === 'deletion' && r.leadId ? <Button size="sm" variant="danger" onClick={() => deleteLead(r)} disabled={del.isPending}>Excluir dados (lixeira)</Button> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// Card do opt-in de GRAVAÇÃO de reuniões (módulo Reuniões/Transcrição — F0.2).
// Portão de consentimento LGPD: ligar exige aceite explícito de responsabilidade.
function MeetingsRecordingCard() {
  const { data, isLoading } = useMeetingsRecordingConfig()
  const update = useUpdateMeetingsRecordingConfig()
  const [enabled, setEnabled] = useState(false)
  const [noticeText, setNoticeText] = useState('')
  const [retentionDays, setRetentionDays] = useState(90)
  const [accept, setAccept] = useState(false)

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled)
      setNoticeText(data.noticeText)
      setRetentionDays(data.retentionDays)
      setAccept(false)
    }
  }, [data])

  if (isLoading) return <Card><Skeleton class="h-48 w-full" /></Card>

  const turningOn = enabled && !data?.enabled
  const dirty = !!data && (
    enabled !== data.enabled ||
    noticeText !== data.noticeText ||
    retentionDays !== data.retentionDays
  )
  const blocked = turningOn && !accept

  function handleSave() {
    if (blocked) {
      toast('Marque o aceite de responsabilidade para ativar a gravação.', 'danger')
      return
    }
    update.mutate(
      { enabled, noticeText, retentionDays, legalAccepted: accept },
      {
        onSuccess: () => toast('Configuração de gravação de reuniões salva', 'success'),
        onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
      },
    )
  }

  return (
    <Card>
      <div class="flex items-start gap-3 mb-4">
        <Mic size={18} class="text-info shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <div class="text-sm font-semibold text-fg">Gravação e transcrição de reuniões</div>
            <span class={`text-xs px-2 py-0.5 rounded-full ${data?.enabled ? 'bg-success-soft text-success' : 'bg-surface-2 text-fg-muted'}`}>
              {data?.enabled ? 'ATIVA' : 'DESATIVADA'}
            </span>
          </div>
          <p class="text-xs text-fg-muted mt-0.5">
            O bot entra em reuniões (Meet/Teams/Zoom), grava e transcreve <strong>localmente no servidor</strong>{' '}
            (o áudio não é enviado a terceiros) e anexa ao lead. Gravar trata dado pessoal de <strong>todos</strong> os
            participantes — só ative com base legal e consentimento adequados.
          </p>
          {data?.enabled && data.legalAcceptedBy ? (
            <p class="text-xs text-fg-muted mt-1">
              Responsabilidade aceita por <strong>{data.legalAcceptedBy}</strong>
              {data.legalAcceptedAt ? <> em {new Date(data.legalAcceptedAt).toLocaleString('pt-BR')}</> : null}.
            </p>
          ) : null}
        </div>
      </div>

      <label class="flex items-center gap-2 cursor-pointer select-none mb-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          class="h-4 w-4"
        />
        <span class="text-sm text-fg">Ativar gravação de reuniões neste tenant</span>
      </label>

      {turningOn ? (
        <label class="flex items-start gap-2 cursor-pointer select-none mb-3 rounded-lg border border-warning/40 bg-warning-soft p-3">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept((e.target as HTMLInputElement).checked)}
            class="h-4 w-4 mt-0.5"
          />
          <span class="text-xs text-fg inline-flex flex-col gap-0.5">
            <span class="inline-flex items-center gap-1 font-semibold"><ShieldCheck size={13} /> Aceite de responsabilidade (LGPD)</span>
            Declaro que, como controlador, assumo a responsabilidade pela base legal e pelo
            consentimento informado dos participantes antes de gravar/transcrever reuniões.
          </span>
        </label>
      ) : null}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
        <div class="md:col-span-2">
          <Textarea
            label="Aviso de gravação (usado no convite/agendamento)"
            rows={3}
            value={noticeText}
            onInput={(e) => setNoticeText((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <Input
          label="Retenção (dias)"
          type="number"
          min={1}
          value={String(retentionDays)}
          hint="Após esse prazo, gravação e transcrição são apagadas."
          onInput={(e) => setRetentionDays(parseInt((e.target as HTMLInputElement).value, 10) || 90)}
        />
      </div>

      {dirty ? (
        <div class="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!data) return
              setEnabled(data.enabled); setNoticeText(data.noticeText)
              setRetentionDays(data.retentionDays); setAccept(false)
            }}
            disabled={update.isPending}
          >
            Descartar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending || blocked}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

const EMPTY: LegalConfig = {
  companyName: '', cnpj: '', dpoEmail: '', version: '1.0',
  privacyHtml: '', termsHtml: '', cookiesHtml: '',
}

export function LegalSettings() {
  const { data, isLoading } = useLegalSettings()
  const update = useUpdateLegalSettings()
  const [draft, setDraft] = useState<LegalConfig>(EMPTY)

  useEffect(() => {
    if (data) setDraft({ ...EMPTY, ...data })
  }, [data])

  const dirty = !!data && (Object.keys(EMPTY) as (keyof LegalConfig)[]).some(
    (k) => (draft[k] ?? '') !== (data[k] ?? ''),
  )

  function set<K extends keyof LegalConfig>(k: K, v: LegalConfig[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => toast('Dados legais (LGPD) salvos', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-96 w-full" />

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Scale size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Dados legais (LGPD)</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Aparecem nas páginas públicas{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/privacidade" target="_blank" rel="noopener">Política de Privacidade <ExternalLink size={11} /></a>,{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/termos" target="_blank" rel="noopener">Termos <ExternalLink size={11} /></a> e{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/cookies" target="_blank" rel="noopener">Cookies <ExternalLink size={11} /></a>,
              no rodapé e no banner de consentimento. Preencha com os dados da sua empresa.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Razão social"
            value={draft.companyName}
            placeholder="Minha Empresa LTDA"
            onInput={(e) => set('companyName', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="CNPJ"
            value={draft.cnpj}
            placeholder="00.000.000/0001-00"
            onInput={(e) => set('cnpj', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="E-mail do Encarregado (DPO)"
            type="email"
            value={draft.dpoEmail}
            hint="Canal público de atendimento ao titular (art. 41 LGPD)."
            placeholder="dpo@suaempresa.com.br"
            onInput={(e) => set('dpoEmail', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="Versão da política"
            value={draft.version}
            hint="Registrada em cada consentimento. Suba o número ao mudar os textos."
            placeholder="1.0"
            onInput={(e) => set('version', (e.target as HTMLInputElement).value)}
          />
        </div>
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Textos personalizados (opcional)</div>
        <p class="text-xs text-fg-muted mb-4">
          Deixe em branco para usar o modelo padrão da plataforma. Se preencher, o HTML substitui
          o corpo da página correspondente (o cabeçalho/rodapé com seus dados é mantido).
        </p>
        <div class="space-y-3">
          <Textarea
            label="HTML — Política de Privacidade"
            rows={5}
            value={draft.privacyHtml}
            placeholder="<h1>Política de Privacidade</h1> …"
            onInput={(e) => set('privacyHtml', (e.target as HTMLTextAreaElement).value)}
          />
          <Textarea
            label="HTML — Termos de Uso"
            rows={5}
            value={draft.termsHtml}
            placeholder="<h1>Termos de Uso</h1> …"
            onInput={(e) => set('termsHtml', (e.target as HTMLTextAreaElement).value)}
          />
          <Textarea
            label="HTML — Política de Cookies"
            rows={5}
            value={draft.cookiesHtml}
            placeholder="<h1>Política de Cookies</h1> …"
            onInput={(e) => set('cookiesHtml', (e.target as HTMLTextAreaElement).value)}
          />
        </div>
      </Card>

      {dirty && (
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => data && setDraft({ ...EMPTY, ...data })} disabled={update.isPending}>
            Descartar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      )}

      <MeetingsRecordingCard />

      <DsarInbox />
    </div>
  )
}
