import { Award, FileText, GraduationCap } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { useEgressos, useCertificarMut } from '@/hooks/useAcaEgressos'
import { abrirDocumentoPdf } from '@/hooks/useAcaSecretaria'

export function AcademicoEgressosPage() {
  const data = useEgressos()
  const cert = useCertificarMut()
  const itens = data.data?.itens ?? []

  return (
    <Page title="Egressos" description="Alunos concluintes e emissão de certificados.">
      {data.isLoading ? <Skeleton class="h-48 w-full" /> : itens.length === 0 ? (
        <Card class="text-center text-sm text-fg-muted py-10"><GraduationCap size={20} class="inline mr-1" /> Nenhum concluinte ainda. Conclua uma matrícula em Matrículas.</Card>
      ) : (
        <Card class="p-0 overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-xs text-fg-muted"><tr><th class="text-left p-2">Aluno</th><th class="text-left p-2">Turma</th><th class="text-left p-2">Conclusão</th><th class="text-center p-2">Certificado</th></tr></thead>
            <tbody class="divide-y divide-border">
              {itens.map((e) => (
                <tr key={e.matriculaId} class="hover:bg-surface-2">
                  <td class="p-2">{e.nome}<span class="block text-[11px] text-fg-subtle">RA {e.ra || '—'}</span></td>
                  <td class="p-2 text-xs text-fg-muted">{e.turma}</td>
                  <td class="p-2 text-xs">{e.dataConclusao ? new Date(e.dataConclusao).toLocaleDateString('pt-BR') : '—'}</td>
                  <td class="p-2 text-center">
                    {e.certificado ? (
                      <div class="inline-flex items-center gap-2">
                        <Badge tone="success">{e.certificado.numero}</Badge>
                        <Button variant="ghost" size="sm" onClick={() => abrirDocumentoPdf(e.certificado!.id).catch(() => {})}><FileText size={14} /> Baixar</Button>
                      </div>
                    ) : (
                      <Button variant="primary" size="sm" disabled={cert.isPending} onClick={() => cert.mutate(e.matriculaId, { onSuccess: (r) => abrirDocumentoPdf(r.documento.id).catch(() => {}) })}><Award size={14} /> Emitir certificado</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  )
}
