/**
 * Who may sign a month off, enforced by the data API itself (row policy on create, see MonthSignOff.ts).
 *
 * Read at deploy time from `CONTROLLER_EMAILS` (comma-separated sign-in addresses), so no address has to be
 * committed. Without it, the example address below is used and nobody in your tenant can sign off until you
 * set it. The app shows the same list (VITE_CONTROLLER_EMAILS) to hide the button for everyone else.
 */
declare const process: { env: Record<string, string | undefined> } | undefined;

const fromEnv = typeof process !== 'undefined' ? process.env.CONTROLLER_EMAILS : undefined;

export const CONTROLLER_EMAILS: string[] = (fromEnv ?? 'controller@contoso.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
