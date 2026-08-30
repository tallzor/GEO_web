import "server-only";

export function isAiApiEnabled() {
  return process.env.NODE_ENV !== "production"
    || process.env.ENABLE_LOCAL_AI_API === "true";
}
