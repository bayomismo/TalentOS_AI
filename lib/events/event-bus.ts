/**
 * TalentOS event bus.
 *
 * Lightweight, dependency-free publish/subscribe. Lives in module scope so
 * every importer in a process shares the same instance. The same bus is
 * reused inside the React context provider so subscribers mounted at any
 * depth in the tree receive events fired from anywhere else.
 *
 * Usage:
 *   const bus = getEventBus()
 *   const off = bus.subscribe('HiringRequestCreated', (event) => { ... })
 *   bus.publish({ type: 'HiringRequestCreated', payload: { ... } })
 *   off()
 */

import type { TalentOSEvent, TalentOSEventType } from './types'

type Listener<E extends TalentOSEvent = TalentOSEvent> = (event: E) => void
type AnyListener = (event: TalentOSEvent) => void

class EventBus {
  private listeners = new Map<TalentOSEventType, Set<AnyListener>>()
  private wildcardListeners = new Set<AnyListener>()

  /** Subscribe to one event type. Returns an unsubscribe function. */
  subscribe<E extends TalentOSEventType>(
    type: E,
    listener: (event: Extract<TalentOSEvent, { type: E }>) => void
  ): () => void {
    const set = this.listeners.get(type) ?? new Set<AnyListener>()
    set.add(listener as AnyListener)
    this.listeners.set(type, set)
    return () => {
      set.delete(listener as AnyListener)
    }
  }

  /** Subscribe to every event. */
  subscribeAll(listener: AnyListener): () => void {
    this.wildcardListeners.add(listener)
    return () => {
      this.wildcardListeners.delete(listener)
    }
  }

  /** Fire an event synchronously to all subscribers. */
  publish(event: TalentOSEvent): void {
    const typed = this.listeners.get(event.type)
    if (typed && typed.size > 0) {
      // Snapshot to a copy so listeners that unsubscribe during dispatch
      // don't mutate the set we're iterating. Array.from is O(n) but
      // listeners-per-event is small (<10 in practice).
      const snapshot = Array.from(typed)
      for (let i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i]!(event)
        } catch (err) {
          console.error('[event-bus] listener error', err)
        }
      }
    }
    if (this.wildcardListeners.size > 0) {
      const snapshot = Array.from(this.wildcardListeners)
      for (let i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i]!(event)
        } catch (err) {
          console.error('[event-bus] wildcard listener error', err)
        }
      }
    }
  }

  /** Returns the number of subscribers for a given event type. */
  listenerCount(type: TalentOSEventType): number {
    return (this.listeners.get(type)?.size ?? 0) + this.wildcardListeners.size
  }

  /** Test-only — wipe all subscribers. */
  reset(): void {
    this.listeners.clear()
    this.wildcardListeners.clear()
  }
}

let bus: EventBus | null = null

/** Returns the process-wide bus instance. */
export function getEventBus(): EventBus {
  // On the server, a single module-scoped instance is enough. In the
  // browser we cache on `window` so HMR doesn't create a fresh bus
  // (and silently lose subscribers) on every file save.
  if (typeof window === 'undefined') {
    if (!bus) bus = new EventBus()
    return bus
  }
  type WindowWithBus = Window & { __talentosBus?: EventBus }
  const w = window as WindowWithBus
  if (!w.__talentosBus) {
    w.__talentosBus = new EventBus()
  }
  bus = w.__talentosBus
  return bus
}

/** Test-only — reset the cached bus. */
export function _resetEventBus(): void {
  bus?.reset()
  bus = null
  if (typeof window !== 'undefined') {
    type WindowWithBus = Window & { __talentosBus?: EventBus }
    delete (window as WindowWithBus).__talentosBus
  }
}

export type { Listener, AnyListener }
export { EventBus }
