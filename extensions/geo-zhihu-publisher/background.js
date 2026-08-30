chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "geo-zhihu-result") return;
  complete(message).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function complete(message) {
  const { baseUrl, token, pendingJob } = await chrome.storage.local.get(["baseUrl", "token", "pendingJob"]);
  if (!baseUrl || !token || !pendingJob?.recordId) throw new Error("扩展配置或同步任务已丢失");
  const response = await fetch(`${baseUrl}/api/publishing/extension/jobs/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recordId: pendingJob.recordId, success: Boolean(message.success), draftUrl: message.draftUrl, error: message.error }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "同步结果回传失败");
  const lastStatus = message.success ? "知乎草稿已保存，可返回GEO网站查看结果" : `同步失败：${message.error || "知乎编辑器写入失败"}`;
  await chrome.storage.local.set({ lastStatus });
  await chrome.storage.local.remove("pendingJob");
}
