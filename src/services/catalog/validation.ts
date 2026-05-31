/**
 * Catalog validation helpers.
 *
 * Purpose: keep impossible or incomplete catalog values out of canonical
 * `phones` rows before promotion.
 *
 * Used by: catalog promotion, tests, reports.
 */
import type { CatalogSpecProjectionInput } from './spec-project';
import { isFutureCatalogDate } from './candidate-policy';
import { findMissingCoreFields } from './spec-project';

export interface CatalogValidationIssue {
  readonly severity: 'info' | 'warn' | 'blocker';
  readonly code: string;
  readonly message: string;
  readonly fieldPath?: string;
}

export interface CandidateValidationInput {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly launchDate?: Date | string | null;
  readonly releasedAt?: Date | string | null;
  readonly status?: 'active' | 'upcoming' | 'discontinued' | string | null;
  readonly spec: CatalogSpecProjectionInput;
  readonly sourceTier: 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
}

export function validateCatalogCandidate(
  input: CandidateValidationInput,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (!input.brand) {
    issues.push(blocker('missing_brand', 'brand is required', 'brand'));
  }
  if (!input.model) {
    issues.push(blocker('missing_model', 'model is required', 'model'));
  }

  for (const missing of findMissingCoreFields(input.spec)) {
    issues.push(
      blocker('missing_spec_field', `required PhoneSpec field missing: ${missing}`, missing),
    );
  }

  issues.push(...validatePlausibility(input.spec, input.launchDate));

  if (
    isFutureCatalogDate(toDateString(input.launchDate)) ||
    isFutureCatalogDate(toDateString(input.releasedAt))
  ) {
    issues.push(
      blocker('unreleased_candidate', 'launch/release date is in the future', 'launchDate'),
    );
  }

  if (input.status === 'upcoming' && input.sourceTier !== 'T0' && input.sourceTier !== 'T2') {
    issues.push(
      blocker(
        'upcoming_untrusted_source',
        'upcoming phones require official or licensed source evidence',
        'status',
      ),
    );
  }

  return issues;
}

function toDateString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

export function validatePlausibility(
  spec: CatalogSpecProjectionInput,
  launchDate?: Date | string | null,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  range(issues, 'display.size_in', spec.display?.size_in, 3, 9);
  range(issues, 'display.refresh_rate_hz', spec.display?.refresh_rate_hz, 30, 240);
  range(issues, 'ram_gb', spec.ramGb, 1, 32);
  range(issues, 'battery_mah', spec.batteryMah, 1_000, 10_000);
  range(issues, 'charging.wired_w', spec.charging?.wired_w, 0, 240);
  range(issues, 'charging.wireless_w', spec.charging?.wireless_w, 0, 100);
  range(issues, 'weight_g', spec.weightG, 80, 350);

  for (const [index, cam] of (spec.rearCameras ?? []).entries()) {
    range(issues, `rear_cameras.${index}.mp`, cam.mp, 0.3, 250);
  }
  if (spec.frontCamera) {
    range(issues, 'front_camera.mp', spec.frontCamera.mp, 0.3, 100);
  }

  if (launchDate) {
    const date = typeof launchDate === 'string' ? new Date(launchDate) : launchDate;
    const eighteenMonthsFuture = new Date();
    eighteenMonthsFuture.setUTCMonth(eighteenMonthsFuture.getUTCMonth() + 18);
    if (!Number.isNaN(date.getTime()) && date > eighteenMonthsFuture) {
      issues.push(blocker('launch_date_too_far_future', 'launch date is too far in the future'));
    }
  }

  return issues;
}

function range(
  issues: CatalogValidationIssue[],
  fieldPath: string,
  value: number | undefined,
  min: number,
  max: number,
): void {
  if (value == null) return;
  if (value < min || value > max) {
    issues.push(
      blocker('implausible_value', `${fieldPath}=${value} is outside ${min}..${max}`, fieldPath),
    );
  }
}

function blocker(code: string, message: string, fieldPath?: string): CatalogValidationIssue {
  return { severity: 'blocker', code, message, fieldPath };
}
