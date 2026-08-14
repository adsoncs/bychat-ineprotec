// src/lib/queues.ts
// Definicoes centralizadas de filas BullMQ + conexao Redis compartilhada

import { Queue } from 'bullmq'

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
}

function createQueue(name: string) {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 200,
      removeOnFail: 100,
    },
  })
}

export const queues = {
  whatsapp: createQueue('wf-whatsapp'),
  email: createQueue('wf-email'),
  sms: createQueue('wf-sms'),
  webhook: createQueue('wf-webhook'),
  internalTask: createQueue('wf-internal-task'),
  workflowStep: createQueue('wf-workflow-step'),
  enrichment: createQueue('wf-enrichment'),
  documentReview: createQueue('wf-document-review'),
  essayCorrection: createQueue('wf-essay-correction'),
  cadenceScheduler: createQueue('wf-cadence-scheduler'),
  priorityScore: createQueue('wf-priority-score'),
  aiLeadScore: createQueue('wf-ai-lead-score'),
  conversationAudit: createQueue('wf-conversation-audit'),
  aiJourney: createQueue('wf-ai-journey'),
  // Tick da Jornada IA: poda sugestões vencidas e reanalisa quem ficou parado.
  aiJourneyScheduler: createQueue('wf-ai-journey-scheduler'),
  dbConnector: createQueue('wf-db-connector'),
  voipPoll: createQueue('wf-voip-poll'),
  broadcast: createQueue('wf-broadcast'), // disparo em massa Cloud API (1 job por destinatário)
  // Disparos Inteligentes (números próprios/Evolution): 1 job por destinatário,
  // agendado para o horário que o planner calculou — não é uma fila que "corre".
  smartBroadcast: createQueue('wf-smart-broadcast'),
  // Tick das mensagens agendadas do Conversas. A fila só carrega o 'tick'; o
  // agendamento em si mora no banco (ScheduledMessage), não no Redis.
  scheduledMessages: createQueue('wf-scheduled-messages'),
  // Importação de conversas do aparelho conectado (Evolution/QR): 1 job por chat.
  chatImport: createQueue('wf-chat-import'),
  kommoSync: createQueue('wf-kommo-sync'), // importação/sync da Kommo CRM (jobs por fase/lote)
}

export { redisConnection }
