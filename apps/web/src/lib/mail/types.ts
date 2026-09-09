export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * What the provider said when it took the message.
 *
 * Handing the message over is not the same as delivering it: a server can
 * accept one and then drop it, and the sender is never told. This is the last
 * thing the application can actually witness, so it is worth keeping — without
 * it, "sent" is a claim rather than evidence.
 */
export interface MailReceipt {
  /** Recipients the server took responsibility for. */
  accepted: string[];
  /** Recipients it refused outright. */
  rejected: string[];
  /** The server's own last line, e.g. "250 OK id=1abcd-…". */
  response: string;
}

/**
 * Sending email is a provider decision that has not been made yet, so the
 * application only knows this port. Picking Resend, SES or anything else later
 * adds one file and touches nothing.
 */
export interface Mailer {
  readonly id: string;
  send(email: Email): Promise<MailReceipt>;
}
