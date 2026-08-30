(async () => {
  const { pendingJob } = await chrome.storage.local.get("pendingJob");
  if (!pendingJob?.recordId || sessionStorage.getItem(`geo-job-${pendingJob.recordId}`)) return;
  sessionStorage.setItem(`geo-job-${pendingJob.recordId}`, "started");
  try {
    const titleControl = await waitFor(() => findTitleControl(), 20000);
    const bodyControl = await waitFor(() => findBodyControl(titleControl), 20000);
    setNativeValue(titleControl, pendingJob.title);
    setEditableValue(bodyControl, pendingJob.body);
    await waitForSaved(20000);
    await chrome.runtime.sendMessage({ type: "geo-zhihu-result", success: true, draftUrl: location.href });
  } catch (error) {
    await chrome.runtime.sendMessage({ type: "geo-zhihu-result", success: false, error: error instanceof Error ? error.message : "知乎编辑器写入失败" });
  }
})();

function findTitleControl() {
  const selectors = ["textarea[placeholder*='标题']", "input[placeholder*='标题']", ".WriteIndex-titleInput textarea", ".WriteIndex-titleInput input"];
  return selectors.map((selector) => document.querySelector(selector)).find(visible) || null;
}

function findBodyControl(titleControl) {
  const candidates = [...document.querySelectorAll("[contenteditable='true']")].filter((element) => visible(element) && element !== titleControl);
  return candidates.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || null;
}

function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 20 && rect.height > 15;
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setEditableValue(element, value) {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("insertText", false, value);
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

async function waitForSaved(timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const text = document.body.innerText;
    if (text.includes("已保存") || text.includes("保存成功")) return;
    await delay(600);
  }
  throw new Error("未检测到知乎草稿保存成功，请检查登录状态后重试");
}

async function waitFor(factory, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = factory();
    if (result) return result;
    await delay(400);
  }
  throw new Error("未找到知乎编辑器，请确认已登录并打开文章编辑页");
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
