import net from "node:net";
import path from "node:path";

// The integration suite must never inherit a client connection string or reach a provider.
if (
  process.env.DATABASE_URL ||
  !process.env.PGDATABASE?.startsWith("innochem_test_") ||
  !process.env.PGHOST?.startsWith("/") ||
  !/^\d{1,5}$/.test(process.env.PGPORT || "")
)
  throw new Error(
    "Checkout regression requires an innochem_test_* database on an explicit Unix socket, without DATABASE_URL",
  );

const socket = path.join(process.env.PGHOST, `.s.PGSQL.${process.env.PGPORT}`);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const target = Array.isArray(args[0]) ? args[0][0] : args[0];
  const socketPath = typeof target === "string" ? target : target?.path;
  if (socketPath !== socket)
    throw new Error("Checkout regression blocked a non-PostgreSQL connection");
  return connect.apply(this, args);
};

globalThis.fetch = async () => {
  throw new Error("Checkout regression blocked an external fetch");
};
