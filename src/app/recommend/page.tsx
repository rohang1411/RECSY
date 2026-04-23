import { RecommendClient } from './recommend-client';

export const dynamic = 'force-dynamic';

export default function RecommendPage() {
  return (
    <div className="pb-16">
      <header className="border-border/80 bg-muted/25 border-b px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">Find my phone</h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-base leading-relaxed">
            Describe what you need in plain English. RECSY extracts structured preferences, matches
            our review-backed aspect scores, and suggests up to three diverse picks.
          </p>
        </div>
      </header>
      <RecommendClient />
    </div>
  );
}
