import { useState, useEffect } from 'preact/hooks'
import { Mic, ChevronDown, ChevronRight, FileText, Sparkles, StopCircle, ExternalLink, Users, ListVideo, Settings, Target, GraduationCap, SlidersHorizontal, Mail, MessageSquare, Search, BarChart3, Video, ClipboardCheck, Scissors, Radio, Upload, ShieldCheck } from 'lucide-preact'
import {
  useMeetingRecordings, useStopMeetingBot, type MeetingRecording,
  useMeetingSeats, useUpdateMeetingSeat, type MeetingSeat,
  usePlaybook, useUpdatePlaybook,
  useMeetingsSettings, useUpdateMeetingsSettings, type MeetingsSettings,
  useGenerateMeetingsReport, useMeetingSearch, useUploadPresencialMeeting,
  useMeetingLeadSearch, type MeetingLeadResult,
} from '@/hooks/useMeetings'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { AudioRecorder } from '@/components/AudioRecorder'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'success' | 'danger' | 'warning' | 'neutral'

function statusMeta(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'completed': return { label: 'Concluída', tone: 'success' }
    case 'active': return { label: 'Ao vivo', tone: 'info' }
    case 'joining': return { label: 'Entrando', tone: 'info' }
    case 'transcribing': return { label: 'Transcrevendo', tone: 'info' }
    case 'requested': return { label: 'Solicitada', tone: 'warning' }
    case 'failed': return { label: 'Falhou', tone: 'danger' }
    case 'stopped': return { label: 'Encerrada', tone: 'neutral' }
    default: return { label: status, tone: 'neutral' }
  }
}

const PLATFORM_LABEL: Record<string, string> = {
  google_meet: 'Google Meet', teams: 'Microsoft Teams', zoom: 'Zoom', presencial: 'Presencial',
}

function sentimentoMeta(s: string): { label: string; tone: Tone } {
  if (s === 'positivo') return { label: 'Positivo', tone: 'success' }
  if (s === 'negativo') return { label: 'Negativo', tone: 'danger' }
  return { label: 'Neutro', tone: 'neutral' }
}

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div class="text-xs font-semibold text-fg mb-1">{title}</div>
      <ul class="list-disc pl-4 space-y-0.5">
        {items.map((it, i) => <li key={i} class="text-sm text-fg-muted">{it}</li>)}
      </ul>
    </div>
  )
}

function RecordingCard({ rec }: { rec: MeetingRecording }) {
  const [open, setOpen] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const stop = useStopMeetingBot()
  const st = statusMeta(rec.status)
  const inFlight = ['requested', 'joining', 'active'].includes(rec.status)
  const a = rec.analysis

  return (
    <Card>
      <div class="flex items-start gap-3">
        <button type="button" class="mt-0.5 text-fg-muted hover:text-fg" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span class="text-sm font-medium text-fg">{rec.title || PLATFORM_LABEL[rec.platform] || rec.platform}</span>
            <span class="text-xs text-fg-subtle">· {PLATFORM_LABEL[rec.platform] || rec.platform}</span>
            {rec.platform !== 'presencial' ? <span class="text-xs text-fg-subtle">· {rec.nativeMeetingId}</span> : null}
            {rec.leadId ? <span class="text-xs text-fg-subtle">· Lead #{rec.leadId}</span> : null}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {formatDateTime(rec.createdAt)}
            {rec.segmentCount > 0 ? <> · {rec.segmentCount} trechos</> : null}
            {rec.userName ? <> · por {rec.userName}</> : null}
            {a ? <> · <span class="text-info">análise IA</span></> : null}
          </div>
          {rec.status === 'failed' && rec.errorReason ? (
            <div class="text-xs text-danger mt-1">{rec.errorReason}</div>
          ) : null}
        </div>
        {inFlight ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => stop.mutate(rec.id, {
              onSuccess: () => toast('Bot encerrado', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
            disabled={stop.isPending}
          >
            <StopCircle size={14} /> Encerrar
          </Button>
        ) : null}
      </div>

      {open ? (
        <div class="mt-3 pl-7 space-y-4">
          {/* Análise IA */}
          {a ? (
            <div class="rounded-lg border border-border bg-surface p-3 space-y-3">
              <div class="flex items-center gap-2">
                <Sparkles size={14} class="text-info" />
                <span class="text-sm font-semibold text-fg">Análise por IA</span>
                <Badge tone={sentimentoMeta(a.sentimento).tone}>{sentimentoMeta(a.sentimento).label}</Badge>
              </div>
              {a.resumo ? <p class="text-sm text-fg-muted leading-snug">{a.resumo}</p> : null}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AnalysisList title="Próximos passos" items={a.proximosPassos} />
                <AnalysisList title="Action items" items={a.acaoItems} />
                <AnalysisList title="Objeções" items={a.objecoes} />
                <AnalysisList title="Tópicos" items={a.topicos} />
              </div>
              {a.playbook ? (
                <div class="rounded-lg border border-info/30 bg-info-soft p-3 space-y-2 mt-1">
                  <div class="flex items-center gap-2">
                    <GraduationCap size={14} class="text-info" />
                    <span class="text-sm font-semibold text-fg">Coaching · Playbook comercial</span>
                    <Badge tone={a.playbook.aderencia >= 70 ? 'success' : a.playbook.aderencia >= 40 ? 'warning' : 'danger'}>
                      Aderência {a.playbook.aderencia}/100
                    </Badge>
                  </div>
                  <AnalysisList title="Pontos fortes" items={a.playbook.pontosFortes} />
                  <AnalysisList title="A melhorar na comunicação/condução" items={a.playbook.pontosMelhoria} />
                  <AnalysisList title="Direcionamento para a próxima" items={a.playbook.direcionamento} />
                </div>
              ) : null}

              {a.scorecard && a.scorecard.length ? (
                <div class="rounded-lg border border-border bg-surface p-3 space-y-1.5">
                  <div class="flex items-center gap-2"><ClipboardCheck size={14} class="text-info" /><span class="text-sm font-semibold text-fg">Scorecard</span></div>
                  {a.scorecard.map((s, i) => (
                    <div key={i} class="flex items-start gap-2">
                      <span class={cn('text-xs font-semibold px-1.5 py-0.5 rounded shrink-0', s.nota >= 7 ? 'bg-success-soft text-success' : s.nota >= 4 ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>{s.nota}/10</span>
                      <div class="min-w-0 text-sm"><span class="text-fg font-medium">{s.criterio}</span>{s.comentario ? <span class="text-fg-muted"> — {s.comentario}</span> : null}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {a.clips && a.clips.length ? (
                <div class="rounded-lg border border-border bg-surface p-3 space-y-1">
                  <div class="flex items-center gap-2 mb-1"><Scissors size={14} class="text-info" /><span class="text-sm font-semibold text-fg">Momentos-chave</span></div>
                  {a.clips.map((c, i) => (
                    <div key={i} class="text-sm text-fg-muted"><span class="text-info font-mono text-xs">{fmtSec(c.start)}</span> · {c.titulo}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : rec.status === 'completed' ? (
            <div class="text-xs text-fg-subtle">Análise por IA em processamento…</div>
          ) : null}

          {/* Transcrição */}
          {rec.transcriptText ? (
            <div>
              <button
                type="button"
                class="flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg"
                onClick={() => setShowTranscript((s) => !s)}
              >
                <FileText size={13} /> Transcrição {showTranscript ? '(ocultar)' : '(ver)'}
                {rec.recordingUrl ? (
                  <a
                    class="ml-2 inline-flex items-center gap-0.5 text-info hover:underline"
                    href={rec.recordingUrl}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                  >
                    baixar .txt <ExternalLink size={11} />
                  </a>
                ) : null}
                {rec.audioUrl ? (
                  <a
                    class="ml-2 inline-flex items-center gap-0.5 text-info hover:underline"
                    href={rec.audioUrl}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                  >
                    baixar áudio <ExternalLink size={11} />
                  </a>
                ) : null}
                {rec.videoUrl ? (
                  <a
                    class="ml-2 inline-flex items-center gap-0.5 text-info hover:underline"
                    href={rec.videoUrl}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Video size={11} /> vídeo
                  </a>
                ) : null}
              </button>
              {showTranscript ? (
                <div class="mt-2">
                  {rec.transcriptPolished ? (
                    <div class="inline-flex rounded-md border border-border overflow-hidden mb-2 text-xs">
                      <button type="button" onClick={() => setShowOriginal(false)} class={cn('px-2 py-1', !showOriginal ? 'bg-info text-white' : 'text-fg-muted')}>Revisada</button>
                      <button type="button" onClick={() => setShowOriginal(true)} class={cn('px-2 py-1', showOriginal ? 'bg-info text-white' : 'text-fg-muted')}>Fiel</button>
                    </div>
                  ) : null}
                  <pre class="text-xs text-fg-muted whitespace-pre-wrap bg-surface-2 rounded-lg p-3 max-h-80 overflow-auto">
                    {rec.transcriptPolished && !showOriginal ? rec.transcriptPolished : rec.transcriptText}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : (
            <div class="text-xs text-fg-subtle">Sem transcrição disponível.</div>
          )}
        </div>
      ) : null}
    </Card>
  )
}

// MODO PRESENCIAL: grava o áudio da sala física (mic do celular/navegador) ou
// envia um arquivo, com portão de consentimento (LGPD). Sem bot — o áudio vai
// direto ao whisper CPU soberano.
function PresencialMeetingModal({ onClose }: { onClose: () => void }) {
  const upload = useUploadPresencialMeeting()
  const { data: settings } = useMeetingsSettings()
  const [consent, setConsent] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [recording, setRecording] = useState(false)
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('pt')
  const [leadQuery, setLeadQuery] = useState('')
  const [selectedLead, setSelectedLead] = useState<MeetingLeadResult | null>(null)
  const leadSearch = useMeetingLeadSearch(selectedLead ? '' : leadQuery)
  const leadResults = leadSearch.data?.leads || []

  const canSend = !!file && consent && !upload.isPending

  function handleSend() {
    if (!file) { toast('Grave ou envie um áudio primeiro', 'warning'); return }
    if (!consent) { toast('Confirme o consentimento dos presentes', 'warning'); return }
    upload.mutate(
      { file, title, language, leadId: selectedLead?.id ?? null },
      {
        onSuccess: (r) => {
          if (r.recorded) { toast('Áudio enviado — transcrevendo em segundo plano…', 'success'); onClose() }
          else toast(r.reason || 'Não foi possível registrar a gravação', 'danger')
        },
        onError: (e) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Nova reunião presencial"
      description="Grave o áudio da reunião física ou envie um arquivo. A transcrição é feita localmente (soberana) e a análise por IA é anexada ao lead."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSend} disabled={!canSend}>
            <Upload size={14} /> {upload.isPending ? 'Enviando…' : 'Enviar para transcrição'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        {/* Nome da reunião */}
        <div>
          <label class="text-xs font-semibold text-fg mb-1 block">Nome da reunião</label>
          <Input
            placeholder="Ex.: Visita comercial — Cliente X"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Portão de consentimento (LGPD presencial) */}
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3">
          <div class="flex items-center gap-2 text-sm font-semibold text-fg mb-1">
            <ShieldCheck size={15} class="text-warning" /> Consentimento (LGPD)
          </div>
          <p class="text-xs text-fg-muted mb-2">
            {settings?.notifyToOwner !== undefined /* settings carregado */
              ? 'Informe verbalmente os presentes de que a reunião será gravada e transcrita. Não há bot que se anuncie no presencial — a responsabilidade de informar é sua.'
              : 'Carregando…'}
          </p>
          <label class="flex items-start gap-2 text-sm text-fg cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent((e.target as HTMLInputElement).checked)}
              class="mt-0.5"
            />
            <span>Confirmo que <strong>informei os presentes</strong> e obtive consentimento para gravar e transcrever esta reunião.</span>
          </label>
        </div>

        {/* Captura: gravar agora OU enviar arquivo */}
        <div>
          <div class="text-xs font-semibold text-fg mb-2">Áudio da reunião</div>
          {recording ? (
            <AudioRecorder
              onComplete={(f) => { setFile(f); setRecording(false) }}
              onCancel={() => setRecording(false)}
            />
          ) : file ? (
            <div class="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
              <Mic size={15} class="text-success" />
              <span class="flex-1 text-sm text-fg truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>Trocar</Button>
            </div>
          ) : (
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
                <Radio size={14} /> Gravar agora
              </Button>
              <label class="inline-flex">
                <input
                  type="file"
                  accept="audio/*"
                  class="hidden"
                  onChange={(e) => {
                    const f = (e.target as HTMLInputElement).files?.[0]
                    if (f) setFile(f)
                  }}
                />
                <span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface text-sm text-fg cursor-pointer hover:bg-surface-3">
                  <Upload size={14} /> Enviar arquivo
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Opções */}
        <div>
          <label class="text-xs font-semibold text-fg mb-1 block">Idioma</label>
          <Select value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}>
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </Select>
        </div>

        {/* Vincular a um lead — busca por nome, e-mail ou WhatsApp */}
        <div>
          <label class="text-xs font-semibold text-fg mb-1 block">Vincular a um lead (opcional)</label>
          {selectedLead ? (
            <div class="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
              <Users size={15} class="text-info shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="text-sm text-fg truncate">{selectedLead.nome || `Lead #${selectedLead.id}`}{selectedLead.empresa ? ` · ${selectedLead.empresa}` : ''}</div>
                <div class="text-xs text-fg-subtle truncate">{selectedLead.whatsapp || selectedLead.email || `#${selectedLead.id}`}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedLead(null); setLeadQuery('') }}>Trocar</Button>
            </div>
          ) : (
            <div class="relative">
              <Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                value={leadQuery}
                onInput={(e) => setLeadQuery((e.target as HTMLInputElement).value)}
                placeholder="Buscar por nome, e-mail ou WhatsApp…"
                class="w-full pl-9 pr-3 py-2 rounded-md bg-surface border border-border text-sm text-fg"
              />
              {leadQuery.trim().length >= 2 && (
                <div class="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg max-h-56 overflow-y-auto">
                  {leadSearch.isLoading ? (
                    <div class="px-3 py-2 text-sm text-fg-subtle">Buscando…</div>
                  ) : leadResults.length === 0 ? (
                    <div class="px-3 py-2 text-sm text-fg-subtle">Nenhum lead encontrado.</div>
                  ) : (
                    leadResults.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        class="w-full text-left px-3 py-2 hover:bg-surface-3 border-b border-border last:border-b-0"
                        onClick={() => { setSelectedLead(l); setLeadQuery('') }}
                      >
                        <div class="text-sm text-fg truncate">{l.nome || `Lead #${l.id}`}{l.empresa ? ` · ${l.empresa}` : ''}</div>
                        <div class="text-xs text-fg-subtle truncate">{[l.whatsapp, l.email].filter(Boolean).join(' · ') || `#${l.id}`}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function RecordingsTab() {
  const [q, setQ] = useState('')
  const [presencialOpen, setPresencialOpen] = useState(false)
  const search = useMeetingSearch(q)
  const { data, isLoading } = useMeetingRecordings()
  const recordings = data?.recordings || []
  const searching = q.trim().length >= 2

  return (
    <div class="space-y-3">
      {presencialOpen && <PresencialMeetingModal onClose={() => setPresencialOpen(false)} />}
      <div class="flex items-center gap-2">
        <div class="relative flex-1 min-w-0">
          <Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            placeholder="Buscar nas transcrições…"
            class="w-full pl-9 pr-3 py-2 rounded-md bg-surface border border-border text-sm text-fg"
          />
        </div>
        <Button variant="primary" size="sm" class="shrink-0" onClick={() => setPresencialOpen(true)}>
          <Radio size={14} class="shrink-0" />
          <span class="hidden sm:inline">Reunião presencial</span>
          <span class="sm:hidden">Presencial</span>
        </Button>
      </div>

      {searching ? (
        search.isLoading ? (
          <Skeleton class="h-24 w-full" />
        ) : (search.data?.results.length ? (
          <div class="space-y-2">
            {search.data.results.map((r) => (
              <Card key={r.id}>
                <div class="text-xs text-fg-subtle">{PLATFORM_LABEL[r.platform] || r.platform} · {formatDateTime(r.createdAt)}{r.leadId ? ` · Lead #${r.leadId}` : ''}</div>
                <div class="text-sm text-fg-muted mt-1">{r.snippet}</div>
              </Card>
            ))}
          </div>
        ) : <p class="text-sm text-fg-subtle py-6 text-center">Nenhum resultado para "{q}".</p>)
      ) : isLoading ? (
        <div class="space-y-3"><Skeleton class="h-20 w-full" /><Skeleton class="h-20 w-full" /></div>
      ) : recordings.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="Nenhuma reunião gravada ainda"
          description="Quando um bot de transcrição entrar numa reunião, ela aparece aqui com a transcrição e a análise por IA. Ative a gravação em Configurações › LGPD/Legal e a licença do usuário na aba Bots por usuário."
        />
      ) : (
        recordings.map((rec) => <RecordingCard key={rec.id} rec={rec} />)
      )}
    </div>
  )
}

// (#1) Relatório multi-reunião.
function ReportsTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const gen = useGenerateMeetingsReport()
  const report = gen.data?.report
  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-center gap-2 mb-2"><BarChart3 size={18} class="text-info" /><div class="text-sm font-semibold text-fg">Relatório multi-reunião</div></div>
        <p class="text-xs text-fg-muted mb-3">Agrega as reuniões analisadas de um período: objeções recorrentes, temas, aderência média ao playbook e recomendações para o time.</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <Input label="De" type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
          <Input label="Até" type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
          <Button variant="primary" onClick={() => gen.mutate({ from: from || undefined, to: to ? `${to}T23:59:59` : undefined })} disabled={gen.isPending}>
            {gen.isPending ? 'Gerando…' : 'Gerar relatório'}
          </Button>
        </div>
      </Card>
      {gen.isPending ? <Skeleton class="h-40 w-full" /> : report ? (
        <Card>
          <div class="flex items-center gap-2 flex-wrap mb-2">
            <span class="text-sm font-semibold text-fg">Panorama do período</span>
            <Badge tone="neutral">{report.meetingCount} reuniões</Badge>
            {report.aderenciaMedia != null ? <Badge tone={report.aderenciaMedia >= 70 ? 'success' : report.aderenciaMedia >= 40 ? 'warning' : 'danger'}>Aderência média {report.aderenciaMedia}/100</Badge> : null}
          </div>
          {report.resumo ? <p class="text-sm text-fg-muted mb-3">{report.resumo}</p> : null}
          {report.meetingCount === 0 ? (
            <p class="text-sm text-fg-subtle">Nenhuma reunião analisada no período selecionado.</p>
          ) : (
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AnalysisList title="Objeções recorrentes" items={report.objecoesComuns} />
              <AnalysisList title="Temas / padrões" items={report.temas} />
              <AnalysisList title="Recomendações para o time" items={report.recomendacoes} />
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}

// Aba de licenças (seats) — ativar/desativar o bot POR USUÁRIO. Unidade de cobrança.
function SeatRow({ seat }: { seat: MeetingSeat }) {
  const update = useUpdateMeetingSeat()
  function toggle(field: 'enabled' | 'autoJoin', value: boolean) {
    update.mutate({ userId: seat.userId, [field]: value }, {
      onError: (e: unknown) => toast((e as Error).message || 'Erro', 'danger'),
    })
  }
  return (
    <div class="flex items-center gap-3 border border-border rounded-lg p-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-fg truncate">{seat.name || seat.email || `Usuário #${seat.userId}`}</div>
        <div class="text-xs text-fg-subtle truncate">
          {seat.email} · {seat.role}
          {seat.enabled && seat.activatedAt ? <> · ativo desde {formatDateTime(seat.activatedAt)}</> : null}
        </div>
      </div>
      {seat.enabled ? (
        <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
          <input type="checkbox" checked={seat.autoJoin} disabled={update.isPending}
            onChange={(e) => toggle('autoJoin', (e.target as HTMLInputElement).checked)} />
          entra sozinho
        </label>
      ) : null}
      <Badge tone={seat.enabled ? 'success' : 'neutral'}>{seat.enabled ? 'Bot ativo' : 'Sem bot'}</Badge>
      <Button
        size="sm"
        variant={seat.enabled ? 'ghost' : 'primary'}
        disabled={update.isPending}
        onClick={() => toggle('enabled', !seat.enabled)}
      >
        {seat.enabled ? 'Desativar' : 'Ativar'}
      </Button>
    </div>
  )
}

function SeatsTab() {
  const { data, isLoading, error } = useMeetingSeats()
  if (error) {
    return <EmptyState icon={Users} title="Apenas administradores" description="A gestão de licenças do bot por usuário é restrita a administradores." />
  }
  if (isLoading) {
    return <div class="space-y-3"><Skeleton class="h-16 w-full" /><Skeleton class="h-16 w-full" /></div>
  }
  const seats = data?.seats || []
  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3">
          <Users size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-fg">Licença do bot por usuário</div>
            <p class="text-xs text-fg-muted mt-0.5">
              O bot de transcrição é ativado <strong>por usuário</strong> — cada licença ativa é uma unidade de cobrança.
              Uma vez ativada, o bot passa a operar nas reuniões daquele usuário (com "entra sozinho" ligado).
            </p>
          </div>
          <Badge tone="info">{data?.activeCount ?? 0} ativo(s)</Badge>
        </div>
      </Card>
      {seats.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum operador" description="Cadastre usuários para atribuir licenças de bot." />
      ) : (
        <div class="space-y-2">{seats.map((s) => <SeatRow key={s.userId} seat={s} />)}</div>
      )}
    </div>
  )
}

// Configurações gerais do módulo: nome do bot, transcrição, análise, entregas.
function MeetingsSettingsCard() {
  const { data, isLoading, error } = useMeetingsSettings()
  const update = useUpdateMeetingsSettings()
  const [f, setF] = useState<MeetingsSettings | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])

  if (error) return <EmptyState icon={SlidersHorizontal} title="Apenas administradores" description="As configurações do módulo são restritas a administradores." />
  if (isLoading || !f) return <Skeleton class="h-72 w-full" />

  const set = <K extends keyof MeetingsSettings>(k: K, v: MeetingsSettings[K]) => setF((p) => p ? { ...p, [k]: v } : p)
  const dirty = !!data && JSON.stringify(f) !== JSON.stringify(data)
  function save() {
    update.mutate(f!, {
      onSuccess: () => toast('Configurações salvas', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <SlidersHorizontal size={18} class="text-info" />
        <div class="text-sm font-semibold text-fg">Configurações do módulo</div>
      </div>
      <div class="space-y-4">
        <Input
          label="Nome do bot na reunião"
          value={f.botName}
          placeholder="ByChat Transcritor"
          hint="Como o bot aparece para os participantes da reunião."
          onInput={(e) => set('botName', (e.target as HTMLInputElement).value)}
        />

        <div>
          <label class="block text-xs font-medium text-fg mb-1">Idioma da reunião / análise</label>
          <Select value={f.language} onChange={(e) => set('language', (e.target as HTMLSelectElement).value)}>
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
            <option value="fr">Francês</option>
            <option value="it">Italiano</option>
            <option value="de">Alemão</option>
          </Select>
        </div>

        <div>
          <label class="block text-xs font-medium text-fg mb-1">Transcrição</label>
          <Select value={f.transcriptMode} onChange={(e) => set('transcriptMode', (e.target as HTMLSelectElement).value as MeetingsSettings['transcriptMode'])}>
            <option value="fiel">Fiel à fala dos participantes</option>
            <option value="corrigida">Revisada pela IA (mais profissional)</option>
          </Select>
          <p class="text-xs text-fg-subtle mt-1">"Revisada" corrige erros de transcrição e vícios de fala sem mudar o sentido.</p>
        </div>

        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={f.analysisEnabled} onChange={(e) => set('analysisEnabled', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
          <span class="text-sm text-fg">Analisar reuniões por IA (resumo, coaching)</span>
        </label>

        {f.analysisEnabled ? (
          <Textarea
            label="Instruções extras de análise (opcional)"
            rows={2}
            value={f.analysisExtra}
            placeholder="Ex.: sempre destacar risco de churn e oportunidades de upsell."
            onInput={(e) => set('analysisExtra', (e.target as HTMLTextAreaElement).value)}
          />
        ) : null}

        {f.analysisEnabled ? (
          <Textarea
            label="Critérios do scorecard (um por linha, opcional)"
            rows={3}
            value={f.scorecardCriteria}
            placeholder={'Abertura e rapport\nDiagnóstico / descoberta\nApresentação de valor\nTratamento de objeções\nPróximo passo / fechamento'}
            onInput={(e) => set('scorecardCriteria', (e.target as HTMLTextAreaElement).value)}
          />
        ) : null}

        <Textarea
          label="Anúncio de entrada do bot (opcional)"
          rows={2}
          value={f.joinAnnouncement}
          placeholder="Ex.: Olá! Esta reunião será gravada e transcrita para registro do atendimento."
          onInput={(e) => set('joinAnnouncement', (e.target as HTMLTextAreaElement).value)}
        />

        <Input
          label="Entrar quantos minutos antes do horário"
          type="number"
          min={0}
          value={String(f.joinAheadMinutes)}
          hint="Janela de antecedência do bot para entradas automáticas."
          onInput={(e) => set('joinAheadMinutes', parseInt((e.target as HTMLInputElement).value, 10) || 0)}
        />

        <div class="border-t border-border pt-3 space-y-3">
          <div class="text-xs font-semibold text-fg flex items-center gap-1.5"><Mail size={13} /> Envio do resumo por e-mail</div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.notifyEmailEnabled} onChange={(e) => set('notifyEmailEnabled', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Enviar resumo + análise por e-mail</span>
          </label>
          {f.notifyEmailEnabled ? (
            <div class="space-y-2 pl-6">
              <Input label="Destinatários (separe por vírgula)" value={f.notifyEmailTo} placeholder="comercial@empresa.com, gestor@empresa.com" onInput={(e) => set('notifyEmailTo', (e.target as HTMLInputElement).value)} />
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={f.notifyToOwner} onChange={(e) => set('notifyToOwner', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
                <span class="text-sm text-fg-muted">Incluir também o responsável pela reunião</span>
              </label>
            </div>
          ) : null}
        </div>

        <div class="border-t border-border pt-3 space-y-3">
          <div class="text-xs font-semibold text-fg flex items-center gap-1.5"><MessageSquare size={13} /> Envio do resumo por WhatsApp</div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.notifyWhatsappEnabled} onChange={(e) => set('notifyWhatsappEnabled', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Enviar resumo + análise por WhatsApp</span>
          </label>
          {f.notifyWhatsappEnabled ? (
            <div class="pl-6">
              <Input label="Número do WhatsApp (com DDI/DDD)" value={f.notifyWhatsappTo} placeholder="5562999999999" onInput={(e) => set('notifyWhatsappTo', (e.target as HTMLInputElement).value)} />
            </div>
          ) : null}
        </div>

        <div class="border-t border-border pt-3 space-y-3">
          <div class="text-xs font-semibold text-fg">Automação e integrações</div>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.attachToLead} onChange={(e) => set('attachToLead', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Anexar o resumo como atividade no lead</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.redactPii} onChange={(e) => set('redactPii', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Mascarar dados sensíveis (CPF/CNPJ/cartão) nos envios</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.saveAudio} onChange={(e) => set('saveAudio', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Guardar o áudio da reunião</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.saveVideo} onChange={(e) => set('saveVideo', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Gravar o vídeo da reunião (habilita clipes)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.presencialEnabled} onChange={(e) => set('presencialEnabled', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Permitir reunião <strong>presencial</strong> (gravar o áudio da sala / upload, sem bot)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={f.alertLowAdherence} onChange={(e) => set('alertLowAdherence', (e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            <span class="text-sm text-fg">Alertar o gestor por baixa aderência ao playbook</span>
          </label>
          {f.alertLowAdherence ? (
            <div class="pl-6 grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input label="Aderência mínima (0-100)" type="number" min={0} value={String(f.alertThreshold)} onInput={(e) => set('alertThreshold', parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
              <Input label="E-mail do gestor" value={f.alertEmail} placeholder="gestor@empresa.com" onInput={(e) => set('alertEmail', (e.target as HTMLInputElement).value)} />
            </div>
          ) : null}
          <Input label="Webhook — reunião analisada (opcional)" value={f.webhookUrl} placeholder="https://…" hint="Enviamos um POST com o JSON da análise a cada reunião concluída." onInput={(e) => set('webhookUrl', (e.target as HTMLInputElement).value)} />
        </div>
      </div>
      {dirty ? (
        <div class="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={() => data && setF(data)} disabled={update.isPending}>Descartar</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>{update.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      ) : null}
    </Card>
  )
}

// Configurações do módulo — Playbook comercial (contexto da análise IA).
function PlaybookConfigTab() {
  const { data, isLoading, error } = usePlaybook()
  const update = useUpdatePlaybook()
  const [enabled, setEnabled] = useState(false)
  const [text, setText] = useState('')
  useEffect(() => { if (data) { setEnabled(data.enabled); setText(data.text) } }, [data])

  if (error) return <EmptyState icon={Settings} title="Apenas administradores" description="A configuração do playbook é restrita a administradores." />
  if (isLoading) return <Skeleton class="h-64 w-full" />

  const dirty = !!data && (enabled !== data.enabled || text !== data.text)
  function save() {
    if (enabled && !text.trim()) { toast('Informe o conteúdo do playbook para ativar.', 'danger'); return }
    update.mutate({ enabled, text }, {
      onSuccess: () => toast('Playbook salvo', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }
  return (
    <Card>
      <div class="flex items-start gap-3 mb-3">
        <Target size={18} class="text-info shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <div class="text-sm font-semibold text-fg">Playbook comercial (contexto da IA)</div>
            <Badge tone={data?.enabled ? 'success' : 'neutral'}>{data?.enabled ? 'ATIVO' : 'DESATIVADO'}</Badge>
          </div>
          <p class="text-xs text-fg-muted mt-0.5">
            Quando ativo, a análise por IA avalia a conduta do time em cada reunião <strong>à luz deste playbook</strong>:
            aderência, o que foi bem, o que ajustar na comunicação/condução e um direcionamento de coaching.
            É o que transforma o bot em treinamento contínuo do time de vendas.
          </p>
        </div>
      </div>
      <label class="flex items-center gap-2 cursor-pointer select-none mb-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)} class="h-4 w-4" />
        <span class="text-sm text-fg">Ativar análise por playbook</span>
      </label>
      <Textarea
        label="Playbook de vendas / comercial"
        rows={16}
        value={text}
        placeholder="Cole aqui o seu playbook: etapas da venda, perguntas de diagnóstico, tratamento de objeções, critérios de qualificação, regras de condução e de fechamento…"
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      {dirty ? (
        <div class="flex justify-end gap-2 mt-3">
          <Button variant="ghost" size="sm" onClick={() => { if (data) { setEnabled(data.enabled); setText(data.text) } }} disabled={update.isPending}>Descartar</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={update.isPending}>{update.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      ) : null}
    </Card>
  )
}

function ConfigTab() {
  return (
    <div class="space-y-4">
      <MeetingsSettingsCard />
      <PlaybookConfigTab />
    </div>
  )
}

type MeetingsTab = 'recordings' | 'reports' | 'seats' | 'config'

export function MeetingsPage() {
  const [tab, setTab] = useState<MeetingsTab>('recordings')
  const tabs: { id: MeetingsTab; label: string; icon: any }[] = [
    { id: 'recordings', label: 'Gravações', icon: ListVideo },
    { id: 'reports', label: 'Relatórios', icon: BarChart3 },
    { id: 'seats', label: 'Bots por usuário', icon: Users },
    { id: 'config', label: 'Configurações', icon: Settings },
  ]
  return (
    <Page
      title="Reuniões"
      description="Transcrição e análise por IA das suas reuniões online (Google Meet, Teams, Zoom) — capturadas e transcritas localmente, ligadas ao lead."
    >
      <div class="grid grid-cols-4 sm:flex sm:items-center gap-1 border-b border-border mb-4">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              class={cn(
                'flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-2 px-1 sm:px-4 py-2 text-[11px] sm:text-sm font-medium leading-tight text-center border-b-2 -mb-px transition-colors',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <Icon size={16} class="shrink-0" /> <span>{t.label}</span>
            </button>
          )
        })}
      </div>
      {tab === 'recordings' ? <RecordingsTab /> : tab === 'reports' ? <ReportsTab /> : tab === 'seats' ? <SeatsTab /> : <ConfigTab />}
    </Page>
  )
}
