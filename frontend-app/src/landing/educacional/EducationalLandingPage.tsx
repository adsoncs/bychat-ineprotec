import { useState } from 'preact/hooks'
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  KeyRound,
  Landmark,
  LineChart,
  Megaphone,
  PhoneCall,
  Repeat,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
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
  { label: 'Gestão acadêmica', href: '#erp' },
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
    q: 'O ByChat substitui meu sistema acadêmico?',
    a: 'Sim. Além da captação e das matrículas, o ByChat inclui um ERP acadêmico nativo completo: pedagógico (diário, frequência, notas, conselho), financeiro (mensalidades, boleto/PIX, boleto registrado CNAB, renegociação, dívida ativa), secretaria (histórico, declarações, certificados, requerimentos), diploma digital no padrão MEC, portais de aluno/professor/responsável e conformidade (Censo INEP, SISTEC, ENADE, CPA). Tudo num sistema só.',
  },
  {
    q: 'O sistema emite diploma digital e atende o MEC?',
    a: 'Sim. Emite o diploma digital no padrão MEC (com XML, registro e validação pública por código) e gera as exportações para Censo INEP, SISTEC e ENADE, além da Avaliação Institucional (CPA).',
  },
  {
    q: 'Como funciona a parte financeira das mensalidades?',
    a: 'Contratos e parcelas gerados na matrícula, cobrança por boleto/PIX (Asaas) ou boleto bancário registrado (CNAB), com central financeira, juros/multa, desconto por pontualidade, renegociação, bloqueio por inadimplência, recibos, dívida ativa (CDA) e controle de NFS-e.',
  },
  {
    q: 'Alunos e professores têm acesso próprio?',
    a: 'Sim. Há portais de autoatendimento por link seguro (sem senha) para aluno (boletim, financeiro com 2ª via, documentos, (re)matrícula), professor (diário, notas, materiais), responsável, ex-aluno e coordenador.',
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
          Da captação ao diploma:{' '}
          <span class="text-brand">a instituição inteira numa plataforma</span>
        </h1>
        <p class="mx-auto mt-5 max-w-2xl text-lg text-fg-muted">
          Portal de matrículas e checkout transparente (PIX, boleto e cartão)
          para captar — e um ERP acadêmico nativo completo para gerir: pedagógico,
          financeiro, secretaria, diploma digital MEC e portais do aluno. Do
          anúncio à diplomação, sem trocar de sistema.
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
                class="lp-card scroll-mt-24 rounded-card border border-line bg-surface p-6"
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

const ERP_AREAS = [
  { icon: GraduationCap, title: 'Estrutura & Matrículas', text: 'Cursos, matriz curricular, turmas e períodos letivos, com o aluno num ciclo de vida completo: da inscrição à conclusão.' },
  { icon: BookOpen, title: 'Núcleo Pedagógico', text: 'Diário de classe, frequência, avaliações e notas, conselho de classe, calendário, quadro de horários e plano de ensino.' },
  { icon: Wallet, title: 'Financeiro Acadêmico', text: 'Mensalidades e contratos (Asaas: boleto/PIX), central financeira, juros/multa, renegociação, bloqueio por inadimplência e recibos.' },
  { icon: Landmark, title: 'Financeiro Bancário & Fiscal', text: 'Boleto bancário registrado (CNAB), remessa/retorno, plano de contas, cobranças recorrentes, dívida ativa (CDA) e NFS-e.' },
  { icon: FileText, title: 'Secretaria & Documentos', text: 'Histórico escolar, declarações, atas, certificados e requerimentos (secretaria virtual) — todos com numeração oficial.' },
  { icon: Award, title: 'Diploma Digital (MEC)', text: 'Diploma digital no padrão MEC: geração do XML, registro e validação pública por código.' },
  { icon: KeyRound, title: 'Portais de autoatendimento', text: 'Aluno, professor, responsável, ex-aluno e coordenador — boletim, financeiro, documentos e (re)matrícula por link seguro, sem senha.' },
  { icon: ClipboardList, title: 'Processo Seletivo', text: 'Vestibular completo: componentes de nota, classificação com desempate, convocação por chamadas e ensalamento.' },
  { icon: Repeat, title: 'Movimentações acadêmicas', text: 'Trancamento, transferência, aproveitamento de estudos, dependência e reingresso — com registro auditável.' },
  { icon: Users, title: 'Docente / RH acadêmico', text: 'Cadastro de docentes (titulação, regime, valor-hora), atividades com cálculo de valores e aceite de disciplinas.' },
  { icon: BarChart3, title: 'Avaliação Institucional (CPA)', text: 'Questionários por dimensões, NPS, aplicação por link público e dashboard de resultados e participação.' },
  { icon: ShieldCheck, title: 'Conformidade MEC', text: 'Censo INEP, SISTEC e ENADE — exportações e validações de consistência prontas para os órgãos reguladores.' },
] as const

function AcademicoErp() {
  return (
    <section id="erp" class="border-y border-line bg-ink py-16 text-surface sm:py-24">
      <div class="mx-auto max-w-6xl px-5">
        <div class="mx-auto max-w-2xl text-center">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-surface/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-surface">
            <GraduationCap class="size-3.5" />
            ERP acadêmico nativo
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Muito além da captação: gerimos a instituição inteira
          </h2>
          <p class="mt-4 text-lg text-surface/70">
            Um ERP acadêmico 100% nativo e integrado — pedagógico, financeiro,
            secretaria e conformidade MEC no mesmo sistema que capta o aluno.
            Sem exportar planilha, sem juntar fornecedores.
          </p>
        </div>
        <div class="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ERP_AREAS.map((a) => {
            const Icon = a.icon
            return (
              <div key={a.title} class="rounded-card border border-surface/10 bg-surface/5 p-6">
                <span class="grid size-11 place-items-center rounded-xl bg-brand/20 text-brand">
                  <Icon class="size-6" />
                </span>
                <h3 class="mt-4 font-bold">{a.title}</h3>
                <p class="mt-1.5 text-sm text-surface/65">{a.text}</p>
              </div>
            )
          })}
        </div>
        <div class="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-2xl border border-surface/10 bg-surface/5 p-5">
          <ShieldCheck class="mt-0.5 size-5 shrink-0 text-brand" />
          <p class="text-sm text-surface/75">
            Ainda inclui comunicação (régua de cobrança e avisos de notas por
            WhatsApp/e-mail), GED de documentos do aluno, controle de acesso por
            catraca, ponte com EAD/LMS e alocação de salas — com os dados na sua
            infraestrutura (soberania) e conformidade com a LGPD.
          </p>
        </div>
      </div>
    </section>
  )
}

const NEW_FEATURES_EDU = [
  {
    icon: Sparkles,
    title: 'Jornada de matrícula 100% IA',
    text: 'A IA conversa com o candidato, tira dúvidas do curso, qualifica e até agenda a visita ou a entrevista — conduzindo a inscrição de ponta a ponta no WhatsApp.',
  },
  {
    icon: PhoneCall,
    title: 'Ligações por voz no WhatsApp',
    text: 'A equipe de captação liga por voz para o candidato direto do painel (WhatsApp Calling), sem trocar de aparelho e com todo o histórico à mão.',
  },
  {
    icon: Send,
    title: 'Disparos para o vestibular',
    text: 'Campanhas em massa com template oficial para avisar sobre inscrições abertas, provas e rematrícula — com agendamento, opt-out e relatório de entrega.',
  },
  {
    icon: CalendarClock,
    title: 'Agendamento de visitas',
    text: 'Candidatos marcam visita ao campus ou entrevista por um link integrado à agenda, com sincronização bidirecional do Google Calendar e lembretes automáticos.',
  },
] as const

function NewFeaturesEdu() {
  return (
    <section class="relative overflow-hidden py-16 sm:py-24">
      <div class="lp-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div class="relative mx-auto max-w-6xl px-5">
        <div class="max-w-2xl">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
            <Sparkles class="size-3.5" />
            Novidades
          </span>
          <h2 class="mt-4 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Novos recursos para captar e matricular mais
          </h2>
          <p class="mt-4 text-lg text-fg-muted">
            A mesma plataforma, agora com IA conduzindo a conversa e o WhatsApp
            usado por inteiro — da primeira dúvida ao aluno matriculado.
          </p>
        </div>
        <div class="mt-12 grid gap-6 sm:grid-cols-2">
          {NEW_FEATURES_EDU.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                class="lp-card flex gap-4 rounded-card border border-line bg-surface p-6"
              >
                <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon class="size-6" />
                </span>
                <div>
                  <h3 class="text-lg font-bold text-ink">{f.title}</h3>
                  <p class="mt-1.5 text-sm text-fg-muted">{f.text}</p>
                </div>
              </div>
            )
          })}
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
        <AcademicoErp />
        <HowItWorks />
        <NewFeaturesEdu />
        <Audience />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  )
}
