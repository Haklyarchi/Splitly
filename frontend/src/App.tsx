import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import AuthPage from "@/pages/Auth";
import Groups from "@/pages/Groups";
import GroupDetail from "@/pages/GroupDetail";
import JoinGroup from "@/pages/Join";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<AppShell />}>
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/join/:token" element={<JoinGroup />} />
        </Route>
        <Route path="*" element={<Navigate to="/groups" replace />} />
      </Routes>
      <Toaster richColors />
    </>
  );
}
