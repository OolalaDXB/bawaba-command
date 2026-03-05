import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 ml-1 text-[9px] text-muted-foreground border border-border rounded-full cursor-help hover:text-foreground hover:border-foreground/30 transition-colors align-middle">
            i
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[260px] text-[11px] leading-relaxed font-body"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
