import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <main className="min-h-svh bg-canvas text-ink">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
        <p className="text-sm font-medium tracking-wide text-muted uppercase">picasso template</p>
        <h1 className="text-4xl font-semibold tracking-tight">Fenced from the first render.</h1>
        <p className="text-lg leading-relaxed text-muted">
          Every gate is wired: token lint, typecheck, budgets, the console ratchet,
          and the a11y baseline. Ship changes, not regressions.
        </p>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="md">Get started</Button>
          <Button variant="outline" size="md">View components</Button>
        </div>
      </div>
    </main>
  );
}
