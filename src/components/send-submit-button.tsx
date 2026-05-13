"use client";

import { Send } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SendSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
      disabled={disabled || pending}
      type="submit"
    >
      <Send className="size-4" aria-hidden="true" />
      {pending ? "Sending..." : "Send now"}
    </button>
  );
}
