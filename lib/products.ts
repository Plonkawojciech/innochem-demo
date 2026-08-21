export type Product = {
  id: string;
  name: string;
  visc: string;
  vol: string;
  price: number;
  img: string;
  tag: string;
};

export const PRODUCTS: Product[] = [
  { id: "hps-5w30", name: "Royal Purple HPS", visc: "5W-30", vol: "0,946 l", price: 78, img: "/img/rp-hps-5w30-hd.png", tag: "HIGH PERFORMANCE STREET" },
  { id: "0w40", name: "Royal Purple Motor Oil", visc: "0W-40", vol: "0,946 l", price: 80, img: "/img/royal-purple-motor-oil-0w40.jpg", tag: "API SN" },
  { id: "5w30", name: "Royal Purple Motor Oil", visc: "5W-30", vol: "0,946 l", price: 74, img: "/img/rp-motor-oil-5w30.jpg", tag: "API SN" },
  { id: "0w20", name: "Royal Purple Motor Oil", visc: "0W-20", vol: "0,946 l", price: 74, img: "/img/royal-purple-motor-oil-0w20.jpg", tag: "API SN" },
  { id: "5w20", name: "Royal Purple Motor Oil", visc: "5W-20", vol: "0,946 l", price: 74, img: "/img/rp-motor-oil-5w20.jpg", tag: "API SN" },
  { id: "hps-5w20", name: "Royal Purple HPS", visc: "5W-20", vol: "0,946 l", price: 78, img: "/img/rp-motor-oil-hps-5w20.jpg", tag: "HIGH PERFORMANCE STREET" },
];

export const zl = (n: number) => n.toFixed(2).replace(".", ",") + " zł";
