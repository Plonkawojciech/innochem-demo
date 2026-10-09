import net from "node:net";
import path from "node:path";
import { checkoutTestConfiguration } from "./checkout-test-config.mjs";

// The integration suite must never inherit a client connection string or reach a provider.
// Node's preload and tsx's CJS bridge can evaluate this module twice in one process.
const key = Symbol.for("innochem.checkout-regression-isolation.v1");
const previous = globalThis[key];
if (
  previous &&
  process.env.PGHOST !== previous.config.databaseHost &&
  process.env.PGHOST !== previous.config.socketHost
)
  throw new Error(
    "Checkout regression requires the isolated test configuration",
  );
const config = checkoutTestConfiguration(
  previous
    ? { ...process.env, PGHOST: previous.config.databaseHost }
    : process.env,
);
if (
  previous &&
  (Object.keys(config).some(
    (field) => config[field] !== previous.config[field],
  ) ||
    net.Socket.prototype.connect !== previous.connect ||
    globalThis.fetch !== previous.fetch)
)
  throw new Error(
    "Checkout regression requires the isolated test configuration",
  );

export const checkoutNetworkIsolation = previous?.config ?? config;
process.env.PGHOST = checkoutNetworkIsolation.socketHost;
if (!previous) {
  const socket = path.join(config.socketHost, `.s.PGSQL.${config.port}`);
  const connect = net.Socket.prototype.connect;
  const blockedConnect = function (...args) {
    const target = Array.isArray(args[0]) ? args[0][0] : args[0];
    const socketPath = typeof target === "string" ? target : target?.path;
    if (socketPath !== socket)
      throw new Error(
        "Checkout regression blocked a non-PostgreSQL connection",
      );
    return connect.apply(this, args);
  };
  const blockedFetch = async () => {
    throw new Error("Checkout regression blocked an external fetch");
  };
  net.Socket.prototype.connect = blockedConnect;
  globalThis.fetch = blockedFetch;
  Object.defineProperty(globalThis, key, {
    value: Object.freeze({
      config,
      connect: blockedConnect,
      fetch: blockedFetch,
    }),
  });
}
