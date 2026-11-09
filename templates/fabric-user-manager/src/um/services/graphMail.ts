/**
 * The notice to a group's owners that someone requested access, sent in the
 * requester's own name from their own mailbox.
 *
 * Next to `graphWrite.ts` this is the only file that may send anything but a
 * read to Graph, and it can send exactly one thing: one message through the
 * fixed address `/me/sendMail`, as plain text, to at most ten recipients.
 * The text is assembled from a fixed template; nothing in it is HTML.
 *
 * Loaded only in builds made with member changes (`VITE_UM_WRITES=true`).
 */
import { noticeRecipients } from '@/um/domain/accessRequest';

import { GRAPH_BASE, type GraphFetch } from './graphRead';

export const SEND_MAIL_URL = `${GRAPH_BASE}/me/sendMail`;

export interface Notice {
  /** Addresses separated by `;`. Filtered and capped before sending. */
  to: string;
  subject: string;
  /** Plain text. */
  body: string;
}

export type MailOutcome = { ok: true; recipients: number } | { ok: false; code: 'no-recipients' | 'denied' | 'failed' };

/** Keep provider-supplied names from breaking the subject line. */
function oneLine(text: string, max: number): string {
  return text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

export async function sendNotice(notice: Notice, token: string, fetcher: GraphFetch = (url, init) => fetch(url, init)): Promise<MailOutcome> {
  const recipients = noticeRecipients(notice.to);
  if (recipients.length === 0) return { ok: false, code: 'no-recipients' };
  const message = {
    message: {
      subject: oneLine(notice.subject, 200),
      body: { contentType: 'Text', content: notice.body.slice(0, 4000) },
      toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  };
  try {
    const response = await fetcher(SEND_MAIL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 202 || response.ok) return { ok: true, recipients: recipients.length };
    return { ok: false, code: response.status === 401 || response.status === 403 ? 'denied' : 'failed' };
  } catch {
    return { ok: false, code: 'failed' };
  }
}
