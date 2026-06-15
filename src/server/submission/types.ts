/**
 * Types for the LRS submission pipeline.
 *
 * The submission harness runs as a local Node script (scripts/submit-to-lrs.ts)
 * against a headed Playwright browser. No credentials are stored server-side —
 * the user authenticates manually at both the login screen and the Certify modal.
 */

export interface LrsSubmissionPayload {
  draftMcrId: string;
  communicationDate: string; // YYYY-MM-DD
  dpohs: LrsDpoh[];
  subjectDetails: LrsSubjectDetail[]; // from registration — text labels + selection state
  clientName: string; // e.g. "Deep Sky Corporation"
}

export interface LrsDpoh {
  firstName: string;
  lastName: string;
  positionTitle: string;
  branchUnit?: string;
  governmentInstitution: string; // "Finance Canada (FIN)" format — matches LRS dropdown label
}

export interface LrsSubjectDetail {
  detailText: string; // the full description text shown in the LRS checkbox list
  selected: boolean;
}

export type SubmissionStatus =
  | "pending"
  | "in-progress"
  | "awaiting-credentials"
  | "submitted"
  | "failed";

export interface SubmissionResult {
  draftMcrId: string;
  status: "submitted" | "failed";
  // `| undefined` so builders can pass possibly-missing values directly
  // under exactOptionalPropertyTypes.
  communicationNumber?: string | undefined; // e.g. "383902-645607"
  error?: string | undefined;
}
