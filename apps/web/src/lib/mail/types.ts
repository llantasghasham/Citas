export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sending email is a provider decision that has not been made yet, so the
 * application only knows this port. Picking Resend, SES or anything else later
 * adds one file and touches nothing.
 */
export interface Mailer {
  readonly id: string;
  send(email: Email): Promise<void>;
}
