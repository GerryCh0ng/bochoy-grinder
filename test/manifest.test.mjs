// Contract checks: the manifest must satisfy Decaid's parser rules, and the
// factory must return exactly the handlers the declared capabilities require.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, loadPlugin } from "./fake-host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.join(here, "..", "crystal-grinder.reaplugin");
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "manifest.json"), "utf8"));

const KNOWN_PERMISSIONS = new Set([
  "log", "api", "emit", "pluginStorage", "events.machine", "events.shots",
  "events.workflow", "proxy.decent_api", "proxy.decent_api.write",
  "network.websocket", "network.tcp", "network.tls", "transport.ble"
]);
const GRINDER_CAPABILITIES = new Set(["startStop", "grindSetting", "rpmControl"]);

test("manifest identity and version are installable", () => {
  assert.match(manifest.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assert.notEqual(manifest.id, ".");
  assert.notEqual(manifest.id, "..");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.apiVersion, 1);
  for (const key of ["name", "author", "description"]) {
    assert.equal(typeof manifest[key], "string");
    assert.ok(manifest[key].length > 0, key);
  }
});

test("permissions are all known names", () => {
  assert.ok(Array.isArray(manifest.permissions));
  for (const permission of manifest.permissions) {
    assert.ok(KNOWN_PERMISSIONS.has(permission), permission);
  }
  assert.ok(manifest.permissions.includes("transport.ble"));
});

// The host parses `PluginApi.fromJsonList(json['api'])`, which rejects a
// missing key, so the key is mandatory even with no endpoints.
test("api key is present as an array of declared endpoints", () => {
  assert.ok(Array.isArray(manifest.api), "manifest.api must be an array");
  const ids = manifest.api.map((entry) => entry.id);
  assert.deepEqual(ids, ["status", "feed", "start"]);
  for (const entry of manifest.api) {
    assert.equal(entry.type, "http");
    assert.ok(manifest.permissions.includes("api"));
  }
});

test("one BLE grinder driver with consistent capabilities and controls", () => {
  assert.equal(manifest.drivers.length, 1);
  const driver = manifest.drivers[0];
  assert.match(driver.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  assert.equal(driver.type, "grinder");
  assert.equal(manifest.drivers.filter((entry) => entry.ble).length, 1);

  const capabilities = new Set(driver.capabilities);
  for (const capability of capabilities) {
    assert.ok(GRINDER_CAPABILITIES.has(capability), capability);
  }

  const controls = driver.controls ?? {};
  for (const key of Object.keys(controls)) {
    assert.ok(capabilities.has(key), `control ${key} needs its capability`);
    const descriptor = controls[key];
    assert.equal(descriptor.kind, "numeric");
    assert.equal(typeof descriptor.min, "number");
    assert.equal(typeof descriptor.max, "number");
    assert.ok(descriptor.min <= descriptor.max);
    assert.ok(descriptor.step > 0);
    if (key === "rpmControl") {
      assert.ok(Number.isInteger(descriptor.min));
      assert.ok(Number.isInteger(descriptor.max));
      assert.ok(Number.isInteger(descriptor.step));
      assert.ok(descriptor.min >= 0);
    }
  }
  assert.deepEqual(controls.grindSetting, { kind: "numeric", min: 0, max: 1500, step: 1 });
  assert.deepEqual(controls.rpmControl, { kind: "numeric", min: 0, max: 1500, step: 1 });
});

test("BLE matcher declares exactly one name predicate", () => {
  const match = manifest.drivers[0].ble.match;
  assert.deepEqual(Object.keys(match), ["name"]);
  assert.deepEqual(Object.keys(match.name), ["prefix"]);
  assert.equal(match.name.prefix, "CRYSTAL-");
  assert.ok(match.name.prefix.length <= 248);
});

test("every setting has a label, description and valid default", () => {
  for (const [key, schema] of Object.entries(manifest.settings ?? {})) {
    assert.ok(typeof schema.label === "string" && schema.label.length > 0, key);
    assert.ok(typeof schema.description === "string" && schema.description.length > 0, key);
    if (schema.type === "enum") {
      assert.ok(Array.isArray(schema.values) && schema.values.length > 0, key);
      for (const value of schema.values) assert.equal(typeof value, "string");
      assert.equal(new Set(schema.values).size, schema.values.length);
      assert.ok(schema.values.includes(schema.default), `${key} default`);
    }
  }
});

test("factory is synchronous and returns exactly the declared handlers", async () => {
  const host = createHost();
  const plugin = loadPlugin(path.join(packageDir, "plugin.js"))(host);
  await plugin.onLoad({ startMode: "智能（自动启停）" });

  assert.equal(host.bindings.length, 1);
  const { driverId, factory } = host.bindings[0];
  assert.equal(driverId, "crystal");

  const handlers = factory.create({ id: "plugin:test", name: "CRYSTAL-E57C" });
  assert.equal(typeof handlers.then, "undefined", "create must not be async");

  const driver = manifest.drivers[0];
  const expected = new Set(["connect", "disconnect", "bleEvent"]);
  if (driver.capabilities.includes("startStop")) {
    expected.add("start");
    expected.add("stop");
  }
  if (driver.capabilities.includes("grindSetting")) expected.add("setGrindSetting");
  if (driver.capabilities.includes("rpmControl")) expected.add("setRpm");
  expected.add("bleEvent");

  for (const name of expected) assert.equal(typeof handlers[name], "function", name);
  for (const name of ["execute", "tare", "startTimer"]) {
    assert.equal(handlers[name], undefined, `${name} must not exist`);
  }
});
