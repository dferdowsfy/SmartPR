/**
 * PortalDriver over a Playwright Page (tests, simulators, and the same
 * semantics the worker's /api/v4/drive endpoints implement in Python).
 * The page must have DRIVER_SCRIPT injected (context.addInitScript).
 * Typing and clicking use Playwright on the element DRIVER_SCRIPT tagged,
 * so the portal sees real input events.
 */
import type { Page } from "playwright";
import type { LocateResult, PageSnapshot, PortalDriver } from "./engine";

export class PlaywrightDriver implements PortalDriver {
  /** Every click the engine made, by visible label — tests assert on it. */
  clicks: string[] = [];

  constructor(private page: Page, private settleMs = 250) {}

  private el(ref: string) {
    return this.page.locator(`[data-clara-ref="${ref.replace(/[^a-z0-9]/gi, "")}"]`);
  }

  async snapshot(): Promise<PageSnapshot> {
    return this.page.evaluate(() => (window as unknown as { __claraDrive: { snapshot(): PageSnapshot } }).__claraDrive.snapshot());
  }

  async locate(target: { role: string; label: string; selector?: string | null }): Promise<LocateResult> {
    return this.page.evaluate(
      (t) => (window as unknown as { __claraDrive: { locate(x: unknown): LocateResult } }).__claraDrive.locate(t),
      { role: target.role, label: target.label, selector: target.selector ?? null }
    );
  }

  async fill(ref: string, value: string): Promise<void> {
    await this.el(ref).fill(value);
  }

  async selectOption(ref: string, optionLabel: string): Promise<boolean> {
    const loc = this.el(ref);
    const labels = await loc.evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.text.trim()));
    const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const want = norm(optionLabel);
    const exact = labels.filter((l) => norm(l) === want);
    const partial = labels.filter((l) => norm(l).includes(want));
    const pick = exact.length === 1 ? exact[0] : exact.length === 0 && partial.length === 1 ? partial[0] : null;
    if (!pick) return false;
    await loc.selectOption({ label: pick });
    return true;
  }

  async click(ref: string): Promise<void> {
    const loc = this.el(ref);
    const label = (await loc.evaluate((e) => (e.textContent || (e as HTMLInputElement).value || "").trim())).slice(0, 80);
    this.clicks.push(label);
    const type = await loc.evaluate((e) => (e as HTMLInputElement).type || "");
    if (type === "radio" || type === "checkbox") await loc.check({ force: true });
    else await loc.click();
  }

  async settle(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await this.page.waitForTimeout(this.settleMs);
  }
}
