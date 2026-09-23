/**
 * Classificação das mídias da conversa para o visualizador.
 *
 * O `mediaType` da mensagem diz o que o WhatsApp mandou (image, video,
 * document…), mas "document" cobre de PDF a planilha — e cada um abre de um
 * jeito. A extensão do arquivo (no nome ou na URL) desempata.
 */

export type MediaKind = 'image' | 'sticker' | 'gif' | 'video' | 'audio' | 'pdf' | 'text' | 'file'

export interface MediaItem {
  /** id da mensagem — é por ele que a bolha pede para abrir o visualizador. */
  id: number
  kind: MediaKind
  url: string
  name: string | null
  sender: string | null
  at: string
}

const TEXTO = ['txt', 'csv', 'json', 'log', 'md', 'xml', 'tsv']

export function extensaoDe(url: string, name?: string | null): string {
  const fonte = (name && name.includes('.') ? name : url) || ''
  const limpa = fonte.split(/[?#]/)[0] ?? ''
  const m = /\.([a-z0-9]{1,6})$/i.exec(limpa)
  return m ? m[1]!.toLowerCase() : ''
}

export function mediaKindOf(type: string | null | undefined, url: string, name?: string | null): MediaKind {
  const ext = extensaoDe(url, name)
  switch (type) {
    case 'image': return 'image'
    case 'sticker': return 'sticker'
    case 'gif': return 'gif'
    case 'video': return 'video'
    case 'audio': return 'audio'
  }
  if (ext === 'pdf') return 'pdf'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext)) return 'video'
  if (TEXTO.includes(ext)) return 'text'
  return 'file'
}

/** O que o visualizador abre. Áudio tem player na própria bolha. */
export function abreNoVisualizador(kind: MediaKind): boolean {
  return kind !== 'audio'
}

/** Rótulo curto do tipo, para o cartão do arquivo. */
export function rotuloDoTipo(kind: MediaKind, ext: string): string {
  if (kind === 'pdf') return 'PDF'
  if (ext) return ext.toUpperCase()
  return kind === 'text' ? 'Texto' : 'Arquivo'
}

/**
 * Baixa o arquivo SEM navegar. `<a download>` só vale para a mesma origem —
 * em URL de outro domínio o navegador ignora o atributo e abre o arquivo no
 * lugar da conversa. Buscando o blob primeiro, o agente nunca sai da tela.
 */
export async function baixarArquivo(url: string, name?: string | null): Promise<void> {
  const nome = name || url.split(/[?#]/)[0]!.split('/').pop() || 'arquivo'
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) throw new Error(String(r.status))
    const blob = await r.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  } catch {
    // Sem CORS no domínio de origem não dá para ler o blob: resta o link direto,
    // com download (a mesma origem respeita o atributo).
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.rel = 'noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}
