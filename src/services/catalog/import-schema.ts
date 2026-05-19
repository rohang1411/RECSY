/**
 * Catalog import and promotion claim schemas.
 *
 * Purpose: define the non-LLM contract that a trusted structured source must
 * satisfy before a staged candidate can be promoted into `phones`.
 *
 * Used by: catalog import/sync scripts and promotion code.
 */
import { z } from 'zod';

const RearCameraTypeSchema = z.enum([
  'main',
  'ultrawide',
  'telephoto',
  'periscope',
  'macro',
  'depth',
]);

const RearCameraSchema = z.object({
  type: RearCameraTypeSchema,
  mp: z.number().positive(),
  aperture_f: z.number().positive().optional(),
  ois: z.boolean().optional(),
  zoom: z.string().optional(),
  sensor_size: z.string().optional(),
});

const FrontCameraSchema = z.object({
  mp: z.number().positive(),
  aperture_f: z.number().positive().optional(),
});

const SpecProjectionInputSchema = z.object({
  display: z
    .object({
      size_in: z.number().positive().optional(),
      resolution: z.string().optional(),
      refresh_rate_hz: z.number().int().positive().optional(),
      panel_type: z.string().optional(),
      peak_brightness_nits: z.number().int().positive().optional(),
      features: z.array(z.string()).optional(),
    })
    .optional(),
  chipset: z.string().optional(),
  processNm: z.number().int().positive().optional(),
  ramGb: z.number().int().positive().optional(),
  storageOptionsGb: z.array(z.number().int().positive()).optional(),
  rearCameras: z.array(RearCameraSchema).optional(),
  frontCamera: FrontCameraSchema.optional(),
  batteryMah: z.number().int().positive().optional(),
  charging: z
    .object({
      wired_w: z.number().nonnegative().optional(),
      wireless_w: z.number().nonnegative().optional(),
      reverse_wireless_w: z.number().nonnegative().optional(),
    })
    .optional(),
  weightG: z.number().positive().optional(),
  dimensionsMm: z
    .object({
      h: z.number().positive(),
      w: z.number().positive(),
      d: z.number().positive(),
    })
    .optional(),
  os: z.string().optional(),
  updatePolicy: z.string().optional(),
  connectivity: z
    .object({
      wifi: z.string().optional(),
      bluetooth: z.string().optional(),
      nfc: z.boolean().optional(),
      ir_blaster: z.boolean().optional(),
      usb: z.string().optional(),
      sim: z.string().optional(),
    })
    .optional(),
  ipRating: z.string().optional(),
  colors: z.array(z.string()).optional(),
  foldable: z.boolean().optional(),
  highlights: z.array(z.string()).optional(),
});

export const CatalogImportIdentitySchema = z.object({
  sourceKey: z.string().min(1),
  externalId: z.string().min(1),
  identityType: z.enum([
    'legacy_slug',
    'canonical_key',
    'official_url',
    'wikidata_qid',
    'provider_id',
    'oem_product_id',
    'model_number',
    'sku',
    'gtin',
  ]),
  url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).default(1),
});

export const CatalogImportConfigurationSchema = z.object({
  region: z.string().optional(),
  modelNumber: z.string().optional(),
  sku: z.string().optional(),
  gtin: z.string().optional(),
  ramGb: z.number().int().positive().optional(),
  storageGb: z.number().int().positive().optional(),
  color: z.string().optional(),
  networkVariant: z.string().optional(),
  marketVariant: z.string().optional(),
  simVariant: z.string().optional(),
  priceAmount: z.string().or(z.number()).optional(),
  priceCurrency: z.string().optional(),
  availabilityStatus: z.string().optional(),
  sourceKey: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const CatalogPromotionClaimsSchema = z.object({
  sourceTier: z.enum(['T0', 'T1', 'T2', 'T3', 'T4']),
  brand: z.string().min(1),
  model: z.string().min(1),
  slug: z.string().optional(),
  tagline: z.string().optional(),
  launchDate: z.string().optional(),
  announcedAt: z.string().optional(),
  releasedAt: z.string().optional(),
  status: z.enum(['active', 'upcoming', 'discontinued']).default('active'),
  regionAvailability: z.array(z.string()).default([]),
  msrpUsd: z.string().or(z.number()).optional(),
  imageUrl: z.string().url().optional(),
  officialUrl: z.string().url().optional(),
  aliases: z.array(z.string()).default([]),
  identities: z.array(CatalogImportIdentitySchema).default([]),
  configurations: z.array(CatalogImportConfigurationSchema).default([]),
  spec: SpecProjectionInputSchema,
  raw: z.record(z.string(), z.unknown()).default({}),
});

export const CatalogImportRecordSchema = CatalogPromotionClaimsSchema.extend({
  sourceKey: z.string().min(1),
  sourceType: z.string().min(1).default('structured_import'),
  externalId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});

export const CatalogImportFileSchema = z.union([
  z.array(CatalogImportRecordSchema),
  z.object({ phones: z.array(CatalogImportRecordSchema) }),
]);

export type CatalogPromotionClaims = z.infer<typeof CatalogPromotionClaimsSchema>;
export type CatalogImportRecord = z.infer<typeof CatalogImportRecordSchema>;
export type CatalogImportIdentity = z.infer<typeof CatalogImportIdentitySchema>;

export function parseCatalogImportFile(value: unknown): CatalogImportRecord[] {
  const parsed = CatalogImportFileSchema.parse(value);
  return Array.isArray(parsed) ? parsed : parsed.phones;
}
