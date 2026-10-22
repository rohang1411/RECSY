'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { quotaStore } from './quota-store';

export function QuotaAnnouncer() {
  const quota = useSyncExternalStore(
    quotaStore.subscribe,
    quotaStore.getSnapshot,
    quotaStore.getServerSnapshot,
  );

  const [announcement, setAnnouncement] = useState('');
  const prevSnapshot = useRef(quota.snapshot);

  useEffect(() => {
    const prev = prevSnapshot.current;
    const curr = quota.snapshot;
    prevSnapshot.current = curr;

    if (!curr || !prev) return;

    // Check free query changes
    if (curr.free.remaining !== prev.free.remaining) {
      if (curr.free.remaining < prev.free.remaining) {
        setAnnouncement(
          `Query used. ${curr.free.remaining} of ${curr.free.allowance} free queries left.`,
        );
      } else {
        setAnnouncement(
          `Query not charged. ${curr.free.remaining} of ${curr.free.allowance} free queries available.`,
        );
      }
      return;
    }

    // Check credit changes
    if (curr.credits !== prev.credits) {
      if (curr.credits > prev.credits) {
        setAnnouncement(`Credits added. New balance: ${curr.credits} credits.`);
      } else {
        setAnnouncement(`Credit used. ${curr.credits} credits remaining.`);
      }
      return;
    }

    // Check subscription query changes
    if (
      curr.subscription &&
      prev.subscription &&
      curr.subscription.usedThisPeriod !== prev.subscription.usedThisPeriod
    ) {
      const remaining = curr.subscription.includedQueries - curr.subscription.usedThisPeriod;
      setAnnouncement(`Pro query used. ${remaining} queries left in this period.`);
    }
  }, [quota.snapshot]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
