import { useSyncExternalStore } from "react";

export const preferences: { timeZone?: string } = {};
const listeners = new Set<() => void>();
export function setTimeZone(timeZone: string) {
  if (preferences.timeZone === timeZone) return;
  preferences.timeZone = timeZone;
  listeners.forEach(listener => listener());
}
export function useTimeZone() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => preferences.timeZone,
  );
}
