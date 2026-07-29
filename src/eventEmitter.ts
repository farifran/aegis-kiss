// src/eventEmitter.ts
export class EventEmitter {
  private listeners: { [key: string]: ((data: unknown) => void)[] } = {};

  on(event: string, listener: (data: unknown) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  emit(event: string, data: unknown): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach((listener) => listener(data));
    }
  }
}

export function getEventEmitter(): EventEmitter {
  return new EventEmitter();
}
