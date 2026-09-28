// Local forward proxy chaining to the environment egress proxy (raw TCP relay).
// Chromium's network stack gets ERR_EMPTY_RESPONSE via the egress proxy directly
// (curl/Node TCP work fine), so we terminate Chromium's proxy connection locally
// and relay upstream bytes with Node sockets. No credentials in this file — the
// upstream proxy URL is read from the environment at runtime.
import net from "node:net";

const upstream = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || "");
if (!upstream.hostname) { console.error("no HTTPS_PROXY set"); process.exit(1); }
const upstreamHost = upstream.hostname;
const upstreamPort = Number(upstream.port) || 3128;
const upstreamAuth = upstream.username
  ? "Basic " + Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString("base64")
  : null;

const server = net.createServer((client) => {
  let buf = Buffer.alloc(0);
  const onHead = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end === -1) return;
    client.off("data", onHead);
    const head = buf.slice(0, end + 4);
    const rest = buf.slice(end + 4);
    const firstLine = head.toString().split("\r\n")[0];
    const m = firstLine.match(/^(CONNECT|GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE)\s+(\S+)\s+HTTP\/1\.[01]/);
    if (!m) { client.destroy(); return; }
    const [, method, target] = m;
    const up = net.connect(upstreamPort, upstreamHost, () => {
      if (method === "CONNECT") {
        let h = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`;
        if (upstreamAuth) h += `Proxy-Authorization: ${upstreamAuth}\r\n`;
        h += "\r\n";
        up.write(h);
        let ub = Buffer.alloc(0);
        const onUp = (c) => {
          ub = Buffer.concat([ub, c]);
          const ue = ub.indexOf("\r\n\r\n");
          if (ue === -1) return;
          up.off("data", onUp);
          if (/^HTTP\/1\.[01] 200/.test(ub.slice(0, ue).toString())) {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            const leftover = ub.slice(ue + 4);
            if (leftover.length) client.write(leftover);
            if (rest.length) up.write(rest);
            up.pipe(client); client.pipe(up);
          } else { client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); up.destroy(); }
        };
        up.on("data", onUp);
      } else {
        // Plain HTTP: relay the raw request (absolute URI) upstream.
        let out = head.toString().replace(/\r\nProxy-Authorization:[^\r\n]*/i, "");
        out = out.replace(/\r\n\r\n$/, `\r\n${upstreamAuth ? `Proxy-Authorization: ${upstreamAuth}\r\n` : ""}\r\n`);
        up.write(out);
        if (rest.length) up.write(rest);
        up.pipe(client); client.pipe(up);
      }
    });
    up.on("error", () => client.destroy());
  };
  client.on("data", onHead);
  client.on("error", () => {});
});

server.listen(18080, "127.0.0.1", () => console.log("forwarder listening on 127.0.0.1:18080"));
