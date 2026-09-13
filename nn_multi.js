const WebSocket = require("ws");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ADDR = "188.245.236.7:30002";
const CDN = "infocdn.bhoppro.com";
const NICK = process.env.NICK || "uxuxx ai";
const RANK_ID = 16;
const RANK_STR = "Master Bhoper Elite";
const FLAG_ID = "flags_30";
const AVATAR_ID = 8;
const APP_VER = "2.6.3";

const MAP_ID = "mood";
const MAP_ROOM = "Speedrun-Mood";

const TARGET_DEMOS = 15;
const MAX_COLLECT_MS = 10 * 60 * 1000;
const TRAIN_PER_DEMO_MS = 120 * 1000;

const RL_LR = 0.001;
const PRETRAIN_LR = 0.002;
const SPEED = 2.5;
const MAX_TURN = 0.12;
const SUBSTEPS = 6;
const JUMP_H = 1.2;
const JUMP_DUR = 0.5;
const EPISODE_STEPS = 1500;
const STEP_SLEEP = 6;
const FINISH_RADIUS = 10;   // ±10 до финиша = финиш

// ====== ТОП / РЕКОРДЫ ======
const STATE_FILE = "top_state.json";
const AUTO_CHECK_MS = 5 * 60 * 1000;
const RECORD_FILE = "best_record.txt";

let STATE = { bestSent: 999, lastSent: 0, lastCheck: 0 };
try { STATE = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch (e) {}
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(STATE)); } catch (e) {} }

let BEST_TIME = 999;   // лучший результат за всё время (локально)
try {
  const n = parseFloat(fs.readFileSync(RECORD_FILE, "utf-8").trim());
  if (!isNaN(n)) BEST_TIME = n;
} catch (e) {}

const SEEN_FILE = "seen_nicks.json";

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

function download(p) {
  return new Promise(res => {
    const url = "https://" + CDN + "/demos/" + p;
    const req = https.get(url, { headers: { "User-Agent": "BestHTTP/2 v2.8.4" } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume(); download(r.headers.location).then(res); return;
      }
      if (r.statusCode !== 200) { r.resume(); res({ buf: null, status: r.statusCode }); return; }
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => res({ buf: Buffer.concat(chunks), status: 200 }));
    });
    req.on("error", e => res({ buf: null, status: "err:" + e.code }));
    req.setTimeout(15000, () => { req.destroy(); res({ buf: null, status: "timeout" }); });
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

async function sendRecord(time) {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "rec_" + Date.now();
  const ws = await connectWS("ws://" + ADDR + "/socket.io/?EIO=4&transport=websocket");
  const tStr = String(Math.floor(time/60)).padStart(2,"0") + ":" + (time%60).toFixed(3).padStart(6,"0");

  emit(ws, "register", { _id:"", deviceid, nick:NICK, coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, dt:new Date().toISOString() });
  await sleep(200);
  emit(ws, "savedata", { _id:"", deviceid, nick:NICK, coin:8400228, os:"Linux", installerName:"com.android.vending", sid:deviceid, version:APP_VER, rank_id:RANK_ID, SelectedFlag:FLAG_ID, SelectedAvatar:AVATAR_ID, guid, userpin:0, refcode:"MVSFN7SE", FirstCase:"True", dt:new Date().toISOString() });
  await sleep(200);
  emit(ws, "playerinfo", { nick:NICK, rank_str:RANK_STR, cape_str:"cape-0", rank_id:RANK_ID, flag_id:FLAG_ID, avatar_id:AVATAR_ID, pr:"-", id:guidsub });
  await sleep(100);
  emit(ws, "move", { x:0, y:0, z:0, lx:0, ly:0, lz:0, ry:0, rw:0.999, pr:"-", id:guidsub });
  await sleep(100);
  emit(ws, "joinroom", { room: MAP_ROOM, v:APP_VER, c:3, m:"v", guid, guidsub });
  await sleep(300);
  emit(ws, "connectToRoom", MAP_ROOM);
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
  try { ws.close(); } catch (e) {}
}

// Возвращает:
//   { status: "in_top", topTime: X }  — наш ник в топе
//   { status: "empty", topTime: null } — топа нет / не наш
//   { status: "err", msg }             — ошибка запроса
async function checkTop() {
  let top = [];
  try { top = await fetchScores(MAP_ROOM); }
  catch (e) { return { status: "err", msg: e.message }; }

  let ourBest = Infinity, ourEntry = null;
  for (const s of top) {
    if (s && s.nick && s.nick.includes(NICK)) {
      const tt = parseFloat(s.time);
      if (!isNaN(tt) && tt < ourBest) { ourBest = tt; ourEntry = s; }
    }
  }
  if (ourEntry) return { status: "in_top", topTime: ourBest };
  return { status: "empty", topTime: null };
}

let autoCheckRunning = false;
async function autoCheck() {
  if (autoCheckRunning) return;
  autoCheckRunning = true;
  try {
    const now = Date.now();
    if (BEST_TIME >= 999) {
      console.log("[AUTO] пока нет локального финиша — нечего отправлять");
      autoCheckRunning = false;
      return;
    }

    console.log("[AUTO] проверка топа | локальный лучший: " + BEST_TIME.toFixed(3) + "c | отправленный: " + (STATE.bestSent === 999 ? "—" : STATE.bestSent.toFixed(3) + "c"));

    const res = await checkTop();
    if (res.status === "err") {
      console.log("[AUTO] ошибка топа: " + res.msg);
      autoCheckRunning = false;
      return;
    }

    if (res.status === "in_top") {
      console.log("[AUTO] наш ник в топе (" + res.topTime.toFixed(3) + "c) — не засоряем, ждём пока исчезнет");
      autoCheckRunning = false;
      return;
    }

    // В топе нас нет — можно отправить
    if (BEST_TIME >= STATE.bestSent) {
      console.log("[AUTO] новый рекорд (" + BEST_TIME.toFixed(3) + ") не лучше отправленного (" + STATE.bestSent.toFixed(3) + ") — пропуск");
      autoCheckRunning = false;
      return;
    }

    console.log("[AUTO] отправляем новый рекорд: " + BEST_TIME.toFixed(3) + "c (было " + (STATE.bestSent === 999 ? "—" : STATE.bestSent.toFixed(3)) + ")");
    await sendRecord(BEST_TIME);
    STATE.bestSent = BEST_TIME;
    STATE.lastSent = now;
    saveState();
    console.log("[AUTO] отправлено. Следующая проверка через 5 минут");
  } catch (e) {
    console.log("[AUTO] err: " + e.message);
  }
  autoCheckRunning = false;
}

// ====== СБОР ДЕМОК ======
async function collectDemos() {
  const dir = "demos/" + MAP_ID;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const count = () => { try { return fs.readdirSync(dir).filter(f => f.endsWith(".gz")).length; } catch (e) { return 0; } };

  let have = count();
  console.log("[" + MAP_ID + "] старт: " + have + " демок | цель " + TARGET_DEMOS);
  const tStart = Date.now();
  let round = 0;

  while (have < TARGET_DEMOS && Date.now() - tStart < MAX_COLLECT_MS) {
    round++;
    let scores = [];
    try { scores = await fetchScores(MAP_ROOM); }
    catch (e) { console.log("[" + MAP_ID + "] fetch err: " + e.message); await sleep(2000); continue; }

    const left = Math.round((MAX_COLLECT_MS - (Date.now() - tStart)) / 1000);
    console.log("[" + MAP_ID + "] round " + round + " — " + scores.length + " записей | есть " + have + "/" + TARGET_DEMOS + " | осталось " + left + "с");

    let got = 0;
    for (let i = 0; i < scores.length && have < TARGET_DEMOS; i++) {
      if (Date.now() - tStart > MAX_COLLECT_MS) break;
      const s = scores[i];
      if (!s.demoFile || !s.nick) continue;
      const k = MAP_ID + ":" + s.nick;
      if (SEEN[k] === "ok") continue;
      const fails = SEEN[k + ":fails"] || 0;
      if (fails >= 2) { SEEN[k] = "dead"; saveSeen(); continue; }

      process.stdout.write("  " + s.nick + " | " + s.time + " | ");
      const { buf, status } = await download(s.demoFile);
      if (buf && buf.length > 100) {
        const safe = s.nick.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        try {
          fs.writeFileSync(dir + "/" + safe + ".gz", buf);
          SEEN[k] = "ok"; SEEN[k + ":fails"] = 0; saveSeen();
          have++; got++;
          console.log("OK " + buf.length + "b → " + have + "/" + TARGET_DEMOS);
        } catch (e) { console.log("write err"); }
      } else {
        SEEN[k + ":fails"] = fails + 1;
        saveSeen();
        console.log("fail [" + status + "]");
      }
      await sleep(300);
    }
    if (have >= TARGET_DEMOS) break;
    if (got === 0) await sleep(3000);
  }
  console.log("[" + MAP_ID + "] ИТОГ СБОРА: " + have + "/" + TARGET_DEMOS);
  return have;
}

// ====== СЕТЬ ======
const IN = 10, H1 = 64, H2 = 32, OUT = 2;
function rnd(){ return (Math.random()-0.5)*0.3; }
function zeros(a){ return Array.isArray(a[0]) ? a.map(r => r.map(()=>0)) : a.map(()=>0); }
function relu(x){ return x>0?x:0; }

const W = {
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
  wf: "weights_" + MAP_ID + ".json",
};

try {
  const ww = JSON.parse(fs.readFileSync(W.wf, "utf-8"));
  W.W1=ww.W1; W.B1=ww.B1; W.W2=ww.W2; W.B2=ww.B2; W.W3=ww.W3; W.B3=ww.B3;
  console.log("[" + MAP_ID + "] weights loaded");
} catch (e) { console.log("[" + MAP_ID + "] fresh weights"); }

const M = { W1:zeros(W.W1), B1:zeros(W.B1), W2:zeros(W.W2), B2:zeros(W.B2), W3:zeros(W.W3), B3:zeros(W.B3) };
const V = { W1:zeros(W.W1), B1:zeros(W.B1), W2:zeros(W.W2), B2:zeros(W.B2), W3:zeros(W.W3), B3:zeros(W.B3) };

function loadMap() {
  const dir = "demos/" + MAP_ID;
  W.demos = []; W.safe = new Set(); W.ymap = {};
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".gz"));
  if (!files.length) return false;

  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      let raw;
      try { raw = zlib.gunzipSync(buf).toString("utf-8"); }
      catch (e) { raw = buf.toString("utf-8"); }
      const d = JSON.parse(raw);
      if (!d.frames || d.frames.length < 5) continue;
      const p = d.frames.map(fr => ({ x: fr.x/1e5, y: fr.y/1e5, z: fr.z/1e5, t: fr.t }));
      W.demos.push({ path: p, time: p[p.length-1].t, nick: d.nick || f });
    } catch (e) {}
  }
  if (!W.demos.length) return false;

  const longest = W.demos.reduce((a,b) => a.path.length > b.path.length ? a : b);
  W.spawn = longest.path[0];
  const fastest = W.demos.reduce((a,b) => a.time < b.time ? a : b);
  W.finish = fastest.path[fastest.path.length - 1];

  for (const d of W.demos) for (const fr of d.path) {
    const k = Math.round(fr.x) + "," + Math.round(fr.z);
    W.safe.add(k);
    if (W.ymap[k] === undefined) W.ymap[k] = fr.y;
  }
  console.log("[" + MAP_ID + "] " + W.demos.length + " демок | spawn(" + W.spawn.x.toFixed(1) + "," + W.spawn.z.toFixed(1) + ") | finish(" + W.finish.x.toFixed(1) + "," + W.finish.z.toFixed(1) + ")");
  return true;
}

function isSafe(x, z) { return W.safe.has(Math.round(x) + "," + Math.round(z)); }
function getY(x, z) {
  const cx = Math.round(x), cz = Math.round(z);
  const k = cx + "," + cz;
  if (W.ymap[k] !== undefined) return W.ymap[k];
  for (let r = 1; r <= 5; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const kk = (cx+dx) + "," + (cz+dz);
    if (W.ymap[kk] !== undefined) return W.ymap[kk];
  }
  return W.spawn ? W.spawn.y : 0;
}

function bfsNext(sx, sz, gx, gz) {
  const key = (x,z) => x + "," + z;
  const sxC = Math.round(sx), szC = Math.round(sz);
  const gxC = Math.round(gx), gzC = Math.round(gz);
  const q = [[sxC,szC]], prev = new Map(); prev.set(key(sxC,szC), null);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false, n = 0;
  while (q.length && n++ < 5000) {
    const [x,z] = q.shift();
    if (x === gxC && z === gzC) { found = true; break; }
    for (const [dx,dz] of dirs) {
      const nx = x+dx, nz = z+dz, k = key(nx,nz);
      if (!W.safe.has(k) || prev.has(k)) continue;
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

function fwd(inp) {
  const h1 = new Array(H1);
  for (let i=0;i<H1;i++){ let s=W.B1[i]; for (let j=0;j<IN;j++) s += W.W1[i][j]*inp[j]; h1[i]=relu(s); }
  const h2 = new Array(H2);
  for (let i=0;i<H2;i++){ let s=W.B2[i]; for (let j=0;j<H1;j++) s += W.W2[i][j]*h1[j]; h2[i]=relu(s); }
  const o = new Array(OUT);
  for (let i=0;i<OUT;i++){ let s=W.B3[i]; for (let j=0;j<H2;j++) s += W.W3[i][j]*h2[j]; o[i]=Math.tanh(s); }
  return { o, h1, h2 };
}

function mkIn(x, z, px, pz) {
  const dx = W.finish.x - x, dz = W.finish.z - z;
  const dist = Math.hypot(dx, dz) || 1;
  const vx = x - px, vz = z - pz;
  return [ dx/100, dz/100, dx/dist, dz/dist, dist/100, vx/SPEED, vz/SPEED, Math.sin(x/50), Math.sin(z/50), dist < 20 ? 1 : 0 ];
}

function mkTgt(cx, cz, nx, nz) {
  let dx = nx - cx, dz = nz - cz;
  const l = Math.hypot(dx, dz) || 1;
  return [dx/l, dz/l];
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

function backprop(inp, tgt, lr, scale) {
  const { o, h1, h2 } = fwd(inp);
  const dO = [ 2*(o[0]-tgt[0]), 2*(o[1]-tgt[1]) ];
  for (let i=0;i<OUT;i++) if (Math.abs(dO[i])>1) dO[i]=Math.sign(dO[i]);

  const gW3 = Array.from({length:OUT}, () => Array(H2).fill(0));
  const gB3 = dO.slice();
  for (let i=0;i<OUT;i++) for (let j=0;j<H2;j++) gW3[i][j] = dO[i]*h2[j];

  const dH2 = new Array(H2).fill(0);
  for (let j=0;j<H2;j++) {
    for (let i=0;i<OUT;i++) dH2[j] += dO[i]*W.W3[i][j];
    if (h2[j] <= 0) dH2[j] = 0;
    if (Math.abs(dH2[j]) > 1) dH2[j] = Math.sign(dH2[j]);
  }
  const gW2 = Array.from({length:H2}, () => Array(H1).fill(0));
  const gB2 = dH2.slice();
  for (let i=0;i<H2;i++) for (let j=0;j<H1;j++) gW2[i][j] = dH2[i]*h1[j];

  const dH1 = new Array(H1).fill(0);
  for (let j=0;j<H1;j++) {
    for (let i=0;i<H2;i++) dH1[j] += dH2[i]*W.W2[i][j];
    if (h1[j] <= 0) dH1[j] = 0;
    if (Math.abs(dH1[j]) > 1) dH1[j] = Math.sign(dH1[j]);
  }
  const gW1 = Array.from({length:H1}, () => Array(IN).fill(0));
  const gB1 = dH1.slice();
  for (let i=0;i<H1;i++) for (let j=0;j<IN;j++) gW1[i][j] = dH1[i]*inp[j];

  W.adamT++;
  adam(W.W1, gW1, M.W1, V.W1, lr, scale, W.adamT);
  adam(W.B1, gB1, M.B1, V.B1, lr, scale, W.adamT);
  adam(W.W2, gW2, M.W2, V.W2, lr, scale, W.adamT);
  adam(W.B2, gB2, M.B2, V.B2, lr, scale, W.adamT);
  adam(W.W3, gW3, M.W3, V.W3, lr, scale, W.adamT);
  adam(W.B3, gB3, M.B3, V.B3, lr, scale, W.adamT);
  return dO[0]*dO[0] + dO[1]*dO[1];
}

function saveWeights() {
  try { fs.writeFileSync(W.wf, JSON.stringify({ W1:W.W1, B1:W.B1, W2:W.W2, B2:W.B2, W3:W.W3, B3:W.B3 })); } catch (e) {}
}

function rlUpdate(steps, reward, lr) {
  if (!steps.length) return;
  const scale = Math.sign(reward) * Math.min(Math.abs(reward), 0.5);
  for (let i=0; i<steps.length; i++) {
    const decay = Math.pow(0.995, steps.length - i);
    backprop(steps[i].inp, steps[i].action, lr, scale * decay);
  }
}

async function pretrainOnDemo(demo, idx, total) {
  const tStart = Date.now();
  const samples = [];
  for (let i = 1; i < demo.path.length - 1; i++) {
    samples.push({
      inp: mkIn(demo.path[i].x, demo.path[i].z, demo.path[i-1].x, demo.path[i-1].z),
      tgt: mkTgt(demo.path[i].x, demo.path[i].z, demo.path[i+1].x, demo.path[i+1].z)
    });
  }
  if (!samples.length) return;

  let epochs = 0;
  let lastLog = 0;
  while (Date.now() - tStart < TRAIN_PER_DEMO_MS) {
    epochs++;
    let L = 0;
    for (let i = samples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [samples[i], samples[j]] = [samples[j], samples[i]];
    }
    for (const s of samples) L += backprop(s.inp, s.tgt, PRETRAIN_LR, 1);

    const elapsed = Date.now() - tStart;
    if (elapsed - lastLog > 10000) {
      lastLog = elapsed;
      console.log("  [" + (idx+1) + "/" + total + "] " + Math.round(elapsed/1000) + "с | эпох " + epochs + " | loss " + (L/samples.length).toFixed(5));
    }
  }
  console.log("  [" + (idx+1) + "/" + total + "] готово, эпох " + epochs);
}

async function runBot() {
  const guid = mkGuid(), guidsub = guid.substring(0, 10);
  const deviceid = "a_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
  let pos = { x: W.spawn.x, y: W.spawn.y, z: W.spawn.z };
  let prev = { x: W.spawn.x, z: W.spawn.z };
  let rotY = 0;
  let waypoint = { x: W.finish.x, z: W.finish.z };
  let stuckCounter = 0;
  let lastDist = Math.hypot(W.spawn.x - W.finish.x, W.spawn.z - W.finish.z);
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
    emit(ws, "joinroom", { room: MAP_ROOM, v:APP_VER, c:3, m:"v", guid, guidsub });
    await sleep(50);
    emit(ws, "connectToRoom", MAP_ROOM);
    await sleep(100);

    let step = 0, done = false, fell = false;
    while (step < EPISODE_STEPS && ws.readyState === 1) {
      const inp = mkIn(pos.x, pos.z, prev.x, prev.z);
      const { o } = fwd(inp);

      if (step % 6 === 0 || stuckCounter > 4) {
        const wp = bfsNext(pos.x, pos.z, W.finish.x, W.finish.z);
        if (wp) waypoint = wp;
        stuckCounter = 0;
      }

      let nnX = o[0], nnZ = o[1];
      const nnMag = Math.hypot(nnX, nnZ);
      if (nnMag > 1e-6) { nnX /= nnMag; nnZ /= nnMag; }

      const eps = Math.max(0.02, 0.3 * Math.exp(-W.runs / 100));
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

      if (!isSafe(nx, nz)) {
        let found = false;
        for (let k = 1; k <= 12; k++) {
          const angles = [k*Math.PI/12, -k*Math.PI/12];
          for (const a of angles) {
            const baseAng = Math.atan2(dirZ, dirX);
            const newAng = baseAng + a;
            const tx = pos.x + Math.cos(newAng)*SPEED;
            const tz = pos.z + Math.sin(newAng)*SPEED;
            if (isSafe(tx, tz)) { nx = tx; nz = tz; dx = tx - pos.x; dz = tz - pos.z; found = true; break; }
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
      pos.y = getY(pos.x, pos.z);

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

      const dNow = Math.hypot(pos.x - W.finish.x, pos.z - W.finish.z);
      if (dNow > lastDist - 0.05) stuckCounter++; else stuckCounter = 0;
      lastDist = dNow;

      const dist3 = Math.hypot(pos.x - W.finish.x, pos.y - W.finish.y, pos.z - W.finish.z);
      if (dist3 < FINISH_RADIUS) { done = true; break; }   // ±10 до финиша
      step++;
    }
    try { ws.close(); } catch (e) {}
    const elapsed = (Date.now() - t0) / 1000;
    return { done, fell, elapsed, steps: episodeSteps };
  } catch (e) {
    return { done: false, fell: true, elapsed: 99, steps: episodeSteps };
  }
}

(async () => {
  console.log("=== uxuxx ai SOLO — " + MAP_ID + " — с отправкой рекордов ===");
  console.log("Локальный лучший: " + (BEST_TIME === 999 ? "—" : BEST_TIME.toFixed(3) + "c"));
  console.log("Уже отправленный: " + (STATE.bestSent === 999 ? "—" : STATE.bestSent.toFixed(3) + "c") + "\n");

  console.log("=== ЭТАП 1: СБОР ДЕМОК ===");
  await collectDemos();

  console.log("\n=== ЭТАП 2: ЗАГРУЗКА КАРТЫ ===");
  if (!loadMap()) { console.log("НЕТ КАРТЫ — выход"); process.exit(1); }

  console.log("\n=== ЭТАП 3: ПРЕДОБУЧЕНИЕ (по 120с на демку) ===");
  for (let i = 0; i < W.demos.length; i++) {
    await pretrainOnDemo(W.demos[i], i, W.demos.length);
  }
  saveWeights();
  console.log("=== ПРЕДОБУЧЕНИЕ ЗАВЕРШЕНО ===\n");

  // Запускаем авто-проверку топа раз в 5 минут
  setInterval(autoCheck, AUTO_CHECK_MS);

  console.log("=== ЭТАП 4: ИГРА + ОНЛАЙН-ОБУЧЕНИЕ + ОТПРАВКА РЕКОРДОВ ===\n");
  let globalRun = 0;
  while (true) {
    globalRun++;
    const r = await runBot();
    W.runs++;

    if (r.done) {
      W.wins++;
      const finished = r.elapsed;
      if (finished < W.best) W.best = finished;

      // Обновляем локальный лучший рекорд
      if (finished < BEST_TIME) {
        BEST_TIME = finished;
        fs.writeFileSync(RECORD_FILE, BEST_TIME.toFixed(3));
        console.log("[" + MAP_ID + "] FINISH " + finished.toFixed(2) + "s  ★ НОВЫЙ ЛОКАЛЬНЫЙ РЕКОРД ★");
      } else {
        console.log("[" + MAP_ID + "] FINISH " + finished.toFixed(2) + "s (best " + W.best.toFixed(2) + ")");
      }

      const reward = 20.0 - finished;
      if (r.steps.length) rlUpdate(r.steps, reward, RL_LR);
      saveWeights();
    } else if (r.fell) {
      console.log("[" + MAP_ID + "] FELL " + r.elapsed.toFixed(2) + "s");
      if (r.steps.length) rlUpdate(r.steps, -1.5, RL_LR);
    } else {
      console.log("[" + MAP_ID + "] TIMEOUT " + r.elapsed.toFixed(2) + "s");
      if (r.steps.length) rlUpdate(r.steps, -1.0, RL_LR);
    }

    if (globalRun % 30 === 0) saveWeights();
    await sleep(20);
  }
})();
