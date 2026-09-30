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
 *           page. Password fields are reported as kind "secret" without
 *           being read at all.
 *
 * Events go to window.__claraRecord(json) when the worker exposes that
 * binding, and are also appended to window.__claraEvents (tests read it).
 * Plain ES2017 in a string so no bundler helper leaks into the page.
 */
export const RECORDER_SCRIPT = String.raw`(function () {
  if (window.__claraRecorderInstalled) return;
  window.__claraRecorderInstalled = true;
  window.__claraEvents = window.__claraEvents || [];

  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, 160); }

  function send(ev) {
    ev.url = location.href;
    window.__claraEvents.push(ev);
    try { if (typeof window.__claraRecord === "function") window.__claraRecord(JSON.stringify(ev)); } catch (e) {}
  }

  function textWithoutControls(el) {
    var copy = el.cloneNode(true);
    var drop = copy.querySelectorAll("input,select,textarea,option,script,style");
    for (var i = 0; i < drop.length; i++) drop[i].remove();
    return clean(copy.textContent);
  }

  function labelFor(el) {
    var aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    var by = el.getAttribute("aria-labelledby");
    if (by) {
      var parts = by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? textWithoutControls(n) : ""; });
      var joined = clean(parts.join(" "));
      if (joined) return joined;
    }
    if (el.id) {
      var forLabel = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (forLabel) { var t = textWithoutControls(forLabel); if (t) return t; }
    }
    var wrap = el.closest("label");
    if (wrap) { var w = textWithoutControls(wrap); if (w) return w; }
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "button" || tag === "a" || /^(button|link|option|tab|menuitem)$/.test(el.getAttribute("role") || "")) {
      var own = textWithoutControls(el);
      if (own) return own;
    }
    if (tag === "input" && (type === "submit" || type === "button")) return clean(el.value);
    if (el.getAttribute("placeholder")) return clean(el.getAttribute("placeholder"));
    if (el.getAttribute("title")) return clean(el.getAttribute("title"));
    var prev = el.previousElementSibling;
    if (prev && !/^(INPUT|SELECT|TEXTAREA)$/.test(prev.tagName)) { var p = textWithoutControls(prev); if (p) return p; }
    var parent = el.parentElement;
    if (parent && parent.previousElementSibling) { var pp = textWithoutControls(parent.previousElementSibling); if (pp) return pp; }
    if (el.getAttribute("name")) return clean(el.getAttribute("name"));
    return "";
  }

  function selectorFor(el) {
    var id = el.id;
    if (id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{4,}/.test(id)) return "#" + id;
    var name = el.getAttribute("name");
    if (name && /^[\w.\[\]-]+$/.test(name)) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    var path = [];
    var node = el;
    for (var depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      var tag = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && !/\d{4,}/.test(node.id)) { path.unshift("#" + node.id); break; }
      var idx = 1, sib = node;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) idx++;
      path.unshift(tag + ":nth-of-type(" + idx + ")");
      node = node.parentElement;
    }
    return path.join(" > ") || null;
  }

  function isRequired(el) {
    return !!(el.required || el.getAttribute("aria-required") === "true");
  }

  function valueKind(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return "secret";
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

  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) && getComputedStyle(el).visibility !== "hidden";
  }
  function firstVisible(selector) {
    var all = document.querySelectorAll(selector);
    for (var i = 0; i < all.length; i++) if (visible(all[i])) return all[i];
    return null;
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
    var key = location.href.split("?")[0] + "|" + heading + "|" + document.title;
    if (key === lastPageKey) return;
    lastPageKey = key;
    send({
      kind: "page",
      title: clean(document.title),
      heading: heading,
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
    var kind = valueKind(el);
    var ev = {
      kind: "fill",
      role: tag === "select" ? "combobox" : "textbox",
      label: labelFor(el),
      selector: selectorFor(el),
      inputType: type || tag,
      valueKind: kind,
      required: isRequired(el)
    };
    if (tag === "select" && el.selectedIndex >= 0 && el.options[el.selectedIndex]) ev.optionText = clean(el.options[el.selectedIndex].text);
    send(ev);
  }, true);

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
