const baseUrlInput = document.querySelector("#baseUrl");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");
const syncButton = document.querySelector("#sync");

chrome.storage.local.get(["baseUrl", "token", "lastStatus"], (value) => {
  baseUrlInput.value = value.baseUrl || "";
  tokenInput.value = value.token || "";
  if (value.lastStatus) status.textContent = value.lastStatus;
});

document.querySelector("#save").addEventListener("click", async () => {
  const config = readConfig();
  if (!config) return;
  await chrome.storage.local.set(config);
  show("配置已保存在本机浏览器中");
});

syncButton.addEventListener("click", async () => {
  const config = readConfig();
  if (!config) return;
  syncButton.disabled = true;
  show("正在领取同步任务…");
  try {
    await chrome.storage.local.set(config);
    const response = await fetch(`${config.baseUrl}/api/publishing/extension/jobs/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "X-Extension-Version": chrome.runtime.getManifest().version },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "任务领取失败");
    if (!payload.job) { show("当前没有待同步的知乎草稿"); return; }
    await chrome.storage.local.set({ pendingJob: payload.job });
    show("已领取任务，正在打开知乎编辑器…");
    await chrome.tabs.create({ url: "https://zhuanlan.zhihu.com/write" });
    window.close();
  } catch (error) {
    show(error instanceof Error ? error.message : "任务领取失败");
  } finally { syncButton.disabled = false; }
});

function readConfig() {
  const baseUrl = baseUrlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  if (!/^https?:\/\//.test(baseUrl) || !token) { show("请填写正确的网站地址和连接码"); return null; }
  return { baseUrl, token };
}

function show(message) {
  status.textContent = message;
  chrome.storage.local.set({ lastStatus: message });
}
