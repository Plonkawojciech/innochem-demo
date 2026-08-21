export type Product = {
  id: string;
  name: string;
  visc: string;
  vol: string;
  price: number;
  img: string;
  tag: string;
};

// Demo pokazuje jedną przykładową kartę produktu.
export const PRODUCTS: Product[] = [
  { id: "hps-5w30", name: "Royal Purple HPS", visc: "5W-30", vol: "0,946 l", price: 78, img: "/img/rp-hps-5w30-hd.png", tag: "HIGH PERFORMANCE STREET" },
];

export const zl = (n: number) => n.toFixed(2).replace(".", ",") + " zł";
