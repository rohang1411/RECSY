/**
 * Zod schemas for the `phones.spec_json` blob.
 *
 * The DB column is `jsonb` for flexibility — specs evolve, and we don't want
 * a schema migration every time a reviewer surfaces a new spec. Validation
 * happens at the application layer: every write / read goes through
 * `PhoneSpecSchema.parse()` so feature code can trust the shape.
 *
 * NOTE ON ACCURACY: seed data in `scripts/seed/phones-starter.ts` is best-
 * effort and may contain approximations. Phase 2+ ingestion overwrites these
 * fields with reviewer-sourced values where available.
 */
import { z } from 'zod';

export const CameraTypeEnum = z.enum([
  'main',
  'ultrawide',
  'telephoto',
  'periscope',
  'macro',
  'depth',
]);

export const RearCameraSchema = z.object({
  type: CameraTypeEnum,
  mp: z.number().positive(),
  aperture_f: z.number().positive().optional(),
  ois: z.boolean().optional(),
  /** Human-readable zoom description, e.g. "3x optical" / "5x periscope". */
  zoom: z.string().optional(),
  sensor_size: z.string().optional(),
});

export const FrontCameraSchema = z.object({
  mp: z.number().positive(),
  aperture_f: z.number().positive().optional(),
});

export const DisplaySchema = z.object({
  size_in: z.number().positive(),
  /** e.g. "2796x1290". Kept as string because aspect ratios vary. */
  resolution: z.string(),
  refresh_rate_hz: z.number().int().positive(),
  panel_type: z.string(),
  peak_brightness_nits: z.number().int().positive().optional(),
  /** LTPO, always-on display, etc. */
  features: z.array(z.string()).default([]),
});

export const ChargingSchema = z.object({
  wired_w: z.number().nonnegative(),
  wireless_w: z.number().nonnegative(),
  reverse_wireless_w: z.number().nonnegative().optional(),
});

export const ConnectivitySchema = z.object({
  wifi: z.string(),
  bluetooth: z.string(),
  nfc: z.boolean(),
  ir_blaster: z.boolean().optional(),
  usb: z.string().optional(),
  sim: z.string().optional(),
});

export const PhoneSpecSchema = z.object({
  display: DisplaySchema,
  chipset: z.string(),
  process_nm: z.number().int().positive().optional(),
  ram_gb: z.number().int().positive(),
  storage_options_gb: z.array(z.number().int().positive()).min(1),
  rear_cameras: z.array(RearCameraSchema).min(1),
  front_camera: FrontCameraSchema,
  battery_mah: z.number().int().positive(),
  charging: ChargingSchema,
  /** Decimal allowed (manufacturers publish e.g. 185.9 g). */
  weight_g: z.number().positive(),
  dimensions_mm: z
    .object({
      h: z.number().positive(),
      w: z.number().positive(),
      d: z.number().positive(),
    })
    .optional(),
  os: z.string(),
  /** Committed OS update support, e.g. "7 years of OS + security". */
  update_policy: z.string().optional(),
  connectivity: ConnectivitySchema,
  ip_rating: z.string().optional(),
  colors: z.array(z.string()).default([]),
  foldable: z.boolean().default(false),
  /** Free-text highlight tags used by the recommender's "why this phone" copy. */
  highlights: z.array(z.string()).default([]),
});

export type PhoneSpec = z.infer<typeof PhoneSpecSchema>;
