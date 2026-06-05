import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotChatbot } from '../services/trash.js'

export async function chatbotsRoutes(app: FastifyInstance) {

  // GET /api/admin/chatbots — List all
  app.get('/api/admin/chatbots', { preHandler: adminOnly }, async () => {
    const chatbots = await prisma.chatbot.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { questions: true } } }
    })
    return { chatbots }
  })

  // GET /api/admin/chatbots/:id — Get with questions
  app.get('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: Number(id) },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } }
    })
    if (!chatbot) return reply.code(404).send({ error: 'Chatbot não encontrado' })
    return chatbot
  })

  // POST /api/admin/chatbots — Create
  app.post('/api/admin/chatbots', { preHandler: adminOnly }, async (req) => {
    const { name, channel, mode, formId, systemPrompt, extractionPrompt, analysisPrompt, greetingMessage, completionMessage } = req.body as any
    const chatbot = await prisma.chatbot.create({
      data: {
        name: name || 'Novo Chatbot',
        channel: channel || 'chat',
        mode: mode === 'scripted' ? 'scripted' : 'ai',
        ...(formId ? { formId: Number(formId) } : {}),
        systemPrompt: systemPrompt || '',
        extractionPrompt: extractionPrompt || '',
        analysisPrompt: analysisPrompt || '',
        greetingMessage: greetingMessage || '',
        completionMessage: completionMessage || ''
      }
    })
    return chatbot
  })

  // PUT /api/admin/chatbots/:id — Update
  app.put('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of ['name', 'channel', 'mode', 'formId', 'useFlow', 'scriptedMessages', 'funnelId', 'defaultTeamId', 'systemPrompt', 'extractionPrompt', 'analysisPrompt', 'greetingMessage', 'completionMessage', 'active', 'inactivityEnabled', 'inactivityAction', 'inactivityTimeoutMin', 'inactivityMessage', 'inactivityCheckIntervalMin', 'inactivityMaxRetries', 'inactivityCloseAfterMin']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    const chatbot = await prisma.chatbot.update({ where: { id: Number(id) }, data })
    return chatbot
  })

  // ── EXPORT ──
  // GET /api/admin/chatbots/:id/export — devolve JSON com a configuração completa
  // do chatbot (campos diretos + questions + nomes de referências externas).
  // Content-Disposition: attachment força o download direto pelo browser.
  // O JSON é portável: pode ser importado de volta neste sistema (mesma instância
  // ou outra) via POST /api/admin/chatbots/import.
  app.get('/api/admin/chatbots/:id/export', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const chatbot = await prisma.chatbot.findUnique({
      where: { id },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } },
    })
    if (!chatbot) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    // Inclui o NOME de cada referência (funnel/team/portal) — no import, tentamos
    // resolver o ID equivalente por nome. Se não bater, a ref fica null e o
    // operador escolhe manualmente depois.
    const [funnel, team] = await Promise.all([
      chatbot.funnelId      ? prisma.funnel.findUnique({ where: { id: chatbot.funnelId      }, select: { name: true } }) : Promise.resolve(null),
      chatbot.defaultTeamId ? prisma.team.findUnique({   where: { id: chatbot.defaultTeamId }, select: { name: true, slug: true } }) : Promise.resolve(null),
    ])

    const payload = {
      kind:       'bychat-chatbot-export',
      version:    1,
      exportedAt: new Date().toISOString(),
      sourceId:   chatbot.id,
      chatbot: {
        name:                       chatbot.name,
        channel:                    chatbot.channel,
        active:                     chatbot.active,
        systemPrompt:               chatbot.systemPrompt,
        extractionPrompt:           chatbot.extractionPrompt,
        analysisPrompt:             chatbot.analysisPrompt,
        greetingMessage:            chatbot.greetingMessage,
        completionMessage:          chatbot.completionMessage,
        scoringConfig:              chatbot.scoringConfig,
        sentimentPrompt:            chatbot.sentimentPrompt,
        autoAnalysis:               chatbot.autoAnalysis,
        inactivityEnabled:          chatbot.inactivityEnabled,
        inactivityAction:           chatbot.inactivityAction,
        inactivityTimeoutMin:       chatbot.inactivityTimeoutMin,
        inactivityMessage:          chatbot.inactivityMessage,
        inactivityCheckIntervalMin: chatbot.inactivityCheckIntervalMin,
        inactivityMaxRetries:       chatbot.inactivityMaxRetries,
        inactivityCloseAfterMin:    chatbot.inactivityCloseAfterMin,
      },
      // Referências externas — guardamos `name`/`slug` pra tentar match no import.
      references: {
        funnel: funnel ? { name: funnel.name } : null,
        team:   team   ? { name: team.name, slug: team.slug } : null,
      },
      questions: chatbot.questions.map((q) => ({
        stage:    q.stage,
        position: q.position,
        fieldKey: q.fieldKey,
        text:     q.text,
        type:     q.type,
        options:  q.options,
        required: q.required,
        active:   q.active,
      })),
    }

    const slug = String(chatbot.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `chatbot-${id}`
    const date = new Date().toISOString().slice(0, 10)
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="chatbot-${slug}-${date}.json"`)
    return payload
  })

  // ── IMPORT ──
  // POST /api/admin/chatbots/import — body { payload, name?, importQuestions? }
  // Cria um chatbot novo a partir do JSON exportado. Aceita override do nome
  // (campo `name`); se omitido, usa `${original} (importado)`.
  // `importQuestions` (default true) controla se traz as perguntas junto.
  app.post('/api/admin/chatbots/import', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const payload = body?.payload
    const overrideName = typeof body?.name === 'string' ? body.name.trim() : ''
    const importQuestions = body?.importQuestions !== false

    if (!payload || payload.kind !== 'bychat-chatbot-export' || !payload.chatbot) {
      return reply.code(400).send({ error: 'Arquivo inválido — não é um export de chatbot.' })
    }
    if (typeof payload.version !== 'number' || payload.version > 1) {
      return reply.code(400).send({ error: `Versão de export não suportada (${payload.version}).` })
    }

    const c = payload.chatbot ?? {}
    const refs = payload.references ?? {}

    // Tenta resolver referências por nome/slug. Se não encontrar, mantém null.
    const [resolvedFunnel, resolvedTeam] = await Promise.all([
      refs.funnel?.name ? prisma.funnel.findFirst({ where: { name: String(refs.funnel.name) }, select: { id: true } }) : Promise.resolve(null),
      refs.team?.slug   ? prisma.team.findUnique({ where: { slug: String(refs.team.slug) }, select: { id: true } })
        : refs.team?.name ? prisma.team.findFirst({ where: { name: String(refs.team.name) }, select: { id: true } })
        : Promise.resolve(null),
    ])

    const name = overrideName || `${String(c.name ?? 'Chatbot importado')} (importado)`

    const created = await prisma.$transaction(async (tx) => {
      const chatbot = await tx.chatbot.create({
        data: {
          name:                       name.slice(0, 191),
          channel:                    String(c.channel ?? 'chat'),
          active:                     c.active === true, // por segurança, importa desativado se não vier explícito
          systemPrompt:               String(c.systemPrompt ?? ''),
          extractionPrompt:           String(c.extractionPrompt ?? ''),
          analysisPrompt:             String(c.analysisPrompt ?? ''),
          greetingMessage:            String(c.greetingMessage ?? ''),
          completionMessage:          String(c.completionMessage ?? ''),
          scoringConfig:              c.scoringConfig ?? undefined,
          sentimentPrompt:            c.sentimentPrompt ?? null,
          autoAnalysis:               c.autoAnalysis !== false,
          inactivityEnabled:          c.inactivityEnabled === true,
          inactivityAction:           c.inactivityAction ?? null,
          inactivityTimeoutMin:       Number.isFinite(c.inactivityTimeoutMin)       ? Number(c.inactivityTimeoutMin)       : null,
          inactivityMessage:          c.inactivityMessage ?? null,
          inactivityCheckIntervalMin: Number.isFinite(c.inactivityCheckIntervalMin) ? Number(c.inactivityCheckIntervalMin) : null,
          inactivityMaxRetries:       Number.isFinite(c.inactivityMaxRetries)       ? Number(c.inactivityMaxRetries)       : null,
          inactivityCloseAfterMin:    Number.isFinite(c.inactivityCloseAfterMin)    ? Number(c.inactivityCloseAfterMin)    : null,
          funnelId:      resolvedFunnel?.id ?? null,
          defaultTeamId: resolvedTeam?.id   ?? null,
        },
      })

      const questionsRaw: any[] = Array.isArray(payload.questions) ? payload.questions : []
      let importedQuestions = 0
      if (importQuestions && questionsRaw.length > 0) {
        await tx.chatQuestion.createMany({
          data: questionsRaw.map((q: any, idx: number) => ({
            chatbotId: chatbot.id,
            stage:     Number.isFinite(q.stage)    ? Number(q.stage)    : 0,
            position:  Number.isFinite(q.position) ? Number(q.position) : idx,
            fieldKey:  String(q.fieldKey ?? `field_${idx}`),
            text:      String(q.text ?? ''),
            type:      String(q.type ?? 'text'),
            options:   q.options ?? undefined,
            required:  q.required !== false,
            active:    q.active   !== false,
          })),
        })
        importedQuestions = questionsRaw.length
      }

      return { chatbot, importedQuestions }
    })

    return {
      ok: true,
      chatbot: created.chatbot,
      importedQuestions: created.importedQuestions,
      resolvedReferences: {
        funnelId:      resolvedFunnel?.id ?? null,
        defaultTeamId: resolvedTeam?.id   ?? null,
      },
      // Avisa o operador se alguma referência veio do export mas não foi encontrada nesta instância.
      unresolvedReferences: {
        ...(refs.funnel?.name && !resolvedFunnel ? { funnel: refs.funnel.name } : {}),
        ...(refs.team?.name   && !resolvedTeam   ? { team:   refs.team.name   } : {}),
      },
    }
  })

  // POST /api/admin/chatbots/:id/duplicate — Duplicar chatbot
  // Espelha o padrão de POST /api/forms/:id/duplicate e /api/pages/:id/duplicate.
  // Cria nova entrada com sufixo "(Cópia)" e clona TODAS as ChatQuestion via
  // transação. Mantém configurações genéricas (prompts, scoring, inactivity).
  // Não duplica execuções de leads — chatbot fica zerado pra começar limpo.
  app.post('/api/admin/chatbots/:id/duplicate', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const original = await prisma.chatbot.findUnique({
      where: { id: Number(id) },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } },
    })
    if (!original) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    const copy = await prisma.$transaction(async (tx) => {
      const clone = await tx.chatbot.create({
        data: {
          name: `${original.name} (Cópia)`.slice(0, 191),
          channel: original.channel,
          funnelId: original.funnelId,
          systemPrompt: original.systemPrompt,
          extractionPrompt: original.extractionPrompt,
          analysisPrompt: original.analysisPrompt,
          greetingMessage: original.greetingMessage,
          completionMessage: original.completionMessage,
          // Inicia inativo por segurança — operador revisa e ativa.
          active: false,
          scoringConfig: (original.scoringConfig as any) ?? undefined,
          sentimentPrompt: original.sentimentPrompt,
          autoAnalysis: original.autoAnalysis,
          inactivityEnabled: original.inactivityEnabled,
          inactivityAction: original.inactivityAction,
          inactivityTimeoutMin: original.inactivityTimeoutMin,
          inactivityMessage: original.inactivityMessage,
          inactivityCheckIntervalMin: original.inactivityCheckIntervalMin,
          inactivityMaxRetries: original.inactivityMaxRetries,
          inactivityCloseAfterMin: original.inactivityCloseAfterMin,
          defaultTeamId: original.defaultTeamId,
        },
      })

      // Clona todas as perguntas mantendo ordem e configuração.
      if (original.questions.length > 0) {
        await tx.chatQuestion.createMany({
          data: original.questions.map((q) => ({
            chatbotId: clone.id,
            stage: q.stage,
            position: q.position,
            fieldKey: q.fieldKey,
            text: q.text,
            type: q.type,
            options: (q.options as any) ?? undefined,
            required: q.required,
            active: q.active,
          })),
        })
      }

      return clone
    })

    return reply.code(201).send({ ok: true, chatbot: copy })
  })

  // DELETE /api/admin/chatbots/:id (move para lixeira)
  app.delete('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotChatbot(Number(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'chatbot',
        entityId: Number(id),
        entityLabel: snapshot.name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.chatbot.delete({ where: { id: Number(id) } })
    return { ok: true }
  })

  // ── Questions CRUD ──

  // GET /api/admin/chatbots/:id/questions
  app.get('/api/admin/chatbots/:id/questions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const questions = await prisma.chatQuestion.findMany({
      where: { chatbotId: Number(id) },
      orderBy: [{ stage: 'asc' }, { position: 'asc' }]
    })
    return { questions }
  })

  // POST /api/admin/chatbots/:id/questions
  app.post('/api/admin/chatbots/:id/questions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const { stage, position, fieldKey, text, type, options, required } = req.body as any
    const maxPos = await prisma.chatQuestion.aggregate({
      where: { chatbotId: Number(id), stage: stage ?? 0 },
      _max: { position: true }
    })
    const q = await prisma.chatQuestion.create({
      data: {
        chatbotId: Number(id),
        stage: stage ?? 0,
        position: position ?? ((maxPos._max.position ?? -1) + 1),
        fieldKey: fieldKey || 'campo',
        text: text || 'Pergunta',
        type: type || 'text',
        options: options || null,
        required: required ?? true
      }
    })
    return q
  })

  // PUT /api/admin/chatbots/:id/questions/:qid
  app.put('/api/admin/chatbots/:id/questions/:qid', { preHandler: adminOnly }, async (req) => {
    const { qid } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of ['stage', 'position', 'fieldKey', 'text', 'type', 'options', 'required', 'active']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    const q = await prisma.chatQuestion.update({ where: { id: Number(qid) }, data })
    return q
  })

  // DELETE /api/admin/chatbots/:id/questions/:qid
  app.delete('/api/admin/chatbots/:id/questions/:qid', { preHandler: adminOnly }, async (req) => {
    const { qid } = req.params as any
    await prisma.chatQuestion.delete({ where: { id: Number(qid) } })
    return { ok: true }
  })

  // PUT /api/admin/chatbots/:id/questions/reorder
  app.put('/api/admin/chatbots/:id/questions/reorder', { preHandler: adminOnly }, async (req) => {
    const { order } = req.body as any
    if (!Array.isArray(order)) return { error: 'Formato inválido' }
    for (const item of order) {
      await prisma.chatQuestion.update({ where: { id: item.id }, data: { position: item.position, stage: item.stage } })
    }
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // PUBLIC — Chatbot embed / widget
  // ══════════════════════════════════════════════

  // GET /api/chatbots/public/:id/config — Config pública do chatbot (para widget)
  app.get('/api/chatbots/public/:id/config', async (req, reply) => {
    const { id } = req.params as any
    const chatbot = await prisma.chatbot.findUnique({ where: { id: Number(id) } })
    if (!chatbot || !chatbot.active) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    reply.header('Cache-Control', 'public, max-age=300')
    return {
      id: chatbot.id,
      name: chatbot.name,
      greetingMessage: chatbot.greetingMessage,
      channel: chatbot.channel,
      active: chatbot.active,
    }
  })

  // GET /api/chatbots/embed/:id.js — Script embed do widget de chat
  app.get('/api/chatbots/embed/:idjs', async (req, reply) => {
    const idjs = (req.params as any).idjs
    const id = parseInt(idjs.replace('.js', ''))
    if (isNaN(id)) return reply.code(404).send('// chatbot not found')

    const chatbot = await prisma.chatbot.findUnique({ where: { id } })
    if (!chatbot || !chatbot.active) return reply.code(404).send('// chatbot not found')

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const greeting = (chatbot.greetingMessage || 'Olá! Como posso ajudar?').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
    const botName = (chatbot.name || 'Assistente').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')

    const script = `(function(){
  if(customElements.get('beyond-chatbot'))return;

  class BeyondChatbot extends HTMLElement {
    constructor(){
      super();
      this.attachShadow({mode:'open'});
      this._open=false;
      this._leadId=null;
      this._messages=[];
      this._sending=false;
      this._started=false;
    }
    connectedCallback(){
      var self=this;
      var baseUrl='${baseUrl}';
      var greeting=\`${greeting}\`;
      var botName=\`${botName}\`;

      this.shadowRoot.innerHTML=\`
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:host{display:block;position:fixed;bottom:20px;right:20px;z-index:999999;font-family:'Inter','Segoe UI',system-ui,sans-serif}

.bc-toggle{
  width:60px;height:60px;border-radius:50%;background:#1a73e8;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 20px rgba(26,115,232,0.4);transition:transform .2s,box-shadow .2s;
}
.bc-toggle:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(26,115,232,0.5)}
.bc-toggle svg{width:28px;height:28px;fill:#fff}
.bc-toggle.open svg.icon-chat{display:none}
.bc-toggle:not(.open) svg.icon-close{display:none}

.bc-panel{
  display:none;position:absolute;bottom:72px;right:0;
  width:380px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 100px);
  background:#ffffff;border:1px solid #e0e3e7;border-radius:16px;overflow:hidden;
  flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.18);
}
.bc-panel.show{display:flex}

.bc-header{
  background:#1a73e8;padding:16px 18px;display:flex;align-items:center;gap:12px;
  border-bottom:1px solid #1668c9;flex-shrink:0;
}
.bc-avatar{
  width:38px;height:38px;border-radius:50%;background:#ffffff;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:16px;color:#1a73e8;flex-shrink:0;
}
.bc-header-info{flex:1;min-width:0}
.bc-header-name{font-size:14px;font-weight:600;color:#fff}
.bc-header-status{font-size:11px;color:rgba(255,255,255,0.85);margin-top:1px}

.bc-messages{
  flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;
  background:#f8f9fa;
  scrollbar-width:thin;scrollbar-color:#dadce0 transparent;
}
.bc-messages::-webkit-scrollbar{width:5px}
.bc-messages::-webkit-scrollbar-track{background:transparent}
.bc-messages::-webkit-scrollbar-thumb{background:#dadce0;border-radius:3px}

.bc-msg{max-width:85%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}
.bc-msg.bot{background:#ffffff;color:#202124;align-self:flex-start;border-bottom-left-radius:4px;border:1px solid #e8eaed}
.bc-msg.user{background:#1a73e8;color:#fff;align-self:flex-end;border-bottom-right-radius:4px;font-weight:500}

.bc-typing{align-self:flex-start;display:none;padding:12px 16px;background:#ffffff;border:1px solid #e8eaed;border-radius:14px;border-bottom-left-radius:4px}
.bc-typing.show{display:flex}
.bc-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9aa0a6;margin:0 2px;animation:bcDot 1.2s infinite}
.bc-typing span:nth-child(2){animation-delay:.2s}
.bc-typing span:nth-child(3){animation-delay:.4s}
@keyframes bcDot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}

.bc-input-wrap{
  display:flex;gap:8px;padding:12px 16px;background:#ffffff;border-top:1px solid #e0e3e7;flex-shrink:0;
}
.bc-input{
  flex:1;background:#f8f9fa;border:1px solid #dadce0;border-radius:10px;color:#202124;
  padding:10px 14px;font-size:13px;font-family:inherit;outline:none;resize:none;
  min-height:40px;max-height:100px;line-height:1.4;
}
.bc-input::placeholder{color:#9aa0a6}
.bc-input:focus{border-color:#1a73e8;background:#fff}
.bc-send{
  width:40px;height:40px;border-radius:10px;background:#1a73e8;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .15s,background .15s;
}
.bc-send:hover:not(:disabled){background:#1668c9}
.bc-send:disabled{opacity:.4;cursor:default}
.bc-send svg{width:18px;height:18px;fill:#fff}

.bc-powered{text-align:center;padding:6px;font-size:10px;color:#9aa0a6;background:#f8f9fa;border-top:1px solid #e8eaed}
.bc-powered a{color:#1a73e8;text-decoration:none}

@media(max-width:480px){
  :host{bottom:12px;right:12px}
  .bc-panel{width:calc(100vw - 24px);height:calc(100vh - 90px);bottom:68px;border-radius:12px}
  .bc-toggle{width:52px;height:52px}
}
</style>

<div class="bc-panel" id="bc-panel">
  <div class="bc-header">
    <div class="bc-avatar">B</div>
    <div class="bc-header-info">
      <div class="bc-header-name">\${botName}</div>
      <div class="bc-header-status">Online agora</div>
    </div>
  </div>
  <div class="bc-messages" id="bc-msgs"></div>
  <div class="bc-input-wrap">
    <textarea class="bc-input" id="bc-input" placeholder="Digite sua mensagem..." rows="1"></textarea>
    <button class="bc-send" id="bc-send" disabled>
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
  <div class="bc-powered">Powered by <a href="https://agenciabeyond.com.br" target="_blank">Beyond</a></div>
</div>

<button class="bc-toggle" id="bc-toggle">
  <svg class="icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
  <svg class="icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
</button>
\`;

      var toggle=this.shadowRoot.getElementById('bc-toggle');
      var panel=this.shadowRoot.getElementById('bc-panel');
      var msgsEl=this.shadowRoot.getElementById('bc-msgs');
      var input=this.shadowRoot.getElementById('bc-input');
      var sendBtn=this.shadowRoot.getElementById('bc-send');

      toggle.addEventListener('click',function(){
        self._open=!self._open;
        panel.classList.toggle('show',self._open);
        toggle.classList.toggle('open',self._open);
        if(self._open&&!self._started){
          self._started=true;
          startChat();
        }
        if(self._open)setTimeout(function(){input.focus()},100);
      });

      input.addEventListener('input',function(){
        sendBtn.disabled=!input.value.trim()||self._sending;
        input.style.height='auto';
        input.style.height=Math.min(input.scrollHeight,100)+'px';
      });

      input.addEventListener('keydown',function(e){
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend()}
      });

      sendBtn.addEventListener('click',doSend);

      function addMsg(text,role){
        var div=document.createElement('div');
        div.className='bc-msg '+(role==='user'?'user':'bot');
        div.textContent=text;
        msgsEl.appendChild(div);
        msgsEl.scrollTop=msgsEl.scrollHeight;
      }

      function showTyping(show){
        var el=msgsEl.querySelector('.bc-typing');
        if(!el){
          el=document.createElement('div');
          el.className='bc-typing';
          el.innerHTML='<span></span><span></span><span></span>';
          msgsEl.appendChild(el);
        }
        el.classList.toggle('show',show);
        if(show)msgsEl.scrollTop=msgsEl.scrollHeight;
      }

      function startChat(){
        showTyping(true);
        fetch(baseUrl+'/api/bychat/chat/start',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({})
        })
        .then(function(r){return r.json()})
        .then(function(data){
          showTyping(false);
          self._leadId=data.leadId;
          if(data.messages&&data.messages.length>0){
            data.messages.forEach(function(m){addMsg(m.content,'bot')});
          }else{
            addMsg(greeting,'bot');
          }
          sendBtn.disabled=!input.value.trim();
        })
        .catch(function(){
          showTyping(false);
          addMsg(greeting,'bot');
          sendBtn.disabled=!input.value.trim();
        });
      }

      function doSend(){
        var text=input.value.trim();
        if(!text||self._sending)return;
        self._sending=true;
        sendBtn.disabled=true;
        input.value='';
        input.style.height='auto';
        addMsg(text,'user');
        showTyping(true);

        fetch(baseUrl+'/api/bychat/chat/message',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({leadId:self._leadId,message:text})
        })
        .then(function(r){return r.json()})
        .then(function(data){
          showTyping(false);
          self._sending=false;
          if(data.messages){
            data.messages.forEach(function(m){addMsg(m.content,'bot')});
          }else if(data.error){
            addMsg('Desculpe, ocorreu um erro. Tente novamente.','bot');
          }
          sendBtn.disabled=!input.value.trim();
          input.focus();
        })
        .catch(function(){
          showTyping(false);
          self._sending=false;
          addMsg('Erro de conexão. Tente novamente.','bot');
          sendBtn.disabled=!input.value.trim();
        });
      }
    }
  }
  customElements.define('beyond-chatbot',BeyondChatbot);
})();`

    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('Access-Control-Allow-Origin', '*')
      .send(script)
  })

  // GET /api/chatbots/embed/preview/:id — Página HTML de preview do widget
  app.get('/api/chatbots/embed/preview/:id', async (req, reply) => {
    const { id } = req.params as any
    const chatbotId = Number(id)
    if (isNaN(chatbotId)) return reply.code(404).send('Chatbot não encontrado')

    const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } })
    if (!chatbot || !chatbot.active) return reply.code(404).send('Chatbot não encontrado')

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const safeName = String(chatbot.name || 'Chatbot').replace(/[<>&"']/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' } as any)[c]
    )

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview — ${safeName}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:#f8f9fa;color:#202124;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;text-align:center;background:#ffffff;border:1px solid #e0e3e7;border-radius:12px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.06)}
.tag{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:#1a73e8;border:1px solid #1a73e8;border-radius:999px;padding:4px 10px;margin-bottom:14px}
h1{font-size:22px;font-weight:600;margin-bottom:8px;color:#202124}
p{font-size:14px;color:#5f6368;line-height:1.5}
.hint{margin-top:18px;font-size:12px;color:#80868b}
</style>
</head>
<body>
  <div class="card">
    <span class="tag">Preview</span>
    <h1>${safeName}</h1>
    <p>Esta é uma página de demonstração. O widget aparece no canto inferior direito — clique no botão para conversar com o chatbot.</p>
    <div class="hint">Apenas um preview. Use o snippet de embed para colocar em sua própria página.</div>
  </div>
  <script src="${baseUrl}/api/chatbots/embed/${chatbotId}.js" defer></script>
  <beyond-chatbot chatbot-id="${chatbotId}"></beyond-chatbot>
</body>
</html>`

    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(html)
  })

  // GET /api/chatbots/:id/embed-code — Snippet de embed (auth required)
  app.get('/api/chatbots/:id/embed-code', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const baseUrl = process.env.APP_URL || `https://${req.hostname}`

    const snippet = `<!-- Beyond Chatbot Embed -->\n<script src="${baseUrl}/api/chatbots/embed/${id}.js" defer></script>\n<beyond-chatbot chatbot-id="${id}"></beyond-chatbot>`

    return { snippet, baseUrl }
  })
}
