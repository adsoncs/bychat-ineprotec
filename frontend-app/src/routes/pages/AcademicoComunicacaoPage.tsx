import { useEffect, useState } from 'preact/hooks'
import { MessageSquare, Play, RefreshCw } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useComunicacaoConfig, useComunicacaoConfigMut, useComunicacaoLog, useComunicacaoAcoes, TIPO_COM_LABEL, type NotifConfig } from '@/hooks/useAcaComunicacao'

export function AcademicoComunicacaoPage() {
  return (
    <Page title="Comunicação" description="Avisos automáticos ao aluno por WhatsApp e e-mail (vencimento, notas).">
      <div class="grid gap-4 lg:grid-cols-2">
        <ConfigCard />
        <AcoesCard />
      </div>
      <LogCard />
    </Page>
  )
}

function ConfigCard() {
  const cfg = useComunicacaoConfig()
  const mut = useComunicacaoConfigMut()
  const [f, setF] = useState<NotifConfig | null>(null)
  useEffect(() => { if (cfg.data?.config) setF(cfg.data.config) }, [cfg.data?.config])

  if (!f) return <Card><Skeleton class="h-48 w-full" /></Card>
  const set = (p: Partial<NotifConfig>) => setF({ ...f, ...p })
  return (
    <Card class="space-y-3">
      <h3 class="text-xs font-semibold uppercase text-fg-muted">Configuração</h3>
      <label class="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={f.vencimentoEnabled} onChange={(e) => set({ vencimentoEnabled: (e.target as HTMLInputElement).checked })} /> Lembrete automático de vencimento</label>
      <div class="grid grid-cols-2 gap-2">
        <Input label="Dias de antecedência" type="number" value={String(f.vencimentoDiasAntes)} onInput={(e) => set({ vencimentoDiasAntes: Number((e.target as HTMLInputElement).value) })} />
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">Canal</label>
          <Select value={f.canal} onChange={(e) => set({ canal: (e.target as HTMLSelectElement).value })}>
            <option value="ambos">WhatsApp + E-mail</option>
            <option value="whatsapp">Somente WhatsApp</option>
            <option value="email">Somente E-mail</option>
          </Select>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-fg-muted mb-1">Mensagem de vencimento</label>
        <Textarea rows={3} value={f.msgVencimento} onInput={(e) => set({ msgVencimento: (e.target as HTMLTextAreaElement).value })} />
      </div>
      <div>
        <label class="block text-xs font-medium text-fg-muted mb-1">Mensagem de notas publicadas</label>
        <Textarea rows={2} value={f.msgNotas} onInput={(e) => set({ msgNotas: (e.target as HTMLTextAreaElement).value })} />
      </div>
      <div class="border-t border-border pt-3 space-y-2">
        <label class="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={f.reguaEnabled} onChange={(e) => set({ reguaEnabled: (e.target as HTMLInputElement).checked })} /> Régua de cobrança (parcelas vencidas)</label>
        <Input label="Dias após o vencimento (separados por vírgula)" value={f.diasPos} onInput={(e) => set({ diasPos: (e.target as HTMLInputElement).value })} placeholder="1,7,15" />
        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">Mensagem de cobrança</label>
          <Textarea rows={3} value={f.msgCobranca} onInput={(e) => set({ msgCobranca: (e.target as HTMLTextAreaElement).value })} />
        </div>
      </div>
      <p class="text-[11px] text-fg-subtle">Variáveis: {'{nome} {curso} {parcela} {valor} {vencimento} {atraso} {link}'}</p>
      <div class="flex justify-end">
        <Button variant="primary" size="sm" disabled={mut.isPending} onClick={() => mut.mutate(f)}>Salvar configuração</Button>
      </div>
    </Card>
  )
}

function AcoesCard() {
  const acoes = useComunicacaoAcoes()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card class="space-y-3 self-start">
      <h3 class="text-xs font-semibold uppercase text-fg-muted">Disparos manuais</h3>
      <p class="text-xs text-fg-muted">A varredura de vencimentos também roda automaticamente a cada 6h.</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={acoes.varrerVencimentos.isPending} onClick={() => acoes.varrerVencimentos.mutate(undefined, { onSuccess: (r) => setMsg(`Vencimentos: ${r.verificadas} parcela(s), ${r.enviados} aviso(s).`) })}>
          <Play size={14} /> Varrer vencimentos
        </Button>
        <Button variant="secondary" size="sm" disabled={acoes.varrerInadimplencia.isPending} onClick={() => acoes.varrerInadimplencia.mutate(undefined, { onSuccess: (r) => setMsg(`Cobranças: ${r.verificadas} parcela(s), ${r.enviados} aviso(s).`) })}>
          <Play size={14} /> Varrer cobranças (régua)
        </Button>
      </div>
      {msg && <p class="text-xs text-success">{msg}</p>}
      <p class="text-[11px] text-fg-subtle">Para avisar notas publicadas, use o botão na tela de Conselho de Classe.</p>
    </Card>
  )
}

function LogCard() {
  const log = useComunicacaoLog()
  return (
    <Card class="p-0 overflow-hidden mt-4">
      <div class="px-4 py-2 bg-surface-2 text-xs text-fg-muted flex items-center justify-between">
        <span class="flex items-center gap-1"><MessageSquare size={13} /> Histórico de envios</span>
        <button class="text-fg-muted hover:text-accent" onClick={() => log.refetch()}><RefreshCw size={13} /></button>
      </div>
      {log.isLoading ? <Skeleton class="h-24 w-full" /> : (log.data?.itens ?? []).length === 0 ? <p class="text-xs text-fg-muted p-4">Nenhum envio registrado.</p> : (
        <table class="w-full text-sm">
          <thead class="bg-surface text-xs text-fg-muted"><tr><th class="text-left p-2">Quando</th><th class="text-left p-2">Tipo</th><th class="text-left p-2">Canal</th><th class="text-left p-2">Destino</th><th class="text-left p-2">Status</th></tr></thead>
          <tbody class="divide-y divide-border">
            {(log.data?.itens ?? []).map((i) => (
              <tr key={i.id} class="hover:bg-surface-2">
                <td class="p-2 text-xs text-fg-muted">{new Date(i.createdAt).toLocaleString('pt-BR')}</td>
                <td class="p-2">{TIPO_COM_LABEL[i.tipo] ?? i.tipo}</td>
                <td class="p-2 text-fg-muted">{i.canal}</td>
                <td class="p-2 text-xs text-fg-muted truncate max-w-[12rem]">{i.destino}</td>
                <td class="p-2"><Badge tone={i.status === 'ENVIADO' ? 'success' : 'danger'}>{i.status === 'ENVIADO' ? 'Enviado' : 'Falha'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
