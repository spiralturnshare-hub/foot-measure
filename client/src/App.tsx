import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { OfflineModeProvider } from "./contexts/OfflineModeContext";
import Home from "./pages/Home";
import Measure from "./pages/Measure";
import History from "./pages/History";
import HistoryDetail from "./pages/HistoryDetail";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/measure" component={Measure} />
      <Route path="/history" component={History} />
      <Route path="/history/:id" component={HistoryDetail} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <OfflineModeProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </OfflineModeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
