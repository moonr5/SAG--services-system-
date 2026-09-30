const items = document.querySelectorAll(".rail-item");

// The rail: a curved track through the nav icons with a brass light running along it.
// The light wraps every icon it reaches, rushes to the icon under the pointer or keyboard
// focus, and flares on the page that opens. Everything that moves is drawn on two canvases
// (a crisp layer and a blurred bloom layer), so animation frames never touch layout.
// The track runs down the side on wide screens and across the bottom bar on phones
// (--rail-axis), and all of its colours come from CSS custom properties.
const railLight = (() => {
  const rail = document.querySelector(".rail");
  const fx = rail?.querySelector(".rail-fx");
  if (!fx || !items.length) return { setActive() {} };

  const SVG_NS = "http://www.w3.org/2000/svg";
  const base = fx.querySelector(".rail-base");
  const bloomCanvas = fx.querySelector(".rail-bloom");
  const lightCanvas = fx.querySelector(".rail-light");
  const bloom = bloomCanvas.getContext("2d");
  const light = lightCanvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const RING_GAP = 4; // px between an icon and the ring the light runs on
  const LABEL_CLEARANCE = 5; // the track resumes this far below each label
  const LINK_SWAY = 3;
  const CURVE_STEPS = 48;
  const SPEED_LINK = 780; // px/s
  const SPEED_RING = 560;
  const SPEED_SEEK = 1500;
  const SPEED_ORBIT = 170;
  const TRAIL_MS = 260;
  const TRAIL_LEN = 130;
  const TRAIL_CAP = 1024;
  const INTRO_MS = 650;
  const REST_MS = 1300;
  const VISIT_MS = 1400;
  const BURST_MS = 700;
  const BLOOM_SCALE = 0.5;

  const nodes = [...items].map((item, index) => {
    item.style.setProperty("--i", index);
    return {
      item,
      icon: item.querySelector(".rail-icon"),
      label: item.querySelector(".rail-label"),
      shift: "",
      ringEl: null,
      glow: { energy: 0, full: false, u0: 0, w: 0, lo: 0, hi: 0, burstAt: 0, flaredAt: 0, lit: false },
    };
  });
  const comet = { alive: false, s: 0, v: 0, orbit: 0, restUntil: 0 };
  const trail = {
    x: new Float32Array(TRAIL_CAP),
    y: new Float32Array(TRAIL_CAP),
    vis: new Float32Array(TRAIL_CAP),
    t: new Float64Array(TRAIL_CAP),
    reach: new Float32Array(TRAIL_CAP),
    head: 0,
    count: 0,
  };
  const probe = { x: 0, y: 0, vis: 1 };
  const mod = (value, size) => ((value % size) + size) % size;
  const fmt = (value) => value.toFixed(2);

  let geo = null;
  let theme = { key: "", sweep: [], trail: [], core: "#FFFFFF" };
  let baseParts = [];
  let running = false;
  let frameId = 0;
  let lastFrame = 0;
  let holdUntil = 0;
  let idle = false;
  let queued = false;
  let hoverIndex = null;
  let activeIndex = -1;
  let visit = null;
  let pendingFlare = null;
  let cometRing = -1;

  // ── Colour ──
  // The light's colours come from CSS (--rail-sweep, --rail-trail, --rail-core), so the
  // palette lives in one place. They're blended in OKLab, which keeps the steps between
  // brand colours even instead of dipping through muddy mid-tones.

  function readTheme() {
    const style = getComputedStyle(rail);
    const list = (name) => style.getPropertyValue(name).split(",").map((value) => value.trim()).filter(Boolean);
    const sweepColors = list("--rail-sweep");
    const trailColors = list("--rail-trail");
    const core = style.getPropertyValue("--rail-core").trim() || "#FFFFFF";
    const key = `${sweepColors}|${trailColors}|${core}`;
    if (key === theme.key) return;
    theme = {
      key,
      sweep: blend(sweepColors.map(toLab), 240, true),
      trail: blend(trailColors.map(toLab), 120, false),
      core,
    };
  }

  function toLab(color) {
    // The canvas normalises any CSS colour to #rrggbb (or rgba() when translucent).
    light.fillStyle = "#000000";
    light.fillStyle = color;
    const value = String(light.fillStyle);
    const rgb = value.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
      : (value.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const [r, g, b] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function labToRgb([L, A, B]) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const encode = (v) => {
      const c = Math.min(1, Math.max(0, v));
      return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    };
    const r = encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    const g = encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    const b = encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // A lookup table of `size` colours through the stops; `cyclic` runs the last back into the first.
  function blend(stops, size, cyclic) {
    if (stops.length < 2) return [stops.length ? labToRgb(stops[0]) : "transparent"];
    const spans = cyclic ? stops.length : stops.length - 1;
    return Array.from({ length: size }, (_, i) => {
      const f = (i / (cyclic ? size : size - 1)) * spans;
      const k = Math.min(spans - 1, Math.floor(f));
      const from = stops[k];
      const to = stops[(k + 1) % stops.length];
      return labToRgb(from.map((value, n) => value + (to[n] - value) * (f - k)));
    });
  }

  const sweepAt = (u) => theme.sweep[Math.floor(mod(u, 1) * theme.sweep.length) % theme.sweep.length];
  const trailAt = (f) => theme.trail[Math.min(theme.trail.length - 1, Math.max(0, Math.floor(f * theme.trail.length)))];

  function sweep(ctx, cx, cy, angle) {
    const gradient = ctx.createConicGradient
      ? ctx.createConicGradient(angle, cx, cy)
      : ctx.createLinearGradient(cx - Math.cos(angle) * 24, cy - Math.sin(angle) * 24, cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24);
    for (let i = 0; i <= 12; i += 1) gradient.addColorStop(i / 12, sweepAt(i / 12));
    return gradient;
  }

  // ── Track geometry ──
  // The track is one path, sampled every pixel: a lead-in, then for each icon a ring
  // unrolled to 1.5 laps and a curve to the next icon. Down the side, the light enters a
  // ring at the top, leaves at the bottom and passes behind the label; across the bottom
  // bar it enters on the left and leaves on the right. On a ring, s and s + P are the same
  // point, which lets the light skip or repeat laps without leaving the path.

  function measure() {
    const box = fx.getBoundingClientRect();
    const style = getComputedStyle(rail);
    const length = (name, fallback) => {
      const value = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const across = style.getPropertyValue("--rail-axis").trim() === "x";
    const arcStart = length("--arc-start", 38);
    const arcBulge = length("--arc-bulge", 0);
    const corner = parseFloat(getComputedStyle(nodes[0].icon).borderTopLeftRadius) || 8;
    const bow = (along, size) => Math.sin(Math.PI * Math.min(1, Math.max(0, along / size)));
    const spots = nodes.map((node) => {
      const iconBox = node.icon.getBoundingClientRect();
      const labelBox = node.label.getBoundingClientRect();
      // Where the item sits without the arc offset it may already have.
      const moved = new DOMMatrixReadOnly(getComputedStyle(node.item).transform);
      const x = iconBox.left + iconBox.width / 2 - box.left - moved.m41;
      const y = iconBox.top + iconBox.height / 2 - box.top - moved.m42;
      const cx = across ? x : arcStart + arcBulge * bow(y, box.height);
      const cy = across ? y - arcBulge * bow(x, box.width) : y;
      return {
        cx,
        cy,
        dx: cx - x,
        dy: cy - y,
        half: node.icon.offsetWidth / 2 + RING_GAP,
        radius: corner + RING_GAP,
        labelBottom: labelBox.bottom - box.top - moved.m42 + (cy - y),
      };
    });
    return { width: box.width, height: box.height, across, spots };
  }

  function place(spots) {
    spots.forEach((spot, index) => {
      const node = nodes[index];
      const shift = `translate(${fmt(spot.dx)}px, ${fmt(spot.dy)}px)`;
      if (node.shift === shift) return;
      node.shift = shift;
      node.item.style.transform = shift;
    });
  }

  function straight(x0, y0, x1, y1, dip, drawn) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    return {
      length,
      drawn,
      path: drawn && length > 0.5 ? `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}` : "",
      at(u, out) {
        const f = length ? u / length : 0;
        out.x = x0 + (x1 - x0) * f;
        out.y = y0 + (y1 - y0) * f;
        out.vis = 1 - dip * Math.sin(Math.PI * f);
      },
    };
  }

  function bezier(p, t, out) {
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    out.x = a * p[0] + b * p[2] + c * p[4] + d * p[6];
    out.y = a * p[1] + b * p[3] + c * p[5] + d * p[7];
  }

  // A link between two icons, leaving and arriving along the track's axis with a slight bow.
  function curve(x0, y0, x1, y1, side, across) {
    const run = across ? (x1 - x0) / 2 : (y1 - y0) / 2;
    const sway = side * Math.min(LINK_SWAY, Math.abs(run) * 0.16);
    const p = across
      ? [x0, y0, x0 + run, y0 + sway, x1 - run, y1 + sway, x1, y1]
      : [x0, y0, x0 + sway, y0 + run, x1 + sway, y1 - run, x1, y1];
    const table = new Float32Array(CURVE_STEPS + 1);
    let px = x0;
    let py = y0;
    for (let i = 1; i <= CURVE_STEPS; i += 1) {
      bezier(p, i / CURVE_STEPS, probe);
      table[i] = table[i - 1] + Math.hypot(probe.x - px, probe.y - py);
      px = probe.x;
      py = probe.y;
    }
    return {
      length: table[CURVE_STEPS],
      drawn: true,
      path: `M${fmt(x0)} ${fmt(y0)}C${fmt(p[2])} ${fmt(p[3])} ${fmt(p[4])} ${fmt(p[5])} ${fmt(x1)} ${fmt(y1)}`,
      at(u, out) {
        let lo = 0;
        let hi = CURVE_STEPS;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (table[mid] <= u) lo = mid;
          else hi = mid;
        }
        const span = table[hi] - table[lo];
        bezier(p, (lo + (span ? (u - table[lo]) / span : 0)) / CURVE_STEPS, out);
        out.vis = 1;
      },
    };
  }

  function loop({ cx, cy, half, radius }, dir, across) {
    const edge = half - radius;
    const quarter = (Math.PI / 2) * radius;
    const sweepFlag = dir > 0 ? 1 : 0;
    const x = (dx) => fmt(cx + dir * dx);
    const arc = `A${fmt(radius)} ${fmt(radius)} 0 0 ${sweepFlag}`;
    const P = 8 * edge + 4 * quarter;
    const ring = {
      ring: true,
      drawn: true,
      cx,
      cy,
      half,
      radius,
      edge,
      quarter,
      dir,
      P,
      // Laps start at the top centre; across the bar they start at the left centre instead,
      // and the drawn outline turns a quarter so it begins there too.
      offset: across ? (dir > 0 ? 0.75 : 0.25) * P : 0,
      turn: across ? -90 : 0,
      path:
        `M${x(0)} ${fmt(cy - half)}H${x(edge)}${arc} ${x(half)} ${fmt(cy - edge)}V${fmt(cy + edge)}` +
        `${arc} ${x(edge)} ${fmt(cy + half)}H${x(-edge)}${arc} ${x(-half)} ${fmt(cy + edge)}` +
        `V${fmt(cy - edge)}${arc} ${x(-edge)} ${fmt(cy - half)}Z`,
      at(u, out) {
        loopPoint(ring, u, out);
        out.vis = 1;
      },
    };
    ring.length = 1.5 * P;
    return ring;
  }

  // Point u px along a ring, from its starting point in its direction of travel.
  function loopPoint(ring, u, out) {
    const { cx, cy, half, radius: r, edge: e, quarter: q, P, dir } = ring;
    let d = mod(u + ring.offset, P);
    let x;
    let y;
    if (d < e) {
      x = d;
      y = -half;
    } else if ((d -= e) < q) {
      x = e + r * Math.cos(d / r - Math.PI / 2);
      y = -e + r * Math.sin(d / r - Math.PI / 2);
    } else if ((d -= q) < 2 * e) {
      x = half;
      y = d - e;
    } else if ((d -= 2 * e) < q) {
      x = e + r * Math.cos(d / r);
      y = e + r * Math.sin(d / r);
    } else if ((d -= q) < 2 * e) {
      x = e - d;
      y = half;
    } else if ((d -= 2 * e) < q) {
      x = -e + r * Math.cos(d / r + Math.PI / 2);
      y = e + r * Math.sin(d / r + Math.PI / 2);
    } else if ((d -= q) < 2 * e) {
      x = -half;
      y = e - d;
    } else if ((d -= 2 * e) < q) {
      x = -e + r * Math.cos(d / r + Math.PI);
      y = -e + r * Math.sin(d / r + Math.PI);
    } else {
      x = d - q - e;
      y = -half;
    }
    out.x = cx + dir * x;
    out.y = cy + y;
  }

  function build({ width, height, across, spots }) {
    const pieces = [];
    let length = 0;
    const add = (piece) => {
      piece.start = length;
      length += piece.length;
      pieces.push(piece);
      return piece;
    };

    const first = spots[0];
    add(across
      ? straight(0, first.cy, Math.max(0, first.cx - first.half), first.cy, 0, true)
      : straight(first.cx, 0, first.cx, Math.max(0, first.cy - first.half), 0, true));
    const rings = spots.map((spot, index) => {
      const next = spots[index + 1];
      const ring = add(loop(spot, index % 2 ? -1 : 1, across));
      ring.index = index;
      // Each link bows toward the side the next ring turns to, so the light swings into it.
      const side = index % 2 ? 1 : -1;
      if (across) {
        const exit = spot.cx + spot.half;
        if (next) add(curve(exit, spot.cy, next.cx - next.half, next.cy, side, true));
        else add(straight(exit, spot.cy, width, spot.cy, 0, true));
      } else {
        const bottom = spot.cy + spot.half;
        const exit = Math.max(bottom, Math.min(spot.labelBottom + LABEL_CLEARANCE, next ? next.cy - next.half - 2 : height));
        add(straight(spot.cx, bottom, spot.cx, exit, 0.6, false));
        if (next) add(curve(spot.cx, exit, next.cx, next.cy - next.half, -side, false));
        else add(straight(spot.cx, exit, spot.cx, height, 0, true));
      }
      return ring;
    });

    const count = Math.max(2, Math.ceil(length) + 1);
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const vis = new Float32Array(count);
    for (let k = 0, p = 0; k < count; k += 1) {
      const s = Math.min(k, length);
      while (p < pieces.length - 1 && s > pieces[p].start + pieces[p].length) p += 1;
      pieces[p].at(s - pieces[p].start, probe);
      xs[k] = probe.x;
      ys[k] = probe.y;
      vis[k] = probe.vis;
    }

    rings.forEach((ring) => {
      ring.a = ring.start;
      ring.b = ring.start + ring.length;
      const n = Math.ceil(2 * ring.P) + 2;
      ring.loopX = new Float32Array(n);
      ring.loopY = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        loopPoint(ring, i, probe);
        ring.loopX[i] = probe.x;
        ring.loopY[i] = probe.y;
      }
    });

    // Capping each frame's step well under a quarter lap keeps lap skipping exact.
    const maxStep = 0.2 * Math.min(...rings.map((ring) => ring.P));
    return { width, height, across, pieces, rings, length, xs, ys, vis, maxStep };
  }

  function paintBase() {
    const drawn = geo.pieces.filter((piece) => piece.drawn);
    if (baseParts.length !== drawn.length) {
      baseParts.forEach((part) => part.remove());
      baseParts = drawn.map((piece, order) => {
        const part = document.createElementNS(SVG_NS, "path");
        part.setAttribute("class", piece.ring ? "rail-ring" : "rail-line");
        part.setAttribute("pathLength", "1");
        part.style.setProperty("--d", `${order * 45}ms`);
        base.append(part);
        return part;
      });
    }
    drawn.forEach((piece, order) => {
      const part = baseParts[order];
      part.setAttribute("d", piece.path);
      if (!piece.ring) return;
      if (piece.turn) part.setAttribute("transform", `rotate(${piece.turn} ${fmt(piece.cx)} ${fmt(piece.cy)})`);
      else part.removeAttribute("transform");
      nodes[piece.index].ringEl = part;
      part.classList.toggle("is-active", piece.index === activeIndex);
    });
  }

  function sizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lightCanvas.width = Math.max(1, Math.round(geo.width * dpr));
    lightCanvas.height = Math.max(1, Math.round(geo.height * dpr));
    bloomCanvas.width = Math.max(1, Math.round(geo.width * BLOOM_SCALE));
    bloomCanvas.height = Math.max(1, Math.round(geo.height * BLOOM_SCALE));
    light.setTransform(dpr, 0, 0, dpr, 0, 0);
    bloom.setTransform(BLOOM_SCALE, 0, 0, BLOOM_SCALE, 0, 0);
    light.lineJoin = bloom.lineJoin = "round";
  }

  function locate(s) {
    let index = geo.pieces.findIndex((piece) => s <= piece.start + piece.length);
    if (index < 0) index = geo.pieces.length - 1;
    const piece = geo.pieces[index];
    return { index, f: piece.length ? (s - piece.start) / piece.length : 0 };
  }

  function relayout() {
    const layout = measure();
    if (!layout.width || !layout.height) return;
    // Keep the light at the same point of the same piece; across a layout switch it restarts.
    const anchor = geo && comet.alive && geo.across === layout.across ? locate(comet.s) : null;
    if (geo && !anchor) comet.alive = false;
    readTheme();
    place(layout.spots);
    geo = build(layout);
    sizeCanvases();
    paintBase();
    trail.count = 0;
    cometRing = -1;
    idle = false;
    if (anchor) {
      const piece = geo.pieces[anchor.index];
      comet.s = piece.start + anchor.f * piece.length;
    }
    if (!running) still();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      relayout();
    });
  }

  // ── Motion ──

  function sample(s) {
    const k = Math.min(geo.xs.length - 2, Math.max(0, Math.floor(s)));
    const f = Math.min(1, Math.max(0, s - k));
    probe.x = geo.xs[k] + (geo.xs[k + 1] - geo.xs[k]) * f;
    probe.y = geo.ys[k] + (geo.ys[k + 1] - geo.ys[k]) * f;
    probe.vis = geo.vis[k] + (geo.vis[k + 1] - geo.vis[k]) * f;
  }

  function ringAt(s) {
    for (const ring of geo.rings) {
      if (s < ring.a) return -1;
      if (s <= ring.b) return ring.index;
    }
    return -1;
  }

  // Distance to an icon when every icon on the way is passed with a half lap.
  function expressGap(s, index) {
    const goal = geo.rings[index];
    let gap = 0;
    if (s < goal.a) {
      gap = goal.a - s;
      for (let k = 0; k < index; k += 1) if (s < geo.rings[k].a + geo.rings[k].P / 2) gap -= geo.rings[k].P;
    } else if (s > goal.b) {
      gap = s - goal.b;
      for (let k = index + 1; k < geo.rings.length; k += 1) if (s > geo.rings[k].a + geo.rings[k].P) gap -= geo.rings[k].P;
    }
    return Math.max(0, gap);
  }

  function nearestEnd(index) {
    return expressGap(0, index) <= expressGap(geo.length, index) ? 0 : geo.length;
  }

  function pushTrail(t) {
    trail.x[trail.head] = probe.x;
    trail.y[trail.head] = probe.y;
    trail.vis[trail.head] = probe.vis;
    trail.t[trail.head] = t;
    trail.head = (trail.head + 1) % TRAIL_CAP;
    trail.count = Math.min(trail.count + 1, TRAIL_CAP);
  }

  function pruneTrail(now) {
    while (trail.count > 0 && now - trail.t[(trail.head - trail.count + TRAIL_CAP) % TRAIL_CAP] > TRAIL_MS) {
      trail.count -= 1;
    }
  }

  function emit(from, to, t0, t1) {
    const delta = to - from;
    const steps = Math.ceil(Math.abs(delta) / 2);
    for (let i = 1; i <= steps; i += 1) {
      sample(from + (delta * i) / steps);
      pushTrail(t0 + ((t1 - t0) * i) / steps);
    }
  }

  function launch(s, now) {
    comet.alive = true;
    comet.s = s;
    comet.v = s > 0 ? -SPEED_LINK : SPEED_LINK;
    comet.orbit = 0;
    trail.count = 0;
    sample(s);
    pushTrail(now);
  }

  // On the way to a held icon, pass the other icons with a half lap instead of 1.5.
  function shortcut(target) {
    const index = ringAt(comet.s);
    if (index < 0 || index === target) return;
    const ring = geo.rings[index];
    if (comet.v > 0 && target > index && comet.s < ring.a + ring.P / 2) comet.s += ring.P;
    else if (comet.v < 0 && target < index && comet.s > ring.a + ring.P) comet.s -= ring.P;
  }

  // Remember which part of a ring the light has traced so that stretch stays lit.
  function cover(delta) {
    const index = ringAt(comet.s);
    if (index !== cometRing) {
      cometRing = index;
      const glow = index >= 0 ? nodes[index].glow : null;
      if (glow && !glow.full) {
        glow.u0 = mod(comet.s - geo.rings[index].a, geo.rings[index].P);
        glow.w = glow.lo = glow.hi = 0;
      }
      return;
    }
    if (index < 0) return;
    const glow = nodes[index].glow;
    glow.w += delta;
    glow.lo = Math.min(glow.lo, glow.w);
    glow.hi = Math.max(glow.hi, glow.w);
    if (glow.hi - glow.lo >= geo.rings[index].P) glow.full = true;
  }

  function travel(now, dt, target) {
    const goal = target === null ? null : geo.rings[target];
    let want;
    let lag;
    if (!goal) {
      comet.orbit = 0;
      want = ringAt(comet.s) >= 0 ? SPEED_RING : SPEED_LINK;
      lag = 0.09;
    } else if (comet.s >= goal.a && comet.s <= goal.b) {
      if (!comet.orbit) comet.orbit = comet.v < 0 ? -1 : 1;
      comet.s = goal.a + goal.P / 4 + mod(comet.s - goal.a - goal.P / 4, goal.P);
      want = comet.orbit * SPEED_ORBIT;
      lag = 0.3;
    } else {
      comet.orbit = 0;
      want = Math.sign(goal.a - comet.s) * Math.min(SPEED_SEEK, Math.max(SPEED_RING, expressGap(comet.s, target) * 7));
      lag = 0.07;
    }
    comet.v += (want - comet.v) * (1 - Math.exp(-dt / lag));
    const from = comet.s;
    const step = Math.max(-geo.maxStep, Math.min(geo.maxStep, comet.v * dt));
    const to = Math.max(0, Math.min(geo.length, from + step));
    emit(from, to, now - dt * 1000, now);
    comet.s = to;
    if (goal) shortcut(target);
    cover(to - from);
    if (!goal && comet.s >= geo.length) {
      comet.alive = false;
      comet.restUntil = now + REST_MS;
    }
  }

  function flare(index, now) {
    const glow = nodes[index].glow;
    glow.burstAt = now;
    glow.flaredAt = now;
    glow.full = true;
    glow.energy = Math.max(glow.energy, 0.85);
  }

  function setLit(node, lit) {
    if (node.glow.lit === lit) return;
    node.glow.lit = lit;
    node.item.classList.toggle("is-lit", lit);
  }

  function settleGlow(node, index, now, dt, target) {
    const glow = node.glow;
    const inside = index === cometRing;
    const goal = inside ? (target === null || target === index ? 1 : 0.4) : 0;
    glow.energy += (goal - glow.energy) * (1 - Math.exp(-dt / (goal > glow.energy ? 0.07 : 0.4)));
    if (glow.burstAt && now - glow.burstAt > BURST_MS) glow.burstAt = 0;
    if (!inside && glow.energy < 0.015 && !glow.burstAt) {
      glow.energy = 0;
      glow.full = false;
    }
    setLit(node, glow.energy > (glow.lit ? 0.22 : 0.45));
  }

  function update(now, dt) {
    if (visit && now > visit.until) {
      visit = null;
      pendingFlare = null;
    }
    const target = hoverIndex ?? visit?.index ?? null;
    if (!comet.alive && now >= holdUntil) {
      if (target !== null) launch(nearestEnd(target), now);
      else if (now >= comet.restUntil) launch(0, now);
    }
    if (comet.alive) travel(now, dt, target);
    else cometRing = -1;
    if (pendingFlare !== null && pendingFlare === cometRing) {
      flare(pendingFlare, now);
      pendingFlare = null;
    }
    pruneTrail(now);
    nodes.forEach((node, index) => settleGlow(node, index, now, dt, target));
  }

  // ── Drawing ──

  // Clear in device pixels: a scaled clearRect can leave the canvas's last, partly covered row behind.
  function wipe(ctx) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function roundedRect(ctx, cx, cy, half, radius) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - half);
    ctx.arcTo(cx + half, cy - half, cx + half, cy + half, radius);
    ctx.arcTo(cx + half, cy + half, cx - half, cy + half, radius);
    ctx.arcTo(cx - half, cy + half, cx - half, cy - half, radius);
    ctx.arcTo(cx - half, cy - half, cx + half, cy - half, radius);
    ctx.closePath();
  }

  function traceGlow(ctx, ring, glow) {
    if (glow.full) {
      roundedRect(ctx, ring.cx, ring.cy, ring.half, ring.radius);
      return;
    }
    ctx.beginPath();
    const span = Math.min(ring.P, glow.hi - glow.lo);
    if (span < 1) return;
    const start = Math.floor(mod(glow.u0 + glow.lo, ring.P));
    const end = Math.min(ring.loopX.length - 1, start + Math.ceil(span));
    ctx.moveTo(ring.loopX[start], ring.loopY[start]);
    for (let i = start + 1; i <= end; i += 1) ctx.lineTo(ring.loopX[i], ring.loopY[i]);
  }

  function drawGlow(glow, ring, now, angle) {
    if (glow.energy > 0.004) {
      const alpha = Math.min(1, glow.energy);
      light.lineCap = bloom.lineCap = "round";
      traceGlow(light, ring, glow);
      light.globalAlpha = alpha;
      light.lineWidth = 1.8;
      light.strokeStyle = sweep(light, ring.cx, ring.cy, angle);
      light.stroke();
      traceGlow(bloom, ring, glow);
      bloom.globalAlpha = alpha * (0.82 + 0.18 * Math.sin(now / 420 + angle));
      bloom.lineWidth = 7;
      bloom.strokeStyle = sweep(bloom, ring.cx, ring.cy, angle);
      bloom.stroke();
    }
    if (glow.burstAt) {
      const k = Math.min(1, (now - glow.burstAt) / BURST_MS);
      const grow = 14 * (1 - (1 - k) ** 3);
      [[light, 1.6], [bloom, 6]].forEach(([ctx, width]) => {
        roundedRect(ctx, ring.cx, ring.cy, ring.half + grow, ring.radius + grow);
        ctx.globalAlpha = (1 - k) ** 1.6;
        ctx.lineWidth = width * (1 - k * 0.5);
        ctx.strokeStyle = sweep(ctx, ring.cx, ring.cy, angle + k * 2);
        ctx.stroke();
      });
    }
  }

  function drawTrail(now) {
    let segments = 0;
    let dist = 0;
    let newer = (trail.head - 1 + TRAIL_CAP) % TRAIL_CAP;
    while (segments < trail.count - 1) {
      const older = (newer - 1 + TRAIL_CAP) % TRAIL_CAP;
      dist += Math.hypot(trail.x[newer] - trail.x[older], trail.y[newer] - trail.y[older]);
      if (dist > TRAIL_LEN) break;
      trail.reach[segments] = dist;
      segments += 1;
      newer = older;
    }
    light.lineCap = "butt";
    bloom.lineCap = "round";
    // Oldest first, so the bright head is painted last.
    for (let j = segments - 1; j >= 0; j -= 1) {
      const a = (trail.head - 1 - j + 2 * TRAIL_CAP) % TRAIL_CAP;
      const b = (a - 1 + TRAIL_CAP) % TRAIL_CAP;
      const fade = Math.min(1 - (now - trail.t[b]) / TRAIL_MS, 1 - trail.reach[j] / TRAIL_LEN);
      if (fade <= 0) continue;
      const vis = (trail.vis[a] + trail.vis[b]) / 2;
      const color = trailAt(trail.reach[j] / TRAIL_LEN);
      light.globalAlpha = fade ** 1.3 * vis;
      light.lineWidth = 0.5 + 2.3 * fade;
      light.strokeStyle = color;
      light.beginPath();
      light.moveTo(trail.x[b], trail.y[b]);
      light.lineTo(trail.x[a], trail.y[a]);
      light.stroke();
      bloom.globalAlpha = fade * 0.8 * vis;
      bloom.lineWidth = 2 + 8 * fade;
      bloom.strokeStyle = color;
      bloom.beginPath();
      bloom.moveTo(trail.x[b], trail.y[b]);
      bloom.lineTo(trail.x[a], trail.y[a]);
      bloom.stroke();
    }
    if (comet.alive) drawHead();
  }

  function drawHead() {
    sample(comet.s);
    const color = trailAt(0);
    bloom.globalAlpha = probe.vis;
    bloom.fillStyle = color;
    bloom.beginPath();
    bloom.arc(probe.x, probe.y, 7, 0, Math.PI * 2);
    bloom.fill();
    light.globalAlpha = probe.vis;
    light.fillStyle = color;
    light.beginPath();
    light.arc(probe.x, probe.y, 2.6, 0, Math.PI * 2);
    light.fill();
    light.fillStyle = theme.core;
    light.beginPath();
    light.arc(probe.x, probe.y, 1.3, 0, Math.PI * 2);
    light.fill();
  }

  function render(now) {
    if (!geo) return;
    const busy = comet.alive || trail.count > 1 || nodes.some(({ glow }) => glow.energy > 0 || glow.burstAt);
    if (!busy && idle) return;
    idle = !busy;
    wipe(light);
    wipe(bloom);
    if (!busy) return;
    const spin = now * 0.0024;
    nodes.forEach(({ glow }, index) => drawGlow(glow, geo.rings[index], now, spin + index * 0.9));
    drawTrail(now);
  }

  // Reduced motion: no travelling light, just a still ring on the hovered icon.
  function still() {
    if (!geo) return;
    comet.alive = false;
    trail.count = 0;
    nodes.forEach((node, index) => {
      const on = index === hoverIndex;
      Object.assign(node.glow, { energy: on ? 1 : 0, full: on, burstAt: 0 });
      setLit(node, on);
    });
    idle = false;
    render(0);
  }

  // ── Loop and events ──

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(0.034, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    if (!geo) return;
    update(now, dt);
    render(now);
  }

  function play() {
    if (running) return;
    running = true;
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
  }

  function hold(index) {
    hoverIndex = index;
    if (!running) still();
  }

  function release(index) {
    if (hoverIndex !== index) return;
    hoverIndex = null;
    if (!running) still();
  }

  function focusOn(index) {
    if (!running || index < 0) return;
    const now = performance.now();
    visit = { index, until: Math.max(now, holdUntil) + VISIT_MS };
    if (now - nodes[index].glow.flaredAt > 500) pendingFlare = index;
  }

  function setActive(name) {
    const index = nodes.findIndex(({ item }) => item.dataset.view === name);
    if (index === activeIndex) return;
    activeIndex = index;
    nodes.forEach((node, i) => node.ringEl?.classList.toggle("is-active", i === index));
    focusOn(index);
  }

  nodes.forEach(({ item }, index) => {
    item.addEventListener("pointerenter", () => hold(index));
    item.addEventListener("pointerleave", () => release(index));
    item.addEventListener("focus", () => {
      if (item.matches(":focus-visible")) hold(index);
    });
    item.addEventListener("blur", () => release(index));
    item.addEventListener("click", () => focusOn(index));
  });

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      stop();
      still();
      return;
    }
    nodes.forEach((node) => Object.assign(node.glow, { energy: 0, full: false }));
    comet.restUntil = 0;
    play();
  });

  const calm = reducedMotion.matches;
  rail.classList.toggle("is-intro", !calm);
  relayout();
  requestAnimationFrame(() => requestAnimationFrame(() => rail.classList.add("is-drawn")));
  new ResizeObserver(schedule).observe(fx);
  window.addEventListener("resize", schedule);
  document.fonts?.ready.then(schedule);
  if (!calm) {
    holdUntil = performance.now() + INTRO_MS;
    comet.restUntil = holdUntil;
    play();
    window.setTimeout(() => rail.classList.remove("is-intro"), 1600);
  }

  return { setActive };
})();

const form = document.querySelector(".search");
const input = document.querySelector("#q");
const view = document.getElementById("view");
const hero = document.querySelector(".hero");
const stage = document.querySelector("main");
const API = location.port === "8000" ? "" : "http://127.0.0.1:8000";
const pages = ["home", "services", "clients", "projects", "industries", "solutions", "about", "contact", "connections", "health", "profile", "search"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function token() {
  return sessionStorage.getItem("agara_token") || "";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (options.json) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${API}${path}`, { method: options.method || "GET", headers, body: options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item.msg).join(" ") : "Request failed";
    throw new Error(message || "Request failed");
  }
  return data;
}

function page(kicker, title, copy, body) {
  view.innerHTML = `<header class="page-head"><div class="page-intro"><p class="page-kicker">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p class="page-copy">${escapeHtml(copy)}</p></div><form class="entry page-search" id="page-search"><input name="q" type="search" placeholder="Search the knowledge base" value="${escapeHtml(sessionStorage.getItem("agara_query") || "")}" /></form></header>${body}`;
  document.getElementById("page-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") || "").trim();
    if (!query) return;
    sessionStorage.setItem("agara_query", query);
    input.value = query;
    go("search");
  });
}

function records(itemsHtml) {
  return `<div class="record-grid">${itemsHtml}</div>`;
}

function record(title, body, meta) {
  return `<article class="card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""}</article>`;
}

function show(name) {
  if (name === "settings") name = "profile";
  const pageName = pages.includes(name) ? name : "home";
  hero.hidden = pageName !== "home";
  view.hidden = pageName === "home";
  stage.classList.toggle("is-page", pageName !== "home");
  items.forEach((item) => item.classList.toggle("is-active", item.dataset.view === pageName));
  railLight.setActive(pageName);
  if (pageName !== "home") render(pageName);
}

async function render(name) {
  view.innerHTML = `<p class="page-copy">Loading…</p>`;
  try {
    if (name === "services") return renderServices();
    if (name === "clients") return renderClients();
    if (name === "projects") return renderProjects();
    if (name === "industries") return renderIndustries();
    if (name === "solutions") return renderSolutions();
    if (name === "about") return renderAbout();
    if (name === "contact") return renderContact();
    if (name === "connections") return renderConnections();
    if (name === "health") return renderHealth();
    if (name === "profile") return renderProfile();
    if (name === "search") return renderSearch();
  } catch (error) {
    view.innerHTML = `<p class="notice">${escapeHtml(error.message)}. Start the knowledge service on port 8000 and try again.</p>`;
  }
}

async function renderServices() {
  const rows = await api("/api/services");
  page(
    "Capabilities",
    "Services",
    "These are services the company can provide. They are not a record of completed work.",
    records(rows.map((row) => record(row.name, row.description, row.category)).join(""))
  );
}

async function renderClients() {
  const rows = await api("/api/clients");
  const list = rows.length
    ? records(rows.map((row) => record(row.name, row.relationship || row.services || "Verified client", [row.industry, row.country].filter(Boolean).join(" · "))).join(""))
    : `<p class="notice">No verified clients are on record yet.</p>`;
  page("Verified relationships", "Clients", "Only companies stored in the knowledge base appear here.", list + clientForm());
  bindClientForm();
}

function clientForm() {
  if (!token()) return "";
  return `<form class="entry" id="client-form">
    <input name="name" placeholder="Company name" required />
    <input name="industry" placeholder="Industry" />
    <input name="country" placeholder="Country" />
    <textarea name="relationship" placeholder="Verified relationship" required></textarea>
    <button type="submit">Add client</button>
  </form>`;
}

function bindClientForm() {
  const formEl = document.getElementById("client-form");
  if (!formEl) return;
  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    await api("/api/clients", { method: "POST", json: data });
    renderClients();
  });
}

async function renderProjects() {
  const rows = await api("/api/projects");
  const list = rows.length
    ? records(rows.map((row) => record(row.name, row.description || "Verified project", [row.client, row.location, row.status].filter(Boolean).join(" · "))).join(""))
    : `<p class="notice">No verified projects are on record yet.</p>`;
  page("Verified work", "Projects", "A project appears here only after it is recorded. Recommendations are not listed as projects.", list + projectForm());
  bindProjectForm();
}

function projectForm() {
  if (!token()) return "";
  return `<form class="entry" id="project-form">
    <input name="name" placeholder="Project name" required />
    <input name="client_name" placeholder="Client" />
    <input name="industry" placeholder="Industry" />
    <input name="location" placeholder="Location" />
    <select name="status">
      <option>Opportunity</option><option>In Discussion</option><option>Active</option><option>Completed</option><option>On Hold</option><option>Confidential</option>
    </select>
    <textarea name="description" placeholder="What was actually done" required></textarea>
    <button type="submit">Add project</button>
  </form>`;
}

function bindProjectForm() {
  const formEl = document.getElementById("project-form");
  if (!formEl) return;
  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    if (data.status === "Confidential") data.confidential = true;
    await api("/api/projects", { method: "POST", json: data });
    renderProjects();
  });
}

async function renderIndustries() {
  const rows = await api("/api/industries");
  page("Sectors", "Industries", "Industries describe where the company can work. Each card is a sector overview, not a record of completed work.", records(rows.map((row) => record(row.name, row.overview)).join("")));
}

async function renderSolutions() {
  const rows = await api("/api/solutions");
  page(
    "Recommendations",
    "Solutions",
    "A solution combines services for a problem. It is not proof that the work has already been done.",
    records(rows.map((row) => record(row.name, row.summary, row.services)).join(""))
  );
}

function renderAbout() {
  page(
    "Company",
    "About us",
    "Stratgon Agara Global helps clients navigate complexity while keeping the path to a decision clear.",
    `<div class="record-grid">
      ${record("What we do", "Services describe current capabilities: government relations, project development, infrastructure, energy, ESG, and market entry.")}
      ${record("What we have done", "Projects and clients appear only when a verified record exists in the knowledge base.")}
      ${record("What we can propose", "Solutions combine services for a new request. They are labeled as recommendations.")}
    </div>`
  );
}

function renderContact() {
  page(
    "Talk to the team",
    "Contact",
    "Send a requirement. It is stored in the company audit log.",
    `<form class="entry" id="contact-form">
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <textarea name="message" placeholder="What do you need help with?" required></textarea>
      <button type="submit">Send</button>
      <p class="notice" id="contact-note"></p>
    </form>`
  );
  document.getElementById("contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.getElementById("contact-note");
    try {
      await api("/api/contact", { method: "POST", json: Object.fromEntries(new FormData(event.currentTarget)) });
      note.textContent = "Message received.";
      event.currentTarget.reset();
    } catch (error) {
      note.textContent = error.message;
    }
  });
}

async function renderConnections() {
  const rows = await api("/api/integrations");
  const drive = rows[0];
  const signedIn = Boolean(token());
  page(
    "Data sources",
    "Connections",
    "A source is connected only after authentication succeeds. Google Drive stays disconnected until OAuth credentials are configured.",
    `<article class="card"><h2>${escapeHtml(drive.name)}</h2><p>${escapeHtml(drive.detail || "No documents have been synced.")}</p><span class="meta">${escapeHtml(drive.status)} · ${drive.record_count || 0} records</span>${drive.error ? `<p class="notice">${escapeHtml(drive.error)}</p>` : ""}</article>
    <form class="entry" id="drive-form">
      <button type="submit">Connect Google Drive</button>
      ${signedIn && drive.status === "connected" ? `<button type="button" id="drive-sync">Sync now</button>` : ""}
      <p class="notice" id="drive-note"></p>
    </form>
    ${signedIn ? `<form class="entry" id="upload-form"><input type="file" name="file" accept=".txt,.csv,.md" required /><button type="submit">Upload a text document</button><p class="notice" id="upload-note"></p></form>` : ""}`
  );
  document.getElementById("drive-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!token()) {
      document.getElementById("drive-note").textContent = "Google Drive connection will be available with the login page.";
      return;
    }
    const note = document.getElementById("drive-note");
    try {
      const result = await api("/api/integrations/google-drive/connect", { method: "POST" });
      note.textContent = result.message || result.authorization_url || `Status: ${result.status}`;
      refreshDrive();
    } catch (error) {
      note.textContent = error.message;
    }
  });
  document.getElementById("drive-sync")?.addEventListener("click", async () => {
    const note = document.getElementById("drive-note");
    try {
      const result = await api("/api/integrations/google-drive/sync", { method: "POST" });
      note.textContent = `Sync status: ${result.status || "done"}`;
      refreshDrive();
      renderConnections();
    } catch (error) {
      note.textContent = error.message;
    }
  });
  document.getElementById("upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.getElementById("upload-note");
    const body = new FormData(event.currentTarget);
    const headers = token() ? { Authorization: `Bearer ${token()}` } : {};
    const response = await fetch(`${API}/api/documents`, { method: "POST", headers, body });
    const data = await response.json().catch(() => ({}));
    note.textContent = response.ok ? `Indexed in ${data.chunks} sections.` : data.detail || "Upload failed";
  });
}

async function renderHealth() {
  const data = await api("/api/health");
  page(
    "System",
    "System health",
    "Live status from the knowledge service.",
    data.components.map((item) => `<div class="health-row"><span>${escapeHtml(item.name)}</span><span>${escapeHtml(item.status)}</span></div>`).join("")
  );
}

function photoUrl() {
  return localStorage.getItem("agara_photo") || "";
}

function applyUserPhoto() {
  const url = photoUrl();
  const button = document.querySelector(".user-btn");
  const image = button?.querySelector(".user-photo");
  if (!button || !image) return;
  image.src = url;
  button.classList.toggle("has-photo", Boolean(url));
}

function storePhoto(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const source = new Image();
    source.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const scale = Math.max(size / source.width, size / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      canvas.getContext("2d").drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
      localStorage.setItem("agara_photo", canvas.toDataURL("image/jpeg", 0.86));
      applyUserPhoto();
      renderProfile();
    };
    source.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderProfile() {
  const url = photoUrl();
  page(
    "Profile",
    "Your profile",
    "Add a photo now. It replaces the icon on the profile button.",
    `<div class="profile-card">
      <div class="profile-photo${url ? " has-photo" : ""}" id="profile-photo">
        <img alt="" src="${escapeHtml(url)}" />
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.1"/><path d="M5.2 19.2c1.1-3 3.4-4.5 6.8-4.5s5.7 1.5 6.8 4.5"/></svg>
      </div>
      <div>
        <div class="profile-actions">
          <button type="button" class="text-btn" id="profile-pick">${url ? "Change photo" : "Add photo"}</button>
          ${url ? `<button type="button" class="text-btn" id="profile-remove">Remove</button>` : ""}
        </div>
        <input id="profile-file" type="file" accept="image/*" hidden />
      </div>
    </div>`
  );
  const file = document.getElementById("profile-file");
  document.getElementById("profile-pick").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    if (chosen) storePhoto(chosen);
  });
  document.getElementById("profile-remove")?.addEventListener("click", () => {
    localStorage.removeItem("agara_photo");
    applyUserPhoto();
    renderProfile();
  });
}

async function renderSearch() {
  const query = sessionStorage.getItem("agara_query") || "";
  if (!query) {
    page("Search result", "Search", "Enter a request in the search field.", "");
    return;
  }
  const data = await api("/api/search", { method: "POST", json: { query } });
  const blocks = [
    ...data.verified.services.map((item) => record(item.name, item.description, "Capability")),
    ...data.verified.industries.map((item) => record(item.name, item.overview, "Industry")),
    ...data.verified.projects.map((item) => record(item.name, item.description, `Verified project · ${item.status}`)),
    ...data.verified.clients.map((item) => record(item.name, item.relationship || item.description, "Verified client")),
    ...data.recommendations.solutions.map((item) => record(item.name, item.summary, "Recommendation")),
  ].join("");
  const sources = data.sources.map((item) => `${item.integration} → ${item.document}`).join(" · ");
  page(
    "Search result",
    query,
    data.answer,
    `${records(blocks || record("No direct match", data.gaps[0] || "Nothing matched.", ""))}<p class="notice">${escapeHtml(data.gaps.join(" "))}</p><p class="notice">Sources: ${escapeHtml(sources || "None")}</p><button type="button" class="text-btn" id="brief-btn">Prepare meeting brief</button><div id="brief"></div>`
  );
  document.getElementById("brief-btn").addEventListener("click", async () => {
    const brief = document.getElementById("brief");
    brief.innerHTML = `<p class="notice">Preparing…</p>`;
    try {
      const result = await api("/api/briefs", { method: "POST", json: { query } });
      brief.innerHTML = `<div class="record-grid">
        ${record("Capabilities", result.capabilities.join(", ") || "None on record", "What the company can do")}
        ${record("Verified projects", result.projects.join(", ") || "None on record", "What has been done")}
        ${record("Verified clients", result.clients.join(", ") || "None on record", "Who is on record")}
        ${record("Possible solution", result.potential_solution.join(", ") || "None suggested", "Not a past engagement")}
      </div><p class="notice">Questions: ${escapeHtml(result.questions.join(" "))}</p><p class="notice">Next steps: ${escapeHtml(result.next_steps.join(" "))}</p>`;
    } catch (error) {
      brief.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
    }
  });
}

function go(name) {
  if (location.hash !== `#${name}`) location.hash = name;
  else show(name);
}

items.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    go(item.dataset.view);
  });
});

document.querySelectorAll(".card[href^='#']").forEach((card) => {
  card.addEventListener("click", (event) => {
    event.preventDefault();
    go(card.getAttribute("href").slice(1));
  });
});

document.querySelector(".drive-chip")?.addEventListener("click", () => go("connections"));
document.getElementById("system-status")?.addEventListener("click", () => go("health"));
document.querySelectorAll(".status-icon").forEach((button) => {
  button.addEventListener("click", () => go(button.dataset.go));
});
document.querySelector(".user-btn")?.addEventListener("click", () => go("profile"));

const gear = document.querySelector(".gear-btn");
const settingsPop = document.getElementById("settings-pop");

function setPop(open) {
  settingsPop.hidden = !open;
  gear.classList.toggle("is-open", open);
  gear.setAttribute("aria-expanded", open ? "true" : "false");
}

gear?.addEventListener("click", (event) => {
  event.stopPropagation();
  setPop(settingsPop.hidden);
});

document.addEventListener("click", (event) => {
  if (!settingsPop || settingsPop.hidden) return;
  if (settingsPop.contains(event.target) || gear.contains(event.target)) return;
  setPop(false);
});

settingsPop?.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    setPop(false);
    go(button.dataset.go);
  });
});
document.querySelector(".brand")?.addEventListener("click", (event) => {
  event.preventDefault();
  go("home");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  sessionStorage.setItem("agara_query", query);
  go("search");
});

window.addEventListener("hashchange", () => show((location.hash || "#home").slice(1)));
show((location.hash || "#home").slice(1));

// The chip's data-state picks its colours in CSS.
async function refreshDrive() {
  const chip = document.querySelector(".drive-chip");
  const label = document.querySelector(".drive-state-label");
  if (!chip || !label) return;
  const labels = { connected: "Connected", syncing: "Syncing", connecting: "Connecting", error: "Error", not_connected: "Not connected" };
  let state = "not_connected";
  try {
    const [drive] = await api("/api/integrations");
    if (labels[drive.status]) state = drive.status;
  } catch {
    state = "not_connected";
  }
  chip.dataset.state = state;
  label.textContent = labels[state];
  chip.setAttribute("aria-label", `Google Drive, ${labels[state]}`);
}

function markIcon(id, state, label) {
  const icon = document.getElementById(id);
  if (!icon) return;
  icon.classList.remove("is-ok", "is-warn", "is-bad");
  icon.classList.add(state);
  icon.title = label;
  icon.setAttribute("aria-label", label);
}

async function refreshHealth() {
  const label = document.getElementById("status-label");
  const status = document.getElementById("system-status");
  if (!label || !status) return;
  try {
    const data = await api("/api/health");
    const status = Object.fromEntries(data.components.map((item) => [item.name, item.status]));
    const database = status.Database || "error";
    const drive = status["Google Drive"] || "not_connected";
    markIcon("status-network", "is-ok", "Network is reachable");
    markIcon("status-database", database === "operational" ? "is-ok" : "is-bad", `Database is ${database}`);
    markIcon(
      "status-cloud",
      drive === "connected" ? "is-ok" : drive === "error" ? "is-bad" : "is-warn",
      drive === "connected" ? "Google Drive is connected" : drive === "error" ? "Google Drive has an error" : "Google Drive is not connected"
    );
    const failed = data.components.some((item) => item.status === "error") || database !== "operational";
    label.textContent = failed ? "A system needs attention" : drive === "connected" ? "All systems operational" : "Core systems operational";
    status.dataset.state = failed ? "attention" : "ok";
  } catch {
    markIcon("status-network", "is-bad", "Network is offline");
    markIcon("status-database", "is-bad", "Database is unreachable");
    markIcon("status-cloud", "is-bad", "Google Drive status is unknown");
    label.textContent = "Knowledge service offline";
    status.dataset.state = "offline";
  }
}

refreshHealth();
refreshDrive();
applyUserPhoto();
