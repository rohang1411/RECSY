/**
 * Email service types.
 * Normative reference: Plan 25 Section 8.8, 10.5, 12.8.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly from?: string;
}

export interface EmailSendResult {
  readonly success: boolean;
  readonly messageId?: string;
  readonly error?: string;
}

export interface EmailDriver {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
