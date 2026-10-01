"""
Fixture agency portal for the Teach Clara real-worker e2e (HTTPS, self-signed).

  https://permisos-prueba.pr.gov/  (map the host to 127.0.0.1 in /etc/hosts)

Screens: Bienvenida -> Iniciar sesion (password) -> Identificacion (SSN)
-> Informacion del negocio -> Revision (Radicar = final submit).

Test-only instrumentation:
  GET  /__mode?set=teach|replay   which "human" script the pages run
  POST /__observe                 field changes (sensitive ones as length only)
  GET  /__state                   what was observed / whether Radicar was hit
The "human" script (teach mode) walks the filing typing business A's values,
and waits for the password / SSN to arrive (typed by the worker's secure
fill) before moving on. In replay mode it only does the person's parts.
"""
import json
import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {"mode": "teach", "observed": {}, "submitted": 0, "requests": []}

HUMAN = r"""
<script>
(async function () {
  const mode = await fetch('/__mode').then(r => r.text());
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); };
  const waitFilled = async (sel) => { for (let i = 0; i < 600; i++) { const el = document.querySelector(sel); if (el && el.value) return; await sleep(200); } };
  const p = location.pathname;
  await sleep(900);
  if (p === '/' && mode === 'teach') document.querySelector('#solicitar').click();
  if (p === '/entrar') { if (mode === 'teach') set('#usuario', 'marisol.r'); await waitFilled('#clave'); await sleep(300); document.querySelector('#entrar').click(); }
  if (p === '/solicitud/identidad') { await waitFilled('#ssn'); await sleep(300); document.querySelector('#siguiente-id').click(); }
  if (p === '/solicitud/negocio' && mode === 'teach') {
    set('#nombre-legal', 'Panaderia La Esquina LLC'); await sleep(250);
    set('#email-negocio', 'hola@laesquina.pr'); await sleep(250);
    set('#telefono', '787-555-0142'); await sleep(250);
    const s = document.querySelector('#municipio'); s.value = 'San Juan'; s.dispatchEvent(new Event('change', {bubbles: true})); await sleep(400);
    document.querySelector('#siguiente').click();
  }
})();
</script>
<script>
document.addEventListener('change', (e) => {
  const el = e.target; if (!el.id) return;
  const sensitive = el.type === 'password' || el.id === 'ssn';
  fetch('/__observe', {method: 'POST', body: JSON.stringify({id: el.id, value: sensitive ? 'len:' + el.value.length : el.value})});
}, true);
</script>
"""

def page(title, body):
    return f"""<!doctype html><html lang=es><meta charset=utf-8><title>Portal de Permisos</title>
<style>body{{font:16px system-ui;margin:0;background:#f4f6f8}} header{{background:#0b3d63;color:#fff;padding:12px 18px;font-weight:700}}
main{{max-width:620px;margin:20px auto;background:#fff;padding:20px;border-radius:10px}} label{{display:block;margin:10px 0}} input,select{{display:block;width:100%;padding:7px;margin-top:4px}}
button,a.btn{{margin-top:14px;background:#0b3d63;color:#fff;border:0;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block}}</style>
<header>Portal de Permisos &middot; Prueba</header><main><h1>{title}</h1>{body}</main>{HUMAN}</html>"""

PAGES = {
    "/": page("Bienvenido al Portal de Permisos", '<p>Patente municipal.</p><a class=btn id=solicitar href="/entrar">Solicitar permiso</a>'),
    "/entrar": page("Iniciar sesión", '<form onsubmit="event.preventDefault();location.href=\'/solicitud/identidad\'"><label for=usuario>Usuario</label><input id=usuario autocomplete=off><label for=clave>Contraseña</label><input id=clave type=password><button id=entrar>Entrar</button></form>'),
    "/solicitud/identidad": page("Identificación del dueño", '<label for=ssn>Número de seguro social</label><input id=ssn name=ssn autocomplete=off><button id=siguiente-id onclick="location.href=\'/solicitud/negocio\'">Siguiente</button>'),
    "/solicitud/negocio": page("Información del negocio",
        '<label for=nombre-legal>Nombre legal del negocio</label><input id=nombre-legal required>'
        '<label for=email-negocio>Correo electrónico</label><input id=email-negocio type=email required>'
        '<label for=telefono>Teléfono</label><input id=telefono type=tel required>'
        '<label for=municipio>Municipio</label><select id=municipio required><option value="">Escoja</option><option>San Juan</option><option>Bayamón</option><option>Guaynabo</option></select>'
        '<button id=siguiente onclick="location.href=\'/solicitud/revision\'">Siguiente</button>'),
    "/solicitud/revision": page("Revisión de la solicitud", '<p>Revise su solicitud.</p><button id=radicar onclick="fetch(\'/__submit\',{method:\'POST\'})">Radicar solicitud</button>'),
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        STATE["requests"].append(self.path)
        if path == "/__mode":
            if "set=" in self.path:
                STATE["mode"] = self.path.split("set=")[1]
                STATE["observed"] = {}
                STATE["submitted"] = 0
            return self._send(200, STATE["mode"], "text/plain")
        if path == "/__state":
            return self._send(200, json.dumps({k: STATE[k] for k in ("mode", "observed", "submitted")}), "application/json")
        if path in PAGES:
            return self._send(200, PAGES[path])
        return self._send(404, "not found", "text/plain")

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n).decode() if n else ""
        if self.path == "/__observe":
            try:
                d = json.loads(body)
                STATE["observed"][d["id"]] = d["value"]
            except Exception:
                pass
            return self._send(204, b"")
        if self.path == "/__submit":
            STATE["submitted"] += 1
            return self._send(204, b"")
        return self._send(404, "")


if __name__ == "__main__":
    cert, key, port = sys.argv[1], sys.argv[2], int(sys.argv[3] if len(sys.argv) > 3 else 443)
    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    srv.serve_forever()
