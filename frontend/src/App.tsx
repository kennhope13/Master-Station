// ============================================================
// App.tsx — Cấu trúc routing chính của ứng dụng
// Sử dụng React Router v7, lazy loading từng trang để giảm bundle size
// Tất cả trang trừ /login đều yêu cầu đăng nhập (ProtectedRoute)
// ============================================================

import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import MultisitePage from '@/pages/multisite/MultisitePage';
import LiveCameraPopup from '@/pages/multisite/LiveCameraPopup';
import LiveWallPopup from '@/pages/multisite/LiveWallPopup';

// Lazy import — mỗi trang là một chunk riêng, tải khi cần
const DashboardPage = React.lazy(() => import('@/pages/dashboard/DashboardPage'));
const RealtimeMonitorPage = React.lazy(() => import('@/pages/realtime-monitor/RealtimeMonitorPage'));
const AlertsHistoryPage = React.lazy(() => import('@/pages/alerts-history/AlertsHistoryPage'));
const AlertDetailPage = React.lazy(() => import('@/pages/alert-detail/AlertDetailPage'));
const AnalyticsLayout = React.lazy(() => import('@/pages/analytics/AnalyticsLayout'));
const MaintenancePage = React.lazy(() => import('@/pages/maintenance/MaintenancePage'));
const AuditLogPage = React.lazy(() => import('@/pages/audit-log/AuditLogPage'));
const DeviceManagementPage = React.lazy(() => import('@/pages/device-management/DeviceManagementPage'));
const ThermalConfigPage = React.lazy(() => import('@/pages/device-management/ThermalConfigPage'));
const UserManagementPage = React.lazy(() => import('@/pages/user-management/UserManagementPage'));
const RuleEnginePage = React.lazy(() => import('@/pages/rule-engine/RuleEnginePage'));
const SettingsPage = React.lazy(() => import('@/pages/settings/SettingsPage'));
const LoginPage = React.lazy(() => import('@/pages/login/LoginPage'));
const LicensePage = React.lazy(() => import('@/pages/license/LicensePage'));

import { authService } from '@/services/AuthService';
import { isCentralDrillDown, isCentralUser } from '@/utils/centralAccess';

// Bảo vệ route và phân quyền theo vai trò
const ProtectedRoute = ({ children, roles, allowOnlyMulti, denyRestricted }: { children: React.ReactNode, roles?: string[], allowOnlyMulti?: boolean, denyRestricted?: boolean }) => {
  const user = authService.getUser();
  
  if (!user) {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const next = `${window.location.pathname}${window.location.search}`; 
    const loginUrl = token
      ? `/login?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`
      : `/login?next=${encodeURIComponent(next)}`;
    return <Navigate to={loginUrl} replace />;
  }
  
  const isCentral = isCentralUser(user);
  const isCentralInDrillDown = isCentralDrillDown(user);

  if (allowOnlyMulti && !isCentral) {
    // Nếu trang chỉ dành cho đa trạm nhưng user không phải 'multi' hoặc global admin, đưa về Dashboard
    return <Navigate to="/dashboard" replace />;
  }

  if (denyRestricted && user.is_restricted && !isCentralInDrillDown) {
    // Nếu trang cấm restricted admin (admin trạm con), đưa về Dashboard
    return <Navigate to="/dashboard" replace />;
  }
  
  const hasRole = !roles || roles.includes(user.role) || (isCentral && roles.includes('admin'));
  if (!hasRole) {
    // Nếu user không có quyền truy cập trang này, đưa về Dashboard
    return <Navigate to="/dashboard" replace />;
  }
  
  return <>{children}</>;
};

const IndexRedirect = () => {
  const user = authService.getUser();
  if (!user) return <Navigate to="/multisite" replace />;
  if (isCentralUser(user)) return <Navigate to="/multisite" replace />;
  return <Navigate to="/dashboard" replace />;
};

const ScreenLoader = () => {
  const bg = '#f1f5f9';
  const text = '#0f172a';
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: bg,
      color: text,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--admin-font-mono)',
      fontSize: '14px',
      fontWeight: 'bold',
      zIndex: 9999
    }}>
      Loading...
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      {/* Suspense hiển thị fallback trong khi chunk JS đang tải */}
      <Suspense fallback={<ScreenLoader />}>
        <Routes>
          {/* Trang đăng nhập — không cần xác thực */}
          <Route path="/login" element={<LoginPage />} />

          {/* Trạm tổng — không cần đăng nhập, tự auto-login */}
          <Route path="/multisite" element={<MultisitePage />} />
          <Route path="/live-camera" element={<LiveCameraPopup />} />
          <Route path="/live-wall" element={<LiveWallPopup />} />

          {/* AppShell bọc toàn bộ layout (sidebar + header + content) */}
          <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route index element={<IndexRedirect />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="realtime" element={<RealtimeMonitorPage />} />
            <Route path="alerts-history" element={<AlertsHistoryPage />} />
            <Route path="alert-detail" element={<AlertDetailPage />} />

            {/* Analytics — internal tabs, no nested routes */}
            <Route path="analytics" element={<AnalyticsLayout />} />

            <Route path="maintenance" element={<ProtectedRoute roles={['admin', 'manager']}><MaintenancePage /></ProtectedRoute>} />
            <Route path="audit-log" element={<ProtectedRoute roles={['admin']}><AuditLogPage /></ProtectedRoute>} />
              <Route path="device-management" element={<ProtectedRoute roles={['admin', 'admin_province', 'admin_station']}><DeviceManagementPage /></ProtectedRoute>} />
            <Route path="device-management/:deviceId/thermal-config" element={<ProtectedRoute roles={['admin', 'admin_province', 'admin_station']}><ThermalConfigPage /></ProtectedRoute>} />
            <Route path="user-management" element={<ProtectedRoute roles={['admin', 'admin_province', 'admin_station']}><UserManagementPage /></ProtectedRoute>} />
            <Route path="rule-engine" element={<ProtectedRoute roles={['admin', 'admin_province', 'admin_station']}><RuleEnginePage /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute roles={['admin']} denyRestricted><SettingsPage /></ProtectedRoute>} />
            <Route path="license" element={<ProtectedRoute roles={['admin', 'admin_province', 'admin_station']}><LicensePage /></ProtectedRoute>} />
            <Route path="*" element={<div style={{color:'var(--admin-text)', padding:20}}>404 - Page not found</div>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
