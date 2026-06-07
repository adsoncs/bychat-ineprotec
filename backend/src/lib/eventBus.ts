// src/lib/eventBus.ts
// Domain event bus — in-process EventEmitter for triggering workflow automations

import { EventEmitter } from 'events'

export interface DomainEvent {
  type: string
  leadId: number
  chatbotId?: number
  funnelId?: number
  payload: Record<string, any>
  timestamp: Date
}

class DomainEventBus extends EventEmitter {
  emitDomain(event: DomainEvent): void {
    // Garante timestamp: emits "crus" (ex.: meeting.scheduled) podem vir sem ele, e o
    // workflowEngine faz event.timestamp.toISOString() — sem isso, estoura e nada dispara.
    const ev: DomainEvent = event.timestamp ? event : { ...event, timestamp: new Date() }
    setImmediate(() => {
      try {
        this.emit(ev.type, ev)
        this.emit('*', ev)
      } catch (err) {
        console.error(`[EventBus] Error emitting ${ev.type}:`, err)
      }
    })
  }
}

export const eventBus = new DomainEventBus()
eventBus.setMaxListeners(50)
