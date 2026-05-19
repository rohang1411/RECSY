/**
 * Unit tests for the MobileAPI catalog adapter.
 */
import { describe, expect, it } from 'vitest';

import { fetchMobileApiDevicesByYear, mobileApiDeviceToImportRecord } from './mobileapi';

describe('MobileAPI adapter', () => {
  it('fetches devices by year with token auth', async () => {
    let auth = '';
    const page = await fetchMobileApiDevicesByYear({
      apiKey: 'test-key',
      year: 2026,
      fetchImpl: async (_url, init) => {
        auth = new Headers(init?.headers).get('authorization') ?? '';
        return new Response(
          JSON.stringify({
            page: 1,
            total_pages: 1,
            has_next: false,
            devices: [{ id: 1, name: 'Example Phone' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    expect(auth).toBe('Token test-key');
    expect(page.devices).toHaveLength(1);
    expect(page.hasNext).toBe(false);
  });

  it('maps common listing fields into promotion claims', () => {
    const record = mobileApiDeviceToImportRecord({
      id: 101,
      name: 'Example Phone Pro',
      brand: { name: 'Example' },
      description: 'Example flagship phone',
      storage: '128GB, 256GB, 1TB',
      colors: 'Black, Blue',
      release_date: 'Released 2026, January 5',
      screen_resolution: '6.7", 1290 x 2796 pixels, OLED, 120Hz',
      hardware: 'Example X1, 12GB RAM',
      camera: '50MP + 12MP',
      front_camera: '12MP',
      battery_capacity: '5000 mAh',
      battery: '45W wired, 15W wireless',
      weight: '198g',
      os: 'Android 16',
      connectivity: 'Wi-Fi 7, Bluetooth 5.4, NFC, USB-C',
    });

    expect(record).toMatchObject({
      sourceKey: 'mobileapi',
      sourceTier: 'T2',
      externalId: '101',
      brand: 'Example',
      model: 'Phone Pro',
      launchDate: '2026-01-05',
    });
    expect(record.spec.storageOptionsGb).toEqual([128, 256, 1024]);
    expect(record.spec.display).toMatchObject({
      size_in: 6.7,
      resolution: '1290x2796',
      refresh_rate_hz: 120,
    });
    expect(record.spec.rearCameras?.[0]).toMatchObject({ type: 'main', mp: 50 });
    expect(record.spec.charging).toMatchObject({ wired_w: 45, wireless_w: 15 });
  });

  it('uses description and mixed hardware fields as fallback spec evidence', () => {
    const record = mobileApiDeviceToImportRecord({
      id: 43,
      name: 'Example Phone',
      manufacturer_name: 'Example',
      description:
        'Example Phone smartphone. Features 6.3" display, Example X2 chipset, 5000 mAh battery, 512 GB storage, 12 GB RAM.',
      screen_resolution: '6.3", 1206x2622 pixels, AMOLED, 120Hz',
      hardware: '12GB RAM, Example X2',
      battery: '5000 mAh, 80W wired',
      connectivity: 'Wi-Fi 6, Bluetooth 5.3, No NFC, USB Type-C',
    });

    expect(record.spec.chipset).toBe('Example X2');
    expect(record.spec.ramGb).toBe(12);
    expect(record.spec.storageOptionsGb).toEqual([512]);
    expect(record.spec.batteryMah).toBe(5000);
    expect(record.spec.charging).toMatchObject({ wired_w: 80, wireless_w: 0 });
    expect(record.spec.connectivity).toMatchObject({
      wifi: 'Wi-Fi 6',
      bluetooth: '5.3',
      nfc: false,
    });
  });
});
