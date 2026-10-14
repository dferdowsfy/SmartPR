// SmartPR MCP Apps widget (text/html;profile=mcp-app), v6.
//
// Self-contained: inline CSS/JS (incl. vendored Leaflet), no external
// scripts, styles, fonts or fetch/XHR. The only remote loads are basemap
// tile IMAGES from SmartPR's own tile proxy (<portal>/api/tiles/…), declared
// in the resource CSP (resource_domains). If tiles don't load within ~3 s
// (CSP blocked, offline), the map switches to the inline-SVG municipio
// outlines (prMapShapes.ts) — the card never depends on the network.
//
// State model (v6 — see docs/chatgpt-mcp-assessment.md "Widget state"):
//  - Results only move FORWARD: a result is applied only when it is newer
//    (versions.generated_at) than the one on screen. v5 re-applied the
//    ORIGINAL window.openai.toolOutput on every openai:set_globals event
//    (fired for maxHeight/theme/displayMode/widgetState changes), which
//    wiped a just-dropped pin, the dropdown answers and refined results.
//  - Drafts (unsent answers) and the pin live outside the result and
//    survive re-renders; they are persisted with window.openai.setWidgetState
//    and restored (re-running refine_scenario) when ChatGPT remounts.
//  - The Leaflet map is created once and re-attached on every render, so a
//    render never destroys the map, the marker or an in-progress drag.
// Renders only from tool results (bridge ui/notifications/tool-result or
// window.openai.toolOutput). All tool data goes through textContent.

import { PR_MUNICIPIO_SHAPES, PR_MAP_SOURCE } from "./prMapShapes";
import { LEAFLET_CSS, LEAFLET_JS } from "./vendor/leaflet.generated";
import { tileTemplates } from "./tiles";
import { PORTAL_DEFAULT } from "./portalUrl";

// Canonical URI is v12 (embedded signup form; password via direct fetch).
// v8 rather than v7: ChatGPT caches templates (and their CSP) per URI, so every
// production, and ChatGPT caches templates (and their CSP) per URI, so the
// tile-enabled widget needs a URI ChatGPT has never fetched.
// ChatGPT may still request older template_pointer URIs (v1–v6) from a cached
// connector; serve the same HTML for every alias so a bump never 404s.
export const WIDGET_URI = "ui://smartpr/requirements-v12.html";
export const WIDGET_URI_ALIASES = [
  "ui://smartpr/requirements-v1.html",
  "ui://smartpr/requirements-v2.html",
  "ui://smartpr/requirements-v3.html",
  "ui://smartpr/requirements-v4.html",
  "ui://smartpr/requirements-v5.html",
  "ui://smartpr/requirements-v6.html",
  "ui://smartpr/requirements-v7.html",
  "ui://smartpr/requirements-v8.html",
  "ui://smartpr/requirements-v9.html",
  "ui://smartpr/requirements-v10.html",
  "ui://smartpr/requirements-v11.html",
  WIDGET_URI,
] as const;
/** Basemap zoom range (tiles). The SVG fallback caps at 14 (1:500k outlines). */
export const MAP_MIN_ZOOM = 7;
export const MAP_MAX_ZOOM = 19;
export const SVG_MAP_MAX_ZOOM = 14;
/** Tiles must load within this long or the SVG municipio map takes over. */
export const TILE_TIMEOUT_MS = 3000;
export const WIDGET_MIME = "text/html;profile=mcp-app";

const CSS = `
:root{--teal:#0f766e;--teal2:#115e59;--tealbg:#e6f4f1;--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--bg:#fff;--soft:#f8fafc;--amber:#d97706}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{padding:20px 22px;max-width:920px}.hdr{display:flex;align-items:center;gap:10px}.brand b{display:block;font-size:20px;color:var(--teal2)}.brand span{color:var(--mut);font-size:12px}
.pill{margin-left:auto;background:var(--tealbg);color:var(--teal2);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
h1{font-size:22px;margin:16px 0 2px}.sub{color:var(--mut);margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.chip{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:6px 12px;font-weight:500}
.chip.unk{border-style:dashed;color:var(--mut)}
.reqs{max-height:560px;overflow-y:auto;overscroll-behavior:contain}.ans{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}.ans .a{border:1px solid var(--line);background:var(--tealbg);border-radius:10px;padding:8px 12px}.ans .a b{display:block;font-size:11px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.05em}.ans .a span{font-weight:600;color:var(--teal2)}
.card{border:1px solid var(--line);border-radius:12px;padding:14px}.card h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.badge{margin-left:auto;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--tealbg);color:var(--teal2)}
.grp{border-top:1px solid var(--line)}.grp:first-of-type{border-top:0}.grow{display:flex;gap:10px;align-items:center;padding:10px 0;cursor:pointer;width:100%;background:none;border:0;text-align:left;font:inherit;color:inherit}
.num{width:28px;height:28px;border-radius:50%;background:var(--tealbg);color:var(--teal2);display:grid;place-items:center;font-weight:700;flex:none}
.gt b{display:block}.gt span{color:var(--mut);font-size:12px}.tag{margin-left:auto;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap}
.supported{background:#dcfce7;color:#166534}.conditional{background:#e0e7ff;color:#3730a3}.unresolved{background:#fef3c7;color:#92400e}
.items{padding:0 0 8px 38px;display:none}.grp.open>.items{display:block}.it{padding:8px 0;border-top:1px dashed var(--line)}.it b{font-weight:600}.it .meta{color:var(--mut);font-size:12px}
.it ul{margin:4px 0 0 16px;padding:0;font-size:12px}.it a{color:var(--teal)}
.lock{display:flex;gap:10px;align-items:center;background:var(--soft);border-radius:10px;padding:10px;margin-top:8px;color:var(--mut)}
label{display:block;font-weight:600;font-size:13px;margin:10px 0 4px}select,input{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
.btn{display:inline-block;border-radius:8px;padding:9px 14px;cursor:pointer;font:inherit;font-weight:600;touch-action:manipulation}.btn.p{background:var(--teal);color:#fff;border:1px solid var(--teal)}.btn.o{background:#fff;color:var(--teal2);border:1px solid var(--teal)}
.btn[disabled]{opacity:.55;cursor:default}.full{width:100%;margin-top:12px}.hint{color:var(--mut);font-size:12px;margin-top:6px}
.cta{margin-top:12px;background:var(--tealbg);border:1px solid #b7e1da;border-radius:12px;padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cta.signup{background:#0f172a;border-color:#0f172a;color:#fff;display:block}.cta.signup b{color:#fff}.cta.signup span{color:#cbd5e1}.cta.signup>div{flex:1 1 220px}.cta.signup .btn{flex:1 1 200px;text-align:center}.cta div{flex:1;min-width:220px}.cta b{display:block}
.signup-fields{display:grid;gap:10px;margin:12px 0}.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:480px){.row2{grid-template-columns:1fr}}.field label{display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:4px}.field label em{font-weight:400;color:#94a3b8;font-style:normal}.field input{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;color:#fff;border-radius:8px;padding:10px 12px;font-size:14px}.field input:focus{outline:none;border-color:#2dd4bf}.field input::placeholder{color:#64748b}.terms{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#cbd5e1}.terms input{margin-top:2px;accent-color:#2dd4bf}.terms a{color:#2dd4bf}.signup-err{background:#7f1d1d;border:1px solid #ef4444;color:#fecaca;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:10px}.signup-ok{background:#064e3b;border:1px solid #10b981;color:#a7f3d0;border-radius:8px;padding:12px;font-size:14px;margin-top:10px}
.cont{display:flex;gap:8px;align-items:flex-start;padding:12px 4px 0;background:none;border:0;cursor:pointer;font:inherit;text-align:left;color:inherit}.cont b{color:var(--ink)}
.note{border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px}.note.warn{background:#fffbeb;border:1px solid #fde68a}.note.err{background:#fef2f2;border:1px solid #fecaca}.note.info{background:var(--soft);border:1px solid var(--line)}
.foot{color:var(--mut);font-size:11px;margin-top:12px}.sk{background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200%;animation:s 1.2s infinite;border-radius:8px;height:14px;margin:10px 0}@keyframes s{to{background-position:-200% 0}}
.loc-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:12px;margin:0 0 12px}@media(max-width:640px){.loc-grid{grid-template-columns:1fr}}
.mapc{margin:0 0 12px;display:block}.loc-grid .mapc{margin:0}.mapc h2{font-size:16px;margin:0 0 4px}
.map{position:relative;height:280px;width:100%;overflow:hidden;border-radius:10px;border:1px solid var(--line);background:#e8eef3;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.map.outline{background:#cfe6f2}.map>.lf{width:100%;height:100%}
@media(max-width:640px){.map{height:240px}.wrap{padding:14px 12px}h1{font-size:18px;margin:12px 0 2px}}
.map .leaflet-container{background:transparent;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;cursor:crosshair}
.map .leaflet-control-attribution{font-size:9.5px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,.82)}
.map .leaflet-control-zoom a{width:32px;height:32px;line-height:30px;font-size:18px;color:var(--ink)}
.map .leaflet-touch .leaflet-control-zoom a,.map .leaflet-touch.leaflet-container .leaflet-control-zoom a{width:34px;height:34px;line-height:32px}
.spr-pin{background:none;border:0}.spr-pin svg{display:block;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));transition:transform .12s}.spr-pin.leaflet-drag-target svg,.spr-pin.dragging svg{transform:translateY(-6px) scale(1.08)}
.spr-pin.approx svg{opacity:.95}
.leaflet-tooltip.spr-tip{font-weight:600;font-size:12px;color:var(--ink);border-radius:8px;border:1px solid var(--line);box-shadow:0 2px 8px rgba(15,23,42,.12);padding:5px 9px;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.leaflet-tooltip.spr-tip.approx{color:#92400e}
.mlabel{font:600 10px/1 ui-sans-serif,system-ui,sans-serif;color:#475569;text-shadow:0 0 3px #f7f5ef,0 0 3px #f7f5ef,0 0 2px #f7f5ef;white-space:nowrap;text-align:center;pointer-events:none}
.lt{position:absolute;left:8px;top:8px;z-index:800;display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.lt button{border:0;background:#fff;padding:6px 10px;font:600 12px/1 system-ui;color:var(--mut);cursor:pointer;touch-action:manipulation}.lt button.on{background:var(--tealbg);color:var(--teal2)}
.map .tip{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);z-index:800;background:rgba(15,23,42,.82);color:#fff;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:600;pointer-events:none;white-space:nowrap}
.map .vm{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block}
.map .vm .m{fill:#f7f5ef;stroke:#9aa8b8;stroke-width:.8;fill-rule:evenodd;stroke-linejoin:round}.map .vm .m.on{fill:#d5efe9;stroke:#0f766e;stroke-width:1.6}
.map .vm text{font:600 10px/1 ui-sans-serif,system-ui,sans-serif;fill:#475569;text-anchor:middle;paint-order:stroke;stroke:#f7f5ef;stroke-width:3px;stroke-linejoin:round}
.map .spin{position:absolute;width:32px;height:42px;margin:-41px 0 0 -16px;z-index:3;touch-action:none;cursor:grab}
.map .zc{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;z-index:4}.map .zc button{width:34px;height:34px;border-radius:6px;border:1px solid var(--line);background:#fff;font:600 16px/1 system-ui;cursor:pointer;color:var(--ink);touch-action:manipulation}
.map .attr{position:absolute;right:0;bottom:0;background:rgba(255,255,255,.8);font-size:10px;padding:1px 5px;color:#334155;z-index:4}
.maphint{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--mut)}
.loc-panel h2{font-size:16px;margin:0 0 8px}
.pill-ok,.pill-approx,.pill-wait{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
.pill-ok{background:#dcfce7;color:#166534}.pill-approx{background:#fef3c7;color:#92400e}.pill-wait{background:#e0f2fe;color:#075985}
.loc-name{font-size:15px;font-weight:600;margin:8px 0 2px;overflow-wrap:anywhere}.loc-zip{color:var(--mut);font-size:12px;margin:0 0 8px}
.loc-meta{display:grid;gap:7px;margin:8px 0 0;padding:0}.loc-meta>div{display:grid;grid-template-columns:96px 1fr;gap:4px 10px;align-items:baseline}
.loc-meta dt{margin:0;font-size:12px;color:var(--mut);font-weight:500}.loc-meta dd{margin:0;font-size:13px;font-weight:500;overflow-wrap:anywhere}
.risk-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.risk-chip{border:1px solid #b7e1da;background:var(--tealbg);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;color:var(--teal2)}
.risk-chip.unk{border:1px dashed var(--line);background:var(--soft);color:var(--mut);font-weight:500}.risk-chip.skel{width:96px;height:24px;border:0;background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200%;animation:s 1.2s infinite}
.cta-loc{margin-top:12px}.src{color:var(--mut);font-size:10.5px;margin-top:6px}
.muni-or{color:var(--mut);font-size:12px;margin:4px 0 4px}
`;

const JS = String.raw`
(function(){
var CFG=__CFG__;
var root=document.getElementById("root"),pending={},nextId=1,lastSizeH=0,callSeq=0,lastTO=null,restored=false,lastPersist="";
var state={result:null,resultAt:0,input:null,answers:{},busy:false,siteBusy:false,error:null,note:null,lastAction:null,pin:null,confirmed:null,details:null,signup:{},signupBusy:false,signupError:null,signupDone:false,signupEmail:null};
var DBG=window.__smartpr={events:[],mode:null,tiles:{loaded:0,errors:0},state:state};
function trace(s){DBG.events.push(s);if(DBG.events.length>300)DBG.events.shift()}
function post(m){try{window.parent.postMessage(m,"*")}catch(_){}}
function request(method,params,ms){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},ms||20000)})}
function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
function reportSize(){var h=Math.ceil((root&&root.scrollHeight)||document.documentElement.scrollHeight||0);if(h<120)return;if(Math.abs(h-lastSizeH)<8)return;lastSizeH=h;notify("ui/notifications/size-changed",{height:h});try{var o=window.openai;if(o&&typeof o.notifyIntrinsicHeight==="function")o.notifyIntrinsicHeight(h)}catch(_){}}
window.addEventListener("message",function(e){if(e.source!==window.parent)return;var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending[m.id]&&!m.method){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
 if(m.method==="ui/notifications/tool-input"){state.input=(m.params&&m.params.arguments)||m.params;if(!state.result)render()}
 if(m.method==="ui/notifications/tool-result"){accept(m.params,"bridge")}
 if(m.method==="ui/notifications/tool-cancelled"){if(!state.result){state.error="The request was cancelled.";render()}}
},{passive:true});
function unwrap(r){if(!r||typeof r!=="object")return null;var sc=r.structuredContent||r;if(sc&&sc.structuredContent)sc=sc.structuredContent;if(sc&&sc.result&&sc.result.structuredContent)sc=sc.result.structuredContent;if(sc&&sc.result&&sc.result.scenario)sc=sc.result;return sc&&sc.scenario&&sc.versions?sc:null}
function rTime(sc){var t=Date.parse((sc&&sc.versions&&sc.versions.generated_at)||"");return isFinite(t)?t:0}
function siteOf(sc){var s=sc&&sc.scenario&&sc.scenario.site;return s&&s.latitude!=null&&s.longitude!=null&&isFinite(+s.latitude)&&isFinite(+s.longitude)?s:null}
function fold(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim()}
function r6(v){return Math.round(v*1e6)/1e6}
function txt(r){try{return(r.content||[]).map(function(c){return c.text||""}).join(" ").slice(0,300)}catch(_){return""}}
function drafts(){var a={};for(var k in state.answers)if(state.answers[k]!==""&&state.answers[k]!=null)a[k]=state.answers[k];return a}
// Forward-only: a result is applied only if it is newer than what is on screen
// (widget-initiated calls always are). Re-deliveries of the original
// toolOutput (openai:set_globals, duplicate tool-result) are ignored.
function accept(r,src){if(!r)return false;
 if(r.isError){if(src==="call"){state.error=txt(r)||"SmartPR could not complete the request.";state.busy=false;state.siteBusy=false;render()}return false}
 var sc=unwrap(r);if(!sc)return false;var t=rTime(sc);
 if(src!=="call"&&state.result&&t<=state.resultAt){trace("ignored stale "+src+" result");return false}
 var site=siteOf(sc),dropped=(sc.dropped_answers||[]).indexOf("site")>=0,c=state.confirmed;
 // Sticky pin: a later result without a site (e.g. ChatGPT re-ran assess with the
 // municipality only) keeps the pinned site in the same municipality.
 if(!site&&!dropped&&c&&src!=="remove"&&sc.scenario&&sc.scenario.municipality&&fold(sc.scenario.municipality)===fold(c.municipality)){sc.scenario.site=c;site=c;if(!sc.site_details&&state.details)sc.site_details=state.details}
 state.result=sc;state.resultAt=Math.max(t,state.resultAt);state.busy=false;state.siteBusy=false;state.error=null;
 if(site){state.confirmed=site;state.details=sc.site_details||null;state.pin={lat:+site.latitude,lng:+site.longitude,approx:false}}
 else{state.confirmed=null;state.details=null;var ap=sc.approximate_site;state.pin=ap&&isFinite(+ap.latitude)?{lat:+ap.latitude,lng:+ap.longitude,approx:true}:null}
 var ids=(sc.clarifying_questions||[]).map(function(q){return q.id});for(var k in state.answers)if(ids.indexOf(k)<0)delete state.answers[k];
 trace("applied "+src+" result"+(site?" site="+site.latitude+","+site.longitude:state.pin?" approx-pin":""));
 render();if(!restored){restored=true;restore()}persist();if(state.details&&state.details.pending)schedulePoll();return true}
// Official-map lookups still running server-side: ask again shortly (same pin only).
var pollKey=null,pollN=0;
function schedulePoll(){var c=state.confirmed;if(!c)return;var k=c.latitude+","+c.longitude;if(pollKey!==k){pollKey=k;pollN=0}if(pollN>=3)return;pollN++;
 setTimeout(function(){var c2=state.confirmed;if(!c2||c2.latitude+","+c2.longitude!==k||state.busy||state.siteBusy)return;var my=++callSeq;trace("polling site details");
  callTool("refine_scenario",{scenario:scenarioPayload()}).then(function(res){if(my===callSeq&&res&&!res.isError)accept(res,"call")}).catch(function(){})},2200)}
function scenarioPayload(){var r=state.result;if(!r||!r.scenario)return null;var s=r.scenario,out={};for(var k in s)out[k]=s[k];var c=state.confirmed;if(c&&(!out.site||out.site.latitude==null))out.site={latitude:+c.latitude,longitude:+c.longitude};return out}
function persist(){var o=window.openai;if(!o||typeof o.setWidgetState!=="function"||!state.result)return;
 // Never overwrite a newer snapshot (remount: the original toolOutput is applied first, then restored).
 var cur=o.widgetState;if(cur&&cur.v===6&&(Date.parse(cur.at||"")||0)>state.resultAt)return;
 var ws={v:6,at:state.result.versions.generated_at,scenario:scenarioPayload(),pin:state.pin,answers:drafts()};var j=JSON.stringify(ws);if(j===lastPersist)return;lastPersist=j;try{o.setWidgetState(ws)}catch(_){}}
// ChatGPT remounted the widget (scroll, display mode, reload): window.openai
// still has the ORIGINAL toolOutput; widgetState has what the user did since.
function restore(){var o=window.openai,ws=o&&o.widgetState;if(!ws||ws.v!==6||!ws.scenario||!state.result)return;
 var a=ws.answers||{};for(var k in a)if(state.answers[k]==null)state.answers[k]=a[k];
 if((Date.parse(ws.at||"")||0)<=state.resultAt){render();return}
 trace("restoring widgetState from "+ws.at);if(ws.pin&&!ws.pin.approx)state.pin=ws.pin;state.siteBusy=!!(ws.pin&&!ws.pin.approx);render();
 var my=++callSeq;callTool("refine_scenario",{scenario:ws.scenario}).then(function(res){if(my!==callSeq)return;if(res&&!res.isError)accept(res,"call");else{state.siteBusy=false;render()}}).catch(function(){if(my===callSeq){state.siteBusy=false;render()}})}
function callTool(name,args){var o=window.openai;
 // window.openai.callTool is ChatGPT's native path; the MCP Apps bridge is the
 // standard fallback for other hosts.
 if(o&&typeof o.callTool==="function"){trace("callTool via window.openai "+name);return Promise.resolve().then(function(){return o.callTool(name,args)}).catch(function(e){trace("window.openai.callTool failed ("+(e&&e.message)+") → bridge");return request("tools/call",{name:name,arguments:args},30000)})}
 trace("callTool via bridge "+name);return request("tools/call",{name:name,arguments:args},30000)}
function modelContext(text){request("ui/update-model-context",{content:[{type:"text",text:text}]},5000).catch(function(){})}
function openLink(url){var o=window.openai;if(o&&typeof o.openExternal==="function"){try{o.openExternal({href:url});return}catch(_){}}request("ui/open-link",{url:url},8000).catch(function(){window.open(url,"_blank","noopener")})}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n}
function add(p){for(var i=1;i<arguments.length;i++)if(arguments[i])p.appendChild(arguments[i]);return p}
var TAG={supported:"Supported",conditional:"Conditional",unresolved:"Needs details"};
var GDESC={"Business registrations":"Entity, tax and employer registrations.","Construction & site authorization":"Renovation scope may trigger permits and professional plans.","Operating permits":"Depend on the activity and premises."};
function header(){var h=el("div","hdr");var logo=document.createElementNS("http://www.w3.org/2000/svg","svg");logo.setAttribute("width","34");logo.setAttribute("height","34");logo.setAttribute("viewBox","0 0 24 24");logo.innerHTML='<path fill="#0f766e" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>';
 var b=el("div","brand");add(b,el("b",null,"SmartPR"),el("span",null,"Puerto Rico regulatory intelligence"));return add(h,logo,b,el("span","pill","Free preview"))}
function act(kind){if(state.busy)return;state.lastAction=kind;state.note=null;var r=state.result;if(!r)return;
 if(kind==="refine"){var ans=drafts();if(!Object.keys(ans).length){state.note="Choose an answer above, then Update preview.";render();return}
  state.busy=true;state.error=null;render();var my=++callSeq;
  callTool("refine_scenario",{scenario:scenarioPayload()||r.scenario,answers:ans}).then(function(res){if(my!==callSeq)return;if(res&&!res.isError){for(var k in ans)delete state.answers[k];accept(res,"call");var n=state.result;modelContext("User refined the SmartPR scenario in the widget (answers: "+JSON.stringify(ans)+"). "+(n&&n.message||""))}else{state.busy=false;state.error=txt(res)||"Could not update the preview.";render()}}).catch(function(){if(my!==callSeq)return;state.busy=false;state.error="Could not reach SmartPR. Check your connection and retry.";render()})}
 else{state.busy=true;state.error=null;render();
  // Always the CURRENT scenario: pinned site + applied answers, plus any
  // dropdown answers not yet sent with Update preview.
  // Signup routes through /signup?next=<handoff path> so the scenario survives
  // account creation and lands in the new user's intake (token TTL covers it).
  var intent=kind==="signup"?"continue":kind;
  callTool("create_portal_handoff",{scenario:scenarioPayload()||r.scenario,intent:intent,answers:drafts()}).then(function(res){state.busy=false;var sc=res&&(res.structuredContent||(res.result&&res.result.structuredContent));var u=sc&&sc.url;if(u){trace("handoff "+kind+" carried "+JSON.stringify(sc.carried||{}));if(kind==="signup"){var path=String(u).replace(/^https?:\/\/[^/]+/,"");openLink(CFG.origin+"/signup?next="+encodeURIComponent(path))}else openLink(u)}else{state.error=txt(res)||"Could not create a SmartPR link."}render()}).catch(function(){state.busy=false;state.error="Could not reach SmartPR. Retry.";render()})}}
// Pin dropped (tap) or dragged: show it immediately, then resolve it server-side.
function movePin(lat,lng,how){if(!state.result||!isFinite(lat)||!isFinite(lng))return;lat=r6(lat);lng=r6(lng);
 var prev={pin:state.pin,confirmed:state.confirmed,details:state.details};state.pin={lat:lat,lng:lng,approx:false};state.siteBusy=true;state.error=null;state.note=null;state.lastAction="pin";
 if(MAP)MAP.centered=lat+","+lng;trace("pin "+how+" "+lat+","+lng);render();
 var my=++callSeq;
 callTool("refine_scenario",{scenario:scenarioPayload()||state.result.scenario,site:{latitude:lat,longitude:lng},answers:drafts()}).then(function(res){if(my!==callSeq)return;
  if(res&&!res.isError){var sc=unwrap(res)||{};var dropped=(sc.dropped_answers||[]).indexOf("site")>=0;
   if(dropped){state.pin=prev.pin;state.confirmed=prev.confirmed;state.details=prev.details;state.siteBusy=false;state.error="That point is outside Puerto Rico. Drop the pin on the property in Puerto Rico.";render();return}
   var sent=drafts();for(var k in sent)delete state.answers[k];accept(res,"call");var st=state.confirmed,d=state.details;
   if(st)modelContext("User pinned the site on the SmartPR map: "+(d&&d.street?d.street+", ":"")+(st.barrio?st.barrio+", ":"")+st.municipality+" ("+st.latitude+", "+st.longitude+"). Keep scenario.site {latitude, longitude} on every later assess_scenario/refine_scenario/create_portal_handoff call.")}
  else{state.pin=prev.pin;state.confirmed=prev.confirmed;state.details=prev.details;state.siteBusy=false;state.error=txt(res)||"Could not use that location.";render()}})
 .catch(function(){if(my!==callSeq)return;state.pin=prev.pin;state.confirmed=prev.confirmed;state.details=prev.details;state.siteBusy=false;state.error="Could not reach SmartPR. Check your connection and retry.";render()})}
// ---------------------------------------------------------------- map ----
var SHAPES=__MAP_SHAPES__,TS=256,SVG_ZMAX=__SVGZMAX__,BX={s:17.55,n:18.9,w:-68.4,e:-64.85},MUNIS=null,SVGNS="http://www.w3.org/2000/svg",MAP=null;
function decodeLL(str){var pts=[],i=0,lat=0,lng=0,n=str.length;while(i<n){var r=0,sh=0,b;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32&&i<n);lat+=(r&1)?~(r>>1):(r>>1);r=0;sh=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32&&i<n);lng+=(r&1)?~(r>>1):(r>>1);pts.push([lat/1e4,lng/1e4])}return pts}
function wsz(z){return TS*Math.pow(2,z)}
function px(lng,z){return (lng+180)/360*wsz(z)}
function py(lat,z){var r=lat*Math.PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*wsz(z)}
function unx(x,z){return x/wsz(z)*360-180}
function uny(y,z){var n=Math.PI-2*Math.PI*y/wsz(z);return 180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)))}
function munis(){if(MUNIS)return MUNIS;MUNIS=[];for(var k=0;k<SHAPES.length;k++){var sh=SHAPES[k],rings=sh[3].split(" ").map(decodeLL),bb=[1e9,1e9,-1e9,-1e9];
 rings.forEach(function(r){r.forEach(function(p){var x=px(p[1],0),y=py(p[0],0);if(x<bb[0])bb[0]=x;if(x>bb[2])bb[2]=x;if(y<bb[1])bb[1]=y;if(y>bb[3])bb[3]=y})});
 MUNIS.push({n:sh[0],f:fold(sh[0]),lng:sh[1],lat:sh[2],rings:rings,bb:bb})}return MUNIS}
function pinHtml(color,approx){return '<svg viewBox="0 0 32 42" width="32" height="42" xmlns="http://www.w3.org/2000/svg"><path fill="'+color+'" stroke="#fff" stroke-width="2" '+(approx?'stroke-dasharray="3 2" ':'')+'d="M16 2C8.8 2 3 7.7 3 14.8 3 24.5 16 40 16 40s13-15.5 13-25.2C29 7.7 23.2 2 16 2z"/><circle cx="16" cy="14.8" r="5" fill="#fff"/>'+(approx?'<text x="16" y="18.6" text-anchor="middle" font-size="10" font-weight="700" fill="'+color+'" font-family="system-ui">\u2248</text>':'')+'</svg>'}
function pinColor(p){return p&&p.approx?"#d97706":"#0f766e"}
function muniName(){var c=state.confirmed,s=state.result&&state.result.scenario;return (c&&c.municipality)||(s&&s.municipality)||""}
function pinLabel(){var p=state.pin;if(!p)return"";if(state.siteBusy)return"Checking this location\u2026";if(p.approx)return"Downtown "+muniName()+" \u00b7 approximate";var c=state.confirmed,d=state.details;if(!c)return"";return (d&&d.street?d.street+", ":"")+(c.barrio&&c.barrio!==c.municipality?c.barrio+", ":"")+c.municipality}
function ensureMap(){if(MAP)return MAP;var wrap=el("div","map");MAP={wrap:wrap,mode:null,centered:null};
 if(window.L&&window.L.map){try{leafletInit(MAP)}catch(e){trace("leaflet init failed: "+(e&&e.message));wrap.textContent="";MAP.map=null;svgInit(MAP)}}else svgInit(MAP);return MAP}
function leafletInit(M){var L=window.L,inner=el("div","lf");M.wrap.appendChild(inner);M.mode="tiles";DBG.mode="tiles";
 var map=L.map(inner,{zoomControl:false,attributionControl:true,minZoom:CFG.minZoom,maxZoom:CFG.maxZoom,maxBounds:[[17.2,-68.8],[19.2,-64.5]],maxBoundsViscosity:.9,scrollWheelZoom:false,doubleClickZoom:true,tapTolerance:15,zoomSnap:1,inertia:true,fadeAnimation:true});
 M.map=map;map.attributionControl.setPrefix(false);L.control.zoom({position:"topright"}).addTo(map);
 var tb=[[17.6,-68.3],[18.75,-65.0]];
 M.streets=L.tileLayer(CFG.tiles.streets,{minZoom:CFG.minZoom,maxZoom:CFG.maxZoom,maxNativeZoom:CFG.maxZoom,bounds:tb,attribution:CFG.tiles.attribution.streets,keepBuffer:2,updateWhenIdle:false});
 M.sat=L.tileLayer(CFG.tiles.satellite,{minZoom:CFG.minZoom,maxZoom:CFG.maxZoom,maxNativeZoom:CFG.maxZoom,bounds:tb,attribution:CFG.tiles.attribution.satellite,keepBuffer:2});
 function watch(layer){layer.on("tileload",function(){DBG.tiles.loaded++;if(!M.tilesOk){M.tilesOk=true;clearTimeout(M.wd);trace("tiles loading OK")}});layer.on("tileerror",function(){DBG.tiles.errors++;if(!M.tilesOk&&DBG.tiles.errors>=6)toOutline("tile errors")})}
 watch(M.streets);watch(M.sat);M.streets.addTo(map);M.base="streets";
 var lt=el("div","lt"),b1=el("button","on","Map"),b2=el("button",null,"Satellite");b1.type=b2.type="button";add(lt,b1,b2);M.lt=lt;M.wrap.appendChild(lt);
 function base(which){if(M.mode!=="tiles"||M.base===which)return;map.removeLayer(which==="sat"?M.streets:M.sat);(which==="sat"?M.sat:M.streets).addTo(map);M.base=which;b1.className=which==="sat"?"":"on";b2.className=which==="sat"?"on":""}
 b1.onclick=function(e){e.stopPropagation();base("streets")};b2.onclick=function(e){e.stopPropagation();base("sat")};
 L.DomEvent.disableClickPropagation(lt);
 M.muni=L.layerGroup().addTo(map);
 map.on("click",function(e){if(M.dragging)return;var ll=e.latlng;movePin(ll.lat,ll.lng,"tap");if(map.getZoom()<13)map.setView(ll,15,{animate:true})});
 map.setView([18.22,-66.45],8);
 M.sync=leafletSync;
 M.attach=function(){if(!M.started){M.started=true;M.wd=setTimeout(function(){if(!M.tilesOk)toOutline("no tile loaded within "+CFG.tileTimeoutMs+" ms")},CFG.tileTimeoutMs)}map.invalidateSize(false)};
}
function toOutline(why){var M=MAP;if(!M||M.mode!=="tiles")return;trace("basemap fallback → municipio outlines ("+why+")");var L=window.L,map=M.map;
 clearTimeout(M.wd);map.removeLayer(M.streets);map.removeLayer(M.sat);M.mode="outline";DBG.mode="outline";M.wrap.classList.add("outline");if(M.lt)M.lt.style.display="none";
 var ML=munis(),g=L.layerGroup();ML.forEach(function(mu){L.polygon(mu.rings,{interactive:false,color:"#9aa8b8",weight:.8,fillColor:"#f7f5ef",fillOpacity:1,fillRule:"evenodd",smoothFactor:.5}).addTo(g)});g.addTo(map);M.outline=g;
 M.labels=L.layerGroup();ML.forEach(function(mu){L.marker([mu.lat,mu.lng],{interactive:false,keyboard:false,icon:L.divIcon({className:"mlabel",html:"",iconSize:[90,12],iconAnchor:[45,6]})}).addTo(M.labels)});
 var i=0;M.labels.eachLayer(function(m){var n=ML[i++].n;m.on("add",function(){var e=m.getElement();if(e)e.textContent=n})});
 function lbl(){if(map.getZoom()>=10)M.labels.addTo(map);else map.removeLayer(M.labels)}map.on("zoomend",lbl);lbl();
 map.attributionControl.addAttribution("Boundaries: __MAP_SOURCE__");map.setMaxZoom(SVG_ZMAX+2);
 M.muniKey=null;leafletSync();render()}
function leafletSync(){var M=MAP,L=window.L,map=M.map,p=state.pin;if(!map)return;
 var mk=muniName()+"|"+M.mode;if(M.muniKey!==mk){M.muniKey=mk;M.muni.clearLayers();var f=fold(muniName());if(f){munis().forEach(function(mu){if(mu.f===f)L.polygon(mu.rings,{interactive:false,color:"#0f766e",weight:M.mode==="outline"?1.8:2.2,dashArray:M.mode==="outline"?null:"6 4",fill:M.mode==="outline",fillColor:"#d5efe9",fillOpacity:1,fillRule:"evenodd"}).addTo(M.muni)})}if(M.mode==="outline")M.muni.eachLayer(function(l){l.bringToFront()})}
 if(p){var ic=L.divIcon({className:"spr-pin"+(p.approx?" approx":""),html:pinHtml(pinColor(p),p.approx),iconSize:[32,42],iconAnchor:[16,41],tooltipAnchor:[0,-38]});
  if(!M.marker){M.marker=L.marker([p.lat,p.lng],{draggable:true,autoPan:true,icon:ic,keyboard:true,title:"Drag to the exact site",bubblingMouseEvents:false,zIndexOffset:1000}).addTo(map);
   M.marker.on("dragstart",function(){M.dragging=true;var e=M.marker.getElement();if(e)e.classList.add("dragging")});
   M.marker.on("dragend",function(){var e=M.marker.getElement();if(e)e.classList.remove("dragging");setTimeout(function(){M.dragging=false},0);var ll=M.marker.getLatLng();movePin(ll.lat,ll.lng,"drag")});
   M.marker.bindTooltip("",{permanent:true,direction:"top",className:"spr-tip",offset:[0,0]});M.iconKey=null}
  else if(!M.dragging)M.marker.setLatLng([p.lat,p.lng]);
  var key=(p.approx?"a":"c");if(M.iconKey!==key){M.iconKey=key;M.marker.setIcon(ic)}
  var tt=M.marker.getTooltip();if(tt){tt.setContent(pinLabel());var te=tt.getElement&&tt.getElement();if(te)te.className=te.className.replace(/ ?approx/g,"")+(p.approx?" approx":"")}
  var ck=p.lat+","+p.lng;if(M.centered!==ck&&!M.dragging){M.centered=ck;map.setView([p.lat,p.lng],Math.max(map.getZoom(),p.approx?14:16),{animate:false})}}
 else{if(M.marker){map.removeLayer(M.marker);M.marker=null}var ck2="none";if(M.centered!==ck2){M.centered=ck2;var narrow=(M.wrap.clientWidth||400)<540;map.setView([18.22,-66.45],narrow?7:8,{animate:false})}}
 M.wrap.classList.toggle("has-pin",!!p);
 var tip=M.wrap.querySelector(".tip");if(!p&&!tip)M.wrap.appendChild(el("div","tip","Tap the map to drop a pin"));else if(p&&tip)tip.remove()}
// Inline-SVG municipio map: used only when Leaflet itself can't run. Same
// interactions: tap drops/moves the pin, the pin drags (mouse + touch).
function svgInit(M){var wrap=M.wrap;M.mode="svg";DBG.mode="svg";wrap.classList.add("outline");var v={lat:18.22,lng:-66.45,z:8};M.v=v;
 var svg=document.createElementNS(SVGNS,"svg");svg.setAttribute("class","vm");svg.setAttribute("aria-hidden","true");var gP=document.createElementNS(SVGNS,"g"),gL=document.createElementNS(SVGNS,"g");svg.appendChild(gP);svg.appendChild(gL);
 var ML=munis(),paths=[],labels=[];ML.forEach(function(mu){var p=document.createElementNS(SVGNS,"path");p.setAttribute("class","m");gP.appendChild(p);paths.push(p);var t=document.createElementNS(SVGNS,"text");t.textContent=mu.n;gL.appendChild(t);labels.push(t)});
 var pin=el("div","spin");var zc=el("div","zc"),zi=el("button",null,"+"),zo=el("button",null,"\u2212");zi.type=zo.type="button";zi.setAttribute("aria-label","Zoom in");zo.setAttribute("aria-label","Zoom out");add(zc,zi,zo);
 add(wrap,svg,pin,zc,el("div","attr","Boundaries: __MAP_SOURCE__"));
 function size(){return{W:wrap.clientWidth||320,H:wrap.clientHeight||240}}
 function clamp(){v.z=Math.max(CFG.minZoom,Math.min(SVG_ZMAX,Math.round(v.z)));v.lat=Math.max(BX.s,Math.min(BX.n,v.lat));v.lng=Math.max(BX.w,Math.min(BX.e,v.lng))}
 function draw(){var sz=size(),W=sz.W,H=sz.H,cx=px(v.lng,v.z),cy=py(v.lat,v.z),x0=cx-W/2,y0=cy-H/2,k=Math.pow(2,v.z),f=fold(muniName());
  svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("width",W);svg.setAttribute("height",H);
  for(var a=0;a<ML.length;a++){var mu=ML[a],b=mu.bb,vis=!(b[2]*k<x0-2||b[0]*k>x0+W+2||b[3]*k<y0-2||b[1]*k>y0+H+2),d="";
   if(vis){for(var q=0;q<mu.rings.length;q++){var r=mu.rings[q];if(r.length<3)continue;d+="M";for(var i=0;i<r.length;i++){d+=(i?"L":"")+(Math.round((px(r[i][1],v.z)-x0)*10)/10)+" "+(Math.round((py(r[i][0],v.z)-y0)*10)/10)}d+="Z"}}
   paths[a].setAttribute("d",d||"M0 0");paths[a].setAttribute("class","m"+(f&&mu.f===f?" on":""));var t=labels[a],lx=px(mu.lng,v.z)-x0,ly=py(mu.lat,v.z)-y0;if(v.z>=10&&lx>-40&&lx<W+40&&ly>-10&&ly<H+10){t.setAttribute("x",Math.round(lx));t.setAttribute("y",Math.round(ly));t.style.display=""}else t.style.display="none"}
  var p=M.temp||state.pin;if(p){pin.style.display="block";pin.style.left=(px(p.lng,v.z)-x0)+"px";pin.style.top=(py(p.lat,v.z)-y0)+"px";var key=p.approx?"a":"c";if(pin.getAttribute("data-k")!==key){pin.setAttribute("data-k",key);pin.innerHTML=pinHtml(pinColor(p),p.approx)}}else pin.style.display="none"}
 function toLL(e){var rc=wrap.getBoundingClientRect(),sz=size();return{lat:uny(py(v.lat,v.z)-sz.H/2+(e.clientY-rc.top),v.z),lng:unx(px(v.lng,v.z)-sz.W/2+(e.clientX-rc.left),v.z)}}
 zi.onclick=function(e){e.stopPropagation();v.z++;clamp();draw()};zo.onclick=function(e){e.stopPropagation();v.z--;clamp();draw()};
 zc.addEventListener("pointerdown",function(e){e.stopPropagation()});
 var pd=null;
 pin.addEventListener("pointerdown",function(e){e.stopPropagation();e.preventDefault();pd={id:e.pointerId,moved:false};M.dragging=true;try{pin.setPointerCapture(e.pointerId)}catch(_){}});
 pin.addEventListener("pointermove",function(e){if(!pd)return;pd.moved=true;var ll=toLL(e);M.temp={lat:ll.lat,lng:ll.lng,approx:false};draw()});
 function pinUp(){if(!pd)return;var d=pd;pd=null;M.dragging=false;var t=M.temp;M.temp=null;if(d.moved&&t)movePin(t.lat,t.lng,"drag");else draw()}
 pin.addEventListener("pointerup",pinUp);pin.addEventListener("pointercancel",pinUp);
 var drag=null;
 wrap.addEventListener("pointerdown",function(e){if(e.pointerType==="mouse"&&e.button!==0)return;drag={x:e.clientX,y:e.clientY,cx:px(v.lng,v.z),cy:py(v.lat,v.z),moved:false};try{wrap.setPointerCapture(e.pointerId)}catch(_){}});
 wrap.addEventListener("pointermove",function(e){if(!drag)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<10)return;drag.moved=true;v.lng=unx(drag.cx-dx,v.z);v.lat=uny(drag.cy-dy,v.z);clamp();draw()});
 wrap.addEventListener("pointerup",function(e){if(!drag)return;var d=drag;drag=null;if(d.moved)return;var ll=toLL(e);if(v.z<11){v.z=12;v.lat=ll.lat;v.lng=ll.lng;clamp()}movePin(ll.lat,ll.lng,"tap")});
 wrap.addEventListener("pointercancel",function(){drag=null});
 M.sync=function(){var p=state.pin,ck=p?p.lat+","+p.lng:"none";if(M.centered!==ck&&!M.dragging){M.centered=ck;if(p){v.lat=p.lat;v.lng=p.lng;v.z=Math.max(v.z,p.approx?11:12)}else{v.lat=18.22;v.lng=-66.45;v.z=size().W<540?7:8}clamp()}draw();
  var tip=wrap.querySelector(".tip");if(!p&&!tip)wrap.appendChild(el("div","tip","Tap the map to drop a pin"));else if(p&&tip)tip.remove()};
 M.attach=function(){draw()};}
function mapCard(r){var M=ensureMap(),p=state.pin,c=state.confirmed;
 var card=el("div","card mapc"),h=el("h2",null,c?"Project location":"Where is the site?");if(c)add(h,el("span","badge","Pinned"));add(card,h);
 add(card,el("p","sub",c?"Drag the pin, or tap the map, to move it to the exact property.":p&&p.approx?"We dropped a pin in downtown "+muniName()+". Drag it (or tap the map) to the exact property.":"Tap the map to drop a pin on the property, then drag it to adjust."));
 add(card,M.wrap);
 var hint=el("div","maphint");if(M.mode==="outline"||M.mode==="svg")add(hint,el("span",null,"Street map unavailable here \u2014 showing municipio outlines. The pin still works."));else if(p)add(hint,el("span",null,"Pinch or use +/\u2212 to zoom \u00b7 Map / Satellite top-left"));add(card,hint);
 return card}
function locPanel(r){var p=state.pin,c=state.confirmed,d=state.details,panel=el("div","card loc-panel");add(panel,el("h2",null,"Project location"));
 if(state.siteBusy)add(panel,el("span","pill-wait","Checking location\u2026"));else if(c)add(panel,el("span","pill-ok","\u2713 Location confirmed"));else add(panel,el("span","pill-approx","Approximate location"));
 var muni=c?c.municipality:muniName();
 var name=c?((d&&d.street)?d.street:((c.barrio&&c.barrio!==c.municipality?c.barrio+", ":"")+c.municipality)):(p&&!p.approx?"Pinned site":"Downtown "+muni);
 add(panel,el("div","loc-name",name));
 if(c)add(panel,el("div","loc-zip",(c.barrio&&c.barrio!==c.municipality?c.barrio+", ":"")+c.municipality+", PR"+(d&&d.postal_code?" "+d.postal_code:"")));
 var meta=el("dl","loc-meta");function row(dt,dd){if(dd==null||dd==="")return;var x=el("div");add(x,el("dt",null,dt),el("dd",null,dd));add(meta,x)}
 row("Municipality",muni);if(c&&c.barrio&&c.barrio!==c.municipality)row("Barrio",c.barrio);
 if(c&&d&&(d.street||d.address))row("Street",d.street||d.address);
 if(c&&d&&d.parcel)row("Parcel",d.parcel);
 if(p)row("Coordinates",p.lat.toFixed(5)+", "+p.lng.toFixed(5)+(p.approx?" (approx.)":""));add(panel,meta);
 if(c){var rc=el("div","risk-chips");
  if(state.siteBusy||(d&&d.pending)){for(var i=0;i<4;i++)add(rc,el("span","risk-chip skel"));add(panel,el("div","hint","Checking zoning, FEMA flood zone, landslide and coastal maps…"))}
  else{var chips=(d&&d.chips&&d.chips.length)?d.chips:[{label:"Zoning",value:null},{label:"FEMA flood",value:null},{label:"Landslide",value:null},{label:"Coastal zone",value:null}];
   // Only answers the official-map lookups actually returned — never inferred.
   chips.forEach(function(ch){var s=el("span","risk-chip"+(ch.value?"":" unk"),ch.label+": "+(ch.value||"See full report"));if(ch.detail)s.title=ch.detail;add(rc,s)})}
  add(panel,rc);if(rc.getAttribute("data-checking"))add(panel,el("div","hint","Checking zoning, FEMA flood zone, landslide and coastal maps\u2026"));
  if(d&&d.address_attribution)add(panel,el("div","src","Street: "+d.address_attribution));
  if(c.near_boundary)add(panel,el("div","note warn","This pin is about "+c.boundary_distance_m+" m from a municipal boundary \u2014 confirm the municipality."))}
 else add(panel,el("div","hint","Drag the pin onto the property to confirm the site and check zoning, FEMA flood zone, landslide and coastal data."));
 var vr=el("button","btn p full cta-loc",state.busy?"Opening\u2026":"View full property report");vr.type="button";vr.disabled=state.busy;vr.onclick=function(){act("continue")};add(panel,vr);
 add(panel,el("div","hint",c?"Opens SmartPR with this pin for parcel, zoning, flood-zone and the full site report.":"Opens SmartPR to pin the exact property and get the full site report."));
 return panel}
 function reqsCard(r){var left=el("div","card reqs");var h2=el("h2",null,"Preliminary requirements");add(h2,el("span","badge",r.counts.total+" identified"));add(left,h2);
 var groups=["Business registrations","Construction & site authorization","Operating permits"],idx=0;
 if(!r.requirements.length)add(left,el("p","sub","No requirements were generated for this scenario yet. Answer the questions to refine."));
 groups.forEach(function(name){var items=r.requirements.filter(function(q){return q.group===name});if(!items.length)return;idx++;
  var worst=items.some(function(q){return q.applicability==="unresolved"})?"unresolved":items.some(function(q){return q.applicability==="conditional"})?"conditional":"supported";
  var grp=el("div","grp open"),row=el("button","grow");row.type="button";row.setAttribute("aria-expanded","true");var gt=el("div","gt");add(gt,el("b",null,name),el("span",null,items.length+" item(s) \u00b7 "+GDESC[name]));
  add(row,el("span","num",idx),gt,el("span","tag "+worst,TAG[worst]));row.onclick=function(){grp.classList.toggle("open");row.setAttribute("aria-expanded",grp.classList.contains("open"));reportSize()};
  var list=el("div","items");items.forEach(function(q){var it=el("div","it");var t=el("div");add(t,el("b",null,q.name+" "),el("span","tag "+q.applicability,TAG[q.applicability]));add(it,t,el("div","meta",q.agency),el("div",null,q.why));
   var ul=el("ul");(q.next_steps||[]).forEach(function(x){add(ul,el("li",null,x))});(q.citations||[]).forEach(function(c){var li=el("li");if(c.url&&/^https:\/\//.test(c.url)){var a=el("a",null,c.label);a.href=c.url;a.target="_blank";a.rel="noopener";a.onclick=function(ev){ev.preventDefault();openLink(c.url)};add(li,el("span",null,"Source: "),a)}else add(li,el("span",null,"Source: "+c.label));add(ul,li)});add(it,ul);add(list,it)});
  add(grp,row,list);add(left,grp)});
 var lk=el("div","lock");add(lk,el("span",null,"\ud83d\udd12"));var lt=el("div");add(lt,el("b",null,"Additional requirements & sequencing"),el("div",null,(r.gated.hidden_requirement_count?r.gated.hidden_requirement_count+" more requirement(s), ":"")+"dependencies and a downloadable report are in the full assessment."));add(lk,lt);add(left,lk);
return left}

function updateCard(r){var box=el("div","card");add(box,el("h2",null,"Your answers"));var aa=r.applied_answers||[];
 if(aa.length){var ans=el("div","ans");aa.forEach(function(a){var d=el("div","a");add(d,el("b",null,a.question),el("span",null,a.answer));add(ans,d)});add(box,ans)}
 else add(box,el("p","sub","Scenario updated with your answers."));
 var sh=el("button","btn o full","Show full assessment");sh.type="button";sh.onclick=function(){state.view="full";render()};add(box,sh);return box}
// Embedded signup form. Mirrors /signup page fields. Password is POSTed
// directly to /api/chatgpt/signup via fetch — never through an MCP tool call.
function signupForm(r){
 var box=el("div","cta signup");
 add(box,el("b",null,"Create your SmartPR account"),el("span",null,"Your ChatGPT assessment carries into your new account. Takes about 2 minutes."));
 if(state.signupDone){add(box,el("div","signup-ok","Account created! Check "+state.signupEmail+" for a verification email — click the link to confirm and your assessment will load into your new account."));return box}
 var fields=el("div","signup-fields");
 function field(labelText,opts){
  var f=el("div","field");var lab=el("label",null,labelText);
  if(opts&&opts.optional){var em=document.createElement("em");em.textContent=" (optional)";lab.appendChild(em)}
  var inp=el("input");inp.type=(opts&&opts.type)||"text";inp.placeholder=(opts&&opts.ph)||"";
  inp.value=state.signup[opts.key]||"";
  inp.oninput=function(){state.signup[opts.key]=inp.value;state.signupError=null};
  add(f,lab,inp);return {wrap:f,input:inp};
 }
 var row=el("div","row2");
 var fn=field("First name",{key:"firstName",ph:"Maria"});var ln=field("Last name",{key:"lastName",ph:"Rodr\u00edguez"});
 add(row,fn.wrap,ln.wrap);add(fields,row);
 var em=field("Work email",{key:"email",type:"email",ph:"maria@negocio.com"});add(fields,em.wrap);
 var pw=field("Password",{key:"password",type:"password",ph:"At least 8 characters"});add(fields,pw.wrap);
 var ph=field("Phone number",{key:"phone",type:"tel",ph:"(787) 555-0123",optional:true});add(fields,ph.wrap);
 var bn=field("Business name",{key:"businessName",ph:"Your new business name",optional:true});add(fields,bn.wrap);
 var terms=el("label","terms");var cb=el("input");cb.type="checkbox";cb.checked=!!state.signup.agreed;
 cb.onchange=function(){state.signup.agreed=cb.checked;state.signupError=null};
 var tsp=document.createElement("span");tsp.innerHTML="I agree to the <a href=\""+CFG.origin+"/terms\" target=\"_blank\" rel=\"noopener\">Terms of Service</a> and <a href=\""+CFG.origin+"/privacy\" target=\"_blank\" rel=\"noopener\">Privacy Policy</a>.";
 add(terms,cb,tsp);add(fields,terms);
 if(state.signupError)add(fields,el("div","signup-err",state.signupError));
 var sb=el("button","btn p full",state.signupBusy?"Creating account\u2026":"Create account");
 sb.type="button";sb.disabled=!!state.signupBusy;
 sb.onclick=function(){submitSignup(r)};
 add(fields,sb);
 add(box,fields);
 return box;
}
function submitSignup(r){
 if(state.signupBusy)return;
 var s=state.signup;
 // Client-side validation mirrors /signup page + /api/chatgpt/signup.
 if(!s.firstName||!s.firstName.trim()||!s.lastName||!s.lastName.trim()){state.signupError="First and last name are required.";render();return}
 if(!/\S+@\S+\.\S+/.test(s.email||"")){state.signupError="Enter a valid work email.";render();return}
 if(!(s.password||"")||s.password.length<8){state.signupError="Password must be at least 8 characters.";render();return}
 if(!s.agreed){state.signupError="Please accept the Terms of Service and Privacy Policy.";render();return}
 state.signupBusy=true;state.signupError=null;render();
 // First create the handoff so the scenario survives the email-verification
 // round trip, then POST the form directly to our API (password never
 // touches an MCP tool call).
 callTool("create_portal_handoff",{scenario:scenarioPayload()||r.scenario,intent:"continue",answers:drafts()}).then(function(res){
  var sc=res&&(res.structuredContent||(res.result&&res.result.structuredContent));
  var u=sc&&sc.url;var path=u?String(u).replace(/^https?:\/\/[^/]+/,""):"/businesses";
  return fetch(CFG.origin+"/api/chatgpt/signup",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({firstName:s.firstName.trim(),lastName:s.lastName.trim(),email:(s.email||"").trim(),password:s.password,phone:(s.phone||"").trim(),businessName:(s.businessName||"").trim(),handoffPath:path,intent:"start",agreed:true})})
  .then(function(resp){return resp.json().then(function(j){return {ok:resp.ok,j:j}})});
 }).then(function(out){
  state.signupBusy=false;
  if(out.ok&&out.j.ok){state.signupDone=true;state.signupEmail=out.j.email;state.signup={};trace("chatgpt signup ok for "+out.j.email)}
  else{state.signupError=(out.j&&out.j.error)||"We couldn't create your account. Please try again."}
  render();
 }).catch(function(){state.signupBusy=false;state.signupError="Could not reach SmartPR. Check your connection and retry.";render()});
}
function render(){
 // Keep the persistent map node out of the teardown so Leaflet survives.
 if(MAP&&MAP.wrap.parentNode)MAP.wrap.parentNode.removeChild(MAP.wrap);
 root.textContent="";var w=el("div","wrap");add(root,w);add(w,header());var r=state.result;
 if(!r){if(state.error){add(w,el("h1",null,"Something went wrong"));add(w,el("div","note err",state.error));reportSize();return}
  if(state.input||state.busy){add(w,el("h1",null,"Checking requirements\u2026"));for(var i=0;i<5;i++)add(w,el("div","sk"));reportSize();return}
  add(w,el("h1",null,"Your requirements, explained"));add(w,el("p","sub","Describe a business in Puerto Rico \u2014 activity, municipality, size, employees, renovations \u2014 to get a preliminary requirements preview."));reportSize();return}
 // View: model-initiated refine_scenario cards open in the compact update view
 // (applied answers + updated requirements); in-widget interaction switches to full.
 if(state.view==null)state.view=r.refined?"update":"full";
 if(state.error){var e=el("div","note err");add(e,el("span",null,state.error+" "));var rb=el("button","btn o","Dismiss");rb.type="button";rb.onclick=function(){state.error=null;render()};add(e,rb);add(w,e)}
 if(state.view==="update"&&r.status!=="unsupported"){
  add(w,el("h1",null,"Your requirements, updated"));
  add(w,el("p","sub","Based on your answers. Requirements updated below."));
  add(w,updateCard(r));
 } else {
 add(w,el("h1",null,r.status==="unsupported"?"We can't assess this yet":"Your requirements, explained"));
 add(w,el("p","sub",r.status==="unsupported"?r.message:"Based on your scenario. Confirm missing details to refine the assessment."));
 var s=r.scenario,chips=el("div","chips");
 function chip(v,unk){add(chips,el("span","chip"+(v?"":" unk"),v||unk))}
 chip(s.business_type||(s.business_type_input?s.business_type_input+" (confirm)":null),"Activity?");chip(s.municipality,"Municipality?");
 if(s.square_feet!=null)chip(Number(s.square_feet).toLocaleString("en-US")+" sq ft");if(s.employees!=null)chip(s.employees+" employees");
 chip(s.renovation==="interior"?"Interior renovations":s.renovation==="structural"?"Structural renovations":s.renovation==="none"?"No renovations":null,"Renovation scope?");
 add(w,chips);
 if(r.status==="unsupported"){add(w,el("div","foot",(r.coverage_limits||[]).join(" ")));reportSize();return}
 // Location: map + production-style "Project location" panel once a pin exists.
 if(state.pin){var loc=el("div","loc-grid");add(loc,mapCard(r),locPanel(r));add(w,loc)}else add(w,mapCard(r));
 if(r.status==="partial")add(w,el("div","note warn","Preliminary \u2014 "+(r.unresolved_facts||[]).length+" detail(s) unresolved. Unknown facts are shown as \"Needs details\", never assumed \"no\"."));
 } // end full-view branch; update view rejoins here
 // Requirements take the full width — the model already asks the clarifying
 // questions in its text below the widget, so the in-widget question panel
 // was pure duplication. Refinement still flows through the model.
 add(w,reqsCard(r));
 var cta=el("div","cta"),ct=el("div");add(ct,el("b",null,"Turn this preview into a complete assessment"),el("span",null,"Requirement-by-requirement reasoning, official sources, dependencies, and a downloadable report."));
 var u1=el("button","btn p","Unlock full assessment");u1.type="button";u1.disabled=state.busy;u1.onclick=function(){act("unlock")};var u2=el("button","btn o","Use my SmartPR plan");u2.type="button";u2.disabled=state.busy;u2.onclick=function(){act("use_plan")};add(cta,ct,u1,u2);add(w,cta);
 // Embedded signup: full SmartPR signup form inside the widget. The password is
 // POSTed directly to /api/chatgpt/signup (never via MCP tool call) so it
 // never passes through ChatGPT's infrastructure. On success the verification
 // email carries the handoff token: chatgpt -> email -> getsmartpr.com.
 add(w, signupForm(r));
 var cont=el("button","cont");cont.type="button";cont.disabled=state.busy;add(cont,el("span",null,"\u2197"));var cc=el("div");add(cc,el("b",null,"Continue in SmartPR"),el("div","hint","Review your scenario in the portal before anything is saved."));add(cont,cc);cont.onclick=function(){act("continue")};add(w,cont);
 add(w,el("div","foot","Preliminary triage from SmartPR's rules engine, not legal advice. "+(r.coverage_limits||[]).slice(2).join(" ")+" Generated "+new Date(r.versions.generated_at).toLocaleString()+" \u00b7 "+r.versions.kb));
 if(MAP&&MAP.wrap.parentNode){try{MAP.sync();MAP.attach()}catch(err){trace("map sync failed: "+(err&&err.message))}}
 reportSize();setTimeout(function(){if(MAP&&MAP.map)MAP.map.invalidateSize(false);reportSize()},60);
}
render();
request("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"smartpr-requirements",version:"6"},appCapabilities:{availableDisplayModes:["inline","fullscreen"]}},5000).then(function(){notify("ui/notifications/initialized");reportSize()}).catch(function(){reportSize()});
function fromGlobals(){var o=window.openai,to=o&&o.toolOutput;if(!to||to===lastTO)return;lastTO=to;accept({structuredContent:to},"globals")}
if(window.openai&&window.openai.toolOutput)fromGlobals();
// openai:set_globals fires for ANY global (maxHeight, theme, displayMode,
// widgetState…). Only a NEWER toolOutput may change what is on screen.
window.addEventListener("openai:set_globals",function(){fromGlobals()},{passive:true});
window.addEventListener("resize",function(){if(MAP&&MAP.map)MAP.map.invalidateSize(false);else if(MAP&&MAP.attach)MAP.attach();reportSize()},{passive:true});
})();
`;

const JS_FINAL = JS.replace("__MAP_SHAPES__", () => JSON.stringify(PR_MUNICIPIO_SHAPES).replace(/</g, "\\u003c"))
  .replace("__SVGZMAX__", () => String(SVG_MAP_MAX_ZOOM))
  .replace(/__MAP_SOURCE__/g, () => PR_MAP_SOURCE);

export interface WidgetHtmlOptions {
  /** Origin serving /api/tiles (the portal that also appears in the resource CSP). */
  assetOrigin?: string;
}

/** Map config embedded in the widget (tile templates on the asset origin). */
export function widgetMapConfig(opts: WidgetHtmlOptions = {}) {
  return { origin: opts.assetOrigin || PORTAL_DEFAULT, tiles: tileTemplates(opts.assetOrigin || PORTAL_DEFAULT), tileTimeoutMs: TILE_TIMEOUT_MS, minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM };
}

export function widgetHtml(opts: WidgetHtmlOptions = {}): string {
  const cfg = JSON.stringify(widgetMapConfig(opts)).replace(/</g, "\\u003c");
  const js = JS_FINAL.replace("__CFG__", () => cfg);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartPR</title><style>${LEAFLET_CSS}</style><style>${CSS}</style></head><body><div id="root"></div><script>${LEAFLET_JS}</script><script>${js}</script></body></html>`;
}
