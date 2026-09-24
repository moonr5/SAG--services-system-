const items = document.querySelectorAll(".rail-item");
const railPath = document.getElementById("rail-edge");
const railGlow = document.getElementById("rail-glow");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let bases = [];
let amplitude = 48;
let breathing = false;

function curveX(y, amp) {
  const t = Math.min(1, Math.max(0, y / 1000));
  return 58 + amp * Math.sin(Math.PI * t);
}

function buildPath(amp) {
  const steps = 56;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const y = 16 + (i / steps) * 968;
    const x = curveX(y, amp);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  railPath.setAttribute("d", d);
  railGlow.setAttribute("d", d);
}

function captureBases() {
  items.forEach((item) => {
    item.style.transform = "none";
  });
  const shape = document.querySelector(".sider-shape").getBoundingClientRect();
  bases = [...items].map((item) => {
    const icon = item.querySelector(".rail-icon").getBoundingClientRect();
    return {
      item,
      cx: icon.left + icon.width / 2,
      y: ((icon.top + icon.height / 2 - shape.top) / shape.height) * 1000,
    };
  });
}

function applyPositions(amp) {
  const shape = document.querySelector(".sider-shape").getBoundingClientRect();
  bases.forEach(({ item, cx, y }) => {
    const edge = shape.left + (curveX(y, amp) / 200) * shape.width;
    item.style.transform = `translateX(${edge - cx}px)`;
  });
}

function frame(now) {
  if (!breathing) return;
  amplitude = 48 + Math.sin(now / 2400) * 5;
  buildPath(amplitude);
  applyPositions(amplitude);
  requestAnimationFrame(frame);
}

buildPath(amplitude);
captureBases();

if (reduceMotion) {
  applyPositions(amplitude);
} else {
  items.forEach((item, index) => {
    item.style.transitionDelay = `${0.08 + index * 0.07}s`;
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => applyPositions(amplitude));
  });
  window.setTimeout(() => {
    items.forEach((item) => {
      item.style.transition = "none";
    });
    breathing = true;
    requestAnimationFrame(frame);
  }, 1700);
}

window.addEventListener("resize", () => {
  const wasBreathing = breathing;
  breathing = false;
  items.forEach((item) => {
    item.style.transition = "none";
  });
  captureBases();
  applyPositions(amplitude);
  if (wasBreathing && !reduceMotion) {
    breathing = true;
    requestAnimationFrame(frame);
  }
});

items.forEach((item) => {
  item.addEventListener("click", () => {
    items.forEach((other) => other.classList.remove("is-active"));
    item.classList.add("is-active");
  });
});

const form = document.querySelector(".search");
const input = document.querySelector("#q");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim().toLowerCase();
  document.querySelectorAll(".card").forEach((card) => {
    const text = card.textContent.toLowerCase();
    const match = !query || text.includes(query);
    card.hidden = !match;
  });
});

input.addEventListener("input", () => {
  if (!input.value.trim()) {
    document.querySelectorAll(".card").forEach((card) => {
      card.hidden = false;
    });
  }
});
