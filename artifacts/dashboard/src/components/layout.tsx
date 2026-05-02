import { Link, useLocation } from "wouter";
import { Activity, Award, Calendar, Download, Home, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/plan", label: "Plan", icon: Calendar },
  { href: "/history", label: "History", icon: Activity },
  { href: "/achievements", label: "Achievements", icon: Award },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/export", label: "Export", icon: Download },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card flex-shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <h1 className="text-xl font-bold tracking-tight text-foreground uppercase">
            Fitness<span className="text-primary">Dash</span>
          </h1>
        </div>
        <nav className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
