cd ~/bhop && cat > nn_multi.js << 'ENDJS'
// nn_multi.js — 4 карты, 4 параллельных воркера, один ник, отдельные веса.
// Демки = карта (SAFE, spawn, finish). Сеть учится во время игры.

const WebSocket = require("ws");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============ НАСТРОЙКИ ============
const ADDR = "188.245.236.7:30002";
const CDN = "infocdn.bhoppro.com";
const NICK = process.env.NICK || "uxuxx ai";
const RANK_ID = 16;
const RANK_STR = "Master Bhoper Elite";
const FLAG_ID = "flags_30";
const AVATAR_ID = 8;
const APP_VER = "2.6.3";

const DEMOS_PER_MAP = 15;
const MAX_ROUNDS = 60;
const RL_LR = 0.0005;
const SPEED = 1.5;
const MAX_TURN = 0.12;
const SUBSTEPS = 6;
const JUMP_H = 1.2;
const JUMP_DUR = 0.5;
const EPISODE_STEPS = 150;
const STEP_SLEEP = 6;

const MAPS = [
  { id: "mood",     room: "Speedrun-Mood"    },
  { id: "alter",    room: "Parkour-Alter"    },
  { id: "blocks",   room: "Parkour-Blocks"   },
  { id: "infinity", room: "Parkour-Infinity" },
];

const SEEN_FILE = "seen_nicks.json";

// ============ УТИЛИТЫ ============
function mkGuid(){const c="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";let g="";for(let i=0;i<22;i++)g+=c[Math.floor(Math.random()*c.length)];return g+"==";}
const emit = (ws, e, d) => { if (ws && ws.readyState === 1) ws.send("42" + JSON.stringify([e, d])); };

function connectWS(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url, { headers: { "User-Agent": "BestHTTP/2 v2.8.4" } });
    let done = false;
    const h = data => {
      const m = data.toString();
      if (m === "3probe") { ws.send("5"); return; }
      if (m === "3") { ws.send("2"); return; }
      if (m === "2") { ws.send("3"); return; }
      if (m === "40") { done = true; ws.removeListener("message", h); res(ws); }
    };
    ws.on("message", h); ws.on("error", rej);
    setTimeout(() => { if (!done) rej(new Error("timeout")); }, 10000);
  });
}

let SEEN = {};
try { SEEN = JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")); } catch (e) {}
function saveSeen() { try { fs.writeFileSync(SEEN_FILE, JSON.stringify(SEEN, null, 2)); } catch (e) {} }

// ============ СКАЧИВАНИЕ ============
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

async function fetchScores(room) {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "get_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
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
  emit(ws, "register", { _id:"", deviceid, nick:"getter", coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, dt:new Date().toISOString() });
  await sleep(200);
  emit(ws, "savedata", { _id:"", deviceid, nick:"getter", coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, rank_id:RANK_ID, SelectedFlag:FLAG_ID, SelectedAvatar:AVATAR_ID, guid, userpin:0, refcode:"MVSFN7SE", FirstCase:"True", dt:new Date().toISOString() });
  await sleep(200);
  emit(ws, "playerinfo", { nick:"getter", rank_str:RANK_STR, cape_str:"cape-0", rank_id:RANK_ID, flag_id:FLAG_ID, avatar_id:AVATAR_ID, pr:"-", id:guidsub });
  await sleep(100);
  emit(ws, "move", { x:0, y:0, z:0, lx:0, ly:0, lz:0, ry:0, rw:0.999, pr:"-", id:guidsub });
  await sleep(100);
  emit(ws, "joinroom", { room, v:APP_VER, c:3, m:"v", guid, guidsub });
  await sleep(300);
  emit(ws, "connectToRoom", room);
  await sleep(5000);
  try { ws.close(); } catch (e) {}
  return topScores;
}

async function collectDemos(map) {
  const dir = "demos/" + map.id;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const count = () => { try { return fs.readdirSync(dir).filter(f => f.endsWith(".gz")).length; } catch (e) { return 0; } };

  let have = count();
  console.log("[" + map.id + "] уже есть " + have + "/" + DEMOS_PER_MAP);
  let round = 0;

  while (have < DEMOS_PER_MAP && round < MAX_ROUNDS) {
    round++;
    let scores = [];
    try { scores = await fetchScores(map.room); }
    catch (e) { console.log("[" + map.id + "] fetch err: " + e.message); await sleep(5000); continue; }

    console.log("[" + map.id + "] round " + round + " — " + scores.length + " записей, у нас " + have + "/" + DEMOS_PER_MAP);
    let got = 0;

    for (let i = 0; i < scores.length && have < DEMOS_PER_MAP; i++) {
      const s = scores[i];
      if (!s.demoFile || !s.nick) continue;
      const k = map.id + ":" + s.nick;
      if (SEEN[k]) continue;
      process.stdout.write("  " + s.nick + " | " + s.time + " | ");
      const buf = await download(s.demoFile);
      if (buf && buf.length > 100) {
        const safe = s.nick.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        try {
          fs.writeFileSync(dir + "/" + safe + ".gz", buf);
          SEEN[k] = true; saveSeen();
          have++; got++;
          console.log("OK " + buf.length + "b → " + have + "/" + DEMOS_PER_MAP);
        } catch (e) { console.log("write err"); }
      } else console.log("fail");
      await sleep(300);
    }

    if (have >= DEMOS_PER_MAP) break;
    await sleep(got === 0 ? 10000 : 3000);
  }
  console.log("[" + map.id + "] ИТОГ: " + have + " демок");
}

// ============ СЕТЬ ============
const IN = 10, H1 = 48, H2 = 24, OUT = 2;
function rnd(){ return (Math.random()-0.5)*0.3; }
function zeros(a){ return Array.isArray(a[0]) ? a.map(r => r.map(()=>0)) : a.map(()=>0); }
function relu(x){ return x>0?x:0; }

function makeWorker(mapId, room) {
  const w = {
    id: mapId, room,
    W1: Array.from({length:H1},()=>Array.from({length:IN},rnd)),
    B1: Array.from({length:H1},()=>0),
    W2: Array.from({length:H2},()=>Array.from({length:H1},rnd)),
    B2: Array.from({length:H2},()=>0),
    W3: Array.from({length:OUT},()=>Array.from({length:H2},rnd)),
    B3: Array.from({length:OUT},()=>0),
    adamT: 0,
    demos: [], safe: new Set(), ymap: {},
    spawn: null, finish: null,
    runs: 0, wins: 0, best: 999,
    wf: "weights_" + mapId + ".json",
  };

  try {
    const ww = JSON.parse(fs.readFileSync(w.wf, "utf-8"));
    w.W1=ww.W1; w.B1=ww.B1; w.W2=ww.W2; w.B2=ww.B2; w.W3=ww.W3; w.B3=ww.B3;
    console.log("[" + mapId + "] weights loaded");
  } catch (e) { console.log("[" + mapId + "] fresh weights"); }

  w.M = { W1:zeros(w.W1), B1:zeros(w.B1), W2:zeros(w.W2), B2:zeros(w.B2), W3:zeros(w.W3), B3:zeros(w.B3) };
  w.V = { W1:zeros(w.W1), B1:zeros(w.B1), W2:zeros(w.W2), B2:zeros(w.B2), W3:zeros(w.W3), B3:zeros(w.B3) };
  return w;
}

function loadMap(w) {
  const dir = "demos/" + w.id;
  w.demos = []; w.safe = new Set(); w.ymap = {};
  if (!fs.existsSync(dir)) { console.log("[" + w.id + "] нет папки"); return false; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".gz"));
  if (!files.length) { console.log("[" + w.id + "] нет демок"); return false; }

  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      let raw;
      try { raw = zlib.gunzipSync(buf).toString("utf-8"); }
      catch (e) { raw = buf.toString("utf-8"); }
      const d = JSON.parse(raw);
      if (!d.frames || d.frames.length < 5) continue;
      const p = d.frames.map(fr => ({ x: fr.x/1e5, y: fr.y/1e5, z: fr.z/1e5, t: fr.t }));
      w.demos.push({ path: p, time: p[p.length-1].t, nick: d.nick || f });
    } catch (e) {}
  }
  if (!w.demos.length) { console.log("[" + w.id + "] демки не распарсились"); return false; }
  w.spawn = w.demos[0].path[0];
  w.finish = w.demos[0].path[w.demos[0].path.length-1];
  for (const d of w.demos) for (const fr of d.path) {
    const k = Math.round(fr.x) + "," + Math.round(fr.z);
    w.safe.add(k);
    if (w.ymap[k] === undefined) w.ymap[k] = fr.y;
  }
  console.log("[" + w.id + "] " + w.demos.length + " демок | spawn(" + w.spawn.x.toFixed(1) + "," + w.spawn.z.toFixed(1) + ") | finish(" + w.finish.x.toFixed(1) + "," + w.finish.z.toFixed(1) + ")");
  return true;
}

function isSafe(w, x, z) { return w.safe.has(Math.round(x) + "," + Math.round(z)); }
function getY(w, x, z) {
  const cx = Math.round(x), cz = Math.round(z);
  const k = cx + "," + cz;
  if (w.ymap[k] !== undefined) return w.ymap[k];
  for (let r = 1; r <= 5; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const kk = (cx+dx) + "," + (cz+dz);
    if (w.ymap[kk] !== undefined) return w.ymap[kk];
  }
  return w.spawn ? w.spawn.y : 0;
}

function bfsNext(w, sx, sz, gx, gz) {
  const key = (x,z) => x + "," + z;
  const sxC = Math.round(sx), szC = Math.round(sz);
  const gxC = Math.round(gx), gzC = Math.round(gz);
  const q = [[sxC,szC]], prev = new Map(); prev.set(key(sxC,szC), null);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false, n = 0;
  while (q.length && n++ < 1000) {
    const [x,z] = q.shift();
    if (x === gxC && z === gzC) { found = true; break; }
    for (const [dx,dz] of dirs) {
      const nx = x+dx, nz = z+dz, k = key(nx,nz);
      if (!w.safe.has(k) || prev.has(k)) continue;
      prev.set(k, key(x,z)); q.push([nx,nz]);
    }
  }
  if (!found) return null;
  let cur = key(gxC,gzC), p = [];
  while (cur) { const [px,pz] = cur.split(",").map(Number); p.push([px,pz]); cur = prev.get(cur); }
  p.reverse();
  if (p.length < 2) return { x: gx, z: gz };
  const [wx,wz] = p[1];
  return { x: wx, z: wz };
}

function fwd(w, inp) {
  const h1 = new Array(H1);
  for (let i=0;i<H1;i++){ let s=w.B1[i]; for (let j=0;j<IN;j++) s += w.W1[i][j]*inp[j]; h1[i]=relu(s); }
  const h2 = new Array(H2);
  for (let i=0;i<H2;i++){ let s=w.B2[i]; for (let j=0;j<H1;j++) s += w.W2[i][j]*h1[j]; h2[i]=relu(s); }
  const o = new Array(OUT);
  for (let i=0;i<OUT;i++){ let s=w.B3[i]; for (let j=0;j<H2;j++) s += w.W3[i][j]*h2[j]; o[i]=Math.tanh(s); }
  return { o, h1, h2 };
}

function mkIn(w, x, z, px, pz) {
  const dx = w.finish.x - x, dz = w.finish.z - z;
  const dist = Math.hypot(dx, dz) || 1;
  const vx = x - px, vz = z - pz;
  return [ dx/100, dz/100, dx/dist, dz/dist, dist/100, vx/SPEED, vz/SPEED, Math.sin(x/50), Math.sin(z/50), dist < 20 ? 1 : 0 ];
}

const B1A = 0.9, B2A = 0.999, EPS = 1e-8;
function adam(p, g, m, v, lr, scale, T) {
  scale = scale || 1;
  if (Array.isArray(p[0])) {
    for (let i=0;i<p.length;i++) for (let j=0;j<p[i].length;j++) {
      m[i][j] = B1A*m[i][j] + (1-B1A)*g[i][j];
      v[i][j] = B2A*v[i][j] + (1-B2A)*g[i][j]*g[i][j];
      const mh = m[i][j]/(1-Math.pow(B1A,T));
      const vh = v[i][j]/(1-Math.pow(B2A,T));
      p[i][j] -= lr*scale*mh/(Math.sqrt(vh)+EPS);
    }
  } else {
    for (let i=0;i<p.length;i++) {
      m[i] = B1A*m[i] + (1-B1A)*g[i];
      v[i] = B2A*v[i] + (1-B2A)*g[i]*g[i];
      const mh = m[i]/(1-Math.pow(B1A,T));
      const vh = v[i]/(1-Math.pow(B2A,T));
      p[i] -= lr*scale*mh/(Math.sqrt(vh)+EPS);
    }
  }
}

function backprop(w, inp, tgt, lr, scale) {
  const { o, h1, h2 } = fwd(w, inp);
  const dO = [ 2*(o[0]-tgt[0]), 2*(o[1]-tgt[1]) ];
  for (let i=0;i<OUT;i++) if (Math.abs(dO[i])>1) dO[i]=Math.sign(dO[i]);

  const gW3 = Array.from({length:OUT}, () => Array(H2).fill(0));
  const gB3 = dO.slice();
  for (let i=0;i<OUT;i++) for (let j=0;j<H2;j++) gW3[i][j] = dO[i]*h2[j];

  const dH2 = new Array(H2).fill(0);
  for (let j=0;j<H2;j++) {
    for (let i=0;i<OUT;i++) dH2[j] += dO[i]*w.W3[i][j];
    if (h2[j] <= 0) dH2[j] = 0;
    if (Math.abs(dH2[j]) > 1) dH2[j] = Math.sign(dH2[j]);
  }
  const gW2 = Array.from({length:H2}, () => Array(H1).fill(0));
  const gB2 = dH2.slice();
  for (let i=0;i<H2;i++) for (let j=0;j<H1;j++) gW2[i][j] = dH2[i]*h1[j];

  const dH1 = new Array(H1).fill(0);
  for (let j=0;j<H1;j++) {
    for (let i=0;i<H2;i++) dH1[j] += dH2[i]*w.W2[i][j];
    if (h1[j] <= 0) dH1[j] = 0;
    if (Math.abs(dH1[j]) > 1) dH1[j] = Math.sign(dH1[j]);
  }
  const gW1 = Array.from({length:H1}, () => Array(IN).fill(0));
  const gB1 = dH1.slice();
  for (let i=0;i<H1;i++) for (let j=0;j<IN;j++) gW1[i][j] = dH1[i]*inp[j];

  w.adamT++;
  adam(w.W1, gW1, w.M.W1, w.V.W1, lr, scale, w.adamT);
  adam(w.B1, gB1, w.M.B1, w.V.B1, lr, scale, w.adamT);
  adam(w.W2, gW2, w.M.W2, w.V.W2, lr, scale, w.adamT);
  adam(w.B2, gB2, w.M.B2, w.V.B2, lr, scale, w.adamT);
  adam(w.W3, gW3, w.M.W3, w.V.W3, lr, scale, w.adamT);
  adam(w.B3, gB3, w.M.B3, w.V.B3, lr, scale, w.adamT);
  return dO[0]*dO[0] + dO[1]*dO[1];
}

function saveWeights(w) {
  try { fs.writeFileSync(w.wf, JSON.stringify({ W1:w.W1, B1:w.B1, W2:w.W2, B2:w.B2, W3:w.W3, B3:w.B3 })); } catch (e) {}
}

function rlUpdate(w, steps, reward, lr) {
  if (!steps.length) return;
  const scale = Math.sign(reward) * Math.min(Math.abs(reward), 0.3);
  for (let i=0; i<steps.length; i++) {
    const decay = Math.pow(0.995, steps.length - i);
    backprop(w, steps[i].inp, steps[i].action, lr, scale * decay);
  }
}

// ============ ЭПИЗОД ============
async function runBot(w) {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "a_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
  let pos = { x: w.spawn.x, y: w.spawn.y, z: w.spawn.z };
  let prev = { x: w.spawn.x, z: w.spawn.z };
  let rotY = 0;
  let waypoint = { x: w.finish.x, z: w.finish.z };
  let stuckCounter = 0;
  let lastDist = Math.hypot(w.spawn.x - w.finish.x, w.spawn.z - w.finish.z);
  let jumping = false, jumpTime = 0;
  const t0 = Date.now();
  const episodeSteps = [];

  try {
    const ws = await connectWS("ws://" + ADDR + "/socket.io/?EIO=4&transport=websocket");
    emit(ws, "register", { _id:"", deviceid, nick:NICK, coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, dt:new Date().toISOString() });
    await sleep(20);
    emit(ws, "savedata", { _id:"", deviceid, nick:NICK, coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, rank_id:RANK_ID, SelectedFlag:FLAG_ID, SelectedAvatar:AVATAR_ID, guid, userpin:0, refcode:"MVSFN7SE", FirstCase:"True", dt:new Date().toISOString() });
    await sleep(20);
    emit(ws, "playerinfo", { nick:NICK, rank_str:RANK_STR, cape_str:"cape-0", rank_id:RANK_ID, flag_id:FLAG_ID, avatar_id:AVATAR_ID, pr:"-", id:guidsub });
    await sleep(20);
    emit(ws, "move", { x:pos.x, y:pos.y, z:pos.z, lx:pos.x, ly:pos.y, lz:pos.z, ry:0, rw:1, pr:"-", id:guidsub });
    await sleep(30);
    emit(ws, "joinroom", { room: w.room, v:APP_VER, c:3, m:"v", guid, guidsub });
    await sleep(50);
    emit(ws, "connectToRoom", w.room);
    await sleep(100);

    let step = 0, done = false, fell = false;
    while (step < EPISODE_STEPS && ws.readyState === 1) {
      const inp = mkIn(w, pos.x, pos.z, prev.x, prev.z);
      const { o } = fwd(w, inp);

      if (step % 6 === 0 || stuckCounter > 4) {
        const wp = bfsNext(w, pos.x, pos.z, w.finish.x, w.finish.z);
        if (wp) waypoint = wp;
        stuckCounter = 0;
      }

      let nnX = o[0], nnZ = o[1];
      const nnMag = Math.hypot(nnX, nnZ);
      if (nnMag > 1e-6) { nnX /= nnMag; nnZ /= nnMag; }

      const eps = Math.max(0.03, 0.4 * Math.exp(-w.runs / 100));
      nnX += (Math.random()*2-1) * eps;
      nnZ += (Math.random()*2-1) * eps;

      let wpX = waypoint.x - pos.x, wpZ = waypoint.z - pos.z;
      const wpLen = Math.hypot(wpX, wpZ) || 1; wpX /= wpLen; wpZ /= wpLen;
      const nnW = Math.min(1, nnMag / 0.6);
      let dirX = nnX*nnW + wpX*(1-nnW);
      let dirZ = nnZ*nnW + wpZ*(1-nnW);
      const dl = Math.hypot(dirX, dirZ) || 1;
      dirX /= dl; dirZ /= dl;

      let dx = dirX * SPEED, dz = dirZ * SPEED;
      let nx = pos.x + dx, nz = pos.z + dz;

      if (!isSafe(w, nx, nz)) {
        let found = false;
        for (let k = 1; k <= 12; k++) {
          const angles = [k*Math.PI/12, -k*Math.PI/12];
          for (const a of angles) {
            const baseAng = Math.atan2(dirZ, dirX);
            const newAng = baseAng + a;
            const tx = pos.x + Math.cos(newAng)*SPEED;
            const tz = pos.z + Math.sin(newAng)*SPEED;
            if (isSafe(w, tx, tz)) { nx = tx; nz = tz; dx = tx - pos.x; dz = tz - pos.z; found = true; break; }
          }
          if (found) break;
        }
        if (!found) { fell = true; break; }
      }

      const oldX = pos.x, oldY = pos.y, oldZ = pos.z;
      const oldRotY = rotY;

      episodeSteps.push({
        inp,
        action: [ dx/(SPEED*Math.SQRT2), dz/(SPEED*Math.SQRT2) ],
        posX: pos.x, posY: pos.y, posZ: pos.z
      });

      prev = { x: pos.x, z: pos.z };
      pos.x = nx; pos.z = nz;
      pos.y = getY(w, pos.x, pos.z);

      const targetYaw = Math.atan2(dx, dz);
      let dyaw = targetYaw - rotY;
      while (dyaw > Math.PI) dyaw -= 2*Math.PI;
      while (dyaw < -Math.PI) dyaw += 2*Math.PI;
      if (Math.abs(dyaw) > MAX_TURN) dyaw = Math.sign(dyaw) * MAX_TURN;
      rotY += dyaw;

      let jumpOffset = 0;
      if (jumping) {
        jumpTime += 0.08;
        if (jumpTime < JUMP_DUR) {
          jumpOffset = JUMP_H * (1 - Math.pow((jumpTime - JUMP_DUR/2)/(JUMP_DUR/2), 2));
          if (jumpOffset < 0) jumpOffset = 0;
        } else { jumping = false; jumpTime = 0; }
      }
      if (!jumping && Math.random() < 0.05) { jumping = true; jumpTime = 0; }

      for (let s = 1; s <= SUBSTEPS; s++) {
        const k = s / SUBSTEPS;
        let ix = oldX + (pos.x - oldX) * k;
        let iy = oldY + (pos.y - oldY) * k + jumpOffset * k;
        let iz = oldZ + (pos.z - oldZ) * k;
        ix += (Math.random()-0.5) * 0.006;
        iz += (Math.random()-0.5) * 0.006;
        const iYaw = oldRotY + (rotY - oldRotY) * k;
        const qy = Math.sin(iYaw/2), qw = Math.cos(iYaw/2);
        const lx = ix + Math.sin(iYaw)*0.5;
        const lz = iz + Math.cos(iYaw)*0.5;
        emit(ws, "move", { x:ix, y:iy, z:iz, lx:lx, ly:iy, lz:lz, ry:qy, rw:qw, pr:"-", id:guidsub });
        await sleep(STEP_SLEEP);
      }

      const dNow = Math.hypot(pos.x - w.finish.x, pos.z - w.finish.z);
      if (dNow > lastDist - 0.05) stuckCounter++; else stuckCounter = 0;
      lastDist = dNow;

      const dist3 = Math.hypot(pos.x - w.finish.x, pos.y - w.finish.y, pos.z - w.finish.z);
      if (dist3 < 3) { done = true; break; }
      step++;
    }
    try { ws.close(); } catch (e) {}
    const elapsed = (Date.now() - t0) / 1000;
    return { done, fell, elapsed, steps: episodeSteps };
  } catch (e) {
    return { done: false, fell: true, elapsed: 99, steps: episodeSteps };
  }
}

// ============ ЦИКЛ ВОРКЕРА ============
async function loopWorker(w) {
  console.log("[" + w.id + "] воркер запущен");
  let globalRun = 0;

  while (true) {
    globalRun++;
    const r = await runBot(w);
    w.runs++;

    if (r.done) {
      w.wins++;
      if (r.elapsed < w.best) w.best = r.elapsed;
      const reward = 6.0 - r.elapsed;
      console.log("[" + w.id + "] FINISH " + r.elapsed.toFixed(2) + "s reward=" + reward.toFixed(2) + " best=" + w.best.toFixed(2) + " (" + w.wins + "/" + w.runs + ")");
      if (r.steps.length) rlUpdate(w, r.steps, reward, RL_LR);
      saveWeights(w);
    } else if (r.fell) {
      console.log("[" + w.id + "] FELL " + r.elapsed.toFixed(2) + "s");
      if (r.steps.length) rlUpdate(w, r.steps, -1.5, RL_LR);
    } else {
      console.log("[" + w.id + "] TIMEOUT " + r.elapsed.toFixed(2) + "s");
      if (r.steps.length) rlUpdate(w, r.steps, -1.0, RL_LR);
    }

    if (globalRun % 30 === 0) saveWeights(w);
    await sleep(20);
  }
}

// ============ ГЛАВНЫЙ ============
(async () => {
  console.log("=== uxuxx ai MEGA — 4 карты, 4 воркера, один ник ===\n");

  console.log("--- ЭТАП 1: сбор демок ---");
  for (const m of MAPS) {
    await collectDemos(m);
  }

  console.log("\n--- ЭТАП 2: загрузка карт ---");
  const workers = [];
  for (const m of MAPS) {
    const w = makeWorker(m.id, m.room);
    if (loadMap(w)) workers.push(w);
  }

  if (!workers.length) { console.log("НЕТ КАРТ"); process.exit(1); }

  console.log("\n--- ЭТАП 3: 4 воркера параллельно ---\n");
  await Promise.all(workers.map(w => loopWorker(w)));
})();
ENDJS
node nn_multi.js
