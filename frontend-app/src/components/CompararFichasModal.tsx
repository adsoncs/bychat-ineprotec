// Comparação de duas fichas da mesma pessoa (Leads › Duplicados).
// Mostra as duas lado a lado, o que o sistema recomenda (juntar, ligar como
// mesma pessoa ou revisar), os valores em conflito para escolher qual fica e,
// sob pedido, o parecer da IA. Backend: services/juncaoSegura.ts.

import { useEffect, useState } from 'preact/hooks'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter-preact'
import { GitMerge, Link2, Sparkles, ExternalLink } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/format'

interface Ficha {
  id: number; uid: string | null; nome: string | null; whatsapp: string | null; email: string | null; cidade: string | null
  cpf: string | null; origem: string | null; criadaEm: string
  funil: string | null; etapa: string | null; equipe: string | null; responsavel: string | null
  mensagens: number; propostas: number; inscricoes: Array<{ candidateCode: string; status: string; paymentStatus: string | null }>
  aluno: boolean; atendimentoHumano: string | null
  ultimasMensagens: Array<{ de: string; texto: string; em: string }>
}
interface Parecer { mesmaPessoa: string; mesmoAssunto: string; recomendacao: 'juntar' | 'ligar' | 'separar'; motivo: string; em?: string }
interface Comparacao {
  a: Ficha; b: Ficha
  conflitos: Array<{ campo: string; a: unknown; b: unknown }>
  sugestao: { acao: 'juntar' | 'ligar' | 'revisar'; motivo: string }
  parecerIa: Parecer | null
}

const ACAO: Record<string, { rotulo: string; tom: 'success' | 'info' | 'warning' | 'danger' }> = {
  juntar: { rotulo: 'Juntar', tom: 'success' },
  ligar: { rotulo: 'Mesma pessoa, assuntos diferentes', tom: 'info' },
  revisar: { rotulo: 'Revisar com cuidado', tom: 'warning' },
  separar: { rotulo: 'Pessoas diferentes', tom: 'danger' },
}
const nomeDoCampo = (c: string) => c.startsWith('campo:') ? c.slice(6) : ({ nome: 'Nome', email: 'E-mail', cidade: 'Cidade', empresa: 'Empresa', segmento: 'Segmento', whatsapp: 'WhatsApp', solucaoNome: 'Solução', maturidade: 'Maturidade' } as Record<string, string>)[c] ?? c
const valor = (v: unknown) => v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v)

export function CompararFichasModal({ a, b, onClose, onDone }: { a: number; b: number; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['comparar-fichas', a, b],
    queryFn: () => api.get<Comparacao>(`/bychat/leads/duplicates/compare?a=${a}&b=${b}`),
  })
  const [fica, setFica] = useState<number>(a)
  const [escolhas, setEscolhas] = useState<Record<string, 'a' | 'b'>>({})
  const [parecer, setParecer] = useState<Parecer | null>(null)
  useEffect(() => { if (data?.parecerIa) setParecer(data.parecerIa) }, [data])

  const pedirParecer = useMutation({
    mutationFn: () => api.post<Parecer>('/bychat/leads/duplicates/parecer', { a, b }),
    onSuccess: (p) => setParecer(p),
    onError: (e: any) => toast(e?.message || 'Não foi possível pedir o parecer', 'danger'),
  })
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['lead-duplicates-groups'] })
    void qc.invalidateQueries({ queryKey: ['lead-duplicates-count'] })
    void qc.invalidateQueries({ queryKey: ['leads'] })
  }
  const juntar = useMutation({
    mutationFn: () => {
      const absorvida = fica === a ? b : a
      const valores: Record<string, unknown> = {}
      for (const c of data?.conflitos ?? []) {
        const lado = escolhas[c.campo] ?? (fica === a ? 'a' : 'b')
        valores[c.campo] = lado === 'a' ? c.a : c.b
      }
      return api.post('/bychat/leads/merge', { masterId: fica, mergeIds: [absorvida], escolhas: valores })
    },
    onSuccess: () => { toast('Fichas juntadas. Dá para desfazer pela Lixeira.', 'success'); atualizar(); onDone() },
    onError: (e: any) => toast(e?.message || 'Erro ao juntar', 'danger'),
  })
  const ligar = useMutation({
    mutationFn: () => api.post('/bychat/leads/duplicates/link', { principal: a, outras: [b] }),
    onSuccess: () => { toast('Fichas ligadas como mesma pessoa. Cada uma segue no seu funil.', 'success'); atualizar(); onDone() },
    onError: (e: any) => toast(e?.message || 'Erro ao ligar', 'danger'),
  })

  const ocupado = juntar.isPending || ligar.isPending

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Comparar fichas" description="Confira se é a mesma pessoa e o mesmo assunto antes de decidir." size="xl" unconstrained
      footer={data && (
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button variant="secondary" onClick={() => ligar.mutate()} loading={ligar.isPending} disabled={ocupado}>
            <Link2 size={14} /> Mesma pessoa, assuntos diferentes
          </Button>
          <Button onClick={() => juntar.mutate()} loading={juntar.isPending} disabled={ocupado}>
            <GitMerge size={14} /> Juntar em #{fica}
          </Button>
        </div>
      )}>
      {isLoading && <Skeleton class="h-64" />}
      {error && <div class="text-sm text-danger">{(error as any)?.message || 'Erro ao carregar'}</div>}
      {data && (
        <div class="space-y-4">
          <div class="rounded-md border border-border p-3 flex flex-wrap items-start gap-2">
            <span class="text-xs text-fg-muted">O sistema recomenda:</span>
            <Badge tone={ACAO[data.sugestao.acao]?.tom ?? 'neutral'}>{ACAO[data.sugestao.acao]?.rotulo}</Badge>
            <span class="text-xs text-fg-muted w-full">{data.sugestao.motivo}</span>
          </div>

          <div class="rounded-md border border-border p-3">
            {parecer ? (
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <Sparkles size={14} class="text-accent" />
                  <span class="text-xs text-fg-muted">Parecer da IA:</span>
                  <Badge tone={ACAO[parecer.recomendacao]?.tom ?? 'neutral'}>{ACAO[parecer.recomendacao]?.rotulo ?? parecer.recomendacao}</Badge>
                  <span class="text-3xs text-fg-muted">mesma pessoa: {parecer.mesmaPessoa} · mesmo assunto: {parecer.mesmoAssunto}</span>
                </div>
                <div class="text-xs">{parecer.motivo}</div>
              </div>
            ) : (
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs text-fg-muted">A IA pode ler as duas fichas e as conversas e dar um parecer. Cada pedido consome IA.</span>
                <Button size="sm" variant="secondary" onClick={() => pedirParecer.mutate()} loading={pedirParecer.isPending}>
                  <Sparkles size={14} /> Pedir parecer da IA
                </Button>
              </div>
            )}
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[data.a, data.b].map((f) => (
              <label key={f.id} class={`rounded-md border p-3 space-y-2 cursor-pointer ${fica === f.id ? 'border-info bg-info/5' : 'border-border'}`}>
                <div class="flex items-center gap-2">
                  <input type="radio" name="fica" checked={fica === f.id} onChange={() => setFica(f.id)} />
                  <span class="font-medium text-sm truncate">{f.nome || `Ficha #${f.id}`}</span>
                  <Link href={`/app/leads/${f.id}`} class="ml-auto text-xs text-info inline-flex items-center gap-1">#{f.id} <ExternalLink size={11} /></Link>
                </div>
                {fica === f.id && <div class="text-3xs text-info">Esta ficha fica; a outra é juntada nela.</div>}
                <div class="text-xs grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
                  <span class="text-fg-muted">Funil</span><span>{f.funil || '—'}{f.etapa ? ` · ${f.etapa}` : ''}</span>
                  <span class="text-fg-muted">Equipe</span><span>{f.equipe || '—'}</span>
                  <span class="text-fg-muted">Responsável</span><span>{f.responsavel || '—'}</span>
                  <span class="text-fg-muted">WhatsApp</span><span>{f.whatsapp || '—'}</span>
                  <span class="text-fg-muted">E-mail</span><span class="truncate">{f.email || '—'}</span>
                  <span class="text-fg-muted">CPF</span><span>{f.cpf || '—'}</span>
                  <span class="text-fg-muted">Origem</span><span>{f.origem || '—'} · {formatDateTime(f.criadaEm)}</span>
                  <span class="text-fg-muted">Histórico</span><span>{f.mensagens} mensagens · {f.propostas} propostas{f.aluno ? ' · aluno' : ''}</span>
                  <span class="text-fg-muted">Inscrições</span><span>{f.inscricoes.map((i) => `${i.candidateCode} (${i.status})`).join(', ') || '—'}</span>
                </div>
                {f.atendimentoHumano && <Badge tone="warning">Em atendimento com {f.atendimentoHumano}</Badge>}
                {f.ultimasMensagens.length > 0 && (
                  <div class="border-t border-border pt-2 space-y-1 max-h-40 overflow-auto">
                    {f.ultimasMensagens.map((m, i) => (
                      <div key={i} class="text-2xs"><span class="text-fg-muted">{m.de}:</span> {m.texto}</div>
                    ))}
                  </div>
                )}
              </label>
            ))}
          </div>

          {data.conflitos.length > 0 && (
            <div class="rounded-md border border-border p-3 space-y-2">
              <div class="text-xs text-fg-muted">Valores diferentes: escolha qual fica. O outro não se perde, é guardado na ficha como "valor anterior".</div>
              {data.conflitos.map((c) => {
                const lado = escolhas[c.campo] ?? (fica === a ? 'a' : 'b')
                return (
                  <div key={c.campo} class="grid grid-cols-[8rem_1fr_1fr] gap-2 items-center text-xs">
                    <span class="text-fg-muted">{nomeDoCampo(c.campo)}</span>
                    {(['a', 'b'] as const).map((l) => (
                      <label key={l} class={`rounded border px-2 py-1 cursor-pointer truncate ${lado === l ? 'border-info bg-info/5' : 'border-border'}`}>
                        <input type="radio" class="mr-1" name={`c-${c.campo}`} checked={lado === l} onChange={() => setEscolhas((e) => ({ ...e, [c.campo]: l }))} />
                        {valor(l === 'a' ? c.a : c.b)}
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
