/**
 * Canonical registry of mainstream smartphones from the top global brands
 * across the past 3-4 years (2023–2026).
 *
 * Purpose: Ensure our database is self-healing, complete, and contains the top
 * flagships and mid-range devices from Apple, Samsung, Google, OnePlus, Nothing,
 * etc., without relying solely on serendipitous web scrapers or manual requests.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import { phones, phoneAliases, catalogCandidates } from '@/services/db/schema';
import { buildCanonicalKey } from './identity';
import { stableCandidateKey } from './snapshots';
import { hashJson } from './snapshots';

export interface CanonicalFlagshipEntry {
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly variant?: string;
  readonly tagline: string;
  readonly launchDate: string; // ISO date string (YYYY-MM-DD)
  readonly msrpUsd: string;
  readonly regionAvailability: readonly string[];
  readonly spec: PhoneSpec;
  readonly aliases: readonly { alias: string; priority?: number }[];
}

const P = (s: unknown): PhoneSpec => PhoneSpecSchema.parse(s);

export const CANONICAL_FLAGSHIPS: readonly CanonicalFlagshipEntry[] = [
  // ---------------------------------------------------------------------------
  // Google Pixel Family (2023 - 2024 Flagships & Foldables)
  // ---------------------------------------------------------------------------
  {
    slug: 'google-pixel-8',
    brand: 'Google',
    model: 'Pixel 8',
    tagline: 'Google AI powerhouse in a comfortable, pocketable design with 7 years of OS updates.',
    launchDate: '2023-10-04',
    msrpUsd: '699.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Google Pixel 8', priority: 100 },
      { alias: 'Pixel 8', priority: 95 },
      { alias: 'Pixel8', priority: 70 },
      { alias: 'Google Pixel 8 review', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.2,
        resolution: '2400x1080',
        refresh_rate_hz: 120,
        panel_type: 'Actua OLED',
        peak_brightness_nits: 2000,
        features: ['HDR10+', 'Always-on display', 'Corning Gorilla Glass Victus'],
      },
      chipset: 'Google Tensor G3',
      process_nm: 4,
      ram_gb: 8,
      storage_options_gb: [128, 256],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.68, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
      ],
      front_camera: { mp: 10.5, aperture_f: 2.2 },
      battery_mah: 4575,
      charging: { wired_w: 27, wireless_w: 18 },
      weight_g: 187,
      os: 'Android 14',
      update_policy: '7 years of OS, security, and Feature Drops',
      connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP68',
      colors: ['Obsidian', 'Hazel', 'Rose', 'Mint'],
      foldable: false,
      highlights: [
        'compact flagship',
        'industry-leading computational photography',
        '7 years of updates',
        'Google AI',
      ],
    }),
  },
  {
    slug: 'google-pixel-8-pro',
    brand: 'Google',
    model: 'Pixel 8 Pro',
    tagline:
      'Google top 2023 pro flagship with pro camera controls, telephoto lens, and temperature sensor.',
    launchDate: '2023-10-04',
    msrpUsd: '999.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Google Pixel 8 Pro', priority: 100 },
      { alias: 'Pixel 8 Pro', priority: 95 },
      { alias: 'Pixel 8Pro', priority: 70 },
      { alias: 'Google Pixel 8 Pro review', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2992x1344',
        refresh_rate_hz: 120,
        panel_type: 'Super Actua LTPO OLED',
        peak_brightness_nits: 2400,
        features: ['LTPO 1-120Hz', 'HDR10+', 'Always-on display', 'Gorilla Glass Victus 2'],
      },
      chipset: 'Google Tensor G3',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [128, 256, 512, 1024],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.68, ois: true },
        { type: 'ultrawide', mp: 48, aperture_f: 1.95 },
        { type: 'telephoto', mp: 48, aperture_f: 2.8, zoom: '5x optical', ois: true },
      ],
      front_camera: { mp: 10.5, aperture_f: 2.2 },
      battery_mah: 5050,
      charging: { wired_w: 30, wireless_w: 23 },
      weight_g: 213,
      os: 'Android 14',
      update_policy: '7 years of OS, security, and Feature Drops',
      connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP68',
      colors: ['Bay', 'Obsidian', 'Porcelain', 'Mint'],
      foldable: false,
      highlights: [
        'flagship 5x optical telephoto',
        'Pro camera manual controls',
        '7 years of updates',
        'bright LTPO display',
      ],
    }),
  },
  {
    slug: 'google-pixel-8a',
    brand: 'Google',
    model: 'Pixel 8a',
    tagline:
      'Mid-range champion delivering flagship Tensor G3 silicon, 120Hz screen, and 7 years of support.',
    launchDate: '2024-05-07',
    msrpUsd: '499.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Google Pixel 8a', priority: 100 },
      { alias: 'Pixel 8a', priority: 95 },
      { alias: 'Pixel8a', priority: 70 },
      { alias: 'Google Pixel 8a review', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.1,
        resolution: '2400x1080',
        refresh_rate_hz: 120,
        panel_type: 'Actua OLED',
        peak_brightness_nits: 2000,
        features: ['HDR', 'Always-on display', 'Corning Gorilla Glass 3'],
      },
      chipset: 'Google Tensor G3',
      process_nm: 4,
      ram_gb: 8,
      storage_options_gb: [128, 256],
      rear_cameras: [
        { type: 'main', mp: 64, aperture_f: 1.89, ois: true },
        { type: 'ultrawide', mp: 13, aperture_f: 2.2 },
      ],
      front_camera: { mp: 13, aperture_f: 2.2 },
      battery_mah: 4492,
      charging: { wired_w: 18, wireless_w: 7.5 },
      weight_g: 188,
      os: 'Android 14',
      update_policy: '7 years of OS, security, and Feature Drops',
      connectivity: { wifi: 'Wi-Fi 6E', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP67',
      colors: ['Aloe', 'Bay', 'Obsidian', 'Porcelain'],
      foldable: false,
      highlights: [
        'best camera under $500',
        '7 years of updates',
        '120Hz display',
        'flagship Tensor G3 processor',
      ],
    }),
  },
  {
    slug: 'google-pixel-9-pro-fold',
    brand: 'Google',
    model: 'Pixel 9 Pro Fold',
    tagline:
      'Google thinnest foldable with massive 8.0-inch Super Actua Flex display and Tensor G4.',
    launchDate: '2024-09-04',
    msrpUsd: '1799.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Google Pixel 9 Pro Fold', priority: 100 },
      { alias: 'Pixel 9 Pro Fold', priority: 95 },
      { alias: 'Pixel 9 Fold', priority: 85 },
      { alias: 'Google Pixel Fold 2', priority: 75 },
    ],
    spec: P({
      display: {
        size_in: 8.0,
        resolution: '2152x2076',
        refresh_rate_hz: 120,
        panel_type: 'Foldable Super Actua LTPO OLED',
        peak_brightness_nits: 2700,
        features: [
          'LTPO 1-120Hz',
          'Cover: 6.3 inch 1080x2424 120Hz OLED',
          'Gorilla Glass Victus 2',
        ],
      },
      chipset: 'Google Tensor G4',
      process_nm: 4,
      ram_gb: 16,
      storage_options_gb: [256, 512],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.7, ois: true },
        { type: 'ultrawide', mp: 10.5, aperture_f: 2.2 },
        { type: 'telephoto', mp: 10.8, aperture_f: 3.1, zoom: '5x optical', ois: true },
      ],
      front_camera: { mp: 10, aperture_f: 2.2 },
      battery_mah: 4650,
      charging: { wired_w: 21, wireless_w: 7.5 },
      weight_g: 257,
      os: 'Android 14',
      update_policy: '7 years of OS, security, and Feature Drops',
      connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IPX8',
      colors: ['Obsidian', 'Porcelain'],
      foldable: true,
      highlights: [
        '8.0-inch inner display',
        'thin ergonomic foldable design',
        '5x optical telephoto',
        '16GB RAM for on-device AI',
      ],
    }),
  },
  {
    slug: 'google-pixel-fold',
    brand: 'Google',
    model: 'Pixel Fold',
    tagline:
      'Google first passport-style foldable with wide cover display and flagship triple cameras.',
    launchDate: '2023-06-28',
    msrpUsd: '1799.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'JP'],
    aliases: [
      { alias: 'Google Pixel Fold', priority: 100 },
      { alias: 'Pixel Fold', priority: 95 },
      { alias: 'Pixel Fold 1', priority: 70 },
    ],
    spec: P({
      display: {
        size_in: 7.6,
        resolution: '2208x1840',
        refresh_rate_hz: 120,
        panel_type: 'Foldable OLED',
        peak_brightness_nits: 1450,
        features: ['120Hz', 'Cover: 5.8 inch 1080x2092 120Hz OLED', 'Gorilla Glass Victus'],
      },
      chipset: 'Google Tensor G2',
      process_nm: 5,
      ram_gb: 12,
      storage_options_gb: [256, 512],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.7, ois: true },
        { type: 'ultrawide', mp: 10.8, aperture_f: 2.2 },
        { type: 'telephoto', mp: 10.8, aperture_f: 3.05, zoom: '5x optical', ois: true },
      ],
      front_camera: { mp: 9.5, aperture_f: 2.2 },
      battery_mah: 4821,
      charging: { wired_w: 30, wireless_w: 7.5 },
      weight_g: 283,
      os: 'Android 13',
      update_policy: '5 years of security updates',
      connectivity: { wifi: 'Wi-Fi 6E', bluetooth: '5.2', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IPX8',
      colors: ['Obsidian', 'Porcelain'],
      foldable: true,
      highlights: [
        'passport form factor',
        'comfortable wide cover screen',
        '5x optical telephoto',
        'fluid multitasking',
      ],
    }),
  },

  // ---------------------------------------------------------------------------
  // Samsung Galaxy S24 Series (2024 Flagships)
  // ---------------------------------------------------------------------------
  {
    slug: 'samsung-galaxy-s24',
    brand: 'Samsung',
    model: 'Galaxy S24',
    tagline:
      'Compact Samsung flagship with Galaxy AI, uniform slim bezels, and 7 years of OS upgrades.',
    launchDate: '2024-01-17',
    msrpUsd: '799.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Samsung Galaxy S24', priority: 100 },
      { alias: 'Galaxy S24', priority: 95 },
      { alias: 'S24', priority: 80 },
      { alias: 'Samsung S24', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.2,
        resolution: '2340x1080',
        refresh_rate_hz: 120,
        panel_type: 'Dynamic LTPO AMOLED 2X',
        peak_brightness_nits: 2600,
        features: ['LTPO 1-120Hz', 'HDR10+', 'Gorilla Glass Victus 2', 'Always-on display'],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 3 for Galaxy',
      process_nm: 4,
      ram_gb: 8,
      storage_options_gb: [128, 256, 512],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.8, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
        { type: 'telephoto', mp: 10, aperture_f: 2.4, zoom: '3x optical', ois: true },
      ],
      front_camera: { mp: 12, aperture_f: 2.2 },
      battery_mah: 4000,
      charging: { wired_w: 25, wireless_w: 15 },
      weight_g: 167,
      os: 'Android 14',
      update_policy: '7 years of OS and security upgrades',
      connectivity: { wifi: 'Wi-Fi 6E', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP68',
      colors: ['Onyx Black', 'Marble Grey', 'Cobalt Violet', 'Amber Yellow'],
      foldable: false,
      highlights: [
        'compact lightweight form factor',
        '7 years of OS updates',
        '2600 nit display',
        '3x optical telephoto',
      ],
    }),
  },
  {
    slug: 'samsung-galaxy-s24-plus',
    brand: 'Samsung',
    model: 'Galaxy S24+',
    variant: 'Plus',
    tagline:
      'Large QHD+ display, 12GB RAM, and 4900mAh battery for balanced big-screen flagship power.',
    launchDate: '2024-01-17',
    msrpUsd: '999.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Samsung Galaxy S24+', priority: 100 },
      { alias: 'Samsung Galaxy S24 Plus', priority: 100 },
      { alias: 'Galaxy S24+', priority: 95 },
      { alias: 'Galaxy S24 Plus', priority: 95 },
      { alias: 'S24+', priority: 80 },
      { alias: 'S24 Plus', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '3120x1440',
        refresh_rate_hz: 120,
        panel_type: 'Dynamic LTPO AMOLED 2X',
        peak_brightness_nits: 2600,
        features: ['LTPO 1-120Hz', 'QHD+', 'HDR10+', 'Gorilla Glass Victus 2'],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 3 for Galaxy',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [256, 512],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.8, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
        { type: 'telephoto', mp: 10, aperture_f: 2.4, zoom: '3x optical', ois: true },
      ],
      front_camera: { mp: 12, aperture_f: 2.2 },
      battery_mah: 4900,
      charging: { wired_w: 45, wireless_w: 15 },
      weight_g: 196,
      os: 'Android 14',
      update_policy: '7 years of OS and security upgrades',
      connectivity: { wifi: 'Wi-Fi 6E', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP68',
      colors: ['Onyx Black', 'Marble Grey', 'Cobalt Violet', 'Amber Yellow'],
      foldable: false,
      highlights: [
        'sharp QHD+ LTPO display',
        '45W fast charging',
        '12GB RAM standard',
        'long battery life',
      ],
    }),
  },
  {
    slug: 'samsung-galaxy-s24-ultra',
    brand: 'Samsung',
    model: 'Galaxy S24 Ultra',
    tagline:
      'Titanium frame, flat anti-reflective Gorilla Armor glass, integrated S Pen, and 200MP camera.',
    launchDate: '2024-01-17',
    msrpUsd: '1299.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Samsung Galaxy S24 Ultra', priority: 100 },
      { alias: 'Galaxy S24 Ultra', priority: 95 },
      { alias: 'S24 Ultra', priority: 90 },
      { alias: 'S24U', priority: 60 },
    ],
    spec: P({
      display: {
        size_in: 6.8,
        resolution: '3120x1440',
        refresh_rate_hz: 120,
        panel_type: 'Dynamic LTPO AMOLED 2X',
        peak_brightness_nits: 2600,
        features: [
          'Corning Gorilla Armor anti-reflective',
          'LTPO 1-120Hz',
          'S Pen support',
          'HDR10+',
        ],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 3 for Galaxy',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [256, 512, 1024],
      rear_cameras: [
        { type: 'main', mp: 200, aperture_f: 1.7, ois: true },
        { type: 'periscope', mp: 50, aperture_f: 3.4, zoom: '5x optical', ois: true },
        { type: 'telephoto', mp: 10, aperture_f: 2.4, zoom: '3x optical', ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
      ],
      front_camera: { mp: 12, aperture_f: 2.2 },
      battery_mah: 5000,
      charging: { wired_w: 45, wireless_w: 15 },
      weight_g: 232,
      os: 'Android 14',
      update_policy: '7 years of OS and security upgrades',
      connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP68',
      colors: ['Titanium Gray', 'Titanium Black', 'Titanium Violet', 'Titanium Yellow'],
      foldable: false,
      highlights: [
        'anti-reflective Gorilla Armor',
        'built-in S Pen stylus',
        '200MP + 5x periscope camera',
        'titanium build',
      ],
    }),
  },
  {
    slug: 'samsung-galaxy-z-flip-6',
    brand: 'Samsung',
    model: 'Galaxy Z Flip6',
    tagline:
      'Refined clamshell foldable with 50MP primary camera, vapor chamber cooling, and IP48 rating.',
    launchDate: '2024-07-24',
    msrpUsd: '1099.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Samsung Galaxy Z Flip6', priority: 100 },
      { alias: 'Samsung Galaxy Z Flip 6', priority: 100 },
      { alias: 'Galaxy Z Flip 6', priority: 95 },
      { alias: 'Z Flip 6', priority: 85 },
      { alias: 'Flip 6', priority: 70 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2640x1080',
        refresh_rate_hz: 120,
        panel_type: 'Foldable Dynamic LTPO AMOLED 2X',
        peak_brightness_nits: 2600,
        features: [
          'LTPO 1-120Hz',
          'Cover: 3.4 inch Super AMOLED 720x748 60Hz',
          'Gorilla Glass Victus 2',
        ],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 3 for Galaxy',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [256, 512],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.8, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
      ],
      front_camera: { mp: 10, aperture_f: 2.2 },
      battery_mah: 4000,
      charging: { wired_w: 25, wireless_w: 15 },
      weight_g: 187,
      os: 'Android 14',
      update_policy: '7 years of OS and security upgrades',
      connectivity: { wifi: 'Wi-Fi 6E', bluetooth: '5.3', nfc: true, usb: 'USB-C 3.2' },
      ip_rating: 'IP48',
      colors: ['Silver Shadow', 'Yellow', 'Blue', 'Mint'],
      foldable: true,
      highlights: [
        'compact pocketable clamshell',
        'upgraded 50MP camera',
        '12GB RAM standard',
        'first Flip with vapor chamber',
      ],
    }),
  },

  // ---------------------------------------------------------------------------
  // Apple iPhone 15 Series (2023 Generation)
  // ---------------------------------------------------------------------------
  {
    slug: 'apple-iphone-15',
    brand: 'Apple',
    model: 'iPhone 15',
    tagline:
      'Dynamic Island, 48MP main camera, USB-C connectivity, and durable color-infused glass.',
    launchDate: '2023-09-22',
    msrpUsd: '799.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Apple iPhone 15', priority: 100 },
      { alias: 'iPhone 15', priority: 95 },
      { alias: 'iPhone15', priority: 70 },
      { alias: 'iPhone 15 review', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.1,
        resolution: '2556x1179',
        refresh_rate_hz: 60,
        panel_type: 'Super Retina XDR OLED',
        peak_brightness_nits: 2000,
        features: ['Dynamic Island', 'HDR10', 'Ceramic Shield front'],
      },
      chipset: 'Apple A16 Bionic',
      process_nm: 4,
      ram_gb: 6,
      storage_options_gb: [128, 256, 512],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.6, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.4 },
      ],
      front_camera: { mp: 12, aperture_f: 1.9 },
      battery_mah: 3349,
      charging: { wired_w: 20, wireless_w: 15 },
      weight_g: 171,
      os: 'iOS 17',
      update_policy: '6+ years of iOS updates',
      connectivity: { wifi: 'Wi-Fi 6', bluetooth: '5.3', nfc: true, usb: 'USB-C 2.0' },
      ip_rating: 'IP68',
      colors: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'],
      foldable: false,
      highlights: [
        'Dynamic Island',
        '48MP high-res camera with 2x lossless crop',
        'USB-C connector',
        'compact and lightweight',
      ],
    }),
  },
  {
    slug: 'apple-iphone-15-plus',
    brand: 'Apple',
    model: 'iPhone 15 Plus',
    tagline: 'Big 6.7-inch display and multi-day battery endurance with Dynamic Island and USB-C.',
    launchDate: '2023-09-22',
    msrpUsd: '899.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Apple iPhone 15 Plus', priority: 100 },
      { alias: 'iPhone 15 Plus', priority: 95 },
      { alias: 'iPhone 15+', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2796x1290',
        refresh_rate_hz: 60,
        panel_type: 'Super Retina XDR OLED',
        peak_brightness_nits: 2000,
        features: ['Dynamic Island', 'HDR10', 'Ceramic Shield front'],
      },
      chipset: 'Apple A16 Bionic',
      process_nm: 4,
      ram_gb: 6,
      storage_options_gb: [128, 256, 512],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.6, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.4 },
      ],
      front_camera: { mp: 12, aperture_f: 1.9 },
      battery_mah: 4383,
      charging: { wired_w: 20, wireless_w: 15 },
      weight_g: 201,
      os: 'iOS 17',
      update_policy: '6+ years of iOS updates',
      connectivity: { wifi: 'Wi-Fi 6', bluetooth: '5.3', nfc: true, usb: 'USB-C 2.0' },
      ip_rating: 'IP68',
      colors: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'],
      foldable: false,
      highlights: [
        'exceptional battery life',
        'large 6.7-inch screen',
        'Dynamic Island',
        '48MP 2x optical-quality zoom',
      ],
    }),
  },
  {
    slug: 'apple-iphone-15-pro',
    brand: 'Apple',
    model: 'iPhone 15 Pro',
    tagline:
      'Lightweight aerospace titanium frame, A17 Pro chip, customizable Action button, and 3x zoom.',
    launchDate: '2023-09-22',
    msrpUsd: '999.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Apple iPhone 15 Pro', priority: 100 },
      { alias: 'iPhone 15 Pro', priority: 95 },
      { alias: '15 Pro', priority: 60 },
    ],
    spec: P({
      display: {
        size_in: 6.1,
        resolution: '2556x1179',
        refresh_rate_hz: 120,
        panel_type: 'LTPO Super Retina XDR OLED',
        peak_brightness_nits: 2000,
        features: ['ProMotion 120Hz', 'Always-on display', 'Dynamic Island', 'Ceramic Shield'],
      },
      chipset: 'Apple A17 Pro',
      process_nm: 3,
      ram_gb: 8,
      storage_options_gb: [128, 256, 512, 1024],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.78, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
        { type: 'telephoto', mp: 12, aperture_f: 2.8, zoom: '3x optical', ois: true },
      ],
      front_camera: { mp: 12, aperture_f: 1.9 },
      battery_mah: 3274,
      charging: { wired_w: 27, wireless_w: 15 },
      weight_g: 187,
      os: 'iOS 17',
      update_policy: '6+ years of iOS updates',
      connectivity: {
        wifi: 'Wi-Fi 6E',
        bluetooth: '5.3',
        nfc: true,
        usb: 'USB-C 3.2 Gen 2 (10Gbps)',
      },
      ip_rating: 'IP68',
      colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium'],
      foldable: false,
      highlights: [
        'aerospace-grade titanium',
        'Action button',
        'console-level 3nm A17 Pro gaming',
        '10Gbps USB-C transfer',
      ],
    }),
  },
  {
    slug: 'apple-iphone-15-pro-max',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
    tagline:
      'Flagship titanium design with 5x tetraprism periscope telephoto lens and A17 Pro performance.',
    launchDate: '2023-09-22',
    msrpUsd: '1199.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'CA', 'JP'],
    aliases: [
      { alias: 'Apple iPhone 15 Pro Max', priority: 100 },
      { alias: 'iPhone 15 Pro Max', priority: 95 },
      { alias: '15 Pro Max', priority: 60 },
      { alias: 'iPhone 15 PM', priority: 50 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2796x1290',
        refresh_rate_hz: 120,
        panel_type: 'LTPO Super Retina XDR OLED',
        peak_brightness_nits: 2000,
        features: ['ProMotion 120Hz', 'Always-on display', 'Dynamic Island', 'Ceramic Shield'],
      },
      chipset: 'Apple A17 Pro',
      process_nm: 3,
      ram_gb: 8,
      storage_options_gb: [256, 512, 1024],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.78, ois: true },
        { type: 'ultrawide', mp: 12, aperture_f: 2.2 },
        { type: 'telephoto', mp: 12, aperture_f: 2.8, zoom: '5x optical tetraprism', ois: true },
      ],
      front_camera: { mp: 12, aperture_f: 1.9 },
      battery_mah: 4422,
      charging: { wired_w: 27, wireless_w: 15 },
      weight_g: 221,
      os: 'iOS 17',
      update_policy: '6+ years of iOS updates',
      connectivity: {
        wifi: 'Wi-Fi 6E',
        bluetooth: '5.3',
        nfc: true,
        usb: 'USB-C 3.2 Gen 2 (10Gbps)',
      },
      ip_rating: 'IP68',
      colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium'],
      foldable: false,
      highlights: [
        '5x optical tetraprism telephoto',
        'lightweight titanium design',
        'long battery life',
        'A17 Pro performance',
      ],
    }),
  },

  // ---------------------------------------------------------------------------
  // OnePlus & Nothing Flagships (2023 - 2024)
  // ---------------------------------------------------------------------------
  {
    slug: 'oneplus-12',
    brand: 'OnePlus',
    model: '12',
    tagline:
      'Flagship killer with Snapdragon 8 Gen 3, Hasselblad periscope zoom, 5400mAh battery, and 80W charging.',
    launchDate: '2024-01-23',
    msrpUsd: '799.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'CA'],
    aliases: [
      { alias: 'OnePlus 12', priority: 100 },
      { alias: 'Oneplus 12', priority: 95 },
      { alias: 'OP12', priority: 70 },
      { alias: 'OnePlus 12 review', priority: 80 },
    ],
    spec: P({
      display: {
        size_in: 6.82,
        resolution: '3168x1440',
        refresh_rate_hz: 120,
        panel_type: 'LTPO4 AMOLED',
        peak_brightness_nits: 4500,
        features: ['LTPO 1-120Hz', '4500 nits peak', 'Dolby Vision', 'Gorilla Glass Victus 2'],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 3',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [256, 512],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.6, ois: true },
        { type: 'periscope', mp: 64, aperture_f: 2.6, zoom: '3x optical periscope', ois: true },
        { type: 'ultrawide', mp: 48, aperture_f: 2.2 },
      ],
      front_camera: { mp: 32, aperture_f: 2.4 },
      battery_mah: 5400,
      charging: { wired_w: 80, wireless_w: 50 },
      weight_g: 220,
      os: 'Android 14 (OxygenOS 14)',
      update_policy: '4 years of Android OS + 5 years security updates',
      connectivity: {
        wifi: 'Wi-Fi 7',
        bluetooth: '5.4',
        nfc: true,
        usb: 'USB-C 3.2',
        ir_blaster: true,
      },
      ip_rating: 'IP65',
      colors: ['Silky Black', 'Flowy Emerald'],
      foldable: false,
      highlights: [
        'superb value flagship',
        'Hasselblad 3x periscope zoom',
        '5400mAh massive battery',
        'ultra-fast 80W wired + 50W wireless charging',
      ],
    }),
  },
  {
    slug: 'oneplus-12r',
    brand: 'OnePlus',
    model: '12R',
    tagline:
      'Sub-flagship value king with Snapdragon 8 Gen 2, 5500mAh largest battery, and 100W charging.',
    launchDate: '2024-01-23',
    msrpUsd: '499.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'CA'],
    aliases: [
      { alias: 'OnePlus 12R', priority: 100 },
      { alias: 'Oneplus 12R', priority: 95 },
      { alias: 'OP12R', priority: 70 },
    ],
    spec: P({
      display: {
        size_in: 6.78,
        resolution: '2780x1264',
        refresh_rate_hz: 120,
        panel_type: 'LTPO4 AMOLED',
        peak_brightness_nits: 4500,
        features: ['LTPO4 1-120Hz', '4500 nits peak', 'Dolby Vision', 'Gorilla Glass Victus 2'],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 2',
      process_nm: 4,
      ram_gb: 8,
      storage_options_gb: [128, 256],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.8, ois: true },
        { type: 'ultrawide', mp: 8, aperture_f: 2.2 },
        { type: 'macro', mp: 2, aperture_f: 2.4 },
      ],
      front_camera: { mp: 16, aperture_f: 2.4 },
      battery_mah: 5500,
      charging: { wired_w: 100 },
      weight_g: 207,
      os: 'Android 14 (OxygenOS 14)',
      update_policy: '3 years OS + 4 years security updates',
      connectivity: {
        wifi: 'Wi-Fi 7',
        bluetooth: '5.3',
        nfc: true,
        usb: 'USB-C 2.0',
        ir_blaster: true,
      },
      ip_rating: 'IP64',
      colors: ['Iron Gray', 'Cool Blue'],
      foldable: false,
      highlights: [
        'class-leading 5500mAh battery',
        'insanely fast 100W charging',
        'flagship-grade 4500 nit LTPO screen',
        'Snapdragon 8 Gen 2 gaming performance',
      ],
    }),
  },
  {
    slug: 'oneplus-open',
    brand: 'OnePlus',
    model: 'Open',
    tagline:
      'Benchmark book-style foldable with Open Canvas multitasking, Hasselblad cameras, and lightweight hinge.',
    launchDate: '2023-10-19',
    msrpUsd: '1699.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'CA'],
    aliases: [
      { alias: 'OnePlus Open', priority: 100 },
      { alias: 'Oneplus Open', priority: 95 },
      { alias: 'OP Open', priority: 70 },
    ],
    spec: P({
      display: {
        size_in: 7.82,
        resolution: '2440x2268',
        refresh_rate_hz: 120,
        panel_type: 'Foldable LTPO3 Flexi-fluid AMOLED',
        peak_brightness_nits: 2800,
        features: ['LTPO3 1-120Hz', 'Cover: 6.31 inch 1116x2484 120Hz 2800 nits', 'Ceramic Guard'],
      },
      chipset: 'Qualcomm Snapdragon 8 Gen 2',
      process_nm: 4,
      ram_gb: 16,
      storage_options_gb: [512],
      rear_cameras: [
        { type: 'main', mp: 48, aperture_f: 1.7, ois: true },
        { type: 'telephoto', mp: 64, aperture_f: 2.6, zoom: '3x optical periscope', ois: true },
        { type: 'ultrawide', mp: 48, aperture_f: 2.2 },
      ],
      front_camera: { mp: 32, aperture_f: 2.4 },
      battery_mah: 4805,
      charging: { wired_w: 67 },
      weight_g: 239,
      os: 'Android 13 (OxygenOS 13.2)',
      update_policy: '4 years OS + 5 years security updates',
      connectivity: {
        wifi: 'Wi-Fi 7',
        bluetooth: '5.3',
        nfc: true,
        usb: 'USB-C 3.1',
        ir_blaster: true,
      },
      ip_rating: 'IPX4',
      colors: ['Voyager Black', 'Emerald Dusk'],
      foldable: true,
      highlights: [
        'best foldable multitasking (Open Canvas)',
        'almost invisible crease',
        'exceptional Hasselblad cameras',
        'usable standard cover screen',
      ],
    }),
  },
  {
    slug: 'nothing-phone-2',
    brand: 'Nothing',
    model: 'Phone (2)',
    tagline:
      'Iconic transparent design with customizable Glyph Interface, clean Nothing OS, and Snapdragon 8+ Gen 1.',
    launchDate: '2023-07-11',
    msrpUsd: '599.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'JP'],
    aliases: [
      { alias: 'Nothing Phone (2)', priority: 100 },
      { alias: 'Nothing Phone 2', priority: 95 },
      { alias: 'Phone (2)', priority: 70 },
      { alias: 'Phone 2', priority: 65 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2412x1080',
        refresh_rate_hz: 120,
        panel_type: 'LTPO OLED',
        peak_brightness_nits: 1600,
        features: ['LTPO 1-120Hz', 'HDR10+', 'Always-on display', 'Corning Gorilla Glass'],
      },
      chipset: 'Qualcomm Snapdragon 8+ Gen 1',
      process_nm: 4,
      ram_gb: 12,
      storage_options_gb: [128, 256, 512],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.88, ois: true },
        { type: 'ultrawide', mp: 50, aperture_f: 2.2 },
      ],
      front_camera: { mp: 32, aperture_f: 2.45 },
      battery_mah: 4700,
      charging: { wired_w: 45, wireless_w: 15 },
      weight_g: 201,
      os: 'Android 13 (Nothing OS 2.0)',
      update_policy: '3 years OS + 4 years security updates',
      connectivity: { wifi: 'Wi-Fi 6', bluetooth: '5.3', nfc: true, usb: 'USB-C 2.0' },
      ip_rating: 'IP54',
      colors: ['White', 'Dark Grey'],
      foldable: false,
      highlights: [
        'unique Glyph lighting interface',
        'clean bloatware-free Nothing OS',
        'smooth 120Hz LTPO display',
        'balanced flagship performance',
      ],
    }),
  },
  {
    slug: 'nothing-phone-2a',
    brand: 'Nothing',
    model: 'Phone (2a)',
    tagline:
      'Distinctive transparent design with custom Dimensity 7200 Pro chip and bright 120Hz flexible AMOLED.',
    launchDate: '2024-03-05',
    msrpUsd: '349.00',
    regionAvailability: ['US', 'GB', 'IN', 'EU', 'AU', 'JP'],
    aliases: [
      { alias: 'Nothing Phone (2a)', priority: 100 },
      { alias: 'Nothing Phone 2a', priority: 95 },
      { alias: 'Phone (2a)', priority: 70 },
      { alias: 'Phone 2a', priority: 65 },
    ],
    spec: P({
      display: {
        size_in: 6.7,
        resolution: '2412x1080',
        refresh_rate_hz: 120,
        panel_type: 'Flexible AMOLED',
        peak_brightness_nits: 1300,
        features: ['120Hz', 'HDR10+', 'Gorilla Glass 5'],
      },
      chipset: 'MediaTek Dimensity 7200 Pro',
      process_nm: 4,
      ram_gb: 8,
      storage_options_gb: [128, 256],
      rear_cameras: [
        { type: 'main', mp: 50, aperture_f: 1.88, ois: true },
        { type: 'ultrawide', mp: 50, aperture_f: 2.2 },
      ],
      front_camera: { mp: 32, aperture_f: 2.2 },
      battery_mah: 5000,
      charging: { wired_w: 45 },
      weight_g: 190,
      os: 'Android 14 (Nothing OS 2.5)',
      update_policy: '3 years OS + 4 years security updates',
      connectivity: { wifi: 'Wi-Fi 6', bluetooth: '5.3', nfc: true, usb: 'USB-C 2.0' },
      ip_rating: 'IP54',
      colors: ['Black', 'White', 'Milk', 'Blue', 'Special Edition'],
      foldable: false,
      highlights: [
        'standout design under $350',
        'Glyph interface',
        'clean Nothing OS',
        'dual 50MP cameras',
      ],
    }),
  },
];

/**
 * Audit the database against canonical mainstream flagships and backfill any missing ones.
 *
 * Safe to re-run idempotently: uses `onConflictDoUpdate` on `phones.slug` and
 * stages a completed promotion record into `catalog_candidates`.
 */
export async function syncMissingFlagships<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(db: PostgresJsDatabase<TSchema>): Promise<{ added: string[]; updated: string[] }> {
  const existingPhones = await db.select({ id: phones.id, slug: phones.slug }).from(phones);
  const existingSlugs = new Set(existingPhones.map((p) => p.slug));

  const added: string[] = [];
  const updated: string[] = [];

  for (const entry of CANONICAL_FLAGSHIPS) {
    const isNew = !existingSlugs.has(entry.slug);

    const [upsertedPhone] = await db
      .insert(phones)
      .values({
        slug: entry.slug,
        brand: entry.brand,
        model: entry.model,
        variant: entry.variant ?? null,
        tagline: entry.tagline,
        launchDate: new Date(entry.launchDate),
        msrpUsd: entry.msrpUsd,
        imageUrl: `/phones/${entry.slug}.jpg`,
        mediaStatus: 'missing',
        status: 'active',
        specJson: entry.spec as unknown as Record<string, unknown>,
        regionAvailability: [...entry.regionAvailability],
        canonicalKey: buildCanonicalKey({
          brand: entry.brand,
          model: entry.model,
          launchDate: entry.launchDate,
        }),
      })
      .onConflictDoUpdate({
        target: phones.slug,
        set: {
          brand: sql`excluded.brand`,
          model: sql`excluded.model`,
          variant: sql`excluded.variant`,
          tagline: sql`excluded.tagline`,
          launchDate: sql`excluded.launch_date`,
          msrpUsd: sql`excluded.msrp_usd`,
          specJson: sql`excluded.spec_json`,
          regionAvailability: sql`excluded.region_availability`,
          canonicalKey: sql`excluded.canonical_key`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: phones.id });

    if (!upsertedPhone) continue;

    if (isNew) added.push(entry.slug);
    else updated.push(entry.slug);

    // Register aliases in phone_aliases
    if (entry.aliases.length > 0) {
      await db
        .insert(phoneAliases)
        .values(
          entry.aliases.map((a) => ({
            phoneId: upsertedPhone.id,
            alias: a.alias,
            priority: a.priority ?? 50,
          })),
        )
        .onConflictDoNothing();
    }

    // Register candidate in catalog_candidates so catalog reports match
    const stableKey = stableCandidateKey({
      sourceKey: 'canonical_flagship_registry',
      externalId: entry.slug,
      sourceUrl: `https://recsy.internal/flagships/${entry.slug}`,
    });

    await db
      .insert(catalogCandidates)
      .values({
        stableKey,
        sourceKey: 'canonical_flagship_registry',
        sourceType: 'oem',
        externalId: entry.slug,
        sourceUrl: `https://recsy.internal/flagships/${entry.slug}`,
        candidateTitle: `${entry.brand} ${entry.model}`,
        rawCandidateJson: entry as unknown as Record<string, unknown>,
        normalizedIdentityJson: {
          brand: entry.brand,
          model: entry.model,
          launchDate: entry.launchDate,
          aliases: entry.aliases.map((a) => a.alias),
        },
        claimsJson: { promotion: entry },
        canonicalKey: buildCanonicalKey({
          brand: entry.brand,
          model: entry.model,
          launchDate: entry.launchDate,
        }),
        contentHash: hashJson(entry.spec),
        decision: 'promote',
        status: 'promoted',
        confidence: '1.00',
        matchedPhoneId: upsertedPhone.id,
        issueCodes: [],
        lastDecisionAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: catalogCandidates.stableKey,
        set: {
          matchedPhoneId: upsertedPhone.id,
          status: 'promoted',
          decision: 'promote',
          updatedAt: sql`now()`,
        },
      });
  }

  return { added, updated };
}
