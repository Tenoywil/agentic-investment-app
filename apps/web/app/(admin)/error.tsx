'use client';

import { ErrorScreen } from '@/app/_components/ui/error-screen';

/** Catches a render throw anywhere under the admin console. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} surface="admin" />;
}
