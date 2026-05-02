import { Link, useLocation } from "wouter";
import { Activity, Award, Calendar, Download, Home, Upload, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTheme } from "@/lib/theme-context";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside
        className={cn(
          "border-r border-border bg-card flex-shrink-0 flex flex-col transition-all duration-200",
          collapsed ? "md:w-16" : "md:w-64",
          "w-full md:min-h-screen"
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
          {!collapsed && (
            <h1 className="text-xl font-bold tracking-tight text-foreground uppercase">
              Fitness<span className="text-primary">Dash</span>
            </h1>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("ml-auto shrink-0", collapsed && "mx-auto")}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        <nav className="p-2 space-y-1 flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center" : "",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return link;
          })}
        </nav>

        <div className={cn("p-2 border-t border-border", collapsed ? "flex justify-center" : "flex justify-end px-4")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "top"}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
