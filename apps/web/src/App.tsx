import { Link, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">
              OSS Report
            </span>
          </Link>
          <span className="mono text-xs text-muted-foreground">
            mastra-ai/mastra
          </span>
        </div>
      </header>
      <main className="container py-10">
        <Outlet />
      </main>
    </div>
  );
}
