/**
 * Clara interactive-surface tokens (Tailwind class strings).
 *
 *   border   #D7DEE8 → hover #B8C4D4 → selected/primary #93B4FF
 *   shadow   0 2px 6px rgba(15,23,42,.06) → hover 0 4px 12px rgba(15,23,42,.09)
 *   focus    2px #2563EB ring, offset
 *
 * Every Clara control that does something uses one of these so buttons and
 * workflow cards read as actions rather than passive boxes.
 */
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2";
const ELEVATION = "shadow-[0_2px_6px_rgba(15,23,42,0.06)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.09)] transition-[border-color,box-shadow,background-color]";

/** Neutral clickable surface (cards, secondary buttons). */
export const CLARA_SURFACE = `border border-[#D7DEE8] hover:border-[#B8C4D4] ${ELEVATION} ${FOCUS}`;
/** Selected / high-priority clickable surface. */
export const CLARA_SURFACE_SELECTED = `border-[1.5px] border-[#93B4FF] ${ELEVATION} ${FOCUS}`;
/** Secondary pill button. */
export const CLARA_BTN = `inline-flex items-center justify-center gap-2 rounded-full bg-white ${CLARA_SURFACE} hover:bg-[#F8FAFC] disabled:opacity-50`;
/** Primary pill button (solid SmartPR blue). */
export const CLARA_BTN_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-full border border-[#1D4ED8] bg-[#2563EB] font-semibold text-white ${ELEVATION} hover:bg-[#1D4ED8] ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50`;
/** Teach Clara — admin capability: warm amber, distinct from filing actions. */
export const CLARA_BTN_ADMIN = `inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-[#F2C46D] bg-[#FFF7E6] text-[#8A5A00] ${ELEVATION} hover:border-[#E3A93B] hover:bg-[#FFEFCC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706] focus-visible:ring-offset-2`;
