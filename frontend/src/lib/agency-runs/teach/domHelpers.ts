/**
 * In-page DOM helpers shared by the teach recorder (recorderScript.ts) and
 * the replay driver (replay/driverScript.ts), so a control is labeled the
 * same way when it is taught and when it is replayed. Plain ES2017 source,
 * spliced into each script's IIFE.
 */
export const DOM_HELPERS_JS = String.raw`
  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, 160); }

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


  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) && getComputedStyle(el).visibility !== "hidden";
  }

  function firstVisible(selector) {
    var all = document.querySelectorAll(selector);
    for (var i = 0; i < all.length; i++) if (visible(all[i])) return all[i];
    return null;
  }

  // Sensitive inputs (passwords, SSNs, one-time codes, card numbers): their
  // values are never read, and they are masked on screen (live view and any
  // screenshot show dots), whatever the portal's own input type says.
  function sensitiveKind(el) {
    if (!el || !el.tagName || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return "";
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (/^(hidden|checkbox|radio|submit|button|file|reset|image)$/.test(type)) return "";
    if (type === "password") return "password";
    var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac.indexOf("one-time-code") >= 0) return "code";
    if (/current-password|new-password/.test(ac)) return "password";
    if (/cc-(number|csc)/.test(ac)) return "payment";
    var hint = [el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), labelFor(el)].join(" ").toLowerCase();
    if (/\bssn\b|social security|seguro social|\bitin\b/.test(hint)) return "ssn";
    if (/\botp\b|one[- ]?time|verification code|c[oó]digo de (verificaci|seguridad|acceso|confirmaci)|security code|\b2fa\b|\bmfa\b|c[oó]digo (sms|otp)/.test(hint)) return "code";
    if (/\bcvv\b|\bcvc\b|card number|n[uú]mero de (la )?tarjeta|routing number|n[uú]mero de ruta/.test(hint)) return "payment";
    if (/passw|contrase[nñ]a|\bclave de acceso\b|\bpin\b/.test(hint)) return "password";
    return "";
  }

  function maskSensitive() {
    var all = document.querySelectorAll("input, textarea");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.getAttribute("data-clara-sensitive")) continue;
      var k = sensitiveKind(el);
      if (!k) continue;
      el.setAttribute("data-clara-sensitive", k);
      el.setAttribute("autocomplete", el.getAttribute("autocomplete") || "off");
      if ((el.getAttribute("type") || "").toLowerCase() !== "password") el.style.setProperty("-webkit-text-security", "disc", "important");
    }
  }

  function sensitiveFields() {
    var out = [];
    var all = document.querySelectorAll("[data-clara-sensitive]");
    for (var i = 0; i < all.length && out.length < 6; i++) {
      if (!visible(all[i])) continue;
      out.push({ label: labelFor(all[i]), selector: selectorFor(all[i]), kind: all[i].getAttribute("data-clara-sensitive") });
    }
    return out;
  }
`;
