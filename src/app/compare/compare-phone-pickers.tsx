/**
 * Server-rendered form: two dropdowns of active catalog slugs, GET
 * → `/compare?a=…&b=…` (same contract as the slug text form).
 */
export function ComparePhonePickers({
  options,
  defaultA = '',
  defaultB = '',
}: {
  readonly options: readonly { readonly slug: string; readonly label: string }[];
  readonly defaultA?: string;
  readonly defaultB?: string;
}) {
  return (
    <form action="/compare" method="get" className="mt-8 max-w-md space-y-4">
      <p className="text-foreground text-sm font-medium">Choose from the catalog</p>
      <div>
        <label htmlFor="compare-pick-a" className="text-foreground mb-1 block text-sm">
          First phone
        </label>
        <select
          id="compare-pick-a"
          name="a"
          required
          defaultValue={defaultA}
          className="border-input bg-background ring-offset-background text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <option value="" disabled>
            Select a phone…
          </option>
          {options.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="compare-pick-b" className="text-foreground mb-1 block text-sm">
          Second phone
        </label>
        <select
          id="compare-pick-b"
          name="b"
          required
          defaultValue={defaultB}
          className="border-input bg-background ring-offset-background text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <option value="" disabled>
            Select a phone…
          </option>
          {options.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.label}
            </option>
          ))}
        </select>
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
