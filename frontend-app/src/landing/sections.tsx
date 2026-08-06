import { useState } from 'preact/hooks'
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Database,
  Gauge,
  GraduationCap,
  Headphones,
  LineChart,
  ListChecks,
  Megaphone,
  MessageSquare,
  Mic,
  MousePointerClick,
  PhoneCall,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Ticket,
  TrendingUp,
  Users,
  Video,
  Workflow,
  Zap,
} from 'lucide-preact'
import {
  AI,
  AI_JOURNEY,
  BR_DIFF,
  CASES,
  ENGAGE,
  FAQ,
  FINAL_CTA,
  HELPDESK,
  IMPACT_STATS,
  INTEGRATIONS,
  MEETINGS,
  MODULE_MAP,
  NATIVE_WA,
  PILLARS,
  SEGMENTS,
  SOCIAL_PROOF,
  STACK_MAP,
  STEPS,
  whatsappHref,
} from './landing.copy'

const MEETING_ICONS: Record<string, typeof Video> = { Video, Sparkles, Target, Mic }

function Section(props: {
  id?: string
  class?: string
  children: preact.ComponentChildren
}) {
  return (
    <section id={props.id} class={`py-16 sm:py-24 ${props.class ?? ''}`}>
      <div class="mx-auto max-w-6xl px-5">{props.children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: preact.ComponentChildren }) {
  return (
    <span class="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
      {children}
    </span>
  )
}

const PILLAR_ICONS = [Headphones, TrendingUp, Workflow, LineChart] as const

export function SocialProof() {
  return (
    <div class="border-b border-line bg-surface-2">
      <div class="mx-auto max-w-6xl px-5 py-10">
        {/* Oculto: ainda não vamos exibir marcas/clientes na prova social.
        <p class="text-center text-sm font-medium text-fg-subtle">
          {SOCIAL_PROOF.intro}
        </p>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {SOCIAL_PROOF.logos.map((l) => (
            <span
              key={l}
              class="text-lg font-extrabold tracking-tight text-fg-subtle/60"
            >
              {l}
            </span>
          ))}
        </div>
        */}
        <div class="mt-7 flex flex-wrap items-center justify-center gap-3">
          {SOCIAL_PROOF.badges.map((b) => (
            <span
              key={b}
              class="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-fg-muted"
            >
              <ShieldCheck class="size-3.5 text-cta" />
              {b}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ImpactStats() {
  return (
    <div class="bg-brand">
      <div class="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-12 lg:grid-cols-4">
        {IMPACT_STATS.map((s) => (
          <div key={s.label} class="text-center text-brand-fg">
            <div class="text-3xl font-extrabold sm:text-4xl">{s.value}</div>
            <div class="mt-1 text-sm text-brand-fg/80">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Pillars() {
  const [active, setActive] = useState(0)
  return (
    <Section id="recursos">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Plataforma completa</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Tudo o que sua operação precisa, sem juntar 5 ferramentas
        </h2>
        <p class="mt-4 text-lg text-fg-muted">
          Quatro pilares que cobrem do primeiro contato à venda — e ao próximo
          ciclo.
        </p>
      </div>

      <div class="mt-10 flex flex-wrap justify-center gap-2">
        {PILLARS.map((p, i) => {
          const Icon = PILLAR_ICONS[i] ?? Zap
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(i)}
              class={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                i === active
                  ? 'bg-brand text-brand-fg'
                  : 'bg-surface-2 text-fg-muted hover:text-ink'
              }`}
            >
              <Icon class="size-4" />
              {p.tab}
            </button>
          )
        })}
      </div>

      {PILLARS.map((p, i) =>
        i === active ? (
          <div
            key={p.id}
            class="mt-10 grid items-center gap-10 rounded-2xl border border-line bg-surface-2 p-8 lg:grid-cols-2 lg:p-12"
          >
            <div>
              <h3 class="text-2xl font-extrabold text-ink">{p.title}</h3>
              <p class="mt-3 text-fg-muted">{p.description}</p>
              <ul class="mt-6 space-y-3">
                {p.bullets.map((b) => (
                  <li key={b} class="flex items-start gap-2.5 text-fg">
                    <CheckCircle2 class="mt-0.5 size-5 shrink-0 text-cta" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div class="grid place-items-center rounded-xl border border-line bg-surface p-8">
              <div class="grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand">
                {(() => {
                  const Icon = PILLAR_ICONS[i] ?? Zap
                  return <Icon class="size-8" />
                })()}
              </div>
              <p class="mt-4 text-center text-sm font-medium text-fg-subtle">
                {p.tab}
              </p>
            </div>
          </div>
        ) : null,
      )}
    </Section>
  )
}

const MODULE_ICONS: Record<string, typeof Gauge> = {
  Gauge,
  Users,
  Megaphone,
  TrendingUp,
  BarChart3,
  MessageSquare,
  Plug,
  Database,
  ShieldCheck,
  Headphones,
}

export function ModuleExplorer() {
  const [active, setActive] = useState(0)
  const total = MODULE_MAP.reduce((sum, g) => sum + g.items.length, 0)
  const group = MODULE_MAP[active] ?? MODULE_MAP[0]!
  const ActiveIcon = MODULE_ICONS[group.icon] ?? Zap

  return (
    <Section id="modulos" class="bg-surface-2">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>O produto por dentro</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {total}+ módulos numa só plataforma
        </h2>
        <p class="mt-4 text-lg text-fg-muted">
          Navegue pelo painel real do ByChat. Cada área substitui uma
          ferramenta que você pagaria à parte — e todas conversam entre si.
        </p>
      </div>

      <div class="mt-12 grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Navegação de grupos — vira chips roláveis no mobile */}
        <nav
          aria-label="Grupos de módulos"
          class="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {MODULE_MAP.map((g, i) => {
            const Icon = MODULE_ICONS[g.icon] ?? Zap
            const isActive = i === active
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActive(i)}
                aria-current={isActive ? 'true' : undefined}
                class={`group flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors lg:w-full ${
                  isActive
                    ? 'border-brand bg-brand text-brand-fg shadow-sm shadow-brand/20'
                    : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                <Icon
                  class={`size-5 shrink-0 ${
                    isActive ? 'text-brand-fg' : 'text-brand'
                  }`}
                />
                <span class="whitespace-nowrap lg:whitespace-normal">
                  {g.label}
                </span>
                <span
                  class={`ml-auto hidden rounded-full px-2 py-0.5 text-xs font-bold lg:inline ${
                    isActive
                      ? 'bg-brand-fg/20 text-brand-fg'
                      : 'bg-surface-3 text-fg-subtle'
                  }`}
                >
                  {g.items.length}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Painel do grupo ativo */}
        <div
          key={group.id}
          class="module-enter rounded-2xl border border-line bg-surface p-6 sm:p-8"
        >
          <div class="flex items-start gap-4 border-b border-line pb-6">
            <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <ActiveIcon class="size-6" />
            </span>
            <div>
              <h3 class="text-xl font-extrabold text-ink">{group.label}</h3>
              <p class="mt-1 text-fg-muted">{group.tagline}</p>
            </div>
          </div>
          <div class="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {group.items.map((it) => (
              <div key={it.name} class="flex gap-3">
                <CheckCircle2 class="mt-0.5 size-5 shrink-0 text-cta" />
                <div>
                  <div class="font-bold text-ink">{it.name}</div>
                  <p class="mt-0.5 text-sm text-fg-muted">{it.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ponte para a vitrine educacional */}
      <a
        href="/educacional"
        class="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-brand/30 bg-brand-soft p-6 transition-colors hover:border-brand sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-4">
          <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-brand text-brand-fg">
            <GraduationCap class="size-6" />
          </span>
          <div>
            <div class="font-extrabold text-ink">
              É instituição de ensino? Tem um módulo inteiro para você.
            </div>
            <p class="mt-1 text-sm text-fg-muted">
              Portal de matrículas, processos seletivos, modos de ingresso e
              checkout transparente (PIX, boleto e cartão).
            </p>
          </div>
        </div>
        <span class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg">
          Ver solução para Educação
          <ArrowUpRight class="size-4" />
        </span>
      </a>
    </Section>
  )
}

export function AISection() {
  return (
    <Section id="ia" class="bg-ink text-surface">
      <div class="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span class="inline-flex items-center gap-2 rounded-full bg-surface/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-surface">
            <Sparkles class="size-3.5" />
            {AI.eyebrow}
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {AI.title}
          </h2>
          <p class="mt-4 text-lg text-surface/70">{AI.subtitle}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {AI.features.map((f) => (
            <div
              key={f.title}
              class="rounded-xl border border-surface/10 bg-surface/5 p-5"
            >
              <Bot class="size-6 text-brand" />
              <h3 class="mt-3 font-bold">{f.title}</h3>
              <p class="mt-1 text-sm text-surface/65">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}

export function HowItWorks() {
  return (
    <Section>
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Como funciona</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          No ar em poucos passos
        </h2>
      </div>
      <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div
            key={s.n}
            class="rounded-2xl border border-line bg-surface p-6"
          >
            <div class="grid size-10 place-items-center rounded-full bg-brand text-base font-extrabold text-brand-fg">
              {s.n}
            </div>
            <h3 class="mt-4 font-bold text-ink">{s.title}</h3>
            <p class="mt-1.5 text-sm text-fg-muted">{s.text}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function Segments() {
  return (
    <Section id="solucoes" class="bg-surface-2">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Soluções por segmento</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Feito para a sua operação
        </h2>
      </div>
      <div class="mt-12 grid gap-6 md:grid-cols-2">
        {SEGMENTS.map((s) => (
          <div
            key={s.title}
            class={`rounded-2xl border p-7 ${
              s.highlight
                ? 'border-brand bg-brand-soft'
                : 'border-line bg-surface'
            }`}
          >
            {s.highlight ? (
              <span class="inline-block rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-fg">
                Diferencial exclusivo
              </span>
            ) : null}
            <h3 class="mt-3 text-xl font-extrabold text-ink">{s.title}</h3>
            <p class="mt-2 text-fg-muted">{s.text}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function Integrations() {
  return (
    <Section id="integracoes">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Integrações</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {INTEGRATIONS.title}
        </h2>
        <p class="mt-4 text-lg text-fg-muted">{INTEGRATIONS.subtitle}</p>
      </div>
      <div class="mt-10 flex flex-wrap justify-center gap-3">
        {INTEGRATIONS.items.map((i) => (
          <span
            key={i}
            class="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg"
          >
            <Zap class="size-4 text-brand" />
            {i}
          </span>
        ))}
      </div>
    </Section>
  )
}

export function Cases() {
  return (
    <Section class="bg-surface-2">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Resultados</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Quem usa, vende mais
        </h2>
      </div>
      <div class="mt-12 grid gap-6 lg:grid-cols-3">
        {CASES.map((c) => (
          <figure
            key={c.name}
            class="flex flex-col rounded-2xl border border-line bg-surface p-7"
          >
            <div class="inline-flex w-fit items-center gap-1.5 rounded-full bg-cta/10 px-3 py-1 text-sm font-bold text-cta">
              <TrendingUp class="size-4" />
              {c.metric}
            </div>
            <blockquote class="mt-4 flex-1 text-fg">“{c.quote}”</blockquote>
            <figcaption class="mt-5 border-t border-line pt-4">
              <div class="font-bold text-ink">{c.name}</div>
              <div class="text-sm text-fg-subtle">{c.role}</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  )
}

export function BRDifferentials() {
  return (
    <Section>
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>Por que ByChat</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Tecnologia brasileira, suporte de verdade
        </h2>
      </div>
      <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {BR_DIFF.map((d) => (
          <div key={d.title} class="rounded-2xl border border-line p-6">
            <ShieldCheck class="size-6 text-cta" />
            <h3 class="mt-3 font-bold text-ink">{d.title}</h3>
            <p class="mt-1.5 text-sm text-fg-muted">{d.text}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

const STACK_ICONS: Record<string, typeof Video> = {
  MessageSquare, Users, TrendingUp, Bot, Send, Workflow, CalendarClock,
  Video, Ticket, Target, BarChart3, Sparkles, GraduationCap,
}

/**
 * Comparativo de mercado: o stack que o cliente montaria por fora, linha a
 * linha, contra o módulo equivalente aqui. Em telas pequenas cada linha vira
 * um cartão empilhado (ferramentas em cima, módulo embaixo) — tabela de duas
 * colunas no celular viraria rolagem horizontal.
 */
export function StackMap() {
  return (
    <Section id="comparativo" class="bg-surface-2">
      <div class="mx-auto max-w-3xl text-center">
        <Eyebrow>{STACK_MAP.eyebrow}</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {STACK_MAP.title}
        </h2>
        <p class="mt-4 text-lg text-fg-muted">{STACK_MAP.subtitle}</p>
      </div>

      <div class="mt-12 overflow-hidden rounded-2xl border border-line bg-surface">
        <div class="hidden grid-cols-[1fr_auto_1fr] gap-4 border-b border-line bg-surface-2 px-6 py-3 text-xs font-bold uppercase tracking-wide text-fg-subtle sm:grid">
          <span>{STACK_MAP.columns.from}</span>
          <span aria-hidden="true" class="w-5" />
          <span>{STACK_MAP.columns.to}</span>
        </div>
        <ul class="divide-y divide-line">
          {STACK_MAP.rows.map((row) => {
            const Icon = STACK_ICONS[row.icon] ?? Sparkles
            return (
              <li
                key={row.module}
                class="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4"
              >
                <div class="flex flex-wrap gap-1.5">
                  {row.tools.map((t) => (
                    <span
                      key={t}
                      class="rounded-md border border-line bg-surface-2 px-2 py-1 text-sm text-fg-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <ArrowUpRight
                  aria-hidden="true"
                  class="size-5 shrink-0 rotate-45 text-fg-subtle sm:rotate-0"
                />
                <div class="flex items-start gap-2">
                  <Icon class="mt-0.5 size-5 shrink-0 text-cta" />
                  <span class="font-semibold text-ink">
                    {row.module}
                    {'badge' in row && row.badge ? (
                      <span class="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">
                        {row.badge}
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <h3 class="mt-14 text-center text-xl font-extrabold text-ink">
        {STACK_MAP.benefitsTitle}
      </h3>
      <div class="mt-6 grid gap-6 sm:grid-cols-3">
        {STACK_MAP.benefits.map((b) => (
          <div key={b.title} class="rounded-2xl border border-line bg-surface p-6">
            <CheckCircle2 class="size-6 text-cta" />
            <h4 class="mt-3 font-bold text-ink">{b.title}</h4>
            <p class="mt-1.5 text-sm text-fg-muted">{b.text}</p>
          </div>
        ))}
      </div>

      <p class="mx-auto mt-8 max-w-3xl text-center text-xs text-fg-subtle">
        {STACK_MAP.disclaimer}
      </p>
    </Section>
  )
}

export function Faq() {
  return (
    <Section id="faq" class="bg-surface-2">
      <div class="mx-auto max-w-3xl">
        <div class="text-center">
          <Eyebrow>Perguntas frequentes</Eyebrow>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Ainda com dúvidas?
          </h2>
        </div>
        <div class="mt-10 space-y-3">
          {FAQ.map((f) => (
            <details
              key={f.q}
              class="group rounded-xl border border-line bg-surface p-5 [&_summary]:list-none"
            >
              <summary class="flex cursor-pointer items-center justify-between gap-4 font-semibold text-ink">
                {f.q}
                <ChevronDown class="size-5 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" />
              </summary>
              <p class="mt-3 text-fg-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}

export function NativeWhatsApp() {
  return (
    <Section id="whatsapp" class="relative overflow-hidden">
      <div class="lp-grid-bg pointer-events-none absolute inset-0 opacity-[0.5]" aria-hidden="true" />
      <div class="relative">
        <div class="mx-auto max-w-2xl text-center">
          <Eyebrow>{NATIVE_WA.eyebrow}</Eyebrow>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            {NATIVE_WA.title}
          </h2>
          <p class="mt-4 text-lg text-fg-muted">{NATIVE_WA.subtitle}</p>
        </div>

        <div class="mt-12 grid gap-5 lg:grid-cols-3">
          {/* Card grande: Ligações por voz — com mini-UI de chamada */}
          <div class="lp-card flex flex-col justify-between rounded-2xl border border-line bg-surface p-7 lg:row-span-2">
            <div>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-cta/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-cta">
                {NATIVE_WA.features[0]!.tag}
              </span>
              <h3 class="mt-4 text-xl font-extrabold text-ink">
                {NATIVE_WA.features[0]!.title}
              </h3>
              <p class="mt-2 text-fg-muted">{NATIVE_WA.features[0]!.text}</p>
            </div>
            {/* mini-UI: chamada de voz em andamento */}
            <div class="mt-7 rounded-2xl border border-line bg-surface-2 p-5">
              <div class="flex items-center gap-3">
                <span class="grid size-11 place-items-center rounded-full bg-brand text-base font-bold text-brand-fg">
                  MA
                </span>
                <div class="min-w-0">
                  <div class="truncate font-bold text-ink">Maria — Lead quente</div>
                  <div class="flex items-center gap-1.5 text-sm text-cta">
                    <span class="size-1.5 animate-pulse rounded-full bg-cta" />
                    Chamada de voz · 02:14
                  </div>
                </div>
              </div>
              <div class="mt-5 flex items-center justify-center gap-3">
                <span class="grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-muted">
                  <Mic class="size-5" />
                </span>
                <span class="grid size-14 place-items-center rounded-full bg-cta text-cta-fg shadow-lg shadow-cta/30">
                  <PhoneCall class="size-6" />
                </span>
                <span class="grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-muted">
                  <Headphones class="size-5" />
                </span>
              </div>
            </div>
          </div>

          {/* Card: botões/listas interativos — com mini-UI de bolha + botões */}
          <div class="lp-card rounded-2xl border border-line bg-surface p-7 lg:col-span-2">
            <div class="grid gap-6 sm:grid-cols-2 sm:items-center">
              <div>
                <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
                  <MousePointerClick class="size-3.5" />
                  {NATIVE_WA.features[1]!.tag}
                </span>
                <h3 class="mt-4 text-xl font-extrabold text-ink">
                  {NATIVE_WA.features[1]!.title}
                </h3>
                <p class="mt-2 text-fg-muted">{NATIVE_WA.features[1]!.text}</p>
              </div>
              <div class="rounded-2xl border border-line bg-surface-2 p-4">
                <div class="max-w-[14rem] rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-sm text-fg shadow-sm">
                  Como podemos te ajudar hoje?
                </div>
                <div class="mt-3 space-y-2">
                  {['Quero uma demonstração', 'Falar com vendas', 'Ver planos'].map((b) => (
                    <div
                      key={b}
                      class="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-sm font-semibold text-brand"
                    >
                      {b}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card: WhatsApp Flows — com mini-UI de formulário */}
          <div class="lp-card rounded-2xl border border-line bg-surface p-7 lg:col-span-2">
            <div class="grid gap-6 sm:grid-cols-2 sm:items-center">
              <div>
                <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
                  <ListChecks class="size-3.5" />
                  {NATIVE_WA.features[2]!.tag}
                </span>
                <h3 class="mt-4 text-xl font-extrabold text-ink">
                  {NATIVE_WA.features[2]!.title}
                </h3>
                <p class="mt-2 text-fg-muted">{NATIVE_WA.features[2]!.text}</p>
              </div>
              <div class="rounded-2xl border border-line bg-surface-2 p-4">
                <div class="space-y-3">
                  <div>
                    <div class="text-[11px] font-semibold text-fg-subtle">Nome completo</div>
                    <div class="mt-1 h-8 rounded-lg border border-line bg-surface" />
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-fg-subtle">Melhor horário</div>
                    <div class="mt-1 flex gap-2">
                      <span class="flex h-8 flex-1 items-center rounded-lg border border-brand bg-brand-soft px-2 text-xs font-semibold text-brand">Manhã</span>
                      <span class="flex h-8 flex-1 items-center rounded-lg border border-line bg-surface px-2 text-xs text-fg-subtle">Tarde</span>
                    </div>
                  </div>
                  <div class="flex h-9 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-brand-fg">
                    Enviar
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

export function AiJourney() {
  return (
    <Section class="bg-ink text-surface">
      <div class="mx-auto max-w-2xl text-center">
        <span class="inline-flex items-center gap-2 rounded-full bg-surface/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-surface">
          <Sparkles class="size-3.5" />
          {AI_JOURNEY.eyebrow}
        </span>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {AI_JOURNEY.title}
        </h2>
        <p class="mt-4 text-lg text-surface/70">{AI_JOURNEY.subtitle}</p>
      </div>

      <ol class="mt-14 grid gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-6">
        {AI_JOURNEY.steps.map((s, i) => (
          <li key={s.title} class="relative lg:pr-6">
            {/* conector horizontal entre passos (lg) */}
            {i < AI_JOURNEY.steps.length - 1 ? (
              <span
                class="absolute left-12 right-0 top-5 hidden h-px bg-surface/15 lg:block"
                aria-hidden="true"
              />
            ) : null}
            <div class="flex items-center gap-3 lg:block">
              <span class="relative z-10 grid size-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-extrabold text-brand-fg">
                {i + 1}
              </span>
              <h3 class="font-bold lg:mt-4">{s.title}</h3>
            </div>
            <p class="mt-2 text-sm text-surface/65 lg:pr-2">{s.text}</p>
          </li>
        ))}
      </ol>

      <div class="mx-auto mt-12 flex max-w-3xl items-start gap-3 rounded-2xl border border-surface/10 bg-surface/5 p-5">
        <Bot class="mt-0.5 size-5 shrink-0 text-brand" />
        <p class="text-sm text-surface/75">{AI_JOURNEY.footnote}</p>
      </div>
    </Section>
  )
}

export function Engage() {
  const cards = [
    { d: ENGAGE.broadcast, Icon: Send, accent: 'brand' as const },
    { d: ENGAGE.scheduling, Icon: CalendarClock, accent: 'cta' as const },
  ]
  return (
    <Section class="bg-surface-2">
      <div class="mx-auto max-w-2xl text-center">
        <Eyebrow>{ENGAGE.eyebrow}</Eyebrow>
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {ENGAGE.title}
        </h2>
      </div>
      <div class="mt-12 grid gap-6 lg:grid-cols-2">
        {cards.map(({ d, Icon, accent }) => (
          <div key={d.title} class="lp-card flex flex-col rounded-2xl border border-line bg-surface p-8">
            <div class="flex items-center gap-4">
              <span
                class={`grid size-12 shrink-0 place-items-center rounded-xl ${
                  accent === 'brand' ? 'bg-brand-soft text-brand' : 'bg-cta/10 text-cta'
                }`}
              >
                <Icon class="size-6" />
              </span>
              <h3 class="text-xl font-extrabold text-ink">{d.title}</h3>
            </div>
            <p class="mt-4 text-fg-muted">{d.text}</p>
            <ul class="mt-6 grid gap-3 border-t border-line pt-6">
              {d.bullets.map((b) => (
                <li key={b} class="flex items-start gap-2.5 text-sm text-fg">
                  <CheckCircle2
                    class={`mt-0.5 size-5 shrink-0 ${accent === 'brand' ? 'text-brand' : 'text-cta'}`}
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function Meetings() {
  return (
    <Section class="relative overflow-hidden">
      <div class="lp-grid-bg pointer-events-none absolute inset-0 opacity-[0.5]" aria-hidden="true" />
      <div class="relative">
        <div class="mx-auto max-w-2xl text-center">
          <Eyebrow>{MEETINGS.eyebrow}</Eyebrow>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            {MEETINGS.title}
          </h2>
          <p class="mt-4 text-lg text-fg-muted">{MEETINGS.subtitle}</p>
        </div>
        <div class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MEETINGS.features.map((f) => {
            const Icon = MEETING_ICONS[f.icon] ?? Sparkles
            return (
              <div key={f.title} class="lp-card rounded-2xl border border-line bg-surface p-6">
                <span class="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon class="size-6" />
                </span>
                <h3 class="mt-4 font-extrabold text-ink">{f.title}</h3>
                <p class="mt-1.5 text-sm text-fg-muted">{f.text}</p>
              </div>
            )
          })}
        </div>
        <div class="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-2xl border border-cta/20 bg-cta/5 p-5">
          <ShieldCheck class="mt-0.5 size-5 shrink-0 text-cta" />
          <p class="text-sm text-fg">{MEETINGS.footnote}</p>
        </div>
      </div>
    </Section>
  )
}

export function Helpdesk() {
  return (
    <Section class="bg-surface-2">
      <div class="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <Eyebrow>{HELPDESK.eyebrow}</Eyebrow>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            {HELPDESK.title}
          </h2>
          <p class="mt-4 text-lg text-fg-muted">{HELPDESK.subtitle}</p>
          <ul class="mt-7 grid gap-3">
            {HELPDESK.bullets.map((b) => (
              <li key={b} class="flex items-start gap-2.5 text-fg">
                <CheckCircle2 class="mt-0.5 size-5 shrink-0 text-cta" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* mini-UI: chamado com SLA */}
        <div class="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div class="flex items-center justify-between border-b border-line pb-4">
            <div class="flex items-center gap-3">
              <span class="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <Ticket class="size-5" />
              </span>
              <div>
                <div class="text-sm font-bold text-ink">Chamado #1042</div>
                <div class="text-xs text-fg-subtle">Cliente · Financeiro</div>
              </div>
            </div>
            <span class="rounded-full bg-cta/10 px-2.5 py-1 text-[11px] font-bold text-cta">
              SLA no prazo
            </span>
          </div>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-fg-subtle">Prioridade</span><span class="font-semibold text-ink">Alta</span></div>
            <div class="flex justify-between"><span class="text-fg-subtle">Responsável</span><span class="font-semibold text-ink">Equipe Suporte</span></div>
            <div class="flex justify-between"><span class="text-fg-subtle">1ª resposta</span><span class="font-semibold text-cta">em 12 min</span></div>
            <div class="flex justify-between"><span class="text-fg-subtle">Canal</span><span class="font-semibold text-ink">WhatsApp</span></div>
          </div>
          <div class="mt-4 flex gap-2 border-t border-line pt-4">
            {['Novo', 'Em andamento', 'Resolvido'].map((s, i) => (
              <span
                key={s}
                class={`flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold ${
                  i === 1 ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-fg-subtle'
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}

export function FinalCta() {
  return (
    <Section>
      <div class="rounded-3xl bg-brand px-6 py-14 text-center text-brand-fg sm:px-12">
        <MessageSquare class="mx-auto size-10 opacity-80" />
        <h2 class="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {FINAL_CTA.title}
        </h2>
        <p class="mx-auto mt-3 max-w-xl text-brand-fg/80">
          {FINAL_CTA.subtitle}
        </p>
        <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center rounded-xl bg-surface px-6 py-3.5 text-base font-semibold text-brand shadow-lg transition-transform hover:scale-105"
          >
            {FINAL_CTA.primary}
          </a>
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-cta px-6 py-3.5 text-base font-semibold text-cta-fg shadow-lg transition-transform hover:scale-105"
          >
            <MessageSquare class="size-5" />
            {FINAL_CTA.secondary}
          </a>
        </div>
      </div>
    </Section>
  )
}
