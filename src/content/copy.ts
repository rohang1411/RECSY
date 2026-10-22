/**
 * Central copy deck for RECSY user platform, quotas, billing, and auth.
 * Single source of truth (Normative reference: Plan 25 Section 12.14).
 * Strict tone: precise, calm, technical-editorial, present-tense, no hype.
 */

export const COPY = {
  hud: {
    freeReady: (n: number, N: number) => `${n} of ${N} free queries left`,
    nextFree: 'Next query uses 1 free',
    nextCredit: 'Next query uses 1 credit',
    nextPro: 'Next query uses your Pro allowance',
    reset: (countdown: string, localTime: string) =>
      `Resets in ${countdown} (${localTime} your time)`,
    anonReady: (left: number) => `${left} free queries today · sign in to keep your history`,
    anonExhausted: 'Free queries used · sign in to continue',
    proActive: (left: number, total: number, renewsDate: string) =>
      `Pro · ${left} of ${total} left · renews ${renewsDate}`,
    proPastDue: (graceDate: string) =>
      `Payment issue · update card to keep Pro (grace until ${graceDate})`,
    byokActive: (used: number, cap: number) =>
      `Using your own key · ${used} of ${cap} today · not billed by RECSY`,
    busy: 'High demand · free queries may be delayed',
    paused: 'Platform temporarily paused for scheduled maintenance',
    unavailable: 'Usage unavailable',
  },
  outcome: {
    charged: (source: string) => `Used 1 ${source}`,
    notChargedClarify: 'Not charged · I needed more detail',
    notChargedNoResults: 'Not charged · nothing matched',
    notChargedError: 'Not charged · something went wrong on our side',
    notChargedAbort: 'Not charged · request cancelled',
  },
  deny: {
    anonTitle: (N: number) => `You've used today's ${N}`,
    freeTitle: 'Out of free queries',
    freeBody: (N: number, localTime: string) =>
      `Your ${N} free queries come back at ${localTime}. Or keep going now.`,
    capacity: (s: number) => `High demand right now. You weren't charged. Try again in ${s}s.`,
    paused: (operatorMessage?: string) =>
      operatorMessage && operatorMessage.trim() !== ''
        ? operatorMessage
        : 'The platform is temporarily paused. Please check back shortly.',
    inflight: 'Still working on your previous question…',
    metering: "We couldn't verify your usage, so we didn't run the query. You weren't charged.",
    deviceCap:
      'This device has reached today’s free limit. Buy credits or try again after the reset.',
    byokCap: (cap: number, countdown: string) =>
      `You've reached today's cap for your own key (${cap}). It resets in ${countdown}.`,
    subExhausted: 'PRO ALLOWANCE USED · renews soon',
  },
  auth: {
    value: (N: number) => `One-time code, no password. Your ${N} free queries carry over.`,
    codeWrong: "That code didn't work. Request a new one.",
    signedIn: (maskedEmail: string) => `Signed in as ${maskedEmail}`,
    emailInvalid: "That doesn't look like an email address.",
    tooManyAttempts: (time: string) => `Too many attempts. Try again in ${time}.`,
    sendFailure: "We couldn't send the email. Try Google or retry in a minute.",
    offline: "You're offline. Reconnect to sign in.",
    oauthCancelled: 'Sign-in cancelled. Nothing was lost.',
    restricted: 'This account is restricted.',
    deletionScheduled: (date: string) => `Account scheduled for deletion on ${date}.`,
  },
  pricing: {
    queryDef:
      'A query is one delivered recommendation or answer. Clarifying questions, empty results, errors and cancelled requests are free.',
    creditsPerQuery: (price: string) => `${price} per query`,
  },
  billing: {
    returnPaid: (n: number) => `${n} credits added`,
    returnProcessing: "Payment processing. We'll add your credits automatically.",
    checkoutCancelled: 'Checkout cancelled (nothing charged)',
    paymentFailed: "Payment didn't go through",
  },
  account: {
    deleteWarn:
      'Your account will be deleted after 30 days. You can cancel any time before then. Unused credits are forfeited.',
  },
  byok: {
    note: (cap: number) =>
      `Your key runs your queries directly with your provider. RECSY doesn't charge for them (up to ${cap} a day), and never stores your key.`,
  },
} as const;
