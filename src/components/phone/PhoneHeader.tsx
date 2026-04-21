interface PhoneHeaderProps {
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
}

export function PhoneHeader({ brand, model, tagline }: PhoneHeaderProps) {
  return (
    <header className="border-border/80 bg-muted/25 border-b px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">{brand}</p>
        <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {model}
        </h1>
        {tagline ? (
          <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-relaxed">
            {tagline}
          </p>
        ) : null}
      </div>
    </header>
  );
}
