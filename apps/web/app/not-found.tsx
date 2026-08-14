import Link from 'next/link';

/**
 * A URL that is not a screen.
 *
 * There was no not-found route at all, so a mistyped or stale link produced
 * Next's unstyled default — a bare "404 | This page could not be found" on a
 * white page, with none of the product's chrome and no way onward except the
 * back button. On a phone that reads as the app having crashed.
 *
 * A server component with no session lookup, deliberately: this renders for
 * signed-out visitors and signed-in users alike, and the one thing it must not
 * do is fail while explaining that something else failed. The link goes to the
 * root rather than to /home, which redirects an operator or an administrator
 * back off the customer surface anyway.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 font-sans text-foreground">
      <div className="max-w-[420px] text-center">
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-[14px] bg-primary font-display text-xl font-bold text-white">
          C
        </span>
        <h1 className="font-display text-[23px] font-bold tracking-tight">
          This page does not exist
        </h1>
        <p className="mx-auto mt-2.5 text-[15px] leading-relaxed text-dim">
          The address may have changed, or the link that brought you here may be out of date.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-[11px] bg-primary px-5 py-3 text-[15px] font-bold text-white no-underline"
        >
          Back to Caribbean Capital
        </Link>
      </div>
    </main>
  );
}
