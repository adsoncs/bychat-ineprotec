// DedupSettings — controla dedup.mode.<channel> por canal de captura.
// Categoria A (Captura) sempre cria lead novo. Setting controla se a sinalização
// "duplicado pendente" roda (always_new) ou fica muda (update_existing).

import { useEffect, useMemo, useState } from 'preact/hooks'
import { Copy } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'

const CHANNELS: { key: string; label: string; help: string }[] = [
  { key: 'dedup.mode.forms', label: 'Forms / Landing Pages', help: 'Submissões dos formulários públicos e Web Components.' },
  { key: 'dedup.mode.metaLeadAds', label: 'Meta Lead Ads', help: 'Webhook de leads do Meta (Facebook/Instagram).' },
  { key: 'dedup.mode.enrollmentPortal', label: 'Portal de Matrículas', help: 'Inscrições do portal educacional (cada candidatura = oportunidade).' },
  { key: 'dedup.mode.publicApi', label: 'API Pública', help: 'Endpoints /api/v1/* via API Key.' },
  { key: 'dedup.mode.make', label: 'Make.com', help: 'Integromat / Make app oficial.' },
]

const MODE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: 'always_new',
    label: 'Sempre criar novo (recomendado)',
    description: 'Cada submissão vira um lead novo. Quando casar com um existente, aparece em "Leads duplicados" pra revisão humana.',
  },
  {
    value: 'update_existing',
    label: 'Atualizar existente (silencioso)',
    description: 'Cria o lead novo mas não sinaliza duplicidade. Bom pra integrações com identidade já garantida (sem Categoria A).',
  },
]

export function DedupSettings() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})

  const initialFromServer = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const c of CHANNELS) {
      const s = data?.settings.find((x: any) => x.key === c.key)
      let v = 'always_new'
      if (s) {
        const raw = s.value as any
        v = typeof raw === 'string' ? raw : (raw?.mode || raw?.value || 'always_new')
      }
      out[c.key] = v === 'update_existing' ? 'update_existing' : 'always_new'
    }
    return out
  }, [data?.settings])

  // Sincroniza o draft com o servidor quando os dados chegam
  useEffect(() => {
    setDraft(initialFromServer)
  }, [initialFromServer])

  const dirty = CHANNELS.some(c => (draft[c.key] ?? initialFromServer[c.key]) !== initialFromServer[c.key])

  function handleSave() {
    const updates: Record<string, string> = {}
    for (const c of CHANNELS) {
      const v = draft[c.key] ?? initialFromServer[c.key]
      if (v !== undefined && v !== initialFromServer[c.key]) updates[c.key] = v
    }
    if (Object.keys(updates).length === 0) return
    update.mutate(updates as any, {
      onSuccess: () => toast('Configurações de duplicação salvas', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleReset() {
    setDraft(initialFromServer)
  }

  return (
    <div class="space-y-4">
      <RegrasDuplicidadeCard />
      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Copy size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Duplicação por canal de captura</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Cada submissão em Forms, Meta Lead Ads, Portal de Matrículas, API ou Make é tratada como uma <strong>oportunidade nova</strong>. Quando casa com um lead existente (por WhatsApp ou e-mail), o sistema sinaliza pra revisão humana em <a class="text-info hover:underline" href="/app/leads/duplicates">/app/leads/duplicates</a>. Aqui você pode silenciar essa sinalização por canal.
            </p>
          </div>
        </div>

        {isLoading ? (
          <Skeleton class="h-48 w-full" />
        ) : (
          <div class="flex flex-col gap-3">
            {CHANNELS.map(c => {
              const value = draft[c.key] ?? initialFromServer[c.key] ?? 'always_new'
              return (
                <div key={c.key} class="grid grid-cols-1 md:grid-cols-[16rem_1fr_18rem] gap-3 items-start py-2 border-b border-border last:border-b-0">
                  <div>
                    <div class="text-sm font-medium text-fg">{c.label}</div>
                    <p class="text-2xs text-fg-muted mt-0.5">{c.help}</p>
                  </div>
                  <div class="text-xs text-fg-muted">
                    {MODE_OPTIONS.find(o => o.value === value)?.description}
                  </div>
                  <Select
                    value={value}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value
                      setDraft(d => ({ ...d, [c.key]: v }))
                    }}
                  >
                    {MODE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )
            })}
          </div>
        )}

        {dirty && (
          <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={update.isPending}>
              Descartar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Regras de duplicidade (Setting `dedup.regras`) ─────────────────────────
// Espelha services/regrasDuplicidade.ts. As travas fixas (CPF diferente, nomes
// diferentes, inscrição paga) não aparecem aqui de propósito: não se desligam.

type AcaoFicha = 'juntar' | 'sinalizar' | 'nada'
type AcaoInscricao = 'retomar' | 'manter' | 'manter_avisar'
interface Regras {
  fichas: { whatsapp: AcaoFicha; cpf: AcaoFicha; email: AcaoFicha; nomeDdd: AcaoFicha }
  canais: Record<string, boolean>
  inscricoes: { mesmaOferta: AcaoInscricao; mesmoCursoOutraForma: AcaoInscricao; outroCurso: AcaoInscricao }
  ativadaEm?: string | null
}

const CANAIS_JUNCAO: { key: string; label: string }[] = [
  { key: 'enrollmentPortal', label: 'Portal de Matrículas' },
  { key: 'metaLeadAds', label: 'Meta Lead Ads' },
  { key: 'forms', label: 'Forms / Landing Pages' },
  { key: 'publicApi', label: 'API Pública' },
  { key: 'make', label: 'Make.com' },
  { key: 'inbound_webhook', label: 'Webhook de entrada' },
]

const REGRAS_PADRAO: Regras = {
  fichas: { whatsapp: 'sinalizar', cpf: 'sinalizar', email: 'sinalizar', nomeDdd: 'nada' },
  canais: Object.fromEntries(CANAIS_JUNCAO.map((c) => [c.key, true])),
  inscricoes: { mesmaOferta: 'retomar', mesmoCursoOutraForma: 'manter_avisar', outroCurso: 'manter' },
  ativadaEm: null,
}

const CRITERIOS: { key: keyof Regras['fichas']; label: string; help: string }[] = [
  { key: 'whatsapp', label: 'Mesmo WhatsApp', help: 'Prova forte. Não junta se os CPFs forem diferentes ou os nomes não baterem (celular da família).' },
  { key: 'cpf', label: 'Mesmo CPF', help: 'Prova forte: é a mesma pessoa, mesmo com outro telefone.' },
  { key: 'email', label: 'Mesmo e-mail', help: 'Médio: e-mail da família ou da igreja é comum.' },
  { key: 'nomeDdd', label: 'Mesmo nome completo e DDD', help: 'Fraco: homônimos existem. Use no máximo para sinalizar.' },
]

const ACOES_FICHA: { value: AcaoFicha; label: string }[] = [
  { value: 'juntar', label: 'Juntar automaticamente' },
  { value: 'sinalizar', label: 'Só sinalizar para revisão' },
  { value: 'nada', label: 'Não considerar' },
]

const SITUACOES: { key: keyof Regras['inscricoes']; label: string; help: string }[] = [
  { key: 'mesmaOferta', label: 'Mesmo curso e mesma forma de ingresso', help: 'Normalmente é o candidato reenviando o formulário.' },
  { key: 'mesmoCursoOutraForma', label: 'Mesmo curso, outra forma de ingresso', help: 'Ex.: inscrição pela Redação e depois pelo ENEM.' },
  { key: 'outroCurso', label: 'Outro curso', help: 'Ex.: Pós X em aberto e nova inscrição na Pós Z.' },
]

const ACOES_INSCRICAO: { value: AcaoInscricao; label: string }[] = [
  { value: 'retomar', label: 'Retomar a inscrição aberta' },
  { value: 'manter', label: 'Manter as duas' },
  { value: 'manter_avisar', label: 'Manter as duas e avisar a secretaria' },
]

function lerRegras(raw: unknown): Regras {
  let v: any = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  return {
    fichas: { ...REGRAS_PADRAO.fichas, ...(v?.fichas || {}) },
    canais: { ...REGRAS_PADRAO.canais, ...(v?.canais || {}) },
    inscricoes: { ...REGRAS_PADRAO.inscricoes, ...(v?.inscricoes || {}) },
    ativadaEm: v?.ativadaEm ?? null,
  }
}

function RegrasDuplicidadeCard() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const doServidor = useMemo(() => lerRegras(data?.settings.find((x: any) => x.key === 'dedup.regras')?.value), [data?.settings])
  const [draft, setDraft] = useState<Regras>(doServidor)
  useEffect(() => { setDraft(doServidor) }, [doServidor])
  const dirty = JSON.stringify(draft) !== JSON.stringify(doServidor)
  const juntaAlgo = Object.values(draft.fichas).includes('juntar')

  function salvar() {
    // A junção automática só vale para o que for sinalizado a partir de agora
    // quando um critério passa a juntar — o acervo antigo é revisão humana.
    const antes = new Set(Object.entries(doServidor.fichas).filter(([, v]) => v === 'juntar').map(([k]) => k))
    const ganhou = Object.entries(draft.fichas).some(([k, v]) => v === 'juntar' && !antes.has(k))
    const valor: Regras = { ...draft, ativadaEm: ganhou || !draft.ativadaEm ? (juntaAlgo ? new Date().toISOString() : null) : draft.ativadaEm }
    update.mutate({ 'dedup.regras': valor } as any, {
      onSuccess: () => toast('Regras de duplicidade salvas', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <div class="flex items-start gap-3 mb-4">
        <Copy size={18} class="text-info shrink-0 mt-0.5" />
        <div class="min-w-0">
          <div class="text-sm font-semibold text-fg">Regras de duplicidade</div>
          <p class="text-xs text-fg-muted mt-0.5">
            Quando a mesma pessoa chega de novo (portal, anúncio, formulário…), o que o sistema faz com a ficha e com a inscrição.
            Juntar fichas não junta inscrições: cada inscrição continua separada, com a sua cobrança e os seus documentos.
            Nunca são juntadas sozinhas: fichas com CPFs diferentes, nomes diferentes ou dois cadastros de aluno.
          </p>
        </div>
      </div>
      {isLoading ? <Skeleton class="h-64 w-full" /> : (
        <div class="flex flex-col gap-5">
          <div>
            <div class="text-xs font-semibold text-fg mb-2">Fichas da mesma pessoa</div>
            {CRITERIOS.map((c) => (
              <div key={c.key} class="grid grid-cols-1 md:grid-cols-[16rem_1fr_16rem] gap-3 items-start py-2 border-b border-border last:border-b-0">
                <div class="text-sm font-medium text-fg">{c.label}</div>
                <p class="text-xs text-fg-muted">{c.help}</p>
                <Select value={draft.fichas[c.key]} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as AcaoFicha; setDraft((d) => ({ ...d, fichas: { ...d.fichas, [c.key]: v } })) }}>
                  {ACOES_FICHA.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
            ))}
            {juntaAlgo && (
              <div class="mt-3">
                <div class="text-xs text-fg-muted mb-1">Juntar automaticamente nas entradas por:</div>
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  {CANAIS_JUNCAO.map((c) => (
                    <label key={c.key} class="flex items-center gap-1.5 text-sm text-fg">
                      <input type="checkbox" checked={draft.canais[c.key] !== false}
                        onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setDraft((d) => ({ ...d, canais: { ...d.canais, [c.key]: v } })) }} />
                      {c.label}
                    </label>
                  ))}
                </div>
                {doServidor.ativadaEm && (
                  <p class="text-2xs text-fg-muted mt-2">Juntando o que foi sinalizado desde {new Date(doServidor.ativadaEm).toLocaleString('pt-BR')}. As anteriores continuam em <a class="text-info hover:underline" href="/app/leads/duplicates">Leads duplicados</a>.</p>
                )}
              </div>
            )}
          </div>
          <div>
            <div class="text-xs font-semibold text-fg mb-2">Nova inscrição de quem já tem uma em aberto (mesmo CPF, sem pagamento)</div>
            {SITUACOES.map((c) => (
              <div key={c.key} class="grid grid-cols-1 md:grid-cols-[16rem_1fr_16rem] gap-3 items-start py-2 border-b border-border last:border-b-0">
                <div class="text-sm font-medium text-fg">{c.label}</div>
                <p class="text-xs text-fg-muted">{c.help}</p>
                <Select value={draft.inscricoes[c.key]} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as AcaoInscricao; setDraft((d) => ({ ...d, inscricoes: { ...d.inscricoes, [c.key]: v } })) }}>
                  {ACOES_INSCRICAO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
            ))}
            <p class="text-2xs text-fg-muted mt-2">Inscrição paga ou matriculada nunca é reaproveitada.</p>
          </div>
        </div>
      )}
      {dirty && (
        <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={() => setDraft(doServidor)} disabled={update.isPending}>Descartar</Button>
          <Button variant="primary" size="sm" onClick={salvar} disabled={update.isPending}>{update.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      )}
    </Card>
  )
}
