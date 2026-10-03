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

  // Every visible field on the screen (label/selector/kind — never a value),
  // so the person can complete it from SmartPR: text-like inputs, choice
  // questions (radio groups and dropdowns, with their option labels) and the
  // screen's Continue / Next button (never a final submit).
  function shown(el) {
    if (visible(el)) return true;
    var lab = el.id ? document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]') : null;
    return visible(lab) || visible(el.closest("label"));
  }
  function questionFor(radios) {
    var first = radios[0];
    var group = first.closest("fieldset, [role=radiogroup]");
    if (group) {
      var lg = group.querySelector("legend");
      if (lg && textWithoutControls(lg)) return textWithoutControls(lg);
      var al = group.getAttribute("aria-label");
      if (al) return clean(al);
      var lb = group.getAttribute("aria-labelledby");
      if (lb) { var n = document.getElementById(lb.split(/\s+/)[0]); if (n && textWithoutControls(n)) return textWithoutControls(n); }
    }
    // Climb to the element holding the whole group, then read the text just before it.
    var box = first.parentElement;
    for (var d = 0; box && d < 6; d++) {
      var all = true;
      for (var i = 0; i < radios.length; i++) if (!box.contains(radios[i])) { all = false; break; }
      if (all) break;
      box = box.parentElement;
    }
    for (var up = 0, node = box; node && up < 3; up++, node = node.parentElement) {
      var prev = node.previousElementSibling;
      for (var k = 0; prev && k < 3; k++, prev = prev.previousElementSibling) {
        var t = textWithoutControls(prev);
        if (t && t.length <= 160) return t;
      }
    }
    return first.getAttribute("name") ? clean(first.getAttribute("name")) : "";
  }
  function nextButton() {
    var cands = document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], [role=button]");
    for (var i = 0; i < cands.length; i++) {
      var b = cands[i];
      if (!visible(b) || b.disabled) continue;
      var t = labelFor(b);
      if (/^(continue|continuar|next|siguiente|begin application|comenzar|start|empezar|accept|aceptar)\b/i.test(t) && !/submit|enviar|sign|firmar|pay|pagar|file now|radicar/i.test(t)) {
        return { label: t, selector: selectorFor(b), kind: "next" };
      }
    }
    return null;
  }
  function pageFields() {
    var out = [];
    var all = document.querySelectorAll("input, textarea");
    for (var i = 0; i < all.length && out.length < 12; i++) {
      var el = all[i];
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (/^(hidden|checkbox|radio|submit|button|file|reset|image|range|color)$/.test(type)) continue;
      if (el.disabled || el.readOnly || !visible(el)) continue;
      out.push({ label: labelFor(el), selector: selectorFor(el), kind: sensitiveKind(el) || "text" });
    }
    // Radio groups (by name) → one choice question with its options.
    var groups = {}, order = [];
    var radios = document.querySelectorAll("input[type=radio]");
    for (var r = 0; r < radios.length; r++) {
      var rb = radios[r];
      if (rb.disabled || !shown(rb)) continue;
      var key = rb.getAttribute("name") || ("__" + r);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(rb);
    }
    for (var g = 0; g < order.length && out.length < 15; g++) {
      var list = groups[order[g]];
      if (list.length < 2) continue;
      out.push({
        label: questionFor(list),
        selector: selectorFor(list[0]),
        kind: "choice",
        options: list.slice(0, 14).map(function (o) { return { label: labelFor(o).slice(0, 80), selector: selectorFor(o) }; }),
      });
    }
    // Dropdowns → choice questions (options by visible text).
    var sels = document.querySelectorAll("select");
    for (var s = 0; s < sels.length && out.length < 15; s++) {
      var se = sels[s];
      if (se.disabled || !visible(se)) continue;
      var opts = [];
      for (var o = 0; o < se.options.length && opts.length < 14; o++) {
        var ot = clean(se.options[o].text);
        if (ot && se.options[o].value !== "") opts.push({ label: ot.slice(0, 80), selector: null });
      }
      if (opts.length >= 2) out.push({ label: labelFor(se), selector: selectorFor(se), kind: "choice", options: opts });
    }
    var nb = nextButton();
    if (nb) out.push(nb);
    // Keep the page event small (the worker caps event size): trim options first.
    while (JSON.stringify(out).length > 3300) {
      var biggest = null;
      for (var z = 0; z < out.length; z++) if (out[z].options && out[z].options.length > 4 && (!biggest || out[z].options.length > biggest.options.length)) biggest = out[z];
      if (!biggest) { out.pop(); continue; }
      biggest.options = biggest.options.slice(0, biggest.options.length - 2);
    }
    return out;
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
