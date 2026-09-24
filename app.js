const items = document.querySelectorAll(".rail-item");

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
