/**
 * In-page replay driver, injected into every page of a replay session. It
 * only READS the page and TAGS elements — the actual typing and clicking
 * is done by Playwright on the tagged element (real input events).
 *
 *   window.__claraDrive.snapshot() → { url, title, heading, hasPassword,
 *     hasCaptcha, errors[], secretFields[] }  (visible validation messages,
 *     trimmed; sensitive inputs by label/selector — never their values)
 *   window.__claraDrive.locate({ role, label, selector }) →
 *     { ok: true, ref, via: "label" | "selector", tag, type, value }
 *     { ok: false, reason: "not_found" | "ambiguous", seen: string[] }
 *
 * Locating never guesses: role + label first (exact, then contains), then
 * the recorded selector; more than one equally good match is "ambiguous"
 * and the engine pauses. Labels use the same helpers as the teach recorder.
 */
import { DOM_HELPERS_JS } from "../teach/domHelpers";

export const DRIVER_SCRIPT = String.raw`(function () {
  if (window.__claraDrive) return;
${DOM_HELPERS_JS}

  function norm(s) {
    return clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  var ROLE_SELECTORS = {
    textbox: "input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=number],input[type=date],input[type=search],input[type=url],textarea,[role=textbox],[contenteditable=true]",
    combobox: "select,[role=combobox],[aria-haspopup=listbox]",
    option: "[role=option],[role=menuitem],option",
    radio: "input[type=radio],[role=radio]",
    checkbox: "input[type=checkbox],[role=checkbox]",
    button: "button,input[type=submit],input[type=button],[role=button]",
    link: "a[href],[role=link]",
    tab: "[role=tab]"
  };

  var refSeq = 0;
  function tag(el) {
    if (!el.getAttribute("data-clara-ref")) el.setAttribute("data-clara-ref", "c" + (++refSeq));
    return el.getAttribute("data-clara-ref");
  }

  function describe(el, via) {
    return {
      ok: true,
      ref: tag(el),
      via: via,
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || "").toLowerCase(),
      // A control's caption (select option / button text) — never what is typed in a text field.
      value: el.tagName === "SELECT" ? (el.options[el.selectedIndex] ? clean(el.options[el.selectedIndex].text) : "")
        : (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type || "")) ? clean(el.value)
        : (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ? ""
        : clean(el.textContent)
    };
  }

  function locate(target) {
    var sel = ROLE_SELECTORS[target.role] || ROLE_SELECTORS.button;
    var all = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (el) {
      return visible(el) || (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox") && visible(el.closest("label") || el.parentElement));
    });
    var want = norm(target.label);
    var labelOf = function (el) { return norm(target.role === "option" ? textWithoutControls(el) || labelFor(el) : labelFor(el)); };
    var exact = all.filter(function (el) { return labelOf(el) === want; });
    if (exact.length === 1) return describe(exact[0], "label");
    if (exact.length > 1) return { ok: false, reason: "ambiguous", seen: [] };
    var partial = want ? all.filter(function (el) { var l = labelOf(el); return l && (l.indexOf(want) >= 0 || (want.indexOf(l) >= 0 && l.length >= 4)); }) : [];
    if (partial.length === 1) return describe(partial[0], "label");
    if (target.selector) {
      try {
        var bySel = Array.prototype.slice.call(document.querySelectorAll(target.selector)).filter(visible);
        if (bySel.length === 1) return describe(bySel[0], "selector");
        if (bySel.length > 1) return { ok: false, reason: "ambiguous", seen: [] };
      } catch (e) {}
    }
    if (partial.length > 1) return { ok: false, reason: "ambiguous", seen: [] };
    return { ok: false, reason: "not_found", seen: all.slice(0, 25).map(labelOf).filter(Boolean) };
  }

  function snapshot() {
    maskSensitive();
    var h = firstVisible("h1, h2, legend, [role=heading]");
    var errs = Array.prototype.slice.call(document.querySelectorAll("[role=alert],.error,.errors,.validation-error,.field-validation-error,.invalid-feedback,[aria-invalid=true] + *"))
      .filter(visible).map(function (e) { return clean(e.textContent); }).filter(Boolean).slice(0, 5);
    return {
      url: location.href,
      title: clean(document.title),
      heading: h ? textWithoutControls(h) : "",
      hasPassword: !!firstVisible("input[type=password]"),
      hasCaptcha: !!firstVisible('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[id*="captcha" i],[class*="captcha" i],[name*="captcha" i]'),
      errors: errs,
      secretFields: sensitiveFields()
    };
  }

  // Sensitive fields stay masked in the live view while Clara fills.
  document.addEventListener("focusin", function () { maskSensitive(); }, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maskSensitive);
  else maskSensitive();

  window.__claraDrive = { snapshot: snapshot, locate: locate, norm: norm };
})();`;
