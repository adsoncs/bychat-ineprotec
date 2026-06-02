import { useState } from 'preact/hooks'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  GraduationCap,
  LineChart,
  Megaphone,
  Users,
} from 'lucide-preact'
import { CONTACT } from '../landing.copy'

/**
 * Landing dedicada ao segmento Educacional (bychat.ia.br/educacional).
 *
 * Página independente da vitrine institucional: copy 100% focada em
 * instituições de ensino (captação de alunos, portal de matrículas,
 * processos seletivos, checkout transparente). Reaproveita o design
 * system / tokens de `landing.css` e os contatos configuráveis
 * (window.__LANDING_CONTACT__ → CONTACT).
 */

/** WhatsApp com mensagem específica do segmento educacional. */
function eduWhatsappHref(): string {
  const msg = encodeURIComponent(
    'Olá! Quero conhecer o ByChat para a minha instituição de ensino e ver o portal de matrículas.',
  )
  return `https://wa.me/${CONTACT.whatsappNumber}?text=${msg}`
}

const NAV = [
  { label: 'Captação', href: '#captacao' },
  { label: 'Matrículas', href: '#matriculas' },
  { label: 'Processos seletivos', href: '#processos' },
  { label: 'Pagamentos', href: '#pagamentos' },
  { label: 'Perguntas', href: '#faq' },
] as const

const STATS = [
  { value: '3x', label: 'mais matrículas concluídas online' },
  { value: '24/7', label: 'tira-dúvidas de cursos com IA' },
  { value: '-40%', label: 'de evasão no funil de inscrição' },
  { value: '< 2 min', label: 'para responder o candidato' },
] as const

const PILLARS = [
  {
    icon: Megaphone,
    title: 'Captação de alunos',
    text: 'Meta e Google Ads conectados ao funil educacional: do clique no anúncio ao lead qualificado, sem planilha e sem lead perdido.',
    bullets: [
      'Funil de captação por curso e campanha',
      'Formulários e landing pages de inscrição',
      'ROI por anúncio plugado a matrículas reais',
    ],
  },
  {
    icon: ClipboardList,
    title: 'Portal de matrículas',
    text: 'Inscrição em etapas com salvamento automático, upload de documentos e acompanhamento — o candidato conclui sozinho, do celular.',
    bullets: [
      'Formulário multi-etapa com auto-save',
      'Coleta e validação de documentos',
      'Status da inscrição em tempo real',
    ],
  },
  {
    icon: GraduationCap,
    title: 'Processos seletivos',
    text: 'Vestibular, ENEM, transferência, segunda graduação, pós e cursos livres — cada processo com seu modo de ingresso e regras.',
    bullets: [
      'Modos de ingresso configuráveis por processo',
      'Etapas, prazos e critérios próprios',
      'Vagas por curso e turma',
    ],
  },
  {
    icon: CreditCard,
    title: 'Checkout transparente',
    text: 'PIX, boleto e cartão na própria plataforma (Pagar.me e Asaas). Da inscrição à matrícula paga, sem sair do fluxo.',
    bullets: [
      'PIX, boleto e cartão integrados',
      'Confirmação automática por webhook',
      'Recuperação de cobrança não paga',
    ],
  },
  {
    icon: Bot,
    title: 'Atendimento com IA',
    text: 'A IA responde dúvidas de cursos, valores e prazos 24h, qualifica o candidato e só passa para a secretaria quando precisa.',
    bullets: [
      'Tira-dúvidas de cursos e editais',
      'Qualificação e priorização de candidatos',
      'Cadências para quem não respondeu',
    ],
  },
  {
    icon: LineChart,
    title: 'CRM educacional',
    text: 'Funil visual da captação à matrícula, com motivos de perda, atividades da secretaria e performance por operador.',
    bullets: [
      'Kanban da inscrição à matrícula',
      'Motivos de evasão e reengajamento',
      'Painel de conversão por curso',
    ],
  },
] as const

const STEPS = [
  {
    n: '1',
    title: 'Anuncie os cursos',
    text: 'Campanhas de Meta e Google Ads levam o candidato direto ao WhatsApp ou ao portal.',
  },
  {
    n: '2',
    title: 'IA atende e qualifica',
    text: 'A IA tira dúvidas de cursos, valores e prazos e identifica quem está pronto para se inscrever.',
  },
  {
    n: '3',
    title: 'Candidato se inscreve',
    text: 'Portal de matrículas em etapas, com documentos e processo seletivo do curso.',
  },
  {
    n: '4',
    title: 'Matrícula paga',
    text: 'Checkout transparente (PIX, boleto, cartão) confirma a matrícula automaticamente.',
  },
] as const

const AUDIENCE = [
  'Faculdades e centros universitários',
  'Escolas e colégios',
  'Pós-graduação e MBA',
  'Cursos técnicos e profissionalizantes',
  'Escolas de idiomas',
  'Cursos livres e preparatórios',
] as const

const FAQ = [
  {
    q: 'O portal de matrículas substitui meu sistema acadêmico?',
    a: 'Ele cuida da jornada de captação e inscrição — do anúncio à matrícula paga. A integração com o sistema acadêmico é feita por API/webhooks conforme a sua operação.',
  },
  {
    q: 'Dá para ter mais de um processo seletivo ao mesmo tempo?',
    a: 'Sim. Cada processo seletivo tem o seu modo de ingresso, etapas, prazos e vagas por curso, rodando em paralelo.',
  },
  {
    q: 'Quais formas de pagamento o candidato pode usar?',
    a: 'PIX, boleto e cartão, com checkout transparente integrado a Pagar.me e Asaas. A confirmação da matrícula é automática via webhook.',
  },
  {
    q: 'A IA consegue responder dúvidas sobre os cursos?',
    a: 'Sim. A IA atende 24/7 com informações de cursos, valores, prazos e editais, qualifica o candidato e aciona a secretaria quando necessário.',
  },
  {
    q: 'E os candidatos que começam a inscrição e não terminam?',
    a: 'O portal salva o progresso automaticamente e o ByChat dispara cadências de reengajamento para reduzir a evasão no funil.',
  },
  {
    q: 'Como contrato para a minha instituição?',
    a: 'Fale no WhatsApp ou agende uma demonstração. Montamos a operação educacional sob medida para os seus cursos e processos.',
  },
] as const

function Logo() {
  return (
    <a href="/educacional" class="flex items-center font-extrabold">
      <span class="text-lg">
        <span class="text-ink">By</span><span class="text-brand">Chat</span>
        <span class="text-ink">{' '}Edu</span>
      </span>
    </a>
  )
}

function Header() {
  return (
    <header class="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav class="hidden items-center gap-7 md:flex" aria-label="Seções">
          {NAV.map((l) => (
            <a
              key={l.href}
              href={l.href}
              class="text-sm font-medium text-fg-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div class="flex items-center gap-2.5">
          <a
            href="/"
            class="hidden rounded-lg px-3.5 py-2 text-sm font-semibold text-fg-muted transition-colors hover:text-ink sm:block"
          >
            Site geral
          </a>
          <a
            href={eduWhatsappHref()}
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
      <div class="mx-auto max-w-3xl px-5 py-20 text-center lg:py-28">
        <span class="inline-block rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-fg-muted">
          Solução exclusiva para instituições de ensino
        </span>
        <h1 class="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
          Capte, matricule e fidelize alunos{' '}
          <span class="text-brand">no WhatsApp com IA</span>
        </h1>
        <p class="mx-auto mt-5 max-w-2xl text-lg text-fg-muted">
          Portal de matrículas, processos seletivos, modos de ingresso e
          checkout transparente (PIX, boleto e cartão) — do anúncio à
          matrícula paga, numa plataforma só. Um diferencial que nenhum
          concorrente entrega.
        </p>
        <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href={eduWhatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-3.5 text-base font-semibold text-brand-fg shadow-lg shadow-brand/20 transition-colors hover:bg-brand-hover"
          >
            Agende uma demonstração
          </a>
          <a
            href={eduWhatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface-2"
          >
            <span class="size-2 rounded-full bg-cta" />
            Falar no WhatsApp
          </a>
        </div>
        <p class="mt-4 text-sm text-fg-subtle">
          Onboarding assistido · Suporte em português · Conforme a LGPD
        </p>
      </div>
    </section>
  )
}

function Stats() {
  return (
    <section class="border-b border-line bg-surface-2">
      <div class="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-5 py-12 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} class="px-4 text-center">
            <div class="text-3xl font-extrabold text-brand sm:text-4xl">
              {s.value}
            </div>
            <div class="mt-1 text-sm text-fg-muted">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Pillars() {
  return (
    <section id="captacao" class="py-16 sm:py-24">
      <div class="mx-auto max-w-6xl px-5">
        <div class="max-w-2xl">
          <span class="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            Plataforma educacional
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Tudo o que a sua instituição precisa para captar e matricular
          </h2>
          <p class="mt-4 text-lg text-fg-muted">
            Da campanha de mídia ao aluno matriculado e pagando — sem trocar
            de ferramenta e sem perder candidato no caminho.
          </p>
        </div>
        <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p, i) => {
            const Icon = p.icon
            const anchor =
              i === 1 ? 'matriculas' : i === 2 ? 'processos' : undefined
            return (
              <div
                key={p.title}
                id={anchor}
                class="scroll-mt-24 rounded-card border border-line bg-surface p-6 shadow-sm"
              >
                <span class="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon class="size-5" />
                </span>
                <h3 class="mt-4 text-lg font-bold text-ink">{p.title}</h3>
                <p class="mt-2 text-sm text-fg-muted">{p.text}</p>
                <ul class="mt-4 space-y-2">
                  {p.bullets.map((b) => (
                    <li key={b} class="flex gap-2 text-sm text-fg-muted">
                      <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-cta" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="pagamentos" class="border-y border-line bg-surface-2 py-16 sm:py-24">
      <div class="mx-auto max-w-6xl px-5">
        <div class="max-w-2xl">
          <span class="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            Como funciona
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Do anúncio à matrícula paga em quatro passos
          </h2>
        </div>
        <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div
              key={s.n}
              class="rounded-card border border-line bg-surface p-6"
            >
              <span class="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-brand-fg">
                {s.n}
              </span>
              <h3 class="mt-4 font-bold text-ink">{s.title}</h3>
              <p class="mt-2 text-sm text-fg-muted">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Audience() {
  return (
    <section class="py-16 sm:py-24">
      <div class="mx-auto max-w-6xl px-5">
        <div class="max-w-2xl">
          <span class="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            Para quem é
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Feito para todo tipo de instituição de ensino
          </h2>
        </div>
        <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCE.map((a) => (
            <div
              key={a}
              class="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-4"
            >
              <Users class="size-5 shrink-0 text-brand" />
              <span class="text-sm font-medium text-ink">{a}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" class="border-t border-line bg-surface-2 py-16 sm:py-24">
      <div class="mx-auto max-w-3xl px-5">
        <h2 class="text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Perguntas frequentes
        </h2>
        <div class="mt-10 space-y-3">
          {FAQ.map((item, i) => {
            const isOpen = open === i
            return (
              <div
                key={item.q}
                class="rounded-card border border-line bg-surface"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  class="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span class="font-semibold text-ink">{item.q}</span>
                  <ChevronDown
                    class={`size-5 shrink-0 text-fg-subtle transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <p class="px-5 pb-5 text-sm text-fg-muted">{item.a}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section class="py-16 sm:py-24">
      <div class="mx-auto max-w-4xl px-5">
        <div class="rounded-card bg-brand px-6 py-14 text-center text-brand-fg sm:px-12">
          <h2 class="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Pronto para encher as turmas com menos esforço?
          </h2>
          <p class="mx-auto mt-4 max-w-2xl text-lg text-brand-fg/85">
            Veja o portal de matrículas e o funil educacional do ByChat
            funcionando na sua instituição.
          </p>
          <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={eduWhatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center rounded-xl bg-surface px-6 py-3.5 text-base font-semibold text-brand transition-colors hover:bg-surface-2"
            >
              Agende uma demonstração
            </a>
            <a
              href={eduWhatsappHref()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-fg/30 px-6 py-3.5 text-base font-semibold text-brand-fg transition-colors hover:bg-brand-hover"
            >
              <span class="size-2 rounded-full bg-cta" />
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer class="border-t border-line bg-surface-2">
      <div class="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center font-extrabold">
            <span class="text-ink">By</span><span class="text-brand">Chat</span>
            <span class="text-ink">{' '}Edu</span>
          </div>
          <p class="mt-3 max-w-sm text-sm text-fg-muted">
            Plataforma brasileira de captação, matrículas e atendimento para
            instituições de ensino.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a
            href="/"
            class="text-fg-muted transition-colors hover:text-ink"
          >
            Site geral
          </a>
          <a
            href="/app"
            class="text-fg-muted transition-colors hover:text-ink"
          >
            Entrar no painel
          </a>
          <a
            href="#faq"
            class="text-fg-muted transition-colors hover:text-ink"
          >
            Perguntas
          </a>
          <a
            href={eduWhatsappHref()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-lg bg-cta px-4 py-2.5 font-semibold text-cta-fg"
          >
            Falar no WhatsApp
          </a>
        </div>
      </div>
      <div class="border-t border-line">
        <div class="mx-auto max-w-6xl px-5 py-6 text-sm text-fg-subtle">
          © {new Date().getFullYear()} ByChat. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  )
}

function WhatsAppFloat() {
  return (
    <a
      href={eduWhatsappHref()}
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

export function EducationalLandingPage() {
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
        <Stats />
        <Pillars />
        <HowItWorks />
        <Audience />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  )
}
