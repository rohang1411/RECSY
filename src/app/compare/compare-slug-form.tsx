/**
 * Native GET form → `/compare?a=…&b=…` so the compare page works when opened
 * directly (no hand-editing of the query string).
 */
export function CompareSlugForm({
  defaultA = '',
  defaultB = '',
}: {
  readonly defaultA?: string;
  readonly defaultB?: string;
}) {
  return (
    <form action="/compare" method="get" className="mt-6 max-w-md space-y-4">
      <div>
        <label htmlFor="compare-a" className="text-foreground mb-1 block text-sm font-medium">
          First phone (slug)
        </label>
        <input
          id="compare-a"
          name="a"
          type="text"
          required
          defaultValue={defaultA}
          placeholder="e.g. google-pixel-9-pro-xl"
          autoComplete="off"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
      </div>
      <div>
        <label htmlFor="compare-b" className="text-foreground mb-1 block text-sm font-medium">
          Second phone (slug)
        </label>
        <input
          id="compare-b"
          name="b"
          type="text"
          required
          defaultValue={defaultB}
          placeholder="e.g. samsung-galaxy-s24-ultra"
          autoComplete="off"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
      </div>
      <button
        type="submit"
        className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring rounded-md px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Compare
      </button>
    </form>
  );
}
