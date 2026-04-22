import type { PhoneSpec } from '@/features/phones/schema';
import { formatUsdFromNumericString } from '@/lib/format-usd';

interface PhoneSpecSummaryProps {
  readonly spec: PhoneSpec;
  readonly msrpUsd: string | null;
}

/**
 * High-signal spec grid for the phone page (and shared patterns elsewhere).
 */
export function PhoneSpecSummary({ spec, msrpUsd }: PhoneSpecSummaryProps) {
  const price = formatUsdFromNumericString(msrpUsd);
  const mainCam = spec.rear_cameras[0];
  const camLine = mainCam
    ? `${mainCam.mp}MP${mainCam.zoom ? ` · ${mainCam.zoom}` : ''}${mainCam.type !== 'main' ? ` · ${mainCam.type}` : ''}`
    : '—';

  const rows: { label: string; value: string }[] = [
    { label: 'MSRP (USD)', value: price ?? '—' },
    {
      label: 'Display',
      value: `${spec.display.size_in}" ${spec.display.panel_type} · ${spec.display.resolution} · ${spec.display.refresh_rate_hz}Hz`,
    },
    { label: 'Chipset', value: spec.chipset },
    {
      label: 'RAM / storage',
      value: `${spec.ram_gb}GB · ${spec.storage_options_gb.map((g) => `${g}GB`).join(' / ')}`,
    },
    { label: 'Rear camera', value: camLine },
    { label: 'Front camera', value: `${spec.front_camera.mp}MP` },
    { label: 'Battery', value: `${spec.battery_mah}mAh` },
    {
      label: 'Charging',
      value: `${spec.charging.wired_w}W wired${spec.charging.wireless_w > 0 ? ` · ${spec.charging.wireless_w}W wireless` : ''}`,
    },
    { label: 'Weight', value: `${spec.weight_g}g` },
  ];

  if (spec.dimensions_mm) {
    const { h, w, d } = spec.dimensions_mm;
    rows.push({ label: 'Dimensions (H×W×D mm)', value: `${h} × ${w} × ${d}` });
  }
  if (spec.ip_rating) {
    rows.push({ label: 'IP rating', value: spec.ip_rating });
  }
  if (spec.colors.length) {
    rows.push({ label: 'Colors', value: spec.colors.join(', ') });
  }
  if (spec.highlights.length) {
    rows.push({ label: 'Highlights', value: spec.highlights.join(' · ') });
  }

  return (
    <section className="mt-8" aria-labelledby="specs-heading">
      <h2 id="specs-heading" className="text-foreground text-lg font-semibold">
        Key specifications
      </h2>
      <dl className="border-border/80 bg-card/40 mt-4 divide-y rounded-lg border">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-muted-foreground text-sm font-medium">{r.label}</dt>
            <dd className="text-foreground sm:col-span-2">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
