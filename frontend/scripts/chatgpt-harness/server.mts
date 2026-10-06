// ChatGPT-like sandbox harness for the SmartPR MCP Apps widget.
//
//   npx tsx scripts/chatgpt-harness/server.mts        (PORT=4100)
//   open http://localhost:4100/host?w=760              (or w=375)
//
// Mimics what ChatGPT does with the widget: the HTML comes from the real
// resources/read handler, is rendered in a sandboxed srcdoc iframe (opaque
// origin, allow-scripts only) with the resource's declared CSP enforced as a
// <meta http-equiv="Content-Security-Policy">, a window.openai shim is
// injected, and the host speaks the MCP Apps bridge (ui/initialize,
// tools/call, tool-input/tool-result notifications, size-changed). Like
// ChatGPT, the host re-publishes globals (openai:set_globals) when the widget
// resizes or persists widgetState, and can remount the widget with the saved
// widgetState and the ORIGINAL toolOutput.
//
// Query flags: ?w=<px> iframe width · ?block=tiles (declare no resource
// domains → tiles blocked by CSP) · ?prompt=<assess args JSON> · ?globals=0
// (don't re-publish globals on resize/widgetState).
import { createServer } from "node:http";
import { handleChatgptMcp, widgetResourceMeta } from "../../src/lib/chatgpt/mcp";
import { WIDGET_URI } from "../../src/lib/chatgpt/widget";
import { defaultSiteLookups } from "../../src/lib/chatgpt/siteLookup";

const PORT = Number(process.env.PORT || 4100);
// Harness-only signing key so create_portal_handoff works locally (never a real secret).
if (!process.env.CHATGPT_HANDOFF_SECRET) process.env.CHATGPT_HANDOFF_SECRET = `harness-${Math.random().toString(36).slice(2)}-${Date.now()}-local-only`;
const ORIGIN = `http://localhost:${PORT}`;
// LOOKUPS=0 → no street/official-map lookups (offline); default: the real ones.
const SITE = { siteUrl: ORIGIN, siteLookups: process.env.LOOKUPS === "0" ? null : defaultSiteLookups() };
const log: string[] = [];

async function mcp(body: unknown) {
  const r = await (handleChatgptMcp as (b: unknown, o: typeof SITE) => unknown)(body, SITE);
  return r as { status: number; body: unknown };
}

let tileRoute: null | { GET: (req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) => Promise<Response> } = null;
try { tileRoute = await import("../../src/app/api/tiles/[z]/[x]/[y]/route"); } catch { tileRoute = null; }

const HOST = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChatGPT harness</title><style>body{margin:0;font:13px system-ui;background:#f4f4f5}#chat{margin:0 auto;padding:8px 0}#frame{display:block;border:1px solid #d4d4d8;border-radius:16px;background:#fff;width:100%}#log{white-space:pre-wrap;font:11px ui-monospace;color:#3f3f46;padding:8px;max-height:220px;overflow:auto}</style></head>
<body><div id="chat"><iframe id="frame" sandbox="allow-scripts allow-popups" title="widget"></iframe></div><div id="log"></div>
<script>
var Q=new URLSearchParams(location.search),W=Number(Q.get("w")||760),BLOCK=Q.get("block")==="tiles",GLOBALS=Q.get("globals")!=="0";
var ARGS=JSON.parse(Q.get("prompt")||'{"business_type":"bar","municipality":"Bayamón"}');
var chat=document.getElementById("chat"),frame=document.getElementById("frame");chat.style.width=W+"px";
window.H={events:[],calls:[],widgetState:null,toolOutput:null,toolInput:ARGS,opened:[],csp:"",height:0,maxHeight:640};
function L(s){H.events.push(s);var d=document.getElementById("log");d.textContent=(s+"\n"+d.textContent).slice(0,8000)}
function rpc(method,params){return fetch("/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method:method,params:params})}).then(function(r){return r.json()})}
function post(m){frame.contentWindow&&frame.contentWindow.postMessage(m,"*")}
function setGlobals(g,why){if(!GLOBALS)return;L("host→widget openai:set_globals ("+why+") "+Object.keys(g).join(","));post({__harness:"set_globals",globals:g})}
function cspFrom(meta){var ui=(meta&&meta.ui&&meta.ui.csp)||{},oa=(meta&&meta["openai/widgetCSP"])||{};
 function u(a,b){return Array.from(new Set([].concat(a||[],b||[])))}
 var res=BLOCK?[]:u(ui.resourceDomains,oa.resource_domains),con=u(ui.connectDomains,oa.connect_domains),fr=u(ui.frameDomains,oa.frame_domains);
 return ["default-src 'none'","script-src 'unsafe-inline' "+res.join(" "),"style-src 'unsafe-inline' "+res.join(" "),"img-src data: blob: "+res.join(" "),"font-src data: "+res.join(" "),"connect-src "+(con.length?con.join(" "):"'none'"),"frame-src "+(fr.length?fr.join(" "):"'none'"),"worker-src 'none'","media-src 'none'","base-uri 'none'","form-action 'none'"].join("; ")}
var SHIM=function(init){
 var pend={},n=0;function call(kind,payload){var id="h"+(++n);parent.postMessage({__harness:kind,id:id,payload:payload},"*");return new Promise(function(res,rej){pend[id]={res:res,rej:rej}})}
 window.openai={toolInput:init.toolInput,toolOutput:init.toolOutput,toolResponseMetadata:null,widgetState:init.widgetState,theme:"light",displayMode:"inline",maxHeight:init.maxHeight,locale:"en-US",userAgent:{device:{type:"desktop"}},
  setWidgetState:function(s){window.openai.widgetState=s;parent.postMessage({__harness:"setWidgetState",payload:s},"*");return Promise.resolve()},
  callTool:function(name,args){return call("callTool",{name:name,arguments:args})},
  notifyIntrinsicHeight:function(h){parent.postMessage({__harness:"intrinsicHeight",payload:h},"*")},
  openExternal:function(o){parent.postMessage({__harness:"openExternal",payload:o},"*")},
  requestDisplayMode:function(){return Promise.resolve({mode:"inline"})},sendFollowUpMessage:function(){return Promise.resolve()}};
 window.addEventListener("message",function(e){var d=e.data;if(!d||!d.__harness)return;
  if(d.__harness==="set_globals"){for(var k in d.globals)window.openai[k]=d.globals[k];window.dispatchEvent(new CustomEvent("openai:set_globals",{detail:{globals:d.globals}}))}
  if(d.__harness==="reply"&&pend[d.id]){var p=pend[d.id];delete pend[d.id];d.error?p.rej(new Error(d.error)):p.res(d.result)}});
};
var widget=null;
function mount(why){L("mount widget ("+why+")");
 var init={toolInput:H.toolInput,toolOutput:H.toolOutput,widgetState:H.widgetState,maxHeight:H.maxHeight};
 var head='<meta http-equiv="Content-Security-Policy" content="'+H.csp.replace(/"/g,"&quot;")+'"><script>('+SHIM.toString()+')('+JSON.stringify(init).replace(/</g,"\\u003c")+')<\/script>';
 frame.style.height="300px";frame.srcdoc=widget.html.replace(/<head>/i,"<head>"+head)}
window.addEventListener("message",function(e){if(e.source!==frame.contentWindow)return;var m=e.data;if(!m)return;
 if(m.__harness){
  if(m.__harness==="setWidgetState"){H.widgetState=m.payload;L("widget setWidgetState "+JSON.stringify(m.payload).slice(0,160));setGlobals({widgetState:m.payload},"widgetState")}
  if(m.__harness==="intrinsicHeight"){L("widget notifyIntrinsicHeight "+m.payload)}
  if(m.__harness==="openExternal"){H.opened.push(m.payload.href);L("openExternal "+m.payload.href)}
  if(m.__harness==="callTool"){H.calls.push({via:"window.openai.callTool",name:m.payload.name,arguments:m.payload.arguments,at:Date.now()});L("window.openai.callTool "+m.payload.name+" "+JSON.stringify(m.payload.arguments).slice(0,200));
   rpc("tools/call",m.payload).then(function(r){post({__harness:"reply",id:m.id,result:r.result,error:r.error&&r.error.message})})}
  return}
 if(m.jsonrpc!=="2.0")return;
 if(m.method==="ui/initialize"){L("bridge ui/initialize");post({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2026-01-26",hostInfo:{name:"harness",version:"1"},hostCapabilities:{openLinks:{},serverTools:{}},hostContext:{theme:"light",displayMode:"inline",containerDimensions:{maxHeight:H.maxHeight}}}});return}
 if(m.method==="ui/notifications/initialized"){L("bridge initialized → tool-input + tool-result");post({jsonrpc:"2.0",method:"ui/notifications/tool-input",params:{arguments:H.toolInput}});post({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:H.toolResult});return}
 if(m.method==="ui/notifications/size-changed"){var h=Math.min(Math.max(120,m.params.height|0),4000);frame.style.height=h+"px";if(Math.abs(h-H.height)>4){H.height=h;setGlobals({maxHeight:H.maxHeight,safeArea:{insets:{top:0,bottom:0,left:0,right:0}}},"resize")}return}
 if(m.method==="tools/call"){H.calls.push({via:"bridge tools/call",name:m.params.name,arguments:m.params.arguments,at:Date.now()});L("bridge tools/call "+m.params.name+" "+JSON.stringify(m.params.arguments).slice(0,200));
  rpc("tools/call",m.params).then(function(r){post(r.error?{jsonrpc:"2.0",id:m.id,error:r.error}:{jsonrpc:"2.0",id:m.id,result:r.result})});return}
 if(m.method==="ui/open-link"){H.opened.push(m.params.url);L("ui/open-link "+m.params.url);post({jsonrpc:"2.0",id:m.id,result:{}});return}
 if(m.method==="ui/update-model-context"){L("ui/update-model-context "+JSON.stringify(m.params).slice(0,160));post({jsonrpc:"2.0",id:m.id,result:{}});return}
 if(m.id!=null)post({jsonrpc:"2.0",id:m.id,result:{}});
});
window.poke=function(why){setGlobals({theme:"light",displayMode:"inline",maxHeight:H.maxHeight},why||"host layout/theme change")};
window.remount=function(){mount("remount: saved widgetState + original toolOutput")};
Promise.all([rpc("resources/read",{uri:"${WIDGET_URI}"}),rpc("tools/call",{name:"assess_scenario",arguments:ARGS})]).then(function(rs){
 var c=rs[0].result.contents[0];widget={html:c.text,meta:c._meta};H.csp=cspFrom(c._meta);H.toolResult=rs[1].result;H.toolOutput=rs[1].result.structuredContent;L("CSP "+H.csp);mount("first render")});
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url || "/", ORIGIN);
  try {
    if (req.method === "POST" && url.pathname === "/mcp") {
      let raw = ""; for await (const ch of req) raw += ch;
      const out = await mcp(JSON.parse(raw));
      res.writeHead(out.status, { "content-type": "application/json" }); res.end(out.body == null ? "" : JSON.stringify(out.body)); return;
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (url.pathname === "/host") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(HOST); return; }
    const t = url.pathname.match(/^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)(\.png)?$/);
    if (t && tileRoute) {
      const r = await tileRoute.GET(new Request(url.toString(), { headers: { "x-forwarded-for": "127.0.0.1" } }), { params: Promise.resolve({ z: t[1], x: t[2], y: t[3] + (t[4] || "") }) });
      res.writeHead(r.status, Object.fromEntries(r.headers.entries())); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    res.writeHead(404); res.end("not found");
  } catch (e) { log.push(String(e)); res.writeHead(500); res.end(String((e as Error).message)); }
}).listen(PORT, () => console.log(`harness on ${ORIGIN}/host?w=760  (meta: ${JSON.stringify(Object.keys(widgetResourceMeta(ORIGIN)))})`));
