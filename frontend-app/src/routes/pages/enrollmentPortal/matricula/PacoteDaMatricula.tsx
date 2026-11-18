// Aba Financeiro: matrícula em PACOTE (combo). Dois ou mais cursos da mesma
// pessoa, cada um com a sua inscrição, o seu valor e o seu contrato, e UM
// pagamento só — feito pela inscrição principal. Nenhuma mensagem sai sozinha.
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useCan } from '@/hooks/usePermissions'
import { invalidarInscricao } from './Dispensa'

interface Membro { id: number; codigo: string; curso: string; valorCentavos: number; pago: boolean; status: string | null }
type Pacote =
  | { papel: 'principal'; codigo: string; curso: string; valorProprioCentavos: number; totalCentavos: number; membros: Membro[] }
  | { papel: 'membro'; codigo: string; principalId: number; principalPortalId: number | null; principalCodigo: string; principalCurso: string; valorCentavos: number; totalCentavos: number | null; pago: boolean }
interface Resposta { pacote: Pacote | null; candidatas: Array<{ id: number; codigo: string; curso: string; impedimento: string | null }> }

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const centavos = (s: string) => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0 }

/** Para a Aba Financeiro esconder o checkout quando o curso é membro de um pacote. */
export function usePacote(registrationId: number) {
  const podeVer = useCan('edu_valor_personalizado', 'view')
  return useQuery({
    queryKey: ['mi-pacote', registrationId],
    queryFn: () => api.get<Resposta>(`/admin/matricula-interna/${registrationId}/pacote`),
    enabled: podeVer,
  })
}

export function PacoteDaMatricula({ registrationId, fechada }: { registrationId: number; fechada: boolean }) {
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const pode = useCan('edu_valor_personalizado', 'edit')
  const q = usePacote(registrationId)
  const [abrir, setAbrir] = useState(false)
  const [membroId, setMembroId] = useState('')
  const [valorEste, setValorEste] = useState('')
  const [valorOutro, setValorOutro] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [sair, setSair] = useState(false)
  const base = `/admin/matricula-interna/${registrationId}/pacote`

  const atualizar = (outros: number[] = []) => {
    for (const id of [registrationId, ...outros]) {
      void qc.invalidateQueries({ queryKey: ['mi-pacote', id] })
      void qc.invalidateQueries({ queryKey: ['mi-financeiro', id] })
      invalidarInscricao(qc, id)
    }
  }
  const adicionar = useMutation({
    mutationFn: () => api.post(base, {
      membroId: Number(membroId), valorMembroCentavos: centavos(valorOutro),
      ...(valorEste.trim() ? { valorPrincipalCentavos: centavos(valorEste) } : {}),
    }),
    onSuccess: () => {
      setConfirmar(false); setAbrir(false); atualizar([Number(membroId)])
      setMembroId(''); setValorEste(''); setValorOutro('')
      toast('Curso adicionado ao pacote. O pagamento é feito por esta inscrição.', 'success')
    },
    onError: (e: unknown) => { setConfirmar(false); toast((e as Error).message, 'danger') },
  })
  const remover = useMutation({
    mutationFn: () => api.delete(base),
    onSuccess: () => { setSair(false); atualizar(q.data?.pacote?.papel === 'membro' ? [q.data.pacote.principalId] : []); toast('Curso retirado do pacote.', 'success') },
    onError: (e: unknown) => { setSair(false); toast((e as Error).message, 'danger') },
  })

  if (!q.data) return null
  const { pacote, candidatas } = q.data
  const livres = candidatas.filter((c) => !c.impedimento)
  const escolhida = candidatas.find((c) => String(c.id) === membroId)
  const principal = pacote?.papel === 'principal' ? pacote : null
  const valorPrincipalAtual = principal ? principal.valorProprioCentavos : 0
  const totalPrevisto = (valorEste.trim() ? centavos(valorEste) : valorPrincipalAtual) + centavos(valorOutro) + (principal ? principal.membros.reduce((s, m) => s + m.valorCentavos, 0) : 0)

  // Curso membro: o pagamento é na principal.
  if (pacote?.papel === 'membro') {
    return (
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-xs uppercase tracking-wider text-fg-muted">Pacote</div>
            <div class="text-sm text-fg mt-0.5">
              Este curso faz parte do pacote <strong>{pacote.principalCodigo}</strong> ({pacote.principalCurso}).
              O pagamento é um só, feito por aquela inscrição.
            </div>
            <div class="text-sm text-fg mt-1">
              Parte deste curso: <strong class="tabular-nums">{brl(pacote.valorCentavos)}</strong>
              {pacote.totalCentavos ? <span class="text-fg-muted"> de {brl(pacote.totalCentavos)} do pacote</span> : null}
            </div>
          </div>
          <Badge tone={pacote.pago ? 'success' : 'info'}>{pacote.pago ? 'Pago pelo pacote' : 'Aguardando o pagamento do pacote'}</Badge>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">
          {pacote.principalPortalId && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/enrollment-portals/${pacote.principalPortalId}/registrations/${pacote.principalId}`)}>
              Abrir o financeiro do pacote
            </Button>
          )}
          {pode && !pacote.pago && !fechada && <Button size="sm" variant="ghost" onClick={() => setSair(true)}>Tirar do pacote</Button>}
        </div>
        <ConfirmDialog
          open={sair} title="Tirar este curso do pacote?"
          description={`O curso volta a ter financeiro próprio, separado de ${pacote.principalCodigo}. Lembre de ajustar o valor da inscrição principal.`}
          confirmLabel="Tirar do pacote" onConfirm={() => remover.mutate()} onOpenChange={(v: boolean) => { if (!v) setSair(false) }}
        />
      </Card>
    )
  }

  // Sem pacote e sem outra inscrição da pessoa: nada a oferecer.
  if (!principal && !livres.length) return null

  return (
    <Card>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-xs uppercase tracking-wider text-fg-muted">Pacote (combo)</div>
          {principal ? (
            <div class="text-sm text-fg mt-0.5">Um pagamento só para {principal.membros.length + 1} cursos, cada um com o seu contrato.</div>
          ) : (
            <div class="text-sm text-fg-muted mt-0.5">Esta pessoa tem outra inscrição. Junte num pacote para cobrar uma vez só, cada curso com o seu valor e o seu contrato.</div>
          )}
        </div>
        {pode && !fechada && livres.length > 0 && !abrir && <Button size="sm" variant="secondary" onClick={() => setAbrir(true)}>Adicionar curso ao pacote</Button>}
      </div>

      {principal && (
        <table class="w-full text-sm mt-3">
          <tbody class="divide-y divide-border">
            <tr><td class="py-1.5">{principal.curso} <span class="text-fg-muted text-2xs">{principal.codigo} · esta inscrição</span></td><td class="py-1.5 text-right tabular-nums">{brl(principal.valorProprioCentavos)}</td><td /></tr>
            {principal.membros.map((m) => (
              <tr key={m.id}>
                <td class="py-1.5">{m.curso} <span class="text-fg-muted text-2xs">{m.codigo}</span></td>
                <td class="py-1.5 text-right tabular-nums">{brl(m.valorCentavos)}</td>
                <td class="py-1.5 pl-3 text-right"><Badge tone={m.pago ? 'success' : 'neutral'}>{m.pago ? 'Pago pelo pacote' : 'Aguardando'}</Badge></td>
              </tr>
            ))}
            <tr class="font-semibold"><td class="py-1.5">Total do pacote</td><td class="py-1.5 text-right tabular-nums">{brl(principal.totalCentavos)}</td><td /></tr>
          </tbody>
        </table>
      )}
      {principal && <div class="text-2xs text-fg-muted mt-2">O financeiro desta inscrição (checkout, pagamento combinado ou baixa manual) deve somar o total do pacote. O 1º pagamento recebido marca todos os cursos como pagos.</div>}

      {abrir && (
        <div class="grid gap-3 mt-3 border-t border-border pt-3">
          <div class="grid sm:grid-cols-3 gap-3">
            <Select label="Curso a adicionar" value={membroId} onChange={(e: any) => setMembroId(e.currentTarget.value)}>
              <option value="">Escolha…</option>
              {candidatas.map((c) => <option key={c.id} value={c.id} disabled={!!c.impedimento}>{c.curso} — {c.codigo}{c.impedimento ? ` (${c.impedimento})` : ''}</option>)}
            </Select>
            <Input label={principal ? 'Parte deste curso (opcional)' : 'Parte deste curso (R$)'} placeholder={principal ? brl(valorPrincipalAtual) : '0,00'} value={valorEste} onInput={(e: any) => setValorEste(e.currentTarget.value)} />
            <Input label="Parte do curso adicionado (R$)" placeholder="0,00" value={valorOutro} onInput={(e: any) => setValorOutro(e.currentTarget.value)} />
          </div>
          <div class="text-xs text-fg-muted">Total do pacote: <strong class="tabular-nums text-fg">{brl(totalPrevisto)}</strong>. Cada contrato sai com a parte do seu curso e diz que o pagamento é único.</div>
          <div class="flex gap-2">
            <Button size="sm" disabled={!membroId || centavos(valorOutro) <= 0 || (!principal && centavos(valorEste) <= 0)} onClick={() => setConfirmar(true)}>Adicionar ao pacote</Button>
            <Button size="sm" variant="ghost" onClick={() => setAbrir(false)}>Cancelar</Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmar} title="Adicionar ao pacote?"
        description={`${escolhida?.curso ?? 'O curso'} (${escolhida?.codigo ?? ''}) passa a ser pago por esta inscrição, sem cobrança própria. Total do pacote: ${brl(totalPrevisto)}.`}
        confirmLabel="Adicionar" onConfirm={() => adicionar.mutate()} onOpenChange={(v: boolean) => { if (!v) setConfirmar(false) }}
      />
    </Card>
  )
}
