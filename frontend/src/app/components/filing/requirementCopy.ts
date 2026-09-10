// Contextual copy for requirement cards — pure, name-pattern based. It only
// changes what a button *says*: the primary "SmartPR does this for you"
// label and the secondary "I already have this" upload prompt/label. It
// never changes requirement determination, eligibility, or any tracked
// state, and it never points the user at an external government portal —
// that decision belongs to whether SmartPR actually has a guided form or
// worksheet for the requirement (checked by the caller), not to this file.

export type IconTone = "green" | "blue" | "purple" | "gray";

export interface SecondaryCopy {
  /** e.g. "Already have your EIN?" */
  prompt: string;
  /** e.g. "Upload EIN confirmation" */
  label: string;
  helper?: string;
}

interface NamePattern {
  test: RegExp;
  icon: IconTone;
  /** "Complete ___" label for the SmartPR-guided form/worksheet, start state. */
  primaryStart: string;
  secondary: SecondaryCopy;
}

const DEFAULT_SECONDARY: SecondaryCopy = { prompt: "Already have this?", label: "Upload existing document" };

const PATTERNS: NamePattern[] = [
  {
    test: /certificate of incorporation|articles of incorporation|articles of organization|charter/i,
    icon: "green",
    primaryStart: "Complete incorporation form",
    secondary: { prompt: "Already have this?", label: "Upload existing certificate", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /\bein\b|employer identification/i,
    icon: "green",
    primaryStart: "Complete EIN form",
    secondary: { prompt: "Already have your EIN?", label: "Upload EIN confirmation", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /merchant registration|registro de comerciante/i,
    icon: "purple",
    primaryStart: "Complete registration form",
    secondary: { prompt: "Already registered?", label: "Upload certificate", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /luma|interconexi/i,
    icon: "blue",
    primaryStart: "Complete LUMA form",
    secondary: { prompt: "Already have the signed attestation?", label: "Upload signed attestation", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /permiso ?[uú]nico|single business permit/i,
    icon: "purple",
    primaryStart: "Complete permit application",
    secondary: { prompt: "Already have a permit?", label: "Upload permit", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /zoning|use certification|uso\b|ocup/i,
    icon: "purple",
    primaryStart: "Complete application",
    secondary: { prompt: "Already have this?", label: "Upload existing document", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /insurance|seguro|cfse|workers comp/i,
    icon: "gray",
    primaryStart: "Complete application",
    secondary: { prompt: "Already have this?", label: "Upload proof of insurance", helper: "Accepted: PDF, JPG, PNG" },
  },
  {
    test: /(incorpor|corporat|registr.* state|estado|articles)/i,
    icon: "green",
    primaryStart: "Complete application",
    secondary: DEFAULT_SECONDARY,
  },
  {
    test: /(tax|hacienda|contribu|iva|sales)/i,
    icon: "blue",
    primaryStart: "Complete application",
    secondary: DEFAULT_SECONDARY,
  },
  {
    test: /(permit|use|uso|zoning|ocup)/i,
    icon: "purple",
    primaryStart: "Complete application",
    secondary: DEFAULT_SECONDARY,
  },
];

function matchFor(name: string): NamePattern | undefined {
  return PATTERNS.find((pattern) => pattern.test.test(name));
}

export function iconToneFor(name: string): IconTone {
  return matchFor(name)?.icon ?? "gray";
}

/** Label for the SmartPR-guided form/worksheet action, when starting fresh. */
export function primaryStartLabelFor(name: string): string {
  return matchFor(name)?.primaryStart ?? "Complete application";
}

/** The "I already have this" upload prompt + label shown under the primary
 * SmartPR action. `hasExisting` swaps in "Re-upload" phrasing once a file is
 * already on file for this requirement. */
export function secondaryUploadCopy(name: string, hasExisting: boolean): SecondaryCopy {
  const preset = matchFor(name)?.secondary ?? DEFAULT_SECONDARY;
  if (!hasExisting) return preset;
  return { ...preset, label: preset.label.replace(/^Upload/, "Re-upload") };
}

/** Copy for the plain "upload a document" action when SmartPR has no guided
 * form/worksheet for this requirement — upload is the only, primary action. */
export function uploadOnlyCopy(name: string, hasExisting: boolean): { label: string; helper?: string } {
  const preset = matchFor(name)?.secondary ?? DEFAULT_SECONDARY;
  const label = hasExisting ? preset.label.replace(/^Upload/, "Re-upload") : preset.label;
  return { label, helper: preset.helper };
}
