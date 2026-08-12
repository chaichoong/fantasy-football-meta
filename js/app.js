// Per-GW team fixture modifiers, GW1-5, from the fixture model notes (approximate where the model gave only a run-level read)
const MOD={MCI:[1.3,1.0,1.3,0.9,1.3],ARS:[1.25,1.1,1.1,1.1,1.1],LIV:[0.9,1.1,1.1,1.1,1.1],MUN:[1.3,1.3,1.0,0.6,1.0],CHE:[1.0,1.0,1.0,1.35,1.0],NFO:[1.1,1.1,1.1,1.0,1.35],SUN:[1.1,1.1,1.0,0.6,0.6],BOU:[0.6,0.9,1.0,1.0,1.0],HUL:[0.6,0.8,0.8,0.8,0.8],COV:[0.9,0.9,0.55,0.9,0.6],IPS:[0.85,0.6,0.85,0.85,0.85]};
// Injury status: 0 fit, 1 doubt, 2 out. Preset from verified news; everything else assumed fit until you update it.
let INJ={}; // manual overrides only; live feed supplies availability, overrides win while set
let MOM={}; // momentum: -2 cold .. +2 hot, applied as 0.8x to 1.2x
let FXW={}; // current-gameweek fixture ratings per team (1-5), from refresh; overrides MOD beyond GW5
let META={gw:1,date:"pre-season",updated:"draft data, 8 Aug 2026"};
try{INJ=Object.assign(INJ,JSON.parse(localStorage.getItem("fplHQinj")||"{}"))}catch(e){}
try{MOM=JSON.parse(localStorage.getItem("fplHQmom")||"{}")}catch(e){}
try{FXW=JSON.parse(localStorage.getItem("fplHQfxw")||"{}")}catch(e){}
try{const m=JSON.parse(localStorage.getItem("fplHQmeta")||"null");if(m)META=m;}catch(e){}
function saveInj(){try{localStorage.setItem("fplHQinj",JSON.stringify(INJ));localStorage.setItem("fplHQmom",JSON.stringify(MOM));localStorage.setItem("fplHQfxw",JSON.stringify(FXW));localStorage.setItem("fplHQmeta",JSON.stringify(META))}catch(e){}}
// ---- Live data (phase 1) ----
// Official FPL feed via our relay (the API blocks browsers directly; the relay adds CORS + 15-min cache).
const RELAY="https://fpl-relay.kevinbrittain.workers.dev";

let LIVESTAT={},CHANCE={},PRICE={},LIVEEL={},OWN={},XG={},LIVEFX=null,LIVEOK=false,DEADLINE="";
function fdrMult(d){return {1:1.35,2:1.25,3:1.0,4:0.8,5:0.6}[d]||1;}
async function loadLive(){
  lastLoad=Date.now();
  try{
    const [bs,fx]=await Promise.all([
      fetch(RELAY+"/bootstrap",{signal:AbortSignal.timeout(12000)}).then(r=>r.json()),
      fetch(RELAY+"/fixtures",{signal:AbortSignal.timeout(12000)}).then(r=>r.json())
    ]);
    const byId={};bs.elements.forEach(e=>byId[e.id]=e);
    const short={};bs.teams.forEach(t=>short[t.id]=t.short_name);
    LIVESTAT={};CHANCE={};PRICE={};LIVEEL={};OWN={};XG={};
    P.forEach(x=>{
      const e=byId[FPLID[x.n]];if(!e)return;
      PRICE[x.n]=e.now_cost/10;
      LIVESTAT[x.n]=e.status==="a"?0:e.status==="d"?1:2;
      if(e.chance_of_playing_next_round!=null&&e.chance_of_playing_next_round<100)CHANCE[x.n]=e.chance_of_playing_next_round;
      LIVEEL[x.n]={form:parseFloat(e.form)||0,ep:parseFloat(e.ep_next)||0};
      OWN[x.n]=parseFloat(e.selected_by_percent)||0;
      XG[x.n]={xg:parseFloat(e.expected_goals_per_90)||0,xa:parseFloat(e.expected_assists_per_90)||0,xgc:parseFloat(e.expected_goals_conceded_per_90)||0,mins:e.minutes||0,ppg:parseFloat(e.points_per_game)||0};
    });
    LIVEFX={};
    fx.forEach(f=>{
      if(!f.event)return; // unscheduled fixture: ignore until it gets a gameweek
      const h=short[f.team_h],a=short[f.team_a];
      (LIVEFX[h]=LIVEFX[h]||{})[f.event]=(LIVEFX[h][f.event]||0)+fdrMult(f.team_h_difficulty);
      (LIVEFX[a]=LIVEFX[a]||{})[f.event]=(LIVEFX[a][f.event]||0)+fdrMult(f.team_a_difficulty);
    });
    const next=bs.events.find(e=>e.is_next)||bs.events.find(e=>e.is_current)||bs.events[0];
    META.gw=next.id;
    DEADLINE=new Date(next.deadline_time).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    META.date=next.is_current?"in play":"deadline "+DEADLINE;
    META.updated="live feed, "+new Date().toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
    if(gwSel<META.gw||gwSel>META.gw+3)gwSel=META.gw;
    LIVEOK=true;liveTries=0;clearMeta();saveInj();
  }catch(e){
    LIVEOK=false;
    if(++liveTries<=3)setTimeout(loadLive,liveTries*2500); // self-heal: retry at 2.5s, 5s, 7.5s
  }
  render();
}
function statusOf(n){return INJ[n]!==undefined?INJ[n]:(LIVESTAT[n]!==undefined?LIVESTAT[n]:0)}
// ---- Prediction model V1 (phase 3) ----
// Predicted GW points = blended base x fixture x availability x momentum.
// Base blends up to three signals, weights renormalised over whichever exist:
//   40% draft projection (season points / 38), 30% live form, 30% FPL's own ep_next.
// Preseason form is 0 and drops out, so the model leans on projection + ep_next
// until real matches are played. All factors are shown per player in the planner.
function predParts(x){
  const L=LIVEEL[x.n]||{};
  const sig=[["Draft projection",0.4,x.pts/38]];
  if(L.form>0)sig.push(["Live form",0.3,L.form]);
  if(L.ep>0)sig.push(["FPL expected",0.3,L.ep]);
  const wsum=sig.reduce((s,c)=>s+c[1],0);
  const base=sig.reduce((s,c)=>s+c[1]*c[2],0)/wsum;
  const st=statusOf(x.n);
  const avail=st===2?0:st===1?(CHANCE[x.n]!=null?CHANCE[x.n]/100:0.6):1;
  const fx=fxMult(x.t);
  const mom=1+(MOM[x.n]||0)*0.1;
  return {sig,wsum,base,avail,fx,mom,pred:base*fx*avail*mom};
}
function predPts(x){return predParts(x).pred}
// ---- Meta Rating (phase 5, Leo's spec) ----
// Player Meta /100: form 20, predicted points 25, fixtures (next 5 GWs) 20,
// expected minutes 15, value 10, long-term 10. A component with no data yet
// (form preseason, value with no price) drops out and the weights renormalise,
// exactly like the prediction blend. metaParts() exposes every line for "Why?".
function metaParts(x){
  const L=LIVEEL[x.n]||{};
  const g0=META.gw||1;
  let fxa=0,fxn=0;for(let g=g0;g<Math.min(39,g0+5);g++){fxa+=fxMult(x.t,g);fxn++;}
  const fixScore=Math.max(0,Math.min(100,((fxa/fxn)-0.6)/0.75*100));
  const parts=[
    ["Form",20,L.form>0?Math.min(100,L.form/8*100):null],
    ["Predicted points",25,Math.min(100,predPtsAt(x,g0)/7*100)],
    ["Fixtures (next 5)",20,fixScore],
    ["Minutes",15,startProb(x)],
    ["Value",10,PRICE[x.n]?Math.min(100,(x.pts/38)/PRICE[x.n]/0.8*100):null],
    ["Long-term",10,x.v]
  ];
  const live=parts.filter(c=>c[2]!==null);
  const wsum=live.reduce((s,c)=>s+c[1],0);
  const total=Math.round(live.reduce((s,c)=>s+c[1]*c[2],0)/wsum);
  return {parts,wsum,total};
}
// ---- Confidence (phase 6, Leo's bands) ----
// Confidence is NOT how good the player is. It is how much the model trusts its own
// number: 50% minutes certainty, 30% how closely the signals agree, 20% how many
// signals exist at all. Early season has fewer signals, so confidence is honestly
// lower for everyone until matches are played.
const BANDS=[[85,"Very high","var(--a)"],[70,"High","var(--a)"],[50,"Medium","var(--warn)"],[30,"Low","#e08a76"],[0,"Very low","#e08a76"]];
function confidenceOf(x){
  const f=predParts(x),mins=startProb(x),n=f.sig.length;
  const completeness=n>=3?100:n===2?70:40;
  let agree=60;
  if(n>1){
    const vals=f.sig.map(s=>s[2]),mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    const rel=mean>0?(Math.max.apply(null,vals)-Math.min.apply(null,vals))/mean:1;
    agree=Math.max(0,Math.min(100,100-rel*100));
  }
  const pct=Math.round(0.5*mins+0.3*agree+0.2*completeness);
  const band=BANDS.find(b=>pct>=b[0]);
  const why=[],risk=[];
  if(mins>=90)why.push("expected to start");else if(mins>=70)why.push("likely to start");
  if(agree>=75)why.push("the signals agree");
  if((LIVEEL[x.n]||{}).form>=5)why.push("strong recent form");
  if(f.fx>=1.15)why.push("favourable fixture");
  if(mins<70)risk.push(mins===0?"ruled out":"rotation or fitness risk");
  if(n<3)risk.push("limited data this early in the season");
  if(agree<50&&n>1)risk.push("the signals disagree");
  if(f.fx>0&&f.fx<0.9)risk.push("tough fixture");
  if(f.fx===0)risk.push("no fixture this gameweek");
  return {pct,band:band[1],col:band[2],why,risk};
}
// ---- Event probabilities (phase 7) ----
// Poisson from the official expected-goals suite. Rates are per 90 minutes played,
// so they scale by expected minutes and by the fixture (attacking rates rise in an
// easy game, conceding falls). Returns null when the player has no minutes on
// record — an honest "not enough data" beats a fabricated 0%.
function eventProbs(x){
  const d=XG[x.n];
  if(!d||d.mins<180)return null;              // under 2 full matches of evidence
  const sp=startProb(x)/100;
  if(sp===0)return {ruledOut:true};
  const fx=fxMult(x.t);
  if(fx===0)return {blank:true};
  const mins=sp*82+(1-sp)*22;                  // starters ~82 mins, non-starters ~22
  const share=mins/90;
  const lamG=d.xg*share*fx, lamA=d.xa*share*fx;
  const pG=1-Math.exp(-lamG), pA=1-Math.exp(-lamA);
  const p60=sp*0.92;                           // starters usually see 60 minutes
  let pCS=null;
  if(d.xgc>0&&(x.p==="G"||x.p==="D")){
    const lamC=d.xgc/(fx||1);
    pCS=Math.exp(-lamC)*p60;
  }
  return {pG,pA,p60,pCS,any:1-(1-pG)*(1-pA),mins:Math.round(mins),xg:d.xg,xa:d.xa,xgc:d.xgc,sample:d.mins};
}
function pctBar(label,v,col){
  return '<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px;"><span>'+label+'</span><span style="font-weight:700;color:'+(col||"var(--a)")+';">'+Math.round(v*100)+'%</span></div><div class="bar"><i style="width:'+Math.min(100,v*100)+'%;background:'+(col||"var(--a)")+';"></i></div></div>';
}
function confChip(x){const c=confidenceOf(x);return '<span class="conf" style="background:'+c.col+'1f;color:'+c.col+';">'+c.pct+'%</span>';}
let MCACHE={};
function metaOf(n){if(MCACHE[n]===undefined){const x=P.find(y=>y.n===n);MCACHE[n]=x?metaParts(x).total:0;}return MCACHE[n];}
function clearMeta(){MCACHE={};}
// ---- Accuracy (phase 4) ----
// Snapshots are the model's inputs archived by the relay in the final 2h before
// each deadline, immutable afterwards. Predictions here are recomputed from the
// archived inputs with the same blend as predParts (no momentum: packs are
// ephemeral and were not archived), so the page judges exactly what the model
// knew at the deadline — no retro-fitting possible.
let ACC={list:null,loading:false,detail:{},actual:{},error:false};
function predFromSnap(x,snap){
  const rec=snap.players[FPLID[x.n]];if(!rec)return null;
  const ep=rec[0],form=rec[1],st=rec[2],ch=rec[3];
  const sig=[[0.4,x.pts/38]];if(form>0)sig.push([0.3,form]);if(ep>0)sig.push([0.3,ep]);
  const w=sig.reduce((s,c)=>s+c[0],0);const base=sig.reduce((s,c)=>s+c[0]*c[1],0)/w;
  if(st===2)return 0;
  const avail=st===1?(ch!=null?ch/100:0.6):1;
  let fx=0;snap.fixtures.forEach(f=>{if(f.h===x.t)fx+=fdrMult(f.dh);if(f.a===x.t)fx+=fdrMult(f.da)});
  return base*fx*avail;
}
async function loadAccuracy(){
  ACC.loading=true;ACC.error=false;render();
  try{
    const l=await fetch(RELAY+"/snapshots",{signal:AbortSignal.timeout(12000)}).then(r=>r.json());
    ACC.list=l.snapshots||[];
    for(const s of ACC.list){
      if(!ACC.detail[s.gw])ACC.detail[s.gw]=await fetch(RELAY+"/snapshot?gw="+s.gw,{signal:AbortSignal.timeout(12000)}).then(r=>r.json());
      try{
        const lv=await fetch(RELAY+"/live?event="+s.gw,{signal:AbortSignal.timeout(12000)}).then(r=>r.json());
        const pts={};let played=0;
        (lv.elements||[]).forEach(e=>{pts[e.id]=e.stats.total_points;if(e.stats.minutes>0)played++;});
        ACC.actual[s.gw]=played>0?pts:null;
      }catch(e){ACC.actual[s.gw]=null;}
    }
  }catch(e){ACC.error=true;ACC.list=ACC.list||[];}
  ACC.loading=false;render();
}
function updateStrip(){
  const el=document.getElementById("liveStrip");if(!el)return;
  if(LIVEOK)el.innerHTML='<span style="color:var(--a);font-weight:600;">&#9679; Live</span> &middot; GW'+META.gw+' &middot; '+META.date+' &middot; updated '+META.updated.replace("live feed, ","");
  else el.innerHTML='<span style="color:var(--warn);font-weight:600;">&#9675; '+(liveTries>0&&liveTries<=3?'Connecting&hellip;':'Stored data')+'</span> &middot; GW'+META.gw+(liveTries>3?' &middot; refresh to retry':'');
}
let lastLoad=0,liveTries=0;
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&Date.now()-lastLoad>300000)loadLive();});
function applyPack(txt){
  try{
    const j=JSON.parse(txt.replace(/```json|```/g,"").trim());
    if(j.gameweek){META.gw=j.gameweek;gwSel=j.gameweek;}
    if(j.date)META.date=j.date;
    META.updated=new Date().toLocaleDateString("en-GB");
    (j.players||[]).forEach(p=>{
      const s=p.status==="out"?2:p.status==="doubt"?1:0;
      if(s)INJ[p.name]=s;else delete INJ[p.name];
      if(typeof p.momentum==="number")MOM[p.name]=Math.max(-2,Math.min(2,p.momentum));
    });
    (j.teams||[]).forEach(t=>{FXW[t.code]=Math.max(1,Math.min(5,t.fx))});
    saveInj();render();
    return true;
  }catch(e){alert("Pack not valid JSON. Copy the whole code block from chat and paste again.");return false;}
}
async function refreshLive(){
  const btn=document.getElementById("refBtn");
  if(btn){btn.textContent="Refreshing...";btn.disabled=true;}
  await loadLive();
  if(btn){btn.textContent="Refresh live data";btn.disabled=false;}
}
// Team early-run fixture ratings GW1-5 (rank + read, model dated 5 Aug 2026)
const FIX=[["MCI",5,"Elite. Two 80%+ home games, nothing scary"],["ARS",5,"Elite. 80%+ opener, strong throughout"],["LIV",4,"Strong and steady, no trap week"],["MUN",4,"Fast start, then City in GW4"],["NFO",4,"Value team with the schedule, three strong home games"],["CHE",3,"Lumpy, one huge week in GW4"],["NEW",3,"Backloaded"],["EVE",3,"Backloaded"],["BRE",3,"Decent, home-heavy"],["AVL",3,"Middling"],["BHA",3,"Middling, tough finish"],["TOT",3,"Middling"],["CRY",3,"Slow start"],["FUL",3,"Middling"],["BOU",2,"Brutal opener, then fine"],["LEE",2,"Below average"],["SUN",2,"Opens fine, Arsenal then City GW4-5"],["COV",2,"Two wipeouts: away Arsenal and City"],["IPS",1,"Rough throughout"],["HUL",1,"Worst in the league. Home games are MUN and AVL"]];
const GWNOTES=[
["GW1 (23 Aug)","City home to Bournemouth: Haaland's first big window. Liverpool away at Newcastle. Utd open with Hull."],
["GW2","Utd v Ipswich: Bruno and Mbeumo's best early week. Bournemouth's brutal opener continues."],
["GW3","City home to Coventry: near-zero-chance away trip for Coventry. Haaland captain window two."],
["GW4","Manchester derby: bench or expect little from Utd assets. Chelsea's best matchup of the run: Palmer's week. Sunderland's collapse begins at Arsenal."],
["GW5","City home to Sunderland: Haaland window three. Forest home to Coventry: Gibbs-White's best week. Hull still winless on fixtures."]];
const TEAMCOL={MCI:"#6CABDD",ARS:"#EF4135",LIV:"#C8102E",MUN:"#DA291C",CHE:"#4D7BD6",TOT:"#8CA6C0",NEW:"#9BA7B2",AVL:"#95BFE5",BHA:"#4B9AE0",BOU:"#DA291C",BRE:"#E30613",CRY:"#4B71C9",EVE:"#5B8DDB",FUL:"#B8B8B8",LEE:"#FFCD00",NFO:"#DD3333",SUN:"#EB4B5F",COV:"#78D0F3",HUL:"#F5971D",IPS:"#5A84C4"};
const NAMES={K:"Kevin",L:"Leo",J:"James",F:"Free"};
const ORDER={F:1,M:2,D:3,G:4};
const POSNAME={F:"FW",M:"MID",D:"DEF",G:"GK"};
// System grade from season points index, per position bands (free agents only; drafted players keep curated grades)
function grade(p,pts){
  if(p==="M")return pts>=180?"A":pts>=120?"B":"C";
  if(p==="F")return pts>=140?"A":pts>=100?"B":"C";
  if(p==="D")return pts>=160?"A":pts>=115?"B":"C";
  return pts>=155?"A":pts>=125?"B":"C";
}
const P=D.map((a,i)=>({n:a[0],t:a[1],p:a[2],pts:a[3],pp:a[4],g:GRC[a[0]]||grade(a[2],a[3]),v:VAL[a[0]]!==undefined?VAL[a[0]]:Math.round(a[3]/2.2),o:OWNER[a[0]]||"F",gw:GW[a[0]]||null}));
P.sort((a,b)=>b.v-a.v||b.pts-a.pts);P.forEach((x,i)=>x.r=i+1);
function fxOf(t){
  if(LIVEFX&&LIVEFX[t]){const m=LIVEFX[t][gwSel]||0;return m>=1.25?5:m>=1.1?4:m>=0.95?3:m>=0.75?2:1;}
  const f=FIX.find(x=>x[0]===t);return f?f[1]:3;
}
function early(x){return x.gw!==null?x.gw:+(x.pts*0.115).toFixed(1)}
let tab="squads",posF="ALL",ownF="ALL",q="",sortMode="val";
function esc(s){return s.replace(/'/g,"\\'")}
function render(){
  updateStrip();
  if(FOCUS){document.getElementById("view").innerHTML=playerView();document.querySelectorAll(".tabs button").forEach(b=>b.classList.remove("on"));return;}
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===tab));
  const v=document.getElementById("view");
  if(tab==="squads")return v.innerHTML=squadsView();
  if(tab==="players")return v.innerHTML=playersView();
  if(tab==="fixtures")return v.innerHTML=fixturesView();
  if(tab==="planner")return v.innerHTML=plannerView();
  if(tab==="accuracy")return v.innerHTML=accuracyView();
  if(tab==="builder")return v.innerHTML=builderView();
  if(tab==="picks")return v.innerHTML=bestPicksView();
  if(tab==="compare")return v.innerHTML=compareView();
}
function squadTotal(o){return P.filter(x=>x.o===o).reduce((s,x)=>s+x.v,0)}
function squadsView(){
  const T=["K","J","L"].map(o=>({o,tot:squadTotal(o),n:P.filter(x=>x.o===o).length,A:P.filter(x=>x.o===o&&x.g==="A").length}));
  let h='<div class="teams">'+T.map(t=>'<div class="team '+(t.o==="K"?"kev":t.o==="L"?"leo":"jam")+'"><div class="tn">'+NAMES[t.o]+'</div><div class="score">'+t.tot+'</div><div class="meta">'+t.n+'/15 &middot; '+t.A+' A-grade</div></div>').join("")+'</div>';
  h+='<div class="note"><b>Kevin 1001, James 830, Leo 807.</b> One metric everywhere in this app now: the draft value score (70% projected points, 20% minutes certainty, 10% ceiling and edge). This matches draft night exactly. The raw points index still appears per player as reference only; it is one input to the score, not the score, and squad totals are never computed from it.</div>';
  ["K","J","L"].forEach(o=>{
    h+='<div class="sec">'+NAMES[o]+'</div>';
    P.filter(x=>x.o===o).sort((a,b)=>ORDER[a.p]-ORDER[b.p]||b.v-a.v).forEach(x=>{h+=rowHtml(x,false)});
  });
  return h;
}
function rowHtml(x,showOwner){
  const st=statusOf(x.n);
  const flag=st===2?'<span style="font-size:10px;font-weight:700;color:#e08a76;flex-shrink:0;">OUT</span>':(CHANCE[x.n]!=null?'<span style="font-size:10px;font-weight:700;color:var(--warn);flex-shrink:0;">'+CHANCE[x.n]+'%</span>':'');
  const club=showOwner?'<span class="tc" style="background:'+(TEAMCOL[x.t]||'#888')+'22;color:'+(TEAMCOL[x.t]||'#aaa')+';">'+x.t+'</span>':'';
  const open=' style="cursor:pointer;" onclick="openPlayer(\''+esc(x.n)+'\')"';
  const small=(showOwner?'':x.t+' ')+POSNAME[x.p]+(PRICE[x.n]?' &middot; &pound;'+PRICE[x.n].toFixed(1)+'m':'');
  return '<div class="row"'+open+'><span class="rk">'+x.r+'</span><span class="gr '+x.g+'">'+x.g+'</span>'+club+'<span class="pn">'+x.n+'<small>'+small+'</small></span>'+flag+'<span class="val">'+x.v+' &middot; '+x.pp.toFixed(1)+'</span>'+(showOwner?'<span class="own '+x.o+'">'+(x.o==="F"?"Free":NAMES[x.o])+'</span>':'')+'</div>';
}
function playersView(){
  let h='<input type="text" id="srch" placeholder="Search player or team" value="'+q+'" oninput="q=this.value;render();document.getElementById(\'srch\').focus();const el=document.getElementById(\'srch\');el.setSelectionRange(el.value.length,el.value.length);">';
  h+='<div class="filters">'+["ALL","F","M","D","G"].map(p=>'<button onclick="posF=\''+p+'\';render()" class="'+(posF===p?"on":"")+'">'+(p==="ALL"?"All":POSNAME[p])+'</button>').join("")+'<button onclick="ownF=ownF===\'F\'?\'ALL\':\'F\';render()" class="'+(ownF==="F"?"on":"")+'">Free only</button></div>';
  h+='<div class="filters">'+[["val","Score"],["pred","Pred pts"],["price","Price"],["vpm","&pound; value"],["pp","PP/90"],["start","Start %"]].map(s=>'<button onclick="sortMode=\''+s[0]+'\';render()" class="'+(sortMode===s[0]?"on":"")+'">'+s[1]+'</button>').join("")+'</div>';
  h+='<div class="note">Score column: draft value &middot; points per 90. Prices and injury flags are live from the official feed. Sort by Score, Price, &pound; value (value per million), PP/90 or Start %. '+P.length+' players covered.</div>';
  let rows=P.filter(x=>(posF==="ALL"||x.p===posF)&&(ownF==="ALL"||x.o==="F")&&(q===""||x.n.toLowerCase().includes(q.toLowerCase())||x.t.toLowerCase().includes(q.toLowerCase())));
  const sortKey={val:x=>x.v,pred:x=>predPts(x),price:x=>PRICE[x.n]||0,vpm:x=>PRICE[x.n]?x.v/PRICE[x.n]:0,pp:x=>x.pp,start:x=>startProb(x)}[sortMode];
  rows=rows.slice().sort((a,b)=>sortKey(b)-sortKey(a)||b.v-a.v);
  if(posF==="ALL"){rows.slice(0,260).forEach(x=>h+=rowHtml(x,true));}
  else{rows.forEach(x=>h+=rowHtml(x,true));}
  return h;
}
function fixturesView(){
  let h='<div class="card"><div class="lbl">Team fixture runs &middot; Gameweeks 1-5</div>';
  FIX.forEach((f,i)=>{h+='<div class="row"><span class="rk">'+(i+1)+'</span><span class="fxbar fx'+f[1]+'">'+f[0]+'</span><span class="pn" style="white-space:normal;font-size:12.5px;color:var(--sub)">'+f[2]+'</span></div>'});
  h+='</div>';
  h+='<div class="card"><div class="lbl">Gameweek notes</div>';
  GWNOTES.forEach(g=>{h+='<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;">'+g[0]+'</div><div style="font-size:12.5px;color:var(--sub);line-height:1.5;">'+g[1]+'</div></div>'});
  h+='</div>';
  h+='<div class="note">Season opener 23 August, GW1 deadline Friday 21 August. Window closes 1 September, so re-check any player in transfer talk before each of the first three deadlines. Ratings and notes from the fixture model dated 5 August; The GW Plan tab now uses live official fixture difficulty for every gameweek; this page remains the narrative read on the opening runs.</div>';
  return h;
}
let planTeam="K",gwSel=META.gw||1,expanded=null;
// ---- Squad Builder (phase 5) ----
const CAPS={G:2,D:5,M:5,F:3};
let SQUAD={G:[],D:[],M:[],F:[]};
try{const s=JSON.parse(localStorage.getItem("fplHQsquad")||"null");if(s&&s.G)SQUAD=s;}catch(e){}
function saveSquad(){try{localStorage.setItem("fplHQsquad",JSON.stringify(SQUAD))}catch(e){}}
let pickPos=null,pickQ="",whyOpen=false;
function squadFlat(){return [].concat(SQUAD.G,SQUAD.D,SQUAD.M,SQUAD.F)}
function squadSpent(){return squadFlat().reduce((s,n)=>s+(PRICE[n]||0),0)}
function clubCount(t,except){let c=0;squadFlat().forEach(n=>{if(n===except)return;const x=P.find(y=>y.n===n);if(x&&x.t===t)c++;});return c;}
function poolPlayers(){return P.filter(x=>PRICE[x.n]&&FPLID[x.n])}
function bestXIPred(names){
  const g0=META.gw||1;
  const ps=names.map(n=>P.find(y=>y.n===n)).filter(Boolean).map(x=>({x,e:predPtsAt(x,g0)}));
  const gk=ps.filter(r=>r.x.p==="G").sort((a,b)=>b.e-a.e);
  const out=ps.filter(r=>r.x.p!=="G").sort((a,b)=>b.e-a.e);
  let xi=gk.length?[gk[0]]:[],d=0,m=0,f=0;
  out.forEach(r=>{if(xi.length>=11)return;
    const left=11-xi.length,needD=Math.max(0,3-d),needM=Math.max(0,3-m),needF=Math.max(0,1-f);
    const need=(r.x.p==="D"&&needD>0)||(r.x.p==="M"&&needM>0)||(r.x.p==="F"&&needF>0);
    const capOk=(r.x.p==="D"&&d<5)||(r.x.p==="M"&&m<5)||(r.x.p==="F"&&f<3);
    if((need||left>needD+needM+needF)&&capOk){xi.push(r);if(r.x.p==="D")d++;if(r.x.p==="M")m++;if(r.x.p==="F")f++;}
  });
  return xi.reduce((s,r)=>s+r.e,0);
}
// Greedy start + best-single-swap local search. Never brute force: ~15x300 swap
// checks per round, stops when no swap improves total Meta.
function optimiseSquad(){
  clearMeta();
  const pool=poolPlayers();
  const sq={G:[],D:[],M:[],F:[]};
  const inSq=n=>sq.G.includes(n)||sq.D.includes(n)||sq.M.includes(n)||sq.F.includes(n);
  const clubs=t=>[].concat(sq.G,sq.D,sq.M,sq.F).filter(n=>{const x=P.find(y=>y.n===n);return x&&x.t===t;}).length;
  ["G","D","M","F"].forEach(p=>{
    pool.filter(x=>x.p===p).sort((a,b)=>PRICE[a.n]-PRICE[b.n]).forEach(x=>{
      if(sq[p].length>=CAPS[p]||clubs(x.t)>=3||inSq(x.n))return;sq[p].push(x.n);});
  });
  for(let it=0;it<300;it++){
    const spent=[].concat(sq.G,sq.D,sq.M,sq.F).reduce((s,n)=>s+PRICE[n],0);
    let best=null;
    ["G","D","M","F"].forEach(p=>{
      sq[p].forEach(out=>{
        const outX=P.find(y=>y.n===out);
        pool.filter(x=>x.p===p&&!inSq(x.n)).forEach(inn=>{
          if(spent-PRICE[out]+PRICE[inn.n]>100.001)return;
          const cc=clubs(inn.t)-(outX.t===inn.t?1:0);
          if(cc>=3)return;
          const gain=metaOf(inn.n)-metaOf(out);
          if(gain>(best?best.gain:0.01))best={p,out,inn:inn.n,gain};
        });
      });
    });
    if(!best)break;
    sq[best.p]=sq[best.p].map(n=>n===best.out?best.inn:n);
  }
  SQUAD=sq;saveSquad();
}
function suggestSwaps(){
  const spent=squadSpent();const out=[];
  ["G","D","M","F"].forEach(p=>{
    SQUAD[p].forEach(o=>{
      const oX=P.find(y=>y.n===o);
      poolPlayers().filter(x=>x.p===p&&!squadFlat().includes(x.n)).forEach(inn=>{
        if(spent-PRICE[o]+PRICE[inn.n]>100.001)return;
        if(clubCount(inn.t,o)>=3)return;
        const gain=metaOf(inn.n)-metaOf(o);
        if(gain>0.5)out.push({o,i:inn.n,gain});
      });
    });
  });
  return out.sort((a,b)=>b.gain-a.gain).slice(0,3);
}
function addPick(n){const x=P.find(y=>y.n===n);if(!x)return;if(SQUAD[x.p].length>=CAPS[x.p])return;SQUAD[x.p].push(n);pickPos=null;pickQ="";saveSquad();render();}
function dropPick(n){["G","D","M","F"].forEach(p=>{SQUAD[p]=SQUAD[p].filter(y=>y!==n)});saveSquad();render();}
function builderView(){
  if(!LIVEOK)return '<div class="card"><div class="lbl">Needs live data</div><div style="font-size:13px;">The builder uses live prices, so it waits for the feed. '+ (liveTries>3?'Tap a tab to retry.':'Connecting&hellip;')+'</div></div>';
  let h='<div class="note"><b>Official-game squad builder.</b> &pound;100m, 2 GK &middot; 5 DEF &middot; 5 MID &middot; 3 FWD, max 3 per club. Every player carries a Meta rating out of 100 (form, predicted points, next-5 fixtures, minutes, value, long-term). Tap a slot to fill it, tap a player to remove him, or let the optimiser build the squad.</div>';
  const spent=squadSpent(),left=100-spent,count=squadFlat().length;
  const metas=squadFlat().map(metaOf);
  const sqMeta=metas.length?Math.round(metas.reduce((a,b)=>a+b,0)/metas.length):0;
  h+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;">';
  h+='<div><div style="font-size:11.5px;color:var(--sub);text-transform:uppercase;letter-spacing:.8px;">Budget</div><div style="font-size:16px;font-weight:700;color:'+(left<0?'#e08a76':'var(--txt)')+'">&pound;'+left.toFixed(1)+'m left</div><div style="font-size:11px;color:var(--sub);">'+count+'/15 &middot; &pound;'+spent.toFixed(1)+'m spent</div></div>';
  h+='<div style="text-align:right;"><div style="font-size:11.5px;color:var(--sub);text-transform:uppercase;letter-spacing:.8px;">Squad Meta</div><div style="font-size:22px;font-weight:700;color:var(--a);">'+(count?sqMeta:0)+'<span style="font-size:12px;color:var(--sub);">/100</span></div>'+(count===15?'<div style="font-size:11px;color:var(--sub);">predicted GW pts: '+bestXIPred(squadFlat()).toFixed(1)+'</div>':'<div style="font-size:11px;color:var(--sub);">'+(15-count)+' slots empty</div>')+'</div></div>';
  h+='<div style="display:flex;gap:6px;margin-top:9px;">';
  h+='<button onclick="optimiseSquad();render()" style="flex:1;background:var(--accentbtn,#2c4a3e);border:1px solid var(--a);color:var(--a);border-radius:8px;padding:8px 0;font-size:12.5px;font-weight:700;">&#10024; Optimise squad</button>';
  h+='<button onclick="whyOpen=!whyOpen;render()" style="flex:1;background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 0;font-size:12.5px;font-weight:600;">Why '+(count?sqMeta:0)+'?</button>';
  h+='<button onclick="SQUAD={G:[],D:[],M:[],F:[]};saveSquad();render()" style="background:transparent;border:1px solid var(--line);color:var(--sub);border-radius:8px;padding:8px 10px;font-size:12.5px;">Reset</button></div>';
  if(whyOpen&&count){
    const agg={};
    squadFlat().forEach(n=>{const x=P.find(y=>y.n===n);metaParts(x).parts.forEach(c=>{if(c[2]===null)return;(agg[c[0]]=agg[c[0]]||{w:c[1],s:0,n:0});agg[c[0]].s+=c[2];agg[c[0]].n++;});});
    h+='<div style="font-size:11.5px;color:var(--sub);margin-top:8px;line-height:1.8;">';
    Object.keys(agg).forEach(k=>{const a=agg[k];h+='<div style="display:flex;justify-content:space-between;"><span>'+k+' (weight '+a.w+')</span><span>'+Math.round(a.s/a.n)+'/100</span></div>';});
    h+='<div style="margin-top:4px;">Squad Meta is the average of every player\'s Meta; each player\'s Meta is his weighted component score. Missing components (form before matches, for example) drop out and the weights renormalise.</div></div>';
  }
  h+='</div>';
  if(pickPos)return h+pickerHtml();
  const rows=[["F","Forwards"],["M","Midfielders"],["D","Defenders"],["G","Goalkeepers"]];
  h+='<div class="pitch">';
  rows.forEach(([p,label])=>{
    h+='<div class="prow-l">'+label+'</div><div class="prow">';
    for(let i=0;i<CAPS[p];i++){
      const n=SQUAD[p][i];
      if(n){const x=P.find(y=>y.n===n);const short=n.split(" ").slice(-1)[0];
        h+='<div class="slot filled" onclick="dropPick(\''+esc(n)+'\')"><div class="sn">'+short+'</div><div class="sm">&pound;'+(PRICE[n]||0).toFixed(1)+'m</div><div class="sv">'+metaOf(n)+'</div></div>';}
      else h+='<div class="slot" onclick="pickPos=\''+p+'\';pickQ=\'\';render()">+</div>';
    }
    h+='</div>';
  });
  h+='</div>';
  if(count===15&&left>=0){
    const byPos=["F","M","D","G"].map(p=>({p,avg:SQUAD[p].length?Math.round(SQUAD[p].reduce((s,n)=>s+metaOf(n),0)/SQUAD[p].length):0}));
    const worst=byPos.slice().sort((a,b)=>a.avg-b.avg)[0],bestP=byPos.slice().sort((a,b)=>b.avg-a.avg)[0];
    const risky=squadFlat().filter(n=>{const x=P.find(y=>y.n===n);return x&&confidenceOf(x).pct<60;});
    const POSW={F:"forwards",M:"midfield",D:"defence",G:"goalkeepers"};
    h+='<div class="card"><div class="lbl">Squad read</div><div style="font-size:12.5px;line-height:1.9;">';
    h+='<div>&#128994; Strength: '+POSW[bestP.p]+' (Meta '+bestP.avg+')</div>';
    h+='<div>&#128308; Weakness: '+POSW[worst.p]+' (Meta '+worst.avg+')</div>';
    h+='<div>'+(risky.length?'&#128993; Concern: '+risky.length+' player'+(risky.length>1?'s':'')+' below 60% confidence ('+risky.slice(0,2).map(n=>n.split(" ").slice(-1)[0]).join(", ")+(risky.length>2?"&hellip;":"")+')':'&#128994; No confidence concerns in this squad')+'</div>';
    h+='</div></div>';
    const sw=suggestSwaps();
    h+='<div class="card"><div class="lbl">Suggested swaps</div>';
    if(!sw.length)h+='<div style="font-size:12.5px;color:var(--sub);">No single swap improves this squad. Solid.</div>';
    sw.forEach(s=>{h+='<div class="row" style="cursor:pointer;" onclick="CMP=[\''+esc(s.o)+'\',\''+esc(s.i)+'\'];tab=\'compare\';render()"><span class="pn">'+s.o+' &rarr; <b>'+s.i+'</b></span><span class="val" style="color:var(--a);">+'+s.gain.toFixed(1)+' Meta</span></div>';});
    h+='</div>';
  }
  if(left<0)h+='<div class="card" style="border-color:rgba(224,110,90,.5);"><div style="font-size:12.5px;color:#e08a76;">Over budget by &pound;'+(-left).toFixed(1)+'m. Remove someone or optimise.</div></div>';
  return h;
}
function pickerHtml(){
  const left=100-squadSpent();
  let h='<div class="card"><div class="lbl">Pick a '+({G:"goalkeeper",D:"defender",M:"midfielder",F:"forward"})[pickPos]+' &middot; &pound;'+left.toFixed(1)+'m available</div>';
  h+='<input type="text" id="pk" placeholder="Search" value="'+pickQ+'" oninput="pickQ=this.value;render();const e=document.getElementById(\'pk\');e.focus();e.setSelectionRange(e.value.length,e.value.length);">';
  h+='<button onclick="pickPos=null;render()" style="width:100%;background:transparent;border:1px solid var(--line);color:var(--sub);border-radius:8px;padding:7px 0;font-size:12px;margin:6px 0;">Cancel</button>';
  const elig=poolPlayers().filter(x=>x.p===pickPos&&!squadFlat().includes(x.n)&&(pickQ===""||x.n.toLowerCase().includes(pickQ.toLowerCase())||x.t.toLowerCase().includes(pickQ.toLowerCase())));
  elig.sort((a,b)=>metaOf(b.n)-metaOf(a.n));
  elig.slice(0,40).forEach(x=>{
    const afford=PRICE[x.n]<=left+0.001,capOk=clubCount(x.t)<3;
    const dis=!afford||!capOk;
    h+='<div class="row" style="'+(dis?'opacity:.35;':'cursor:pointer;')+'" '+(dis?'':'onclick="addPick(\''+esc(x.n)+'\')"')+'><span class="tc" style="background:'+(TEAMCOL[x.t]||'#888')+'22;color:'+(TEAMCOL[x.t]||'#aaa')+';">'+x.t+'</span><span class="pn">'+x.n+'<small>&pound;'+PRICE[x.n].toFixed(1)+'m'+(capOk?'':' &middot; club full')+(afford?'':' &middot; too dear')+'</small></span><span class="val" style="color:var(--a);font-weight:700;">'+metaOf(x.n)+'</span></div>';
  });
  return h+'</div>';
}
// ---- Best Picks (phase 6): the decision engine ----
let bpSource="K";
function ceilingOf(x){return x.pp*fxMult(x.t)*(statusOf(x.n)===2?0:1);}
function pickRow(x,extra,click){
  const c=confidenceOf(x);
  return '<div class="row" style="cursor:pointer;" onclick="'+(click||"openPlayer('"+esc(x.n)+"')")+'"><span class="tc" style="background:'+(TEAMCOL[x.t]||"#888")+'22;color:'+(TEAMCOL[x.t]||"#aaa")+';">'+x.t+'</span><span class="pn">'+x.n+'<small>'+POSNAME[x.p]+(PRICE[x.n]?' &middot; &pound;'+PRICE[x.n].toFixed(1)+'m':'')+(extra?' &middot; '+extra:'')+'</small></span><span class="conf" style="background:'+c.col+'1f;color:'+c.col+';">'+c.pct+'%</span><span class="val">'+predPts(x).toFixed(1)+'</span></div>';
}
function bestPicksView(){
  if(!LIVEOK)return '<div class="card"><div class="lbl">Needs live data</div><div style="font-size:13px;">Best Picks uses live prices, form and team news. '+(liveTries>3?"Tap a tab to retry.":"Connecting&hellip;")+'</div></div>';
  const squadNames=bpSource==="B"?squadFlat():P.filter(x=>x.o===bpSource).map(x=>x.n);
  const squad=squadNames.map(n=>P.find(y=>y.n===n)).filter(Boolean);
  let h='<div class="note"><b>What should I actually do?</b> One screen, six decisions, every one with a confidence percentage and a reason. Confidence is how much the model trusts its own number, not how good the player is: it comes from minutes certainty, whether the signals agree, and how much data exists yet.</div>';
  h+='<select onchange="bpSource=this.value;render()">'+[["K","Kevin\'s squad"],["L","Leo\'s squad"],["J","James\'s squad"],["B","My built squad"]].map(o=>'<option value="'+o[0]+'"'+(bpSource===o[0]?" selected":"")+'>'+o[1]+'</option>').join("")+'</select>';
  if(!squad.length)return h+'<div class="card"><div style="font-size:13px;">That squad is empty. Build one on the Builder tab first.</div></div>';
  const capt=squad.slice().sort((a,b)=>predPts(b)-predPts(a)).slice(0,3);
  h+='<div class="card"><div class="lbl">&#128081; Captain</div>';
  capt.forEach((x,i)=>{h+=pickRow(x,i===0?'ceiling '+ceilingOf(x).toFixed(1)+' pts':null,"CMP=['"+esc(x.n)+"'];findAlternatives();tab='compare';render()")});
  if(capt.length){const c=confidenceOf(capt[0]);
    h+='<div style="font-size:12px;color:var(--sub);margin-top:6px;line-height:1.6;"><b style="color:'+c.col+'">'+c.band+' confidence ('+c.pct+'%)</b>'+(c.why.length?' &middot; '+c.why.join(", "):'')+(c.risk.length?'<br>Watch: '+c.risk.join(", "):'')+'</div>';}
  h+='</div>';
  const warn=squad.map(x=>({x,c:confidenceOf(x)})).filter(r=>r.c.pct<60||statusOf(r.x.n)>0).sort((a,b)=>a.c.pct-b.c.pct);
  h+='<div class="card"><div class="lbl">&#9888; Warnings</div>';
  if(!warn.length)h+='<div style="font-size:12.5px;color:var(--sub);">Nothing flagged. Every player is expected to start with the signals agreeing.</div>';
  warn.slice(0,5).forEach(r=>{h+=pickRow(r.x,r.c.risk[0]||r.c.band.toLowerCase()+" confidence")});
  h+='</div>';
  const owned=new Set(squadNames);
  const targets=poolPlayers().filter(x=>!owned.has(x.n)&&(bpSource==="B"||x.o==="F")).sort((a,b)=>metaOf(b.n)-metaOf(a.n)).slice(0,5);
  const weakest=squad.slice().sort((a,b)=>metaOf(a.n)-metaOf(b.n))[0];
  h+='<div class="card"><div class="lbl">&#128260; Best transfer in</div>';
  targets.forEach(x=>{h+=pickRow(x,"Meta "+metaOf(x.n),"CMP=['"+esc(x.n)+"','"+esc(weakest?weakest.n:x.n)+"'];tab='compare';render()")});
  if(weakest)h+='<div style="font-size:12px;color:var(--sub);margin-top:6px;">Your weakest is <b>'+weakest.n+'</b> (Meta '+metaOf(weakest.n)+'). Tap any target to compare them side by side.</div>';
  h+='</div>';
  const diff=poolPlayers().filter(x=>(OWN[x.n]||0)<10&&startProb(x)>=75).sort((a,b)=>metaOf(b.n)-metaOf(a.n)).slice(0,4);
  h+='<div class="card"><div class="lbl">&#128142; Best differentials <span style="text-transform:none;letter-spacing:0;">(under 10% owned)</span></div>';
  diff.forEach(x=>{h+=pickRow(x,(OWN[x.n]||0).toFixed(1)+"% owned &middot; Meta "+metaOf(x.n))});
  h+='</div>';
  h+='<div class="card"><div class="lbl">&#11088; Best in each position</div>';
  ["G","D","M","F"].forEach(pos=>{
    const best=poolPlayers().filter(x=>x.p===pos).sort((a,b)=>predPts(b)-predPts(a))[0];
    if(best)h+=pickRow(best,POSNAME[pos]);
  });
  h+='</div>';
  const g0=META.gw||1;
  const runs=Object.keys(TEAMCOL).map(t=>{let s=0,n=0;for(let g=g0;g<Math.min(39,g0+5);g++){s+=fxMult(t,g);n++;}return {t,avg:s/n};}).sort((a,b)=>b.avg-a.avg);
  h+='<div class="card"><div class="lbl">&#128197; Best fixture runs &middot; next 5</div>';
  runs.slice(0,4).forEach((r,i)=>{h+='<div class="row"><span class="rk">'+(i+1)+'</span><span class="tc" style="background:'+TEAMCOL[r.t]+'22;color:'+TEAMCOL[r.t]+';">'+r.t+'</span><span class="pn" style="color:var(--sub);font-size:12.5px;">'+(r.avg>=1.2?"excellent run":r.avg>=1.05?"strong run":"decent run")+'</span><span class="val">'+r.avg.toFixed(2)+'</span></div>';});
  h+='</div>';
  return h;
}
// ---- Player Comparison (phase 6, Leo's spec) ----
let CMP=[],cmpQ="",cmpPick=false;
function cmpAdd(n){if(CMP.length<4&&!CMP.includes(n))CMP.push(n);cmpPick=false;cmpQ="";render();}
function cmpClear(){CMP=[];render();}
function findAlternatives(){
  if(CMP.length!==1)return;
  const x=P.find(y=>y.n===CMP[0]);if(!x)return;
  const price=PRICE[x.n]||99;
  poolPlayers().filter(y=>y.p===x.p&&y.n!==x.n&&(PRICE[y.n]||99)<=price+0.5)
    .sort((a,b)=>metaOf(b.n)-metaOf(a.n)).slice(0,3).forEach(y=>{if(CMP.length<4)CMP.push(y.n)});
}
function cmpWhy(a,b){
  const pa=metaParts(a),pb=metaParts(b);
  const d=pa.parts.map((c,i)=>({k:c[0].toLowerCase(),d:(c[2]===null?0:c[2])-(pb.parts[i][2]===null?0:pb.parts[i][2])}));
  const up=d.filter(z=>z.d>4).sort((x,y)=>y.d-x.d).slice(0,2).map(z=>z.k);
  const dn=d.filter(z=>z.d<-4).sort((x,y)=>x.d-y.d).slice(0,1).map(z=>z.k);
  let s=a.n+' rates higher';
  if(up.length)s+=' on '+up.join(' and ');
  s+='. ';
  if(dn.length)s+=b.n+' wins on '+dn[0]+', so if that matters most to you the call flips.';
  else s+=b.n+' does not clearly beat him anywhere, so this is a straight upgrade.';
  return s;
}
function compareView(){
  if(!LIVEOK)return '<div class="card"><div class="lbl">Needs live data</div><div style="font-size:13px;">Comparison uses live prices and form. '+(liveTries>3?"Tap a tab to retry.":"Connecting&hellip;")+'</div></div>';
  let h='<div class="note"><b>Who should I buy?</b> Put any two to four players side by side, see who wins each category, and read why in one sentence.</div>';
  h+='<div class="card"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
  CMP.forEach(n=>{h+='<span class="chip" onclick="CMP=CMP.filter(x=>x!==\''+esc(n)+'\');render()">'+n+' &times;</span>';});
  if(CMP.length<4)h+='<button onclick="cmpPick=true;cmpQ=\'\';render()" style="background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;">+ Add player</button>';
  if(CMP.length===1)h+='<button onclick="findAlternatives();render()" style="background:transparent;border:1px solid var(--a);color:var(--a);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;">Find alternatives</button>';
  if(CMP.length)h+='<button onclick="cmpClear()" style="background:transparent;border:1px solid var(--line);color:var(--sub);border-radius:8px;padding:6px 10px;font-size:12px;">Clear</button>';
  h+='</div>';
  if(cmpPick){
    h+='<input type="text" id="cq" placeholder="Search a player" value="'+cmpQ+'" style="margin-top:8px;" oninput="cmpQ=this.value;render();const e=document.getElementById(\'cq\');e.focus();e.setSelectionRange(e.value.length,e.value.length);">';
    poolPlayers().filter(x=>!CMP.includes(x.n)&&(cmpQ===""||x.n.toLowerCase().includes(cmpQ.toLowerCase())||x.t.toLowerCase().includes(cmpQ.toLowerCase()))).sort((a,b)=>metaOf(b.n)-metaOf(a.n)).slice(0,12).forEach(x=>{
      h+='<div class="row" style="cursor:pointer;" onclick="cmpAdd(\''+esc(x.n)+'\')"><span class="tc" style="background:'+(TEAMCOL[x.t]||"#888")+'22;color:'+(TEAMCOL[x.t]||"#aaa")+';">'+x.t+'</span><span class="pn">'+x.n+'<small>'+POSNAME[x.p]+' &middot; &pound;'+(PRICE[x.n]||0).toFixed(1)+'m</small></span><span class="val" style="color:var(--a);font-weight:700;">'+metaOf(x.n)+'</span></div>';});
  }
  h+='</div>';
  if(CMP.length<2)return h+'<div class="card"><div style="font-size:13px;color:var(--sub);">Add at least two players to compare. Tip: add one and tap <b>Find alternatives</b> to line him up against the best players you could swap him for.</div></div>';
  const ps=CMP.map(n=>P.find(y=>y.n===n)).filter(Boolean);
  const mp=ps.map(x=>metaParts(x));
  h+='<div class="card"><div class="lbl">Overall Meta</div>';
  const maxM=Math.max.apply(null,mp.map(m=>m.total));
  ps.forEach((x,i)=>{h+='<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px;"><span>'+x.n+' <span style="color:var(--sub);">&pound;'+(PRICE[x.n]||0).toFixed(1)+'m</span></span><span style="font-weight:700;color:var(--a);">'+mp[i].total+'</span></div><div class="bar"><i style="width:'+(mp[i].total/Math.max(maxM,1)*100)+'%;"></i></div></div>';});
  h+='</div>';
  h+='<div class="card"><div class="lbl">Category by category</div>';
  h+='<div class="crow" style="color:var(--sub);font-size:11px;"><span class="ck"></span>'+ps.map(x=>'<span class="cv">'+x.n.split(" ").slice(-1)[0]+'</span>').join("")+'</div>';
  const wins=ps.map(()=>0);
  mp[0].parts.forEach((c,ci)=>{
    const vals=mp.map(m=>m.parts[ci][2]);
    const best=Math.max.apply(null,vals.map(v=>v===null?-1:v));
    if(best>=0)vals.forEach((v,i)=>{if(v===best)wins[i]++;});
    h+='<div class="crow"><span class="ck">'+c[0]+'</span>'+vals.map(v=>'<span class="cv"'+(v!==null&&v===best?' style="color:var(--a);font-weight:700;"':'')+'>'+(v===null?"&mdash;":Math.round(v))+'</span>').join("")+'</div>';
  });
  h+='<div class="crow" style="border-top:1px solid var(--line);font-weight:700;"><span class="ck">Confidence</span>'+ps.map(x=>{const c=confidenceOf(x);return '<span class="cv" style="color:'+c.col+';">'+c.pct+'%</span>';}).join("")+'</div>';
  h+='</div>';
  const order=ps.map((x,i)=>({x,i,m:mp[i].total})).sort((a,b)=>b.m-a.m);
  const win=order[0],second=order[1];
  const bestOf=(fn)=>ps.map((x,i)=>({x,v:fn(x,mp[i])})).sort((a,b)=>b.v-a.v)[0].x.n;
  h+='<div class="card"><div class="lbl">&#127942; Verdict</div>';
  const otherWins=wins.filter((w,i)=>i!==win.i).reduce((a,b)=>a+b,0);
  const margin=win.m-second.m;
  h+='<div style="font-size:14px;font-weight:700;margin-bottom:2px;">'+win.x.n+(margin>=5?' wins it':margin>=2?' edges it':' shades it')+' &middot; Meta '+win.m+' v '+second.m+'</div>';
  h+='<div style="font-size:12px;color:var(--sub);margin-bottom:6px;">Categories won: '+win.x.n.split(" ").slice(-1)[0]+' '+wins[win.i]+', '+(ps.length===2?second.x.n.split(" ").slice(-1)[0]+' '+otherWins:'others '+otherWins)+(wins[win.i]===otherWins?' &middot; level on categories, so Meta decides it':'')+'</div>';
  h+='<div style="font-size:12.5px;line-height:1.9;">';
  h+='<div>&#129351; Best overall: <b>'+win.x.n+'</b></div>';
  h+='<div>&#128176; Best value: <b>'+bestOf(function(x,m){return m.parts[4][2]===null?-1:m.parts[4][2];})+'</b></div>';
  h+='<div>&#128197; Best fixtures: <b>'+bestOf(function(x,m){return m.parts[2][2];})+'</b></div>';
  h+='<div>&#128142; Best differential: <b>'+ps.slice().sort((a,b)=>(OWN[a.n]||0)-(OWN[b.n]||0))[0].n+'</b></div>';
  h+='<div>&#128737; Safest pick: <b>'+ps.slice().sort((a,b)=>confidenceOf(b).pct-confidenceOf(a).pct)[0].n+'</b></div>';
  h+='</div>';
  h+='<div style="font-size:12.5px;color:var(--sub);margin-top:8px;line-height:1.6;border-top:1px solid var(--line);padding-top:7px;"><b style="color:var(--txt);">Why?</b> '+cmpWhy(win.x,second.x)+'</div>';
  h+='</div>';
  return h;
}
// ---- Player profile (phase 7) ----
let FOCUS=null,focusFrom="players";
function openPlayer(n){FOCUS=n;focusFrom=tab;window.scrollTo(0,0);render();}
function closePlayer(){FOCUS=null;render();}
function starsFor(m){const s=m>=1.25?5:m>=1.1?4:m>=0.95?3:m>=0.75?2:m>0?1:0;return s===0?'<span style="color:var(--sub);">blank</span>':'<span style="color:var(--accent-gold,#C6A15B);letter-spacing:1px;">'+"\u2605".repeat(s)+'</span>';}
function playerView(){
  const x=P.find(y=>y.n===FOCUS);
  if(!x)return '<div class="card">Player not found.</div>';
  const m=metaParts(x),c=confidenceOf(x),f=predParts(x),ev=eventProbs(x),g0=META.gw||1;
  let h='<button onclick="closePlayer()" style="background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;margin-bottom:10px;">&larr; Back</button>';
  // Header
  h+='<div class="card"><div style="display:flex;align-items:center;gap:10px;">';
  h+='<div style="width:46px;height:46px;border-radius:10px;background:'+(TEAMCOL[x.t]||"#888")+'22;color:'+(TEAMCOL[x.t]||"#aaa")+';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;">'+x.t+'</div>';
  h+='<div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:700;">'+x.n+'</div><div style="font-size:12px;color:var(--sub);">'+POSNAME[x.p]+' &middot; &pound;'+(PRICE[x.n]||0).toFixed(1)+'m &middot; '+(OWN[x.n]||0).toFixed(1)+'% owned &middot; '+(x.o==="F"?"undrafted":NAMES[x.o]+"'s")+'</div></div>';
  h+='<div style="text-align:right;"><div style="font-size:24px;font-weight:800;color:var(--a);line-height:1;">'+m.total+'</div><div style="font-size:10px;color:var(--sub);text-transform:uppercase;letter-spacing:.8px;">Meta</div></div>';
  h+='</div>';
  h+='<div style="display:flex;gap:8px;margin-top:10px;">';
  h+='<div style="flex:1;background:var(--card2);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;">'+f.pred.toFixed(1)+'</div><div style="font-size:10px;color:var(--sub);">predicted GW'+g0+'</div></div>';
  h+='<div style="flex:1;background:var(--card2);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;color:'+c.col+';">'+c.pct+'%</div><div style="font-size:10px;color:var(--sub);">confidence</div></div>';
  h+='<div style="flex:1;background:var(--card2);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:18px;font-weight:800;">'+Math.round(startProb(x))+'%</div><div style="font-size:10px;color:var(--sub);">start chance</div></div>';
  h+='</div></div>';
  // Event probabilities
  h+='<div class="card"><div class="lbl">What he is likely to DO in GW'+g0+'</div>';
  if(!ev)h+='<div style="font-size:12.5px;color:var(--sub);">Not enough match evidence yet. He has '+((XG[x.n]||{}).mins||0)+' minutes on record, and these probabilities need at least 180. They appear once he has played.</div>';
  else if(ev.ruledOut)h+='<div style="font-size:12.5px;color:#e08a76;">Ruled out of this gameweek, so every probability is zero.</div>';
  else if(ev.blank)h+='<div style="font-size:12.5px;color:var(--sub);">'+x.t+' have no fixture in GW'+g0+' (blank gameweek).</div>';
  else{
    h+=pctBar("Plays 60+ minutes",ev.p60);
    h+=pctBar("Scores a goal",ev.pG);
    h+=pctBar("Gets an assist",ev.pA);
    h+=pctBar("Any attacking return",ev.any,"var(--b)");
    if(ev.pCS!==null)h+=pctBar("Clean sheet",ev.pCS,"var(--b)");
    h+='<div style="font-size:11.5px;color:var(--sub);line-height:1.7;border-top:1px solid var(--line);padding-top:6px;">From his official expected-goals rates ('+ev.xg.toFixed(2)+' xG and '+ev.xa.toFixed(2)+' xA per 90'+(ev.pCS!==null?', '+ev.xgc.toFixed(2)+' conceded per 90':'')+') over '+ev.sample+' minutes played, scaled to about '+ev.mins+' minutes in this fixture. Probabilities assume goals arrive at random within that rate.</div>';
  }
  h+='</div>';
  // Meta breakdown
  h+='<div class="card"><div class="lbl">Why Meta '+m.total+'?</div><div style="font-size:12.5px;line-height:1.9;">';
  m.parts.forEach(pt=>{h+='<div style="display:flex;justify-content:space-between;"><span style="color:var(--sub);">'+pt[0]+' <span style="font-size:10.5px;">('+Math.round(pt[1]/m.wsum*100)+'%)</span></span><span'+(pt[2]===null?' style="color:var(--sub);"':'')+'>'+(pt[2]===null?"no data yet":Math.round(pt[2])+"/100")+'</span></div>';});
  h+='</div></div>';
  // Confidence reasoning
  h+='<div class="card"><div class="lbl">Confidence</div><div style="font-size:13px;font-weight:700;color:'+c.col+';margin-bottom:4px;">'+c.band+' &middot; '+c.pct+'%</div><div style="font-size:12.5px;line-height:1.7;">';
  if(c.why.length)h+='<div>&#10003; '+c.why.join(", ")+'</div>';
  if(c.risk.length)h+='<div style="color:var(--warn);">&#9888; '+c.risk.join(", ")+'</div>';
  h+='</div></div>';
  // Next 6 gameweeks
  h+='<div class="card"><div class="lbl">Next 6 gameweeks</div>';
  for(let g=g0;g<Math.min(39,g0+6);g++){
    const mm=fxMult(x.t,g),pp=predPtsAt(x,g);
    h+='<div class="row"><span class="rk">GW'+g+'</span><span class="pn">'+starsFor(mm)+(mm>1.5?' <span style="font-size:10px;color:var(--a);">double</span>':'')+'</span><span class="val">'+pp.toFixed(1)+'</span></div>';
  }
  h+='<div style="font-size:11.5px;color:var(--sub);margin-top:6px;">Stars are that club\'s fixture difficulty; the number is his predicted points that week.</div></div>';
  // Actions
  h+='<div style="display:flex;gap:6px;">';
  h+='<button onclick="CMP=[\''+esc(x.n)+'\'];findAlternatives();tab=\'compare\';FOCUS=null;render()" style="flex:1;background:var(--card2);border:1px solid var(--a);color:var(--a);border-radius:8px;padding:9px 0;font-size:12.5px;font-weight:700;">Compare with alternatives</button>';
  h+='</div>';
  return h;
}
function accuracyView(){
  if(ACC.list===null&&!ACC.loading)setTimeout(loadAccuracy,0);
  let h='<div class="note"><b>Does the model actually work?</b> In the final 2 hours before every deadline the system freezes a copy of what the model knew. After the matches, predictions are compared with real FPL points here. Frozen records cannot be edited after the deadline, so the score is honest by construction.</div>';
  if(ACC.loading)h+='<div class="card"><div class="lbl">Loading</div><div style="font-size:13px;">Fetching prediction history&hellip;</div></div>';
  else if(ACC.error)h+='<div class="card"><div class="lbl">Unavailable</div><div style="font-size:13px;">Could not reach the history store. Reopen this tab to retry.</div></div>';
  else if(!ACC.list||!ACC.list.length)h+='<div class="card"><div class="lbl">No records yet</div><div style="font-size:13px;">The first snapshot is taken automatically before the GW1 deadline ('+(DEADLINE||'Fri 21 Aug')+'). Come back after the first matches finish.</div></div>';
  (ACC.list||[]).forEach(s=>{
    const snap=ACC.detail[s.gw];if(!snap)return;
    const act=ACC.actual[s.gw];
    const preds=P.map(x=>({x,p:predFromSnap(x,snap)})).filter(r=>r.p!==null);
    preds.sort((a,b)=>b.p-a.p);
    h+='<div class="card"><div class="lbl">Gameweek '+s.gw+' &middot; frozen '+new Date(snap.taken).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+'</div>';
    if(!act){
      h+='<div style="font-size:12.5px;color:var(--sub);margin-bottom:6px;">Snapshot locked &middot; awaiting results. Top 10 predicted:</div>';
      preds.slice(0,10).forEach((r,i)=>{h+='<div class="row"><span class="rk">'+(i+1)+'</span><span class="pn">'+r.x.n+'<small>'+r.x.t+' '+POSNAME[r.x.p]+'</small></span><span class="val">'+r.p.toFixed(1)+'</span></div>';});
    }else{
      const scored=preds.map(r=>({...r,a:act[FPLID[r.x.n]]!==undefined?act[FPLID[r.x.n]]:null})).filter(r=>r.a!==null);
      const mae=scored.reduce((s,r)=>s+Math.abs(r.p-r.a),0)/scored.length;
      const predTop=scored.slice(0,10);
      const actTop=new Set(scored.slice().sort((a,b)=>b.a-a.a).slice(0,10).map(r=>r.x.n));
      const hits=predTop.filter(r=>actTop.has(r.x.n)).length;
      h+='<div style="font-size:12.5px;margin-bottom:6px;">Average miss: <b>'+mae.toFixed(1)+' pts</b> per player &middot; predicted top 10: <b>'+hits+'/10</b> were really in the top 10</div>';
      h+='<div style="font-size:11px;color:var(--sub);margin-bottom:4px;display:flex;justify-content:space-between;"><span>Predicted top 10</span><span>predicted &rarr; actual</span></div>';
      predTop.forEach((r,i)=>{
        const good=Math.abs(r.p-r.a)<=2;
        h+='<div class="row"><span class="rk">'+(i+1)+'</span><span class="pn">'+r.x.n+'<small>'+r.x.t+' '+POSNAME[r.x.p]+'</small></span><span class="val" style="color:'+(good?'var(--a)':'var(--sub)')+'">'+r.p.toFixed(1)+' &rarr; '+r.a+'</span></div>';});
    }
    h+='</div>';
  });
  return h;
}
const INJLBL=["Fit","Doubt","Out"];
function cycleInj(n){const cur=statusOf(n);const nx=(cur+1)%3;const live=LIVESTAT[n]!==undefined?LIVESTAT[n]:0;if(nx===live)delete INJ[n];else INJ[n]=nx;saveInj();render();}
// THE single weekly number. One formula, four inputs:
// WeekScore = draft value (quality) x fixture (this GW) x availability x momentum
function fxMult(t,g){
  g=g===undefined?gwSel:g;
  if(LIVEFX&&LIVEFX[t])return LIVEFX[t][g]||0; // no fixture = blank GW = 0; double GW = both games summed
  if(g<=5)return (MOD[t]||[1,1,1,1,1])[g-1];
  return FXW[t]?0.4+FXW[t]*0.2:1;
}
function predPtsAt(x,g){const s=gwSel;gwSel=g;const v=predPts(x);gwSel=s;return v;}
function startProb(x){const s=statusOf(x.n);return s===2?0:(CHANCE[x.n]!=null?CHANCE[x.n]:(s===1?50:100));}
function plannerView(){
  let h='<div class="card"><div class="lbl">Data status</div><div style="font-size:13px;">Gameweek '+META.gw+' &middot; '+META.date+'</div>';
  if(LIVEOK)h+='<div style="font-size:11.5px;color:var(--a);margin:2px 0 8px;">&#9679; Live: prices, injuries and fixture difficulty from the official FPL feed &middot; '+META.updated+'</div>';
  else h+='<div style="font-size:11.5px;color:var(--warn);margin:2px 0 8px;">Live feed unreachable &mdash; using stored data ('+META.updated+'). Tap refresh to retry.</div>';
  h+='<button id="refBtn" onclick="refreshLive()" style="width:100%;background:var(--card2);border:1px solid #3d4854;color:var(--txt);border-radius:8px;padding:9px 0;font-size:13px;font-weight:600;margin-bottom:6px;">Refresh live data</button>';
  h+='<textarea id="packBox" placeholder="Optional: paste a momentum data pack from Claude chat here" style="width:100%;background:var(--card2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 10px;font-size:12px;height:52px;margin-bottom:6px;"></textarea>';
  h+='<button onclick="applyPack(document.getElementById(\'packBox\').value)" style="width:100%;background:transparent;border:1px solid var(--line);color:var(--sub);border-radius:8px;padding:8px 0;font-size:12.5px;font-weight:600;">Apply pack</button></div>';
  h+='<select onchange="planTeam=this.value;render()">'+["K","L","J"].map(o=>'<option value="'+o+'"'+(planTeam===o?" selected":"")+'>'+NAMES[o]+"'s plan</option>").join("")+'</select>';
  const gws=[];for(let g=Math.max(1,META.gw-1);g<=Math.min(38,META.gw+3);g++)gws.push(g);
  h+='<div class="filters">'+gws.map(g=>'<button onclick="gwSel='+g+';render()" class="'+(gwSel===g?"on":"")+'">GW'+g+'</button>').join("")+'</div>';
  const mine=P.filter(x=>x.o===planTeam).map(x=>({...x,e:predPts(x)}));
  const gk=mine.filter(x=>x.p==="G").sort((a,b)=>b.e-a.e);
  const out=mine.filter(x=>x.p!=="G").sort((a,b)=>b.e-a.e);
  let xi=[gk[0]],d=0,m=0,f=0;
  out.forEach(x=>{if(xi.length>=11)return;
    const left=11-xi.length;const needD=Math.max(0,3-d),needM=Math.max(0,3-m),needF=Math.max(0,1-f);
    const reserved=needD+needM+needF;
    const isNeeded=(x.p==="D"&&needD>0)||(x.p==="M"&&needM>0)||(x.p==="F"&&needF>0);
    if(isNeeded||left>reserved){xi.push(x);if(x.p==="D")d++;if(x.p==="M")m++;if(x.p==="F")f++;}
  });
  const bench=mine.filter(x=>!xi.includes(x));
  function factorsHtml(x){
    const f=predParts(x);
    let rows=f.sig.map(s=>'<div style="display:flex;justify-content:space-between;"><span>'+s[0]+' ('+Math.round(s[1]/f.wsum*100)+'%)</span><span>'+s[2].toFixed(2)+' pts</span></div>').join('');
    rows+='<div style="display:flex;justify-content:space-between;"><span>Blended base</span><span>'+f.base.toFixed(2)+' pts</span></div>';
    rows+='<div style="display:flex;justify-content:space-between;"><span>Fixture</span><span>&times;'+f.fx.toFixed(2)+(f.fx===0?' (blank GW)':f.fx>1.5?' (double GW)':'')+'</span></div>';
    rows+='<div style="display:flex;justify-content:space-between;"><span>Availability</span><span>&times;'+f.avail.toFixed(2)+'</span></div>';
    if(f.mom!==1)rows+='<div style="display:flex;justify-content:space-between;"><span>Momentum</span><span>&times;'+f.mom.toFixed(2)+'</span></div>';
    rows+='<div style="display:flex;justify-content:space-between;font-weight:700;color:var(--txt);border-top:1px solid var(--line);padding-top:4px;margin-top:2px;"><span>Predicted</span><span>'+f.pred.toFixed(1)+' pts</span></div>';
    const cc=confidenceOf(x);
    rows+='<div style="margin-top:5px;color:'+cc.col+';font-weight:700;">'+cc.band+' confidence &middot; '+cc.pct+'%</div>';
    if(cc.why.length)rows+='<div>Because '+cc.why.join(", ")+'.</div>';
    if(cc.risk.length)rows+='<div>Watch: '+cc.risk.join(", ")+'.</div>';
    return '<div style="font-size:11.5px;color:var(--sub);padding:6px 4px 8px 34px;border-bottom:1px solid var(--line);line-height:1.8;">'+rows+'</div>';
  }
  function prow(x,strong){
    const inj=statusOf(x.n);const mo=MOM[x.n]||0;
    const ch=CHANCE[x.n]!=null?'<span style="font-size:10px;font-weight:700;color:var(--warn);flex-shrink:0;">'+CHANCE[x.n]+'%</span>':'';
    const cf=confChip(x);
    const moChip=mo?'<span style="font-size:10px;font-weight:700;color:'+(mo>0?'var(--a)':'#e08a76')+';flex-shrink:0;">'+(mo>0?'&#9650;':'&#9660;')+Math.abs(mo)+'</span>':'';
    return '<div class="row"'+(inj===2?' style="opacity:.4"':'')+'><span class="fxbar fx'+fxOf(x.t)+'">'+x.t+'</span><span class="pn" style="cursor:pointer;" onclick="expanded=expanded===\''+esc(x.n)+'\'?null:\''+esc(x.n)+'\';render()">'+x.n+'<small>'+POSNAME[x.p]+(PRICE[x.n]?' &middot; &pound;'+PRICE[x.n].toFixed(1)+'m':'')+'</small></span>'+ch+moChip+cf+'<span class="val">'+x.e.toFixed(1)+'</span><button onclick="cycleInj(\''+esc(x.n)+'\')" style="border:1px solid var(--line);background:'+(inj===2?'rgba(224,110,90,.18)':inj===1?'rgba(224,168,76,.15)':'transparent')+';color:'+(inj===2?'#e08a76':inj===1?'var(--warn)':'var(--sub)')+';border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;flex-shrink:0;width:52px;">'+INJLBL[inj]+'</button></div>'+(expanded===x.n?factorsHtml(x):'');
  }
  h+='<div class="card"><div class="lbl">Recommended XI &middot; Gameweek '+gwSel+' &middot; predicted points &middot; tap a name for why</div>';
  xi.sort((a,b)=>ORDER[a.p]-ORDER[b.p]||b.e-a.e).forEach(x=>{h+=prow(x)});
  h+='</div><div class="card"><div class="lbl">Bench</div>';
  bench.sort((a,b)=>b.e-a.e).forEach(x=>{h+=prow(x)});
  h+='</div>';
  const free=P.filter(x=>x.o==="F").map(x=>({...x,e:predPts(x)})).sort((a,b)=>b.e-a.e);
  h+='<div class="card"><div class="lbl">Waiver targets this gameweek</div>';
  let shown=0;
  free.forEach(x=>{if(shown>=10)return;
    const weak=mine.filter(y=>y.p===x.p).sort((a,b)=>a.e-b.e)[0];
    if(weak&&x.e>weak.e){shown++;
      h+='<div class="row"><span class="fxbar fx'+fxOf(x.t)+'">'+x.t+'</span><span class="pn">'+x.n+'<small>'+POSNAME[x.p]+'</small></span><span class="val">'+x.e.toFixed(1)+'</span><span style="font-size:11px;color:var(--sub);flex-shrink:0;">for '+weak.n.split(" ").slice(-1)[0]+' ('+weak.e.toFixed(1)+')</span></div>';}
  });
  if(!shown)h+='<div class="note" style="margin:0">No free agent beats this squad this week. Hold.</div>';
  h+='</div>';
  h+='<div class="note"><b>Predicted points, openly worked.</b> Every number here is predicted FPL points for the selected gameweek: a blend of the draft projection (40%), live form (30%) and the official FPL expected score (30%), weights renormalised when a signal is missing, then multiplied by fixture, availability and momentum. Tap any player name to see the exact working. Until real matches are played, form is empty and the model leans on projection plus the official expectation. Squad standings on the Squads tab still use the fixed draft value, so the family table never moves under you. Never drop an A-grade on one bad week.</div>';
  return h;
}
document.querySelector(".tabs").addEventListener("click",e=>{if(e.target.dataset.t){tab=e.target.dataset.t;render()}});
render();
loadLive();
