import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

export const sendValidationError = (
  reply: FastifyReply,
  error: ZodError,
  labels: Readonly<Record<string, string>>,
  fallback: string,
) => {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join(".") ?? "";
  const field = issue?.path
    .slice()
    .reverse()
    .find((part): part is string => typeof part === "string" && Boolean(labels[part]));
  const label = field ? labels[field] : undefined;
  let detail = issue?.message ?? "格式不正确";
  if (issue?.code === "too_small") {
    detail = issue.origin === "string"
      ? `至少填写 ${issue.minimum} 个字符`
      : `至少选择 ${issue.minimum} 项`;
  } else if (issue?.code === "too_big") {
    detail = issue.origin === "string"
      ? `最多填写 ${issue.maximum} 个字符`
      : `最多选择 ${issue.maximum} 项`;
  } else if (issue?.code === "invalid_type") {
    detail = "未填写或格式不正确";
  }
  return reply.status(400).send({
    error: label ? `${label}${detail}` : fallback,
    field: path || undefined,
  });
};
