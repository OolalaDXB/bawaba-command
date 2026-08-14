import { Link } from 'react-router-dom';

/**
 * Entry chooser (demo mandate §3): two ways into the same console. The
 * Guided Demo is NOT a dumbed-down view — it is a narrated path over the
 * same real engine, events and evidence.
 */
export default function Chooser() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="mb-2 font-heading text-4xl text-foreground tracking-wide">BAWABA</div>
      <div className="mb-1 text-sm text-ink-3">Control and evidence plane for AI gateways and enterprise AI agents</div>
      <div className="mb-10 text-xs font-mono uppercase tracking-widest text-ink-3">
        Demonstration environment · real engine, real signatures · no customer data
      </div>

      <h1 className="mb-8 text-lg text-foreground">How would you like to explore BAWABA?</h1>

      <div className="grid gap-6 md:grid-cols-2 w-full max-w-3xl">
        <Link
          to="/demo"
          className="group border border-border bg-card p-8 rounded-[6px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-primary transition-colors"
        >
          <div className="text-base font-medium text-foreground mb-2">Guided Demo</div>
          <div className="text-sm text-ink-3 leading-relaxed">
            Understand BAWABA in 3 minutes. Follow a real agent decision from request to verifiable
            evidence — then change the policy yourself and watch the decision flip.
          </div>
          <div className="mt-4 text-xs font-mono text-primary">Start the guided path →</div>
        </Link>

        <Link
          to="/dashboard"
          className="group border border-border bg-card p-8 rounded-[6px] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-primary transition-colors"
        >
          <div className="text-base font-medium text-foreground mb-2">Control Room</div>
          <div className="text-sm text-ink-3 leading-relaxed">
            Explore the full control and evidence plane. Agents, policies, events, jurisdictions and
            audit evidence directly.
          </div>
          <div className="mt-4 text-xs font-mono text-primary">Open the console →</div>
        </Link>
      </div>
    </div>
  );
}
