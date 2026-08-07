import { cn } from '@/app/_lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-bold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-mint text-teal2',
        success:
          'border-transparent bg-[#e2f4ea] text-[#0a6e44] dark:bg-[#12352a] dark:text-[#5fce9e]',
        warning:
          'border-transparent bg-[#f6efdf] text-[#7a5712] dark:bg-[#38301a] dark:text-[#e2bd6b]',
        terra:
          'border-transparent bg-[#f5e7d9] text-[#a44e20] dark:bg-[#3a281c] dark:text-[#e79b6f]',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
