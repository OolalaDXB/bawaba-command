import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding, avoidCollisions = true, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    avoidCollisions={avoidCollisions}
    // Smart flip: keep tooltips inside the viewport and clear of the sticky
    // header + demo banner at the top, so they never render over the chrome.
    collisionPadding={collisionPadding ?? { top: 88, right: 12, bottom: 12, left: 12 }}
    className={cn(
      // House style: ink surface, cream text, 2px corners.
      "z-[200] max-w-[300px] overflow-hidden rounded-[2px] border border-black/20 bg-[#1C1917] px-3 py-1.5 text-[11.5px] leading-relaxed text-[#F2EBDD] shadow-lg animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
