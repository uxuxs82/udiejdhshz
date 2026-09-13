const WebSocket = require("ws");
const https = require("https");
const fs = require("fs");
const zlib = require("zlib");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ADDR = "188.245.236.7:30002";
const CDN = "infocdn.bhoppro.com";
const ROOM = "Parkour-Infinity";
const NICK = "uxuxx ai";
const WF = "nn_rl_weights.json";
const WB = "nn_rl_weights_backup.json";
const SPEED = 1.5;
const MAX_FAILS = 3;
const RL_LR = 0.0001;
const SUBSTEPS = 6;
const TARGET_DEMOS = 15;

const RANK_ID = 16;
const RANK_STR = "Master Bhoper Elite";
const FLAG_ID = "flags_30";
const AVATAR_ID = 8;
const APP_VER = "2.6.3";

const TOP_FILE = "./top.txt";
const RECORD_FILE = "./record.txt";
const STATE_FILE = "./record_state.json";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_MS = 5 * 60 * 1000;

let STATE = { lastSent: 0, bestSent: 0 };
try { STATE = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch (e) {}
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(STATE)); } catch (e) {} }

let BEST_RECORD = 999;
try { const n = parseFloat(fs.readFileSync(RECORD_FILE, "utf-8").trim()); if (!isNaN(n)) BEST_RECORD = n; } catch (e) {}

function mkGuid(){const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";let g="";for(let i=0;i<22;i++)g+=c[Math.floor(Math.random()*c.length)];return g+"==";}
const emit=(ws,e,d)=>{if(ws&&ws.readyState===1)ws.send("42"+JSON.stringify([e,d]));};

function connectWS(url){
  return new Promise((res,rej)=>{
    const ws=new WebSocket(url,{headers:{"User-Agent":"BestHTTP/2 v2.8.4"}});
    let done=false;
    const h=d=>{const m=d.toString();
      if(m==="3probe"){ws.send("5");return;}
      if(m==="3"){ws.send("2");return;}
      if(m==="2"){ws.send("3");return;}
      if(m==="40"){done=true;ws.removeListener("message",h);res(ws);}
    };
    ws.on("message",h);ws.on("error",rej);
    setTimeout(()=>{if(!done)rej(new Error("timeout"));},8000);
  });
}

function download(p) {
  return new Promise(res => {
    const url = "https://" + CDN + "/demos/" + p;
    const req = https.get(url, { headers: { "User-Agent": "BestHTTP/2 v2.8.4" } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume(); download(r.headers.location).then(res); return;
      }
      if (r.statusCode !== 200) { r.resume(); res(null); return; }
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res(Buffer.concat(chunks)));
    });
    req.on("error", () => res(null));
    req.setTimeout(15000, () => { req.destroy(); res(null); });
  });
}

async function collectDemos() {
  console.log("=== сбор демок с CDN ===");
  let have = 0;
  const demos = [];
  for (let round = 0; round < 20 && have < TARGET_DEMOS; round++) {
    let scores = [];
    try {
      const guid = mkGuid(), guidsub = guid.substring(0,10);
      const deviceid = "get_"+Date.now();
      const ws = await connectWS("ws://"+ADDR+"/socket.io/?EIO=4&transport=websocket");
      ws.on("message", raw => {
        const m = raw.toString();
        if (m === "2") { ws.send("3"); return; }
        if (m.startsWith("42")) {
          try {
            const arr = JSON.parse(m.substring(2));
            if (arr[0] === "scores" && arr[1] && arr[1].scores) scores = arr[1].scores;
          } catch (e) {}
        }
      });
      emit(ws,"register",{_id:"",deviceid,nick:"getter",coin:8400228,os:"Linux",installerName:"com.android.vending",sid:deviceid,version:APP_VER,dt:new Date().toISOString()});
      await sleep(200);
      emit(ws,"savedata",{_id:"",deviceid,nick:"getter",coin:8400228,os:"Linux",installerName:"com.android.vending",sid:deviceid,version:APP_VER,rank_id:RANK_ID,SelectedFlag:FLAG_ID,SelectedAvatar:AVATAR_ID,guid,userpin:0,refcode:"MVSFN7SE",FirstCase:"True",dt:new Date().toISOString()});
      await sleep(200);
      emit(ws,"playerinfo",{nick:"getter",rank_str:RANK_STR,cape_str:"cape-0",rank_id:RANK_ID,flag_id:FLAG_ID,avatar_id:AVATAR_ID,pr:"-",id:guidsub});
      await sleep(100);
      emit(ws,"move",{x:0,y:0,z:0,lx:0,ly:0,lz:0,ry:0,rw:0.999,pr:"-",id:guidsub});
      await sleep(100);
      emit(ws,"joinroom",{room:ROOM,v:APP_VER,c:3,m:"v",guid,guidsub});
      await sleep(300);
      emit(ws,"connectToRoom",ROOM);
      await sleep(5000);
      try { ws.close(); } catch(e) {}
    } catch(e) { await sleep(2000); continue; }

    console.log("round " + (round+1) + " — " + scores.length + " записей | у нас " + have + "/" + TARGET_DEMOS);
    for (const s of scores) {
      if (have >= TARGET_DEMOS) break;
      if (!s.demoFile || !s.nick) continue;
      if (demos.some(d => d.nick === s.nick)) continue;
      const buf = await download(s.demoFile);
      if (buf && buf.length > 100) {
        try {
          const d = JSON.parse(zlib.gunzipSync(buf).toString("utf-8"));
          const path = d.frames.map(f => ({ x: f.x/1e5, y: f.y/1e5, z: f.z/1e5, t: f.t }));
          if (path.length < 5) continue;
          demos.push({ path, time: path[path.length-1].t, nick: s.nick });
          have++;
          console.log("  " + s.nick + " | " + s.time + " → " + have + "/" + TARGET_DEMOS);
        } catch(e) {}
      }
      await sleep(300);
    }
  }
  console.log("собрано: " + demos.length);
  return demos;
}

let DEMOS = [];
let FINISH = null;
let SPAWN = null;
const SAFE = new Set();
const YMAP = {};
const CELL = 1.0;

function isSafe(x,z) { return SAFE.has(Math.round(x/CELL)+","+Math.round(z/CELL)); }
function getY(x,z) {
  const cx=Math.round(x/CELL), cz=Math.round(z/CELL);
  if (YMAP[cx+","+cz] !== undefined) return YMAP[cx+","+cz];
  for (let r=1;r<=5;r++) for (let dx=-r;dx<=r;dx++) for (let dz=-r;dz<=r;dz++) {
    const k=(cx+dx)+","+(cz+dz);
    if (YMAP[k] !== undefined) return YMAP[k];
  }
  return SPAWN ? SPAWN.y : 0;
}

const IN=10, H1=48, H2=24, OUT=2;
function rnd(){ return (Math.random()-0.5)*0.3; }
let W1=Array.from({length:H1},()=>Array.from({length:IN},rnd));
let B1=Array.from({length:H1},()=>0);
let W2=Array.from({length:H2},()=>Array.from({length:H1},rnd));
let B2=Array.from({length:H2},()=>0);
let W3=Array.from({length:OUT},()=>Array.from({length:H2},rnd));
let B3=Array.from({length:OUT},()=>0);
try {
  const w = JSON.parse(fs.readFileSync(WF, "utf-8"));
  W1=w.W1;B1=w.B1;W2=w.W2;B2=w.B2;W3=w.W3;B3=w.B3;
  console.log("weights loaded");
} catch (e) { console.log("fresh weights"); }

function relu(x){ return x>0?x:0; }
function fwd(inp) {
  const h1=new Array(H1);
  for(let i=0;i<H1;i++){let s=B1[i];for(let j=0;j<IN;j++)s+=W1[i][j]*inp[j];h1[i]=relu(s);}
  const h2=new Array(H2);
  for(let i=0;i<H2;i++){let s=B2[i];for(let j=0;j<H1;j++)s+=W2[i][j]*h1[j];h2[i]=relu(s);}
  const o=new Array(OUT);
  for(let i=0;i<OUT;i++){let s=B3[i];for(let j=0;j<H2;j++)s+=W3[i][j]*h2[j];o[i]=Math.tanh(s);}
  return {o,h1,h2};
}
function mkIn(x,z,px,pz) {
  const dx=FINISH.x-x, dz=FINISH.z-z;
  const dist=Math.hypot(dx,dz)||1;
  const vx=x-px, vz=z-pz;
  return [dx/100,dz/100,dx/dist,dz/dist,dist/100,vx/SPEED,vz/SPEED,Math.sin(x/50),Math.sin(z/50),dist<20?1:0];
}
function mkTgt(cx,cz,nx,nz) {
  let dx=nx-cx, dz=nz-cz;
  const l=Math.hypot(dx,dz)||1;
  return [dx/l, dz/l];
}

const B1A=0.9, B2A=0.999, EPS=1e-8;
function zeros(a){ return Array.isArray(a[0]) ? a.map(r=>r.map(()=>0)) : a.map(()=>0); }
let M={W1:zeros(W1),B1:zeros(B1),W2:zeros(W2),B2:zeros(B2),W3:zeros(W3),B3:zeros(B3)};
let V={W1:zeros(W1),B1:zeros(B1),W2:zeros(W2),B2:zeros(B2),W3:zeros(W3),B3:zeros(B3)};
let t=0;
function adam(p,g,m,v,lr,scale){
  scale=scale||1;
  if(Array.isArray(p[0])){
    for(let i=0;i<p.length;i++)for(let j=0;j<p[i].length;j++){
      m[i][j]=B1A*m[i][j]+(1-B1A)*g[i][j];
      v[i][j]=B2A*v[i][j]+(1-B2A)*g[i][j]*g[i][j];
      const mh=m[i][j]/(1-Math.pow(B1A,t)), vh=v[i][j]/(1-Math.pow(B2A,t));
      p[i][j]-=lr*scale*mh/(Math.sqrt(vh)+EPS);
    }
  } else {
    for(let i=0;i<p.length;i++){
      m[i]=B1A*m[i]+(1-B1A)*g[i];
      v[i]=B2A*v[i]+(1-B2A)*g[i]*g[i];
      const mh=m[i]/(1-Math.pow(B1A,t)), vh=v[i]/(1-Math.pow(B2A,t));
      p[i]-=lr*scale*mh/(Math.sqrt(vh)+EPS);
    }
  }
}
function backprop(inp,tgt,lr,scale){
  const {o,h1,h2}=fwd(inp);
  const dO=[2*(o[0]-tgt[0]),2*(o[1]-tgt[1])];
  for(let i=0;i<OUT;i++) if(Math.abs(dO[i])>1) dO[i]=Math.sign(dO[i]);
  const gW3=Array.from({length:OUT},()=>Array(H2).fill(0));
  const gB3=dO.slice();
  for(let i=0;i<OUT;i++)for(let j=0;j<H2;j++)gW3[i][j]=dO[i]*h2[j];
  const dH2=new Array(H2).fill(0);
  for(let j=0;j<H2;j++){
    for(let i=0;i<OUT;i++)dH2[j]+=dO[i]*W3[i][j];
    if(h2[j]<=0)dH2[j]=0;
    if(Math.abs(dH2[j])>1)dH2[j]=Math.sign(dH2[j]);
  }
  const gW2=Array.from({length:H2},()=>Array(H1).fill(0));
  const gB2=dH2.slice();
  for(let i=0;i<H2;i++)for(let j=0;j<H1;j++)gW2[i][j]=dH2[i]*h1[j];
  const dH1=new Array(H1).fill(0);
  for(let j=0;j<H1;j++){
    for(let i=0;i<H2;i++)dH1[j]+=dH2[i]*W2[i][j];
    if(h1[j]<=0)dH1[j]=0;
    if(Math.abs(dH1[j])>1)dH1[j]=Math.sign(dH1[j]);
  }
  const gW1=Array.from({length:H1},()=>Array(IN).fill(0));
  const gB1=dH1.slice();
  for(let i=0;i<H1;i++)for(let j=0;j<IN;j++)gW1[i][j]=dH1[i]*inp[j];
  t++;
  adam(W1,gW1,M.W1,V.W1,lr,scale);
  adam(B1,gB1,M.B1,V.B1,lr,scale);
  adam(W2,gW2,M.W2,V.W2,lr,scale);
  adam(B2,gB2,M.B2,V.B2,lr,scale);
  adam(W3,gW3,M.W3,V.W3,lr,scale);
  adam(B3,gB3,M.B3,V.B3,lr,scale);
  return dO[0]*dO[0]+dO[1]*dO[1];
}
function saveW(){ try { fs.writeFileSync(WF, JSON.stringify({W1,B1,W2,B2,W3,B3})); } catch(e){} }
function saveBackup(){ try { fs.writeFileSync(WB, JSON.stringify({W1,B1,W2,B2,W3,B3})); } catch(e){} }
function loadBackup(){
  try {
    const w=JSON.parse(fs.readFileSync(WB,"utf-8"));
    W1=w.W1;B1=w.B1;W2=w.W2;B2=w.B2;W3=w.W3;B3=w.B3;
    saveW();
    return true;
  } catch(e){ return false; }
}
function train(epochs, lr){
  lr = lr || 0.003;
  const samples=[];
  for (const d of DEMOS) for(let i=1;i<d.path.length-1;i++) {
    samples.push({ inp:mkIn(d.path[i].x,d.path[i].z,d.path[i-1].x,d.path[i-1].z), tgt:mkTgt(d.path[i].x,d.path[i].z,d.path[i+1].x,d.path[i+1].z), w:d.weight });
  }
  console.log("train on " + samples.length + " samples x " + epochs);
  for(let ep=0;ep<epochs;ep++){
    let L=0;
    for(let i=samples.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[samples[i],samples[j]]=[samples[j],samples[i]];}
    for(const s of samples) L += backprop(s.inp,s.tgt,lr,s.w);
    if(ep%25===0||ep===epochs-1) console.log("ep "+ep+"/"+epochs+" loss="+(L/samples.length).toFixed(6));
  }
  saveW(); saveBackup();
}
function rlUpdate(steps, reward, lr){
  if (steps.length === 0) return;
  const scale = Math.sign(reward) * Math.min(Math.abs(reward), 0.3);
  for (let i = 0; i < steps.length; i++) {
    const decay = Math.pow(0.995, steps.length - i);
    backprop(steps[i].inp, steps[i].action, lr, scale * decay);
  }
}

async function fetchTop() {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "chk_" + Date.now();
  const ws = await connectWS("ws://" + ADDR + "/socket.io/?EIO=4&transport=websocket");
  let topScores = [];
  ws.on("message", raw => {
    const m = raw.toString();
    if (m === "2") { ws.send("3"); return; }
    if (m.startsWith("42")) {
      try {
        const arr = JSON.parse(m.substring(2));
        if (arr[0] === "scores" && arr[1] && arr[1].scores) topScores = arr[1].scores;
      } catch (e) {}
    }
  });
  emit(ws, "register", { _id: "", deviceid, nick: "chk", coin: 8400228, os: "Linux", installerName: "com.android.vending", sid: deviceid, version: APP_VER, dt: new Date().toISOString() });
  await sleep(200);
  emit(ws, "savedata", { _id: "", deviceid, nick: "chk", coin: 8400228, os: "Linux", installerName: "com.android.vending", sid: deviceid, version: APP_VER, rank_id: RANK_ID, SelectedFlag: FLAG_ID, SelectedAvatar: AVATAR_ID, guid, userpin: 0, refcode: "MVSFN7SE", FirstCase: "True", dt: new Date().toISOString() });
  await sleep(200);
  emit(ws, "playerinfo", { nick: "chk", rank_str: RANK_STR, cape_str: "cape-0", rank_id: RANK_ID, flag_id: FLAG_ID, avatar_id: AVATAR_ID, pr: "-", id: guidsub });
  await sleep(100);
  emit(ws, "move", { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, ry: 0, rw: 0.999, pr: "-", id: guidsub });
  await sleep(100);
  emit(ws, "joinroom", { room: ROOM, v: APP_VER, c: 3, m: "v", guid, guidsub });
  await sleep(300);
  emit(ws, "connectToRoom", ROOM);
  await sleep(4000);
  ws.close();
  return topScores;
}

async function sendRecord(time) {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "rec_" + Date.now();
  const ws = await connectWS("ws://" + ADDR + "/socket.io/?EIO=4&transport=websocket");
  const tStr = String(Math.floor(time/60)).padStart(2,"0") + ":" + (time%60).toFixed(3).padStart(6,"0");

  emit(ws, "register", { _id: "", deviceid, nick: NICK, coin: 8400228, os: "Linux", installerName: "com.android.vending", sid: deviceid, version: APP_VER, dt: new Date().toISOString() });
  await sleep(200);
  emit(ws, "savedata", { _id: "", deviceid, nick: NICK, coin: 8400228, os: "Linux", installerName: "com.android.vending", sid: deviceid, version: APP_VER, rank_id: RANK_ID, SelectedFlag: FLAG_ID, SelectedAvatar: AVATAR_ID, guid, userpin: 0, refcode: "MVSFN7SE", FirstCase: "True", dt: new Date().toISOString() });
  await sleep(200);
  emit(ws, "playerinfo", { nick: NICK, rank_str: RANK_STR, cape_str: "cape-0", rank_id: RANK_ID, flag_id: FLAG_ID, avatar_id: AVATAR_ID, pr: "-", id: guidsub });
  await sleep(100);
  emit(ws, "move", { x: 929.8, y: 169.3, z: -2704.5, lx: 929.8, ly: 169.3, lz: -2704.5, ry: 0, rw: 0.999, pr: "-", id: guidsub });
  await sleep(100);
  emit(ws, "joinroom", { room: ROOM, v: APP_VER, c: 3, m: "v", guid, guidsub });
  await sleep(300);
  emit(ws, "connectToRoom", ROOM);
  await sleep(400);

  const payload = {
    nick: NICK + " [" + tStr + "]",
    score: 999,
    time: time,
    str_time: tStr,
    str_nick: NICK,
    flag: FLAG_ID,
    guid: guid,
    rank: RANK_STR,
    sid: deviceid,
    m: "v",
    installerName: "com.android.vending"
  };
  emit(ws, "levelcomplete", payload);
  await sleep(200);
  emit(ws, "newscore", payload);
  console.log(">>> NEWSCORE SENT: " + time.toFixed(3) + "c");
  await sleep(2000);
  ws.close();
}

let autoCheckRunning = false;
async function autoCheck() {
  if (autoCheckRunning) return;
  autoCheckRunning = true;
  try {
    const now = Date.now();
    if (now - STATE.lastSent < COOLDOWN_MS) { autoCheckRunning = false; return; }
    if (BEST_RECORD >= 999) { autoCheckRunning = false; return; }
    let top = [];
    try { top = await fetchTop(); } catch (e) { autoCheckRunning = false; return; }
    let ourBest = Infinity, ourEntry = null;
    for (const s of top) {
      if (s && s.nick && s.nick.includes(NICK)) {
        const tt = parseFloat(s.time);
        if (!isNaN(tt) && tt < ourBest) { ourBest = tt; ourEntry = s; }
      }
    }
    if (ourEntry && ourBest <= BEST_RECORD) { STATE.lastSent = now; saveState(); autoCheckRunning = false; return; }
    console.log("[AUTO] отправка " + BEST_RECORD.toFixed(3) + "c");
    await sendRecord(BEST_RECORD);
    STATE.lastSent = now;
    STATE.bestSent = BEST_RECORD;
    saveState();
  } catch (e) {}
  autoCheckRunning = false;
}

async function runBot(){
  const guid=mkGuid(),guidsub=guid.substring(0,10);
  const deviceid="a_"+Date.now()+"_"+Math.random().toString(36).substring(2,6);
  let pos={x:SPAWN.x,y:SPAWN.y,z:SPAWN.z};
  let prev={x:SPAWN.x,z:SPAWN.z};
  let rotY=0;
  const t0=Date.now();
  const episodeSteps=[];

  try{
    const ws=await connectWS("ws://"+ADDR+"/socket.io/?EIO=4&transport=websocket");
    emit(ws,"register",{_id:"",deviceid,nick:NICK,coin:8400228,os:"Linux",installerName:"com.android.vending",sid:deviceid,version:APP_VER,dt:new Date().toISOString()});
    await sleep(20);
    emit(ws,"savedata",{_id:"",deviceid,nick:NICK,coin:8400228,os:"Linux",installerName:"com.android.vending",sid:deviceid,version:APP_VER,rank_id:RANK_ID,SelectedFlag:FLAG_ID,SelectedAvatar:AVATAR_ID,guid,userpin:0,refcode:"MVSFN7SE",FirstCase:"True",dt:new Date().toISOString()});
    await sleep(20);
    emit(ws,"playerinfo",{nick:NICK,rank_str:RANK_STR,cape_str:"cape-0",rank_id:RANK_ID,flag_id:FLAG_ID,avatar_id:AVATAR_ID,pr:"-",id:guidsub});
    await sleep(20);
    emit(ws,"move",{x:pos.x,y:pos.y,z:pos.z,lx:pos.x,ly:pos.y,lz:pos.z,ry:0,rw:1,pr:"-",id:guidsub});
    await sleep(30);
    emit(ws,"joinroom",{room:ROOM,v:APP_VER,c:3,m:"v",guid,guidsub});
    await sleep(50);
    emit(ws,"connectToRoom",ROOM);
    await sleep(100);

    let step=0, done=false, fell=false;
    while(step<150&&ws.readyState===1){
      const inp=mkIn(pos.x,pos.z,prev.x,prev.z);
      const {o}=fwd(inp);
      let dirX=o[0], dirZ=o[1];
      const dl=Math.hypot(dirX,dirZ);
      if (dl < 0.15) { dirX = FINISH.x-pos.x; dirZ = FINISH.z-pos.z; }
      const dl2=Math.hypot(dirX,dirZ)||1;
      dirX/=dl2; dirZ/=dl2;

      let dx=dirX*SPEED, dz=dirZ*SPEED;
      let nx=pos.x+dx, nz=pos.z+dz;

      if (!isSafe(nx,nz)) {
        let found=false;
        for(let k=1;k<=12;k++){
          const angles=[k*Math.PI/12,-k*Math.PI/12];
          for(const a of angles){
            const baseAng=Math.atan2(dirZ,dirX);
            const newAng=baseAng+a;
            const tx=pos.x+Math.cos(newAng)*SPEED;
            const tz=pos.z+Math.sin(newAng)*SPEED;
            if(isSafe(tx,tz)){nx=tx;nz=tz;dx=tx-pos.x;dz=tz-pos.z;found=true;break;}
          }
          if(found)break;
        }
        if(!found){ fell=true; break; }
      }

      const oldX = pos.x, oldY = pos.y, oldZ = pos.z;
      const oldRotY = rotY;

      episodeSteps.push({
        inp,
        action: [dx/(SPEED*Math.SQRT2), dz/(SPEED*Math.SQRT2)],
        posX: pos.x, posY: pos.y, posZ: pos.z
      });

      prev={x:pos.x,z:pos.z};
      pos.x=nx; pos.z=nz;
      pos.y=getY(pos.x,pos.z);

      const targetYaw = Math.atan2(dx, dz);
      let dyaw = targetYaw - rotY;
      while (dyaw > Math.PI) dyaw -= 2*Math.PI;
      while (dyaw < -Math.PI) dyaw += 2*Math.PI;
      const MAX_TURN = 0.20;
      if (Math.abs(dyaw) > MAX_TURN) dyaw = Math.sign(dyaw) * MAX_TURN;
      rotY += dyaw;

      for (let s = 1; s <= SUBSTEPS; s++) {
        const k = s / SUBSTEPS;
        const ix = oldX + (pos.x - oldX) * k;
        const iy = oldY + (pos.y - oldY) * k;
        const iz = oldZ + (pos.z - oldZ) * k;
        const iYaw = oldRotY + (rotY - oldRotY) * k;
        const qy = Math.sin(iYaw / 2);
        const qw = Math.cos(iYaw / 2);
        const lx = ix + Math.sin(iYaw) * 1.5;
        const lz = iz + Math.cos(iYaw) * 1.5;
        emit(ws, "move", { x: ix, y: iy, z: iz, lx: lx, ly: iy, lz: lz, ry: qy, rw: qw, pr: "-", id: guidsub });
        await sleep(10);
      }

      const dist3=Math.hypot(pos.x-FINISH.x,pos.y-FINISH.y,pos.z-FINISH.z);
      if(dist3<3){ done=true; break; }
      if(step%25===0) console.log("step "+step+" pos=("+pos.x.toFixed(1)+","+pos.z.toFixed(1)+") dist="+dist3.toFixed(1));
      step++;
    }
    ws.close();
    const elapsed = (Date.now()-t0)/1000;
    return {done, fell, elapsed, steps: episodeSteps};
  }catch(e){console.log("err "+e.message);return {done:false, fell:true, elapsed:99, steps:episodeSteps};}
}

// ================== ГЛАВНАЯ АСИНХРОННАЯ ФУНКЦИЯ ==================
(async () => {
  console.log("=== " + NICK + " — 60 pkt/s, плавно ===");

  DEMOS = await collectDemos();
  if (!DEMOS.length) { console.log("нет демок — выход"); process.exit(1); }

  const minT = Math.min(...DEMOS.map(d => d.time));
  const maxT = Math.max(...DEMOS.map(d => d.time));
  for (const d of DEMOS) d.weight = 3.0 - 2.0 * (d.time - minT) / Math.max(maxT - minT, 0.001);

  FINISH = DEMOS[0].path[DEMOS[0].path.length-1];
  SPAWN = DEMOS[0].path[0];

  for (const d of DEMOS) for (const f of d.path) {
    const k = Math.round(f.x/CELL)+","+Math.round(f.z/CELL);
    SAFE.add(k);
    if (YMAP[k] === undefined) YMAP[k] = f.y;
  }

  if(!fs.existsSync(WF)){
    console.log("no weights, train 200 epochs...");
    train(200, 0.003);
  } else {
    console.log("weights loaded");
  }
  console.log("\n=== infinite walk ===\n");

  setInterval(autoCheck, AUTO_CHECK_MS);

  let wins=0, runs=0, fails=0;
  let bestTime = BEST_RECORD;

  while(true){
    runs++;
    const r=await runBot();

    if (r.done) {
      wins++;
      fails = 0;
      saveBackup();

      let reward = Math.max(0.3, 5 - r.elapsed);
      let doRL = false;
      if (r.elapsed < bestTime) {
        bestTime = r.elapsed;
        reward += 1;
        doRL = true;
      }
      if (r.elapsed < BEST_RECORD) {
        BEST_RECORD = r.elapsed;
        try {
          fs.writeFileSync(RECORD_FILE, r.elapsed.toFixed(3));
          let content = r.elapsed.toFixed(3) + "c\n";
          for (let i = 0; i < r.steps.length; i++) {
            const s = r.steps[i];
            content += "[" + (i+1) + "] t=" + (i*0.08).toFixed(2) + "s x=" + (s.posX||0).toFixed(2) + " y=" + (s.posY||0).toFixed(2) + " z=" + (s.posZ||0).toFixed(2) + "\n";
          }
          fs.writeFileSync(TOP_FILE, content);
        } catch(e) {}
        console.log(">>> NEW ALL-TIME RECORD! " + r.elapsed.toFixed(3) + "c");
      }
      console.log(">>> FINISH! time=" + r.elapsed.toFixed(2) + "s reward=" + reward.toFixed(1) + " best=" + bestTime.toFixed(2) + (doRL?" [RL]":""));

      if (doRL && r.steps.length > 0) rlUpdate(r.steps, reward, RL_LR);
    } else if (r.fell) {
      fails++;
      console.log(">>> FELL at " + r.elapsed.toFixed(2) + "s (fails=" + fails + "/" + MAX_FAILS + ")");
    } else {
      fails++;
      console.log(">>> TIMEOUT " + r.elapsed.toFixed(2) + "s (fails=" + fails + "/" + MAX_FAILS + ")");
    }

    if (fails >= MAX_FAILS) {
      console.log("!!! " + MAX_FAILS + " FAILS → ROLLBACK");
      if (loadBackup()) {
        fails = 0;
        console.log(">>> weights restored");
      } else {
        console.log(">>> no backup, retrain...");
        train(50, 0.002);
        saveBackup();
        fails = 0;
      }
    }

    if (runs % 10 === 0 && fails === 0) {
      saveW();
      console.log("--- saved (runs=" + runs + ", wins=" + wins + ", best=" + bestTime.toFixed(2) + "s, ALL-TIME=" + BEST_RECORD.toFixed(3) + "c) ---");
    }

    await sleep(10);
  }
})();
