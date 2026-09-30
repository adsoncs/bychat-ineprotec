import { useState, useEffect } from 'preact/hooks'
import { AlertTriangle, GitMerge, Info } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { paymentStatusLabel } from '@/lib/paymentLabels'
import {
  usePortalDuplicates, useMergeRegistrations, useKeepSeparate,
  type GrupoDuplicidade, type MembroDuplicidade,
} from '@/hooks/useEnrollmentPortals'

const MOTIVO: Record<string, string> = { cpf: 'mesmo CPF', tel: 'mesmo WhatsApp', email: 'mesmo e-mail' }

const data = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * Faixa no topo da aba Inscrições quando há possível duplicidade — o aviso
 * precisa estar onde a secretaria já olha, não numa tela à parte.
 */
export function AvisoDuplicidade({ quantidade, onRevisar }: { quantidade: number; onRevisar: () => void }) {
  if (quantidade <= 0) return null
  return (
    <div class="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle size={16} class="shrink-0 text-warning" />
      <span class="flex-1 min-w-48 text-fg">
        <strong>{quantidade}</strong> inscriç{quantidade === 1 ? 'ão' : 'ões'} em possível duplicidade (mesma pessoa mais de uma vez).
      </span>
      <Button size="sm" variant="secondary" onClick={onRevisar}>
        <GitMerge size={12} /> Revisar e mesclar
      </Button>
    </div>
  )
}

/** Janela de revisão: um cartão por pessoa, com o que manter e o que mesclar. */
export function DuplicidadesModal({ portalId, onClose }: { portalId: number; onClose: () => void }) {
  const { data: resp, isLoading } = usePortalDuplicates(portalId)
  const grupos = resp?.grupos ?? []
  const vivos = grupos.filter((g) => !g.ignorado)
  const [mostrarDecididos, setMostrarDecididos] = useState(false)
  const lista = mostrarDecididos ? grupos : vivos

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Possíveis duplicidades"
      description="Inscrições da mesma pessoa neste portal, reconhecidas pelo CPF, WhatsApp ou e-mail. Escolha qual manter; as outras são mescladas nela."
      size="full"
    >
      <div class="space-y-3 max-w-5xl mx-auto">
        {isLoading && <Skeleton class="h-40 w-full" />}
        {!isLoading && vivos.length === 0 && (
          <div class="text-sm text-fg-muted text-center py-8">Nenhuma duplicidade pendente neste portal.</div>
        )}
        {lista.map((g) => <GrupoCard key={g.membros.map((m) => m.id).join('-')} portalId={portalId} grupo={g} />)}
        {grupos.length > vivos.length && (
          <button type="button" class="text-xs text-fg-muted underline" onClick={() => setMostrarDecididos((v) => !v)}>
            {mostrarDecididos ? 'Esconder' : 'Mostrar'} os {grupos.length - vivos.length} marcados como "manter separadas"
          </button>
        )}
      </div>
    </Modal>
  )
}

function GrupoCard({ portalId, grupo }: { portalId: number; grupo: GrupoDuplicidade }) {
  const merge = useMergeRegistrations(portalId)
  const keep = useKeepSeparate(portalId)
  const [principal, setPrincipal] = useState(grupo.sugestaoPrincipalId)
  // Por padrão todas as outras entram na mesclagem; a secretaria pode tirar alguma.
  const [incluidas, setIncluidas] = useState<Set<number>>(new Set(grupo.membros.map((m) => m.id)))
  const [confirmando, setConfirmando] = useState(false)
  useEffect(() => { setPrincipal(grupo.sugestaoPrincipalId) }, [grupo.sugestaoPrincipalId])

  const outras = grupo.membros.filter((m) => m.id !== principal && incluidas.has(m.id))
  // Paga nunca é descartada: o servidor recusa, e a tela avisa antes.
  const pagaDescartada = outras.find((m) => m.paga)
  const principalDados = grupo.membros.find((m) => m.id === principal)!

  function alternar(id: number) {
    setIncluidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function mesclar() {
    merge.mutate({ principalId: principal, outrasIds: outras.map((m) => m.id) }, {
      onSuccess: (r) => {
        toast(`${r.mescladas} inscriç${r.mescladas === 1 ? 'ão mesclada' : 'ões mescladas'} em ${principalDados.candidateCode}`, 'success')
        for (const a of r.avisos) toast(a, 'warning')
        setConfirmando(false)
      },
      onError: (e: unknown) => { toast((e as Error).message, 'danger'); setConfirmando(false) },
    })
  }

  return (
    <div class={`rounded-md border ${grupo.ignorado ? 'border-border opacity-70' : 'border-warning/40'} bg-surface p-3`}>
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="font-medium text-fg">{grupo.membros[0]?.nome || 'Sem nome'}</span>
        {grupo.porque.map((p) => (
          <span key={p} class="rounded bg-surface-3 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-fg-muted">{MOTIVO[p] ?? p}</span>
        ))}
        {grupo.ignorado && <span class="text-2xs text-fg-muted">· marcado como "manter separadas"</span>}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-left text-2xs uppercase tracking-wider text-fg-muted border-b border-border">
              <th class="py-1.5 px-2 font-medium">Manter</th>
              <th class="py-1.5 px-2 font-medium">Mesclar</th>
              <th class="py-1.5 px-2 font-medium">Código</th>
              <th class="py-1.5 px-2 font-medium">Criada</th>
              <th class="py-1.5 px-2 font-medium">Curso</th>
              <th class="py-1.5 px-2 font-medium">Pagamento</th>
              <th class="py-1.5 px-2 font-medium">Docs</th>
              <th class="py-1.5 px-2 font-medium">Contrato</th>
            </tr>
          </thead>
          <tbody>
            {grupo.membros.map((m: MembroDuplicidade) => (
              <tr key={m.id} class={`border-b border-border last:border-0 ${m.id === principal ? 'bg-success/5' : ''}`}>
                <td class="py-1.5 px-2">
                  <input type="radio" name={`principal-${grupo.sugestaoPrincipalId}`} checked={m.id === principal}
                    onChange={() => setPrincipal(m.id)} aria-label={`Manter ${m.candidateCode}`} />
                </td>
                <td class="py-1.5 px-2">
                  <input type="checkbox" disabled={m.id === principal} checked={m.id !== principal && incluidas.has(m.id)}
                    onChange={() => alternar(m.id)} aria-label={`Mesclar ${m.candidateCode}`} />
                </td>
                <td class="py-1.5 px-2">
                  <code class="text-fg">{m.candidateCode}</code>
                  {m.id === grupo.sugestaoPrincipalId && <span class="ml-1 text-2xs text-success">sugerida</span>}
                </td>
                <td class="py-1.5 px-2 text-fg-muted tabular-nums whitespace-nowrap">{data(m.criadaEm)}</td>
                <td class="py-1.5 px-2 text-fg-muted">{m.curso ?? '—'}</td>
                <td class={`py-1.5 px-2 ${m.paga ? 'text-success font-medium' : 'text-fg-muted'}`}>
                  {m.paga ? 'Pago' : m.paymentStatus ? paymentStatusLabel(m.paymentStatus) : '—'}
                </td>
                <td class="py-1.5 px-2 text-fg-muted tabular-nums">{m.documentos}</td>
                <td class="py-1.5 px-2 text-fg-muted">{m.contratoAceito ? 'aceito' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {grupo.outrosPortais.length > 0 && (
        <p class="mt-2 flex items-start gap-1.5 text-2xs text-fg-muted">
          <Info size={12} class="mt-0.5 shrink-0" />
          Também inscrita em outro portal ({grupo.outrosPortais.map((o) => `${o.portal}: ${o.candidateCode}`).join(', ')}) — pode ser outro curso; não entra aqui.
        </p>
      )}

      {pagaDescartada && (
        <p class="mt-2 text-xs text-danger">
          {pagaDescartada.candidateCode} já tem pagamento confirmado: escolha-a para manter ou tire-a da mesclagem.
        </p>
      )}

      {confirmando ? (
        <div class="mt-3 rounded-md border border-border bg-surface-2 p-3 text-xs space-y-2">
          <p class="text-fg">
            Mesclar <strong>{outras.map((m) => m.candidateCode).join(', ')}</strong> em <strong>{principalDados.candidateCode}</strong>:
          </p>
          <ul class="list-disc pl-5 text-fg-muted space-y-0.5">
            <li>as mescladas saem da lista e ficam como "Mesclada" (dá para desfazer);</li>
            <li>cobranças em aberto delas são <strong>canceladas no gateway</strong>;</li>
            <li>documentos que a {principalDados.candidateCode} ainda não tem passam para ela;</li>
            <li>os contatos (leads) são unidos num só — isso não tem volta.</li>
          </ul>
          <div class="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={merge.isPending}>Voltar</Button>
            <Button size="sm" variant="primary" onClick={mesclar} disabled={merge.isPending}>
              {merge.isPending ? 'Mesclando…' : 'Confirmar mesclagem'}
            </Button>
          </div>
        </div>
      ) : (
        <div class="mt-3 flex flex-wrap gap-2 justify-end">
          {!grupo.ignorado && (
            <Button size="sm" variant="ghost" disabled={keep.isPending}
              onClick={() => keep.mutate(grupo.membros.map((m) => m.id), {
                onSuccess: () => toast('Marcadas como pessoas/inscrições distintas', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}>
              Não é duplicidade — manter separadas
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={outras.length === 0 || !!pagaDescartada} onClick={() => setConfirmando(true)}>
            <GitMerge size={12} /> Mesclar {outras.length} em {principalDados.candidateCode}
          </Button>
        </div>
      )}
    </div>
  )
}
