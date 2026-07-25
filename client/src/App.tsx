import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { OfflineModeProvider } from "./contexts/OfflineModeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import Measure from "./pages/Measure";
import History from "./pages/History";
import HistoryDetail from "./pages/HistoryDetail";
import Login from "./pages/Login";
import { DashboardLayoutSkeleton } from "./components/DashboardLayoutSkeleton";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return <DashboardLayoutSkeleton />;
  if (!isLoggedIn) return <Login />;
  return <>{children}</>;
}

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
        <AuthProvider>
          <OfflineModeProvider>
            <TooltipProvider>
              <Toaster />
              <AuthGuard>
                <Router />
              </AuthGuard>
            </TooltipProvider>
          </OfflineModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
