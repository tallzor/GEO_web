import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function credentialsKey() {
  const raw = process.env.PUBLISHING_CREDENTIALS_KEY?.trim();
  if (!raw) throw new Error("发布凭据加密密钥尚未配置");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PUBLISHING_CREDENTIALS_KEY 必须是32字节Base64或64位Hex密钥");
  return key;
}

export function encryptPublishingCredentials(value: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialsKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPublishingCredentials(value: string) {
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !encryptedText) throw new Error("发布凭据格式不正确");
  const decipher = createDecipheriv("aes-256-gcm", credentialsKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(decrypted) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("发布凭据内容不正确");
  return parsed as Record<string, string>;
}

export function hashExtensionToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function maskAppId(value: string) {
  if (value.length <= 8) return `${value.slice(0, 2)}****${value.slice(-2)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
