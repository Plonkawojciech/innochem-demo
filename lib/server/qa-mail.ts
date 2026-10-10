/** Explicit automated QA markers must never reach a mail provider. */
export function isQaMail(subject: string, body: string): boolean {
  if (/\[test\]/i.test(subject)) return true;
  const firstLine = body
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return !!firstLine && /^\[test\]/i.test(firstLine);
}
