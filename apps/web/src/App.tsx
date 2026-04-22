import { Link, Outlet } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <BarChart3 className="h-5 w-5 text-primary" />
            <span>OSS Report</span>
          </Link>
          <div className="text-xs text-muted-foreground">mastra-ai/mastra</div>
        </div>
      </header>
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
