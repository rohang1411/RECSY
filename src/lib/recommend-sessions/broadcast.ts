/**
 * Cross-tab synchronization via BroadcastChannel with localStorage fallback (Plan 27 WP-07).
 *
 * Messages carry only event types, session IDs, and owner keys — never sensitive conversation text or picks.
 */

export interface BroadcastSessionChanged {
  type: 'changed';
  id?: string;
  ownerKey?: string;
}

export interface BroadcastSessionDeleted {
  type: 'deleted';
  id: string;
  ownerKey?: string;
}

export interface BroadcastSignedOut {
  type: 'signed-out';
  ownerKey?: string;
}

export type BroadcastMessage =
  | BroadcastSessionChanged
  | BroadcastSessionDeleted
  | BroadcastSignedOut;

const CHANNEL_NAME = 'recsy:rec-sessions';
const PING_KEY = 'recsy:rec:ping';

let channelInstance: BroadcastChannel | null = null;

export function closeBroadcastChannel(): void {
  if (channelInstance) {
    try {
      channelInstance.close();
    } catch {
      // Ignore
    }
    channelInstance = null;
  }
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channelInstance) {
    try {
      channelInstance = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channelInstance = null;
    }
  }
  return channelInstance;
}

/**
 * Broadcast a session lifecycle event across open browser tabs.
 */
export function broadcastSessionChange(message: BroadcastMessage): void {
  if (typeof window === 'undefined') return;

  const channel = getBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage(message);
      return;
    } catch {
      // Fall through to localStorage ping
    }
  }

  // Fallback: trigger storage event via localStorage key
  try {
    const payload = JSON.stringify({ ...message, _t: Date.now() });
    window.localStorage.setItem(PING_KEY, payload);
  } catch {
    // Ignore storage quota or disabled storage
  }
}

/**
 * Subscribe to cross-tab session lifecycle broadcasts.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeSessionBroadcast(
  onMessage: (message: BroadcastMessage) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const channel = getBroadcastChannel();

  // Handler for BroadcastChannel
  const handleBroadcast = (event: MessageEvent<BroadcastMessage>) => {
    if (event.data && typeof event.data.type === 'string') {
      onMessage(event.data);
    }
  };

  if (channel) {
    channel.addEventListener('message', handleBroadcast);
  }

  // Handler for localStorage fallback
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PING_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue) as BroadcastMessage;
        if (parsed && typeof parsed.type === 'string') {
          onMessage(parsed);
        }
      } catch {
        // Ignore malformed ping
      }
    }
  };

  window.addEventListener('storage', handleStorage);

  return () => {
    if (channel) {
      channel.removeEventListener('message', handleBroadcast);
    }
    window.removeEventListener('storage', handleStorage);
  };
}
