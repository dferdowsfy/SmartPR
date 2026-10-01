/**
 * In-page teach-mode recorder, injected into every page of a teach session
 * (Playwright add_init_script on the worker). It reports STRUCTURE only:
 *
 *   page  — URL, title, main heading, and whether the screen has a password
 *           field, a CAPTCHA or a file input
 *   click — role, label and selector of buttons / links / radios /
 *           checkboxes / options (never text inputs)
 *   fill  — role, label, selector, input type and a coarse value KIND
 *           (email / phone / postal / number / date / text / empty). The
 *           value itself is read only to classify it and never leaves the
 *           page. Sensitive fields (passwords, SSNs, one-time codes, card
 *           numbers — see sensitiveKind in domHelpers.ts) are reported as
 *           kind "secret" with a secretKind, without being read at all, and
 *           are masked on screen so the live view and screenshots show dots.
 *           Page events list the visible sensitive fields (label/selector
 *           only) so SmartPR can offer a one-time secure input card.
 *
 * Events go to window.__claraRecord(json) when the worker exposes that
 * binding, and are also appended to window.__claraEvents (tests read it).
 * Plain ES2017 in a string so no bundler helper leaks into the page. The
 * label/selector helpers are shared with the replay driver (domHelpers.ts).
 */
import { DOM_HELPERS_JS } from "./domHelpers";

export const RECORDER_SCRIPT = String.raw`(function () {
  if (window.__claraRecorderInstalled) return;
  window.__claraRecorderInstalled = true;
  window.__claraEvents = window.__claraEvents || [];
${DOM_HELPERS_JS}

  function send(ev) {
    ev.url = location.href;
    window.__claraEvents.push(ev);
    try { if (typeof window.__claraRecord === "function") window.__claraRecord(JSON.stringify(ev)); } catch (e) {}
  }

  function isRequired(el) {
    return !!(el.required || el.getAttribute("aria-required") === "true");
  }

  function valueKind(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || sensitiveKind(el)) return "secret";
    if (type === "file") return "file";
    if (tag === "select") return el.selectedIndex > 0 || (el.value && el.selectedIndex >= 0) ? "option" : "empty";
    var v = String(el.value || "").trim();
    if (!v) return "empty";
    if (type === "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
    if (type === "date" || /^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(v)) return "date";
    if (type === "tel") return "phone";
    if (/^[\d\s()+.-]+$/.test(v)) {
      var d = v.replace(/\D/g, "");
      if (/^\d{5}(-\d{4})?$/.test(v)) return "postal";
      if (d.length === 10 || d.length === 11) return "phone";
      return "number";
    }
    return "text";
  }

  function hasVisibleFileInput() {
    var files = document.querySelectorAll("input[type=file]");
    for (var i = 0; i < files.length; i++) {
      if (visible(files[i]) || visible(files[i].closest("label"))) return true;
      if (files[i].id && visible(document.querySelector('label[for="' + files[i].id + '"]'))) return true;
    }
    return false;
  }

  var lastPageKey = "";
  function emitPage() {
    var h = firstVisible("h1, h2, legend, [role=heading]");
    var heading = h ? textWithoutControls(h) : "";
    maskSensitive();
    var secrets = sensitiveFields();
    var key = location.href.split("?")[0] + "|" + heading + "|" + document.title + "|" + secrets.length;
    if (key === lastPageKey) return;
    lastPageKey = key;
    send({
      kind: "page",
      title: clean(document.title),
      heading: heading,
      secretFields: secrets,
      hasPassword: !!firstVisible("input[type=password]"),
      hasCaptcha: !!firstVisible('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[id*="captcha" i],[class*="captcha" i],[name*="captcha" i]'),
      hasFileInput: hasVisibleFileInput()
    });
  }

  var pageTimer = null;
  function schedulePage() { clearTimeout(pageTimer); pageTimer = setTimeout(emitPage, 300); }

  var CLICKABLE = "button,a[href],[role=button],[role=link],[role=radio],[role=checkbox],[role=option],[role=tab],[role=combobox],[role=menuitem],input[type=radio],input[type=checkbox],input[type=submit],input[type=button],summary";
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest(CLICKABLE) : null;
    if (!el) return;
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    var role = el.getAttribute("role") || "";
    var kind;
    if (type === "radio" || role === "radio") kind = "radio";
    else if (type === "checkbox" || role === "checkbox") kind = "checkbox";
    else if (role === "option" || role === "menuitem") kind = "option";
    else if (role === "combobox") kind = "combobox";
    else if (role === "tab") kind = "tab";
    else if (tag === "a" || role === "link") kind = "link";
    else kind = "button";
    var label = labelFor(el);
    var ev = { kind: "click", role: kind, label: label, selector: selectorFor(el), inputType: type || tag };
    if (kind === "option" || kind === "radio") ev.optionText = label;
    send(ev);
    schedulePage();
  }, true);

  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (!/^(input|select|textarea)$/.test(tag)) return;
    if (/^(radio|checkbox|submit|button|hidden)$/.test(type)) return;
    var secret = sensitiveKind(el);
    var kind = secret ? "secret" : valueKind(el);
    var ev = {
      kind: "fill",
      role: tag === "select" ? "combobox" : "textbox",
      label: labelFor(el),
      selector: selectorFor(el),
      inputType: type || tag,
      valueKind: kind,
      required: isRequired(el)
    };
    if (secret) ev.secretKind = secret;
    if (tag === "select" && el.selectedIndex >= 0 && el.options[el.selectedIndex]) ev.optionText = clean(el.options[el.selectedIndex].text);
    send(ev);
  }, true);

  // Mask a sensitive field before the first keystroke shows on screen.
  document.addEventListener("focusin", function () { maskSensitive(); }, true);

  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); schedulePage(); return r; };
  });
  window.addEventListener("hashchange", schedulePage);
  window.addEventListener("popstate", schedulePage);
  function observe() {
    if (!document.body) return;
    new MutationObserver(schedulePage).observe(document.body, { childList: true, subtree: true });
    emitPage();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();
})();`;
