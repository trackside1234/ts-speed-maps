const TAB_BASE = "https://api.tab.co.nz/affiliates/v1/racing";

function json(data, status=200){
  return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function esc(v){return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&apos;");}
function num(v, fallback=50){const n=Number(v); return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n*10)/10)):fallback;}
function meetingNo(m){for(const v of [m?.tote_meeting_number,m?.meeting_number,m?.meetingNumber,m?.meeting_no,m?.sequence,m?.order]){const n=Number(v);if(Number.isFinite(n))return n;}return 9999;}
async function tab(url){const r=await fetch(url,{headers:{accept:"application/json","user-agent":"Trackside-Generic-Speedmap/1.0"}});const t=await r.text();let d;try{d=JSON.parse(t)}catch{d={raw:t}}if(!r.ok)throw new Error(`TAB ${r.status}: ${d?.message||d?.error||"request failed"}`);return d;}
async function meetings(date){
  const out=[];
  for(const country of ["NZ","AUS"]){
    const u=new URL(`${TAB_BASE}/meetings`);u.searchParams.set("category","T");u.searchParams.set("country",country);u.searchParams.set("date_from",date);u.searchParams.set("date_to",date);u.searchParams.set("enc","json");u.searchParams.set("limit","200");
    try{const d=await tab(u);const ms=d?.meetings||d?.data||d||[];for(const m of (Array.isArray(ms)?ms:[])){out.push({id:String(m.id??m.meeting_id??m.meeting??""),name:m.name||m.meeting_name||m.venue_name||"Unnamed",venue:m.venue_name||m.name||m.meeting_name||"Unnamed",country:m.country||country,meeting_number:meetingNo(m),races:(m.races||m.events||[]).map(r=>({id:String(r.event_id??r.id??r.race_id??""),race_number:r.race_number??r.number??null,name:r.description||r.race_name||r.name||"",distance:r.distance??null,meeting_id:r.meeting_id??m.id??m.meeting_id}))})}}catch(e){/* one country failing should not prevent the other */}
  }
  return out.filter(x=>x.id).sort((a,b)=>a.meeting_number-b.meeting_number||a.name.localeCompare(b.name));
}
async function event(id){
  const d=await tab(`${TAB_BASE}/events/${encodeURIComponent(id)}?enc=json`);const x=d?.data||d||{};const race=x.race||{};const runners=(x.runners||[]).map(r=>({runner_number:r.runner_number,name:r.name,barrier:r.barrier??r.gate??r.barrier_number??null,is_scratched:r.is_scratched}));
  return {race:{venue:race.venue_name||race.track||"",name:race.description||race.race_name||race.name||"",number:race.race_number??"",distance:race.distance??"",meeting_number:race.meeting_number??race.tote_meeting_number??""},runners};
}
function parseRsHtml(html){
  const runners=[];
  // R&S pages expose the speed-map data in their page JSON. Keep this parser deliberately permissive.
  const horseOrg=[...html.matchAll(/"horseOrg"\s*:\s*"?([^,}\"]+)"?/gi)];
  const pace=[...html.matchAll(/"curPace"\s*:\s*"?([^,}\"]+)"?/gi)];
  const names=[...html.matchAll(/"(?:horseName|name)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi)];
  const barriers=[...html.matchAll(/"(?:barrier|barrierNo|barrierNumber|gate)"\s*:\s*"?([0-9]+)"?/gi)];
  const nums=[...html.matchAll(/"(?:tabNo|runnerNumber|horseNo|number)"\s*:\s*"?([0-9]+)"?/gi)];
  const n=Math.max(horseOrg.length,pace.length,names.length,barriers.length,nums.length);
  for(let i=0;i<n;i++){
    const name=names[i]?.[1]?.replace(/\\"/g,'"')||"";
    const barrier=Number(barriers[i]?.[1]||i+1);
    const runnerNumber=nums[i]?.[1]||String(i+1);
    const raw=Number(horseOrg[i]?.[1]);
    const p=Number(pace[i]?.[1]);
    if(name||Number.isFinite(raw)||Number.isFinite(p)) runners.push({runner_number:runnerNumber,name,barrier,rs_speed:Number.isFinite(p)?p:Number.isFinite(raw)?raw:50});
  }
  // Remove duplicate captures and order by barrier.
  const seen=new Set();
  return runners.filter(r=>{const k=`${r.runner_number}|${r.barrier}|${r.name}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.barrier-b.barrier);
}
function speedRows(runners){return runners.filter(r=>!r.is_scratched).sort((a,b)=>Number(a.barrier)-Number(b.barrier)).map(r=>({barrier:r.barrier,runnerNumber:String(r.runner_number??""),horseName:String(r.name??""),speedMap:num(r.speedMap??r.speed??50)}));}
function titleFor(race){return `${race.venue||"Race Track"}`;}
function secondaryFor(race){return race.name||"";}
function extraFor(race){const m=race.meeting_number?`M${race.meeting_number}`:"M";const rn=race.number?`R${race.number}`:"R";const d=race.distance?String(race.distance).replace(/\s+/g,""):"";return `${m} | ${rn} | ${d}`;}
function xml(rows,race,count){
  const sizes=[8,12,16,24];const size=sizes.find(s=>count<=s);if(!size)throw new Error("Maximum supported field size is 24");
  const state=size<=12?"0":"1";
  const master=`FF_Speedmap_${size}`;
  const body=rows.map((r,i)=>`<element name="${i===0?"element":"element#"+(i+1)}"><entry name="data"><entry name="0101">100</entry><entry name="0101.R1">${r.speedMap.toFixed(1)}</entry><entry name="0102">${esc(r.runnerNumber)}.</entry><entry name="0103">${esc(r.horseName)}</entry></entry></element>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><archive version="1.0" creator="trio" creator_version="3.2.4 (Build 24895)"><vdom><entry name="storage"><entry name="shows"><entry name="generic-speedmap"><entry name="elements"><element available="1.00" description="${esc(titleFor(race))}/SPEED MAP/${size}/${state}" layer="[MAIN]" loaded="0.00" showautodescription="true" take_count="0" name="1001"><ref name="master_template">/storage/shows/generic-speedmap/mastertemplates/${master}</ref><entry name="default_alternatives"/><entry name="data"><entry name="00">${esc(titleFor(race))}</entry><entry name="01">${esc(secondaryFor(race))}</entry><entry name="02">${esc(extraFor(race))}</entry><entry name="104"><xml name="xml"><entry name="entry">${body}</entry></xml></entry><entry name="105">${size}</entry><entry name="106">${state}</entry></entry><entry name="dblink"><entry name="00"/></entry><entry name="settings"><entry name="tabfields"><entry name="00"/><entry name="01"/><entry name="02"/><entry name="104"/><entry name="105"/><entry name="106"/></entry><entry name="isfilescript">false</entry></entry></element></entry></entry></entry></entry></vdom></archive>`;
}
async function handle(request,env){
  const u=new URL(request.url);const p=u.pathname;
  if(p==="/api/meetings"&&request.method==="GET"){const d=u.searchParams.get("date");if(!/^\d{4}-\d{2}-\d{2}$/.test(d||""))return json({error:"Valid date required"},400);try{return json({meetings:await meetings(d)})}catch(e){return json({error:e.message},502)}}
  if(p==="/api/event"&&request.method==="GET"){const id=u.searchParams.get("id");if(!id)return json({error:"Event id required"},400);try{return json(await event(id))}catch(e){return json({error:e.message},502)}}
  if(p==="/api/racingandsports"&&request.method==="POST"){const {url}=await request.json();if(!url||!/^https?:\/\/www\.racingandsports\.com\.au\//i.test(url))return json({error:"Enter a Racing & Sports URL"},400);try{const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; Trackside Speedmap/1.0)",accept:"text/html,application/xhtml+xml"}});const html=await r.text();if(!r.ok)return json({error:`Racing & Sports returned HTTP ${r.status}`},502);const rows=parseRsHtml(html);return json({rows,count:rows.length,source:url})}catch(e){return json({error:e.message},502)}}
  if(p==="/api/xml"&&request.method==="POST"){try{const {race,rows}=await request.json();const clean=speedRows(rows||[]);const x=xml(clean,race||{},clean.length);const filename=`generic-speedmap-${String(race?.venue||"race").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()}-${race?.number||"race"}.xml`;return new Response(x,{headers:{"content-type":"application/xml; charset=utf-8","content-disposition": `attachment; filename="${filename}"`}})}catch(e){return json({error:e.message},400)}}
  if(p.startsWith("/api/"))return json({error:"Not found"},404);
  return env.ASSETS.fetch(request);
}
export default {fetch:handle};
