/*
 * CRYSTAL Grinder — Decaid BLE grinder plugin.
 *
 * Protocol source: CRYSTAL磨豆机的蓝牙协议 - R1.docx and the matching firmware
 * implementation (bleRPM.cpp). Every characteristic carries one big-endian
 * uint16 (two bytes, base64 on the plugin bridge).
 */
function createPlugin(host) {
  "use strict";

  var SERVICE = "7fa2d10c-12f3-4b9e-9d77-1a9b65432100";
  var CH = {
    mtRpm: "7fa2d10c-12f3-4b9e-9d77-1a9b65432101",
    xdRpm: "7fa2d10c-12f3-4b9e-9d77-1a9b65432102",
    bootSign: "7fa2d10c-12f3-4b9e-9d77-1a9b65432103",
    sysState: "7fa2d10c-12f3-4b9e-9d77-1a9b65432104",
    servoAngle: "7fa2d10c-12f3-4b9e-9d77-1a9b65432105",
    targetAngle: "7fa2d10c-12f3-4b9e-9d77-1a9b65432106"
  };

  var MAX_MT_RPM = 1500;
  var MAX_XD_RPM = 150;
  var MAX_GRIND = 1500;

  var BOOT = { manual: 1, timer: 2, smart: 3, stop: 4, applyTarget: 5 };
  var SYS_IDLE = 0;
  var SYS_BUSY = 1;

  // Labels must match the manifest's startMode values.
  var START_MODES = [
    { label: "智能（自动启停）", sign: BOOT.smart },
    { label: "手动", sign: BOOT.manual },
    { label: "定时", sign: BOOT.timer }
  ];

  var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function log(message) {
    host.log("[crystal-grinder] " + message);
  }

  function decodeBase64(text) {
    if (typeof text !== "string") return null;
    var clean = text.replace(/=+$/, "");
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var value = BASE64.indexOf(clean.charAt(i));
      if (value < 0) return null;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  }

  function encodeBase64(bytes) {
    var output = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b1 = bytes[i] & 0xff;
      var b2 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : null;
      var b3 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : null;
      output += BASE64.charAt(b1 >> 2);
      output += BASE64.charAt(((b1 & 0x03) << 4) | (b2 === null ? 0 : b2 >> 4));
      output += b2 === null ? "=" : BASE64.charAt(((b2 & 0x0f) << 2) | (b3 === null ? 0 : b3 >> 6));
      output += b3 === null ? "=" : BASE64.charAt(b3 & 0x3f);
    }
    return output;
  }

  // uint16 big-endian, exactly two bytes.
  function decodeUint16(text) {
    var bytes = decodeBase64(text);
    if (bytes === null || bytes.length !== 2) return null;
    return ((bytes[0] & 0xff) << 8) | (bytes[1] & 0xff);
  }

  function encodeUint16(value) {
    return encodeBase64([(value >> 8) & 0xff, value & 0xff]);
  }

  function resolveStartSign(settings) {
    var raw = settings && typeof settings === "object" ? settings.startMode : null;
    for (var i = 0; i < START_MODES.length; i++) {
      if (START_MODES[i].label === raw) return START_MODES[i].sign;
    }
    return BOOT.smart;
  }

  // Strict integer parse: "830" is accepted, "8.3" and "830abc" are not.
  function parseInteger(raw) {
    if (typeof raw === "number") {
      return Math.floor(raw) === raw && isFinite(raw) ? raw : null;
    }
    if (typeof raw !== "string") return null;
    var text = raw.trim();
    if (!/^[0-9]+$/.test(text)) return null;
    var value = parseInt(text, 10);
    return isFinite(value) ? value : null;
  }

  function normalizeUuid(uuid) {
    if (typeof uuid !== "string") return "";
    var lower = uuid.toLowerCase();
    if (/^[0-9a-f]{8}$/.test(lower)) return lower + "-0000-1000-8000-00805f9b34fb";
    return lower;
  }

  function hasService(services, service) {
    if (!services || typeof services.length !== "number") return false;
    var wanted = normalizeUuid(service);
    for (var i = 0; i < services.length; i++) {
      if (normalizeUuid(services[i]) === wanted) return true;
    }
    return false;
  }

  // The driver instance is created by the host, so the HTTP endpoints below reach
  // the connected session through this shared handle.
  var shared = { session: null };

  function httpSession() {
    var session = shared.session;
    return session && session.alive && session.gatt ? session : null;
  }

  function writeCharacteristic(session, characteristic, value) {
    return session.gatt.writeWithResponse(SERVICE, characteristic, encodeUint16(value));
  }

  function jsonResponse(status, payload) {
    return {
      status: status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };
  }

  return {
    id: "com.crystal.grinder",
    version: "0.1.0",

    onLoad: function (settings) {
      var startSign = resolveStartSign(settings);
      log("loaded, start sign " + startSign);

      return host.devices.bindDriver("crystal", {
        create: function (device) {
          var active = null;

          function session() {
            return {
              context: null,
              gatt: null,
              alive: false,
              sysState: null,
              servo: null,
              target: null,
              mtRpm: null,
              xdRpm: null
            };
          }

          function snapshotFor(current, state) {
            var snapshot = { state: state };
            if (current && current.servo !== null) {
              snapshot.setting = String(current.servo);
            }
            if (current && current.mtRpm !== null) {
              snapshot.rpm = current.mtRpm;
            }
            return snapshot;
          }

          // Notification-driven publications must never throw into the bridge.
          function publishState(state) {
            var current = active;
            if (!current || !current.alive || !current.context) return Promise.resolve();
            return current.context.publish(snapshotFor(current, state)).then(
              function () {},
              function (error) {
                log("publish failed: " + (error && error.message ? error.message : error));
              }
            );
          }

          function currentState() {
            if (!active || active.sysState === null) return "unknown";
            return active.sysState === SYS_BUSY ? "grinding" : "idle";
          }

          function updateSysState(data) {
            var value = decodeUint16(data);
            if (value === null || !active) return Promise.resolve();
            active.sysState = value;
            log("system state " + value);
            return publishState(currentState());
          }

          function updateServo(data) {
            var value = decodeUint16(data);
            if (value === null || !active) return Promise.resolve();
            active.servo = value;
            return publishState(currentState());
          }

          function updateTarget(data) {
            var value = decodeUint16(data);
            if (value === null || !active) return Promise.resolve();
            active.target = value;
            return Promise.resolve();
          }

          function updateMtRpm(data) {
            var value = decodeUint16(data);
            if (value === null || !active) return Promise.resolve();
            active.mtRpm = value;
            return publishState(currentState());
          }

          function updateXdRpm(data) {
            var value = decodeUint16(data);
            if (value === null || !active) return Promise.resolve();
            active.xdRpm = value;
            return Promise.resolve();
          }

          function requireSession() {
            if (!active || !active.alive || !active.gatt) {
              throw new Error("CRYSTAL grinder is not connected");
            }
            return active;
          }

          function readUint16(gatt, characteristic) {
            return gatt.read(SERVICE, characteristic).then(function (data) {
              return decodeUint16(data);
            });
          }

          function subscribeAll(gatt, current) {
            var required = [
              [CH.sysState, updateSysState],
              [CH.servoAngle, updateServo],
              [CH.mtRpm, updateMtRpm]
            ];
            var optional = [
              [CH.targetAngle, updateTarget],
              [CH.xdRpm, updateXdRpm]
            ];
            var chain = Promise.resolve();
            required.forEach(function (entry) {
              chain = chain.then(function () {
                return gatt.subscribe(SERVICE, entry[0], entry[1]);
              });
            });
            optional.forEach(function (entry) {
              chain = chain.then(function () {
                return gatt.subscribe(SERVICE, entry[0], entry[1]).then(
                  function () {},
                  function (error) {
                    log("optional subscription failed for " + entry[0] + ": " +
                      (error && error.message ? error.message : error));
                  }
                );
              });
            });
            return chain.then(function () {
              return current;
            });
          }

          function readInitial(gatt, current) {
            function attempt(characteristic, assign) {
              return readUint16(gatt, characteristic).then(
                function (value) {
                  if (value !== null) assign(value);
                },
                function (error) {
                  log("initial read failed for " + characteristic + ": " +
                    (error && error.message ? error.message : error));
                }
              );
            }
            return Promise.resolve()
              .then(function () { return attempt(CH.sysState, function (v) { current.sysState = v; }); })
              .then(function () { return attempt(CH.servoAngle, function (v) { current.servo = v; }); })
              .then(function () { return attempt(CH.targetAngle, function (v) { current.target = v; }); })
              .then(function () { return attempt(CH.mtRpm, function (v) { current.mtRpm = v; }); })
              .then(function () { return attempt(CH.xdRpm, function (v) { current.xdRpm = v; }); });
          }

          function withGattWrite(characteristic, value) {
            var current = requireSession();
            log("write " + characteristic.slice(-4) + " = " + value);
            return current.gatt.writeWithResponse(SERVICE, characteristic, encodeUint16(value));
          }

          return {
            async connect(context) {
              var current = session();
              current.context = context;
              current.gatt = context.gatt;
              current.alive = true;
              active = current;
              shared.session = current;

              context.gatt.onDisconnect(function () {
                current.alive = false;
                if (active === current) active = null;
                if (shared.session === current) shared.session = null;
                log("disconnected");
              });

              var services = await context.gatt.discoverServices().catch(function (error) {
                current.alive = false;
                if (active === current) active = null;
                if (shared.session === current) shared.session = null;
                throw error;
              });
              if (!hasService(services, SERVICE)) {
                current.alive = false;
                if (active === current) active = null;
                if (shared.session === current) shared.session = null;
                throw new Error("CRYSTAL grinder service " + SERVICE + " is missing");
              }
              try {
                await subscribeAll(context.gatt, current);
                await readInitial(context.gatt, current);
                // The first snapshot is part of readiness: let a rejection fail connect.
                await context.publish(snapshotFor(current, currentState()));
              } catch (error) {
                current.alive = false;
                if (active === current) active = null;
                if (shared.session === current) shared.session = null;
                throw error;
              }
              log("connected: " + device.name);
            },

            disconnect() {
              if (active) {
                active.alive = false;
                if (shared.session === active) shared.session = null;
                active = null;
              }
            },

            bleEvent() {},

            async start() {
              await withGattWrite(CH.bootSign, startSign);
            },

            async stop() {
              await withGattWrite(CH.bootSign, BOOT.stop);
            },

            async setGrindSetting(setting) {
              var value = parseInteger(setting);
              if (value === null || value < 0 || value > MAX_GRIND) {
                throw new Error("grind setting must be an integer 0-" + MAX_GRIND + ", got " + setting);
              }
              await withGattWrite(CH.targetAngle, value);
              await withGattWrite(CH.bootSign, BOOT.applyTarget);
              if (active) active.target = value;
            },

            async setRpm(rpm) {
              var value = parseInteger(rpm);
              if (value === null || value < 0 || value > MAX_MT_RPM) {
                throw new Error("rpm must be an integer 0-" + MAX_MT_RPM + ", got " + rpm);
              }
              await withGattWrite(CH.mtRpm, value);
              if (active) active.mtRpm = value;
            }
          };
        }
      });
    },

    // Endpoints used by the CRYSTAL control panel: the grinder contract has no
    // field for the bean-feed gate (XD_RPM) and no per-start mode, so the skin
    // talks to these two vendor endpoints directly.
    handleHttpRequest: function (request) {
      var endpoint = request.endpoint;
      var session = httpSession();

      if (endpoint === "status") {
        if (!session) return jsonResponse(200, { connected: false });
        return jsonResponse(200, {
          connected: true,
          state: session.sysState === SYS_BUSY ? "grinding" : (session.sysState === null ? "unknown" : "idle"),
          setting: session.servo,
          rpm: session.mtRpm,
          feed: session.xdRpm
        });
      }

      if (endpoint === "feed") {
        if (!session) return jsonResponse(503, { error: "grinder_not_connected" });
        if (request.method === "GET") {
          return jsonResponse(200, { feed: session.xdRpm });
        }
        var body = request.body || {};
        var feed = parseInteger(body.feed);
        if (feed === null || feed < 0 || feed > MAX_XD_RPM) {
          return jsonResponse(400, { error: "feed must be an integer 0-" + MAX_XD_RPM });
        }
        return writeCharacteristic(session, CH.xdRpm, feed).then(
          function () {
            session.xdRpm = feed;
            return jsonResponse(200, { feed: feed });
          },
          function (error) {
            return jsonResponse(502, { error: error && error.message ? error.message : String(error) });
          }
        );
      }

      if (endpoint === "start") {
        if (!session) return jsonResponse(503, { error: "grinder_not_connected" });
        var payload = request.body || {};
        var mode = payload.mode;
        if (mode !== "manual" && mode !== "timer" && mode !== "auto") {
          return jsonResponse(400, { error: "mode must be manual, timer or auto" });
        }
        var sign = mode === "manual" ? BOOT.manual : (mode === "timer" ? BOOT.timer : BOOT.smart);
        return writeCharacteristic(session, CH.bootSign, sign).then(
          function () { return jsonResponse(200, { mode: mode, sign: sign }); },
          function (error) {
            return jsonResponse(502, { error: error && error.message ? error.message : String(error) });
          }
        );
      }

      return jsonResponse(404, { error: "unknown endpoint" });
    }
  };
}
