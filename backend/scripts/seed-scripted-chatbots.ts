// scripts/seed-scripted-chatbots.ts
// Cria/atualiza (idempotente) os 2 chatbots determinísticos de WhatsApp que
// rodam a jornada dos formulários de tráfego pago (Faculdades e Escolas).
//
// Resolve o FORM por NOME (os IDs variam entre tenants). Não vincula instância
// de WhatsApp — isso é feito no painel pelo operador.
//
// Uso: npx tsx scripts/seed-scripted-chatbots.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// [nome do chatbot, fragmentos que identificam o form de origem]
const SPECS: Array<{ chatbotName: string; formMatch: string[] }> = [
  { chatbotName: 'Tráfego Pago — Faculdades (WhatsApp)', formMatch: ['tráfego', 'faculdade'] },
  { chatbotName: 'Tráfego Pago — Escolas (WhatsApp)', formMatch: ['tráfego', 'escola'] },
]

async function resolveForm(fragments: string[]) {
  const forms = await prisma.form.findMany({ select: { id: true, name: true, funnelId: true } })
  const norm = (s: string) => s.toLowerCase()
  const hit = forms.find((f) => fragments.every((frag) => norm(f.name).includes(norm(frag))))
  return hit ?? null
}

async function seed() {
  for (const spec of SPECS) {
    const form = await resolveForm(spec.formMatch)
    if (!form) {
      console.warn(`⚠️  Form não encontrado para [${spec.formMatch.join(' + ')}] — pulando "${spec.chatbotName}". Crie/renomeie o formulário e rode de novo.`)
      continue
    }
    const existing = await prisma.chatbot.findFirst({ where: { name: spec.chatbotName } })
    const data = {
      name: spec.chatbotName,
      channel: 'whatsapp',
      mode: 'scripted',
      formId: form.id,
      funnelId: form.funnelId ?? null,
      active: true,
      // LongText NOT NULL — vazios (não usados no modo scripted).
      systemPrompt: '', extractionPrompt: '', analysisPrompt: '',
      greetingMessage: '', completionMessage: '',
    }
    if (existing) {
      await prisma.chatbot.update({ where: { id: existing.id }, data: { mode: 'scripted', formId: form.id, funnelId: form.funnelId ?? null, channel: 'whatsapp', active: true } })
      console.log(`✓ Atualizado: "${spec.chatbotName}" (#${existing.id}) → form #${form.id} "${form.name}"`)
    } else {
      const cb = await prisma.chatbot.create({ data })
      console.log(`✓ Criado: "${spec.chatbotName}" (#${cb.id}) → form #${form.id} "${form.name}"`)
    }
  }
  console.log('\nPronto. Vincule cada chatbot a um número de WhatsApp no painel (Conexões/Instâncias) para testar.')
}

seed().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
