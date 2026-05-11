import { EventEmitter } from 'events';
import type { SSEEvent } from './types';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function emit(projectId: string, event: SSEEvent) {
  try {
    emitter.emit(`project:${projectId}`, event);
  } catch {
    // listener errors must not propagate into pipeline code
  }
}

export function subscribe(projectId: string, handler: (event: SSEEvent) => void) {
  emitter.on(`project:${projectId}`, handler);
  return () => emitter.off(`project:${projectId}`, handler);
}
