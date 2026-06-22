import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStationStore, useAlertStore, useDeviceStore, useAuthStore } from '@/store';
import type { Station, AlertItem, ReportItem, AuditLogEntry, LoginLogEntry, NotifyLogEntry, RuleTriggerLogEntry, Province, MaintenanceTask, Team } from '@/types/api.types';
import type { StationView, StationLocation, StationKpi } from './types';
import { ALERT_STATUS, DEVICE_STATUS } from '@/types/enums';
import {
  Search, Map as MapIcon, AlertTriangle,
  X, ShieldCheck, Wifi,
  ChevronLeft, ChevronRight, ChevronDown, Plus, LogIn, LogOut, FileText, FileArchive, Users, LineChart, Radio, Video, Settings,
  ArrowLeft, Key,
  Download, RefreshCw, Calendar, Clock, Loader2, Filter, Bell, Zap
} from 'lucide-react';
import { stationApi } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { fmtDateTime } from '@/utils/format';
import { createRealtimeHub } from '@/services/realtime.service';
import { showToast } from '@/utils/toast';

const CentralAnalyticsLayout = lazy(() => import('@/pages/analytics/CentralAnalyticsLayout'));
const DeviceManagementPage = lazy(() => import('@/pages/device-management/DeviceManagementPage'));
const CentralDeviceView = lazy(() => import('@/pages/multisite/CentralDeviceView'));
const LiveStationPicker = lazy(() => import('@/pages/multisite/LiveStationPicker'));
const UserManagementPage = lazy(() => import('@/pages/user-management/UserManagementPage'));

type MultisiteTab = 'overview' | 'analytics' | 'devices' | 'truc_tiep' | 'alerts_history' | 'maintenance' | 'audit_log' | 'reports' | 'users';

const MULTISITE_TAB_TITLES: Record<MultisiteTab, string> = {
  overview: 'TỔNG QUAN',
  truc_tiep: 'TRỰC TIẾP',
  analytics: 'PHÂN TÍCH',
  devices: 'THIẾT BỊ',
  alerts_history: 'LỊCH SỬ CẢNH BÁO',
  maintenance: 'BẢO TRÌ',
  audit_log: 'NHẬT KÝ',
  reports: 'BÁO CÁO',
  users: 'NGƯỜI DÙNG',
};

function InlineDarkDropdown({
  value,
  options,
  onChange,
  minWidth = 180,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = options.find(option => option.value === value)?.label || options[0]?.label || '';

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        style={{
          height: 28,
          minWidth,
          padding: '0 8px',
          borderRadius: 3,
          border: '1px solid var(--admin-border)',
          background: 'var(--admin-layer-2)',
          color: 'var(--admin-text)',
          fontSize: '.62rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeLabel}</span>
        <span style={{ color: 'var(--admin-text-muted)' }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: '100%',
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,.45)',
            zIndex: 1000,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: active ? 'var(--admin-layer-3)' : 'transparent',
                  color: active ? 'var(--admin-accent)' : 'var(--admin-text)',
                  textAlign: 'left',
                  fontSize: '.62rem',
                  fontWeight: active ? 700 : 600,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}



function parseLocation(raw?: any): StationLocation {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function extractProvinceName(location?: StationLocation): string {
  const rawAddress = (location?.address || '').trim();
  if (!rawAddress) return 'Chưa phân tỉnh';

  const segments = rawAddress
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (segments.length === 0) return 'Chưa phân tỉnh';

  const preferred = [...segments].reverse().find(part =>
    /^(Tỉnh|Thành phố|TP\.?|TP )/i.test(part)
  );

  return preferred || segments[segments.length - 1] || 'Chưa phân tỉnh';
}

function compactStationTitle(name?: string): string {
  if (!name) return '';
  return name.replace(/^trạm biến áp\s*/i, 'TBA ');
}

function normalizeProvinceToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^tỉnh\s+/i, '')
    .replace(/^thành phố\s+/i, '')
    .replace(/^tp\.\s*/i, '')
    .replace(/^tp\s+/i, '')
    .trim();
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).toUpperCase();
}

function buildCalendarDays(month: Date): Array<Date | null> {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const days: Array<Date | null> = [];
  const leading = (firstDay.getDay() + 6) % 7;

  for (let i = 0; i < leading; i++) days.push(null);
  for (let day = 1; day <= lastDay.getDate(); day++) days.push(new Date(year, monthIndex, day));
  while (days.length % 7 !== 0) days.push(null);

  return days;
}

const PROVINCE_CHIP_ICON = `
  <svg viewBox="0 0 64 64" width="24" height="24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="16" y="16" width="32" height="32" rx="6"></rect>
    <path d="M24 10h16a8 8 0 0 1 8 8v4"></path>
    <path d="M24 54h16a8 8 0 0 0 8-8v-4"></path>
    <path d="M10 24v16a8 8 0 0 0 8 8h4"></path>
    <path d="M54 24v16a8 8 0 0 1-8 8h-4"></path>
    <path d="M24 26h16"></path>
    <path d="M24 32h16"></path>
    <path d="M24 38h16"></path>
    <path d="M8 22h8"></path>
    <path d="M8 32h8"></path>
    <path d="M8 42h8"></path>
    <path d="M48 22h8"></path>
    <path d="M48 32h8"></path>
    <path d="M48 42h8"></path>
  </svg>
`;

const STATION_TOWER_ICON = `
  <svg viewBox="0 0 64 64" width="22" height="22" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M24 8h16l8 6H16z"></path>
    <path d="M12 16h40"></path>
    <path d="M18 16v10"></path>
    <path d="M46 16v10"></path>
    <path d="M12 34h40"></path>
    <path d="M18 34v8"></path>
    <path d="M46 34v8"></path>
    <path d="M28 16l-8 40"></path>
    <path d="M36 16l8 40"></path>
    <path d="M20 56l12-8 12 8"></path>
    <path d="M24 46l8-6 8 6"></path>
    <path d="M26 36l6-5 6 5"></path>
    <path d="M27 26l5-4 5 4"></path>
  </svg>
`;

const ROLE_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  admin:             { label: 'ADMIN',          color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  admin_province:    { label: 'ADMIN TỈNH',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  operator_province: { label: 'OPERATOR TỈNH',  color: '#0d9488', bg: 'rgba(13,148,136,0.1)' },
  team_leader:       { label: 'TỔ TRƯỞNG',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  team_member:       { label: 'NHÂN VIÊN TỔ',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  admin_station:     { label: 'ADMIN TRẠM',     color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
  manager:           { label: 'MANAGER',        color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  operator:          { label: 'OPERATOR',       color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
};

export default function MultisitePage() {
  const navigate = useNavigate();
  const currentUser = authService.getUser();
  const _roleFallback = { label: 'USER', color: 'var(--admin-accent)', bg: 'rgba(0,0,0,0)' };
  const currentRoleCfg = (currentUser?.role ? (ROLE_DISPLAY[currentUser.role] ?? _roleFallback) : _roleFallback);
  const isProvinceAdmin = currentUser?.role === 'admin_province';
  const callerProvinceIds = currentUser?.province_ids || [];
  const location = useLocation();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markerMapRef = useRef<Record<string, any>>({});
  const overviewFittedRef = useRef(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('station-theme') || 'blue');
  const [mapHostKey, setMapHostKey] = useState(0);
  const [mapReadyTick, setMapReadyTick] = useState(0);

  // Apply theme + full-screen layout (normally done by AppShell)
  useEffect(() => {
    const saved = localStorage.getItem('station-theme') || 'industrial';
    document.documentElement.dataset.theme = saved;
    const toRemove = Array.from(document.documentElement.classList).filter(c => c.startsWith('theme-'));
    toRemove.forEach(c => document.documentElement.classList.remove(c));
    document.documentElement.classList.add(`theme-${saved}`);

    // Full-screen body needed when rendered outside AppShell
    const prev = { htmlH: document.documentElement.style.height, bodyH: document.body.style.height, bodyOv: document.body.style.overflow, bodyBg: document.body.style.background };
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#1a1c1e';
    return () => {
      document.documentElement.style.height = prev.htmlH;
      document.body.style.height = prev.bodyH;
      document.body.style.overflow = prev.bodyOv;
      document.body.style.background = prev.bodyBg;
    };
  }, []);

  // Check if Leaflet is loaded from CDN
  useEffect(() => {
    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }
    const interval = setInterval(() => {
      if ((window as any).L) {
        setLeafletLoaded(true);
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as MultisiteTab) || 'overview';
  const stationIdFromQuery = searchParams.get('stationId');

  const setActiveTab = (tab: MultisiteTab) => {
    setSearchParams(prev => {
      prev.set('tab', tab);
      return prev;
    }, { replace: true });
  };

  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [devicePanelAction, setDevicePanelAction] = useState<'new' | null>(null);
  const [devicesSubTab, setDevicesSubTab] = useState<'overview' | 'manage'>('overview');
  const showEmbeddedBackButton = activeTab !== 'overview' && !!selectedStationId;

  const activateTab = (
    tab: MultisiteTab,
    options?: {
      preserveStation?: boolean;
      deviceAction?: 'new' | null;
    }
  ) => {
    setActiveTab(tab);
    setDevicePanelAction(options?.deviceAction ?? null);
    if (!options?.preserveStation) {
      setSelectedStationId(null);
      setViewingStation(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'overview') {
      setMapHostKey(k => k + 1);
      setShowLeftPanel(false);
      setShowRightPanel(false);
      setSelectedStationId(null);
      setSelectedProvince(null);
    }
  }, [activeTab, location.key]);

  useEffect(() => {
    if (!stationIdFromQuery) return;
    setSelectedStationId(stationIdFromQuery);
    if (activeTab === 'overview') {
      setShowRightPanel(true);
    }
    if (activeTab === 'devices') {
      setDevicesSubTab('overview');
    }
  }, [activeTab, stationIdFromQuery]);

  useEffect(() => {
    overviewFittedRef.current = false;
  }, [selectedProvince]);

  // States for creating a new station
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [newStationCode, setNewStationCode] = useState('');
  const [newStationLat, setNewStationLat] = useState('');
  const [newStationLng, setNewStationLng] = useState('');
  const [newStationAddress, setNewStationAddress] = useState('');
  const [newStationApiUrl, setNewStationApiUrl] = useState('');
  const [newStationWebUrl, setNewStationWebUrl] = useState('');
  const [newStationApiPassword, setNewStationApiPassword] = useState('');
  const [newStationProvinceId, setNewStationProvinceId] = useState('');
  const [connStatus, setConnStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [connMs, setConnMs] = useState<number | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'searching' | 'found' | 'notfound'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpeningStation, setIsOpeningStation] = useState(false);
  const [editingStation, setEditingStation] = useState<import('@/types/api.types').Station | null>(null);
  const [editWebUrl, setEditWebUrl] = useState('');
  const [editApiPassword, setEditApiPassword] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [remoteKpis, setRemoteKpis] = useState<Record<string, { devicesOnline: number; devicesTotal: number; alertsCount: number }>>({});
  const [isAuthReady, setIsAuthReady] = useState(() => !!authService.getToken());
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [userDropdownPos, setUserDropdownPos] = useState({ top: 0, left: 0 });
  const userMenuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    };
    if (showUserDropdown) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showUserDropdown]);
  const token = useAuthStore(s => s.token);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const visibleProvinces = useMemo(() => {
    if (!isProvinceAdmin || callerProvinceIds.length === 0) return provinces;
    const allowed = new Set(callerProvinceIds.map(id => id.toLowerCase()));
    return provinces.filter(p => allowed.has(p.id.toLowerCase()));
  }, [callerProvinceIds, isProvinceAdmin, provinces]);

  const openAddStationModal = () => {
    if (isProvinceAdmin && visibleProvinces.length > 0) {
      setNewStationProvinceId(visibleProvinces[0]!.id);
    }
    setIsAddModalOpen(true);
  };

  useEffect(() => {
    stationApi.getProvinces().then(setProvinces).catch(() => {});
    stationApi.getTeams().then(setTeams).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!isAddModalOpen) return;
    if (!newStationProvinceId && visibleProvinces.length === 1) {
      setNewStationProvinceId(visibleProvinces[0]!.id);
    }
  }, [isAddModalOpen, newStationProvinceId, visibleProvinces]);
  const stationStatusRef = useRef<Record<string, string>>({});
  const stationNameRef = useRef<Record<string, string>>({});
  const kpiRefreshAtRef = useRef<Record<string, number>>({});

  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);
  const setViewingStation = useStationStore(s => s.setViewingStation);
  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const fetchDevices = useDeviceStore(s => s.fetch);

  // Auto-login as multi if no token, then fetch data
  useEffect(() => {
    const init = async () => {
      if (!authService.getToken()) {
        try { await authService.login('multi', 'Demo@2024'); } catch { /* ignore */ }
      }
      setIsAuthReady(true);
      try { fetchStations(); } catch { /* ignore */ }
      try { fetchAlerts(ALERT_STATUS.OPEN); } catch { /* ignore */ }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch devices of all stations
  useEffect(() => {
    stations.forEach(s => fetchDevices(s.id));
  }, [stations, fetchDevices]);

  useEffect(() => {
    stationStatusRef.current = Object.fromEntries(
      stations.map(s => [s.id, s.connectionStatus || 'unknown'])
    );
    stationNameRef.current = Object.fromEntries(
      stations.map(s => [s.id, s.name])
    );
  }, [stations]);

  // Fetch remote KPIs từ trạm con có apiUrl
  useEffect(() => {
    const stationsWithUrl = stations.filter(s => s.apiUrl);
    if (stationsWithUrl.length === 0) return;
    stationsWithUrl.forEach(s => {
      stationApi.getRemoteKpi(s.id)
        .then(kpi => setRemoteKpis(prev => ({ ...prev, [s.id]: kpi })))
        .catch(() => {});
    });
  }, [stations]);

  useEffect(() => {
    if (!isAuthReady) return;

    const hub = createRealtimeHub();

    const refreshRemoteKpi = (stationId: string, force = false) => {
      const now = Date.now();
      const last = kpiRefreshAtRef.current[stationId] || 0;
      if (!force && now - last < 5000) return;
      kpiRefreshAtRef.current[stationId] = now;

      stationApi.getRemoteKpi(stationId)
        .then(kpi => setRemoteKpis(prev => ({ ...prev, [stationId]: kpi })))
        .catch(() => {});
    };

    hub.on('StationStatusChanged', (payload: any) => {
      if (!payload?.stationId || !payload?.status) return;

      const stationId = String(payload.stationId);
      const nextStatus = String(payload.status);
      const previousStatus = stationStatusRef.current[stationId];
      stationStatusRef.current[stationId] = nextStatus;

      useStationStore.setState(state => ({
        stations: state.stations.map(station => station.id === stationId
          ? { ...station, connectionStatus: nextStatus, lastSeenAt: payload.lastSeenAt || station.lastSeenAt }
          : station)
      }));

      if ((previousStatus === 'online' || previousStatus === 'offline') && previousStatus !== nextStatus) {
        const stationName = stationNameRef.current[stationId] || 'Trạm con';
        if (nextStatus === 'offline') {
          setRemoteKpis(prev => ({
            ...prev,
            [stationId]: {
              ...(prev[stationId] || { devicesOnline: 0, devicesTotal: 0, alertsCount: 0 }),
              devicesOnline: 0
            }
          }));
          showToast(`${stationName} mất kết nối`, 'error');
        } else if (nextStatus === 'online') {
          showToast(`${stationName} kết nối lại`, 'success');
          refreshRemoteKpi(stationId, true);
        }
      }
    });

    hub.on('StationDataReceived', (payload: any) => {
      if (!payload?.stationId) return;

      const stationId = String(payload.stationId);
      stationStatusRef.current[stationId] = 'online';

      useStationStore.setState(state => ({
        stations: state.stations.map(station => station.id === stationId
          ? { ...station, connectionStatus: 'online', lastSeenAt: payload.receivedAt || station.lastSeenAt }
          : station)
      }));

      refreshRemoteKpi(stationId);
    });

    hub.on('UserStatusChange', (data: { username: string, status: string }) => {
      console.log(`[MultisitePage] SignalR event UserStatusChange received for user: ${data?.username}, status: ${data?.status}`);
      const currentUser = authService.getUser();
      if (data && data.username && currentUser?.username && data.username.toLowerCase() === currentUser.username.toLowerCase()) {
        if (data.status === 'updated') {
          console.log(`[MultisitePage] Match found for current user ${currentUser.username}. Triggering silent refresh...`);
          authService.refreshSession().then((success) => {
            console.log(`[MultisitePage] Silent refresh success: ${success}`);
            if (success) {
              useStationStore.getState().invalidate();
              useStationStore.getState().fetch(true);
              stationApi.getProvinces().then(setProvinces).catch(() => {});
              showToast('Thông tin phân quyền tài khoản đã được cập nhật thành công!', 'info');
            }
          });
        } else if (data.status === 'deactivated') {
          showToast('Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.', 'error');
          setTimeout(() => {
            authService.logout();
            navigate('/login');
          }, 2000);
        }
      }
    });

    hub.start().catch(() => {});
    return () => { hub.stop(); };
  }, [isAuthReady, navigate]);



  const normalizeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  };

  const getStationEndpointInfo = (station: { apiUrl?: string; webUrl?: string }) => {
    const rawUrl = (station.apiUrl || station.webUrl || '').trim();
    if (!rawUrl) return { host: '—', ip: '—', port: '—' };

    try {
      const parsed = new URL(normalizeUrl(rawUrl));
      const host = parsed.hostname || '—';
      const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : '—';
      const port = parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '—');
      return { host, ip, port };
    } catch {
      return { host: rawUrl, ip: '—', port: '—' };
    }
  };


  /** Chuẩn hóa input host/IP thành API URL đầy đủ. Mặc định dùng port 5000. */
  const resolveApiUrl = (raw: string): string => {
    const trimmed = raw.trim().replace(/\/$/, '');
    if (!trimmed) return '';
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
      const u = new URL(withScheme);
      // Nếu không có port → dùng 5000 (mặc định backend StationOS)
      if (!u.port || u.port === '80') u.port = '5000';
      // Nhầm port frontend → chuyển sang backend
      if (u.port === '4173' || u.port === '5173' || u.port === '6173') u.port = '5000';
      return u.toString().replace(/\/$/, '');
    } catch { return withScheme; }
  };

  const handleTestConnection = async () => {
    if (!newStationApiUrl.trim()) return;
    const url = resolveApiUrl(newStationApiUrl);
    setConnStatus('checking');
    setConnMs(null);
    try {
      const res = await stationApi.testStationConnection(`${url}/health`);
      setConnMs(res.responseMs);
      setConnStatus(res.reachable ? 'ok' : 'fail');
    } catch {
      setConnStatus('fail');
    }
  };

  const handleGeocode = async () => {
    if (!newStationAddress.trim()) return;
    setGeoStatus('searching');
    try {
      const q = encodeURIComponent(newStationAddress.trim());
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=vn`, {
        headers: { 'Accept-Language': 'vi', 'User-Agent': 'MasterStation/1.0' }
      });
      const data = await res.json();
      if (data.length > 0) {
        setNewStationLat(parseFloat(data[0].lat).toFixed(6));
        setNewStationLng(parseFloat(data[0].lon).toFixed(6));
        if (!newStationAddress.trim() || data[0].display_name) {
          setNewStationAddress(data[0].display_name);
        }
        setGeoStatus('found');
      } else {
        setGeoStatus('notfound');
      }
    } catch {
      setGeoStatus('notfound');
    }
  };

  const handleAddStationSubmit = async () => {
    if (!newStationProvinceId) {
      alert('Vui lòng chọn tỉnh cho trạm');
      return;
    }
    if (!newStationName.trim()) {
      alert('Vui lòng nhập tên trạm');
      return;
    }
    if (!newStationCode.trim()) {
      alert('Vui lòng nhập mã trạm');
      return;
    }
    const lat = parseFloat(newStationLat);
    const lng = parseFloat(newStationLng);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Vui lòng nhập tọa độ Vĩ độ và Kinh độ hợp lệ');
      return;
    }
    if (!newStationApiUrl.trim()) {
      alert('Vui lòng nhập địa chỉ IP / host của trạm con');
      return;
    }

    setIsSaving(true);
    try {
      const locationObj = { lat, lng, address: newStationAddress.trim() };
      await stationApi.createStation(
        newStationName.trim(),
        newStationCode.trim(),
        JSON.stringify(locationObj),
        resolveApiUrl(newStationApiUrl),
        newStationWebUrl.trim() ? normalizeUrl(newStationWebUrl.trim().replace(/\/$/, '')) : undefined,
        newStationApiPassword.trim() || undefined,
        'stationadmin',
        newStationProvinceId
      );

      setNewStationName(''); setNewStationCode('');
      setNewStationLat(''); setNewStationLng('');
      setNewStationAddress(''); setNewStationApiUrl(''); setNewStationWebUrl(''); setNewStationApiPassword(''); setNewStationProvinceId('');
      setConnStatus('idle'); setConnMs(null); setGeoStatus('idle');
      setIsAddModalOpen(false);
      setSelectedProvince(null);
      setSelectedStationId(null);
      overviewFittedRef.current = false;
      setMapHostKey(k => k + 1);

      await fetchStations(true);
      alert('Đã thêm trạm mới thành công!');
    } catch (err: any) {
      alert('Không thể thêm trạm: ' + (err.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteStation = async () => {
    if (!selectedView) return;
    setIsDeleting(true);
    try {
      await stationApi.deleteStation(selectedView.station.id);
      setShowDeleteConfirm(false);
      setSelectedStationId(null);
      setViewingStation(null);
      overviewFittedRef.current = false;
      setMapHostKey(k => k + 1);
      await fetchStations(true);
      showToast('Đã xóa trạm thành công', 'success');
    } catch (err: any) {
      showToast(err.message || 'Không thể xóa trạm. Hãy xóa hết thiết bị của trạm trước.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Compile views with KPIs and alert lists
  const views: StationView[] = useMemo(() => {
    const openAlerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
    return stations.map(s => {
      const remote = remoteKpis[s.id];
      const devices = devicesByStation[s.id] ?? [];
      const onlineCount = s.connectionStatus === 'offline'
        ? 0
        : remote
          ? remote.devicesOnline
          : devices.filter(d => d.status === DEVICE_STATUS.ONLINE).length;
      const totalCount  = remote ? remote.devicesTotal  : devices.length;

      const stationAlerts = openAlerts.filter(a => {
        if (!a.deviceId) return false;
        return devices.some(d => d.id === a.deviceId);
      });
      const alertsCount   = remote ? remote.alertsCount : stationAlerts.length;
      const warningsCount = remote ? 0 : stationAlerts.filter(a => a.level === 'warning').length;
      const alarmsCount   = remote ? alertsCount : stationAlerts.filter(a => a.level === 'alarm' || a.level === 'danger').length;

      return {
        station: s,
        location: parseLocation(s.location),
        kpi: {
          alerts: alertsCount,
          devicesOnline: onlineCount,
          devicesTotal: totalCount,
          warningsCount,
          alarmsCount
        },
        alertsList: stationAlerts
      };
    });
  }, [stations, alertsByFilter, devicesByStation, remoteKpis]);

  const alertsByStation = useMemo(() => {
    const result: Record<string, number> = {};
    views.forEach(v => { result[v.station.id] = v.kpi.alerts; });
    return result;
  }, [views]);

  const filteredViews = views;

  const getProvinceName = useCallback((station: Station) => {
    if (station.provinceId && provinces.length > 0) {
      const match = provinces.find(p => p.id === station.provinceId);
      if (match) return match.name;
    }
    return extractProvinceName(parseLocation(station.location));
  }, [provinces]);

  const groupedViewsByProvince = useMemo(() => {
    const grouped = new Map<string, StationView[]>();

    filteredViews.forEach(view => {
      const province = getProvinceName(view.station);
      const existing = grouped.get(province) || [];
      existing.push(view);
      grouped.set(province, existing);
    });

    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
      .map(([province, provinceViews]) => ({
        province,
        views: provinceViews.sort((a, b) => a.station.name.localeCompare(b.station.name, 'vi'))
      }));
  }, [filteredViews, getProvinceName]);

  const visibleProvinceGroups = useMemo(() => {
    if (!selectedProvince) return groupedViewsByProvince;
    return groupedViewsByProvince.filter(group => group.province === selectedProvince);
  }, [groupedViewsByProvince, selectedProvince]);

  useEffect(() => {
    if (!selectedProvince) return;
    if (!groupedViewsByProvince.some(group => group.province === selectedProvince)) {
      setSelectedProvince(null);
    }
  }, [groupedViewsByProvince, selectedProvince]);

  const provinceMarkerGroups = useMemo(() => {
    return groupedViewsByProvince
      .map(group => {
        const locatedViews = group.views.filter(v => v.location.lat != null && v.location.lng != null);
        if (locatedViews.length === 0) return null;

        const lat = locatedViews.reduce((sum, view) => sum + (view.location.lat || 0), 0) / locatedViews.length;
        const lng = locatedViews.reduce((sum, view) => sum + (view.location.lng || 0), 0) / locatedViews.length;
        const alerts = group.views.reduce((sum, view) => sum + view.kpi.alerts, 0);
        const totalStations = group.views.length;
        const onlineStations = group.views.filter(view => view.station.connectionStatus === 'online').length;

        return {
          province: group.province,
          lat,
          lng,
          alerts,
          totalStations,
          onlineStations,
        };
      })
      .filter(Boolean) as Array<{
        province: string;
        lat: number;
        lng: number;
        alerts: number;
        totalStations: number;
        onlineStations: number;
      }>;
  }, [groupedViewsByProvince]);

  const provinceStationViews = useMemo(() => {
    if (!selectedProvince) return [];
    return views.filter(view => getProvinceName(view.station) === selectedProvince);
  }, [views, selectedProvince, getProvinceName]);

  // Alias tương thích cho các đoạn JSX/refresh cũ còn tham chiếu tên trước đó.
  const filteredStationStats = filteredViews;

  // Selected station view details helper
  const selectedView = useMemo(() => {
    return views.find(v => v.station.id === selectedStationId) || null;
  }, [views, selectedStationId]);

  // Auto-select single station chỉ ở tab overview
  useEffect(() => {
    if (activeTab === 'overview' && views.length === 1 && views[0] && !selectedStationId) {
      setSelectedStationId(views[0].station.id);
    }
  }, [views, selectedStationId, activeTab]);

  // Reset devices sub-tab when leaving devices tab
  useEffect(() => {
    if (activeTab !== 'devices') setDevicesSubTab('overview');
  }, [activeTab]);

  const handleDeviceRefresh = useCallback(() => {
    stations.forEach(s => fetchDevices(s.id));
  }, [stations, fetchDevices]);

  // Global counts for all stations
  const globalStats = useMemo(() => {
    let totalDevices = 0;
    let onlineDevices = 0;
    let alarmAlertsCount = 0;
    let warningAlertsCount = 0;

    views.forEach(v => {
      totalDevices += v.kpi.devicesTotal;
      onlineDevices += v.kpi.devicesOnline;
      alarmAlertsCount += v.kpi.alarmsCount;
      warningAlertsCount += v.kpi.warningsCount;
    });

    const openAlerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
    const recentAlerts = [...openAlerts]
      .sort((a, b) => new Date(b.triggeredAt || '').getTime() - new Date(a.triggeredAt || '').getTime())
      .slice(0, 5);

    return {
      totalStations: views.length,
      totalDevices,
      onlineDevices,
      offlineDevices: totalDevices - onlineDevices,
      alarmAlertsCount,
      warningAlertsCount,
      totalAlerts: alarmAlertsCount + warningAlertsCount,
      recentAlerts
    };
  }, [views, alertsByFilter]);

  // Theme change listener
  useEffect(() => {
    const handleTheme = (e: any) => setCurrentTheme(e.detail.theme);
    window.addEventListener('theme-changed', handleTheme);
    return () => window.removeEventListener('theme-changed', handleTheme);
  }, []);

  // Initialize Leaflet map (Once)
  useEffect(() => {
    if (activeTab !== 'overview') {
      if (leafletMap.current) {
        try {
          leafletMap.current.closePopup?.();
          leafletMap.current.eachLayer?.((layer: any) => {
            try { layer.closePopup?.(); } catch {}
          });
          leafletMap.current.remove();
        } catch {}
        leafletMap.current = null;
        tileLayerRef.current = null;
        setMapReadyTick(t => t + 1);
      }
      return;
    }

    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    mapRef.current.innerHTML = '';
    try {
      delete (mapRef.current as any)._leaflet_id;
    } catch {}

    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([16.0, 107.5], 6);
    leafletMap.current = map;
    overviewFittedRef.current = false;
    setMapReadyTick(t => t + 1);

    const isLight = currentTheme === 'light' || currentTheme === 'soft-light' || currentTheme === 'silver';
    const tileUrl = isLight
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current = L.tileLayer(tileUrl).addTo(map);

    const timer = setTimeout(() => map.invalidateSize(), 500);
    return () => {
      clearTimeout(timer);
      try {
        map.closePopup?.();
        map.eachLayer?.((layer: any) => {
          try { layer.closePopup?.(); } catch {}
        });
        map.remove();
      } catch {}
      if (leafletMap.current === map) {
        leafletMap.current = null;
      }
      if (mapRef.current) {
        mapRef.current.innerHTML = '';
        try {
          delete (mapRef.current as any)._leaflet_id;
        } catch {}
      }
      tileLayerRef.current = null;
      setMapReadyTick(t => t + 1);
    };
  }, [activeTab, leafletLoaded, mapHostKey]);

  // Update Map Tile Server on Theme Change
  useEffect(() => {
    if (tileLayerRef.current) {
      const isLight = currentTheme === 'light' || currentTheme === 'soft-light' || currentTheme === 'silver';
      const tileUrl = isLight
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      tileLayerRef.current.setUrl(tileUrl);
    }
  }, [currentTheme]);

  // Reactive Map Resize when panels or selection change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (leafletMap.current) {
        leafletMap.current.invalidateSize();
      }
    }, 400); // Wait for transition (0.3s) + small buffer
    return () => clearTimeout(timer);
  }, [showLeftPanel, showRightPanel]);

  // Render province markers or station markers depending on selection
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMap.current;
    if (!L || !map || activeTab !== 'overview') return;
    const markers: any[] = [];
    const bounds: [number, number][] = [];
    const newMarkerMap: Record<string, any> = {};

    if (selectedProvince) {
      provinceStationViews.forEach(view => {
        const lat = view.location.lat;
        const lng = view.location.lng;
        if (lat == null || lng == null) return;

        const stationOnline = view.station.connectionStatus === 'online';
        const stationMarkerClass = !stationOnline ? 'pulse-gray' : view.kpi.alerts > 0 ? 'pulse-red' : 'pulse-green';
        const isActive = selectedStationId === view.station.id;
        const icon = L.divIcon({
          className: 'custom-gis-marker',
          html: `
            <div class="marker-icon-wrapper station-marker ${stationMarkerClass} ${isActive ? 'active-marker' : ''}">
              ${STATION_TOWER_ICON}
            </div>
            <div class="marker-label-v3">${view.station.name}</div>
          `,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map);
        bounds.push([lat, lng]);
        newMarkerMap[view.station.id] = marker;
        marker.on('click', () => {
          window.requestAnimationFrame(() => {
            setSelectedStationId(view.station.id);
            setShowRightPanel(true);
          });
        });
        markers.push(marker);
      });
    } else {
      provinceMarkerGroups.forEach(group => {
        const provinceMarkerClass = group.alerts > 0 ? 'pulse-red'
          : group.onlineStations < group.totalStations ? 'pulse-gray'
          : 'pulse-green';
        const isActive = selectedProvince === group.province;
        const icon = L.divIcon({
          className: 'custom-gis-marker',
          html: `
            <div class="marker-icon-wrapper province-marker ${provinceMarkerClass} ${isActive ? 'active-marker' : ''}">
              ${PROVINCE_CHIP_ICON}
            </div>
            <div class="marker-label-v3">${group.province} · ${group.totalStations} trạm</div>
          `,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });

        const marker = L.marker([group.lat, group.lng], { icon }).addTo(map);
        bounds.push([group.lat, group.lng]);
        newMarkerMap[group.province] = marker;
        marker.on('click', () => {
          window.requestAnimationFrame(() => {
            setSelectedProvince(group.province);
            setSelectedStationId(null);
            setShowLeftPanel(true);
          });
        });
        markers.push(marker);
      });
    }

    markerMapRef.current = newMarkerMap;

    // Center map around all stations only once per overview mount
    if (bounds.length > 0 && !overviewFittedRef.current) {
      if (bounds.length === 1) {
        try { map.setView(bounds[0], 12, { animate: false }); } catch {}
      } else {
        try { map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12, animate: false }); } catch {}
      }
      overviewFittedRef.current = true;
    }

    return () => {
      markers.forEach(m => {
        try {
          m.closePopup?.();
          m.remove();
        } catch {}
      });
      markerMapRef.current = {};
    };
  }, [provinceMarkerGroups, provinceStationViews, activeTab, mapReadyTick, selectedProvince, selectedStationId]);

  if (!isAuthReady) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#1a1c1e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f59e0b', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em', fontFamily: 'monospace' }}>
          MASTERSTATION ĐANG KẾT NỐI...
        </div>
      </div>
    );
  }

  return (
    <div className="multisite-page" style={{
      position: 'fixed', inset: 0, overflow: 'hidden'
    }}>
      {/* Dynamic style tag for CSS extensions */}
      <style>{`
        .custom-gis-marker {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .marker-icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          transition: all 0.3s ease;
        }
        .marker-icon-wrapper svg {
          width: 16px;
          height: 16px;
        }
        .marker-icon-wrapper.pulse-green {
          color: var(--admin-success);
        }
        .marker-icon-wrapper.pulse-red {
          color: var(--admin-danger);
        }
        .marker-icon-wrapper.pulse-gray {
          color: #6b7280;
        }
        .marker-icon-wrapper.province-marker,
        .marker-icon-wrapper.station-marker {
          background: transparent !important;
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          filter: drop-shadow(0 2px 5px rgba(0,0,0,0.6));
        }
        .marker-icon-wrapper.province-marker {
          width: 40px !important;
          height: 40px !important;
        }
        .marker-icon-wrapper.province-marker svg {
          width: 34px !important;
          height: 34px !important;
        }
        .marker-icon-wrapper.station-marker {
          width: 32px !important;
          height: 32px !important;
        }
        .marker-icon-wrapper.station-marker svg {
          width: 26px !important;
          height: 26px !important;
        }
        .marker-icon-wrapper.province-marker.pulse-red,
        .marker-icon-wrapper.station-marker.pulse-red {
          filter: drop-shadow(0 0 8px rgba(239,68,68,0.8)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)) !important;
          animation: icon-pulse-red 1.5s infinite alternate;
        }
        @keyframes icon-pulse-red {
          0% { filter: drop-shadow(0 0 4px rgba(239,68,68,0.5)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
          100% { filter: drop-shadow(0 0 14px rgba(239,68,68,1)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
        }
        .marker-icon-wrapper.province-marker.pulse-green,
        .marker-icon-wrapper.station-marker.pulse-green {
          filter: drop-shadow(0 0 6px rgba(16,185,129,0.7)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)) !important;
        }
        .marker-icon-wrapper.province-marker.pulse-gray,
        .marker-icon-wrapper.station-marker.pulse-gray {
          filter: drop-shadow(0 0 4px rgba(107,114,128,0.4)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)) !important;
          color: #6b7280 !important;
        }
        .marker-icon-wrapper.province-marker.active-marker,
        .marker-icon-wrapper.station-marker.active-marker {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          filter: drop-shadow(0 0 10px rgba(14,165,233,0.9)) drop-shadow(0 2px 4px rgba(0,0,0,0.5)) !important;
        }
        .marker-label-v3 {
          position: absolute;
          top: -30px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.85);
          color: #fff;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 9px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
          border: 1px solid var(--admin-border);
          pointer-events: none;
        }
        .multisite-hud-panel {
          background: var(--admin-panel) !important;
          border-bottom: 1px solid var(--admin-border) !important;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--admin-border);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          z-index: 1000;
          display: flex;
          flex-direction: column;
        }
        .multisite-hud-row {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          padding: 0 12px !important;
          justify-content: space-between !important;
        }
        .station-item-card {
          border-bottom: 1px solid var(--admin-border-light);
          cursor: pointer;
          transition: all 0.2s ease;
          border-left: 3px solid transparent;
        }
        .station-item-card:hover {
          background: var(--admin-hover);
        }
        .station-item-card.active-card {
          background: rgba(14, 165, 233, 0.1);
          border-left: 3px solid var(--admin-accent);
        }
        .custom-hud-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .custom-hud-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb {
          background: var(--admin-border);
          border-radius: 2px;
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--admin-accent);
        }
        .leaflet-popup-content-wrapper {
          background: var(--admin-panel) !important;
          color: var(--admin-text) !important;
          border-radius: 0px !important;
          border: 1px solid var(--admin-border) !important;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3) !important;
        }
        .leaflet-popup-tip {
          background: var(--admin-panel) !important;
          border: 1px solid var(--admin-border) !important;
        }
        .alert-row-animate {
          animation: alarm-pulse-border 2s infinite alternate;
        }
        @keyframes alarm-pulse-border {
          0% { border-color: rgba(239, 68, 68, 0.2); }
          100% { border-color: rgba(239, 68, 68, 0.6); }
        }
        .hud-nav-group .btn-industrial {
          border-radius: 0 !important;
        }
        .hud-nav-group .btn-industrial:hover {
          background: rgba(255,255,255,0.07) !important;
          border-color: var(--admin-border) !important;
          color: var(--admin-text) !important;
          transform: none !important;
          box-shadow: none !important;
          border-radius: 0 !important;
        }
        .hud-nav-group .btn-industrial:hover::before,
        .hud-nav-group .btn-industrial:hover::after {
          opacity: 0 !important;
        }
        .hud-nav-group::-webkit-scrollbar {
          display: none;
        }
        .hud-nav-group .btn-industrial {
          flex-shrink: 0;
          white-space: nowrap;
        }
      `}</style>

      {activeTab === 'overview' && (
        <div key={mapHostKey} ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1, background: '#1a1a2e' }} />
      )}

      {activeTab === 'overview' && selectedProvince && (
        <button
          onClick={() => {
            setSelectedProvince(null);
            setSelectedStationId(null);
          }}
          style={{
            position: 'absolute',
            top: 80,
            left: 14,
            zIndex: 1008,
            width: 36,
            height: 36,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--admin-accent)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.transform = 'translateX(-4px)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = 'var(--admin-accent)';
            e.currentTarget.style.transform = 'none';
          }}
        >
          <ArrowLeft size={28} strokeWidth={3} style={{ position: 'relative', top: 1 }} />
        </button>
      )}

      {/* TOP FLOATING HEADER HUD */}
      <div className="multisite-hud-panel multisite-hud-row" style={{
        position: 'absolute', top: 0, left: 0, height: 40,
        borderRadius: '0 0 4px 0', width: '100%', zIndex: 1010,
        padding: '0 12px', display: 'flex', alignItems: 'center',
        overflow: 'visible'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--admin-border)', paddingRight: 12, flexShrink: 0 }}>
          {/* Accent Bar */}
          <div style={{ width: 4, height: 24, background: 'var(--admin-accent)', borderRadius: '2px' }} />

          <img
            alt="StationOS"
            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM0NGZmODgiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMDI4NGM3IiAvPjwvbGluZWFyR3JhZGllbnQ+PGZpbHRlciBpZD0iZ2xvdyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMyIgcmVzdWx0PSJjb2xvcmVkQmx1ciIvPjxmZU1lcmdlPjxmZU1lcmdlTm9kZSBpbj0iY29sb3JlZEJsdXIiLz48ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz48L2ZlTWVyZ2U+PC9maWx0ZXI+PC9kZWZzPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ3JhZCkiIHN0cm9rZS13aWR0aD0iNiIgZmlsdGVyPSJ1cmwoI2dsb3cpIi8+PHBhdGggZD0iTTUwIDE1IEw4MCAzNSBMODAgNjUgTDUwIDg1IEwyMCA2NSBMMjAgMzUgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjMiIG9wYWNpdHk9IjAuNSIvPjxwYXRoIGQ9Ik01NSAyNSBMMzUgNTUgTDUwIDU1IEw0NSA3NSBMNjUgNDUgTDUwIDQ1IFoiIGZpbGw9IiM0NGZmODgiIGZpbHRlcj0idXJsKCNnbG93KSIvPjwvc3ZnPg=="
            style={{ width: 28, height: 28, flexShrink: 0 }}
          />

          <span style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {selectedView && showRightPanel
              ? compactStationTitle(selectedView.station.name)
              : selectedProvince && activeTab === 'overview'
                ? selectedProvince
                : MULTISITE_TAB_TITLES[activeTab]}
          </span>

        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, overflow: 'visible', marginLeft: 'auto' }}>
          <div className="hud-nav-group" style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            background: 'rgba(15, 23, 42, 0.58)',
            border: '1px solid var(--admin-border)',
            borderRadius: 0,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            overflowX: 'auto',
            overflowY: 'hidden',
            flexShrink: 1,
            minWidth: 0,
            scrollbarWidth: 'none'
          }}>
            <button
              onClick={() => activateTab('overview')}
              className="btn-industrial"
              style={{
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: activeTab === 'overview' ? 'var(--admin-accent)' : 'transparent',
                color: activeTab === 'overview' ? '#fff' : 'var(--admin-text-muted)',
                borderColor: activeTab === 'overview' ? 'var(--admin-accent)' : 'transparent'
              }}
            >
              <MapIcon size={11} />
              Bản đồ
            </button>
            {authService.hasPermission('device:view') && (
              <button
                onClick={() => activateTab('truc_tiep')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'truc_tiep' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'truc_tiep' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'truc_tiep' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <Video size={11} />
                TRỰC TIẾP
              </button>
            )}
            {authService.hasPermission('report:view') && (
              <button
                onClick={() => activateTab('analytics')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'analytics' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'analytics' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'analytics' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <LineChart size={11} />
                Phân tích
              </button>
            )}
            {authService.hasPermission('device:manage') && (
              <button
                onClick={() => activateTab('devices')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'devices' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'devices' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'devices' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <Radio size={11} />
                Thiết bị
              </button>
            )}
            {authService.hasPermission('report:view') && (
              <button
                onClick={() => activateTab('alerts_history')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'alerts_history' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'alerts_history' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'alerts_history' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <AlertTriangle size={11} />
                CẢNH BÁO
              </button>
            )}
            {authService.hasPermission('maintenance:view') && (
              <button
                onClick={() => activateTab('maintenance')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'maintenance' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'maintenance' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'maintenance' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <ShieldCheck size={11} />
                BẢO TRÌ
              </button>
            )}
            {authService.hasPermission('settings:manage') && (
              <button
                onClick={() => activateTab('audit_log')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'audit_log' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'audit_log' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'audit_log' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <FileArchive size={11} /> NHẬT KÝ
              </button>
            )}
            {authService.hasPermission('report:view') && (
              <button
                onClick={() => activateTab('reports')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'reports' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'reports' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'reports' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <FileText size={11} /> BÁO CÁO
              </button>
            )}
            {authService.hasPermission('user:view') && (
              <button
                onClick={() => activateTab('users')}
                className="btn-industrial"
                style={{
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  height: 24,
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: activeTab === 'users' ? 'var(--admin-accent)' : 'transparent',
                  color: activeTab === 'users' ? '#fff' : 'var(--admin-text-muted)',
                  borderColor: activeTab === 'users' ? 'var(--admin-accent)' : 'transparent'
                }}
              >
                <Users size={11} /> NGƯỜI DÙNG
              </button>
            )}
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--admin-border)' }} />
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px',
              height: 24,
              border: '1px solid var(--admin-border)',
              background: 'var(--admin-hover)',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.03em',
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--admin-success)',
                display: 'inline-block'
              }} />
              
              <div ref={userMenuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!showUserDropdown && userMenuRef.current) {
                      const r = userMenuRef.current.getBoundingClientRect();
                      setUserDropdownPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
                    }
                    setShowUserDropdown(v => !v);
                  }}
                  title={authService.getUser()?.username}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--admin-accent)',
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontSize: '0.68rem',
                  }}
                >
                  <span>{authService.getUser()?.username}</span>
                  <ChevronDown size={9} style={{ opacity: 0.8, transform: showUserDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                
                {showUserDropdown && (
                  <div style={{
                    position: 'fixed',
                    top: userDropdownPos.top,
                    left: userDropdownPos.left,
                    transform: 'translateX(-50%)',
                    background: 'var(--admin-layer-2, #1e293b)',
                    border: '1px solid var(--admin-border, #334155)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    padding: '4px 0',
                    minWidth: '130px',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                  }}>
                    {authService.hasPermission('license:manage') && (
                      <button
                        onClick={() => {
                          setShowUserDropdown(false);
                          navigate('/license');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--admin-text)',
                          padding: '6px 12px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          width: '100%',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--admin-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        <Key size={11} style={{ color: 'var(--admin-accent)' }} />
                        <span>Bản quyền</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        setShowLogoutConfirm(true);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--admin-danger)',
                        padding: '6px 12px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--admin-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <LogOut size={11} />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI SUB-HEADER GAP - Filling the empty space below toolbar for all tabs */}
      <div style={{
          position: 'absolute',
          top: 40,
          left: 0,
          right: 0,
          height: 34,
          background: 'var(--admin-bg)',
          borderBottom: '1px solid var(--admin-border)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 24
        }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapIcon size={12} style={{ color: 'var(--admin-text-muted)' }} />
              <span style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', letterSpacing: '0.05em' }}>TỔNG SỐ TRẠM:</span>
              <span style={{ fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-text)' }}>{globalStats.totalStations}</span>
           </div>
           <div style={{ width: 1, height: 16, background: 'var(--admin-border)' }} />
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} style={{ color: globalStats.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)' }} />
              <span style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', letterSpacing: '0.05em' }}>CẢNH BÁO:</span>
              <span style={{ fontSize: '.75rem', fontWeight: 900, color: globalStats.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)' }}>{globalStats.totalAlerts}</span>
           </div>
           <div style={{ width: 1, height: 16, background: 'var(--admin-border)' }} />
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wifi size={12} style={{ color: 'var(--admin-text-muted)' }} />
              <span style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', letterSpacing: '0.05em' }}>THIẾT BỊ ONLINE:</span>
              <span style={{ fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-text)' }}>{globalStats.onlineDevices} / {globalStats.totalDevices}</span>
           </div>
           
           <div style={{ flex: 1 }} />
      </div>

      {activeTab === 'analytics' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <Suspense fallback={null}>
            <CentralAnalyticsLayout />
          </Suspense>
        </div>
      )}

      {activeTab === 'devices' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'hidden',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <Suspense fallback={null}>
            {devicesSubTab === 'manage' ? (
              <DeviceManagementPage
                initialAction={devicePanelAction}
                onInitialActionHandled={() => setDevicePanelAction(null)}
                embeddedMode="central"
                stationIdOverride={selectedStationId}
                onStationIdChange={id => setSelectedStationId(id || null)}
                onBack={() => { setDevicesSubTab('overview'); handleDeviceRefresh(); }}
              />
            ) : (
              <CentralDeviceView
                stations={stations}
                devicesByStation={devicesByStation}
                selectedStationId={selectedStationId}
                onSelectStation={id => setSelectedStationId(id)}
                onRefresh={handleDeviceRefresh}
                alertsByStation={alertsByStation}
                onAddDevice={() => { setDevicesSubTab('manage'); setDevicePanelAction('new'); }}
              />
            )}
          </Suspense>
        </div>
      )}

      {activeTab === 'truc_tiep' && (
        <div style={{ position: 'absolute', top: 74, left: 0, right: 0, bottom: 0, zIndex: 2, overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <LiveStationPicker
              views={views}
              onOpenStation={station => {
                localStorage.setItem('multisite_return_tab', 'truc_tiep');
                setViewingStation(station.id);
                navigate(`/realtime?stationId=${encodeURIComponent(station.id)}`);
              }}
            />
          </Suspense>
        </div>
      )}

      {activeTab === 'alerts_history' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <CentralAlertsHistoryView stations={stations} provinces={provinces} />
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <CentralMaintenanceView stations={stations} provinces={provinces} />
        </div>
      )}

      {activeTab === 'audit_log' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <CentralLogView stations={stations} provinces={provinces} teams={teams} />
        </div>
      )}

      {activeTab === 'reports' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            overflow: 'auto',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <CentralReportsView stations={stations} views={views} provinces={provinces} teams={teams} globalStats={globalStats} selectedStationId={selectedStationId} />
        </div>
      )}

      {activeTab === 'users' && (
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
            display: 'flex',
            minHeight: 0,
            overflow: 'hidden',
            background: 'var(--admin-bg, #0b1220)',
            padding: 0
          }}
        >
          <Suspense fallback={null}>
            <UserManagementPage embeddedMode="central" />
          </Suspense>
        </div>
      )}

      {activeTab === 'overview' && (
        <>
          <div
            className="multisite-page-left-panel"
            style={{
              position: 'absolute', top: 74, right: 0, bottom: 0,
              width: showLeftPanel ? 260 : 0,
              zIndex: 1000, pointerEvents: 'none',
              transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <button
              onClick={() => setShowLeftPanel(!showLeftPanel)}
              style={{
                position: 'absolute',
                left: showLeftPanel ? 0 : -24,
                top: 0,
                width: 24,
                height: 24,
                background: 'var(--admin-overlay)',
                backdropFilter: 'blur(10px)',
                border: '1px solid var(--admin-border)',
                borderRight: showLeftPanel ? 'none' : '1px solid var(--admin-border)',
                color: 'var(--admin-text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'all',
                borderRadius: showLeftPanel ? '0 0 0 4px' : '0 4px 4px 0',
                boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
                zIndex: 1002
              }}
              title={showLeftPanel ? 'Thu nhỏ' : 'Mở rộng'}
            >
              {showLeftPanel ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            <div
              className="multisite-hud-panel"
              style={{
                height: 'auto',
                maxHeight: '100%',
                padding: showLeftPanel ? '6px 0 0 0' : '0',
                borderRadius: showLeftPanel ? '0 0 0 4px' : 0,
                pointerEvents: 'all',
                overflow: 'hidden',
                opacity: showLeftPanel ? 1 : 0,
                transition: 'opacity 0.2s ease'
              }}
            >
              <div style={{ padding: '0 8px 6px 8px', borderBottom: '1px solid var(--admin-border-light)' }}>
                <button
                  className="btn-industrial"
                  style={{
                    width: '100%',
                    marginTop: 6,
                    padding: '5px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: 'var(--admin-accent)',
                    borderColor: 'var(--admin-accent)'
                  }}
                  onClick={openAddStationModal}
                >
                  <Plus size={11} /> THÊM TRẠM MỚI
                </button>
              </div>

              <div className="custom-hud-scroll" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {visibleProvinceGroups.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.65rem' }}>
                    Trống
                  </div>
                ) : (
                  selectedProvince ? (
                    visibleProvinceGroups.map(group => (
                      <div key={group.province} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div
                          style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 1,
                            padding: '6px 8px 5px',
                            background: 'var(--admin-panel)',
                            borderTop: '1px solid var(--admin-border-light)',
                            borderBottom: '1px solid var(--admin-border-light)',
                            fontSize: '0.62rem',
                            fontWeight: 900,
                            color: 'var(--admin-accent)',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase'
                          }}
                        >
                          {group.province}
                          <span style={{ marginLeft: 6, color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                            {group.views.length} trạm
                          </span>
                        </div>

                        {group.views.map(v => {
                          const isWarning = v.kpi.alerts > 0;
                          const isActive = selectedStationId === v.station.id;
                          const isOnline = v.station.connectionStatus === 'online';
                          const endpoint = getStationEndpointInfo(v.station);

                          return (
                            <div
                              key={v.station.id}
                              className={`station-item-card ${isActive ? 'active-card' : ''}`}
                              onClick={() => { setSelectedStationId(v.station.id); setShowRightPanel(true); }}
                              style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                    <span
                                      style={{ width: 16, height: 16, display: 'inline-flex', color: 'var(--admin-accent)', flexShrink: 0 }}
                                      dangerouslySetInnerHTML={{ __html: STATION_TOWER_ICON }}
                                    />
                                    <span style={{
                                      fontSize: '0.68rem', fontWeight: 800, color: 'var(--admin-text)',
                                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2,
                                      fontFamily: 'monospace'
                                    }}>
                                      {v.station.code || v.station.id.slice(0, 8).toUpperCase()}
                                    </span>
                                  </div>
                                  <span style={{
                                    fontSize: '0.58rem',
                                    color: 'var(--admin-text-muted)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    paddingLeft: 22
                                  }}>
                                    {v.station.name}
                                  </span>
                                  <span style={{
                                    fontSize: '0.5rem',
                                    color: 'var(--admin-text-muted)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    paddingLeft: 22,
                                    fontFamily: 'monospace'
                                  }}>
                                    {endpoint.host} | {endpoint.ip} | {endpoint.port}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span
                                    style={{
                                      width: 7,
                                      height: 7,
                                      borderRadius: '50%',
                                      background: isOnline ? 'var(--admin-success)' : '#6b7280',
                                      boxShadow: isOnline ? '0 0 6px var(--admin-success)' : 'none'
                                    }}
                                    title={isOnline ? 'Online' : 'Offline'}
                                  />
                                  <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                                    {v.kpi.devicesOnline}/{v.kpi.devicesTotal}
                                  </span>
                                  {!isOnline ? (
                                    <span style={{
                                      fontSize: 8, fontWeight: 900, height: 12, padding: '0 3px',
                                      display: 'flex', alignItems: 'center',
                                      background: 'rgba(107,114,128,0.15)', color: '#9ca3af',
                                      border: '1px solid rgba(107,114,128,0.35)'
                                    }}>
                                      OFFLINE
                                    </span>
                                  ) : v.kpi.alarmsCount > 0 ? (
                                    <span style={{
                                      fontSize: 8, fontWeight: 900, height: 12, padding: '0 3px',
                                      display: 'flex', alignItems: 'center',
                                      background: 'rgba(239,68,68,0.18)', color: '#ff4444',
                                      border: '1px solid rgba(239,68,68,0.5)'
                                    }}>
                                      🔴{v.kpi.alarmsCount} BĐ
                                    </span>
                                  ) : v.kpi.warningsCount > 0 ? (
                                    <span style={{
                                      fontSize: 8, fontWeight: 900, height: 12, padding: '0 3px',
                                      display: 'flex', alignItems: 'center',
                                      background: 'rgba(245,158,11,0.15)', color: 'var(--admin-accent)',
                                      border: '1px solid rgba(245,158,11,0.4)'
                                    }}>
                                      ⚠{v.kpi.warningsCount} CB
                                    </span>
                                  ) : (
                                    <span style={{
                                      fontSize: 8, fontWeight: 900, height: 12, padding: '0 3px',
                                      display: 'flex', alignItems: 'center',
                                      background: 'rgba(16,185,129,0.1)', color: 'var(--admin-success)',
                                      border: '1px solid rgba(16,185,129,0.2)'
                                    }}>
                                      🟢OK
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    visibleProvinceGroups.map(group => {
                      const totalDevices   = group.views.reduce((s, v) => s + v.kpi.devicesTotal, 0);
                      const onlineDevices  = group.views.reduce((s, v) => s + v.kpi.devicesOnline, 0);
                      const offlineCount   = group.views.filter(v => v.station.connectionStatus !== 'online').length;
                      const alarmsCount    = group.views.reduce((s, v) => s + v.kpi.alarmsCount, 0);
                      const warningsCount  = group.views.reduce((s, v) => s + v.kpi.warningsCount, 0);

                      return (
                        <div
                          key={group.province}
                          className="station-item-card"
                          onClick={() => {
                            setSelectedProvince(group.province);
                            setSelectedStationId(null);
                            setShowLeftPanel(true);
                          }}
                          style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <span
                                style={{ width: 16, height: 16, display: 'inline-flex', color: 'var(--admin-accent)', flexShrink: 0 }}
                                dangerouslySetInnerHTML={{ __html: PROVINCE_CHIP_ICON }}
                              />
                              <span style={{
                                fontSize: '0.66rem', fontWeight: 900, color: 'var(--admin-accent)',
                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                              }}>
                                {group.province}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.56rem', color: 'var(--admin-text-muted)', fontWeight: 800, flexShrink: 0 }}>
                              {group.views.length} TRẠM
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingLeft: 22 }}>
                            <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                              {onlineDevices}/{totalDevices} online
                            </span>
                            {/* Badges — hiện cả 2 nếu vừa offline vừa có cảnh báo */}
                            <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                              {offlineCount > 0 && (
                                <span style={{
                                  fontSize: 8, fontWeight: 900, height: 12,
                                  display: 'flex', alignItems: 'center', padding: '0 4px',
                                  background: 'rgba(107,114,128,0.15)', color: '#9ca3af',
                                  border: '1px solid rgba(107,114,128,0.35)'
                                }}>
                                  {offlineCount} OFL
                                </span>
                              )}
                              {alarmsCount > 0 ? (
                                <span style={{
                                  fontSize: 8, fontWeight: 900, height: 12,
                                  display: 'flex', alignItems: 'center', padding: '0 4px',
                                  background: 'rgba(239,68,68,0.18)', color: '#ff4444',
                                  border: '1px solid rgba(239,68,68,0.5)'
                                }}>
                                  🔴{alarmsCount} BĐ
                                </span>
                              ) : warningsCount > 0 ? (
                                <span style={{
                                  fontSize: 8, fontWeight: 900, height: 12,
                                  display: 'flex', alignItems: 'center', padding: '0 4px',
                                  background: 'rgba(245,158,11,0.15)', color: 'var(--admin-accent)',
                                  border: '1px solid rgba(245,158,11,0.4)'
                                }}>
                                  ⚠{warningsCount} CB
                                </span>
                              ) : offlineCount === 0 ? (
                                <span style={{
                                  fontSize: 8, fontWeight: 900, height: 12,
                                  display: 'flex', alignItems: 'center', padding: '0 4px',
                                  background: 'rgba(16,185,129,0.1)', color: 'var(--admin-success)',
                                  border: '1px solid rgba(16,185,129,0.2)'
                                }}>
                                  🟢OK
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </div>
          </div>

          {selectedView && (
            <div
              className="multisite-page-right-panel"
              style={{
                position: 'absolute', top: 74, left: 64, bottom: 0,
                width: showRightPanel ? 280 : 0,
                zIndex: 1000, pointerEvents: 'none',
                transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                style={{
                  position: 'absolute',
                  right: showRightPanel ? 0 : -24,
                  top: 0,
                  width: 24,
                  height: 24,
                  background: 'var(--admin-overlay)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid var(--admin-border)',
                  borderLeft: showRightPanel ? 'none' : '1px solid var(--admin-border)',
                  color: 'var(--admin-text)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'all',
                  borderRadius: showRightPanel ? '4px 0 0 4px' : '0 4px 4px 0',
                  boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
                  zIndex: 1002
                }}
                title={showRightPanel ? 'Thu nhỏ' : 'Mở rộng'}
              >
                {showRightPanel ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>

              <div
                className="multisite-hud-panel"
                style={{
                  height: 'auto',
                  maxHeight: '100%',
                  margin: showRightPanel ? '0 0 0 0' : '0',
                  padding: showRightPanel ? '8px 10px' : '0',
                  borderRadius: 4, pointerEvents: 'all',
                  overflow: 'hidden',
                  opacity: showRightPanel ? 1 : 0,
                  transition: 'opacity 0.2s ease'
                }}
              >
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>

                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6, borderBottom: '1px solid var(--admin-border-light)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Trạm con
                      </div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedView.station.code || selectedView.station.id.slice(0, 8).toUpperCase()}
                      </div>
                      <div style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedView.station.name}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => { setEditingStation(selectedView.station); setEditWebUrl(selectedView.station.webUrl || ''); setEditApiPassword(''); }}
                        title="Cấu hình URL giao diện web"
                        style={{
                          background: 'transparent', border: '1px solid var(--admin-border)',
                          cursor: 'pointer', color: 'var(--admin-text-muted)',
                          padding: '3px 5px', display: 'flex', alignItems: 'center'
                        }}
                      >
                        <Settings size={10} />
                      </button>
                      <button
                        onClick={() => navigate(`/alerts-history?stationId=${selectedView.station.id}`)}
                        style={{
                          background: 'transparent', border: '1px solid var(--admin-border)',
                          cursor: 'pointer', color: 'var(--admin-text-muted)',
                          padding: '2px 6px', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em'
                        }}
                      >
                        LỊCH SỬ
                      </button>
                      <button onClick={() => setSelectedStationId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-muted)', padding: 2, display: 'flex' }}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Trạng thái kết nối */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 6px', background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border-light)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: selectedView.station.connectionStatus === 'online' ? 'var(--admin-success)' : '#6b7280',
                        boxShadow: selectedView.station.connectionStatus === 'online' ? '0 0 5px var(--admin-success)' : 'none'
                      }} />
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 900,
                        color: selectedView.station.connectionStatus === 'online' ? 'var(--admin-success)' : '#9ca3af',
                        letterSpacing: '0.06em'
                      }}>
                        {selectedView.station.connectionStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.55rem', color: 'var(--admin-text-muted)' }}>
                      {selectedView.station.lastSeenAt ? fmtDateTime(selectedView.station.lastSeenAt) : '—'}
                    </span>
                  </div>

                  {(() => {
                    const endpoint = getStationEndpointInfo(selectedView.station);
                    return (
                      <div style={{ padding: '5px 6px', background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border-light)' }}>
                        <div style={{ fontSize: '0.5rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 2 }}>
                          HOST / IP / PORT
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: '2px 6px', fontSize: '0.58rem', color: 'var(--admin-text)', fontFamily: 'monospace' }}>
                          <span style={{ color: 'var(--admin-text-muted)' }}>HOST</span>
                          <span style={{ overflowWrap: 'anywhere' }}>{endpoint.host}</span>
                          <span style={{ color: 'var(--admin-text-muted)' }}>IP</span>
                          <span style={{ overflowWrap: 'anywhere' }}>{endpoint.ip}</span>
                          <span style={{ color: 'var(--admin-text-muted)' }}>PORT</span>
                          <span>{endpoint.port}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* KPI row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border-light)', padding: '5px 6px' }}>
                      <div style={{ fontSize: '0.52rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.06em' }}>THIẾT BỊ</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 900, color: 'var(--admin-text)', fontFamily: 'monospace', marginTop: 1 }}>
                        {selectedView.kpi.devicesOnline}<span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>/{selectedView.kpi.devicesTotal}</span>
                      </div>
                    </div>
                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border-light)', padding: '5px 6px' }}>
                      <div style={{ fontSize: '0.52rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.06em' }}>CẢNH BÁO</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 900, fontFamily: 'monospace', marginTop: 1, color: selectedView.kpi.alarmsCount > 0 ? 'var(--admin-danger)' : selectedView.kpi.warningsCount > 0 ? 'var(--admin-accent)' : 'var(--admin-text)' }}>
                        {selectedView.kpi.alerts}
                      </div>
                    </div>
                  </div>

                  {/* Nút vào trạm */}
                  {selectedView.station.apiUrl ? (
                    <button
                      disabled={isOpeningStation}
                      onClick={async () => {
                        // webUrl từ backend hoặc fallback tính ở client
                        const raw = selectedView.station.webUrl?.trim() || (() => {
                          try {
                            const u = new URL(normalizeUrl(selectedView.station.apiUrl!));
                            if (u.port === '5000') u.port = '4173';
                            else if (u.port === '6000') u.port = '6173';
                            return u.toString().replace(/\/$/, '');
                          } catch { return selectedView.station.apiUrl!; }
                        })();

                        // Nếu trạm con cùng máy với trạm tổng → Electron chỉ bind localhost
                        // thay IP bằng localhost để browser kết nối được
                        let baseUrl = raw.replace(/\/$/, '');
                        try {
                          const u = new URL(baseUrl);
                          if (u.hostname === window.location.hostname) {
                            u.hostname = 'localhost';
                            baseUrl = u.toString().replace(/\/$/, '');
                          }
                        } catch { /* giữ nguyên */ }

                        setIsOpeningStation(true);
                        try {
                          let url = baseUrl;
                          const stationCode = selectedView.station.code || '';
                          try {
                            const { token } = await stationApi.getRemoteToken(selectedView.station.id);
                            const params = new URLSearchParams();
                            if (token) params.set('token', token);
                            if (stationCode) params.set('stationCode', stationCode);
                            const qs = params.toString();
                            if (qs) url = `${baseUrl}?${qs}`;
                          } catch {
                            /* fallback: mở không token, nhưng vẫn truyền stationCode */
                            if (stationCode) url = `${baseUrl}?stationCode=${encodeURIComponent(stationCode)}`;
                          }
                          window.open(url, `station_${selectedView.station.id}`, 'width=1440,height=900,noopener');
                        } finally {
                          setIsOpeningStation(false);
                        }
                      }}
                      style={{
                        width: '100%', padding: '7px 0',
                        background: isOpeningStation ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.1)',
                        border: '1px solid var(--admin-accent)',
                        color: 'var(--admin-accent)', cursor: isOpeningStation ? 'wait' : 'pointer', fontSize: '0.68rem',
                        fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        letterSpacing: '0.06em', textTransform: 'uppercase', opacity: isOpeningStation ? 0.7 : 1
                      }}
                    >
                      <LogIn size={12} /> {isOpeningStation ? 'Đang xác thực...' : 'Vào trạm'}
                    </button>
                  ) : (
                    <div style={{
                      width: '100%', padding: '6px 0', border: '1px solid var(--admin-border)',
                      textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.6rem', fontWeight: 700
                    }}>Chưa cấu hình URL API</div>
                  )}

                  {/* Nút xóa trạm */}
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    style={{
                      width: '100%', padding: '5px 0',
                      background: 'transparent', border: '1px solid rgba(239,68,68,0.2)',
                      color: 'rgba(239,68,68,0.6)', cursor: 'pointer', fontSize: '0.58rem',
                      fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      letterSpacing: '0.06em', textTransform: 'uppercase'
                    }}
                  >
                    <X size={9} /> Xóa trạm này
                  </button>

                  {/* Danh sách cảnh báo */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                      Cảnh báo hiện tại
                    </div>
                      {selectedView.alertsList.length === 0 ? (
                        <div style={{
                          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(16,185,129,0.02)', border: '1px dashed rgba(16,185,129,0.2)', padding: 10
                        }}>
                          <ShieldCheck size={20} style={{ color: 'var(--admin-success)' }} />
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: 200 }} className="custom-hud-scroll">
                          {selectedView.alertsList.map(a => {
                            const isAlarm = a.level === 'alarm' || a.level === 'danger';
                            return (
                              <div
                                key={a.id}
                                style={{
                                  background: 'var(--admin-hover)',
                                  borderLeft: `2px solid ${isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)'}`,
                                  padding: '4px', display: 'flex', flexDirection: 'column'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--admin-text-muted)' }}>
                                  <span style={{ fontWeight: 800, color: isAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)' }}>
                                    {isAlarm ? 'ALARM' : 'WARN'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--admin-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {a.message}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
            123456    </div>
              </div>
          )}

          {views.length === 0 && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              zIndex: 1000, color: 'var(--admin-text-muted)', textAlign: 'center',
              background: 'var(--admin-overlay)', padding: '24px 36px', border: '1px solid var(--admin-border)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)', borderRadius: 4, backdropFilter: 'blur(10px)'
            }}>
              <AlertTriangle size={36} style={{ color: 'var(--admin-warning)', marginBottom: 12, display: 'inline-block' }} />
              <h3 style={{ color: 'var(--admin-text)', margin: '0 0 6px 0', fontSize: '0.85rem' }}>Chưa Cập Nhật Trạm Biến Áp</h3>
              <p style={{ margin: 0, fontSize: '0.75rem' }}>Vui lòng khởi tạo trạm trong giao diện Quản lý hệ thống.</p>
            </div>
          )}
        </>
      )}

      {/* ADD STATION MODAL OVERLAY */}
      {isAddModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            width: '90%', maxWidth: '440px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
            color: 'var(--admin-text)'
          }}>
            {/* Modal Header */}
            <div style={{
              background: 'var(--admin-bg)',
              padding: '14px 20px',
              borderBottom: '1px solid var(--admin-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} style={{ color: 'var(--admin-accent)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Thêm trạm biến áp mới
                </span>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>TỈNH / VÙNG *</label>
                <select
                  value={newStationProvinceId}
                  onChange={e => setNewStationProvinceId(e.target.value)}
                  disabled={isProvinceAdmin && visibleProvinces.length <= 1}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none',
                    colorScheme: 'dark', WebkitAppearance: 'none', appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center'
                  }}
                >
                  <option value="" style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>-- Chọn tỉnh --</option>
                  {visibleProvinces.map(p => (
                    <option key={p.id} value={p.id} style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>{p.name}</option>
                  ))}
                </select>
                {isProvinceAdmin && (
                  <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)' }}>
                    Tài khoản quản lý tỉnh chỉ được tạo trạm trong tỉnh được phân quyền.
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>TÊN TRẠM BIẾN ÁP *</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: Trạm 110kV Cần Thơ"
                  value={newStationName}
                  onChange={e => setNewStationName(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>MÃ TRẠM *</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: TBA-CT01"
                  value={newStationCode}
                  onChange={e => setNewStationCode(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>VĨ ĐỘ (LAT) *</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    placeholder="Ví dụ: 10.03"
                    value={newStationLat}
                    onChange={e => setNewStationLat(e.target.value)}
                    style={{
                      background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>KINH ĐỘ (LNG) *</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    placeholder="Ví dụ: 105.78"
                    value={newStationLng}
                    onChange={e => setNewStationLng(e.target.value)}
                    style={{
                      background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  ĐỊA CHỈ
                  <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--admin-text-muted)', opacity: 0.7 }}>
                    — nhập rồi bấm "Tìm tọa độ" để tự điền Lat/Lng
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Ví dụ: Ninh Kiều, Cần Thơ"
                    value={newStationAddress}
                    onChange={e => { setNewStationAddress(e.target.value); setGeoStatus('idle'); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleGeocode(); }}
                    style={{
                      flex: 1, background: 'var(--admin-layer-2)',
                      border: `1px solid ${geoStatus === 'found' ? 'var(--admin-success)' : geoStatus === 'notfound' ? 'var(--admin-danger)' : 'var(--admin-border)'}`,
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleGeocode}
                    disabled={geoStatus === 'searching' || !newStationAddress.trim()}
                    className="btn-industrial"
                    style={{ padding: '0 10px', fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                  >
                    {geoStatus === 'searching' ? '...' : 'Tìm tọa độ'}
                  </button>
                </div>
                {geoStatus === 'found' && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--admin-success)' }}>
                    ● Tìm thấy — đã điền tọa độ tự động
                  </span>
                )}
                {geoStatus === 'notfound' && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--admin-danger)' }}>
                    ● Không tìm thấy địa chỉ này — thử từ khóa khác hoặc nhập tọa độ thủ công
                  </span>
                )}
              </div>

              {/* Địa chỉ trạm con */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  ĐỊA CHỈ IP TRẠM CON *
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="192.168.10.102"
                    value={newStationApiUrl}
                    onChange={e => { setNewStationApiUrl(e.target.value); setConnStatus('idle'); setConnMs(null); }}
                    style={{
                      flex: 1, background: 'var(--admin-layer-2)',
                      border: `1px solid ${connStatus === 'ok' ? 'var(--admin-success)' : connStatus === 'fail' ? 'var(--admin-danger)' : 'var(--admin-border)'}`,
                      padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={connStatus === 'checking' || !newStationApiUrl.trim()}
                    className="btn-industrial"
                    style={{ padding: '0 12px', fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                  >
                    {connStatus === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra'}
                  </button>
                </div>
                {connStatus === 'ok' && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--admin-success)' }}>
                    ● Kết nối thành công {connMs !== null ? `(${connMs}ms)` : ''}
                  </span>
                )}
                {connStatus === 'fail' && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--admin-danger)' }}>
                    ● Không thể kết nối tới trạm con (Vẫn có thể lưu trạm, hệ thống sẽ tự kết nối sau)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  MẬT KHẨU `stationadmin`
                </label>
                <div style={{
                  padding: '7px 10px',
                  background: 'var(--admin-layer-1)',
                  border: '1px solid var(--admin-border)',
                  fontSize: '0.72rem',
                  color: 'var(--admin-text-muted)',
                  fontFamily: 'monospace'
                }}>
                  Tài khoản dùng cố định: stationadmin
                </div>
                <input
                  type="password"
                  placeholder="Để trống sẽ dùng mặc định Station@123"
                  value={newStationApiPassword}
                  onChange={e => setNewStationApiPassword(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)',
                    border: '1px solid var(--admin-border)',
                    padding: '8px 10px',
                    fontSize: '0.75rem',
                    color: 'var(--admin-text)',
                    outline: 'none'
                  }}
                />
                <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)' }}>
                  Nếu trạm con chưa đổi mật khẩu, có thể để trống.
                </span>
              </div>

            </div>

            {/* Modal Footer */}
            <div style={{
              background: 'var(--admin-bg)',
              padding: '12px 20px',
              borderTop: '1px solid var(--admin-border)',
              display: 'flex', justifyContent: 'flex-end', gap: 10
            }}>
              <button
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSaving}
                className="btn-industrial"
                style={{ padding: '6px 16px', fontSize: '0.75rem' }}
              >
                Hủy
              </button>
              <button 
                onClick={handleAddStationSubmit}
                disabled={isSaving}
                className="btn-industrial btn-primary"
                style={{
                  padding: '6px 16px', fontSize: '0.75rem', fontWeight: 700,
                  background: 'var(--admin-accent)', color: '#fff', border: 'none'
                }}
              >
                {isSaving ? 'Đang lưu...' : 'Lưu lại'}
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Edit station web URL */}
      {editingStation && (
        <div className="modal-overlay active" onClick={() => { if (!isSavingEdit) setEditingStation(null); }}>
          <div className="modal-content" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.05em' }}>
                CẤU HÌNH TRẠM CON — {editingStation.name}
              </span>
              <button className="modal-close" onClick={() => setEditingStation(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  URL API BACKEND (chỉ đọc)
                </label>
                <div style={{
                  padding: '7px 10px', background: 'var(--admin-layer-1)',
                  border: '1px solid var(--admin-border)', fontSize: '0.75rem',
                  color: 'var(--admin-text-muted)', fontFamily: 'monospace'
                }}>
                  {editingStation.apiUrl || '(chưa cấu hình)'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  URL GIAO DIỆN WEB *
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="http://192.168.10.102:4173"
                  defaultValue={editingStation.webUrl || ''}
                  onChange={e => setEditWebUrl(e.target.value)}
                  onFocus={e => { if (!editWebUrl) setEditWebUrl(editingStation.webUrl || ''); }}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none', width: '100%', boxSizing: 'border-box'
                  }}
                />
                <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)' }}>
                  URL đầy đủ để mở giao diện trạm trong trình duyệt (bao gồm giao thức và cổng)
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  TÀI KHOẢN API (cố định)
                </label>
                <div style={{
                  padding: '7px 10px', background: 'var(--admin-layer-1)',
                  border: '1px solid var(--admin-border)', fontSize: '0.75rem',
                  color: 'var(--admin-text-muted)', fontFamily: 'monospace'
                }}>
                  {editingStation.apiUsername || 'stationadmin'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  MẬT KHẨU API TRẠM CON
                </label>
                <input
                  type="password"
                  placeholder={editingStation.hasApiPassword ? 'Để trống nếu không đổi' : 'Mặc định: Station@123'}
                  value={editApiPassword}
                  onChange={e => setEditApiPassword(e.target.value)}
                  style={{
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    padding: '8px 10px', fontSize: '0.75rem', color: 'var(--admin-text)', outline: 'none', width: '100%', boxSizing: 'border-box'
                  }}
                />
                <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)' }}>
                  Nếu trạm con đã đổi mật khẩu của `stationadmin`, cập nhật lại tại đây.
                </span>
              </div>
            </div>
            <div style={{
              padding: '12px 24px', borderTop: '1px solid var(--admin-border)',
              display: 'flex', justifyContent: 'flex-end', gap: 10
            }}>
              <button className="btn-industrial" onClick={() => setEditingStation(null)} disabled={isSavingEdit}
                style={{ padding: '6px 16px', fontSize: '0.75rem' }}>Hủy</button>
              <button
                className="btn-industrial btn-primary"
                disabled={isSavingEdit || (!editWebUrl.trim() && !editingStation.webUrl && !editApiPassword.trim())}
                onClick={async () => {
                  setIsSavingEdit(true);
                  try {
                    const webUrlNorm = editWebUrl.trim()
                      ? normalizeUrl(editWebUrl.trim().replace(/\/$/, ''))
                      : editingStation.webUrl;
                    await stationApi.updateStation(editingStation.id, {
                      name: editingStation.name,
                      code: editingStation.code,
                      location: editingStation.location,
                      apiUrl: editingStation.apiUrl,
                      apiUsername: editingStation.apiUsername || 'stationadmin',
                      apiPassword: editApiPassword.trim() || undefined,
                      webUrl: webUrlNorm,
                      status: editingStation.status
                    });
                    setEditingStation(null);
                    setEditWebUrl('');
                    setEditApiPassword('');
                    await fetchStations(true);
                  } catch { alert('Lưu thất bại'); }
                  finally { setIsSavingEdit(false); }
                }}
                style={{ padding: '6px 16px', fontSize: '0.75rem', fontWeight: 700,
                  background: 'var(--admin-accent)', color: '#fff', border: 'none' }}
              >
                {isSavingEdit ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete station confirm */}
      {showDeleteConfirm && selectedView && (
        <div className="modal-overlay active" onClick={() => { if (!isDeleting) setShowDeleteConfirm(false); }}>
          <div className="modal-content" style={{ width: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="modal-body" style={{ padding: '32px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <AlertTriangle size={36} style={{ color: 'var(--admin-danger)' }} />
              </div>
              <h3 style={{ margin: '0 0 6px', fontSize: '1rem', color: 'var(--admin-danger)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Xóa trạm
              </h3>
              <p style={{ margin: '0 0 4px', fontSize: '.88rem', fontWeight: 700, color: 'var(--admin-text)' }}>
                {selectedView.station.name}
              </p>
              {selectedView.station.code && (
                <p style={{ margin: '0 0 12px', fontSize: '.72rem', color: 'var(--admin-accent)', fontFamily: 'monospace', fontWeight: 800 }}>
                  [{selectedView.station.code}]
                </p>
              )}
              <p style={{ margin: '0 0 24px', opacity: 0.65, fontSize: '.8rem', lineHeight: 1.55 }}>
                Thao tác này <strong style={{ color: 'var(--admin-danger)' }}>không thể hoàn tác</strong>.<br />
                Trạm sẽ bị xóa vĩnh viễn. Hãy đảm bảo đã xóa hết thiết bị của trạm trước.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn-industrial"
                  disabled={isDeleting}
                  style={{ minWidth: 100 }}
                >
                  Hủy
                </button>
                <button
                  onClick={handleDeleteStation}
                  className="btn-industrial btn-danger"
                  disabled={isDeleting}
                  style={{ minWidth: 130 }}
                >
                  {isDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirm */}
      {showLogoutConfirm && (
        <div className="modal-overlay active" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal-content" style={{ width: 360, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="modal-body" style={{ padding: '32px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--admin-danger)' }}>ĐĂNG XUẤT</span>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Xác nhận đăng xuất</h3>
              <p style={{ margin: '0 0 24px', opacity: 0.6, fontSize: '.9rem' }}>Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button onClick={() => setShowLogoutConfirm(false)} className="btn-industrial" style={{ minWidth: 100 }}>Hủy</button>
                <button onClick={() => { authService.logout(); navigate('/login'); window.location.reload(); }} className="btn-industrial btn-danger" style={{ minWidth: 100 }}>Đăng xuất</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   CentralReportsView — tab Báo cáo đa trạm
   Chỉ hiển thị: nút tạo nhanh + dropdown trạm + bảng lịch sử
   ───────────────────────────────────────────────────────────── */
function CentralReportsView({
  stations, views, provinces, teams, globalStats, selectedStationId,
}: {
  stations: Station[];
  views: StationView[];
  provinces: Province[];
  teams: Team[];
  globalStats: { totalStations: number; totalDevices: number; onlineDevices: number; totalAlerts: number; totalCameras?: number };
  selectedStationId: string | null;
}) {
  const S = {
    // card
    card: { background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 3 } as React.CSSProperties,
    // text
    muted: { color: 'var(--admin-text-muted)' } as React.CSSProperties,
    label: { fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em', textTransform: 'uppercase' as const },
    // buttons
    btn: { height: 26, padding: '0 10px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties,
    btnActive: (c: string) => ({ height: 26, padding: '0 10px', borderRadius: 3, border: `1px solid ${c}`, background: `${c}18`, color: c, fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties),
    btnPrimary: { height: 26, padding: '0 10px', borderRadius: 3, border: 'none', background: 'var(--admin-accent)', color: '#fff', fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties,
    // table
    th: { padding: '6px 12px', textAlign: 'left' as const, fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', whiteSpace: 'nowrap' as const },
    td: { padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.7rem', verticalAlign: 'middle' as const },
    tdNoWrap: { whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' as const },
    pill: (c: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 6 } as React.CSSProperties),
    pillBar: (c: string) => ({ width: 3, height: 12, borderRadius: 1, background: c, flexShrink: 0 } as React.CSSProperties),
    pillLbl: { fontSize: '.7rem', fontWeight: 700 } as React.CSSProperties,
    // misc
    row: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
    flex1: { flex: 1 } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 8, padding: '48px 24px', color: 'var(--admin-text-muted)', opacity: .5, textAlign: 'center' as const },
    spin: { animation: 'crv-spin 1s linear infinite' } as React.CSSProperties,
  };

  const [scopeType, setScopeType] = useState<'fleet' | 'province' | 'team' | 'station'>(selectedStationId ? 'station' : 'fleet');
  const [scopeId, setScopeId] = useState(selectedStationId || '');
  const [history, setHistory] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (selectedStationId) {
      setScopeType('station');
      setScopeId(selectedStationId);
    }
  }, [selectedStationId]);

  const scopeTypeOptions = useMemo(() => ([
    { value: 'fleet', label: `Toàn bộ hệ thống (${views.length} trạm)` },
    { value: 'province', label: 'Theo tỉnh' },
    { value: 'team', label: 'Theo tổ' },
    { value: 'station', label: 'Theo trạm' },
  ]), [views.length]);

  const scopeEntityOptions = useMemo(() => {
    if (scopeType === 'province') {
      return provinces.map(province => ({ value: province.id, label: province.name }));
    }
    if (scopeType === 'team') {
      return teams.map(team => ({ value: team.id, label: team.name }));
    }
    if (scopeType === 'station') {
      return views.map(view => ({
        value: view.station.id,
        label: `${view.station.code ? `${view.station.code} · ` : ''}${view.station.name}`,
      }));
    }
    return [];
  }, [provinces, scopeType, teams, views]);

  useEffect(() => {
    if (scopeType === 'fleet') {
      if (scopeId) setScopeId('');
      return;
    }
    if (!scopeEntityOptions.some(option => option.value === scopeId)) {
      setScopeId(scopeEntityOptions[0]?.value || '');
    }
  }, [scopeEntityOptions, scopeId, scopeType]);

  const scopeLabel = useMemo(() => {
    if (scopeType === 'fleet') return `Toàn bộ hệ thống (${views.length} trạm)`;
    if (scopeType === 'province') {
      return provinces.find(province => province.id === scopeId)?.name || 'Chưa chọn tỉnh';
    }
    if (scopeType === 'team') {
      return teams.find(team => team.id === scopeId)?.name || 'Chưa chọn tổ';
    }
    return views.find(view => view.station.id === scopeId)?.station.name || 'Chưa chọn trạm';
  }, [provinces, scopeId, scopeType, teams, views]);

  const scopeStationIds = useMemo(() => {
    if (scopeType === 'fleet') return stations.map(station => station.id);
    if (scopeType === 'province') return stations.filter(station => station.provinceId === scopeId).map(station => station.id);
    if (scopeType === 'team') return teams.find(team => team.id === scopeId)?.stationIds || [];
    return scopeId ? [scopeId] : [];
  }, [scopeId, scopeType, stations, teams]);

  const reportFilters = useMemo(() => {
    if (scopeType === 'province') return { scopeType, provinceId: scopeId || undefined };
    if (scopeType === 'team') return { scopeType, teamId: scopeId || undefined };
    if (scopeType === 'station') return { scopeType, stationId: scopeId || undefined };
    return { scopeType: 'fleet' as const };
  }, [scopeId, scopeType]);

  const load = async () => {
    setLoading(true);
    try {
      const items = await stationApi.getReports(reportFilters);
      setHistory(items.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()));
    } catch { setHistory([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [reportFilters]);

  const gen = async (type: 'daily' | 'monthly' | 'event') => {
    if (scopeType !== 'fleet' && !scopeId) {
      alert('Vui lòng chọn phạm vi báo cáo.');
      return;
    }
    if (scopeStationIds.length === 0) {
      alert('Phạm vi hiện tại chưa có trạm để tạo báo cáo.');
      return;
    }
    const now = new Date(), from = new Date(now);
    if (type === 'daily') from.setDate(now.getDate() - 1);
    if (type === 'monthly') from.setDate(now.getDate() - 30);
    if (type === 'event') from.setDate(now.getDate() - 7);
    setGenerating(type);
    try {
      await stationApi.generateReport({
        stationId: scopeType === 'station' ? scopeId || undefined : undefined,
        provinceId: scopeType === 'province' ? scopeId || undefined : undefined,
        teamId: scopeType === 'team' ? scopeId || undefined : undefined,
        scopeType,
        scopeLabel,
        type,
        from: from.toISOString(),
        to: now.toISOString()
      });
      await load();
    }
    catch { alert('Không thể tạo báo cáo.'); }
    finally { setGenerating(null); }
  };

  const dl = async (r: ReportItem) => {
    try {
      const blob = await stationApi.downloadReport(r.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `BaoCao_${r.type}_${r.generatedAt.slice(0,10)}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Không thể tải.'); }
  };

  const del = async (id: string) => { try { await stationApi.deleteReport(id); load(); } catch {} };

  const tl = (t: string) => t === 'daily' ? 'Hàng ngày' : t === 'monthly' ? 'Hàng tháng' : 'Sự cố';
  const tc = (t: string) => t === 'daily' ? 'var(--admin-accent)' : t === 'monthly' ? '#a855f7' : '#f97316';

  const filtered = useMemo(() => filter === 'all' ? history : history.filter(r => r.type === filter), [history, filter]);

  const types: Array<{ t: 'daily'|'monthly'|'event'; title: string; icon: React.ReactNode; c: string }> = [
    { t: 'daily', title: 'Báo cáo ngày', icon: <Clock size={12} />, c: 'var(--admin-accent)' },
    { t: 'monthly', title: 'Báo cáo tháng', icon: <Calendar size={12} />, c: '#a855f7' },
    { t: 'event', title: 'Báo cáo sự cố', icon: <AlertTriangle size={12} />, c: '#f97316' },
  ];

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>

      {/* ── Generate bar ──────────────────────────────────── */}
      <div style={{ ...S.card, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={S.label}>Tạo báo cáo nhanh</span>
        {types.map(x => (
          <button key={x.t} style={generating === x.t ? S.btnActive(x.c) : S.btn}
            disabled={!!generating}
            onClick={() => !generating && gen(x.t)}>
            {generating === x.t ? <Loader2 size={12} style={S.spin} /> : <span style={{ color: x.c, display: 'flex' }}>{x.icon}</span>}
            {generating === x.t ? 'Đang tạo...' : x.title}
          </button>
        ))}
      </div>

      {/* ── Scope + filters ───────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <InlineDarkDropdown
          value={scopeType}
          options={scopeTypeOptions}
          onChange={value => setScopeType(value as 'fleet' | 'province' | 'team' | 'station')}
          minWidth={190}
        />
        {scopeType !== 'fleet' && (
          <InlineDarkDropdown
            value={scopeId}
            options={scopeEntityOptions}
            onChange={setScopeId}
            minWidth={240}
          />
        )}
        <div style={S.flex1} />
        <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>{filtered.length} báo cáo</span>
        {(['all','daily','monthly','event'] as const).map(f => (
          <button key={f} style={filter === f ? S.btnActive('var(--admin-accent)') : S.btn}
            onClick={() => setFilter(f)}>
            {f === 'all' ? 'Tất cả' : tl(f)}
          </button>
        ))}
      </div>

      {/* ── Table ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 3, minHeight: 0 }}>
        {loading ? (
          <div style={S.empty}><Loader2 size={22} style={{ ...S.spin, color: 'var(--admin-accent)', opacity: 1 }} /><p>Đang tải...</p></div>
        ) : filtered.length === 0 ? (
          <div style={S.empty}><FileText size={32} /><p>{history.length === 0 ? 'Chưa có báo cáo nào. Nhấn nút tạo bên trên.' : 'Không có báo cáo phù hợp.'}</p></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Loại</th><th style={S.th}>Phạm vi</th><th style={S.th}>Kỳ báo cáo</th><th style={S.th}>Ngày tạo</th><th style={{ ...S.th, textAlign: 'right', width: 80 }}></th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const sname = stations.find(s => s.id === r.stationId)?.name;
                const c = tc(r.type);
                const resolvedScopeLabel = r.scopeLabel || sname || 'Toàn hệ thống';
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td style={S.td}><div style={S.pill(c)}><span style={S.pillBar(c)} /><span style={S.pillLbl}>{tl(r.type)}</span></div></td>
                    <td style={S.td}>{resolvedScopeLabel || <span style={{ ...S.muted, fontStyle: 'italic' }}>Toàn hệ thống</span>}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '.65rem', ...S.muted }}>
                      {r.periodFrom ? new Date(r.periodFrom).toLocaleDateString('vi-VN') : '--'}
                      {' → '}{r.periodTo ? new Date(r.periodTo).toLocaleDateString('vi-VN') : '--'}
                    </td>
                    <td style={{ ...S.td, ...S.muted, fontSize: '.68rem' }}>{new Date(r.generatedAt).toLocaleString('vi-VN')}</td>
                    <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.fileUrl && (
                        <button style={S.btn} onClick={() => dl(r)}><Download size={12} /> PDF</button>
                      )}
                      <button style={{ ...S.btn, borderColor: 'transparent', background: 'transparent', opacity: .3, marginLeft: 4, padding: '0 5px' }}
                        onClick={() => del(r.id)} title="Xóa"><X size={12} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* keyframe for spinner */}
      <style>{`@keyframes crv-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   CentralLogView — tab Nhật ký đa trạm
   Gộp 4 loại log (audit, login, notify, rule-trigger) từ tất cả
   trạm, hiển thị dạng bảng nhất quán với theme admin/industrial.
   ───────────────────────────────────────────────────────────── */

type LogType = 'all' | 'audit' | 'login' | 'notify' | 'rule';
interface MergedLogItem {
  id: string;
  ts: string;
  type: LogType;
  stationId?: string;
  stationName?: string;
  accountStationId?: string;
  accountStationName?: string;
  provinceId?: string;
  provinceName?: string;
  teamId?: string;
  teamName?: string;
  action: string;
  detail: string;
  user: string;
  entityType?: string;
  ipAddress?: string;
  oldValue?: string | null;
  newValue?: string | null;
  channel?: string;
  recipient?: string;
  status?: string;
  ruleName?: string;
  deviceName?: string;
  valueAtTrigger?: number;
  conditionSnapshot?: string;
}

const LOG_TYPE_LABELS: Record<LogType, string> = {
  all: 'TẤT CẢ',
  audit: 'HÀNH ĐỘNG',
  login: 'ĐĂNG NHẬP',
  notify: 'THÔNG BÁO',
  rule: 'KÍCH HOẠT',
};

const LOG_TYPE_COLORS: Record<LogType, string> = {
  all: 'var(--admin-text-muted)',
  audit: 'var(--admin-accent)',
  login: '#22c55e',
  notify: '#f59e0b',
  rule: '#ef4444',
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  user: 'người dùng',
  device: 'thiết bị',
  rule: 'quy tắc',
  alert: 'cảnh báo',
  station: 'trạm',
  setting: 'cài đặt',
  maintenance: 'bảo trì',
  report: 'báo cáo',
  sld: 'sơ đồ',
  sys: 'hệ thống',
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  provinceIds: 'Tỉnh được gán',
  stationIds: 'Trạm được gán',
  permissions: 'Quyền được gán',
  fullName: 'Họ tên',
  username: 'Tên đăng nhập',
  email: 'Email',
  role: 'Vai trò',
  isActive: 'Trạng thái hoạt động',
  teamId: 'Tổ/nhóm',
  name: 'Tên',
  code: 'Mã',
  status: 'Trạng thái',
  stationId: 'Trạm',
  provinceId: 'Tỉnh',
};

function safeParseJson(value?: string | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatEntityLabel(entity?: string) {
  if (!entity) return 'hệ thống';
  return AUDIT_ENTITY_LABELS[entity.toLowerCase()] || entity.toLowerCase();
}

function formatAuditAction(action: string, entity?: string) {
  const label = formatEntityLabel(entity);
  const normalized = action.toLowerCase();
  if (normalized === 'create') return `Tạo ${label}`;
  if (normalized === 'update') return `Cập nhật ${label}`;
  if (normalized === 'delete') return `Xóa ${label}`;
  if (normalized === 'ack_alert') return 'Xác nhận cảnh báo';
  if (normalized === 'close_alert') return 'Đóng cảnh báo';
  if (normalized === 'login') return 'Đăng nhập hệ thống';
  return `${action.toUpperCase()} ${label}`;
}

function formatFieldLabel(field: string) {
  return AUDIT_FIELD_LABELS[field] || field;
}

function formatValue(value: unknown, field?: string, stations?: Station[], provinces?: Province[]): string {
  if (value == null) return 'Không có';
  if (field === 'provinceIds' && Array.isArray(value)) {
    if (!value.length) return 'Không có';
    return value.map(id => provinces?.find(p => p.id === String(id))?.name || String(id)).join(', ');
  }
  if ((field === 'stationIds' || field === 'stationId') && Array.isArray(value)) {
    if (!value.length) return 'Không có';
    return value.map(id => stations?.find(s => s.id === String(id))?.name || String(id)).join(', ');
  }
  if (field === 'stationId' && !Array.isArray(value)) {
    return stations?.find(s => s.id === String(value))?.name || String(value);
  }
  if (field === 'provinceId' && !Array.isArray(value)) {
    return provinces?.find(p => p.id === String(value))?.name || String(value);
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Không có';
  if (typeof value === 'boolean') return value ? 'Bật' : 'Tắt';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function summarizeAuditDetail(item: MergedLogItem) {
  if (item.type !== 'audit') return item.detail || 'Nhật ký hệ thống';

  const entity = formatEntityLabel(item.entityType);
  const changes = safeParseJson(item.newValue) || safeParseJson(item.oldValue);
  const keys = changes ? Object.keys(changes).slice(0, 2).map(formatFieldLabel) : [];

  if (item.action.toLowerCase() === 'update' && keys.length > 0) {
    return `Đã cập nhật ${entity}: ${keys.join(', ')}`;
  }
  if (item.action.toLowerCase() === 'create') {
    return `Đã tạo ${entity} mới`;
  }
  if (item.action.toLowerCase() === 'delete') {
    return `Đã xóa ${entity}`;
  }
  return `Thao tác trên ${entity}`;
}

function buildChangeRows(item: MergedLogItem, stations: Station[], provinces: Province[]): Array<{ label: string; before?: string; after?: string }> {
  const before = safeParseJson(item.oldValue);
  const after = safeParseJson(item.newValue);
  const keys = Array.from(new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]));

  if (keys.length === 0) {
    return [{
      label: 'Dữ liệu mới',
      before: item.oldValue || undefined,
      after: item.newValue || undefined,
    }];
  }

  return keys.map(key => ({
    label: formatFieldLabel(key),
    before: before && key in before ? formatValue(before[key], key, stations, provinces) : undefined,
    after: after && key in after ? formatValue(after[key], key, stations, provinces) : undefined,
  }));
}

function CentralLogView({ stations, provinces, teams }: { stations: Station[]; provinces: Province[]; teams: Team[] }) {
  const [logType, setLogType] = useState<LogType>('all');
  const [selectedDate, setSelectedDate] = useState(() => formatIsoDate(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => parseIsoDate(formatIsoDate(new Date())));
  const [scopeStationId, setScopeStationId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<MergedLogItem[]>([]);
  const [selectedLog, setSelectedLog] = useState<MergedLogItem | null>(null);
  const [showDetail, setShowDetail] = useState(true);
  const calendarRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(() => ({ from: selectedDate, to: selectedDate }), [selectedDate]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const from = dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = dates.to ? new Date(dates.to + 'T23:59:59').toISOString() : undefined;
    const sid = scopeStationId || undefined;
    try {
      const [audit, login, notify, rule] = await Promise.all([
        stationApi.getAuditLogs({ from, to, stationId: sid, limit: 500 }),
        stationApi.getLoginLogs({ from, to, stationId: sid }),
        stationApi.getNotifyLogs({ from, to, stationId: sid }),
        stationApi.getRuleTriggerLogs({ from, to, stationId: sid }),
      ]);

      const merged: MergedLogItem[] = [
        ...audit.map(l => ({
          id: l.id, ts: l.ts, type: 'audit' as LogType,
          stationId: l.stationId, stationName: l.stationName,
          accountStationId: l.accountStationId, accountStationName: l.accountStationName,
          provinceId: l.provinceId, provinceName: l.provinceName,
          teamId: l.teamId, teamName: l.teamName,
          action: l.action, detail: l.entityType || 'SYS',
          user: l.fullName || l.username || 'system',
          entityType: l.entityType, ipAddress: l.ipAddress,
          oldValue: l.oldValue, newValue: l.newValue,
        })),
        ...login.map(l => ({
          id: l.id, ts: l.ts, type: 'login' as LogType,
          stationId: l.stationId, stationName: l.stationName,
          accountStationId: l.accountStationId, accountStationName: l.accountStationName,
          action: l.action, detail: 'LOGIN',
          user: l.username || 'system',
          ipAddress: l.ipAddress,
        })),
        ...notify.map(l => ({
          id: l.id, ts: l.sentAt, type: 'notify' as LogType,
          stationId: l.stationId, stationName: l.stationName,
          action: l.channel, detail: l.recipient,
          user: 'system', channel: l.channel, recipient: l.recipient,
          status: l.status,
        })),
        ...rule.map(l => ({
          id: l.id, ts: l.triggeredAt, type: 'rule' as LogType,
          stationId: l.stationId, stationName: l.stationName,
          action: l.ruleName || l.ruleId, detail: l.deviceName || l.deviceId || '',
          user: 'system', ruleName: l.ruleName, deviceName: l.deviceName,
          valueAtTrigger: l.valueAtTrigger, conditionSnapshot: l.conditionSnapshot,
        })),
      ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

      setLogs(merged);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [dates, scopeStationId]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    if (!calendarOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [calendarOpen]);

  useEffect(() => {
    if (selectedDate) setCalendarMonth(parseIsoDate(selectedDate));
  }, [selectedDate]);

  const filtered = useMemo(() => {
    let source = logType === 'all' ? logs : logs.filter(l => l.type === logType);
    if (!searchText) return source;
    const q = searchText.toLowerCase();
    return source.filter(l =>
      l.action.toLowerCase().includes(q) ||
      l.detail.toLowerCase().includes(q) ||
      l.user.toLowerCase().includes(q) ||
      (l.stationName || '').toLowerCase().includes(q)
    );
  }, [logs, logType, searchText]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const todayIso = useMemo(() => formatIsoDate(new Date()), []);

  const S = {
    toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', flexShrink: 0, flexWrap: 'wrap' as const },
    btn: { height: 26, padding: '0 10px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties,
    btnActive: (c: string) => ({ height: 26, padding: '0 10px', borderRadius: 3, border: `1px solid ${c}`, background: `${c}18`, color: c, fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties),
    dropdown: { height: 28, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 160 } as React.CSSProperties,
    input: { height: 26, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.62rem', fontWeight: 600, outline: 'none', minWidth: 160 } as React.CSSProperties,
    dateButton: { height: 26, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.62rem', fontWeight: 600, outline: 'none', width: 145, fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' } as React.CSSProperties,
    th: { padding: '6px 12px', textAlign: 'left' as const, fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', whiteSpace: 'nowrap' as const },
    td: { padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.7rem', verticalAlign: 'middle' as const },
    tdNoWrap: { whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
    pill: (c: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 6 } as React.CSSProperties),
    pillBar: (c: string) => ({ width: 3, height: 12, borderRadius: 1, background: c, flexShrink: 0 } as React.CSSProperties),
    pillLbl: { fontSize: '.7rem', fontWeight: 600 } as React.CSSProperties,
    muted: { color: 'var(--admin-text-muted)' } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', color: 'var(--admin-text-muted)', opacity: 0.5 } as React.CSSProperties,
    spin: { animation: 'crv-spin 1s linear infinite' } as React.CSSProperties,
    calendarPopup: { position: 'absolute' as const, top: 'calc(100% + 6px)', left: 0, width: 240, background: '#0b0f14', border: '1px solid var(--admin-border)', borderRadius: 0, boxShadow: '0 12px 32px rgba(0,0,0,.45)', padding: 10, zIndex: 30 },
    calendarHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    calendarNav: { width: 24, height: 24, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 0 } as React.CSSProperties,
    calendarTitle: { fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.06em' } as React.CSSProperties,
    calendarWeek: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 },
    calendarWeekLabel: { textAlign: 'center' as const, fontSize: '.52rem', color: 'var(--admin-text-muted)', fontWeight: 700, padding: '4px 0' } as React.CSSProperties,
    calendarGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
    calendarDay: { height: 28, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.62rem', fontWeight: 700, cursor: 'pointer', borderRadius: 0 } as React.CSSProperties,
    calendarDayMuted: { height: 28, border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,.18)', fontSize: '.62rem', fontWeight: 700, cursor: 'default', borderRadius: 0 } as React.CSSProperties,
    calendarFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 6 },
  };

  const LogTypeIcon = ({ type }: { type: LogType }) => {
    switch (type) {
      case 'audit': return <FileText size={12} />;
      case 'login': return <LogIn size={12} />;
      case 'notify': return <Bell size={12} />;
      case 'rule': return <Zap size={12} />;
      default: return <FileText size={12} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--admin-bg)' }}>
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div style={S.toolbar}>
        <span style={{ fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em' }}>LOẠI</span>
        {(Object.keys(LOG_TYPE_LABELS) as LogType[]).map(t => (
          <button key={t} style={logType === t ? S.btnActive(LOG_TYPE_COLORS[t]) : S.btn}
            onClick={() => setLogType(t)}>
            <LogTypeIcon type={t} />
            {LOG_TYPE_LABELS[t]}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: 'var(--admin-border)', margin: '0 4px' }} />

        <div ref={calendarRef} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <span style={{ fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em' }}>NGÀY</span>
          <Calendar size={12} style={S.muted} />
          <button
            type="button"
            onClick={() => setCalendarOpen(v => !v)}
            style={S.dateButton}
            aria-label="Chọn ngày xem nhật ký"
          >
            <span>{selectedDate.split('-').reverse().join('/')}</span>
            <Calendar size={12} />
          </button>
          {calendarOpen && (
            <div style={S.calendarPopup}>
              <div style={S.calendarHeader}>
                <button
                  type="button"
                  style={S.calendarNav}
                  onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                >
                  <ChevronLeft size={14} />
                </button>
                <div style={S.calendarTitle}>{monthLabel(calendarMonth)}</div>
                <button
                  type="button"
                  style={S.calendarNav}
                  onClick={() => setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div style={S.calendarWeek}>
                {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(label => (
                  <div key={label} style={S.calendarWeekLabel}>{label}</div>
                ))}
              </div>
              <div style={S.calendarGrid}>
                {calendarDays.map((day, index) => {
                  if (!day) return <div key={`empty-${index}`} style={S.calendarDayMuted} />;
                  const iso = formatIsoDate(day);
                  const isSelected = iso === selectedDate;
                  const isToday = iso === todayIso;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => {
                        setSelectedDate(iso);
                        setCalendarOpen(false);
                      }}
                      style={{
                        ...S.calendarDay,
                        borderColor: isSelected ? 'var(--admin-accent)' : isToday ? '#3b475a' : 'var(--admin-border)',
                        background: isSelected ? 'rgba(245, 158, 11, 0.16)' : isToday ? '#111827' : 'var(--admin-layer-2)',
                        color: isSelected ? 'var(--admin-accent)' : 'var(--admin-text)',
                      }}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
              <div style={S.calendarFooter}>
                <button
                  type="button"
                  style={{ ...S.btn, flex: 1, justifyContent: 'center' }}
                  onClick={() => {
                    const today = formatIsoDate(new Date());
                    setSelectedDate(today);
                    setCalendarMonth(parseIsoDate(today));
                    setCalendarOpen(false);
                  }}
                >
                  HÔM NAY
                </button>
                <button
                  type="button"
                  style={{ ...S.btn, flex: 1, justifyContent: 'center' }}
                  onClick={() => setCalendarOpen(false)}
                >
                  ĐÓNG
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--admin-border)', margin: '0 4px' }} />

        <span style={{ fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em' }}>TRẠM</span>
        <InlineDarkDropdown
          value={scopeStationId}
          onChange={setScopeStationId}
          minWidth={180}
          options={[
            { value: '', label: `TẤT CẢ TRẠM (${stations.length})` },
            ...stations.map(s => ({ value: s.id, label: `${s.code ? `${s.code} · ` : ''}${s.name}` }))
          ]}
        />

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--admin-layer-2)', borderRadius: 3, border: '1px solid var(--admin-border)', padding: '0 8px' }}>
          <Search size={12} style={S.muted} />
          <input type="text" placeholder="TÌM KIẾM..." value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ ...S.input, border: 'none', background: 'transparent', minWidth: 140, padding: 0 }} />
          {searchText && <X size={12} style={{ ...S.muted, cursor: 'pointer' }} onClick={() => setSearchText('')} />}
        </div>

        <button style={S.btn} onClick={loadLogs} title="Tải lại">
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>

        <span style={{ fontSize: '.6rem', fontWeight: 600, color: 'var(--admin-text-muted)' }}>
          {filtered.length} dòng
        </span>
      </div>

      {/* ── Per-station summary strip ──────────────────────── */}
      {!scopeStationId && logs.length > 0 && (
        <div style={{
          display: 'flex', gap: 8, padding: '6px 12px',
          background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-border)',
          overflowX: 'auto', flexShrink: 0, alignItems: 'center'
        }}>
          <span style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', letterSpacing: '.08em', flexShrink: 0 }}>THEO TRẠM:</span>
          {(() => {
            const counts: Record<string, { name: string; count: number }> = {};
            logs.forEach(l => {
              const key = l.stationId || '_system';
              if (!counts[key]) counts[key] = { name: l.stationName || 'Hệ thống', count: 0 };
              counts[key].count++;
            });
            return Object.entries(counts)
              .sort((a, b) => b[1].count - a[1].count)
              .slice(0, 8)
              .map(([sid, info]) => (
                <span key={sid} onClick={() => setScopeStationId(sid === '_system' ? '' : sid)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 3,
                    background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)',
                    fontSize: '.58rem', fontWeight: 700, color: 'var(--admin-text)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'border-color .15s'
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-accent)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-border)'}
                >
                  <span style={{ color: 'var(--admin-accent)', fontWeight: 900 }}>{info.count}</span>
                  {info.name.length > 14 ? info.name.slice(0, 14) + '…' : info.name}
                </span>
              ));
          })()}
        </div>
      )}

      {/* ── Body: table + detail panel ──────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 3, minWidth: 0 }}>
          {loading ? (
            <div style={S.empty}><Loader2 size={22} style={{ ...S.spin, color: 'var(--admin-accent)', opacity: 1 }} /><p>Đang tải nhật ký...</p></div>
          ) : filtered.length === 0 ? (
            <div style={S.empty}><FileText size={32} /><p>{logs.length === 0 ? 'Chưa có dữ liệu nhật ký. Nhấn nút tải lại.' : 'Không có kết quả phù hợp.'}</p></div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead><tr>
                <th style={{ ...S.th, width: 140 }}>THỜI GIAN</th>
                <th style={{ ...S.th, width: 120 }}>TỈNH</th>
                <th style={{ ...S.th, width: 120 }}>TỔ</th>
                <th style={{ ...S.th, width: 150 }}>TRẠM</th>
                <th style={{ ...S.th, width: 110 }}>LOẠI</th>
                <th style={S.th}>NỘI DUNG</th>
                <th style={{ ...S.th, width: 150 }}>NGƯỜI DÙNG</th>
              </tr></thead>
              <tbody>
                {filtered.map(l => {
                  const c = LOG_TYPE_COLORS[l.type];
                  const isSelected = selectedLog?.id === l.id;
                  const provinceName = l.provinceName ?? '—';
                  const teamName = l.teamName ?? '—';
                  return (
                    <tr key={l.id}
                      onClick={() => setSelectedLog(isSelected ? null : l)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--admin-layer-2)' : 'transparent',
                      }}>
                      <td style={{ ...S.td, ...S.tdNoWrap, fontFamily: 'monospace', fontSize: '.62rem', ...S.muted }} title={fmtDateTime(l.ts)}>
                        {fmtDateTime(l.ts)}
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap }} title={provinceName}>
                        <span style={{ display: 'block', fontSize: '.62rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: provinceName === '—' ? undefined : 'var(--admin-accent)' }}>
                          {provinceName === '—' ? <span style={{ ...S.muted, fontStyle: 'italic' }}>—</span> : provinceName}
                        </span>
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap }} title={teamName}>
                        <span style={{ display: 'block', fontSize: '.62rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: teamName === '—' ? undefined : '#f59e0b' }}>
                          {teamName === '—' ? <span style={{ ...S.muted, fontStyle: 'italic' }}>—</span> : teamName}
                        </span>
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap }} title={l.stationName || '—'}>
                        <span style={{ display: 'block', fontSize: '.62rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.stationName || <span style={{ ...S.muted, fontStyle: 'italic' }}>—</span>}
                        </span>
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap }}>
                        <div style={{ ...S.pill(c), whiteSpace: 'nowrap' }}>
                          <span style={S.pillBar(c)} />
                          <span style={S.pillLbl}>{LOG_TYPE_LABELS[l.type]}</span>
                        </div>
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap }} title={[l.action, l.detail].filter(Boolean).join(' ')}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, fontSize: '.68rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {l.type === 'audit' ? formatAuditAction(l.action, l.entityType) : l.action}
                          </span>
                          {l.detail && <span style={{ ...S.muted, fontSize: '.58rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summarizeAuditDetail(l)}</span>}
                        </div>
                      </td>
                      <td style={{ ...S.td, ...S.tdNoWrap, fontFamily: 'monospace', fontSize: '.6rem', ...S.muted }} title={l.user.toUpperCase()}>
                        {l.user.toUpperCase()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selectedLog && (
          <aside style={{
            width: showDetail ? 320 : 28,
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            borderRadius: 3,
            marginLeft: 6,
            display: 'flex',
            flexDirection: 'column',
            transition: 'width .2s',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setShowDetail(!showDetail)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px',
                border: 'none', background: 'var(--admin-layer-1)',
                color: 'var(--admin-text)', cursor: 'pointer',
                fontSize: '.58rem', fontWeight: 900, letterSpacing: '.08em',
                borderBottom: '1px solid var(--admin-border)',
              }}>
              {showDetail ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
              {showDetail && 'CHI TIẾT'}
            </button>
            {showDetail && (
              <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <DetailRow label="THỜI GIAN" value={fmtDateTime(selectedLog.ts)} />
                  <DetailRow label="TRẠM" value={selectedLog.stationName || '—'} />
                  <DetailRow label="LOẠI" value={LOG_TYPE_LABELS[selectedLog.type]} />
                  <DetailRow label="HÀNH ĐỘNG" value={selectedLog.type === 'audit' ? formatAuditAction(selectedLog.action, selectedLog.entityType) : selectedLog.action} />
                  <DetailRow label="CHI TIẾT" value={summarizeAuditDetail(selectedLog)} />
                  <DetailRow label="NGƯỜI DÙNG" value={selectedLog.user} />
                  {selectedLog.ipAddress && <DetailRow label="IP" value={selectedLog.ipAddress} />}
                  {selectedLog.entityType && <DetailRow label="ĐỐI TƯỢNG" value={formatEntityLabel(selectedLog.entityType)} />}
                  {selectedLog.accountStationName && <DetailRow label="TRẠM CỦA TÀI KHOẢN" value={selectedLog.accountStationName} />}
                  {selectedLog.channel && <DetailRow label="KÊNH" value={selectedLog.channel} />}
                  {selectedLog.recipient && <DetailRow label="NGƯỜI NHẬN" value={selectedLog.recipient} />}
                  {selectedLog.status && <DetailRow label="TRẠNG THÁI" value={selectedLog.status} />}
                  {selectedLog.ruleName && <DetailRow label="RULE" value={selectedLog.ruleName} />}
                  {selectedLog.deviceName && <DetailRow label="THIẾT BỊ" value={selectedLog.deviceName} />}
                  {selectedLog.valueAtTrigger != null && <DetailRow label="GIÁ TRỊ" value={String(selectedLog.valueAtTrigger)} />}
                  {selectedLog.conditionSnapshot && (
                    <div>
                      <div style={{ fontSize: '.52rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.08em', marginBottom: 4 }}>ĐIỀU KIỆN</div>
                      <pre style={{ fontSize: '.55rem', background: 'var(--admin-layer-2)', padding: 6, borderRadius: 3, overflow: 'auto', maxHeight: 100, margin: 0 }}>
                        {selectedLog.conditionSnapshot}
                      </pre>
                    </div>
                  )}
                  {(selectedLog.oldValue || selectedLog.newValue) && (
                    <div>
                      <div style={{ fontSize: '.52rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.08em', marginBottom: 4 }}>THAY ĐỔI</div>
                      {buildChangeRows(selectedLog, stations, provinces).map((row, index) => (
                        <div key={`${row.label}-${index}`} style={{ marginBottom: 8, padding: 8, background: 'var(--admin-layer-2)', borderRadius: 3 }}>
                          <div style={{ fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-text)', marginBottom: 6 }}>{row.label}</div>
                          {row.before !== undefined && (
                            <div style={{ marginBottom: row.after !== undefined ? 6 : 0 }}>
                              <span style={{ fontSize: '.5rem', color: '#ef4444', fontWeight: 700 }}>TRƯỚC</span>
                              <div style={{ fontSize: '.58rem', color: 'var(--admin-text)', marginTop: 2, wordBreak: 'break-word' }}>{row.before}</div>
                            </div>
                          )}
                          {row.after !== undefined && (
                            <div>
                              <span style={{ fontSize: '.5rem', color: '#22c55e', fontWeight: 700 }}>SAU</span>
                              <div style={{ fontSize: '.58rem', color: 'var(--admin-text)', marginTop: 2, wordBreak: 'break-word' }}>{row.after}</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '.52rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '.65rem', fontWeight: 600, color: 'var(--admin-text)' }}>{value}</div>
    </div>
  );
}

function CentralAlertsHistoryView({ stations, provinces }: { stations: Station[]; provinces: Province[] }) {
  const [provinceId, setProvinceId] = useState('');
  const [stationId, setStationId] = useState('');
  const [status, setStatus] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const stationsByProvince = useMemo(
    () => provinceId ? stations.filter(s => s.provinceId === provinceId) : stations,
    [stations, provinceId]
  );

  useEffect(() => {
    if (stationId && !stationsByProvince.some(s => s.id === stationId)) setStationId('');
  }, [stationId, stationsByProvince]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await stationApi.getAlerts(status || undefined, undefined, undefined, 500, stationId || undefined);
      const filteredByProvince = provinceId
        ? data.filter(a => stations.find(s => s.id === a.stationId)?.provinceId === provinceId)
        : data;
      setAlerts(filteredByProvince);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [status, stationId, provinceId, stations]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!searchText) return alerts;
    const q = searchText.toLowerCase();
    return alerts.filter(a =>
      (a.message || '').toLowerCase().includes(q) ||
      (a.stationName || stations.find(s => s.id === a.stationId)?.name || '').toLowerCase().includes(q) ||
      (a.deviceId || '').toLowerCase().includes(q)
    );
  }, [alerts, searchText, stations]);

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <InlineDarkDropdown value={provinceId} onChange={setProvinceId} minWidth={180} options={[
          { value: '', label: 'TẤT CẢ TỈNH' },
          ...provinces.map(p => ({ value: p.id, label: p.name }))
        ]} />
        <InlineDarkDropdown value={stationId} onChange={setStationId} minWidth={220} options={[
          { value: '', label: 'TẤT CẢ TRẠM CON' },
          ...stationsByProvince.map(s => ({ value: s.id, label: s.name }))
        ]} />
        <InlineDarkDropdown value={status} onChange={setStatus} minWidth={160} options={[
          { value: '', label: 'TẤT CẢ TRẠNG THÁI' },
          { value: 'open', label: 'CHƯA XỬ LÝ' },
          { value: 'acked', label: 'ĐANG XỬ LÝ' },
          { value: 'closed', label: 'ĐÃ ĐÓNG' }
        ]} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: '0 8px', height: 28 }}>
          <Search size={12} color="var(--admin-text-muted)" />
          <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="TÌM CẢNH BÁO..." style={{ border: 'none', background: 'transparent', color: 'var(--admin-text)', outline: 'none', minWidth: 180 }} />
        </div>
        <button onClick={load} className="btn-industrial" style={{ height: 28, padding: '0 10px' }}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className="admin-card" style={{ padding: '8px 12px' }}>TỔNG CẢNH BÁO: <b>{filtered.length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>MỞ: <b style={{ color: 'var(--admin-danger)' }}>{filtered.filter(a => a.status === 'open').length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>ĐANG XỬ LÝ: <b style={{ color: 'var(--admin-warning)' }}>{filtered.filter(a => a.status === 'acked').length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>ĐÃ ĐÓNG: <b style={{ color: 'var(--admin-success)' }}>{filtered.filter(a => a.status === 'closed').length}</b></div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>THỜI GIAN</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TỈNH</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TRẠM CON</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>NỘI DUNG</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>MỨC ĐỘ</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TRẠNG THÁI</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: 'var(--admin-text-muted)' }}>{loading ? 'Đang tải...' : 'Không có dữ liệu'}</td></tr>
            ) : filtered.map(alert => {
              const station = stations.find(s => s.id === alert.stationId);
              const provinceName = provinces.find(p => p.id === station?.provinceId)?.name || 'Chưa phân tỉnh';
              return (
                <tr key={alert.id}>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{fmtDateTime(alert.triggeredAt)}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{provinceName}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{alert.stationName || station?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)', fontWeight: 700 }}>{alert.message}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{alert.level}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{alert.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CentralMaintenanceView({ stations, provinces }: { stations: Station[]; provinces: Province[] }) {
  const [provinceId, setProvinceId] = useState('');
  const [stationId, setStationId] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);

  const stationsByProvince = useMemo(
    () => provinceId ? stations.filter(s => s.provinceId === provinceId) : stations,
    [stations, provinceId]
  );

  useEffect(() => {
    if (stationId && !stationsByProvince.some(s => s.id === stationId)) setStationId('');
  }, [stationId, stationsByProvince]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await stationApi.getMaintenance(stationId || undefined, status === 'all' ? undefined : status);
      const filteredByProvince = provinceId
        ? data.filter(t => stations.find(s => s.id === t.stationId)?.provinceId === provinceId)
        : data;
      setTasks(filteredByProvince);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [stationId, status, provinceId, stations]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.addEventListener('maintenance:changed', load);
    return () => window.removeEventListener('maintenance:changed', load);
  }, [load]);

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <InlineDarkDropdown value={provinceId} onChange={setProvinceId} minWidth={180} options={[
          { value: '', label: 'TẤT CẢ TỈNH' },
          ...provinces.map(p => ({ value: p.id, label: p.name }))
        ]} />
        <InlineDarkDropdown value={stationId} onChange={setStationId} minWidth={220} options={[
          { value: '', label: 'TẤT CẢ TRẠM CON' },
          ...stationsByProvince.map(s => ({ value: s.id, label: s.name }))
        ]} />
        <InlineDarkDropdown value={status} onChange={setStatus} minWidth={180} options={[
          { value: 'all', label: 'TẤT CẢ TRẠNG THÁI' },
          { value: 'pending', label: 'ĐANG CHỜ' },
          { value: 'in_progress', label: 'ĐANG LÀM' },
          { value: 'overdue', label: 'QUÁ HẠN' },
          { value: 'completed', label: 'HOÀN THÀNH' }
        ]} />
        <button onClick={load} className="btn-industrial" style={{ height: 28, padding: '0 10px' }}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className="admin-card" style={{ padding: '8px 12px' }}>TỔNG CÔNG VIỆC: <b>{tasks.length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>QUÁ HẠN: <b style={{ color: 'var(--admin-danger)' }}>{tasks.filter(t => t.status === 'overdue').length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>ĐANG LÀM: <b style={{ color: 'var(--admin-warning)' }}>{tasks.filter(t => t.status === 'in_progress').length}</b></div>
        <div className="admin-card" style={{ padding: '8px 12px' }}>HOÀN THÀNH: <b style={{ color: 'var(--admin-success)' }}>{tasks.filter(t => t.status === 'completed').length}</b></div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TỈNH</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TRẠM CON</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TIÊU ĐỀ</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>THIẾT BỊ</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>NGÀY DỰ KIẾN</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>TRẠNG THÁI</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '.58rem', color: 'var(--admin-text-muted)' }}>PHỤ TRÁCH</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--admin-text-muted)' }}>{loading ? 'Đang tải...' : 'Không có dữ liệu'}</td></tr>
            ) : tasks.map(task => {
              const station = stations.find(s => s.id === task.stationId);
              const provinceName = provinces.find(p => p.id === station?.provinceId)?.name || 'Chưa phân tỉnh';
              return (
                <tr key={task.id}>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{provinceName}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{station?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)', fontWeight: 700 }}>{task.title}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{task.deviceName || '—'}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{task.scheduledDate?.slice(0, 10)}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{task.status}</td>
                  <td style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.03)' }}>{task.assignedTo || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
