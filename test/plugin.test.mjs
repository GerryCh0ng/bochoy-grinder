import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE,
  CH,
  createHost,
  createGatt,
  createContext,
  createDriver,
  createPluginAndDriver,
  decode
} from "./fake-host.mjs";

async function connected(options = {}) {
  const host = createHost();
  const gatt = createGatt(
    {
      [CH.sysState]: options.sysState ?? 0,
      [CH.servoAngle]: options.servo ?? 830,
      [CH.targetAngle]: options.target ?? 830,
      [CH.mtRpm]: options.mtRpm ?? 900,
      [CH.xdRpm]: 40
    },
    options
  );
  const handlers = await createDriver(host, options);
  const context = createContext(gatt);
  await handlers.connect(context);
  return { host, gatt, handlers, context };
}

test("uint16 is big-endian on the wire", () => {
  // 1500 must travel as 0x05 0xDC, which is "Bdw=" in base64.
  assert.equal(decode("Bdw="), 1500);
  assert.equal(Buffer.from([0x05, 0xdc]).toString("base64"), "Bdw=");
});

test("connect publishes an initial snapshot from reads", async () => {
  const { context, gatt } = await connected({ sysState: 0, servo: 830, mtRpm: 900 });
  assert.deepEqual(context.published[0], { state: "idle", setting: "830", rpm: 900 });
  assert.ok(gatt.reads.includes(CH.sysState));
  assert.ok(gatt.reads.includes(CH.servoAngle));
  assert.ok(gatt.reads.includes(CH.mtRpm));
});

test("subscriptions cover the readable characteristics", async () => {
  const { gatt } = await connected();
  for (const characteristic of [CH.sysState, CH.servoAngle, CH.mtRpm, CH.targetAngle, CH.xdRpm]) {
    assert.ok(gatt.subscriptions.has(characteristic), characteristic);
  }
});

test("system state notifications drive idle/grinding", async () => {
  const { context, gatt } = await connected();
  await gatt.notify(CH.sysState, 1);
  assert.equal(context.published.at(-1).state, "grinding");
  await gatt.notify(CH.sysState, 0);
  assert.equal(context.published.at(-1).state, "idle");
});

test("servo notifications update the grind setting", async () => {
  const { context, gatt } = await connected();
  await gatt.notify(CH.servoAngle, 1200);
  assert.equal(context.published.at(-1).setting, "1200");
});

test("rpm notifications update the rpm", async () => {
  const { context, gatt } = await connected();
  await gatt.notify(CH.mtRpm, 1200);
  assert.equal(context.published.at(-1).rpm, 1200);
});

test("start writes the default smart start sign (3)", async () => {
  const { gatt, handlers } = await connected();
  await handlers.start();
  assert.deepEqual(gatt.writes.at(-1), {
    characteristic: CH.bootSign,
    value: 3,
    data: Buffer.from([0x00, 0x03]).toString("base64")
  });
});

test("start honours the manifest startMode setting", async () => {
  const { gatt, handlers } = await connected({ settings: { startMode: "手动" } });
  await handlers.start();
  assert.equal(gatt.writes.at(-1).value, 1);
});

test("stop writes 4", async () => {
  const { gatt, handlers } = await connected();
  await handlers.stop();
  assert.equal(gatt.writes.at(-1).value, 4);
  assert.equal(gatt.writes.at(-1).characteristic, CH.bootSign);
});

test("setGrindSetting writes the target then applies it with 5", async () => {
  const { gatt, handlers } = await connected();
  await handlers.setGrindSetting("830");
  const [targetWrite, applyWrite] = gatt.writes.slice(-2);
  assert.equal(targetWrite.characteristic, CH.targetAngle);
  assert.equal(targetWrite.value, 830);
  assert.equal(applyWrite.characteristic, CH.bootSign);
  assert.equal(applyWrite.value, 5);
});

test("setGrindSetting rejects non-integer and out-of-range values", async () => {
  const { handlers, gatt } = await connected();
  const before = gatt.writes.length;
  await assert.rejects(() => handlers.setGrindSetting("8.3"), /integer 0-1500/);
  await assert.rejects(() => handlers.setGrindSetting("abc"), /integer 0-1500/);
  await assert.rejects(() => handlers.setGrindSetting("1501"), /integer 0-1500/);
  await assert.rejects(() => handlers.setGrindSetting("-1"), /integer 0-1500/);
  assert.equal(gatt.writes.length, before);
});

test("setRpm writes the motor rpm and rejects out-of-range values", async () => {
  const { gatt, handlers } = await connected();
  await handlers.setRpm(1200);
  assert.equal(gatt.writes.at(-1).characteristic, CH.mtRpm);
  assert.equal(gatt.writes.at(-1).value, 1200);
  await assert.rejects(() => handlers.setRpm(1501), /0-1500/);
  await assert.rejects(() => handlers.setRpm(-1), /0-1500/);
});

test("a missing service fails the connect instead of publishing garbage", async () => {
  const host = createHost();
  const gatt = createGatt({}, { services: ["0000180f-0000-1000-8000-00805f9b34fb"] });
  const handlers = await createDriver(host);
  await assert.rejects(() => handlers.connect(createContext(gatt)), /service .* is missing/);
});

test("failed initial reads still produce a valid unknown-state snapshot", async () => {
  const host = createHost();
  const gatt = createGatt({}, { failReads: true });
  const handlers = await createDriver(host);
  const context = createContext(gatt);
  await handlers.connect(context);
  assert.deepEqual(context.published[0], { state: "unknown" });
});

test("commands after link loss fail instead of writing into a dead session", async () => {
  const { gatt, handlers } = await connected();
  await gatt.linkLost();
  await assert.rejects(() => handlers.start(), /not connected/);
});

test("late notifications after disconnect do not publish", async () => {
  const { gatt, handlers, context } = await connected();
  await handlers.disconnect();
  const count = context.published.length;
  await gatt.notify(CH.sysState, 1);
  assert.equal(context.published.length, count);
});

test("a failed connect leaves no session commands can use", async () => {
  const host = createHost();
  const gatt = createGatt({}, { services: [] });
  const handlers = await createDriver(host);
  await assert.rejects(() => handlers.connect(createContext(gatt)), /is missing/);
  await assert.rejects(() => handlers.setRpm(900), /not connected/);
});

test("a rejected first snapshot fails the connect", async () => {
  const host = createHost();
  const gatt = createGatt({ [CH.sysState]: 0, [CH.servoAngle]: 830, [CH.mtRpm]: 900 });
  const handlers = await createDriver(host);
  const context = createContext(gatt);
  context.publish = () => Promise.reject(new Error("invalid_argument"));
  await assert.rejects(() => handlers.connect(context), /invalid_argument/);
  await assert.rejects(() => handlers.start(), /not connected/);
});

// --- HTTP endpoints used by the control panel ---

async function connectedPlugin(options = {}) {
  const host = createHost();
  const gatt = createGatt(
    {
      [CH.sysState]: 0,
      [CH.servoAngle]: 830,
      [CH.mtRpm]: 900,
      [CH.xdRpm]: 40
    },
    options
  );
  const { plugin, handlers } = await createPluginAndDriver(host, options);
  await handlers.connect(createContext(gatt));
  return { plugin, handlers, gatt };
}

test("status endpoint reports the session values", async () => {
  const { plugin } = await connectedPlugin();
  const response = await plugin.handleHttpRequest({ endpoint: "status", method: "GET", body: null, query: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    connected: true,
    state: "idle",
    setting: 830,
    rpm: 900,
    feed: 40
  });
});

test("status endpoint reports disconnected with no session", async () => {
  const host = createHost();
  const { plugin } = await createPluginAndDriver(host);
  const response = await plugin.handleHttpRequest({ endpoint: "status", method: "GET", body: null, query: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { connected: false });
});

test("feed endpoint writes the bean-feed gate", async () => {
  const { plugin, gatt } = await connectedPlugin();
  const response = await plugin.handleHttpRequest({
    endpoint: "feed",
    method: "POST",
    body: { feed: 88 },
    query: {}
  });
  assert.equal(response.status, 200);
  assert.equal(gatt.writes.at(-1).characteristic, CH.xdRpm);
  assert.equal(gatt.writes.at(-1).value, 88);
  assert.deepEqual(JSON.parse(response.body), { feed: 88 });

  const read = await plugin.handleHttpRequest({ endpoint: "feed", method: "GET", body: null, query: {} });
  assert.deepEqual(JSON.parse(read.body), { feed: 88 });
});

test("feed endpoint rejects out-of-range values", async () => {
  const { plugin, gatt } = await connectedPlugin();
  const before = gatt.writes.length;
  for (const feed of [151, -1, 1.5, "x"]) {
    const response = await plugin.handleHttpRequest({
      endpoint: "feed",
      method: "POST",
      body: { feed },
      query: {}
    });
    assert.equal(response.status, 400, String(feed));
  }
  assert.equal(gatt.writes.length, before);
});

test("start endpoint picks the boot sign from the requested mode", async () => {
  const { plugin, gatt } = await connectedPlugin();
  for (const [mode, sign] of [["manual", 1], ["timer", 2], ["auto", 3]]) {
    const response = await plugin.handleHttpRequest({
      endpoint: "start",
      method: "POST",
      body: { mode },
      query: {}
    });
    assert.equal(response.status, 200);
    assert.equal(gatt.writes.at(-1).characteristic, CH.bootSign);
    assert.equal(gatt.writes.at(-1).value, sign, mode);
  }
});

test("start endpoint rejects an unknown mode", async () => {
  const { plugin } = await connectedPlugin();
  const response = await plugin.handleHttpRequest({
    endpoint: "start",
    method: "POST",
    body: { mode: "turbo" },
    query: {}
  });
  assert.equal(response.status, 400);
});

test("vendor endpoints answer 503 when the grinder is not connected", async () => {
  const host = createHost();
  const { plugin } = await createPluginAndDriver(host);
  for (const endpoint of ["feed", "start"]) {
    const response = await plugin.handleHttpRequest({
      endpoint,
      method: "POST",
      body: { feed: 10, mode: "auto" },
      query: {}
    });
    assert.equal(response.status, 503, endpoint);
  }
});
