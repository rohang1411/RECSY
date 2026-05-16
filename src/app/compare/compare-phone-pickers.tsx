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
    <form action="/compare" method="get" className="border-outline-variant mt-8 max-w-xl border">
      <p className="meta-label border-outline-variant text-primary border-b p-4">Choose phones</p>
      <div className="bg-outline-variant grid gap-px">
        <div className="bg-background p-4">
          <label htmlFor="compare-pick-a" className="meta-label text-primary">
            First phone
          </label>
          <select
            id="compare-pick-a"
            name="a"
            required
            defaultValue={defaultA}
            className="border-outline bg-background text-primary focus-visible:border-primary mt-3 w-full border px-3 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
          >
            <option value="" disabled>
              Select a phone
            </option>
            {options.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-background p-4">
          <label htmlFor="compare-pick-b" className="meta-label text-primary">
            Second phone
          </label>
          <select
            id="compare-pick-b"
            name="b"
            required
            defaultValue={defaultB}
            className="border-outline bg-background text-primary focus-visible:border-primary mt-3 w-full border px-3 py-3 font-mono text-sm focus-visible:ring-0 focus-visible:outline-none"
          >
            <option value="" disabled>
              Select a phone
            </option>
            {options.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-background p-4">
          <button
            type="submit"
            className="border-outline text-primary hover:bg-primary hover:text-background focus-visible:bg-primary focus-visible:text-background border px-5 py-3 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none"
          >
            Compare
          </button>
        </div>
      </div>
    </form>
  );
}
