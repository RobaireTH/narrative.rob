import { EventEmitter } from 'events';

import type { CompilerThreadRecord } from './thread-store';

export type CompilerEvent =
  | { type: 'thread_updated'; thread: CompilerThreadRecord }
  | { type: 'thread_error'; error: string; thread_id: string };

export type CompilerEventHandler = (event: CompilerEvent) => void;

export class CompilerEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  subscribe(thread_id: string, handler: CompilerEventHandler): () => void {
    this.emitter.on(thread_id, handler);
    return () => this.emitter.off(thread_id, handler);
  }

  publish(thread_id: string, event: CompilerEvent): void {
    this.emitter.emit(thread_id, event);
  }
}
