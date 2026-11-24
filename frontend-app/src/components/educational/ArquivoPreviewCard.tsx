/**
 * Prévia de um arquivo de documento (imagem, PDF, ou fallback com link).
 *
 * Extraído de EducationalDocReviewPage e EducationalEvaluationsPage, que
 * tinham o mesmo bloco de preview colado duas vezes. Também usado pela
 * revisão de documentos da inscrição (EnrollmentRegistrationDetailPage), que
 * antes só linkava `target="_blank"` — o agente trocava de aba pra ver o
 * arquivo e voltava pra aprovar/recusar.
 */
import { ExternalLink } from '@/components/ui/icon-set'

export function ArquivoPreviewCard({
  url, mimeType, fileName, sizeBytes, label,
}: {
  url: string
  mimeType: string | null | undefined
  fileName?: string | null | undefined
  sizeBytes?: number | null | undefined
  /** Rótulo do cabeçalho; padrão é o nome do arquivo. */
  label?: string | null | undefined
}) {
  const isImage = (mimeType ?? '').startsWith('image/')
  const isPdf = (mimeType ?? '') === 'application/pdf'

  return (
    <div class="rounded-md border border-border bg-surface overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-2 text-xs">
        <span class="text-fg-muted truncate">
          {label ?? fileName ?? 'arquivo'}
          {sizeBytes != null && <span class="ml-1 text-fg-muted">· {(sizeBytes / 1024).toFixed(0)} KB</span>}
        </span>
        <a href={url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-accent hover:underline shrink-0">
          Abrir em nova aba <ExternalLink size={10} />
        </a>
      </div>
      <div class="bg-[oklch(0.15_0_0)] flex items-center justify-center min-h-[220px]">
        {isImage ? (
          <img src={url} alt={fileName ?? label ?? ''} class="max-w-full max-h-[55vh] object-contain" />
        ) : isPdf ? (
          <iframe src={url} class="w-full h-[55vh] bg-white border-0" title={fileName ?? label ?? 'PDF'} />
        ) : (
          <div class="text-fg-on-brand/80 p-8 text-center text-xs">
            Tipo de arquivo não pré-visualizável.
            <br />
            <a href={url} target="_blank" rel="noreferrer" class="text-accent hover:underline">Abrir em nova aba ↗</a>
          </div>
        )}
      </div>
    </div>
  )
}
