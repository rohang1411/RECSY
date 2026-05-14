'use client';

import { motion } from 'motion/react';

import type { RetrievalStage } from '@/services/internal/retrieval-explain';

export function RetrievalFunnel({ stages }: { readonly stages: readonly RetrievalStage[] }) {
  const max = Math.max(...stages.map((stage) => stage.count), 1);

  return (
    <div className="grid gap-2">
      {stages.map((stage, index) => (
        <motion.article
          key={stage.id}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 24 }}
          className="border-border/50 bg-background/70 rounded-md border p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-foreground text-sm font-medium">{stage.label}</p>
              <p className="text-muted-foreground mt-1 text-xs">{stage.detail}</p>
            </div>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {stage.count.toLocaleString('en-US')}
            </span>
          </div>
          <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${Math.max(4, (stage.count / max) * 100)}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: index * 0.04 }}
              className="h-full rounded-full"
              style={{ background: stage.color }}
            />
          </div>
        </motion.article>
      ))}
    </div>
  );
}
