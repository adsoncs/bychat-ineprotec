// Identidade do portal no painel: ícone + cor + empresa. Diferencia um portal
// (e uma empresa) do outro para a equipe — na lista de portais, no cabeçalho
// do portal e na inscrição. Não aparece para o candidato.
import type { ComponentType } from 'preact'
import {
  GraduationCap, School, BookOpen, Award, BadgeCheck, Trophy, Briefcase, Building2,
  Landmark, Wrench, Zap, FlaskConical, Scale, Monitor, Globe, Compass, Lightbulb,
  Target, Handshake, Users, Brain, Layers, Star, Shield, Sparkles, Crown, Flag,
  MapPin, Home, Palette, ClipboardCheck, Activity,
} from '@/components/ui/icon-set'
import type { EnrollmentPortal, IdentidadePainel } from '@/hooks/useEnrollmentPortals'
import { cn } from '@/lib/cn'

type Icone = ComponentType<{ size?: number | string; class?: string; strokeWidth?: number }>

export const ICONES_PORTAL: { chave: string; rotulo: string; Icone: Icone }[] = [
  { chave: 'GraduationCap', rotulo: 'Graduação', Icone: GraduationCap },
  { chave: 'BookOpen', rotulo: 'Curso', Icone: BookOpen },
  { chave: 'Award', rotulo: 'Certificação', Icone: Award },
  { chave: 'BadgeCheck', rotulo: 'Competência', Icone: BadgeCheck },
  { chave: 'Trophy', rotulo: 'Excelência', Icone: Trophy },
  { chave: 'Briefcase', rotulo: 'Profissional', Icone: Briefcase },
  { chave: 'Wrench', rotulo: 'Técnico', Icone: Wrench },
  { chave: 'Zap', rotulo: 'Elétrica', Icone: Zap },
  { chave: 'FlaskConical', rotulo: 'Ciências', Icone: FlaskConical },
  { chave: 'Activity', rotulo: 'Saúde', Icone: Activity },
  { chave: 'Scale', rotulo: 'Direito', Icone: Scale },
  { chave: 'Monitor', rotulo: 'EAD', Icone: Monitor },
  { chave: 'Globe', rotulo: 'Online', Icone: Globe },
  { chave: 'Brain', rotulo: 'Pós / especialização', Icone: Brain },
  { chave: 'Layers', rotulo: 'Supletivo / EJA', Icone: Layers },
  { chave: 'ClipboardCheck', rotulo: 'Consultoria', Icone: ClipboardCheck },
  { chave: 'Handshake', rotulo: 'Parceria', Icone: Handshake },
  { chave: 'Users', rotulo: 'Treinamento', Icone: Users },
  { chave: 'Lightbulb', rotulo: 'Curso livre', Icone: Lightbulb },
  { chave: 'Target', rotulo: 'Captação', Icone: Target },
  { chave: 'Compass', rotulo: 'Orientação', Icone: Compass },
  { chave: 'Building2', rotulo: 'Empresa', Icone: Building2 },
  { chave: 'Landmark', rotulo: 'Instituição', Icone: Landmark },
  { chave: 'MapPin', rotulo: 'Polo', Icone: MapPin },
  { chave: 'Home', rotulo: 'Unidade', Icone: Home },
  { chave: 'Shield', rotulo: 'Segurança', Icone: Shield },
  { chave: 'Palette', rotulo: 'Artes', Icone: Palette },
  { chave: 'Star', rotulo: 'Destaque', Icone: Star },
  { chave: 'Crown', rotulo: 'Premium', Icone: Crown },
  { chave: 'Sparkles', rotulo: 'Novo', Icone: Sparkles },
  { chave: 'Flag', rotulo: 'Campanha', Icone: Flag },
]

/** Paleta própria do painel: tons médios que leem bem no tema claro e no escuro. */
export const CORES_PORTAL: { cor: string; nome: string }[] = [
  { cor: '#2563eb', nome: 'Azul' },
  { cor: '#4f46e5', nome: 'Índigo' },
  { cor: '#7c3aed', nome: 'Violeta' },
  { cor: '#c026d3', nome: 'Magenta' },
  { cor: '#db2777', nome: 'Rosa' },
  { cor: '#dc2626', nome: 'Vermelho' },
  { cor: '#ea580c', nome: 'Laranja' },
  { cor: '#d97706', nome: 'Âmbar' },
  { cor: '#65a30d', nome: 'Lima' },
  { cor: '#16a34a', nome: 'Verde' },
  { cor: '#0d9488', nome: 'Petróleo' },
  { cor: '#0891b2', nome: 'Ciano' },
  { cor: '#475569', nome: 'Grafite' },
]

const PADRAO = { icone: 'School', cor: '#64748b' }

export function iconeDaChave(chave: string | null | undefined): Icone {
  return ICONES_PORTAL.find((i) => i.chave === chave)?.Icone ?? School
}

/** Identidade efetiva (com os padrões quando o portal ainda não foi configurado). */
export function identidadeDo(p: Pick<EnrollmentPortal, 'identidadePainel'> | null | undefined) {
  const i: Partial<IdentidadePainel> = p?.identidadePainel ?? {}
  return {
    icone: i.icone || PADRAO.icone,
    cor: i.cor || PADRAO.cor,
    empresa: i.empresa || null,
    descricao: i.descricao || null,
    ordem: i.ordem ?? null,
    mostrarPolo: i.mostrarPolo === true,
    configurada: !!(i.icone || i.cor),
  }
}

/** Fundo e borda tingidos pela cor do portal (mistura com transparente: vale nos dois temas). */
export const tinta = (cor: string, pct: number) => `color-mix(in srgb, ${cor} ${pct}%, transparent)`

/** O "selo" do portal: quadrado com o ícone na cor do portal. */
export function SeloDoPortal({ icone, cor, tamanho = 40, class: className }: {
  icone: string | null | undefined; cor: string; tamanho?: number; class?: string
}) {
  const I = iconeDaChave(icone)
  return (
    <span
      class={cn('rounded-lg grid place-items-center shrink-0 ring-1 ring-inset', className)}
      style={{ width: tamanho, height: tamanho, background: tinta(cor, 16), color: cor, ['--tw-ring-color' as any]: tinta(cor, 35) }}
      aria-hidden="true"
    >
      <I size={Math.round(tamanho * 0.45)} />
    </span>
  )
}

/** Etiqueta compacta (ícone + nome) para listas e cabeçalhos. */
export function EtiquetaDoPortal({ portal, class: className }: {
  portal: Pick<EnrollmentPortal, 'nome' | 'identidadePainel'>; class?: string
}) {
  const id = identidadeDo(portal)
  const I = iconeDaChave(id.icone)
  return (
    <span
      class={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium max-w-full', className)}
      style={{ background: tinta(id.cor, 14), color: id.cor }}
      title={id.empresa ? `${portal.nome} · ${id.empresa}` : portal.nome}
    >
      <I size={12} />
      <span class="truncate text-fg">{portal.nome}</span>
      {id.empresa && <span class="truncate opacity-80">· {id.empresa}</span>}
    </span>
  )
}

/** Faixa no topo do portal e da inscrição: deixa claro, de cara, de qual portal/empresa é. */
export function FaixaDoPortal({ portal, rotulo, polos }: {
  portal: Pick<EnrollmentPortal, 'nome' | 'identidadePainel'> & { codePrefix?: string | null }
  rotulo?: string
  /** Polo(s) a mostrar — só com "Mostrar polo" ligado na identidade e se houver. */
  polos?: string[]
}) {
  const id = identidadeDo(portal)
  const lista = id.mostrarPolo ? (polos ?? []).filter(Boolean) : []
  return (
    <div
      class="rounded-lg border border-border bg-surface-2 px-3 py-2.5 flex items-center gap-3"
      style={{ borderLeft: `3px solid ${id.cor}`, background: `linear-gradient(90deg, ${tinta(id.cor, 9)}, transparent 60%)` }}
    >
      <SeloDoPortal icone={id.icone} cor={id.cor} tamanho={36} />
      <div class="min-w-0 flex-1">
        {rotulo && <div class="text-3xs uppercase tracking-wider text-fg-muted">{rotulo}</div>}
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold text-fg truncate">{portal.nome}</span>
          {id.empresa && <span class="rounded px-1.5 py-px text-2xs font-medium text-fg ring-1 ring-inset" style={{ background: tinta(id.cor, 18), ["--tw-ring-color" as any]: tinta(id.cor, 40) }}>{id.empresa}</span>}
          {portal.codePrefix && <code class="rounded bg-surface-3 px-1.5 py-px text-2xs text-fg-muted font-mono">{portal.codePrefix}</code>}
          {lista.length > 0 && <PolosDoPortal polos={lista} />}
        </div>
        {id.descricao && <div class="text-xs text-fg-muted truncate">{id.descricao}</div>}
      </div>
    </div>
  )
}

/** Polos em etiquetas (até 4 + "+n"). */
export function PolosDoPortal({ polos, max = 4 }: { polos: string[]; max?: number }) {
  const resto = polos.length - max
  return (
    <span class="inline-flex items-center gap-1 flex-wrap text-2xs" title={`Polo: ${polos.join(', ')}`}>
      <MapPin size={12} class="text-fg-muted" aria-hidden="true" />
      <span class="sr-only">{polos.length > 1 ? 'Polos:' : 'Polo:'}</span>
      {polos.slice(0, max).map((n) => (
        <span key={n} class="rounded border border-border px-1.5 py-px text-fg">{n}</span>
      ))}
      {resto > 0 && <span class="text-fg-muted">+{resto}</span>}
    </span>
  )
}
