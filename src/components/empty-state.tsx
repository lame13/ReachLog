export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">
      {label}
    </div>
  );
}
