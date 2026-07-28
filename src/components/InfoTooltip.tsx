import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center w-4 h-4 ml-1.5 text-[10px] font-bold bg-muted/80 text-muted-foreground border border-border/80 rounded-full cursor-help hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all duration-150 align-middle select-none shrink-0">
          ?
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="font-body">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
