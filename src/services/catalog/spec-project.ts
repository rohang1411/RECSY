/**
 * Catalog spec projection.
 *
 * Purpose: convert normalized catalog claims into the strict `PhoneSpec` shape
 * consumed by browse, compare, recommender, and spec embeddings.
 *
 * Used by: future catalog promotion code and fixture tests.
 */
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';

export interface CatalogSpecProjectionInput {
  readonly display?: Partial<PhoneSpec['display']>;
  readonly chipset?: string;
  readonly processNm?: number;
  readonly ramGb?: number;
  readonly storageOptionsGb?: readonly number[];
  readonly rearCameras?: PhoneSpec['rear_cameras'];
  readonly frontCamera?: PhoneSpec['front_camera'];
  readonly batteryMah?: number;
  readonly charging?: Partial<PhoneSpec['charging']>;
  readonly weightG?: number;
  readonly dimensionsMm?: PhoneSpec['dimensions_mm'];
  readonly os?: string;
  readonly updatePolicy?: string;
  readonly connectivity?: Partial<PhoneSpec['connectivity']>;
  readonly ipRating?: string;
  readonly colors?: readonly string[];
  readonly foldable?: boolean;
  readonly highlights?: readonly string[];
}

export interface ProjectionResult {
  readonly ok: boolean;
  readonly spec?: PhoneSpec;
  readonly missing: readonly string[];
  readonly issues: readonly string[];
}

const REQUIRED_DISPLAY_FIELDS = ['size_in', 'resolution', 'refresh_rate_hz', 'panel_type'] as const;

export const CORE_SPEC_FIELDS = [
  'display.size_in',
  'display.resolution',
  'chipset',
  'ram_gb',
  'storage_options_gb',
  'battery_mah',
] as const;

export const SPEC_COMPLETENESS_PROMOTE_OK = 1.0;
export const SPEC_COMPLETENESS_ENRICH_THRESHOLD = 0.7;

export function projectPhoneSpec(input: CatalogSpecProjectionInput): ProjectionResult {
  const missing = findMissingCoreFields(input);
  if (missing.length > 0) {
    return { ok: false, missing, issues: [] };
  }

  const candidate = {
    display: {
      size_in: input.display!.size_in,
      resolution: input.display!.resolution,
      refresh_rate_hz: input.display!.refresh_rate_hz,
      panel_type: input.display!.panel_type,
      peak_brightness_nits: input.display!.peak_brightness_nits,
      features: [...(input.display!.features ?? [])],
    },
    chipset: input.chipset,
    process_nm: input.processNm,
    ram_gb: input.ramGb,
    storage_options_gb: [...input.storageOptionsGb!],
    rear_cameras: input.rearCameras,
    front_camera: input.frontCamera,
    battery_mah: input.batteryMah,
    charging: {
      wired_w: input.charging?.wired_w,
      wireless_w: input.charging?.wireless_w,
      reverse_wireless_w: input.charging?.reverse_wireless_w,
    },
    weight_g: input.weightG,
    dimensions_mm: input.dimensionsMm,
    os: input.os,
    update_policy: input.updatePolicy,
    connectivity: {
      wifi: input.connectivity?.wifi,
      bluetooth: input.connectivity?.bluetooth,
      nfc: input.connectivity?.nfc,
      ir_blaster: input.connectivity?.ir_blaster,
      usb: input.connectivity?.usb,
      sim: input.connectivity?.sim,
    },
    ip_rating: input.ipRating,
    colors: [...(input.colors ?? [])],
    foldable: input.foldable ?? false,
    highlights: [...(input.highlights ?? [])],
  };

  const parsed = PhoneSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      missing,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  return { ok: true, spec: parsed.data, missing: [], issues: [] };
}

export function phoneSpecToCatalogProjectionInput(spec: PhoneSpec): CatalogSpecProjectionInput {
  return {
    display: spec.display,
    chipset: spec.chipset,
    processNm: spec.process_nm,
    ramGb: spec.ram_gb,
    storageOptionsGb: spec.storage_options_gb,
    rearCameras: spec.rear_cameras,
    frontCamera: spec.front_camera,
    batteryMah: spec.battery_mah,
    charging: spec.charging,
    weightG: spec.weight_g,
    dimensionsMm: spec.dimensions_mm,
    os: spec.os,
    updatePolicy: spec.update_policy,
    connectivity: spec.connectivity,
    ipRating: spec.ip_rating,
    colors: spec.colors,
    foldable: spec.foldable,
    highlights: spec.highlights,
  };
}

export function findMissingCoreFields(input: CatalogSpecProjectionInput): string[] {
  const missing: string[] = [];
  if (input.display?.size_in == null) missing.push('display.size_in');
  if (!input.display?.resolution) missing.push('display.resolution');
  if (!input.chipset) missing.push('chipset');
  if (input.ramGb == null) missing.push('ram_gb');
  if (!input.storageOptionsGb || input.storageOptionsGb.length === 0) {
    missing.push('storage_options_gb');
  }
  if (input.batteryMah == null) missing.push('battery_mah');
  return missing;
}

export function findMissingProjectionFields(input: CatalogSpecProjectionInput): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_DISPLAY_FIELDS) {
    if (input.display?.[field] == null) missing.push(`display.${field}`);
  }
  if (!input.chipset) missing.push('chipset');
  if (input.ramGb == null) missing.push('ram_gb');
  if (!input.storageOptionsGb || input.storageOptionsGb.length === 0) {
    missing.push('storage_options_gb');
  }
  if (!input.rearCameras || input.rearCameras.length === 0) missing.push('rear_cameras');
  if (!input.frontCamera) missing.push('front_camera');
  if (input.batteryMah == null) missing.push('battery_mah');
  if (input.charging?.wired_w == null) missing.push('charging.wired_w');
  if (input.charging?.wireless_w == null) missing.push('charging.wireless_w');
  if (input.weightG == null) missing.push('weight_g');
  if (!input.os) missing.push('os');
  if (!input.connectivity?.wifi) missing.push('connectivity.wifi');
  if (!input.connectivity?.bluetooth) missing.push('connectivity.bluetooth');
  if (input.connectivity?.nfc == null) missing.push('connectivity.nfc');
  return missing;
}

export function specCompleteness(input: CatalogSpecProjectionInput): number {
  const requiredCount = 17;
  const missing = findMissingProjectionFields(input).length;
  return Math.max(0, Math.min(1, (requiredCount - missing) / requiredCount));
}
