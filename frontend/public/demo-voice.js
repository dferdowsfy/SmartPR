/* Demo walkthrough narration: replaces the browser's built-in (robotic)
 * speechSynthesis with pre-generated studio voice MP3s.
 * The walkthrough calls speechSynthesis.speak(utterance) with one of 18 fixed
 * narration lines; we match utterance.text exactly and play the matching MP3
 * through a single AudioContext (created on the first user gesture, so chained
 * step playback is never blocked by autoplay policy). Unknown lines fall back
 * to the native synthesizer when one exists. */
(function () {
  var MAP = {"The SmartPR homepage. A business owner, or their attorney, starts a new assessment.": "/demo-audio/en-0.mp3", "Empezamos un assessment nuevo, como lo haría cualquier dueño de negocio.": "/demo-audio/es-0.mp3", "The business describes its situation in its own words: an existing furniture manufacturer leasing a 12,000 sq ft facility in Guaynabo, with interior renovation.": "/demo-audio/en-1.mp3", "El negocio describe su situación en sus propias palabras: un fabricante de muebles existente que arrienda una instalación de 12,000 pies² en Guaynabo, con renovación interior.": "/demo-audio/es-1.mp3", "Each chip is a fact SmartPR pulled from the description: property, planned work and use, and business profile. It flags a possible change of use, from warehouse/office to manufacturing.": "/demo-audio/en-2.mp3", "SmartPR interpreta la descripción y detecta los hechos clave: es un negocio existente, hay renovación interior y un posible cambio de uso.": "/demo-audio/es-2.mp3", "SmartPR asks only what it could not infer, one question at a time. The highlighted answers are the ones given for this business.": "/demo-audio/en-3.mp3", "SmartPR pregunta solo lo que no pudo inferir, una pregunta a la vez. Las respuestas resaltadas son las de este negocio.": "/demo-audio/es-3.mp3", "The business profile is filled in from the description. Once reviewed, it collapses to a one-line summary.": "/demo-audio/en-4.mp3", "Los datos se entran una sola vez y SmartPR los lleva a cada requisito.": "/demo-audio/es-4.mp3", "A readiness score that starts at 0%, 15 items remaining, and 4 opportunities. The score rises as items are completed.": "/demo-audio/en-5.mp3", "Un nivel de preparación que empieza en 0%, 15 pendientes y 4 oportunidades. El nivel sube a medida que se completan.": "/demo-audio/es-5.mp3", "Construction Permit → Permiso Único → Patente Municipal. Each card shows its status, legal source and prerequisite.": "/demo-audio/en-6.mp3", "Aquí está la secuencia correcta: primero el permiso de construcción de la OGPe para la renovación interior, después el Permiso Único con la autorización de uso, y luego la patente municipal de Guaynabo. Y como es un negocio existente, SmartPR pide verificar los registros vigentes en vez de empezar de cero.": "/demo-audio/es-6.mp3", "Registrations and licenses the business already holds, supporting documents, a conditional environmental review, and 4 incentive opportunities.": "/demo-audio/en-7.mp3", "Registros y licencias que el negocio ya tiene, documentos de apoyo, una evaluación ambiental condicional y 4 oportunidades de incentivos.": "/demo-audio/es-7.mp3", "Clara, the filing assistant, opens the Permiso Único with the OGPe filing plan and the business profile already loaded.": "/demo-audio/en-8.mp3", "Y Clara abre el expediente con todo el contexto del negocio y la agencia correcta.": "/demo-audio/es-8.mp3"};
  var nativeSynth = window.speechSynthesis;
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var buffers = {};
  var current = null; // { src, stop }

  function ensureCtx() {
    if (!ctx && AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    if (ctx && ctx.state === "suspended") { ctx.resume(); }
    return ctx;
  }

  function preload() {
    if (!AC) return;
    ensureCtx();
    Object.keys(MAP).forEach(function (text) {
      var url = MAP[text];
      if (buffers[url]) return;
      buffers[url] = null;
      fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
        if (ctx) ctx.decodeAudioData(ab, function (b) { buffers[url] = b; },
          function () { buffers[url] = false; });
      }).catch(function () { buffers[url] = false; });
    });
  }

  function stopCurrent() {
    if (current) { try { current.stop(); } catch (e) {} current = null; }
  }

  function playBuffer(u, url) {
    var c = ensureCtx();
    var buf = buffers[url];
    if (!c || !buf) return false;
    var src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    var entry = { src: src, stop: function () { try { src.stop(); } catch (e) {} } };
    current = entry;
    src.onended = function () {
      if (current === entry) current = null;
      window.__demoVoice.lastPlayed = url;
      if (u.onend) u.onend();
    };
    try { src.start(0); } catch (e) { current = null; return false; }
    window.__demoVoice.lastPlayed = url;
    return true;
  }

  function fallbackHtmlAudio(u, url) {
    var a = new Audio(url);
    var entry = { stop: function () { try { a.pause(); } catch (e) {} } };
    current = entry;
    a.onended = function () {
      if (current === entry) current = null;
      window.__demoVoice.lastPlayed = url;
      if (u.onend) u.onend();
    };
    a.onerror = function () { if (current === entry) current = null; if (u.onerror) u.onerror(); };
    var p = a.play();
    if (p && p.catch) p.catch(function () { if (u.onerror) u.onerror(); });
  }

  var shim = {
    getVoices: function () { return []; },
    speak: function (u) {
      stopCurrent();
      var text = u && u.text;
      var url = text ? MAP[text] : null;
      if (url && playBuffer(u, url)) return;
      if (url) { fallbackHtmlAudio(u, url); return; }
      if (nativeSynth && nativeSynth.speak) { nativeSynth.speak(u); return; }
      setTimeout(function () { if (u.onend) u.onend(); }, 800);
    },
    cancel: function () { stopCurrent(); },
    get speaking() { return !!current; },
    get pending() { return false; },
    onvoiceschanged: null
  };

  window.__demoVoice = { lastPlayed: null, mapSize: Object.keys(MAP).length };
  try {
    Object.defineProperty(window, "speechSynthesis", {
      value: shim, writable: false, configurable: true
    });
  } catch (e) { window.speechSynthesis = shim; }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", preload);
  } else { preload(); }
})();
