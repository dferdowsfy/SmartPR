// SmartPR MCP Apps widget (text/html;profile=mcp-app). Self-contained: no
// external scripts, styles, fonts or network calls (empty CSP allowlists).
// Renders only from tool results delivered over the MCP Apps bridge
// (ui/notifications/tool-result), falling back to window.openai.toolOutput.
// All rendered strings go through textContent — tool data is untrusted.

export const WIDGET_URI = "ui://smartpr/requirements-v1.html";
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
.foot{color:var(--mut);font-size:11px;margin-top:12px}.sk{background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200%;animation:s 1.2s infinite;border-radius:8px;height:14px;margin:10px 0}@keyframes s{to{background-position:-200% 0}}
`;

const JS = String.raw`
(function(){
var root=document.getElementById("root"),pending={},nextId=1,state={result:null,input:null,answers:{},busy:false,error:null,lastAction:null};
function post(m){window.parent.postMessage(m,"*")}
function request(method,params,ms){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},ms||20000)})}
function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
window.addEventListener("message",function(e){if(e.source!==window.parent)return;var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending[m.id]&&!m.method){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
 if(m.method==="ui/notifications/tool-input"){state.input=(m.params&&m.params.arguments)||m.params;if(!state.result){render()}}
 if(m.method==="ui/notifications/tool-result"){accept(m.params)}
 if(m.method==="ui/notifications/tool-cancelled"){state.error="The request was cancelled.";render()}
},{passive:true});
function accept(r){if(!r)return;if(r.isError){state.error=txt(r)||"SmartPR could not complete the request.";state.busy=false;render();return}
 var sc=r.structuredContent||r;if(sc&&sc.scenario&&sc.versions){state.result=sc;state.error=null;state.busy=false;state.answers={};render()}}
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
function render(){root.textContent="";var w=el("div","wrap");add(root,w);add(w,header());var r=state.result;
 if(!r){if(state.error){add(w,el("h1",null,"Something went wrong"));var n=el("div","note err",state.error);add(w,n);return}
  if(state.input||state.busy){add(w,el("h1",null,"Checking requirements…"));for(var i=0;i<5;i++)add(w,el("div","sk"));return}
  add(w,el("h1",null,"Your requirements, explained"));add(w,el("p","sub","Describe a business in Puerto Rico — activity, municipality, size, employees, renovations — to get a preliminary requirements preview."));return}
 add(w,el("h1",null,r.status==="unsupported"?"We can't assess this yet":"Your requirements, explained"));
 add(w,el("p","sub",r.status==="unsupported"?r.message:"Based on your scenario. Confirm missing details to refine the assessment."));
 var s=r.scenario,chips=el("div","chips");
 function chip(v,unk){add(chips,el("span","chip"+(v?"":" unk"),v||unk))}
 chip(s.business_type||(s.business_type_input?s.business_type_input+" (confirm)":null),"Activity?");chip(s.municipality,"Municipality?");
 if(s.square_feet!=null)chip(Number(s.square_feet).toLocaleString("en-US")+" sq ft");if(s.employees!=null)chip(s.employees+" employees");
 chip(s.renovation==="interior"?"Interior renovations":s.renovation==="structural"?"Structural renovations":s.renovation==="none"?"No renovations":null,"Renovation scope?");
 add(w,chips);
 if(state.error){var e=el("div","note err");add(e,el("span",null,state.error+" "));var rb=el("button","btn o","Retry");rb.onclick=function(){state.error=null;act(state.lastAction||"refine")};add(e,rb);add(w,e)}
 if(r.status==="unsupported"){add(w,el("div","foot",(r.coverage_limits||[]).join(" ")));return}
 if(r.status==="partial")add(w,el("div","note warn","Preliminary — "+(r.unresolved_facts||[]).length+" detail(s) unresolved. Unknown facts are shown as \"Needs details\", never assumed \"no\"."));
 var g=el("div","grid"),left=el("div","card");add(g,left);var h2=el("h2",null,"Preliminary requirements");add(h2,el("span","badge",r.counts.total+" identified"));add(left,h2);
 var groups=["Business registrations","Construction & site authorization","Operating permits"],idx=0;
 if(!r.requirements.length)add(left,el("p","sub","No requirements were generated for this scenario yet. Answer the questions to refine."));
 groups.forEach(function(name){var items=r.requirements.filter(function(q){return q.group===name});if(!items.length)return;idx++;
  var worst=items.some(function(q){return q.applicability==="unresolved"})?"unresolved":items.some(function(q){return q.applicability==="conditional"})?"conditional":"supported";
  var grp=el("div","grp"),row=el("button","grow");row.setAttribute("aria-expanded","false");var gt=el("div","gt");add(gt,el("b",null,name),el("span",null,items.length+" item(s) · "+GDESC[name]));
  add(row,el("span","num",idx),gt,el("span","tag "+worst,TAG[worst]));row.onclick=function(){grp.classList.toggle("open");row.setAttribute("aria-expanded",grp.classList.contains("open"))};
  var list=el("div","items");items.forEach(function(q){var it=el("div","it");var t=el("div");add(t,el("b",null,q.name+" "),el("span","tag "+q.applicability,TAG[q.applicability]));add(it,t,el("div","meta",q.agency),el("div",null,q.why));
   var ul=el("ul");(q.next_steps||[]).forEach(function(x){add(ul,el("li",null,x))});(q.citations||[]).forEach(function(c){var li=el("li");if(c.url&&/^https:\/\//.test(c.url)){var a=el("a",null,c.label);a.href=c.url;a.target="_blank";a.rel="noopener";a.onclick=function(ev){ev.preventDefault();openLink(c.url)};add(li,el("span",null,"Source: "),a)}else add(li,el("span",null,"Source: "+c.label));add(ul,li)});add(it,ul);add(list,it)});
  add(grp,row,list);add(left,grp)});
 var lk=el("div","lock");add(lk,el("span",null,"🔒"));var lt=el("div");add(lt,el("b",null,"Additional requirements & sequencing"),el("div",null,(r.gated.hidden_requirement_count?r.gated.hidden_requirement_count+" more requirement(s), ":"")+"dependencies and a downloadable report are in the full assessment."));add(lk,lt);add(left,lk);
 var right=el("div","card");add(right,el("h2",null,"Refine your scenario"));var qs=r.clarifying_questions||[];
 add(right,el("p","sub",qs.length?qs.length+" detail(s) need clarification.":"No open questions — change a fact in chat to re-run."));
 qs.forEach(function(q){var id="q_"+q.id;var l=el("label",null,q.question);l.htmlFor=id;add(right,l);var inp;
  if(q.options&&q.options.length){inp=el("select");inp.id=id;add(inp,el("option",null,"Select…")).value="";q.options.forEach(function(o){var op=el("option",null,o.label);op.value=o.value;add(inp,op)})}else{inp=el("input");inp.id=id;inp.placeholder="Type your answer"}
  inp.value=state.answers[q.id]||"";inp.onchange=function(){state.answers[q.id]=inp.value};add(right,inp)});
 if(qs.length){var ub=el("button","btn o full",state.busy?"Updating…":"Update preview");ub.disabled=state.busy;ub.onclick=function(){act("refine")};add(right,ub)}
 add(right,el("div","hint","Hypothetical scenarios welcome. No project is saved."));add(g,right);add(w,g);
 var cta=el("div","cta"),ct=el("div");add(ct,el("b",null,"Turn this preview into a complete assessment"),el("span",null,"Requirement-by-requirement reasoning, official sources, dependencies, and a downloadable report."));
 var u1=el("button","btn p","Unlock full assessment");u1.disabled=state.busy;u1.onclick=function(){act("unlock")};var u2=el("button","btn o","Use my SmartPR plan");u2.disabled=state.busy;u2.onclick=function(){act("use_plan")};add(cta,ct,u1,u2);add(w,cta);
 var cont=el("button","cont");cont.disabled=state.busy;add(cont,el("span",null,"↗"));var cc=el("div");add(cc,el("b",null,"Continue in SmartPR"),el("div","hint","Review your scenario in the portal before anything is saved."));add(cont,cc);cont.onclick=function(){act("continue")};add(w,cont);
 add(w,el("div","foot","Preliminary triage from SmartPR's rules engine, not legal advice. "+(r.coverage_limits||[]).slice(2).join(" ")+" Generated "+new Date(r.versions.generated_at).toLocaleString()+" · "+r.versions.kb));
}
render();
request("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"smartpr-requirements",version:"1"},appCapabilities:{}},5000).then(function(){notify("ui/notifications/initialized")}).catch(function(){});
if(window.openai&&window.openai.toolOutput)accept({structuredContent:window.openai.toolOutput});
window.addEventListener("openai:set_globals",function(){if(window.openai&&window.openai.toolOutput&&!state.busy)accept({structuredContent:window.openai.toolOutput})});
})();
`;

export function widgetHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartPR</title><style>${CSS}</style></head><body><div id="root"></div><script>${JS}</script></body></html>`;
}
