import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  replied: "border-emerald-200 bg-emerald-50 text-emerald-800",
  waiting: "border-sky-200 bg-sky-50 text-sky-800",
  sent: "border-sky-200 bg-sky-50 text-sky-800",
  new: "border-gray-200 bg-white text-gray-700",
  "form submitted": "border-violet-200 bg-violet-50 text-violet-800",
  "follow-up due": "border-amber-200 bg-amber-50 text-amber-800",
  open: "border-amber-200 bg-amber-50 text-amber-800",
  overdue: "border-rose-200 bg-rose-50 text-rose-800",
  cancelled: "border-gray-200 bg-gray-50 text-gray-600",
  completed: "border-gray-200 bg-gray-50 text-gray-600",
  dead: "border-gray-300 bg-gray-100 text-gray-700",
  "do not resend": "border-rose-200 bg-rose-50 text-rose-800"
};

export function StatusPill({
  status,
  className
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium capitalize",
        variants[status] ?? "border-line bg-white text-muted",
        className
      )}
    >
      {status}
    </span>
  );
}
