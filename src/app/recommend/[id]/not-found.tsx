import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function SessionNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <div className="border-outline-variant bg-card/40 rounded-xl border p-8 shadow-sm">
        <p className="meta-label text-muted-foreground mb-3">Conversation</p>
        <h2 className="text-foreground text-2xl font-bold tracking-tight">
          Conversation not found or no longer available
        </h2>
        <p className="text-muted-foreground mt-3 text-sm">
          This recommendation session may have been deleted, belonged to a different account, or
          expired.
        </p>
        <div className="mt-8">
          <Link
            href="/recommend"
            className="border-primary bg-primary/10 text-primary hover:bg-primary inline-flex items-center gap-2 border px-6 py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Start a new recommendation
          </Link>
        </div>
      </div>
    </div>
  );
}
