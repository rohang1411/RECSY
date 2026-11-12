/**
 * Email provider drivers and factory.
 * Normative reference: Plan 25 Section 8.8, 9.3, 10.5.
 */
import { env } from '@/env';
import { logger } from '@/services/logger';
import type { EmailDriver, EmailMessage, EmailSendResult } from './types';

const log = logger.child({ component: 'email-driver' });

export class ResendDriver implements EmailDriver {
  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string = 'RECSY <noreply@recsy.com>',
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from || this.defaultFrom,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        log.error({ status: response.status, errorText }, 'resend send failed');
        return { success: false, error: `Resend error: HTTP ${response.status}` };
      }

      const data = (await response.json()) as { id?: string };
      return { success: true, messageId: data.id };
    } catch (err) {
      log.error({ err }, 'resend fetch threw exception');
      return { success: false, error: (err as Error).message };
    }
  }
}

export class PostmarkDriver implements EmailDriver {
  constructor(
    private readonly serverToken: string,
    private readonly defaultFrom: string = 'RECSY <noreply@recsy.com>',
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': this.serverToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          From: message.from || this.defaultFrom,
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        log.error({ status: response.status, errorText }, 'postmark send failed');
        return { success: false, error: `Postmark error: HTTP ${response.status}` };
      }

      const data = (await response.json()) as { MessageID?: string };
      return { success: true, messageId: data.MessageID };
    } catch (err) {
      log.error({ err }, 'postmark fetch threw exception');
      return { success: false, error: (err as Error).message };
    }
  }
}

export class FakeEmailDriver implements EmailDriver {
  public readonly sentMessages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sentMessages.push(message);
    log.info({ to: message.to, subject: message.subject }, 'fake email sent');
    return { success: true, messageId: `fake_${Date.now()}` };
  }

  clear(): void {
    this.sentMessages.length = 0;
  }
}

export const fakeEmailDriver = new FakeEmailDriver();

let activeDriver: EmailDriver | null = null;

export function getEmailDriver(): EmailDriver {
  if (activeDriver) return activeDriver;

  const provider = env.EMAIL_PROVIDER;
  const apiKey = env.EMAIL_PROVIDER_API_KEY;
  const defaultFrom = env.EMAIL_FROM || 'RECSY <noreply@recsy.com>';

  if (provider === 'resend' && apiKey) {
    activeDriver = new ResendDriver(apiKey, defaultFrom);
  } else if (provider === 'postmark' && apiKey) {
    activeDriver = new PostmarkDriver(apiKey, defaultFrom);
  } else {
    activeDriver = fakeEmailDriver;
  }

  return activeDriver;
}

export function setEmailDriverForTest(driver: EmailDriver | null): void {
  activeDriver = driver;
}
