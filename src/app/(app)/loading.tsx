export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-line/70" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-line/50" />
      <div className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm">
        <div className="h-10 w-full animate-pulse rounded-md bg-panel" />
        <div className="h-10 w-full animate-pulse rounded-md bg-panel" />
        <div className="h-10 w-full animate-pulse rounded-md bg-panel" />
        <div className="h-10 w-2/3 animate-pulse rounded-md bg-panel" />
      </div>
    </div>
  );
}
