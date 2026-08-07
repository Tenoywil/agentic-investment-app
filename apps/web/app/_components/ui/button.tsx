import { cn } from '@/app/_lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-bold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-card text-foreground hover:bg-mint hover:text-teal2',
        secondary: 'bg-mint text-teal2 hover:bg-mint/80',
        ghost: 'hover:bg-mint hover:text-teal2',
        link: 'text-teal2 underline-offset-4 hover:underline',
        peach: 'bg-peach text-[#3a2415] hover:bg-peach/90',
      },
      size: {
        default: 'h-11 px-5 py-2.5 text-[15px]',
        sm: 'h-9 rounded-md px-3.5 text-sm',
        lg: 'h-12 rounded-md px-6 text-base',
        icon: 'h-10 w-10',
        pill: 'h-11 rounded-full px-5 text-[15px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
