'use client';

import {
  Activity,
  Bot,
  BrainCircuit,
  Clock3,
  Database,
  FileText,
  Gauge,
  MessageSquareText,
  PackageSearch,
  RadioTower,
  Smartphone,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

import { AnimatedCounter } from './animated-counter';

const ICONS = {
  activity: Activity,
  bot: Bot,
  brain: BrainCircuit,
  clock: Clock3,
  database: Database,
  file: FileText,
  gauge: Gauge,
  message: MessageSquareText,
  packageSearch: PackageSearch,
  radio: RadioTower,
  smartphone: Smartphone,
} satisfies Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>>;

export type MetricIcon = keyof typeof ICONS;

export function MetricCard({
  label,
  value,
  detail,
  icon,
  accent = 'var(--primary)',
  suffix,
  decimals,
  className,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly detail?: string;
  readonly icon: MetricIcon;
  readonly accent?: string;
  readonly suffix?: string;
  readonly decimals?: number;
  readonly className?: string;
}) {
  const Icon = ICONS[icon];
  const numeric = typeof value === 'number';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={cn(
        'border-border/60 bg-card/55 relative overflow-hidden rounded-lg border p-4 shadow-xl shadow-black/10 backdrop-blur-xl',
        className,
      )}
      style={{
        boxShadow: `0 0 0 1px color-mix(in oklch, ${accent} 18%, transparent), 0 18px 52px rgba(0,0,0,0.22)`,
      }}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <p className="text-foreground mt-2 font-mono text-2xl font-semibold tabular-nums">
            {numeric ? (
              <AnimatedCounter value={value} decimals={decimals} suffix={suffix} />
            ) : (
              value
            )}
          </p>
        </div>
        <span
          className="border-border/60 bg-background/70 inline-flex size-9 shrink-0 items-center justify-center rounded-md border"
          style={{ color: accent }}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {detail ? (
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{detail}</p>
      ) : null}
    </motion.article>
  );
}
