// "Atualizar fatura vencida" pela equipe (backend: routes/atualizarFatura.ts).
// Lista as faturas vencidas da inscrição — 1ª cobrança, pagamentos do
// combinado/acordo e parcelas do Meu Portal — e dá nova data na MESMA cobrança
// do Asaas (valor igual, sem multa nem juros). Depois, a mensagem pronta para
// mandar ao aluno: nada sai sozinho.
import { useState } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { CalendarClock, Copy, ExternalLink, MessageCircle } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

interface Fatura {
  chave: string
  titulo: string
  detalhe: string | null
  valor: number
  vencimento: string | null
  situacao: 'paga' | 'aberta' | 'vencida' | 'cancelada' | 'estornada' | 'prevista'
  meio: string | null
  pagar: string | null
  podeAtualizar?: boolean
}
interface Resultado {
  vencimento: string
  link: string | null
  pix: string | null
  linha: string | null
  valor: number
  mensagem: { texto: string; leadId: number | null; whatsapp: string | null }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')
const chaveDaConsulta = (id: number) => ['faturas-da-inscricao', id]

export function FaturasVencidasCard({ registrationId, podeOperar = true }: { registrationId: number; podeOperar?: boolean }) {
  const q = useQuery({
    queryKey: chaveDaConsulta(registrationId),
    queryFn: () => api.get<{ faturas: Fatura[]; hoje: string }>(`/admin/enrollment-registrations/${registrationId}/faturas`),
    staleTime: 30_000,
  })
  const [alvo, setAlvo] = useState<Fatura | null>(null)
  const vencidas = (q.data?.faturas ?? []).filter((f) => f.situacao === 'vencida')
  if (!vencidas.length) return null

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted inline-flex items-center gap-2 mb-3">
        <CalendarClock size={12} /> Faturas vencidas ({vencidas.length})
      </div>
      <ul class="space-y-2">
        {vencidas.map((f) => (
          <li key={f.chave} class="rounded-md border border-danger/40 bg-danger/5 p-3 flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-fg">{f.titulo}</span>
                <span class="text-sm tabular-nums">{brl(f.valor)}</span>
                <Badge tone="danger">Venceu em {dia(f.vencimento)}</Badge>
              </div>
              <div class="text-2xs text-fg-muted mt-0.5">{[f.meio, f.detalhe].filter(Boolean).join(' · ')}</div>
            </div>
            {f.pagar && <a class="text-xs text-accent underline" href={f.pagar} target="_blank" rel="noopener noreferrer">Fatura ↗</a>}
            {podeOperar && f.podeAtualizar && (
              <Button size="sm" onClick={() => setAlvo(f)}><CalendarClock size={12} /> Atualizar fatura</Button>
            )}
            {!f.podeAtualizar && <span class="text-2xs text-fg-muted">Cartão: gere uma nova forma de pagamento</span>}
          </li>
        ))}
      </ul>
      {alvo && q.data && <AtualizarFaturaModal registrationId={registrationId} fatura={alvo} hoje={q.data.hoje} onClose={() => setAlvo(null)} />}
    </Card>
  )
}

function somarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function AtualizarFaturaModal({ registrationId, fatura, hoje, onClose }: { registrationId: number; fatura: Fatura; hoje: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [data, setData] = useState(hoje)
  const [r, setR] = useState<Resultado | null>(null)
  const m = useMutation({
    mutationFn: () => api.post<Resultado>(`/admin/enrollment-registrations/${registrationId}/faturas/atualizar`, { chave: fatura.chave, vencimento: data }),
    onSuccess: (res) => {
      setR(res)
      toast(`Fatura atualizada: vence em ${dia(res.vencimento)}`, 'success')
      // A inscrição, o Financeiro e a Inadimplência leem a mesma cobrança.
      void qc.invalidateQueries()
    },
    onError: (e: unknown) => toast((e as Error).message, 'danger'),
  })
  const copiar = (t: string, o: string) => navigator.clipboard.writeText(t).then(() => toast(`${o} copiado`, 'success')).catch(() => toast('Não foi possível copiar', 'danger'))
  const wa = r?.mensagem.whatsapp ? r.mensagem.whatsapp.replace(/\D/g, '') : ''

  return (
    <Modal
      open onOpenChange={(o) => { if (!o) onClose() }}
      title={r ? 'Fatura atualizada' : 'Atualizar fatura vencida'}
      description={`${fatura.titulo} · ${brl(fatura.valor)} · venceu em ${dia(fatura.vencimento)}`}
      size="md"
      footer={r ? (
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          {r.link && <Button variant="secondary" size="sm" onClick={() => copiar(r.link!, 'Link')}><Copy size={12} /> Copiar link</Button>}
          <Button size="sm" onClick={() => copiar(r.mensagem.texto, 'Mensagem')}><Copy size={12} /> Copiar mensagem</Button>
        </div>
      ) : (
        <div class="flex justify-end gap-2 w-full">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={m.isPending || !data} onClick={() => m.mutate()}>{m.isPending ? 'Atualizando…' : 'Atualizar fatura'}</Button>
        </div>
      )}
    >
      {!r ? (
        <div class="space-y-3">
          <Input label="Novo vencimento" type="date" value={data} min={hoje} max={somarDias(hoje, 60)} onInput={(e) => setData((e.target as HTMLInputElement).value)} />
          <div class="text-xs text-fg-muted space-y-1">
            <div>A cobrança continua a mesma no Asaas, com o mesmo link: só a data muda, e o boleto e o Pix são renovados.</div>
            <div>O valor fica igual ({brl(fatura.valor)}), sem multa nem juros.</div>
          </div>
        </div>
      ) : (
        <div class="space-y-3">
          <div class="text-sm">Novo vencimento: <strong>{dia(r.vencimento)}</strong> · {brl(r.valor)}</div>
          <Textarea label="Mensagem para o aluno" rows={8} value={r.mensagem.texto} readOnly />
          <div class="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-1">
            <span>Copie e envie pela conversa do aluno:</span>
            {r.mensagem.leadId && <a class="text-accent hover:underline inline-flex items-center gap-1" href={`/app/leads/${r.mensagem.leadId}`}><MessageCircle size={11} /> Abrir lead</a>}
            {wa && <a class="text-accent hover:underline inline-flex items-center gap-1" href={`https://wa.me/${wa}?text=${encodeURIComponent(r.mensagem.texto)}`} target="_blank" rel="noopener"><ExternalLink size={11} /> WhatsApp Web</a>}
          </div>
        </div>
      )}
    </Modal>
  )
}
