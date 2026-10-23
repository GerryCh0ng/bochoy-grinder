(function () {
  "use strict";

  var HOST = location.hostname || "localhost";
  var API = "http://" + HOST + ":8080";
  var WS = "ws://" + HOST + ":8080";

  var GRINDER_STATE_LABELS = {
    idle: "空闲",
    grinding: "研磨中",
    error: "故障",
    unknown: "未知"
  };

  var MACHINE_STATE_LABELS = {
    idle: "空闲",
    heating: "加热中",
    ready: "就绪",
    espresso: "萃取中",
    steam: "蒸汽",
    hotWater: "热水",
    flush: "冲洗",
    sleep: "休眠",
    error: "故障"
  };

  var els = {
    grinderPill: document.getElementById("grinder-pill"),
    grinderPillText: document.getElementById("grinder-pill-text"),
    machinePill: document.getElementById("machine-pill"),
    machinePillText: document.getElementById("machine-pill-text"),
    grinderState: document.getElementById("grinder-state"),
    machineState: document.getElementById("machine-state"),
    settingHero: document.getElementById("setting-hero"),
    machineHero: document.getElementById("machine-hero"),
    rpmNow: document.getElementById("rpm-now"),
    setting: document.getElementById("setting"),
    rpm: document.getElementById("rpm"),
    groupTemp: document.getElementById("group-temp"),
    targetTemp: document.getElementById("target-temp"),
    pressure: document.getElementById("pressure"),
    flow: document.getElementById("flow"),
    events: document.getElementById("events"),
    toast: document.getElementById("toast")
  };

  var grinderOnline = false;
  var userEditing = false;
  var toastTimer = null;

  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.className = "toast";
    }, isError ? 5000 : 2200);
  }

  function event(message) {
    var item = document.createElement("li");
    var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.textContent = time + "  " + message;
    els.events.insertBefore(item, els.events.firstChild);
    while (els.events.children.length > 6) els.events.removeChild(els.events.lastChild);
  }

  function api(path, options) {
    return fetch(API + path, options).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          var detail = text;
          try {
            var parsed = JSON.parse(text);
            detail = parsed.error || parsed.code || text;
          } catch (ignored) {}
          throw new Error(response.status + " " + (detail || response.statusText));
        });
      }
      var type = response.headers.get("content-type") || "";
      return type.indexOf("application/json") >= 0 ? response.json() : response.text();
    });
  }

  function setPill(el, textEl, label, status) {
    el.className = "pill " + status;
    textEl.textContent = label;
  }

  function renderGrinder(state, setting, rpm) {
    grinderOnline = true;
    var name = GRINDER_STATE_LABELS[state] || state || "未知";
    els.grinderState.textContent = name;
    els.grinderState.className = "state" + (state === "grinding" ? " grinding" : "");
    setPill(els.grinderPill, els.grinderPillText, "磨豆机 · " + name, state === "grinding" ? "on busy" : "on");
    els.settingHero.className = "hero-value";

    if (setting !== undefined && setting !== null) els.settingHero.textContent = setting;
    if (rpm !== undefined && rpm !== null) els.rpmNow.textContent = rpm;

    if (!userEditing) {
      if (setting !== undefined && setting !== null) els.setting.value = setting;
      if (rpm !== undefined && rpm !== null) els.rpm.value = rpm;
    }

    ["start", "stop", "apply-setting", "apply-rpm"].forEach(function (id) {
      document.getElementById(id).disabled = false;
    });
  }

  function renderGrinderOffline() {
    grinderOnline = false;
    els.grinderState.textContent = "未连接";
    els.grinderState.className = "state offline";
    els.settingHero.textContent = "—";
    els.settingHero.className = "hero-value offline";
    els.rpmNow.textContent = "—";
    setPill(els.grinderPill, els.grinderPillText, "磨豆机 · 未连接", "off");
    ["start", "stop", "apply-setting", "apply-rpm"].forEach(function (id) {
      document.getElementById(id).disabled = true;
    });
  }

  function renderMachine(payload) {
    var state = payload && payload.state ? payload.state.state : null;
    var label = MACHINE_STATE_LABELS[state] || state || "未知";
    els.machineState.textContent = label;
    els.machineState.className = "state" + (state === "espresso" ? " brewing" : "");
    els.machineHero.textContent = label;
    setPill(els.machinePill, els.machinePillText, "咖啡机 · " + label, "on" + (state === "espresso" ? " busy" : ""));
    if (typeof payload.groupTemperature === "number") {
      els.groupTemp.textContent = payload.groupTemperature.toFixed(1);
    }
    if (typeof payload.targetGroupTemperature === "number") {
      els.targetTemp.textContent = payload.targetGroupTemperature.toFixed(1);
    }
    if (typeof payload.pressure === "number") els.pressure.textContent = payload.pressure.toFixed(2);
    if (typeof payload.flow === "number") els.flow.textContent = payload.flow.toFixed(1);
  }

  function renderMachineOffline() {
    els.machineState.textContent = "未连接";
    els.machineState.className = "state offline";
    setPill(els.machinePill, els.machinePillText, "咖啡机 · 未连接", "off");
  }

  function loadGrinder() {
    api("/api/v1/grinder/state")
      .then(function (snapshot) {
        renderGrinder(snapshot.state, snapshot.setting, snapshot.rpm);
      })
      .catch(function (error) {
        renderGrinderOffline();
        if (String(error.message).indexOf("503") !== 0) event("磨豆机状态读取失败：" + error.message);
      });
  }

  var ws = null;
  var wsRetry = 0;

  function connectGrinderStream() {
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    ws = new WebSocket(WS + "/ws/v1/grinder/snapshot");
    ws.onopen = function () {
      wsRetry = 0;
    };
    ws.onmessage = function (message) {
      var snapshot;
      try {
        snapshot = JSON.parse(message.data);
      } catch (ignored) {
        return;
      }
      renderGrinder(snapshot.state, snapshot.setting, snapshot.rpm);
    };
    ws.onclose = function () {
      if (!grinderOnline) renderGrinderOffline();
      var delay = Math.min(5000, 500 + wsRetry * 750);
      wsRetry += 1;
      setTimeout(connectGrinderStream, delay);
    };
  }

  function pollMachine() {
    api("/api/v1/machine/state")
      .then(renderMachine)
      .catch(function (error) {
        renderMachineOffline();
        if (String(error.message).indexOf("503") !== 0) event("咖啡机状态读取失败：" + error.message);
      });
  }

  function command(path, body, okMessage) {
    var options = { method: "PUT", headers: { "content-type": "application/json" } };
    if (body !== undefined) options.body = JSON.stringify(body);
    return api(path, options)
      .then(function () {
        if (okMessage) {
          toast(okMessage);
          event(okMessage);
        }
        loadGrinder();
      })
      .catch(function (error) {
        toast("失败：" + error.message, true);
        event("失败：" + error.message);
      });
  }

  document.getElementById("start").addEventListener("click", function () {
    command("/api/v1/grinder/state/grinding", undefined, "开始研磨");
  });

  document.getElementById("stop").addEventListener("click", function () {
    command("/api/v1/grinder/state/idle", undefined, "停止研磨");
  });

  document.getElementById("apply-setting").addEventListener("click", function () {
    var value = Number(els.setting.value);
    if (!Number.isInteger(value) || value < 0 || value > 1500) {
      toast("研磨度必须是 0–1500 的整数", true);
      return;
    }
    command("/api/v1/grinder/setting", { setting: String(value) }, "研磨度设为 " + value);
  });

  document.getElementById("apply-rpm").addEventListener("click", function () {
    var value = Number(els.rpm.value);
    if (!Number.isInteger(value) || value < 0 || value > 1500) {
      toast("转速必须是 0–1500 的整数", true);
      return;
    }
    command("/api/v1/grinder/rpm", { rpm: value }, "转速设为 " + value);
  });

  document.getElementById("brew").addEventListener("click", function () {
    command("/api/v1/machine/state/espresso", undefined, "开始萃取");
  });

  document.getElementById("machine-idle").addEventListener("click", function () {
    command("/api/v1/machine/state/idle", undefined, "咖啡机停止");
  });

  Array.prototype.forEach.call(document.querySelectorAll(".step"), function (button) {
    button.addEventListener("click", function () {
      var input = document.getElementById(button.getAttribute("data-target"));
      var next = (Number(input.value) || 0) + Number(button.getAttribute("data-step"));
      input.value = Math.max(0, Math.min(1500, next));
    });
  });

  [els.setting, els.rpm].forEach(function (input) {
    input.addEventListener("focus", function () {
      userEditing = true;
    });
    input.addEventListener("blur", function () {
      userEditing = false;
      loadGrinder();
    });
  });

  loadGrinder();
  connectGrinderStream();
  pollMachine();
  setInterval(pollMachine, 1000);
  setInterval(function () {
    if (!grinderOnline) loadGrinder();
  }, 5000);
})();
