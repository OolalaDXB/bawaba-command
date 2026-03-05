import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import Dashboard from "./pages/Index";
import Agents from "./pages/Agents";
import Policy from "./pages/Policy";
import AuditTrail from "./pages/AuditTrail";
import PiiTokenizer from "./pages/PiiTokenizer";
import SovereignRouting from "./pages/SovereignRouting";
import Settings from "./pages/Settings";
import ArchitectureExplorer from "./pages/ArchitectureExplorer";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/policy" element={<Policy />} />
            <Route path="/audit" element={<AuditTrail />} />
            <Route path="/pii" element={<PiiTokenizer />} />
            <Route path="/routing" element={<SovereignRouting />} />
            <Route path="/architecture" element={<ArchitectureExplorer />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
