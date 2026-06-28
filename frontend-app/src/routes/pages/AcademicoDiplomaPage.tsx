import { useState } from 'preact/hooks'
import { ShieldCheck, Download, FileSignature, Settings, Link2, Copy, Check } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useDiplomaConfig, useDiplomas, useDiplomaMut, baixarDiplomaXml, DIP_STATUS, type DiplomaItem } from '@/hooks/useAcaDiploma'

export function AcademicoDiplomaPage() {
  const cfg = useDiplomaConfig()
  const diplomas = useDiplomas()
  const mut = useDiplomaMut()
  const [showCfg, setShowCfg] = useState(false)
  const [reg, setReg] = useState<DiplomaItem | null>(null)
  const itens = diplomas.data?.itens ?? []
  const base = (typeof window !== 'undefined' ? window.location.origin : '')

  return (
    <Page title="Diploma Digital (MEC)" description="Geração do XML, assinatura ICP-Brasil, registro e validação pública do diploma digital.">
      <p class="text-xs text-fg-muted">⚠️ A assinatura ICP-Brasil (XMLDSig) é o ponto de integração final (certificado A1/A3 ou provedor). O XSD oficial do MEC é versionado — o XML gerado é base mapeável ao leiaute vigente.</p>
      <div class="flex justify-end"><Button size="sm" variant="secondary" onClick={() => setShowCfg(true)}><Settings size={14} /> Config. da IES</Button></div>

      {diplomas.isLoading ? <Skeleton class="h-40 w-full" /> : itens.length === 0 ? <EmptyState icon={<ShieldCheck size={28} />} title="Nenhum concluinte" description="Diplomas são emitidos a partir de matrículas concluídas." /> : (
        <Card class="p-0 overflow-hidden divide-y divide-border">
          {itens.map((d) => (
            <div key={d.matriculaId} class="px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
              <span class="flex-1 min-w-[12rem]"><span class="block text-fg font-medium">{d.alunoNome}</span><span class="block text-xs text-fg-muted">RA {d.ra || '—'}{d.numero ? ` · diploma ${d.numero}` : ''}{d.dataConclusao ? ` · concl. ${new Date(d.dataConclusao).toLocaleDateString('pt-BR')}` : ''}</span></span>
              {d.status && <Badge tone={DIP_STATUS[d.status]?.tone ?? 'neutral'}>{DIP_STATUS[d.status]?.label ?? d.status}</Badge>}
              <div class="flex gap-1 flex-wrap">
                {!d.diplomaId && <Button size="sm" variant="secondary" disabled={mut.criar.isPending} onClick={() => mut.criar.mutate(d.matriculaId)}>Gerar diploma</Button>}
                {d.status === 'RASCUNHO' && <Button size="sm" variant="secondary" onClick={() => mut.gerarXml.mutate({ id: d.diplomaId })}>Gerar XML</Button>}
                {d.status === 'XML_GERADO' && <Button size="sm" variant="primary" onClick={() => mut.assinar.mutate({ id: d.diplomaId })}><FileSignature size={13} /> Assinar</Button>}
                {d.status === 'ASSINADO' && <Button size="sm" variant="primary" onClick={() => setReg(d)}>Registrar</Button>}
                {d.diplomaId && d.status !== 'RASCUNHO' && <Button size="sm" variant="ghost" onClick={() => baixarDiplomaXml(d.diplomaId!, d.codigoValidacao).catch(() => {})}><Download size={13} /> XML</Button>}
                {d.status === 'REGISTRADO' && d.codigoValidacao && <CopyLink url={`${base}/diploma/validar?codigo=${d.codigoValidacao}`} />}
                {d.diplomaId && d.status !== 'ANULADO' && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Anular este diploma?')) mut.anular.mutate({ id: d.diplomaId, motivo: 'Anulado pela secretaria' }) }}>Anular</Button>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal open={showCfg} onOpenChange={setShowCfg} title="Configuração da IES (diploma)"><ConfigForm config={cfg.data?.config} onSaved={() => setShowCfg(false)} mut={mut} /></Modal>
      <Modal open={reg !== null} onOpenChange={(o) => !o && setReg(null)} title="Registrar diploma" description={reg?.alunoNome}>
        {reg && <RegistrarForm onConfirm={(b) => { mut.registrar.mutate({ id: reg.diplomaId, ...b }); setReg(null) }} />}
      </Modal>
    </Page>
  )
}

function ConfigForm({ config, onSaved, mut }: { config: any; onSaved: () => void; mut: any }) {
  const [f, setF] = useState<any>(config ?? { iesEmissora: '', cnpjEmissora: '', codigoMecEmissora: '', iesRegistradora: '', reitor: '', secretario: '', provedorAssinatura: '', ativo: false })
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  return (
    <div class="space-y-2">
      <div class="grid sm:grid-cols-2 gap-2">
        <Input label="IES emissora" value={f.iesEmissora ?? ''} onInput={(e: any) => set('iesEmissora', e.currentTarget.value)} />
        <Input label="CNPJ emissora" value={f.cnpjEmissora ?? ''} onInput={(e: any) => set('cnpjEmissora', e.currentTarget.value)} />
        <Input label="Código MEC emissora" value={f.codigoMecEmissora ?? ''} onInput={(e: any) => set('codigoMecEmissora', e.currentTarget.value)} />
        <Input label="IES registradora" value={f.iesRegistradora ?? ''} onInput={(e: any) => set('iesRegistradora', e.currentTarget.value)} />
        <Input label="Reitor" value={f.reitor ?? ''} onInput={(e: any) => set('reitor', e.currentTarget.value)} />
        <Input label="Secretário" value={f.secretario ?? ''} onInput={(e: any) => set('secretario', e.currentTarget.value)} />
        <Input label="Provedor de assinatura" value={f.provedorAssinatura ?? ''} onInput={(e: any) => set('provedorAssinatura', e.currentTarget.value)} hint="A1-local | A3-token | provedor externo" />
      </div>
      <label class="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.ativo} onChange={(e: any) => set('ativo', e.currentTarget.checked)} /> Emissão de diploma ativa</label>
      <div class="flex justify-end"><Button variant="primary" loading={mut.salvarConfig.isPending} onClick={() => mut.salvarConfig.mutate(f, { onSuccess: onSaved })}>Salvar</Button></div>
    </div>
  )
}

function RegistrarForm({ onConfirm }: { onConfirm: (b: { numero: string; livro: string; folha: string }) => void }) {
  const [b, setB] = useState({ numero: '', livro: '', folha: '' })
  return (
    <div class="space-y-2">
      <div class="grid grid-cols-3 gap-2">
        <Input label="Número" value={b.numero} onInput={(e: any) => setB({ ...b, numero: e.currentTarget.value })} />
        <Input label="Livro" value={b.livro} onInput={(e: any) => setB({ ...b, livro: e.currentTarget.value })} />
        <Input label="Folha" value={b.folha} onInput={(e: any) => setB({ ...b, folha: e.currentTarget.value })} />
      </div>
      <div class="flex justify-end"><Button variant="primary" disabled={!b.numero} onClick={() => onConfirm(b)}>Registrar</Button></div>
    </div>
  )
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? <Check size={13} /> : <Link2 size={13} />} {copied ? 'Copiado' : 'Link validação'}</Button>
}
