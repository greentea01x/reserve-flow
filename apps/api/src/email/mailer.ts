import { createTransport, type Transporter } from 'nodemailer';

import type { CalendarMethod } from './ics.js';

export type MailerConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** RFC 5322 From, e.g. `ReserveFlow <no-reply@example.com>`. Also the bounce address. */
  from: string;
  replyTo: string;
  /** Right-hand side of both the Message-ID and the .ics UID; use `mailDomainFrom(from)`. */
  domain: string;
};

/** The bare address inside MAIL_FROM — what ORGANIZER;SENT-BY needs, display name stripped. */
export function mailAddressFrom(from: string): string {
  const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();

  if (!address.includes('@') || address.startsWith('@') || address.endsWith('@')) {
    throw new Error('MAIL_FROM must contain an email address');
  }

  return address;
}

/**
 * The domain half of MAIL_FROM. Deriving it means swapping relays never leaves the Message-ID
 * or the .ics UID pointing at a domain the new relay's SPF/DKIM does not cover.
 */
export function mailDomainFrom(from: string): string {
  return (mailAddressFrom(from).split('@').at(-1) ?? '').toLowerCase();
}

export type OutboxMessage = {
  /** notifications.id — the only thing that makes the Message-ID deterministic. */
  notificationId: number | string;
  to: string;
  subject: string;
  text: string;
  html: string;
  calendar?: { method: CalendarMethod; content: string };
};

export type SendOutcome = {
  messageId: string;
  /** What the relay accepted in RCPT TO. `rejected` is a permanent failure, not a retry. */
  accepted: readonly string[];
  rejected: readonly string[];
  /** The relay's final 250 line — the only delivery evidence SMTP gives us. */
  response: string;
};

export function createMailer(config: MailerConfig): Transporter {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    // Mailpit speaks plain SMTP; a real relay must not be talked to in the clear.
    requireTLS: config.port !== 465 && config.host !== '127.0.0.1' && config.host !== 'localhost',
    ...(config.user === '' ? {} : { auth: { user: config.user, pass: config.pass } }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    // Message bodies come out of the notifications payload; never let one reach the filesystem
    // or an outbound URL through an attachment `path`/`href`.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** `<notif-{notifications.id}@{domain}>` — identical on every retry, so mailboxes dedupe. */
export function outboxMessageId(notificationId: number | string, domain: string): string {
  return `<notif-${notificationId}@${domain}>`;
}

export async function sendOutboxMessage(
  transporter: Transporter,
  config: MailerConfig,
  message: OutboxMessage,
): Promise<SendOutcome> {
  const info = await transporter.sendMail({
    messageId: outboxMessageId(message.notificationId, config.domain),
    from: config.from,
    replyTo: config.replyTo,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.calendar === undefined
      ? {}
      : {
          icalEvent: {
            method: message.calendar.method,
            filename: 'invite.ics',
            content: message.calendar.content,
          },
        }),
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted.map(String),
    rejected: info.rejected.map(String),
    response: info.response,
  };
}
