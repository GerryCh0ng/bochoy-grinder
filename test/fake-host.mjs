// Minimal stand-in for Decaid's plugin host + BLE bridge, good enough to drive
// plugin.js outside Flutter. Data crosses the bridge as base64 strings, exactly
// like the real host.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE = "7fa2d10c-12f3-4b9e-9d77-1a9b65432100";
export const CH = {
  mtRpm: "7fa2d10c-12f3-4b9e-9d77-1a9b65432101",
  xdRpm: "7fa2d10c-12f3-4b9e-9d77-1a9b65432102",
  bootSign: "7fa2d10c-12f3-4b9e-9d77-1a9b65432103",
  sysState: "7fa2d10c-12f3-4b9e-9d77-1a9b65432104",
  servoAngle: "7fa2d10c-12f3-4b9e-9d77-1a9b65432105",
  targetAngle: "7fa2d10c-12f3-4b9e-9d77-1a9b65432106"
};

const here = path.dirname(fileURLToPath(import.meta.url));

export function encode(value) {
  const buffer = Buffer.from([(value >> 8) & 0xff, value & 0xff]);
  return buffer.toString("base64");
}

export function decode(base64) {
  const buffer = Buffer.from(base64, "base64");
  return (buffer[0] << 8) | buffer[1];
}

export function loadPlugin(pluginPath = path.join(here, "..", "crystal-grinder.reaplugin", "plugin.js")) {
  const source = fs.readFileSync(pluginPath, "utf8");
  return new Function(source + "\nreturn createPlugin;")();
}

export function createHost() {
  const host = {
    logs: [],
    bindings: [],
    log(message) {
      host.logs.push(message);
    },
    devices: {
      bindDriver(driverId, factory) {
        host.bindings.push({ driverId, factory });
        return Promise.resolve();
      }
    }
  };
  return host;
}

// values: characteristic uuid -> uint16 the device currently reports.
export function createGatt(values = {}, options = {}) {
  const reads = [];
  const writes = [];
  const subscriptions = new Map();
  const state = {
    values: { ...values },
    disconnected: false,
    onDisconnect: null,
    failReads: options.failReads === true,
    services: options.services ?? [SERVICE]
  };

  const gatt = {
    reads,
    writes,
    subscriptions,
    state,
    async discoverServices() {
      return state.services;
    },
    async read(service, characteristic) {
      reads.push(characteristic);
      if (state.failReads) throw new Error("read failed");
      return encode(state.values[characteristic] ?? 0);
    },
    async writeWithResponse(service, characteristic, data) {
      writes.push({ characteristic, value: decode(data), data });
      state.values[characteristic] = decode(data);
      const listener = subscriptions.get(characteristic);
      if (listener) await listener(data);
      return undefined;
    },
    async writeWithoutResponse(service, characteristic, data) {
      return gatt.writeWithResponse(service, characteristic, data);
    },
    async subscribe(service, characteristic, callback) {
      subscriptions.set(characteristic, callback);
      return { async unsubscribe() { subscriptions.delete(characteristic); } };
    },
    onDisconnect(callback) {
      state.onDisconnect = callback;
    },
    // Test helper: device pushes a notification.
    async notify(characteristic, value) {
      state.values[characteristic] = value;
      const listener = subscriptions.get(characteristic);
      if (listener) await listener(encode(value));
    },
    async linkLost() {
      if (state.onDisconnect) await state.onDisconnect();
    }
  };
  return gatt;
}

export function createContext(gatt) {
  const published = [];
  const context = {
    gatt,
    published,
    publish(snapshot) {
      published.push(snapshot);
      return Promise.resolve();
    },
    publishInfo() {
      return Promise.resolve();
    },
    reportDisconnected() {
      return Promise.resolve();
    }
  };
  return context;
}

export async function createDriver(host, options = {}) {
  const plugin = loadPlugin(options.pluginPath) (host);
  await plugin.onLoad(options.settings ?? {});
  const binding = host.bindings[0];
  const handlers = binding.factory.create({ id: "plugin:com.crystal.grinder:crystal:AA:BB", name: "CRYSTAL-E57C" });
  return handlers;
}

export async function createPluginAndDriver(host, options = {}) {
  const plugin = loadPlugin(options.pluginPath) (host);
  await plugin.onLoad(options.settings ?? {});
  const binding = host.bindings[0];
  const handlers = binding.factory.create({ id: "plugin:com.crystal.grinder:crystal:AA:BB", name: "CRYSTAL-E57C" });
  return { plugin, handlers };
}
