export type SendFeedback = {
  tone: "error" | "success" | "info";
  message: string;
};

export function getSendFeedback(params: {
  sendStatus?: string;
  sendMessage?: string;
} | undefined): SendFeedback | null {
  const message = params?.sendMessage?.trim();

  if (!message) {
    return null;
  }

  if (params?.sendStatus === "success") {
    return { tone: "success", message };
  }

  if (params?.sendStatus === "info") {
    return { tone: "info", message };
  }

  return { tone: "error", message };
}
