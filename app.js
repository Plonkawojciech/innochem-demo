// INNOCHEM demo — wspólny katalog produktów + koszyk (localStorage) + reveal
const PRODUCTS = [
  { id: "hps-5w30", name: "Royal Purple HPS", visc: "5W-30", vol: "0,946 l", price: 78, img: "img/rp-motor-oil-hps-5w30.jpg", tag: "HIGH PERFORMANCE STREET" },
  { id: "0w40", name: "Royal Purple Motor Oil", visc: "0W-40", vol: "0,946 l", price: 80, img: "img/royal-purple-motor-oil-0w40.jpg", tag: "API SN" },
  { id: "5w30", name: "Royal Purple Motor Oil", visc: "5W-30", vol: "0,946 l", price: 74, img: "img/rp-motor-oil-5w30.jpg", tag: "API SN" },
  { id: "0w20", name: "Royal Purple Motor Oil", visc: "0W-20", vol: "0,946 l", price: 74, img: "img/royal-purple-motor-oil-0w20.jpg", tag: "API SN" },
  { id: "5w20", name: "Royal Purple Motor Oil", visc: "5W-20", vol: "0,946 l", price: 74, img: "img/rp-motor-oil-5w20.jpg", tag: "API SN" },
  { id: "hps-5w20", name: "Royal Purple HPS", visc: "5W-20", vol: "0,946 l", price: 78, img: "img/rp-motor-oil-hps-5w20.jpg", tag: "HIGH PERFORMANCE STREET" },
];

const zl = n => n.toFixed(2).replace(".", ",") + " zł";

function getCart() { try { return JSON.parse(localStorage.getItem("innochem-cart")) || {}; } catch { return {}; } }
function setCart(c) { localStorage.setItem("innochem-cart", JSON.stringify(c)); renderCount(); }
function addToCart(id, qty = 1) {
  const c = getCart(); c[id] = (c[id] || 0) + qty; setCart(c);
  const el = document.getElementById("cartCount");
  if (el) { el.animate([{ transform: "scale(1.5)" }, { transform: "scale(1)" }], { duration: 220 }); }
}
function renderCount() {
  const el = document.getElementById("cartCount");
  if (el) el.textContent = Object.values(getCart()).reduce((a, b) => a + b, 0);
}

// product grid (homepage)
const grid = document.getElementById("prodGrid");
if (grid) {
  grid.innerHTML = PRODUCTS.map(p => `
    <article class="card">
      <a class="ph" href="produkt.html?id=${p.id}"><img src="${p.img}" alt="${p.name} ${p.visc}" loading="lazy"></a>
      <div class="body">
        <div class="visc">${p.visc}<small>${p.tag}</small></div>
        <a class="name" href="produkt.html?id=${p.id}">${p.name} · ${p.vol}</a>
        <div class="price-row">
          <div class="price">${zl(p.price)}<small>brutto / szt.</small></div>
          <button class="add" data-id="${p.id}">Do koszyka</button>
        </div>
      </div>
    </article>`).join("");
  grid.addEventListener("click", e => {
    const b = e.target.closest(".add");
    if (b) addToCart(b.dataset.id);
  });
}

// reveal on scroll
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.12 });
document.querySelectorAll(".rv").forEach(el => io.observe(el));

renderCount();
