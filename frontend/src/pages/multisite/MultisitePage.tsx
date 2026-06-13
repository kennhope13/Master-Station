import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStationStore, useAlertStore, useDeviceStore } from '@/store';
import type { Station, AlertItem, ReportItem, AuditLogEntry, LoginLogEntry, NotifyLogEntry, RuleTriggerLogEntry } from '@/types/api.types';
import type { StationView, StationLocation, StationKpi } from './types';
import { ALERT_STATUS, DEVICE_STATUS } from '@/types/enums';
import {
  Search, Map as MapIcon, AlertTriangle,
  X, ShieldCheck, Wifi,
  ChevronLeft, ChevronRight, Plus, LogIn, LogOut, FileText, FileArchive, Users, LineChart, Radio, Video,
  Download, RefreshCw, Calendar, Clock, Loader2, Filter, Bell, Zap
} from 'lucide-react';
import { stationApi } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { fmtDateTime, fmtTimeRange } from '@/utils/format';
import { createRealtimeHub } from '@/services/realtime.service';
import { showToast } from '@/utils/toast';

const CentralAnalyticsLayout = lazy(() => import('@/pages/analytics/CentralAnalyticsLayout'));
const DeviceManagementPage = lazy(() => import('@/pages/device-management/DeviceManagementPage'));
const CentralDeviceView = lazy(() => import('@/pages/multisite/CentralDeviceView'));
const LiveStationPicker = lazy(() => import('@/pages/multisite/LiveStationPicker'));
const UserManagementPage = lazy(() => import('@/pages/user-management/UserManagementPage'));

type MultisiteTab = 'overview' | 'analytics' | 'devices' | 'truc_tiep' | 'audit_log' | 'reports' | 'users';

const MULTISITE_TAB_TITLES: Record<MultisiteTab, string> = {
  overview: 'GIÁM SÁT TỔNG QUAN',
  truc_tiep: 'TRỰC TIẾP',
  analytics: 'PHÂN TÍCH',
  devices: 'THIẾT BỊ',
  audit_log: 'NHẬT KÝ',
  reports: 'BÁO CÁO',
  users: 'QUẢN TRỊ NHÂN SỰ & TRẠM',
};



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

export default function MultisitePage() {
  const navigate = useNavigate();
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

  const setActiveTab = (tab: MultisiteTab) => {
    setSearchParams(prev => {
      prev.set('tab', tab);
      return prev;
    }, { replace: true });
  };

  const [statusFilter, setStatusFilter] = useState<'all' | 'warning' | 'normal'>('all');
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
  const [connStatus, setConnStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [connMs, setConnMs] = useState<number | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'searching' | 'found' | 'notfound'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [remoteKpis, setRemoteKpis] = useState<Record<string, { devicesOnline: number; devicesTotal: number; alertsCount: number }>>({});
  const [isAuthReady, setIsAuthReady] = useState(() => !!authService.getToken());
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

    hub.start().catch(() => {});
    return () => { hub.stop(); };
  }, [isAuthReady]);



  const normalizeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  };

  const resolveWebUrl = (apiUrl: string): string => {
    let base = normalizeUrl((apiUrl || '').trim().replace(/\/$/, ''));
    if (!base) return '';
    try {
      const urlObj = new URL(base);
      if (urlObj.port === '5000') {
        urlObj.port = '5173';
      } else if (urlObj.port === '6000') {
        urlObj.port = '6173';
      }
      if (typeof window !== 'undefined' && window.location) {
        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
          if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
            urlObj.hostname = hostname;
          }
        }
      }
      return urlObj.toString().replace(/\/$/, '');
    } catch {
      return base;
    }
  };

  const handleTestConnection = async () => {
    if (!newStationApiUrl.trim()) return;
    const url = normalizeUrl(newStationApiUrl);
    if (url !== newStationApiUrl) setNewStationApiUrl(url);
    setConnStatus('checking');
    setConnMs(null);
    try {
      const res = await stationApi.testStationConnection(url);
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
      alert('Vui lòng nhập URL API của trạm con');
      return;
    }

    setIsSaving(true);
    try {
      const locationObj = { lat, lng, address: newStationAddress.trim() };
      await stationApi.createStation(
        newStationName.trim(),
        newStationCode.trim(),
        JSON.stringify(locationObj),
        normalizeUrl(newStationApiUrl)
      );

      setNewStationName(''); setNewStationCode('');
      setNewStationLat(''); setNewStationLng('');
      setNewStationAddress(''); setNewStationApiUrl('');
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

  /*
  const handleDeleteStation = async () => {
    if (!selectedView) return;
    
    const confirmed = await confirmDialog({
      title: 'Xóa trạm biến áp',
      message: `Bạn có chắc chắn muốn xóa ${selectedView.station.name} không? Thao tác này không thể hoàn tác và chỉ có thể thực hiện khi trạm không còn thiết bị.`,
      confirmText: 'Xóa trạm',
      danger: true
    });
    
    if (!confirmed) return;

    try {
      await stationApi.deleteStation(selectedView.station.id);
      setSelectedStationId(null);
      await fetchStations(true);
      alert('Đã xóa trạm thành công!');
    } catch (err: any) {
      alert(err.message || 'Không thể xóa trạm. Vui lòng kiểm tra lại thiết bị của trạm này.');
    }
  };
  */

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

  const filteredViews = useMemo(() => {
    return views.filter(v => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'warning') return v.kpi.alerts > 0;
      if (statusFilter === 'normal') return v.kpi.alerts === 0;
      return true;
    });
  }, [views, statusFilter]);

  const groupedViewsByProvince = useMemo(() => {
    const grouped = new Map<string, StationView[]>();

    filteredViews.forEach(view => {
      const province = extractProvinceName(view.location);
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
  }, [filteredViews]);

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
    return views.filter(view => extractProvinceName(view.location) === selectedProvince);
  }, [views, selectedProvince]);

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

        const isWarning = view.kpi.alerts > 0;
        const isActive = selectedStationId === view.station.id;
        const icon = L.divIcon({
          className: 'custom-gis-marker',
          html: `
            <div class="marker-icon-wrapper ${isWarning ? 'pulse-red' : 'pulse-green'} ${isActive ? 'active-marker' : ''}">
              ${STATION_TOWER_ICON}
            </div>
            <div class="marker-label-v3">${view.station.name}</div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
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
        const isWarning = group.alerts > 0;
        const isActive = selectedProvince === group.province;
        const icon = L.divIcon({
          className: 'custom-gis-marker',
          html: `
            <div class="marker-icon-wrapper ${isWarning ? 'pulse-red' : 'pulse-green'} ${isActive ? 'active-marker' : ''}">
              ${PROVINCE_CHIP_ICON}
            </div>
            <div class="marker-label-v3">${group.province} · ${group.totalStations} trạm</div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
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
          border-radius: 6px;
          color: #fff;
          background: var(--admin-layer-3);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(4px);
          transition: all 0.3s ease;
        }
        .marker-icon-wrapper.active-marker {
          background: rgba(14, 165, 233, 0.18) !important;
          border: 2px solid rgba(125, 211, 252, 0.95) !important;
          color: #e0f2fe !important;
          box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.18), 0 0 14px rgba(14, 165, 233, 0.45);
          z-index: 10;
        }
        .marker-icon-wrapper svg {
          width: 16px;
          height: 16px;
        }
        .marker-icon-wrapper.pulse-green {
          color: var(--admin-success);
          border-color: var(--admin-success);
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
        }
        .marker-icon-wrapper.pulse-red {
          color: var(--admin-danger);
          background: rgba(239, 68, 68, 0.1);
          border-color: var(--admin-danger);
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.6);
          animation: marker-pulse-red-anim 1.5s infinite alternate;
        }
        @keyframes marker-pulse-red-anim {
          0% { transform: scale(0.95); box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }
          100% { transform: scale(1.1); box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); }
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
      `}</style>

      {activeTab === 'overview' && (
        <div key={mapHostKey} ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />
      )}

      {activeTab === 'overview' && selectedProvince && (
        <button
          onClick={() => {
            setSelectedProvince(null);
            setSelectedStationId(null);
          }}
          className="btn-industrial"
          style={{
            position: 'absolute',
            top: 78,
            left: selectedView && showRightPanel ? 214 : 14,
            zIndex: 1008,
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            border: '1px solid var(--admin-accent)',
            background: 'rgba(245, 158, 11, 0.15)',
            color: 'var(--admin-accent)',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>←</span>
        </button>
      )}

      {/* TOP FLOATING HEADER HUD */}
      <div className="multisite-hud-panel multisite-hud-row" style={{
        position: 'absolute', top: 0, left: 0, height: 40,
        borderRadius: '0 0 4px 0', width: '100%', zIndex: 1010,
        padding: '0 12px', display: 'flex', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--admin-border)', paddingRight: 12 }}>
          {/* Accent Bar */}
          <div style={{ width: 4, height: 24, background: 'var(--admin-accent)', borderRadius: '2px' }} />

          <img
            alt="StationOS"
            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM0NGZmODgiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjMDI4NGM3IiAvPjwvbGluZWFyR3JhZGllbnQ+PGZpbHRlciBpZD0iZ2xvdyI+PGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iMyIgcmVzdWx0PSJjb2xvcmVkQmx1ciIvPjxmZU1lcmdlPjxmZU1lcmdlTm9kZSBpbj0iY29sb3JlZEJsdXIiLz48ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz48L2ZlTWVyZ2U+PC9maWx0ZXI+PC9kZWZzPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ3JhZCkiIHN0cm9rZS13aWR0aD0iNiIgZmlsdGVyPSJ1cmwoI2dsb3cpIi8+PHBhdGggZD0iTTUwIDE1IEw4MCAzNSBMODAgNjUgTDUwIDg1IEwyMCA2NSBMMjAgMzUgWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjMiIG9wYWNpdHk9IjAuNSIvPjxwYXRoIGQ9Ik01NSAyNSBMMzUgNTUgTDUwIDU1IEw0NSA3NSBMNjUgNDUgTDUwIDQ1IFoiIGZpbGw9IiM0NGZmODgiIGZpbHRlcj0idXJsKCNnbG93KSIvPjwvc3ZnPg=="
            style={{ width: 28, height: 28, flexShrink: 0 }}
          />

          <span style={{ fontSize: '0.9rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {selectedView ? selectedView.station.name : MULTISITE_TAB_TITLES[activeTab]}
          </span>

        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            background: 'rgba(15, 23, 42, 0.58)',
            border: '1px solid var(--admin-border)',
            borderRadius: 4,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)'
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
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--admin-border)' }} />
            <button onClick={() => setShowLogoutConfirm(true)} className="btn-industrial" style={{ padding: '0 8px', display: 'flex', alignItems: 'center', gap: 4, height: 24, fontSize: '0.65rem', color: 'var(--admin-danger)', borderColor: 'transparent' }}>
              <LogOut size={11} />
            </button>
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
                const base = resolveWebUrl(station.apiUrl || '');
                if (!base) return;
                window.open(`${base}/login?embed=1&u=admin&p=Admin%40123&next=/realtime`, '_blank');
              }}
            />
          </Suspense>
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
          <CentralLogView stations={stations} />
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
          <CentralReportsView stations={stations} views={views} globalStats={globalStats} selectedStationId={selectedStationId} />
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
            overflow: 'auto',
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
              width: showLeftPanel ? 200 : 0,
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
                <div style={{ display: 'flex', gap: 1, marginTop: 4 }}>
                  <button
                    onClick={() => setStatusFilter('all')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'all' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'all' ? 'var(--admin-text)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    TẤT CẢ
                  </button>
                  <button
                    onClick={() => setStatusFilter('warning')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'warning' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'warning' ? 'var(--admin-danger)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    LỖI
                  </button>
                  <button
                    onClick={() => setStatusFilter('normal')}
                    style={{
                      flex: 1, fontSize: 8, padding: '2px 0', border: '1px solid var(--admin-border)',
                      background: statusFilter === 'normal' ? 'var(--admin-border)' : 'transparent',
                      color: statusFilter === 'normal' ? 'var(--admin-success)' : 'var(--admin-text-muted)',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    OK
                  </button>
                </div>

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
                  onClick={() => setIsAddModalOpen(true)}
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
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span
                                    style={{
                                      width: 7,
                                      height: 7,
                                      borderRadius: '50%',
                                      background: isOnline ? 'var(--admin-success)' : 'var(--admin-danger)',
                                      boxShadow: isOnline ? '0 0 6px var(--admin-success)' : '0 0 6px var(--admin-danger)'
                                    }}
                                    title={isOnline ? 'Online' : 'Offline'}
                                  />
                                  <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                                    {v.kpi.devicesOnline}/{v.kpi.devicesTotal}
                                  </span>
                                  {isWarning ? (
                                    <span style={{
                                      fontSize: 8, background: 'rgba(239,68,68,0.15)', color: 'var(--admin-danger)',
                                      border: '1px solid rgba(239,68,68,0.3)', padding: '0px 3px', fontWeight: 900,
                                      height: 12, display: 'flex', alignItems: 'center'
                                    }}>
                                      🔴{v.kpi.alerts}
                                    </span>
                                  ) : (
                                    <span style={{
                                      fontSize: 8, background: 'rgba(16,185,129,0.1)', color: 'var(--admin-success)',
                                      border: '1px solid rgba(16,185,129,0.2)', padding: '0px 3px', fontWeight: 900,
                                      height: 12, display: 'flex', alignItems: 'center'
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
                      const provinceAlerts = group.views.reduce((sum, view) => sum + view.kpi.alerts, 0);
                      const totalDevices = group.views.reduce((sum, view) => sum + view.kpi.devicesTotal, 0);
                      const onlineDevices = group.views.reduce((sum, view) => sum + view.kpi.devicesOnline, 0);
                      const hasWarning = provinceAlerts > 0;

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
                                fontSize: '0.66rem',
                                fontWeight: 900,
                                color: 'var(--admin-accent)',
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>
                                {group.province}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.56rem', color: 'var(--admin-text-muted)', fontWeight: 800, flexShrink: 0 }}>
                              {group.views.length} TRẠM
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 22 }}>
                            <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                              {onlineDevices}/{totalDevices} online
                            </span>
                            {hasWarning ? (
                              <span style={{
                                fontSize: 8,
                                background: 'rgba(239,68,68,0.15)',
                                color: 'var(--admin-danger)',
                                border: '1px solid rgba(239,68,68,0.3)',
                                padding: '0px 4px',
                                fontWeight: 900,
                                height: 12,
                                display: 'flex',
                                alignItems: 'center'
                              }}>
                                🔴{provinceAlerts}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 8,
                                background: 'rgba(16,185,129,0.1)',
                                color: 'var(--admin-success)',
                                border: '1px solid rgba(16,185,129,0.2)',
                                padding: '0px 4px',
                                fontWeight: 900,
                                height: 12,
                                display: 'flex',
                                alignItems: 'center'
                              }}>
                                🟢OK
                              </span>
                            )}
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
                position: 'absolute', top: 74, left: 0, bottom: 0,
                width: showRightPanel ? 200 : 0,
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
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--admin-border-light)', paddingBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase' }}>
                        Chi tiết
                      </div>
                      <h3 style={{
                        fontSize: '0.7rem', fontWeight: 800, margin: '1px 0', color: 'var(--admin-text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {selectedView.station.code || selectedView.station.id}
                      </h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => navigate(`/alerts-history?stationId=${selectedView.station.id}`)}
                        style={{ background: 'var(--admin-accent)', border: 'none', cursor: 'pointer', color: '#fff', padding: '2px 6px', borderRadius: 2, fontSize: '0.6rem', fontWeight: 700 }}
                        title="Xem lịch sử hệ thống của trạm này"
                      >
                        LỊCH SỬ
                      </button>
                      <button
                        onClick={() => setSelectedStationId(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-muted)', padding: 1 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>

                  {selectedView.station.apiUrl ? (
                    <button
                      onClick={() => {
                        const base = resolveWebUrl(selectedView.station.apiUrl || '');
                        window.open(`${base}/login?embed=1&u=admin&p=Admin%40123&next=/realtime`, '_blank');
                      }}
                      style={{
                        width: '100%', marginTop: 8, padding: '6px 0',
                        background: 'rgba(16,185,129,0.12)', border: '1px solid var(--admin-success)',
                        color: 'var(--admin-success)', cursor: 'pointer', fontSize: '0.7rem',
                        fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        letterSpacing: 0.5, textTransform: 'uppercase'
                      }}
                    >
                      <LogIn size={12} /> Vào trạm
                    </button>
                  ) : (
                    <div style={{
                      width: '100%', marginTop: 8, padding: '6px 0',
                      border: '1px solid var(--admin-border)', textAlign: 'center',
                      color: 'var(--admin-text-muted)', fontSize: '0.65rem', fontWeight: 700
                    }}>
                      Chưa cấu hình URL trạm
                    </div>
                  )}

                  <div className="custom-hud-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
                    <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 6 }}>
                      <div style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>KẾT NỐI TRẠM</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 900, color: selectedView.station.connectionStatus === 'online' ? 'var(--admin-success)' : 'var(--admin-danger)' }}>
                          {selectedView.station.connectionStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
                        </span>
                        <span style={{ fontSize: '0.62rem', color: 'var(--admin-text-muted)', textAlign: 'right' }}>
                          {selectedView.station.lastSeenAt ? fmtDateTime(selectedView.station.lastSeenAt) : 'Chưa có dữ liệu'}
                        </span>
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 900,
                        color: selectedView.kpi.alerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)'
                      }}>
                        {selectedView.kpi.alerts > 0 ? Math.max(95 - selectedView.kpi.alerts * 15, 30) : 100}%
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>HEALTH</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 4 }}>
                        <div style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>ONLINE</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800 }}>
                          {selectedView.kpi.devicesOnline}/{selectedView.kpi.devicesTotal}
                        </div>
                      </div>

                      <div style={{ background: 'var(--admin-hover)', border: '1px solid var(--admin-border-light)', padding: 4 }}>
                        <div style={{ fontSize: 8, color: 'var(--admin-text-muted)', fontWeight: 800 }}>ALERTS</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: selectedView.kpi.alerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text)' }}>
                          {selectedView.kpi.alerts}
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontSize: 8, fontWeight: 800, color: 'var(--admin-text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
                        Alerts
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
                </div>
              </div>
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

              {/* URL API trạm con */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>
                  URL TRẠM CON *
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="192.168.10.102:5173  (http:// tự động thêm)"
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
                    ● Không thể kết nối — kiểm tra lại URL và trạng thái trạm con
                  </span>
                )}
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
  stations, views, globalStats, selectedStationId,
}: {
  stations: Station[];
  views: StationView[];
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
    // dropdown
    dropdown: { height: 28, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 180 } as React.CSSProperties,
    dropdownMenu: { position: 'fixed', zIndex: 9999, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 3, maxHeight: 240, overflow: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.45)', minWidth: 180 } as React.CSSProperties,
    dropdownItem: (active: boolean) => ({ padding: '5px 10px', fontSize: '.65rem', cursor: 'pointer', color: active ? 'var(--admin-accent)' : 'var(--admin-text)', background: active ? 'var(--admin-layer-3)' : 'transparent', fontWeight: active ? 700 : 400 } as React.CSSProperties),
    // table
    th: { padding: '6px 12px', textAlign: 'left' as const, fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', whiteSpace: 'nowrap' as const },
    td: { padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.7rem', verticalAlign: 'middle' as const },
    pill: (c: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 6 } as React.CSSProperties),
    pillBar: (c: string) => ({ width: 3, height: 12, borderRadius: 1, background: c, flexShrink: 0 } as React.CSSProperties),
    pillLbl: { fontSize: '.7rem', fontWeight: 700 } as React.CSSProperties,
    // misc
    row: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
    flex1: { flex: 1 } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 8, padding: '48px 24px', color: 'var(--admin-text-muted)', opacity: .5, textAlign: 'center' as const },
    spin: { animation: 'crv-spin 1s linear infinite' } as React.CSSProperties,
  };

  const [scopeStationId, setScopeStationId] = useState(selectedStationId || '');
  const [history, setHistory] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (selectedStationId) setScopeStationId(selectedStationId); }, [selectedStationId]);

  const scopeLabel = useMemo(() => {
    const v = views.find(x => x.station.id === scopeStationId);
    return v ? v.station.name : `Toàn bộ hệ thống (${views.length} trạm)`;
  }, [views, scopeStationId]);

  const load = async () => {
    setLoading(true);
    try {
      const items = await stationApi.getReports(scopeStationId || undefined);
      setHistory(items.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()));
    } catch { setHistory([]); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [scopeStationId]);

  const gen = async (type: 'daily' | 'monthly' | 'event') => {
    const now = new Date(), from = new Date(now);
    if (type === 'daily') from.setDate(now.getDate() - 1);
    if (type === 'monthly') from.setDate(now.getDate() - 30);
    if (type === 'event') from.setDate(now.getDate() - 7);
    setGenerating(type);
    try { await stationApi.generateReport({ stationId: scopeStationId || undefined, type, from: from.toISOString(), to: now.toISOString() }); await load(); }
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
        <div style={{ position: 'relative' }}>
          {menuOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setMenuOpen(false)} />}
          <button ref={btnRef} style={S.dropdown} onClick={() => {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setMenuPos({ top: r.bottom + 2, left: r.left, width: r.width });
            setMenuOpen(o => !o);
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scopeLabel}</span>
            <span style={{ fontSize: '.55rem', opacity: .4 }}>▾</span>
          </button>
          {menuOpen && (
            <div style={{ ...S.dropdownMenu, top: menuPos.top, left: menuPos.left, width: Math.max(menuPos.width, 200) }}>
              <div style={S.dropdownItem(!scopeStationId)} onClick={() => { setScopeStationId(''); setMenuOpen(false); }}>
                Toàn bộ hệ thống ({views.length} trạm)
              </div>
              {views.map(v => (
                <div key={v.station.id} style={S.dropdownItem(scopeStationId === v.station.id)}
                  onClick={() => { setScopeStationId(v.station.id); setMenuOpen(false); }}>
                  {(v.station.code ? v.station.code + ' · ' : '') + v.station.name}
                </div>
              ))}
            </div>
          )}
        </div>
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
              <th style={S.th}>Loại</th><th style={S.th}>Trạm</th><th style={S.th}>Kỳ báo cáo</th><th style={S.th}>Ngày tạo</th><th style={{ ...S.th, textAlign: 'right', width: 80 }}></th>
            </tr></thead>
            <tbody>
              {filtered.map(r => {
                const sname = stations.find(s => s.id === r.stationId)?.name;
                const c = tc(r.type);
                return (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td style={S.td}><div style={S.pill(c)}><span style={S.pillBar(c)} /><span style={S.pillLbl}>{tl(r.type)}</span></div></td>
                    <td style={S.td}>{sname || <span style={{ ...S.muted, fontStyle: 'italic' }}>Toàn hệ thống</span>}</td>
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
type TimeRange = 'today' | '7d' | '30d' | 'all';

interface MergedLogItem {
  id: string;
  ts: string;
  type: LogType;
  stationId?: string;
  stationName?: string;
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

function CentralLogView({ stations }: { stations: Station[] }) {
  const [logType, setLogType] = useState<LogType>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [scopeStationId, setScopeStationId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<MergedLogItem[]>([]);
  const [selectedLog, setSelectedLog] = useState<MergedLogItem | null>(null);
  const [showDetail, setShowDetail] = useState(true);

  const dates = useMemo(() => fmtTimeRange(timeRange === 'all' ? '30d' : timeRange), [timeRange]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const from = timeRange === 'all' ? undefined : dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = timeRange === 'all' ? undefined : dates.to ? new Date(dates.to + 'T23:59:59').toISOString() : undefined;
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
          action: l.action, detail: l.entityType || 'SYS',
          user: l.fullName || l.username || 'system',
          entityType: l.entityType, ipAddress: l.ipAddress,
          oldValue: l.oldValue, newValue: l.newValue,
        })),
        ...login.map(l => ({
          id: l.id, ts: l.ts, type: 'login' as LogType,
          stationId: l.stationId, stationName: l.stationName,
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
  }, [dates, scopeStationId, timeRange]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

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

  const S = {
    toolbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', flexShrink: 0, flexWrap: 'wrap' as const },
    btn: { height: 26, padding: '0 10px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties,
    btnActive: (c: string) => ({ height: 26, padding: '0 10px', borderRadius: 3, border: `1px solid ${c}`, background: `${c}18`, color: c, fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, letterSpacing: '.04em', whiteSpace: 'nowrap' } as React.CSSProperties),
    dropdown: { height: 28, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 160 } as React.CSSProperties,
    input: { height: 26, padding: '0 8px', borderRadius: 3, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', fontSize: '.62rem', fontWeight: 600, outline: 'none', minWidth: 160 } as React.CSSProperties,
    th: { padding: '6px 12px', textAlign: 'left' as const, fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', whiteSpace: 'nowrap' as const },
    td: { padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.7rem', verticalAlign: 'middle' as const },
    pill: (c: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 6 } as React.CSSProperties),
    pillBar: (c: string) => ({ width: 3, height: 12, borderRadius: 1, background: c, flexShrink: 0 } as React.CSSProperties),
    pillLbl: { fontSize: '.7rem', fontWeight: 600 } as React.CSSProperties,
    muted: { color: 'var(--admin-text-muted)' } as React.CSSProperties,
    empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', color: 'var(--admin-text-muted)', opacity: 0.5 } as React.CSSProperties,
    spin: { animation: 'crv-spin 1s linear infinite' } as React.CSSProperties,
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

        <span style={{ fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em' }}>THỜI GIAN</span>
        {(Object.entries({ today: 'HÔM NAY', '7d': '7 NGÀY', '30d': '30 NGÀY', all: 'TẤT CẢ' }) as [TimeRange, string][]).map(([v, label]) => (
          <button key={v} style={timeRange === v ? S.btnActive('var(--admin-accent)') : S.btn}
            onClick={() => setTimeRange(v)}>
            <Clock size={10} />{label}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: 'var(--admin-border)', margin: '0 4px' }} />

        <span style={{ fontSize: '.58rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.1em' }}>TRẠM</span>
        <select style={S.dropdown} value={scopeStationId} onChange={e => setScopeStationId(e.target.value)}>
          <option value="">TẤT CẢ TRẠM ({stations.length})</option>
          {stations.map(s => (
            <option key={s.id} value={s.id}>{(s.code ? s.code + ' · ' : '') + s.name}</option>
          ))}
        </select>

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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...S.th, width: 140 }}>THỜI GIAN</th>
                <th style={{ ...S.th, width: 100 }}>TRẠM</th>
                <th style={{ ...S.th, width: 100 }}>LOẠI</th>
                <th style={S.th}>NỘI DUNG</th>
                <th style={{ ...S.th, width: 130 }}>NGƯỜI DÙNG</th>
              </tr></thead>
              <tbody>
                {filtered.map(l => {
                  const c = LOG_TYPE_COLORS[l.type];
                  const isSelected = selectedLog?.id === l.id;
                  return (
                    <tr key={l.id}
                      onClick={() => setSelectedLog(isSelected ? null : l)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--admin-layer-2)' : 'transparent',
                      }}>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '.62rem', ...S.muted }}>
                        {fmtDateTime(l.ts)}
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: '.62rem', fontWeight: 600 }}>
                          {l.stationName || <span style={{ ...S.muted, fontStyle: 'italic' }}>—</span>}
                        </span>
                      </td>
                      <td style={S.td}>
                        <div style={S.pill(c)}>
                          <span style={S.pillBar(c)} />
                          <span style={S.pillLbl}>{LOG_TYPE_LABELS[l.type]}</span>
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ fontWeight: 700, fontSize: '.68rem' }}>{l.action}</span>
                        {l.detail && <span style={{ ...S.muted, fontSize: '.58rem', marginLeft: 6 }}>{l.detail}</span>}
                      </td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: '.6rem', ...S.muted }}>
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
                  <DetailRow label="HÀNH ĐỘNG" value={selectedLog.action} />
                  <DetailRow label="CHI TIẾT" value={selectedLog.detail} />
                  <DetailRow label="NGƯỜI DÙNG" value={selectedLog.user} />
                  {selectedLog.ipAddress && <DetailRow label="IP" value={selectedLog.ipAddress} />}
                  {selectedLog.entityType && <DetailRow label="ĐỐI TƯỢNG" value={selectedLog.entityType} />}
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
                      {selectedLog.oldValue && (
                        <div style={{ marginBottom: 4 }}>
                          <span style={{ fontSize: '.5rem', color: '#ef4444', fontWeight: 700 }}>CŨ</span>
                          <pre style={{ fontSize: '.55rem', background: 'var(--admin-layer-2)', padding: 6, borderRadius: 3, overflow: 'auto', maxHeight: 80, margin: '2px 0 0' }}>
                            {typeof selectedLog.oldValue === 'string' ? selectedLog.oldValue : JSON.stringify(selectedLog.oldValue, null, 2)}
                          </pre>
                        </div>
                      )}
                      {selectedLog.newValue && (
                        <div>
                          <span style={{ fontSize: '.5rem', color: '#22c55e', fontWeight: 700 }}>MỚI</span>
                          <pre style={{ fontSize: '.55rem', background: 'var(--admin-layer-2)', padding: 6, borderRadius: 3, overflow: 'auto', maxHeight: 80, margin: '2px 0 0' }}>
                            {typeof selectedLog.newValue === 'string' ? selectedLog.newValue : JSON.stringify(selectedLog.newValue, null, 2)}
                          </pre>
                        </div>
                      )}
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
