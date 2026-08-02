/**
 * L17 — Asynchronous Event-Driven PubSub Router
 * Priority Queue handling, Pattern Matching (*, # wildcards), Dead-Letter Queue (DLQ), and Backpressure control.
 */

export interface EventMessage<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  priority: number;
  attempts: number;
  timestamp: number;
}

export type EventHandler<T = unknown> = (event: EventMessage<T>) => Promise<void> | void;

function createEventId(counter: number): string {
  const ts = Date.now().toString(16);
  const seq = counter.toString(16).padStart(4, "0");
  return `${ts}-${seq}`;
}

export class EventRouter<T = unknown> {
  private handlers: Map<string, Set<EventHandler<T>>> = new Map();
  private priorityQueue: EventMessage<T>[] = [];
  private deadLetterQueue: EventMessage<T>[] = [];
  private maxQueueSize: number;
  private maxRetries: number;
  private isProcessing: boolean = false;
  private messageCounter: number = 0;

  constructor(maxQueueSize: number = 100, maxRetries: number = 3) {
    this.maxQueueSize = maxQueueSize;
    this.maxRetries = maxRetries;
  }

  public subscribe(pattern: string, handler: EventHandler<T>): void {
    let set = this.handlers.get(pattern);
    if (!set) {
      set = new Set();
      this.handlers.set(pattern, set);
    }
    set.add(handler);
  }

  public unsubscribe(pattern: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(pattern);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(pattern);
      }
    }
  }

  public publish(topic: string, payload: T, priority: number = 1): boolean {
    if (this.priorityQueue.length >= this.maxQueueSize) {
      return false;
    }

    this.messageCounter++;
    const event: EventMessage<T> = {
      id: createEventId(this.messageCounter),
      topic,
      payload,
      priority,
      attempts: 0,
      timestamp: Date.now()
    };

    this.priorityQueue.push(event);
    this.priorityQueue.sort((a, b) => b.priority - a.priority);
    void this.triggerProcessing();
    return true;
  }

  public getQueueLength(): number {
    return this.priorityQueue.length;
  }

  public getDLQ(): EventMessage<T>[] {
    return [...this.deadLetterQueue];
  }

  public clearDLQ(): void {
    this.deadLetterQueue = [];
  }

  private matchTopic(pattern: string, topic: string): boolean {
    if (pattern === topic || pattern === "#") return true;
    const patternParts = pattern.split(".");
    const topicParts = topic.split(".");

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      if (p === "#") return true;
      if (p === "*") {
        if (i >= topicParts.length) return false;
        continue;
      }
      if (p !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }

  private async triggerProcessing(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.priorityQueue.length > 0) {
      const event = this.priorityQueue.shift();
      if (!event) continue;
      event.attempts++;

      const matchingHandlers: EventHandler<T>[] = [];
      for (const [pattern, handlerSet] of this.handlers.entries()) {
        if (this.matchTopic(pattern, event.topic)) {
          handlerSet.forEach((h) => matchingHandlers.push(h));
        }
      }

      try {
        await Promise.all(matchingHandlers.map((h) => h(event)));
      } catch {
        if (event.attempts < this.maxRetries) {
          this.priorityQueue.push(event);
          this.priorityQueue.sort((a, b) => b.priority - a.priority);
        } else {
          this.deadLetterQueue.push(event);
        }
      }
    }

    this.isProcessing = false;
  }
}

export async function rotearEventoComPrioridade(
  router: EventRouter,
  topic: string,
  payload: unknown,
  priority: number
): Promise<boolean> {
  return router.publish(topic, payload, priority);
}
