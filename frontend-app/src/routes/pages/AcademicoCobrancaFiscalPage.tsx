import { useState } from 'preact/hooks'
import { Scale, Calculator, FileSpreadsheet, Plus, Download, Gavel } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useCDAs, useRegrasContabeis, useLancamentos, useNfseConfig, useCobrancaFiscalMut, CDA_STATUS } from '@/hooks/useAcaCobrancaFiscal'
import { useContasFin } from '@/hooks/useAcaFinBanco'
import { env } from '@/lib/env'

type Tab = 'divida' | 'contabil' | 'nfse'
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function AcademicoCobrancaFiscalPage() {
  const [tab, setTab] = useState<Tab>('divida')
  return (
    <Page title="Cobrança Judicial & Fiscal" description="Dívida ativa (CDA), integração contábil e geração de lote de NFS-e.">
      <div class="flex gap-1 border-b border-border">
        {([['divida', 'Dívida ativa'], ['contabil', 'Contábil'], ['nfse', 'NFS-e']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} class={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'divida' && <DividaTab />}
      {tab === 'contabil' && <ContabilTab />}
      {tab === 'nfse' && <NfseTab />}
    </Page>
  )
}

function DividaTab() {
  const [status, setStatus] = useState('')
  const data = useCDAs(status)
  const mut = useCobrancaFiscalMut()
  const [dias, setDias] = useState('90')
  const [preview, setPreview] = useState<{ total: number; parcelas: number } | null>(null)
  const cdas = data.data?.cdas ?? []
  const counts = data.data?.counts ?? {}

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Scale size={16} /> Inscrever em dívida ativa</div>
        <div class="flex items-end gap-2 flex-wrap">
          <Input label="Vencidas há mais de (dias)" type="number" class="!w-44" value={dias} onInput={(e: any) => setDias(e.currentTarget.value)} />
          <Button size="sm" variant="ghost" onClick={() => mut.inscreverDA.mutate({ diasMin: Number(dias), dryRun: true }, { onSuccess: (d) => setPreview({ total: d.total, parcelas: d.parcelas ?? 0 }) })}>Pré-visualizar</Button>
          {preview && <span class="text-sm text-fg-muted">{preview.total} aluno(s) · {preview.parcelas} parcela(s)</span>}
          {preview && preview.total > 0 && <Button size="sm" variant="primary" loading={mut.inscreverDA.isPending} onClick={() => mut.inscreverDA.mutate({ diasMin: Number(dias), dryRun: false }, { onSuccess: () => setPreview(null) })}>Inscrever {preview.total} CDA(s)</Button>}
        </div>
      </Card>

      <div class="flex flex-wrap gap-1">
        <button class={`text-xs px-2 py-1 rounded border ${status === '' ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus('')}>Todas</button>
        {Object.keys(CDA_STATUS).map((s) => <button key={s} class={`text-xs px-2 py-1 rounded border ${status === s ? 'bg-surface-2 border-border' : 'border-transparent text-fg-muted'}`} onClick={() => setStatus(s)}>{CDA_STATUS[s].label} ({counts[s] ?? 0})</button>)}
      </div>

      {data.isLoading ? <Skeleton class="h-24 w-full" /> : cdas.length === 0 ? <EmptyState icon={<Scale size={26} />} title="Sem CDAs" description="Inscreva parcelas vencidas em dívida ativa acima." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {cdas.map((c) => (
            <div key={c.id} class="px-4 py-3 flex items-center gap-3 text-sm">
              <span class="flex-1 min-w-0">
                <span class="block truncate text-fg"><code class="text-xs">{c.numero}</code> · {c.alunoNome}</span>
                <span class="block text-xs text-fg-muted">{brl(c.valorCentavos)} · {c.qtdParcelas} parcela(s){c.bloqueioJudicial ? ' · bloqueio judicial' : ''}</span>
              </span>
              <Badge tone={CDA_STATUS[c.status]?.tone ?? 'neutral'}>{CDA_STATUS[c.status]?.label ?? c.status}</Badge>
              {c.status === 'INSCRITA' && <Button size="sm" variant="ghost" onClick={() => mut.atualizarCDA.mutate({ id: c.id, status: 'AJUIZADA' })}><Gavel size={13} /> Ajuizar</Button>}
              {(c.status === 'INSCRITA' || c.status === 'AJUIZADA') && <>
                <Button size="sm" variant="ghost" onClick={() => mut.atualizarCDA.mutate({ id: c.id, status: 'QUITADA' })}>Quitar</Button>
                <Button size="sm" variant="ghost" onClick={() => mut.atualizarCDA.mutate({ id: c.id, status: 'CANCELADA' })}>Cancelar</Button>
              </>}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function ContabilTab() {
  const regras = useRegrasContabeis()
  const lanc = useLancamentos()
  const contas = useContasFin()
  const mut = useCobrancaFiscalMut()
  const [r, setR] = useState({ evento: 'PARCELA_PAGA', historico: 'Receb. {aluno} parcela {parcela} {valor}', contaDebitoId: '', contaCreditoId: '' })
  const [prev, setPrev] = useState<{ total: number } | null>(null)

  const addRegra = () => { if (!r.historico) return; mut.criarRegra.mutate({ ...r, contaDebitoId: r.contaDebitoId || null, contaCreditoId: r.contaCreditoId || null }, { onSuccess: () => setR({ ...r, historico: 'Receb. {aluno} parcela {parcela} {valor}' }) }) }
  const contaNome = (id: number | null) => (contas.data ?? []).find((c) => c.id === id)?.nome ?? '—'

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><Calculator size={16} /> Regras contábeis</div>
        <div class="grid sm:grid-cols-4 gap-2">
          <Select value={r.evento} onChange={(e: any) => setR({ ...r, evento: e.currentTarget.value })}><option value="PARCELA_PAGA">Parcela paga</option></Select>
          <Select value={r.contaDebitoId} onChange={(e: any) => setR({ ...r, contaDebitoId: e.currentTarget.value })}><option value="">Débito…</option>{(contas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</Select>
          <Select value={r.contaCreditoId} onChange={(e: any) => setR({ ...r, contaCreditoId: e.currentTarget.value })}><option value="">Crédito…</option>{(contas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</Select>
          <Button size="sm" variant="secondary" disabled={!r.historico || mut.criarRegra.isPending} onClick={addRegra}><Plus size={14} /> Regra</Button>
        </div>
        <Input label="Histórico (use {aluno} {parcela} {valor} {data})" value={r.historico} onInput={(e: any) => setR({ ...r, historico: e.currentTarget.value })} />
        {(regras.data?.regras ?? []).length > 0 && (
          <div class="divide-y divide-border text-sm">
            {(regras.data?.regras ?? []).map((rg) => <div key={rg.id} class="py-1.5 flex gap-2"><Badge tone="neutral">{rg.evento}</Badge><span class="flex-1">{rg.historico} <span class="text-xs text-fg-muted">· D:{contaNome(rg.contaDebitoId)} / C:{contaNome(rg.contaCreditoId)}</span></span>{!rg.ativo && <Badge tone="danger">inativa</Badge>}</div>)}
          </div>
        )}
      </Card>

      <Card class="space-y-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-sm font-semibold text-fg">Lançamentos</div>
          <div class="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => mut.contabilizar.mutate({ dryRun: true }, { onSuccess: (d) => setPrev({ total: d.total }) })}>Pré-visualizar</Button>
            {prev && <span class="text-sm text-fg-muted">{prev.total} a contabilizar</span>}
            {prev && prev.total > 0 && <Button size="sm" variant="primary" loading={mut.contabilizar.isPending} onClick={() => mut.contabilizar.mutate({ dryRun: false }, { onSuccess: () => setPrev(null) })}>Contabilizar</Button>}
            <a href={`${env.apiBase}/admin/aca/cobranca-fiscal/lancamentos/export.csv`} target="_blank" rel="noopener"><Button size="sm" variant="secondary"><Download size={13} /> CSV</Button></a>
          </div>
        </div>
        {lanc.isLoading ? <Skeleton class="h-24 w-full" /> : (lanc.data?.lancamentos ?? []).length === 0 ? <p class="text-sm text-fg-muted">Nenhum lançamento. Crie uma regra e contabilize as parcelas pagas.</p> : (
          <div class="divide-y divide-border text-sm max-h-96 overflow-auto">
            {(lanc.data?.lancamentos ?? []).map((l) => (
              <div key={l.id} class="py-1.5 flex items-center gap-2">
                <span class="text-xs text-fg-muted w-20 shrink-0">{new Date(l.data).toLocaleDateString('pt-BR')}</span>
                <span class="flex-1 min-w-0 truncate">{l.historico}</span>
                <span class="text-fg-muted">{brl(l.valorCentavos)}</span>
                <Button size="sm" variant="ghost" onClick={() => mut.desfazer.mutate(l.id)}>Desfazer</Button>
              </div>
            ))}
          </div>
        )}
        {(lanc.data?.lancamentos ?? []).length > 0 && <p class="text-sm font-medium text-fg">Total: {brl(lanc.data?.totalCentavos ?? 0)}</p>}
      </Card>
    </div>
  )
}

function NfseTab() {
  const cfg = useNfseConfig()
  const mut = useCobrancaFiscalMut()
  const c = cfg.data?.config
  const [form, setForm] = useState<any>(null)
  const f = form ?? c ?? { provedor: '', ambiente: 'homologacao', cnpjPrestador: '', inscricaoMunicipal: '', codigoServico: '', aliquotaPct: 0, ativo: false }
  const set = (k: string, v: any) => setForm({ ...f, [k]: v })
  const [prev, setPrev] = useState<{ total: number } | null>(null)
  const [res, setRes] = useState<string | null>(null)

  return (
    <div class="space-y-3 mt-3">
      <Card class="space-y-3">
        <div class="text-sm font-semibold text-fg flex items-center gap-2"><FileSpreadsheet size={16} /> Configuração NFS-e</div>
        {cfg.isLoading ? <Skeleton class="h-24 w-full" /> : (
          <>
            <div class="grid sm:grid-cols-3 gap-2">
              <Input label="Provedor" value={f.provedor ?? ''} onInput={(e: any) => set('provedor', e.currentTarget.value)} placeholder="abrasf / ginfes / betha…" />
              <Select label="Ambiente" value={f.ambiente} onChange={(e: any) => set('ambiente', e.currentTarget.value)}><option value="homologacao">Homologação</option><option value="producao">Produção</option></Select>
              <Input label="Alíquota (%)" type="number" step="0.01" value={f.aliquotaPct} onInput={(e: any) => set('aliquotaPct', e.currentTarget.value)} />
              <Input label="CNPJ prestador" value={f.cnpjPrestador ?? ''} onInput={(e: any) => set('cnpjPrestador', e.currentTarget.value)} />
              <Input label="Inscrição municipal" value={f.inscricaoMunicipal ?? ''} onInput={(e: any) => set('inscricaoMunicipal', e.currentTarget.value)} />
              <Input label="Código do serviço" value={f.codigoServico ?? ''} onInput={(e: any) => set('codigoServico', e.currentTarget.value)} />
            </div>
            <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Emissão de NFS-e ativa</label>
            <Button size="sm" variant="primary" loading={mut.salvarNfseConfig.isPending} onClick={() => mut.salvarNfseConfig.mutate(f, { onSuccess: () => setForm(null) })}>Salvar configuração</Button>
            <p class="text-xs text-fg-muted">A transmissão ao webservice da prefeitura é o ponto de integração final (varia por município). O lote gera as notas em <b>Pendente</b> prontas para emissão.</p>
          </>
        )}
      </Card>

      <Card class="space-y-2">
        <div class="text-sm font-semibold text-fg">Gerar lote</div>
        <div class="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => mut.gerarLoteNfse.mutate({ dryRun: true }, { onSuccess: (d) => setPrev({ total: d.total }) })}>Pré-visualizar</Button>
          {prev && <span class="text-sm text-fg-muted">{prev.total} parcela(s) paga(s) sem nota</span>}
          {prev && prev.total > 0 && <Button size="sm" variant="primary" loading={mut.gerarLoteNfse.isPending} onClick={() => mut.gerarLoteNfse.mutate({ dryRun: false }, { onSuccess: (d) => { setRes(`${d.gerados} nota(s) geradas (pendentes).`); setPrev(null) } })}>Gerar lote</Button>}
          {res && <span class="text-sm text-success">{res}</span>}
        </div>
      </Card>
    </div>
  )
}
