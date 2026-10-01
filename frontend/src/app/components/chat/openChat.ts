export const OPEN_CHAT_EVENT = "smartpr-open-chat";

/** Opens the SmartPR assistant, optionally with a question to send. */
export function openSmartPRChat(question?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { question: question ?? null } }));
}
