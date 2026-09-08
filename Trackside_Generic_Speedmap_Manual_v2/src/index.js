const TAB_BASE = "https://api.tab.co.nz/affiliates/v1/racing";
const SHOW_KEY = "show:current";
const SPEEDMAP_KEY_PREFIX = "speedmap:";
const TEMPLATES = {
  8:  { master: "FF_Speedmap_8",  state: "0" },
  12: { master: "FF_Speedmap_12", state: "1" },
  16: { master: "FF_Speedmap_16", state: "0" },
  24: { master: "FF_Speedmap_24", state: "0" }
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function esc(v){
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function clamp(v){
  const n=Number(v);
  return Number.isFinite(n) ? Math.max(0,Math.min(100,Math.round(n*10)/10)) : 50;
}
function templateFor(count){
  if(count<=8)return TEMPLATES[8];
  if(count<=12)return TEMPLATES[12];
  if(count<=16)return TEMPLATES[16];
  if(count<=24)return TEMPLATES[24];
  return null;
}
function meetingNumberOf(v){
  for(const x of [v?.tote_meeting_number,v?.meeting_number,v?.meetingNumber,v?.meeting_no,v?.meeting_no_today,v?.sequence,v?.order]){
    const n=Number(x); if(Number.isFinite(n)) return n;
  }
  return "";
}
async function tabJSON(url){
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":"Trackside-Generic-Speedmap/1.0"}});
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok){throw new Error(`TAB ${r.status}: ${data?.message||data?.error||"request failed"}`)}
  return data;
}
async function getShow(env){
  const raw=await env.SELECTIONS_KV.get(SHOW_KEY);
  return raw?JSON.parse(raw):null;
}
async function eventById(id){
  const d=await tabJSON(`${TAB_BASE}/events/${encodeURIComponent(id)}?enc=json`);
  const x=d?.data||d||{};
  const race=x.race||{};
  const results=x.results||[];
  return {
    race:{
      event_id:race.event_id??id,
      meeting_id:race.meeting_id??null,
      venue:race.venue_name||race.track||"",
      name:race.description||race.race_name||race.name||"",
      number:race.race_number??"",
      distance:race.distance??"",
      meeting_number:meetingNumberOf(race),
      country:race.country||""
    },
    runners:(x.runners||[]).map(r=>({
      runner_number:r.runner_number,
      name:r.name,
      barrier:r.barrier??r.gate??r.barrier_number??null,
      is_scratched:r.is_scratched
    })),
    results
  };
}
function speedmapKey(eventId){return `${SPEEDMAP_KEY_PREFIX}${eventId}`}
function cdata(v){
  return String(v ?? "").replace(/\]\]>/g, "]]]]><![CDATA[>");
}
function wrapper(v){
  const text=String(v ?? "");
  if(!text) return '<fo:wrapper xmlns:fo="http://www.w3.org/1999/XSL/Format"/>';
  return `<fo:wrapper xmlns:fo="http://www.w3.org/1999/XSL/Format"><![CDATA[${cdata(text)}]]></fo:wrapper>`;
}
function titleParts(race, secondaryOverride){
  const venue=String(race.venue||race.venue_name||"").trim();
  const name=String(race.name||race.description||"").trim();
  const meeting=meetingNumberOf(race);
  const rn=String(race.number??race.race_number??"").trim();
  const distance=String(race.distance??"").trim().replace(/\s+/g,"");
  return {
    heading:`${venue}${rn ? ` - RACE ${rn}` : ""}`.trim(),
    secondary:String(secondaryOverride ?? race.secondary ?? name).trim(),
    extra:`${meeting!==""?`M${meeting}`:"M"} | ${rn!==""?`R${rn}`:"R"} | ${distance}`
  };
}
function buildRunner(r,i){
  return `<element name="${i===0?"element":`element#${i+1}`}" ><entry name="data"><entry name="0101">100</entry><entry name="0101.R1">${clamp(r.speedMap).toFixed(1)}</entry><entry name="0102">${esc(r.runnerNumber)}.</entry><entry name="0103">${esc(String(r.horseName||"").toUpperCase())}</entry></entry></element>`;
}
function buildElement(env,race,rows,index){
  const tpl=templateFor(rows.length); if(!tpl) throw new Error(`Speed Map supports up to 24 runners; this race has ${rows.length}.`);
  const t=titleParts(race, race.secondary);
  const nested=rows.map(buildRunner).join("");
  const payload=`<payload xmlns="http://www.vizrt.com/types"><field name="101"><value>${esc(wrapper(t.heading))}</value></field><field name="102"><value>${esc(wrapper(t.secondary))}</value></field><field name="103"><value>${esc(wrapper(t.extra))}</value></field><field name="106"><value>${tpl.state}</value></field><field name="104"><list /></field><field name="105"><value>${rows.length}</value></field></payload>`;
  const desc=`${String(race.venue||"").trim()}/${String(t.secondary||"").trim()}/${t.extra}/${t.heading}/${String(race.distance||"").trim()}/${rows.length}/${tpl.state}`;
  return `<element available="1.00" description="${esc(desc)}" layer="[MAIN]" loaded="0.00" showautodescription="true" take_count="0" name="${1001+index}">
<ref name="master_template">/storage/shows/${env.VIZ_SHOW_ID}/mastertemplates/${tpl.master}</ref>
<entry name="default_alternatives"/>
<entry name="data">
<entry name="101">${wrapper(t.heading)}</entry>
<entry name="102">${wrapper(t.secondary)}</entry>
<entry name="103">${wrapper(t.extra)}</entry>
<entry name="104"><xml name="xml"><entry name="entry">${nested}</entry></xml></entry>
<entry name="105">${rows.length}</entry>
<entry name="106">${tpl.state}</entry>
</entry>
<entry name="dblink"><entry name="101"/><entry name="102"/><entry name="103"/><entry name="104"/></entry>
<entry name="settings"><entry name="tabfields"><entry name="101"/><entry name="102"/><entry name="103"/><entry name="104"/><entry name="105"/><entry name="106"/></entry><entry name="isfilescript">false</entry><entry name="modified">${new Date().toISOString().slice(0,19)}</entry></entry>
<entry usage="updating" name="payload_xml">${esc(payload)}</entry>
</element>`;
}
async function loadMaps(env){
  const show=await getShow(env);
  if(!show)return {show:null,maps:[]};
  const maps=[];
  for(const race of (show.races||[])){
    const raw=await env.SELECTIONS_KV.get(speedmapKey(String(race.event_id)));
    maps.push({eventId:String(race.event_id),map:raw?JSON.parse(raw):null});
  }
  return {show,maps};
}
async function handle(request,env){
  const u=new URL(request.url); const p=u.pathname;
  if(p==="/api/health") return json({ok:true,service:"generic-speedmap"});
  if(p==="/api/speedmaps"&&request.method==="GET"){
    try{return json(await loadMaps(env))}catch(e){return json({error:e.message},500)}
  }
  if(p==="/api/event"&&request.method==="GET"){
    const id=u.searchParams.get("id"); if(!id)return json({error:"Event id required"},400);
    try{return json(await eventById(id))}catch(e){return json({error:e.message},502)}
  }
  if(p==="/api/speedmap"&&request.method==="POST"){
    try{
      const body=await request.json(); const eventId=String(body.eventId||"");
      if(!eventId)return json({error:"Event id required"},400);
      const runners=(Array.isArray(body.runners)?body.runners:[]).map(r=>({barrier:r.barrier??null,runnerNumber:String(r.runnerNumber??""),horseName:String(r.horseName??""),speedMap:clamp(r.speedMap)}));
      const secondary=String(body.secondary??"").trim();
      runners.sort((a,b)=>Number(a.barrier??9999)-Number(b.barrier??9999));
      await env.SELECTIONS_KV.put(speedmapKey(eventId),JSON.stringify({eventId,secondary,runners,updatedAt:new Date().toISOString()}));
      return json({ok:true,speedmap:{eventId,runners}});
    }catch(e){return json({error:e.message},400)}
  }
  if(p==="/api/export/speedmaps"&&request.method==="GET"){
    try{
      const show=await getShow(env); if(!show)return json({error:"No races have been set by the producer yet."},404);
      const elements=[];
      for(let i=0;i<(show.races||[]).length;i++){
        const race=show.races[i]; const raw=await env.SELECTIONS_KV.get(speedmapKey(String(race.event_id)));
        let map=raw?JSON.parse(raw):null;
        if(!map){const ev=await eventById(race.event_id);map={secondary:"",runners:(ev.runners||[]).filter(r=>!r.is_scratched).sort((a,b)=>Number(a.barrier??9999)-Number(b.barrier??9999)).map(r=>({barrier:r.barrier,runnerNumber:String(r.runner_number??""),horseName:r.name||"",speedMap:50}))};}
        const ev=await eventById(race.event_id);
        const mergedRace={...race,venue:ev.race.venue||race.venue_name,name:ev.race.name||race.description,number:ev.race.number||race.race_number,distance:ev.race.distance||race.distance,meeting_number:ev.race.meeting_number||race.meeting_number,secondary:map.secondary||""};
        const rows=(map.runners||[]).filter(r=>r.horseName||r.runnerNumber).sort((a,b)=>Number(a.barrier??9999)-Number(b.barrier??9999));
        elements.push(buildElement(env,mergedRace,rows,i));
      }
      const xml=`<?xml version="1.0" encoding="UTF-8"?><archive version="1.0" creator="trio" creator_version="${esc(env.VIZ_CREATOR_VERSION||"")}"><vdom><entry name="storage"><entry name="shows"><entry name="${esc(env.VIZ_SHOW_ID)}"><entry name="elements">${elements.join("\n")}</entry></entry></entry></entry></vdom></archive>`;
      return new Response(xml,{headers:{"content-type":"application/xml; charset=utf-8","content-disposition":`attachment; filename="generic-speedmaps-${show.date||"export"}.xml"`}});
    }catch(e){return json({error:e.message},400)}
  }
  if(p.startsWith("/api/")) return json({error:"Not found"},404);
  return env.ASSETS.fetch(request);
}
export default {fetch:handle};
