// SmartPR MCP Apps widget (text/html;profile=mcp-app). Self-contained: no
// external scripts, styles, fonts, images or network calls — the CSP
// allowlists stay empty. The site map is an inline-SVG vector map of the 78
// municipios (prMapShapes.ts) instead of remote raster tiles, so nothing the
// ChatGPT sandbox CSP could block is ever requested.
// Renders only from tool results delivered over the MCP Apps bridge
// (ui/notifications/tool-result), falling back to window.openai.toolOutput.
// All rendered strings go through textContent — tool data is untrusted.

import { PR_MUNICIPIO_SHAPES, PR_MAP_SOURCE } from "./prMapShapes";

// v4: vector map (no external tiles) — new URI so ChatGPT drops the cached v3 template.
export const WIDGET_URI = "ui://smartpr/requirements-v4.html";
/** Map zoom range. z7 fits the whole island in a phone-width iframe; outlines
 *  are ~1:500k generalized, so beyond z14 they add nothing. */
export const MAP_MIN_ZOOM = 7;
export const MAP_MAX_ZOOM = 14;
export const WIDGET_MIME = "text/html;profile=mcp-app";

const CSS = `
:root{--teal:#0f766e;--teal2:#115e59;--tealbg:#e6f4f1;--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--bg:#fff;--soft:#f8fafc}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{padding:20px 22px;max-width:920px}.hdr{display:flex;align-items:center;gap:10px}.brand b{display:block;font-size:20px;color:var(--teal2)}.brand span{color:var(--mut);font-size:12px}
.pill{margin-left:auto;background:var(--tealbg);color:var(--teal2);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
h1{font-size:22px;margin:16px 0 2px}.sub{color:var(--mut);margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.chip{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:6px 12px;font-weight:500}
.chip.unk{border-style:dashed;color:var(--mut)}
.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:12px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
.card{border:1px solid var(--line);border-radius:12px;padding:14px}.card h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center}
.badge{margin-left:auto;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--tealbg);color:var(--teal2)}
.grp{border-top:1px solid var(--line)}.grp:first-of-type{border-top:0}.grow{display:flex;gap:10px;align-items:center;padding:10px 0;cursor:pointer;width:100%;background:none;border:0;text-align:left;font:inherit;color:inherit}
.num{width:28px;height:28px;border-radius:50%;background:var(--tealbg);color:var(--teal2);display:grid;place-items:center;font-weight:700;flex:none}
.gt b{display:block}.gt span{color:var(--mut);font-size:12px}.tag{margin-left:auto;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap}
.supported{background:#dcfce7;color:#166534}.conditional{background:#e0e7ff;color:#3730a3}.unresolved{background:#fef3c7;color:#92400e}
.items{padding:0 0 8px 38px;display:none}.open .items{display:block}.it{padding:8px 0;border-top:1px dashed var(--line)}.it b{font-weight:600}.it .meta{color:var(--mut);font-size:12px}
.it ul{margin:4px 0 0 16px;padding:0;font-size:12px}.it a{color:var(--teal)}
.lock{display:flex;gap:10px;align-items:center;background:var(--soft);border-radius:10px;padding:10px;margin-top:8px;color:var(--mut)}
label{display:block;font-weight:600;font-size:13px;margin:10px 0 4px}select,input{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit;background:#fff}
.btn{display:inline-block;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;font:inherit;font-weight:600}.btn.p{background:var(--teal);color:#fff;border:1px solid var(--teal)}.btn.o{background:#fff;color:var(--teal2);border:1px solid var(--teal)}
.btn[disabled]{opacity:.55;cursor:default}.full{width:100%;margin-top:12px}.hint{color:var(--mut);font-size:12px;margin-top:6px}
.cta{margin-top:12px;background:var(--tealbg);border:1px solid #b7e1da;border-radius:12px;padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cta div{flex:1;min-width:220px}.cta b{display:block}
.cont{display:flex;gap:8px;align-items:flex-start;padding:12px 4px 0;background:none;border:0;cursor:pointer;font:inherit;text-align:left;color:inherit}.cont b{color:var(--ink)}
.note{border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px}.note.warn{background:#fffbeb;border:1px solid #fde68a}.note.err{background:#fef2f2;border:1px solid #fecaca}
.mapc{margin:0 0 12px;display:block}.mapc h2{font-size:16px;margin:0 0 4px;display:flex;align-items:center}
.map{position:relative;height:240px;min-height:220px;width:100%;overflow:hidden;border-radius:10px;border:1px solid var(--line);background:#cfe6f2;cursor:crosshair;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
@media(max-width:640px){.map{height:220px;min-height:200px}.wrap{padding:14px 12px}h1{font-size:18px;margin:12px 0 2px}.map .zc button{width:36px;height:36px}}
.map .vm{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block}
.map .vm .m{fill:#f7f5ef;stroke:#9aa8b8;stroke-width:.8;fill-rule:evenodd;stroke-linejoin:round}.map .vm .m.on{fill:#d5efe9;stroke:#0f766e;stroke-width:1.6}
.map .vm text{font:600 10px/1 ui-sans-serif,system-ui,sans-serif;fill:#475569;text-anchor:middle;paint-order:stroke;stroke:#f7f5ef;stroke-width:3px;stroke-linejoin:round}
.map .pin{position:absolute;width:28px;height:28px;margin:-28px 0 0 -14px;pointer-events:none}.map .pin.pend{opacity:.75}
.map .zc{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:4px;z-index:2}.map .zc button{width:30px;height:30px;border-radius:6px;border:1px solid var(--line);background:#fff;font:600 16px/1 system-ui;cursor:pointer;color:var(--ink);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.map .attr{position:absolute;right:0;bottom:0;background:rgba(255,255,255,.8);font-size:10px;padding:1px 5px;color:#334155;z-index:1}
.map .tip{position:absolute;left:8px;top:8px;background:rgba(255,255,255,.92);border-radius:6px;padding:4px 8px;font-size:12px;color:var(--ink);z-index:1;pointer-events:none}
.siteinfo{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:13px}.siteinfo .btn{padding:6px 12px;touch-action:manipulation}
.muni-map{margin:6px 0 10px}.muni-or{color:var(--mut);font-size:12px;margin:8px 0 4px;font-weight:500}
.foot{color:var(--mut);font-size:11px;margin-top:12px}.sk{background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200%;animation:s 1.2s infinite;border-radius:8px;height:14px;margin:10px 0}@keyframes s{to{background-position:-200% 0}}
`;

const JS = String.raw`
(function(){
var root=document.getElementById("root"),pending={},nextId=1,state={result:null,input:null,answers:{},busy:false,error:null,lastAction:null,map:{lat:18.22,lng:-66.45,z:8,pin:null}},lastSizeH=0,mapDraws=[];
function post(m){window.parent.postMessage(m,"*")}
function request(method,params,ms){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},ms||20000)})}
function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
function reportSize(){var h=Math.ceil((root&&root.scrollHeight)||document.documentElement.scrollHeight||0);if(h<120)return;if(Math.abs(h-lastSizeH)<8)return;lastSizeH=h;notify("ui/notifications/size-changed",{height:h});try{var o=window.openai;if(o&&typeof o.notifyIntrinsicHeight==="function")o.notifyIntrinsicHeight(h)}catch(_){}}
window.addEventListener("message",function(e){if(e.source!==window.parent)return;var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending[m.id]&&!m.method){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
 if(m.method==="ui/notifications/tool-input"){state.input=(m.params&&m.params.arguments)||m.params;if(!state.result){render()}}
 if(m.method==="ui/notifications/tool-result"){accept(m.params)}
 if(m.method==="ui/notifications/tool-cancelled"){state.error="The request was cancelled.";render()}
},{passive:true});
function accept(r){if(!r)return;if(r.isError){state.error=txt(r)||"SmartPR could not complete the request.";state.busy=false;render();return}
 var sc=r.structuredContent||r;if(sc&&sc.scenario&&sc.versions){state.result=sc;state.error=null;state.busy=false;state.answers={};var f=sc.map_focus||{latitude:18.22,longitude:-66.45,zoom:8};state.map={lat:f.latitude,lng:f.longitude,z:Math.min(f.zoom,FOCUS_Z),pin:null};clampMap(state.map);render()}}
function txt(r){try{return(r.content||[]).map(function(c){return c.text||""}).join(" ").slice(0,300)}catch(_){return""}}
function callTool(name,args){
 return request("tools/call",{name:name,arguments:args},30000).catch(function(e){var o=window.openai;if(o&&o.callTool)return o.callTool(name,args);throw e})}
function openLink(url){request("ui/open-link",{url:url},8000).catch(function(){var o=window.openai;if(o&&o.openExternal)o.openExternal({href:url});else window.open(url,"_blank","noopener")})}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n}
function add(p){for(var i=1;i<arguments.length;i++)if(arguments[i])p.appendChild(arguments[i]);return p}
var TAG={supported:"Supported",conditional:"Conditional",unresolved:"Needs details"};
var GDESC={"Business registrations":"Entity, tax and employer registrations.","Construction & site authorization":"Renovation scope may trigger permits and professional plans.","Operating permits":"Depend on the activity and premises."};
function header(){var h=el("div","hdr");var logo=document.createElementNS("http://www.w3.org/2000/svg","svg");logo.setAttribute("width","34");logo.setAttribute("height","34");logo.setAttribute("viewBox","0 0 24 24");logo.innerHTML='<path fill="#0f766e" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>';
 var b=el("div","brand");add(b,el("b",null,"SmartPR"),el("span",null,"Puerto Rico regulatory intelligence"));return add(h,logo,b,el("span","pill","Free preview"))}
function act(kind){if(state.busy)return;state.lastAction=kind;var r=state.result;
 if(kind==="refine"){var ans={};for(var k in state.answers)if(state.answers[k]!=="")ans[k]=state.answers[k];if(!Object.keys(ans).length)return;
  state.busy=true;state.error=null;render();callTool("refine_scenario",{scenario:r.scenario,answers:ans}).then(function(res){if(res&&!res.isError){accept(res);var n=state.result;request("ui/update-model-context",{content:[{type:"text",text:"User refined the SmartPR scenario in the widget. "+(n&&n.message||"")}]},5000).catch(function(){})}else{state.busy=false;state.error=txt(res)||"Could not update the preview.";render()}}).catch(function(){state.busy=false;state.error="Could not reach SmartPR. Check your connection and retry.";render()})}
 else{state.busy=true;state.error=null;render();callTool("create_portal_handoff",{scenario:r.scenario,intent:kind}).then(function(res){state.busy=false;var u=res&&res.structuredContent&&res.structuredContent.url;if(u){openLink(u)}else{state.error=txt(res)||"Could not create a SmartPR link."}render()}).catch(function(){state.busy=false;state.error="Could not reach SmartPR. Retry.";render()})}}
var SHAPES=__MAP_SHAPES__,TS=256,ZMIN=__ZMIN__,ZMAX=__ZMAX__,FOCUS_Z=11,BX={s:17.55,n:18.9,w:-68.4,e:-64.85},MUNIS=null,SVGNS="http://www.w3.org/2000/svg";
function wsz(z){return TS*Math.pow(2,z)}
function px(lng,z){return (lng+180)/360*wsz(z)}
function py(lat,z){var r=lat*Math.PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*wsz(z)}
function unx(x,z){return x/wsz(z)*360-180}
function uny(y,z){var n=Math.PI-2*Math.PI*y/wsz(z);return 180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)))}
function clampMap(m){m.z=Math.max(ZMIN,Math.min(ZMAX,Math.round(m.z)||ZMIN));m.lat=Math.max(BX.s,Math.min(BX.n,m.lat));m.lng=Math.max(BX.w,Math.min(BX.e,m.lng))}
function fold(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim()}
function decodeRing(str){var pts=[],i=0,lat=0,lng=0,n=str.length;while(i<n){var r=0,sh=0,b;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32&&i<n);lat+=(r&1)?~(r>>1):(r>>1);r=0;sh=0;do{b=str.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32&&i<n);lng+=(r&1)?~(r>>1):(r>>1);pts.push(px(lng/1e4,0),py(lat/1e4,0))}return pts}
function munis(){if(MUNIS)return MUNIS;MUNIS=[];for(var k=0;k<SHAPES.length;k++){var sh=SHAPES[k],rings=sh[3].split(" ").map(decodeRing),bb=[1e9,1e9,-1e9,-1e9];rings.forEach(function(r){for(var i=0;i<r.length;i+=2){if(r[i]<bb[0])bb[0]=r[i];if(r[i]>bb[2])bb[2]=r[i];if(r[i+1]<bb[1])bb[1]=r[i+1];if(r[i+1]>bb[3])bb[3]=r[i+1]}});MUNIS.push({n:sh[0],f:fold(sh[0]),lx:px(sh[1],0),ly:py(sh[2],0),rings:rings,bb:bb})}return MUNIS}
function pinSvg(color){var d=document.createElementNS("http://www.w3.org/2000/svg","svg");d.setAttribute("viewBox","0 0 24 24");d.setAttribute("width","28");d.setAttribute("height","28");d.innerHTML='<path fill="'+color+'" stroke="#fff" stroke-width="1.2" d="M12 1.5a7 7 0 0 0-7 7c0 5.2 7 14 7 14s7-8.8 7-14a7 7 0 0 0-7-7z"/><circle cx="12" cy="8.5" r="2.6" fill="#fff"/>';return d}
function mapCard(r,opts){opts=opts||{};var m=state.map;if(!m){state.map={lat:18.22,lng:-66.45,z:8,pin:null};m=state.map}var site=r&&r.scenario&&r.scenario.site;
 var c=el("div","card mapc"+(opts.embed?" muni-map":""));var h=el("h2",null,opts.embed?"Drop a pin on the site":"Where is the site?");if(site)add(h,el("span","badge","Pinned"));add(c,h);
 add(c,el("p","sub",site?"The pin sets the municipality from official Census boundaries. Move it if needed.":"Tap the map to drop a pin on the property. The pin sets the municipality; zoning, flood-zone and parcel checks for it are in SmartPR."));
 var box=el("div","map"),pin=el("div","pin"),pend=el("div","pin pend");pin.appendChild(pinSvg("#0f766e"));pend.appendChild(pinSvg("#f59e0b"));
 box.style.height=box.style.minHeight=(window.matchMedia&&window.matchMedia("(max-width:640px)").matches?"220px":"240px");
 var zc=el("div","zc"),zi=el("button",null,"+"),zo=el("button",null,"\u2212");zi.setAttribute("aria-label","Zoom in");zo.setAttribute("aria-label","Zoom out");zi.type=zo.type="button";add(zc,zi,zo);
 var att=el("div","attr","Boundaries: __MAP_SOURCE__");
 var svg=document.createElementNS(SVGNS,"svg");svg.setAttribute("class","vm");svg.setAttribute("aria-hidden","true");var gP=document.createElementNS(SVGNS,"g"),gL=document.createElementNS(SVGNS,"g");svg.appendChild(gP);svg.appendChild(gL);
 var siteF=site?fold(site.municipality):"",ML=munis(),paths=[],labels=[];
 ML.forEach(function(mu){var p=document.createElementNS(SVGNS,"path");p.setAttribute("class","m"+(siteF&&mu.f===siteF?" on":""));gP.appendChild(p);paths.push(p);var t=document.createElementNS(SVGNS,"text");t.textContent=mu.n;gL.appendChild(t);labels.push(t)});
 add(box,svg,site?pin:null,pend,zc,att);if(!site&&!m.pin)add(box,el("div","tip","Tap to drop a pin"));
 function draw(){var W=box.clientWidth||box.offsetWidth||320,H=box.clientHeight||box.offsetHeight||220;if(W<40){W=320}if(!m.fit&&box.clientWidth){m.fit=1;if(m.z<=8&&W<540)m.z=7}var cx=px(m.lng,m.z),cy=py(m.lat,m.z),x0=cx-W/2,y0=cy-H/2,k=Math.pow(2,m.z),showL=m.z>=10;
  svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("width",W);svg.setAttribute("height",H);
  for(var a=0;a<ML.length;a++){var mu=ML[a],b=mu.bb,vis=!(b[2]*k<x0-2||b[0]*k>x0+W+2||b[3]*k<y0-2||b[1]*k>y0+H+2),d="";
   if(vis){for(var q=0;q<mu.rings.length;q++){var r=mu.rings[q];if(r.length<6)continue;d+="M";for(var i=0;i<r.length;i+=2){d+=(i?"L":"")+(Math.round((r[i]*k-x0)*10)/10)+" "+(Math.round((r[i+1]*k-y0)*10)/10)}d+="Z"}}
   paths[a].setAttribute("d",d||"M0 0");var t=labels[a],lx=mu.lx*k-x0,ly=mu.ly*k-y0;if(showL&&lx>-40&&lx<W+40&&ly>-10&&ly<H+10){t.setAttribute("x",Math.round(lx));t.setAttribute("y",Math.round(ly));t.style.display=""}else t.style.display="none"}
  function place(node,p){if(!p){node.style.display="none";return}node.style.display="block";node.style.left=(px(p.lng,m.z)-x0)+"px";node.style.top=(py(p.lat,m.z)-y0)+"px"}
  place(pin,site?{lat:site.latitude,lng:site.longitude}:null);place(pend,m.pin)}
 mapDraws.push(draw);
 function zoom(d){m.z+=d;clampMap(m);draw()}
 var raf=0;function drawSoon(){if(raf)return;var rq=window.requestAnimationFrame||function(f){return setTimeout(f,16)};raf=rq(function(){raf=0;draw()})}
 zi.onclick=function(e){e.preventDefault();e.stopPropagation();zoom(1)};zo.onclick=function(e){e.preventDefault();e.stopPropagation();zoom(-1)};
 zc.addEventListener("pointerdown",function(e){e.stopPropagation()});
 var drag=null;
 box.addEventListener("pointerdown",function(e){if(e.pointerType==="mouse"&&e.button!==0)return;drag={x:e.clientX,y:e.clientY,cx:px(m.lng,m.z),cy:py(m.lat,m.z),moved:false};try{box.setPointerCapture(e.pointerId)}catch(_){}});
 box.addEventListener("pointermove",function(e){if(!drag)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<8)return;drag.moved=true;m.lng=unx(drag.cx-dx,m.z);m.lat=uny(drag.cy-dy,m.z);clampMap(m);drawSoon()});
 box.addEventListener("pointerup",function(e){if(!drag)return;var d=drag;drag=null;if(d.moved||state.busy)return;var rc=box.getBoundingClientRect(),W=box.clientWidth||rc.width,H=box.clientHeight||rc.height;
  var x=px(m.lng,m.z)-W/2+(e.clientX-rc.left),y=py(m.lat,m.z)-H/2+(e.clientY-rc.top);m.pin={lat:Math.round(uny(y,m.z)*1e6)/1e6,lng:Math.round(unx(x,m.z)*1e6)/1e6};render()});
 box.addEventListener("pointercancel",function(){drag=null});
 box.addEventListener("wheel",function(e){e.preventDefault();zoom(e.deltaY<0?1:-1)},{passive:false});
 add(c,box);
 var info=el("div","siteinfo");
 if(m.pin){add(info,el("span",null,"New pin at "+m.pin.lat.toFixed(5)+", "+m.pin.lng.toFixed(5)));var ub=el("button","btn p",state.busy?"Checking\u2026":"Use this location");ub.type="button";ub.disabled=state.busy;ub.onclick=function(){pinSite(m.pin)};var cb=el("button","btn o","Cancel");cb.type="button";cb.onclick=function(){m.pin=null;render()};add(info,ub,cb)}
 else if(site){add(info,el("b",null,"\ud83d\udccd "+(site.barrio?site.barrio+", ":"")+site.municipality),el("span","hint",site.latitude.toFixed(5)+", "+site.longitude.toFixed(5)));var xb=el("button","btn o","Remove pin");xb.type="button";xb.disabled=state.busy;xb.onclick=function(){pinSite(null)};add(info,xb)}
 add(c,info);
 if(site&&site.near_boundary)add(c,el("div","note warn","This pin is about "+site.boundary_distance_m+" m from a municipal boundary \u2014 confirm the municipality."));
 setTimeout(function(){draw();reportSize()},0);setTimeout(function(){draw();reportSize()},120);return c}
function pinSite(p){var r=state.result;if(!r||state.busy)return;state.busy=true;state.error=null;state.lastAction="pin";render();
 callTool("refine_scenario",{scenario:r.scenario,site:p?{latitude:p.lat,longitude:p.lng}:null}).then(function(res){
  if(res&&!res.isError){var dropped=((res.structuredContent||{}).dropped_answers||[]).indexOf("site")>=0;accept(res);if(dropped){state.error="That point is outside Puerto Rico. Drop the pin on the property in Puerto Rico.";render()}
   var n=state.result,st=n&&n.scenario.site;request("ui/update-model-context",{content:[{type:"text",text:st?"User pinned the site on the SmartPR map: "+(st.barrio?st.barrio+", ":"")+st.municipality+" ("+st.latitude+", "+st.longitude+"). "+(n.message||""):"User removed the SmartPR map pin. "+(n&&n.message||"")}]},5000).catch(function(){})}
  else{state.busy=false;state.error=txt(res)||"Could not use that location.";render()}}).catch(function(){state.busy=false;state.error="Could not reach SmartPR. Check your connection and retry.";render()})}
function render(){mapDraws=[];root.textContent="";var w=el("div","wrap");add(root,w);add(w,header());var r=state.result;
 if(!r){if(state.error){add(w,el("h1",null,"Something went wrong"));var n=el("div","note err",state.error);add(w,n);reportSize();return}
  if(state.input||state.busy){add(w,el("h1",null,"Checking requirements…"));for(var i=0;i<5;i++)add(w,el("div","sk"));reportSize();return}
  add(w,el("h1",null,"Your requirements, explained"));add(w,el("p","sub","Describe a business in Puerto Rico — activity, municipality, size, employees, renovations — to get a preliminary requirements preview."));reportSize();return}
 add(w,el("h1",null,r.status==="unsupported"?"We can't assess this yet":"Your requirements, explained"));
 add(w,el("p","sub",r.status==="unsupported"?r.message:"Based on your scenario. Confirm missing details to refine the assessment."));
 var s=r.scenario,chips=el("div","chips");
 function chip(v,unk){add(chips,el("span","chip"+(v?"":" unk"),v||unk))}
 chip(s.business_type||(s.business_type_input?s.business_type_input+" (confirm)":null),"Activity?");chip(s.municipality,"Municipality?");
 if(s.square_feet!=null)chip(Number(s.square_feet).toLocaleString("en-US")+" sq ft");if(s.employees!=null)chip(s.employees+" employees");
 chip(s.renovation==="interior"?"Interior renovations":s.renovation==="structural"?"Structural renovations":s.renovation==="none"?"No renovations":null,"Renovation scope?");
 add(w,chips);
 if(state.error){var e=el("div","note err");add(e,el("span",null,state.error+" "));var rb=el("button","btn o","Retry");rb.type="button";rb.onclick=function(){state.error=null;if(state.lastAction==="pin"){render();return}act(state.lastAction||"refine")};add(e,rb);add(w,e)}
 if(r.status==="unsupported"){add(w,el("div","foot",(r.coverage_limits||[]).join(" ")));reportSize();return}
 // Map first — must be visible in ChatGPT's inline iframe after assess (mobile + desktop).
 add(w,mapCard(r));
 if(r.status==="partial")add(w,el("div","note warn","Preliminary — "+(r.unresolved_facts||[]).length+" detail(s) unresolved. Unknown facts are shown as \"Needs details\", never assumed \"no\"."));
 var g=el("div","grid"),left=el("div","card");add(g,left);var h2=el("h2",null,"Preliminary requirements");add(h2,el("span","badge",r.counts.total+" identified"));add(left,h2);
 var groups=["Business registrations","Construction & site authorization","Operating permits"],idx=0;
 if(!r.requirements.length)add(left,el("p","sub","No requirements were generated for this scenario yet. Answer the questions to refine."));
 groups.forEach(function(name){var items=r.requirements.filter(function(q){return q.group===name});if(!items.length)return;idx++;
  var worst=items.some(function(q){return q.applicability==="unresolved"})?"unresolved":items.some(function(q){return q.applicability==="conditional"})?"conditional":"supported";
  var grp=el("div","grp"),row=el("button","grow");row.type="button";row.setAttribute("aria-expanded","false");var gt=el("div","gt");add(gt,el("b",null,name),el("span",null,items.length+" item(s) · "+GDESC[name]));
  add(row,el("span","num",idx),gt,el("span","tag "+worst,TAG[worst]));row.onclick=function(){grp.classList.toggle("open");row.setAttribute("aria-expanded",grp.classList.contains("open"));reportSize()};
  var list=el("div","items");items.forEach(function(q){var it=el("div","it");var t=el("div");add(t,el("b",null,q.name+" "),el("span","tag "+q.applicability,TAG[q.applicability]));add(it,t,el("div","meta",q.agency),el("div",null,q.why));
   var ul=el("ul");(q.next_steps||[]).forEach(function(x){add(ul,el("li",null,x));});(q.citations||[]).forEach(function(c){var li=el("li");if(c.url&&/^https:\/\//.test(c.url)){var a=el("a",null,c.label);a.href=c.url;a.target="_blank";a.rel="noopener";a.onclick=function(ev){ev.preventDefault();openLink(c.url)};add(li,el("span",null,"Source: "),a)}else add(li,el("span",null,"Source: "+c.label));add(ul,li)});add(it,ul);add(list,it)});
  add(grp,row,list);add(left,grp)});
 var lk=el("div","lock");add(lk,el("span",null,"🔒"));var lt=el("div");add(lt,el("b",null,"Additional requirements & sequencing"),el("div",null,(r.gated.hidden_requirement_count?r.gated.hidden_requirement_count+" more requirement(s), ":"")+"dependencies and a downloadable report are in the full assessment."));add(lk,lt);add(left,lk);
 var right=el("div","card");add(right,el("h2",null,"Refine your scenario"));var qs=r.clarifying_questions||[];
 var needsMuni=!s.municipality||qs.some(function(q){return q.id==="municipality"});
 add(right,el("p","sub",qs.length?qs.length+" detail(s) need clarification.":"No open questions — change a fact in chat to re-run."));
 // Municipality question: interactive map is the primary control (not a plain text field).
 if(needsMuni&&!s.site){var ml=el("label",null,"Which municipality will the business operate in?");add(right,ml);add(right,mapCard(r,{embed:true}));add(right,el("div","muni-or","Or type a municipality name"));var mi=el("input");mi.id="q_municipality";mi.placeholder="e.g. Guaynabo";mi.value=state.answers.municipality||"";mi.onchange=mi.oninput=function(){state.answers.municipality=mi.value};add(right,mi)}
 qs.forEach(function(q){if(q.id==="municipality"&&needsMuni&&!s.site)return;var id="q_"+q.id;var l=el("label",null,q.question);l.htmlFor=id;add(right,l);var inp;
  if(q.options&&q.options.length){inp=el("select");inp.id=id;var ph=el("option",null,"Select…");ph.value="";add(inp,ph);q.options.forEach(function(o){var op=el("option",null,o.label);op.value=o.value;add(inp,op)})}else{inp=el("input");inp.id=id;inp.placeholder="Type your answer"}
  inp.value=state.answers[q.id]||"";inp.onchange=function(){state.answers[q.id]=inp.value};add(right,inp)});
 if(qs.length){var ub=el("button","btn o full",state.busy?"Updating…":"Update preview");ub.type="button";ub.disabled=state.busy;ub.onclick=function(){act("refine")};add(right,ub)}
 add(right,el("div","hint","Hypothetical scenarios welcome. No project is saved."));add(g,right);add(w,g);
 var cta=el("div","cta"),ct=el("div");add(ct,el("b",null,"Turn this preview into a complete assessment"),el("span",null,"Requirement-by-requirement reasoning, official sources, dependencies, and a downloadable report."));
 var u1=el("button","btn p","Unlock full assessment");u1.type="button";u1.disabled=state.busy;u1.onclick=function(){act("unlock")};var u2=el("button","btn o","Use my SmartPR plan");u2.type="button";u2.disabled=state.busy;u2.onclick=function(){act("use_plan")};add(cta,ct,u1,u2);add(w,cta);
 var cont=el("button","cont");cont.type="button";cont.disabled=state.busy;add(cont,el("span",null,"↗"));var cc=el("div");add(cc,el("b",null,"Continue in SmartPR"),el("div","hint","Review your scenario in the portal before anything is saved."));add(cont,cc);cont.onclick=function(){act("continue")};add(w,cont);
 add(w,el("div","foot","Preliminary triage from SmartPR's rules engine, not legal advice. "+(r.coverage_limits||[]).slice(2).join(" ")+" Generated "+new Date(r.versions.generated_at).toLocaleString()+" · "+r.versions.kb));
 reportSize();
}
render();
request("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"smartpr-requirements",version:"1"},appCapabilities:{}},5000).then(function(){notify("ui/notifications/initialized");reportSize()}).catch(function(){reportSize()});
if(window.openai&&window.openai.toolOutput)accept({structuredContent:window.openai.toolOutput});
window.addEventListener("openai:set_globals",function(){if(window.openai&&window.openai.toolOutput&&!state.busy)accept({structuredContent:window.openai.toolOutput})});
function redrawMaps(){for(var i=0;i<mapDraws.length;i++)try{mapDraws[i]()}catch(_){ }reportSize()}
if(typeof ResizeObserver!=="undefined"){try{new ResizeObserver(function(){redrawMaps()}).observe(root)}catch(_){}}
window.addEventListener("resize",function(){redrawMaps()},{passive:true});
})();
`;

// Function replacers: the polyline alphabet must never be read as `$&`-style patterns.
const JS_FINAL = JS.replace("__MAP_SHAPES__", () => JSON.stringify(PR_MUNICIPIO_SHAPES).replace(/</g, "\\u003c"))
  .replace("__ZMIN__", () => String(MAP_MIN_ZOOM))
  .replace("__ZMAX__", () => String(MAP_MAX_ZOOM))
  .replace("__MAP_SOURCE__", () => PR_MAP_SOURCE);

export function widgetHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartPR</title><style>${CSS}</style></head><body><div id="root"></div><script>${JS_FINAL}</script></body></html>`;
}
