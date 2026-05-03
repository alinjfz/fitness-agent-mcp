import { Layout } from "@/components/layout";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-context";
import NotFound from "@/pages/not-found";
import Overview from "@/pages/overview";
import History from "@/pages/history";
import Import from "@/pages/import";
import Achievements from "@/pages/achievements";
import Export from "@/pages/export";
import Plan from "@/pages/plan";
import GeneratePlan from "@/pages/generate-plan";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/history" component={History} />
      <Route path="/import" component={Import} />
      <Route path="/achievements" component={Achievements} />
      <Route path="/export" component={Export} />
      <Route path="/plan" component={Plan} />
      <Route path="/generate-plan" component={GeneratePlan} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Layout>
              <Router />
            </Layout>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
