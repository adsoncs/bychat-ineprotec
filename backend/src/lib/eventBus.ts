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
    setImmediate(() => {
      try {
        this.emit(event.type, event)
        this.emit('*', event)
      } catch (err) {
        console.error(`[EventBus] Error emitting ${event.type}:`, err)
      }
    })
  }
}

export const eventBus = new DomainEventBus()
eventBus.setMaxListeners(50)
