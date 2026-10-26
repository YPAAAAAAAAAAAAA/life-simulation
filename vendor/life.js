/* Tide pool — original artificial life. Clean-room, no third-party code.
   A genome, a small brain, one memory cell and a signal. Motion and calls
   come only from that brain. The basin, food and current are the world. */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("pond");
  var fold = document.getElementById("fold");
  var about = document.getElementById("about");
  var pondLine = document.getElementById("pond-line");
  var selLine = document.getElementById("sel-line");
  var ctx = canvas.getContext("2d", { alpha: false });
  var readySent = false;

  var POOL_W = 980;
  var POOL_H = 1680;
  var GLEN = 64;
  var CAP = 80;
  var N_FOOD = 132;
  var HUES = [0.02, 0.07, 0.1, 0.14, 0.42, 0.48, 0.55, 0.62, 0.74, 0.83, 0.91];

  var cssW = 1;
  var cssH = 1;
  var dpr = 1;
  var zoom = 1;
  var camX = POOL_W * 0.5;
  var camY = POOL_H * 0.5;
  var userMoved = false;
  var tick = 0;
  var peak = 1;
  var selected = null;
  var orgs = [];
  var foods = [];
  var pebbles = [];
  var bubbles = [];
  var pending = [];
  var ptrs = Object.create(null);
  var gesture = null;
  var actx = null;
  var lastChirp = 0;
  var booted = false;

  var INP = [0, 0, 0, 0, 0, 0, 0, 0];
  var OUTP = [0, 0, 0, 0];
  var HIDV = [0, 0, 0, 0];

  var cx = POOL_W * 0.5;
  var cy = POOL_H * 0.5;
  var bands = [
    { x: cx, y: cy },
    { x: cx - 40, y: cy - 176 },
    { x: cx + 46, y: cy + 176 }
  ];
  var gardens = bands.concat([
    { x: cx - 230, y: cy + 30 },
    { x: cx + 236, y: cy - 20 }
  ]);
  var rocks = [];
  var pads = [];
  var blades = [];

  function signalReady() {
    if (readySent) return;
    var gb = window.__gbSandbox;
    if (gb && typeof gb.ready === "function") {
      readySent = true;
      gb.ready();
    }
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var rng = mulberry32(0xa11fe);

  function hold(el) {
    var names = ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "wheel"];
    for (var i = 0; i < names.length; i++) {
      el.addEventListener(names[i], function (e) { e.stopPropagation(); });
    }
  }

  hold(fold);
  hold(about);
  fold.addEventListener("click", function (e) {
    e.stopPropagation();
    e.preventDefault();
    var open = about.hasAttribute("hidden");
    if (open) about.removeAttribute("hidden");
    else about.setAttribute("hidden", "");
    fold.setAttribute("aria-expanded", open ? "true" : "false");
    fold.textContent = open ? "\u00d7" : "i";
    if (open) paintHud();
  });

  function unlock() {
    if (actx || actx === false) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { actx = false; return; }
    try {
      actx = new AC();
      if (actx.state === "suspended") actx.resume();
    } catch (err) {
      actx = false;
    }
  }

  function chirp(hue) {
    if (!actx) return;
    var t = actx.currentTime;
    if (t - lastChirp < 0.4) return;
    lastChirp = t;
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(240 + hue * 460, t);
    gain.gain.setValueAtTime(0.0008, t);
    gain.gain.exponentialRampToValueAtTime(0.018, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  function ink(hue, light) {
    var h = Math.round((((hue % 1) + 1) % 1) * 360);
    return "hsl(" + h + " 70% " + light + "%)";
  }

  function randomGene(g) {
    g[0] = HUES[(rng() * HUES.length) | 0] + (rng() - 0.5) * 0.035;
    g[1] = 0.84 + rng() * 0.4;
    g[2] = 0.00085 + rng() * 0.0007;
    g[3] = 62 + rng() * 68;
    g[4] = rng();
    g[5] = 0.05 + rng() * 0.1;
    g[6] = 0.04 + rng() * 0.1;
    g[7] = 0.9 + rng() * 0.16;
    for (var i = 8; i < GLEN; i++) g[i] = (rng() * 2 - 1) * 0.62;
    g[61] = 0.5 + rng() * 0.5;
    for (var h = 0; h < 4; h++) g[56 + h] = (rng() * 2 - 1) * 0.22;
  }

  function mutate(src, dst) {
    var rate = clamp(src[5], 0.02, 0.35);
    for (var i = 0; i < GLEN; i++) {
      var v = src[i];
      if (rng() < rate) v += (rng() * 2 - 1) * (i === 0 ? 0.05 : 0.16);
      dst[i] = v;
    }
    dst[0] = ((dst[0] % 1) + 1) % 1;
    dst[1] = clamp(dst[1], 0.72, 1.42);
    dst[2] = clamp(dst[2], 0.0005, 0.0026);
    dst[3] = clamp(dst[3], 36, 150);
    dst[5] = clamp(dst[5], 0.02, 0.35);
    dst[6] = clamp(dst[6], 0.02, 0.22);
    dst[7] = clamp(dst[7], 0.76, 1.16);
  }

  function think(g) {
    var i, h, o, s;
    for (h = 0; h < 4; h++) {
      s = g[56 + h];
      for (i = 0; i < 8; i++) s += INP[i] * g[8 + i * 4 + h];
      HIDV[h] = Math.tanh(s);
    }
    for (o = 0; o < 4; o++) {
      s = g[60 + o];
      for (h = 0; h < 4; h++) s += HIDV[h] * g[40 + h * 4 + o];
      OUTP[o] = Math.tanh(s);
    }
  }

  function fillTrail(o) {
    for (var i = 0; i < 6; i++) {
      o.tx[i] = o.x;
      o.ty[i] = o.y;
    }
  }

  function makeOrg(x, y, parent) {
    var o = {
      x: x,
      y: y,
      a: rng() * 6.283185,
      v: 0,
      energy: 0.72 + rng() * 0.28,
      age: (rng() * 40) | 0,
      gen: 1,
      mem: 0,
      sig: 0,
      flash: 0,
      cool: 90 + ((rng() * 80) | 0),
      alive: true,
      r: 16,
      gene: new Float32Array(GLEN),
      tx: new Float32Array(6),
      ty: new Float32Array(6),
      ink: "#9ee",
      belly: "#fff"
    };
    if (parent) {
      mutate(parent.gene, o.gene);
      o.gen = parent.gen + 1;
      o.energy = parent.energy * 0.72;
      o.a = parent.a + (rng() - 0.5) * 0.9;
      o.age = 0;
      o.cool = 220;
      if (o.gen > peak) peak = o.gen;
    } else {
      randomGene(o.gene);
    }
    o.ink = ink(o.gene[0], 62);
    o.belly = ink(o.gene[0], 80);
    o.r = (13 + o.energy * 8) * o.gene[1];
    fillTrail(o);
    keepIn(o);
    return o;
  }

  function keepIn(o) {
    var m = 20;
    if (o.x < m) {
      o.x = m;
      if (Math.cos(o.a) < 0) o.a = Math.PI - o.a;
    } else if (o.x > POOL_W - m) {
      o.x = POOL_W - m;
      if (Math.cos(o.a) > 0) o.a = Math.PI - o.a;
    }
    if (o.y < m) {
      o.y = m;
      if (Math.sin(o.a) < 0) o.a = -o.a;
    } else if (o.y > POOL_H - m) {
      o.y = POOL_H - m;
      if (Math.sin(o.a) > 0) o.a = -o.a;
    }
  }

  function placeFood(f, home) {
    var g = home ? bands[(rng() * bands.length) | 0] : gardens[(rng() * gardens.length) | 0];
    var ang = rng() * 6.283185;
    var rad = home ? 8 + rng() * 78 : rng() * 130;
    f.x = clamp(g.x + Math.cos(ang) * rad, 18, POOL_W - 18);
    f.y = clamp(g.y + Math.sin(ang) * rad, 18, POOL_H - 18);
    f.kind = rng();
    f.ph = rng() * 6.283185;
    f.eaten = 0;
    if (f.kind < 0.72) {
      f.core = "#f0d48a";
      f.halo = "rgba(240,212,138,0.28)";
    } else if (f.kind < 0.9) {
      f.core = "#b7d98a";
      f.halo = "rgba(183,217,138,0.28)";
    } else {
      f.core = "#f0b0c4";
      f.halo = "rgba(240,176,196,0.26)";
    }
  }

  function seedWorld() {
    var i, b;
    rocks.length = 0;
    pads.length = 0;
    blades.length = 0;
    pebbles.length = 0;
    for (b = 0; b < bands.length; b++) {
      var band = bands[b];
      pads.push({ x: band.x, y: band.y, r: 108 });
      pads.push({ x: band.x + 36, y: band.y - 16, r: 62 });
      rocks.push({ x: band.x - 128, y: band.y + 8, r: 20 });
      rocks.push({ x: band.x + 124, y: band.y - 14, r: 16 });
      blades.push({ x: band.x - 108, y: band.y + 36, h: 26, lean: 10 });
      blades.push({ x: band.x + 112, y: band.y + 20, h: 22, lean: -8 });
      for (i = 0; i < 7; i++) {
        pebbles.push({
          x: band.x + (rng() - 0.5) * 200,
          y: band.y + (rng() - 0.5) * 120,
          r: 2 + rng() * 4
        });
      }
    }
    foods.length = 0;
    for (i = 0; i < N_FOOD; i++) {
      var f = {};
      placeFood(f, i < 108);
      foods.push(f);
    }
    orgs.length = 0;
    for (b = 0; b < bands.length; b++) {
      for (i = 0; i < 15; i++) {
        var ang = rng() * 6.283185;
        var rad = 14 + rng() * 58;
        orgs.push(makeOrg(bands[b].x + Math.cos(ang) * rad, bands[b].y + Math.sin(ang) * rad, null));
      }
    }
    for (i = 0; i < 8; i++) {
      orgs.push(makeOrg(48 + rng() * (POOL_W - 96), 48 + rng() * (POOL_H - 96), null));
    }
    bubbles.length = 0;
    for (i = 0; i < 11; i++) {
      bubbles.push({
        x: rng(),
        y: rng(),
        r: 1.1 + rng() * 2.2,
        s: 0.12 + rng() * 0.28
      });
    }
  }

  function senseAndAct(o) {
    var g = o.gene;
    var c = Math.cos(o.a);
    var s = Math.sin(o.a);
    var sense = g[3];
    var sense2 = sense * sense;
    var i, dx, dy, d2, best, fx, fy, found;
    INP[0] = o.energy * 2 - 1;
    best = sense2;
    found = false;
    fx = 0;
    fy = 0;
    var eat2 = 15 * 15;
    var ate = -1;
    var ateD = eat2;
    for (i = 0; i < foods.length; i++) {
      var f = foods[i];
      if (f.eaten) continue;
      dx = f.x - o.x;
      dy = f.y - o.y;
      d2 = dx * dx + dy * dy;
      if (d2 < ateD) {
        ateD = d2;
        ate = i;
      }
      if (d2 < best) {
        best = d2;
        fx = dx;
        fy = dy;
        found = true;
      }
    }
    if (found) {
      INP[1] = (fx * c + fy * s) / sense;
      INP[2] = (-fx * s + fy * c) / sense;
    } else {
      INP[1] = 0;
      INP[2] = 0;
    }
    var near = null;
    var nearD = sense2;
    var loud = null;
    var loudS = 0.2;
    for (i = 0; i < orgs.length; i++) {
      var q = orgs[i];
      if (q === o || !q.alive) continue;
      dx = q.x - o.x;
      dy = q.y - o.y;
      d2 = dx * dx + dy * dy;
      if (d2 < nearD) {
        nearD = d2;
        near = q;
        fx = dx;
        fy = dy;
      }
      if (d2 < sense2 && q.sig > loudS) {
        loudS = q.sig;
        loud = q;
      }
    }
    var nb = loud || near;
    if (nb) {
      dx = nb.x - o.x;
      dy = nb.y - o.y;
      INP[3] = (dx * c + dy * s) / sense;
      INP[4] = (-dx * s + dy * c) / sense;
      INP[5] = 0.12 + nb.sig;
    } else {
      INP[3] = 0;
      INP[4] = 0;
      INP[5] = 0;
    }
    INP[6] = o.mem;
    var px = 0;
    var py = 0;
    var margin = 78;
    if (o.x < margin) px = -(1 - o.x / margin);
    else if (o.x > POOL_W - margin) px = 1 - (POOL_W - o.x) / margin;
    if (o.y < margin) py = -(1 - o.y / margin);
    else if (o.y > POOL_H - margin) py = 1 - (POOL_H - o.y) / margin;
    INP[7] = px * c + py * s;

    think(g);

    o.a += OUTP[0] * 0.055;
    o.a += Math.sin(o.x * 0.014 + tick * 0.008) * 0.011;
    c = Math.cos(o.a);
    s = Math.sin(o.a);
    var thrust = OUTP[1];
    o.v = o.v * 0.86 + thrust * 0.05;
    if (o.v > 0.36) o.v = 0.36;
    if (o.v < -0.1) o.v = -0.1;
    o.x += c * o.v;
    o.y += s * o.v;
    keepIn(o);

    var emit = OUTP[2] * 0.5 + 0.5;
    if (emit > 0.68) {
      o.sig = emit;
      o.energy -= 0.0016;
    } else {
      o.sig *= 0.9;
    }
    var write = OUTP[3];
    o.mem += (write - o.mem) * g[6];
    if (o.mem > 1) o.mem = 1;
    else if (o.mem < -1) o.mem = -1;

    o.energy -= g[2] + Math.abs(o.v) * 0.00045;
    if (orgs.length > 62) o.energy -= (orgs.length - 62) * 0.00011;

    if (ate >= 0) {
      foods[ate].eaten = 1;
      o.energy += 0.3;
      o.flash = 1;
    }
    if (o.energy > 1.35) o.energy = 1.35;

    o.cool -= 1;
    if (o.cool <= 0 && o.age > 150 && o.energy > g[7] && orgs.length + pending.length < CAP) {
      o.energy *= 0.54;
      o.cool = 210;
      o.flash = 1;
      var child = makeOrg(o.x + Math.cos(o.a + 1.4) * 14, o.y + Math.sin(o.a + 1.4) * 14, o);
      pending.push(child);
      chirp(o.gene[4]);
    }

    if (o.flash > 0) o.flash *= 0.86;
    o.age += 1;
    o.r = (13 + o.energy * 8) * g[1];
    var k;
    for (k = 5; k > 0; k--) {
      o.tx[k] = o.tx[k - 1];
      o.ty[k] = o.ty[k - 1];
    }
    o.tx[0] = o.x;
    o.ty[0] = o.y;
    if (o.energy <= 0.03 || o.age > 4200) o.alive = false;
  }

  function step() {
    var i;
    pending.length = 0;
    for (i = 0; i < orgs.length; i++) {
      if (orgs[i].alive) senseAndAct(orgs[i]);
    }
    var w = 0;
    for (i = 0; i < orgs.length; i++) {
      if (orgs[i].alive) orgs[w++] = orgs[i];
    }
    orgs.length = w;
    for (i = 0; i < pending.length; i++) orgs.push(pending[i]);
    pending.length = 0;
    if (selected && !selected.alive) selected = null;
    if (orgs.length < 16) {
      for (i = 0; i < 4; i++) orgs.push(makeOrg(cx + (rng() - 0.5) * 80, cy + (rng() - 0.5) * 80, null));
    }
    for (i = 0; i < foods.length; i++) {
      var f = foods[i];
      if (f.eaten) placeFood(f, rng() < 0.7);
      f.x += Math.sin(tick * 0.02 + f.ph) * 0.1;
      f.y += Math.cos(tick * 0.017 + f.ph) * 0.08;
      if (f.x < 16) f.x = 16;
      else if (f.x > POOL_W - 16) f.x = POOL_W - 16;
      if (f.y < 16) f.y = 16;
      else if (f.y > POOL_H - 16) f.y = POOL_H - 16;
    }
    tick += 1;
  }

  function paintHud() {
    if (about.hasAttribute("hidden")) return;
    pondLine.textContent = orgs.length + " alive · generation " + peak;
    if (selected && selected.alive) {
      selLine.style.color = selected.ink;
      selLine.textContent =
        "Energy " + Math.round(selected.energy * 100) +
        "% · memory " + selected.mem.toFixed(2) +
        " · call " + selected.sig.toFixed(2) +
        " · gen " + selected.gen;
    } else {
      selLine.style.color = "";
      selLine.textContent = "Tap a creature to read its body.";
    }
  }

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    cssW = stage.clientWidth || window.innerWidth || 390;
    cssH = stage.clientHeight || window.innerHeight || 844;
    if (cssW < 8 || cssH < 8) return;
    canvas.width = Math.max(2, Math.round(cssW * dpr));
    canvas.height = Math.max(2, Math.round(cssH * dpr));
    if (!userMoved) {
      zoom = clamp(Math.min(cssW / 300, cssH / 640), 0.7, 1.55);
      camX = cx;
      camY = cy;
    }
    clampCam();
  }

  function clampCam() {
    var hw = cssW / (2 * zoom);
    var hh = cssH / (2 * zoom);
    var minX = hw - 90;
    var maxX = POOL_W - hw + 90;
    camX = minX > maxX ? cx : clamp(camX, minX, maxX);
    var minY = hh - 90;
    var maxY = POOL_H - hh + 90;
    camY = minY > maxY ? cy : clamp(camY, minY, maxY);
  }

  function drawOrg(o) {
    var len = o.r * (1 + Math.sin(o.age * 0.14) * 0.03);
    var wid = len * 0.46;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = o.ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(o.tx[0], o.ty[0]);
    for (var t = 1; t < 6; t++) ctx.lineTo(o.tx[t], o.ty[t]);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.ellipse(1.4, 2.2, len * 0.4, len * 0.2, 0, 0, 6.2832);
    ctx.fill();
    ctx.rotate(o.a);
    ctx.fillStyle = o.ink;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(len * 0.95, 0);
    ctx.quadraticCurveTo(len * 0.2, wid, -len * 0.55, wid * 0.42);
    ctx.quadraticCurveTo(-len * 1.05, wid * 0.15, -len * 0.72, 0);
    ctx.quadraticCurveTo(-len * 1.05, -wid * 0.15, -len * 0.55, -wid * 0.42);
    ctx.quadraticCurveTo(len * 0.2, -wid, len * 0.95, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = o.belly;
    ctx.beginPath();
    ctx.ellipse(len * 0.12, 0, len * 0.32, wid * 0.46, 0, 0, 6.2832);
    ctx.fill();
    var er = Math.max(1.15, wid * 0.16);
    ctx.fillStyle = "rgba(10,16,14,0.9)";
    ctx.beginPath();
    ctx.arc(len * 0.52, wid * 0.28, er, 0, 6.2832);
    ctx.arc(len * 0.52, -wid * 0.28, er, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(len * 0.52 + er * 0.3, wid * 0.28 - er * 0.3, er * 0.35, 0, 6.2832);
    ctx.arc(len * 0.52 + er * 0.3, -wid * 0.28 - er * 0.3, er * 0.35, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.arc(len * 0.05 + o.mem * len * 0.22, 0, Math.max(1.15, wid * 0.11), 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = o.ink;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(-len * 0.62, 0);
    ctx.quadraticCurveTo(-len * 1.05, wid * 0.55, -len * 1.4, wid * 0.12);
    ctx.moveTo(-len * 0.62, 0);
    ctx.quadraticCurveTo(-len * 1.05, -wid * 0.55, -len * 1.4, -wid * 0.12);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    if (o.sig > 0.42) {
      ctx.globalAlpha = Math.min(0.7, o.sig);
      ctx.strokeStyle = o.ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(o.x, o.y, len + 7 + (1 - o.sig) * 12, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (o.flash > 0.08) {
      ctx.globalAlpha = o.flash * 0.75;
      ctx.strokeStyle = "#fff4d2";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(o.x, o.y, len + (1 - o.flash) * 14, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#071614";
    ctx.fillRect(0, 0, cssW, cssH);
    var light = ctx.createRadialGradient(cssW * 0.5, cssH * 0.36, cssW * 0.08, cssW * 0.5, cssH * 0.42, Math.max(cssW, cssH) * 0.72);
    light.addColorStop(0, "rgba(168,214,196,0.16)");
    light.addColorStop(0.5, "rgba(10,40,42,0)");
    light.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(cssW * 0.5, cssH * 0.5);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.fillStyle = "rgba(16, 36, 34, 0.55)";
    ctx.fillRect(-160, -160, POOL_W + 320, POOL_H + 320);
    ctx.fillStyle = "rgba(10, 48, 46, 0.42)";
    ctx.fillRect(0, 0, POOL_W, POOL_H);

    var i;
    ctx.fillStyle = "rgba(42, 120, 96, 0.30)";
    for (i = 0; i < pads.length; i++) {
      ctx.beginPath();
      ctx.arc(pads[i].x, pads[i].y, pads[i].r, 0, 6.2832);
      ctx.fill();
    }
    for (i = 0; i < rocks.length; i++) {
      var rk = rocks[i];
      ctx.fillStyle = "#1a302c";
      ctx.beginPath();
      ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.72, 0.4, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = "rgba(90, 130, 118, 0.35)";
      ctx.beginPath();
      ctx.ellipse(rk.x - rk.r * 0.2, rk.y - rk.r * 0.18, rk.r * 0.42, rk.r * 0.24, 0.4, 0, 6.2832);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(28, 48, 44, 0.7)";
    for (i = 0; i < pebbles.length; i++) {
      ctx.beginPath();
      ctx.arc(pebbles[i].x, pebbles[i].y, pebbles[i].r, 0, 6.2832);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(168, 204, 170, 0.42)";
    ctx.lineWidth = 1.4;
    for (i = 0; i < blades.length; i++) {
      var b = blades[i];
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.quadraticCurveTo(b.x + b.lean, b.y - b.h * 0.55, b.x + b.lean * 0.35, b.y - b.h);
      ctx.stroke();
    }
    for (i = 0; i < foods.length; i++) {
      var f = foods[i];
      if (f.eaten) continue;
      ctx.fillStyle = f.halo;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6.5, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = f.core;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 2.5, 0, 6.2832);
      ctx.fill();
    }
    orgs.sort(function (a, b2) { return a.y - b2.y; });
    for (i = 0; i < orgs.length; i++) drawOrg(orgs[i]);
    if (selected && selected.alive) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, selected.r + 8, 0, 6.2832);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(190, 214, 198, 0.2)";
    ctx.lineWidth = 7;
    ctx.strokeRect(10, 10, POOL_W - 20, POOL_H - 20);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "rgba(220, 245, 236, 0.28)";
    ctx.lineWidth = 1;
    for (i = 0; i < bubbles.length; i++) {
      var bub = bubbles[i];
      bub.y -= bub.s / Math.max(cssH, 1);
      if (bub.y < -0.02) bub.y = 1.02;
      ctx.beginPath();
      ctx.arc(bub.x * cssW, bub.y * cssH, bub.r, 0, 6.2832);
      ctx.stroke();
    }
  }

  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pinchNow() {
    var keys = [];
    for (var k in ptrs) keys.push(k);
    if (keys.length < 2) return null;
    var a = ptrs[keys[0]];
    var b = ptrs[keys[1]];
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) * 0.5,
      y: (a.y + b.y) * 0.5
    };
  }

  function ptrCount() {
    var n = 0;
    for (var k in ptrs) n++;
    return n;
  }

  function selectAt(sx, sy) {
    var wpt = {
      x: camX + (sx - cssW * 0.5) / zoom,
      y: camY + (sy - cssH * 0.5) / zoom
    };
    var best = null;
    var bestD = 1e9;
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      var dx = o.x - wpt.x;
      var dy = o.y - wpt.y;
      var hit = o.r + 12;
      var d2 = dx * dx + dy * dy;
      if (d2 < hit * hit && d2 < bestD) {
        bestD = d2;
        best = o;
      }
    }
    selected = best;
    paintHud();
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlock();
    var p = localPoint(e);
    ptrs[e.pointerId] = { x: p.x, y: p.y };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (ptrCount() === 1) {
      gesture = { moved: 0, x: p.x, y: p.y, pinch: 0 };
    } else if (gesture) {
      var q = pinchNow();
      if (q && q.d > 1) {
        gesture.pinch = q.d;
        gesture.zoom = zoom;
        gesture.wx = camX + (q.x - cssW * 0.5) / zoom;
        gesture.wy = camY + (q.y - cssH * 0.5) / zoom;
      }
    }
  }, { passive: false });

  canvas.addEventListener("pointermove", function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    e.preventDefault();
    var loc = localPoint(e);
    var dx = loc.x - p.x;
    var dy = loc.y - p.y;
    p.x = loc.x;
    p.y = loc.y;
    if (!gesture) return;
    gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (ptrCount() >= 2 && gesture.pinch > 1) {
      var q = pinchNow();
      if (!q || q.d < 1) return;
      userMoved = true;
      var nz = clamp(gesture.zoom * (q.d / gesture.pinch), 0.42, 2.35);
      var wx = camX + (q.x - cssW * 0.5) / zoom;
      var wy = camY + (q.y - cssH * 0.5) / zoom;
      zoom = nz;
      camX = wx - (q.x - cssW * 0.5) / zoom;
      camY = wy - (q.y - cssH * 0.5) / zoom;
      clampCam();
    } else if (ptrCount() === 1) {
      if (gesture.moved > 6) userMoved = true;
      camX -= dx / zoom;
      camY -= dy / zoom;
      clampCam();
    }
  }, { passive: false });

  function endPtr(e) {
    if (!ptrs[e.pointerId]) return;
    delete ptrs[e.pointerId];
    if (ptrCount() === 0 && gesture && gesture.moved < 12) selectAt(gesture.x, gesture.y);
    if (ptrCount() === 1 && gesture) gesture.pinch = 0;
    if (ptrCount() === 0) gesture = null;
  }

  canvas.addEventListener("pointerup", endPtr);
  canvas.addEventListener("pointercancel", endPtr);
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    userMoved = true;
    var loc = localPoint(e);
    var nz = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.42, 2.35);
    var wx = camX + (loc.x - cssW * 0.5) / zoom;
    var wy = camY + (loc.y - cssH * 0.5) / zoom;
    zoom = nz;
    camX = wx - (loc.x - cssW * 0.5) / zoom;
    camY = wy - (loc.y - cssH * 0.5) / zoom;
    clampCam();
  }, { passive: false });

  fold.addEventListener("pointerdown", unlock);

  function frame() {
    requestAnimationFrame(frame);
    var w = stage.clientWidth || window.innerWidth || 0;
    var h = stage.clientHeight || window.innerHeight || 0;
    if (w < 8 || h < 8) return;
    if (!booted) {
      booted = true;
      fit();
      seedWorld();
      for (var i = 0; i < 6; i++) step();
      draw();
      signalReady();
      return;
    }
    if (Math.abs(w - cssW) > 1 || Math.abs(h - cssH) > 1) fit();
    step();
    draw();
    if ((tick % 18) === 0) paintHud();
    if (!readySent) signalReady();
  }

  if (!ctx) {
    requestAnimationFrame(function () { signalReady(); });
    return;
  }
  window.addEventListener("resize", fit);
  requestAnimationFrame(frame);
})();
