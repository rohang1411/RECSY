'use client';

let currentTime = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify() {
  currentTime = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function startTimer() {
  if (intervalId || typeof window === 'undefined') return;
  intervalId = setInterval(notify, 1000);
}

function stopTimer() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimer();
    } else {
      notify();
      startTimer();
    }
  });
}

export const clockStore = {
  getSnapshot(): number {
    return currentTime;
  },

  getServerSnapshot(): number {
    return 0;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1 && typeof document !== 'undefined' && !document.hidden) {
      startTimer();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopTimer();
      }
    };
  },
};

export function formatCountdown(targetIso: string, now: number = Date.now()): string {
  const targetMs = new Date(targetIso).getTime();
  const diffMs = Math.max(0, targetMs - now);

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatLocalTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return '00:00 UTC';
  }
}
