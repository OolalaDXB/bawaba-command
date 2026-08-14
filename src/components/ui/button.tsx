import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Stripe-grade buttons: fixed 6px radius (independent of the theme's sharp
   --radius, which zeroes rounded-md), soft elevation + inset top highlight on
   filled variants, hairline border + faint shadow on quiet variants. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] text-[13px] font-medium tracking-[-0.01em] ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.14),inset_0_1px_0_rgba(255,255,255,0.14)] hover:brightness-[1.06] active:brightness-95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(16,24,40,0.14),inset_0_1px_0_rgba(255,255,255,0.12)] hover:brightness-[1.06] active:brightness-95",
        outline:
          "border border-border bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-muted active:bg-muted/80",
        secondary:
          "bg-secondary text-secondary-foreground border border-border/60 shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-secondary/70",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
