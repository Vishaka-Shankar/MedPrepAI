import { Navigate, Route, Routes } from 'react-router-dom';
import { GuestOnlyRoute, ProtectedRoute, RequireRole } from './auth/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ChatPage } from './pages/ChatPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { QuizPage } from './pages/QuizPage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyOtpPage } from './pages/VerifyOtpPage';

export function App() {
  return (
    <Routes>
      {/* Only for logged-out users (after logging in they go to /chat, or the page they asked for) */}
      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* After a successful verify, GuestOnlyRoute sends the now logged-in user to /chat */}
        <Route path="/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Only for logged-in users, inside the sidebar layout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/quiz" element={<QuizPage />} />
          <Route
            path="/videos"
            element={<ComingSoonPage title="Videos" description="Short revision videos for your weak topics, picked from YouTube." />}
          />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/feedback"
            element={<ComingSoonPage title="Feedback" description="Tell us how MedPrep AI helps you (pilot study survey)." />}
          />
          <Route path="/profile" element={<ProfilePage />} />
          {/* Admins only; everyone else is sent to /chat */}
          <Route element={<RequireRole role="admin" />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
