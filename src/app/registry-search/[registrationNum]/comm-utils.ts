/**
 * Pure utilities for the registration detail page.
 * Kept separate so Vitest can import them without pulling in
 * next/navigation or @/lib/db (both of which are server-only).
 */

/**
 * Returns true when at least one comm report in the list has no subject
 * matters — indicating it falls within OCL's ~18-month subject-matter lag.
 * Used to gate the contextual note below the MCR table heading.
 */
export function commsHaveBlankSubjects(
  comms: { subjects: string[] }[],
): boolean {
  return comms.some((c) => c.subjects.length === 0);
}
