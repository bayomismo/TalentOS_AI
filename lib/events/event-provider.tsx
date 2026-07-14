'use client'

/**
 * React provider that exposes the event bus to the entire client tree.
 *
 * Children can call `useEventBus()` to publish events or `useTalentOSEvent`
 * to subscribe to one. Subscription is automatic; the bus handles cleanup
 * on unmount.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

import { getEventBus } from './event-bus'
import type { EventBus } from './event-bus'
import type { TalentOSEvent, TalentOSEventType } from './types'

const EventBusContext = createContext<EventBus | null>(null)

export function EventBusProvider({ children }: { children: ReactNode }) {
  // getEventBus is safe in the browser — it lazily attaches to window.
  const bus = useMemo(() => getEventBus(), [])
  return <EventBusContext.Provider value={bus}>{children}</EventBusContext.Provider>
}

export function useEventBus(): EventBus {
  const bus = useContext(EventBusContext)
  if (!bus) {
    throw new Error('useEventBus must be used inside <EventBusProvider>')
  }
  return bus
}

/**
 * Subscribe to a specific event type. The listener fires for every published
 * event of that type until the component unmounts.
 */
export function useTalentOSEvent<E extends TalentOSEventType>(
  type: E,
  listener: (event: Extract<TalentOSEvent, { type: E }>) => void
) {
  const bus = useEventBus()
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(() => {
    return bus.subscribe(type, event => listenerRef.current(event))
  }, [bus, type])
}

/** Subscribe to every event. */
export function useTalentOSEvents(listener: (event: TalentOSEvent) => void) {
  const bus = useEventBus()
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(() => {
    return bus.subscribeAll(event => listenerRef.current(event))
  }, [bus])
}
