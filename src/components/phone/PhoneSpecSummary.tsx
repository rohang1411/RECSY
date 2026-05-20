import type { PhoneSpec } from '@/features/phones/schema';
import { formatUsdFromNumericString } from '@/lib/format-usd';

interface PhoneSpecSummaryProps {
  readonly spec: PhoneSpec;
  readonly msrpUsd: string | null;
}

export function PhoneSpecSummary({ spec, msrpUsd }: PhoneSpecSummaryProps) {
  const price = formatUsdFromNumericString(msrpUsd);
  const mainCam = spec.rear_cameras?.find((c) => c.type === 'main') ?? spec.rear_cameras?.[0];
  const camLine = mainCam
    ? `${mainCam.mp}MP${mainCam.zoom ? ` / ${mainCam.zoom}` : ''}${mainCam.type !== 'main' ? ` / ${mainCam.type}` : ''}`
    : 'N/A';

  const rows: { label: string; value: string; channel: string }[] = [
    { label: 'MSRP USD', value: price ?? 'TBD', channel: 'Price' },
    {
      label: 'Display',
      value: `${spec.display.size_in}" ${spec.display.panel_type ?? ''} / ${spec.display.resolution} / ${spec.display.refresh_rate_hz ?? '?'}Hz`,
      channel: 'Screen',
    },
    { label: 'Chipset', value: spec.chipset, channel: 'Performance' },
    {
      label: 'RAM and storage',
      value: `${spec.ram_gb}GB / ${spec.storage_options_gb.map((g) => `${g}GB`).join(' / ')}`,
      channel: 'Memory',
    },
    { label: 'Rear camera', value: camLine, channel: 'Camera' },
    {
      label: 'Front camera',
      value: spec.front_camera ? `${spec.front_camera.mp}MP` : 'N/A',
      channel: 'Camera',
    },
    { label: 'Battery', value: `${spec.battery_mah}mAh`, channel: 'Power' },
    {
      label: 'Charging',
      value: `${spec.charging.wired_w ?? '?'}W wired${(spec.charging.wireless_w ?? 0) > 0 ? ` / ${spec.charging.wireless_w}W wireless` : ''}`,
      channel: 'Power',
    },
    { label: 'Weight', value: `${spec.weight_g ?? '?'}g`, channel: 'Build' },
  ];

  if (spec.dimensions_mm) {
    const { h, w, d } = spec.dimensions_mm;
    rows.push({ label: 'Dimensions mm', value: `${h} x ${w} x ${d}`, channel: 'Build' });
  }
  if (spec.ip_rating) {
    rows.push({ label: 'IP rating', value: spec.ip_rating, channel: 'Durability' });
  }
  if (spec.colors.length) {
    rows.push({ label: 'Colors', value: spec.colors.join(' / '), channel: 'Finish' });
  }
  if (spec.highlights.length) {
    rows.push({ label: 'Highlights', value: spec.highlights.join(' / '), channel: 'Notes' });
  }

  return (
    <section className="px-grid-margin py-10" aria-labelledby="specs-heading">
      <div className="border-outline-variant bg-background border">
        <div className="border-outline-variant border-b p-5">
          <h2 id="specs-heading" className="meta-label text-primary">
            Key specifications
          </h2>
        </div>
        <dl className="divide-outline-variant divide-y">
          {rows.map((r) => (
            <div
              key={r.label}
              className="bg-outline-variant hover:bg-primary grid gap-px transition-colors sm:grid-cols-12"
            >
              <dt className="bg-background text-muted-foreground p-4 font-mono text-[11px] tracking-[0.16em] uppercase sm:col-span-3">
                {r.label}
              </dt>
              <dd className="bg-background text-primary p-4 text-sm sm:col-span-7">{r.value}</dd>
              <dd className="bg-background text-muted-foreground p-4 font-mono text-[11px] tracking-[0.16em] uppercase sm:col-span-2">
                {r.channel}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
