export default function EvalLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 p-6">
      <div className="bg-muted/40 h-10 w-96 rounded" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-border/40 bg-card/40 h-28 rounded-lg border" />
        ))}
      </div>
      <div className="border-border/40 bg-card/40 h-96 rounded-lg border" />
    </div>
  );
}
