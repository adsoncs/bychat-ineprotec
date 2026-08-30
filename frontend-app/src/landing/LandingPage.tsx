import { CONTACT, FOOTER, HERO, NAV_LINKS, whatsappHref } from './landing.copy'
import { DashboardMock } from './components/DashboardMock'
import {
  AISection,
  AiJourney,
  BRDifferentials,
  Cases,
  Engage,
  Faq,
  FinalCta,
  Helpdesk,
  HowItWorks,
  ImpactStats,
  Integrations,
  Meetings,
  ModuleExplorer,
  NativeWhatsApp,
  Pillars,
  Segments,
  SocialProof,
  StackMap,
} from './sections'

/**
 * Landing institucional pública (bychat.ia.br).
 * Vitrine de vendas — só servida no host institucional (tenants seguem login).
 */
export function LandingPage() {
  return (
    <div class="min-h-dvh bg-surface text-fg">
      <a
        href="#conteudo"
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-fg"
      >
        Pular para o conteúdo
      </a>
      <Header />
      <main id="conteudo">
        <Hero />
        <SocialProof />
        <ImpactStats />
        <Pillars />
        <ModuleExplorer />
        <NativeWhatsApp />
        <AISection />
        <AiJourney />
        <Meetings />
        <Engage />
        <Helpdesk />
        <HowItWorks />
        <Segments />
        <Integrations />
        <Cases />
        <BRDifferentials />
        <StackMap />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  )
}

function Header() {
  return (
    <header class="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" class="flex items-center font-extrabold">
          <span class="text-lg">
            <span class="text-ink">By</span>
            <span class="text-brand">Chat</span>
          </span>
        </a>
        <nav class="hidden items-center gap-7 md:flex" aria-label="Seções">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              class="text-sm font-medium text-fg-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          <a
            href="/educacional"
            class="text-sm font-semibold text-brand transition-colors hover:text-brand-hover"
          >
            Para Educação
          </a>
        </nav>
        <div class="flex items-center gap-2.5">
          <a
            href={CONTACT.loginUrl}
            class="hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-fg-muted transition-colors hover:text-ink sm:block"
          >
            Entrar
          </a>
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg shadow-sm transition-colors hover:bg-brand-hover"
          >
            Agende uma demo
          </a>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section
      id="top"
      class="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-soft/60 to-surface"
    >
      <div class="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <span class="inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-fg-muted">
            {HERO.badge}
          </span>
          <h1 class="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
            {HERO.title} <span class="text-brand">{HERO.highlight}</span>
          </h1>
          <p class="mt-5 max-w-xl text-lg text-fg-muted">{HERO.subtitle}</p>
          <div class="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={whatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3.5 text-base font-semibold text-brand-fg shadow-lg shadow-brand/20 transition-colors hover:bg-brand-hover"
            >
              {HERO.primaryCta}
            </a>
            <a
              href={whatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              <span class="size-2 rounded-full bg-cta" />
              {HERO.secondaryCta}
            </a>
          </div>
          <p class="mt-4 text-sm text-fg-muted">{HERO.reassurance}</p>
        </div>
        <div class="relative">
          <DashboardMock />
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer class="border-t border-line bg-surface-2">
      <div class="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div class="lg:col-span-2">
          <div class="flex items-center font-extrabold">
            <span class="text-ink">By</span>
            <span class="text-brand">Chat</span>
          </div>
          <p class="mt-3 max-w-sm text-sm text-fg-muted">{FOOTER.tagline}</p>
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-5 inline-flex items-center gap-2 rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-cta-fg"
          >
            Falar no WhatsApp
          </a>
        </div>
        {FOOTER.columns.map((col) => (
          <div key={col.title}>
            <h3 class="text-sm font-bold uppercase tracking-wide text-fg-muted">
              {col.title}
            </h3>
            <ul class="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    class="text-sm text-fg-muted transition-colors hover:text-ink"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div class="border-t border-line">
        <div class="mx-auto max-w-6xl px-5 py-6 text-sm text-fg-muted">
          {FOOTER.legal}
        </div>
      </div>
    </footer>
  )
}

function WhatsAppFloat() {
  return (
    <a
      href={whatsappHref()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar no WhatsApp"
      class="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-cta px-5 py-3.5 font-semibold text-cta-fg shadow-xl shadow-cta/30 transition-transform hover:scale-105"
    >
      <span class="size-2.5 rounded-full bg-cta-fg" />
      Fale conosco
    </a>
  )
}
