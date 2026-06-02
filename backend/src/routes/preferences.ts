// src/routes/preferences.ts
// Sales Engagement A6: Central de Preferências do lead (LGPD/CAN-SPAM).
//
// Endpoints PÚBLICOS (sem auth) acessados via Lead.optOutToken:
//   GET  /preferencias/:token       → HTML com checkboxes dos canais
//   POST /api/preferencias/:token   → atualiza Lead.optOutChannels (JSON body)
//
// O token é gerado on-demand pelo helper `getOrCreateOptOutToken` quando
// um envio outbound (cadência/email) precisa anexar o link ao rodapé (A7).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { logEvent } from '../services/leadHistory.js'

const ALL_CHANNELS = ['whatsapp', 'email', 'sms'] as const
type PrefChannel = (typeof ALL_CHANNELS)[number]

function htmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  })
}

function renderPage(opts: {
  leadName: string | null
  token: string
  optOut: PrefChannel[]
  saved?: boolean
}): string {
  const { leadName, token, optOut, saved } = opts
  const greet = leadName ? `Olá, ${htmlEscape(leadName)}` : 'Olá'
  const checkbox = (channel: PrefChannel, label: string) => {
    const blocked = optOut.includes(channel)
    return `
      <label class="row">
        <input type="checkbox" name="receive" value="${channel}" ${blocked ? '' : 'checked'} />
        <span>${label}</span>
      </label>`
  }
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Suas preferências de comunicação</title>
  <style>
    :root { color-scheme: light; }
    body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
           max-width: 480px; margin: 40px auto; padding: 0 16px; color: #1f2937; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p.lead { color: #4b5563; margin: 0 0 24px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
            padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 0;
           border-bottom: 1px solid #f3f4f6; }
    .row:last-of-type { border-bottom: none; }
    .row input { width: 18px; height: 18px; }
    button { width: 100%; margin-top: 16px; padding: 12px; border: 0;
             border-radius: 8px; background: #1a73e8; color: #fff;
             font-weight: 600; font-size: 15px; cursor: pointer; }
    button:hover { background: #1666cc; }
    .saved { background: #dcfce7; color: #14532d; padding: 10px;
             border-radius: 8px; margin-bottom: 16px; }
    footer { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${greet}</h1>
  <p class="lead">Escolha como você prefere receber nossas mensagens.
     Você pode mudar isso a qualquer momento.</p>

  <div id="msg" class="saved" style="display:${saved ? 'block' : 'none'}">Preferências salvas. Obrigado!</div>

  <form id="prefs" class="card">
    ${checkbox('whatsapp', 'WhatsApp')}
    ${checkbox('email', 'E-mail')}
    ${checkbox('sms', 'SMS')}
    <button type="submit">Salvar preferências</button>
  </form>

  <footer>Cumprimos a LGPD. Em caso de dúvidas, responda a última mensagem que recebeu.</footer>

  <script>
    document.getElementById('prefs').addEventListener('submit', async function(e) {
      e.preventDefault();
      const all = ['whatsapp','email','sms'];
      const accepted = Array.from(this.querySelectorAll('input[name="receive"]:checked')).map(i => i.value);
      const optOutChannels = all.filter(c => !accepted.includes(c));
      const btn = this.querySelector('button');
      btn.disabled = true;
      try {
        const res = await fetch('/api/preferencias/${htmlEscape(token)}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optOutChannels }),
        });
        if (!res.ok) throw new Error(String(res.status));
        document.getElementById('msg').style.display = 'block';
      } catch (err) {
        alert('Erro ao salvar. Tente novamente.');
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`
}

export async function preferencesRoutes(app: FastifyInstance) {
  // ── GET /preferencias/:token ── HTML público da central de preferências.
  app.get<{ Params: { token: string } }>('/preferencias/:token', async (req, reply) => {
    const lead = await prisma.lead.findUnique({
      where: { optOutToken: req.params.token },
      select: { id: true, nome: true, optOutChannels: true },
    })
    if (!lead) {
      reply.code(404).type('text/html').send('<h1>Link inválido ou expirado</h1>')
      return
    }
    const optOut = parseChannels(lead.optOutChannels)
    reply.type('text/html').send(
      renderPage({ leadName: lead.nome, token: req.params.token, optOut, saved: false }),
    )
  })

  // ── POST /api/preferencias/:token ── Atualiza canais (JSON).
  // Body: { optOutChannels: ["sms", ...] } — lista de canais BLOQUEADOS.
  app.post<{ Params: { token: string }; Body: { optOutChannels?: unknown } }>(
    '/api/preferencias/:token',
    async (req, reply) => {
      const lead = await prisma.lead.findUnique({
        where: { optOutToken: req.params.token },
        select: { id: true, nome: true, optOutChannels: true },
      })
      if (!lead) return reply.code(404).send({ error: 'token inválido' })

      const oldOptOut = parseChannels(lead.optOutChannels)
      const newOptOut = parseChannels(req.body?.optOutChannels)

      await prisma.lead.update({
        where: { id: lead.id },
        data: { optOutChannels: newOptOut },
      })

      // Auditoria LGPD: registra mudança no histórico do lead.
      logEvent({
        leadId: lead.id,
        type: 'opt_out_updated',
        category: 'lifecycle',
        title: 'Preferências de comunicação atualizadas pelo lead',
        actorType: 'lead',
        source: 'preferences_page',
        oldValue: oldOptOut.join(',') || '(nenhum)',
        newValue: newOptOut.join(',') || '(nenhum)',
        ipAddress: req.ip,
        metadata: { via: 'public_token' },
      })

      return { ok: true, optOutChannels: newOptOut }
    },
  )
}

// ─── helpers ─────────────────────────────────────────────

function parseChannels(raw: unknown): PrefChannel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is PrefChannel => ALL_CHANNELS.includes(c as PrefChannel))
}
