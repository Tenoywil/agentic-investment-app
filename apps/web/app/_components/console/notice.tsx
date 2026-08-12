import { CircleAlert } from 'lucide-react';
import { errorText } from './lib';

/**
 * A failed fetch or a refused action, stated plainly. Distinct from
 * <EmptyState>: empty means the server answered and there is nothing there;
 * this means we do not know, and neither does the operator.
 */
export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return (
    <p className={`${errorText} ${className ?? ''}`} role="alert">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {message}
    </p>
  );
}
