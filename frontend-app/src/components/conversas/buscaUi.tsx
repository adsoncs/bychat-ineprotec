/** Peças visuais compartilhadas pelas duas buscas (lista e dentro da conversa). */
import './busca.css'
import { FileText, Image, Mic, Users, Video } from '@/components/ui/icon-set'
import { trechos } from '@/lib/buscaTexto'
import type { MensagemAchada } from '@/hooks/useBuscaConversas'

/** Texto com o termo em verde, como nos resultados do WhatsApp Web. */
export function Grifado({ texto, termo }: { texto: string; termo: string }) {
  return (
    <>
      {trechos(texto, termo).map((p, i) => (p.hit ? <span key={i} class="busca-hit">{p.texto}</span> : p.texto))}
    </>
  )
}

/**
 * Número formatado "(62) 99113-8484" com o grifo sobre os DÍGITOS digitados —
 * quem busca "9911384" não digitou o hífen, e o grifo tem de atravessá-lo.
 */
export function GrifadoNumero({ numero, termo }: { numero: string; termo: string }) {
  const alvo = termo.replace(/\D/g, '')
  if (alvo.length < 3) return <Grifado texto={numero} termo={termo} />
  const posDigitos: number[] = []
  for (let i = 0; i < numero.length; i++) if (/\d/.test(numero[i]!)) posDigitos.push(i)
  const soDigitos = posDigitos.map((i) => numero[i]).join('')
  const k = soDigitos.indexOf(alvo)
  if (k < 0) return <>{numero}</>
  const ini = posDigitos[k]!, fim = posDigitos[k + alvo.length - 1]! + 1
  return <>{numero.slice(0, ini)}<span class="busca-hit">{numero.slice(ini, fim)}</span>{numero.slice(fim)}</>
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

function inicioDoDia(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

/** Data como o WhatsApp mostra na lista: 14:32 · Ontem · terça-feira · 12/09/2026. */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dias = Math.round((inicioDoDia(new Date()) - inicioDoDia(d)) / 86_400_000)
  if (dias <= 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (dias === 1) return 'Ontem'
  if (dias < 7) return DIAS[d.getDay()]!
  return d.toLocaleDateString('pt-BR')
}

export function Avatar({ foto, nome, grupo = false, tamanho = 'size-10' }: {
  foto: string | null | undefined; nome: string | null | undefined; grupo?: boolean; tamanho?: string
}) {
  return (
    <span class={`${tamanho} shrink-0 overflow-hidden rounded-full bg-surface-3 grid place-items-center text-xs font-semibold text-fg-muted`}>
      {foto
        ? <img src={foto} alt="" class="h-full w-full object-cover" loading="lazy" />
        : grupo ? <Users size={16} /> : (nome ?? '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

/** "Você: ", "Maria: " (em grupo) ou "Nota: " — quem disse, antes do trecho. */
export function prefixoMensagem(m: MensagemAchada, grupo: boolean): string {
  if (m.isInternal) return 'Nota: '
  if (m.fromMe) return 'Você: '
  if (grupo && m.senderName) return `${m.senderName}: `
  return ''
}

/** Ícone do tipo de mídia, para resultado que é legenda ou nome de arquivo. */
export function IconeMidia({ tipo }: { tipo: string | null }) {
  if (!tipo || tipo === 'text') return null
  const I = tipo === 'image' || tipo === 'sticker' ? Image : tipo === 'video' ? Video : tipo === 'audio' || tipo === 'ptt' ? Mic : FileText
  return <I size={13} class="inline -mt-0.5 mr-0.5 shrink-0 text-fg-muted" />
}
