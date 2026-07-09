import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Radio, Thermometer, Zap,
  MapPin, ChevronRight, ChevronDown, X,
  Shield, Wifi, WifiOff, TrendingUp, Maximize2, Crosshair, Video, BarChart3,
  RefreshCw, ShieldCheck, Loader2, Download, FileSpreadsheet, FileText, RotateCw
} from 'lucide-react';
import Chart from 'chart.js/auto';
import { AI_ENGINE_URL } from '@/utils/env';
import { getCSSColor } from '@/utils/theme-colors';
import {
  stationApi,
  type AlertItem,
  type Device,
  type HealthScore,
  type SensorPoint,
  type Station,
  type CameraDevice,
  type Province,
} from '@/services/StationApiService';
import { useStationStore } from '@/store';
import { MULTISITE_RETURN_TAB_KEY } from '@/utils/centralAccess';
import { showToast } from '@/utils/toast';
import './AnalyticsLayout.css';

// ── Types ──────────────────────────────────────────────────────

interface StationAnalyticsSnapshot {
  station: Station;
  devices: Device[];
  deviceTotal: number;
  points: SensorPoint[];
  healthScores: HealthScore[];
  avgHealth: number | null;
  onlineDevices: number;
  openAlerts: number;
  warningPdPoints: number;
  hottestPoint: { value: number; label: string } | null;
}

type MetricRow = {
  key: string;
  label: string;
  value: string;
  meta: string;
  time: string;
};

// ── Helpers ────────────────────────────────────────────────────

const isThermalPoint = (point: SensorPoint) =>
  point.unit?.includes('C') || /nhiet|temp|thermal/i.test(point.pointId || '');

const isPdPoint = (point: SensorPoint) => /pd|phong_dien/i.test(point.pointId || '');

const sortMetricRows = (a: MetricRow, b: MetricRow) =>
  a.label.localeCompare(b.label, 'vi', { numeric: true });

const todayIsoDate = () => new Date().toISOString().split('T')[0] || '';

const getHealthClass = (score: number | null) => {
  if (score == null) return { label: 'Chưa đủ dữ liệu', color: 'var(--admin-text-muted)' };
  if (score < 50) return { label: 'Nguy cơ cao', color: 'var(--admin-danger)' };
  if (score < 75) return { label: 'Cần theo dõi', color: '#f59e0b' };
  return { label: 'Ổn định', color: '#10b981' };
};

const getThermalClass = (value: number | null) => {
  if (value == null) return { label: 'Không có dữ liệu', color: 'var(--admin-text-muted)' };
  if (value >= 80) return { label: 'Nguy hiểm', color: 'var(--admin-danger)' };
  if (value >= 60) return { label: 'Bất thường', color: '#f59e0b' };
  return { label: 'Bình thường', color: '#10b981' };
};

const getPdClass = (count: number) => {
  if (count >= 3) return { label: 'Đáng lo', color: 'var(--admin-danger)' };
  if (count >= 1) return { label: 'Có dấu hiệu', color: '#f59e0b' };
  return { label: 'Ổn định', color: '#10b981' };
};

function parseLocation(raw?: string): { lat?: number; lng?: number; address?: string } {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function getStationEndpointInfo(station: Station) {
  const rawUrl = station.apiUrl || station.webUrl;
  if (!rawUrl) {
    return { host: '—', ip: '—', port: '—' };
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname || '—';
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : '—';
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '—');
    return { host, ip, port };
  } catch {
    return { host: rawUrl, ip: '—', port: '—' };
  }
}

// ── Cabinet Summary Helper ─────────────────────────────────────

function getCabinetSummary(points: SensorPoint[], devices: Device[]) {
  const t1 = points.find(p => p.pointId === 'nhiet_do_pha_1' || p.pointId === 'temp_1')?.value ?? null;
  const t2 = points.find(p => p.pointId === 'nhiet_do_pha_2' || p.pointId === 'temp_2')?.value ?? null;
  const t3 = points.find(p => p.pointId === 'nhiet_do_pha_3' || p.pointId === 'temp_3')?.value ?? null;
  const pdVal = points.find(p => p.pointId === 'phong_dien' || p.pointId === 'pd')?.value ?? null;
  const cabinetDevices = devices.filter(d => d.type === 'cabinet' || d.type === 'plc_s7');
  const thermalCameras = devices.filter(d => d.type === 'camera_thermal' || d.type === 'camera_dual');
  const pdCameras = devices.filter(d => d.type === 'camera_pd' || d.type === 'camera_dual');
  return { t1, t2, t3, pdVal, cabinetCount: cabinetDevices.length, thermalCameraCount: thermalCameras.length, pdCameraCount: pdCameras.length };
}

function fmtTemp(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}°C`;
}
function fmtDb(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)} dB`;
}

// ── Mini KPI Badge ────────────────────────────────────────────

function KpiBadge({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', background: 'var(--admin-layer-2)', borderRadius: 0, border: '1px solid var(--admin-border)' }}>
      <span style={{ color: color || 'var(--admin-accent)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <div>
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{label}</div>
        <div style={{ fontSize: '.85rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}

function MetricSectionCard({
  title,
  accent,
  rows,
  emptyText,
}: {
  title: string;
  accent: string;
  rows: Array<{ key: string; label: string; value: string; meta?: string; time?: string }>;
  emptyText: string;
}) {
  return (
    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '.58rem', fontWeight: 900, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>{rows.length}</div>
      </div>
      <div style={{ padding: '6px 0', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0, maxHeight: 220, overflowY: 'auto' }} className="sidebar-scroll">
        {rows.length > 0 ? rows.map(row => (
          <div key={row.key} style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid var(--admin-border-light)' }}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: '.72rem', fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</div>
              <div style={{ fontSize: '.54rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--admin-font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.meta || row.time || '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '.82rem', fontWeight: 900, color: accent, fontFamily: 'var(--admin-font-mono)' }}>{row.value}</div>
              {row.time && <div style={{ fontSize: '.5rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--admin-font-mono)' }}>{row.time}</div>}
            </div>
          </div>
        )) : (
          <div style={{ padding: '10px 12px', color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{emptyText}</div>
        )}
      </div>
    </div>
  );
}

const normalizeLabel = (value: string) => (value || '').normalize('NFC').toLowerCase().trim().replace(/[\s_]/g, '');

const inferAiTargetsFromHistory = (history: Array<Record<string, any>>) => {
  const seen = new Set<string>();
  history.forEach(item => {
    if (!item) return;
    Object.keys(item).forEach(key => {
      const match = key.match(/^(.*)_(actual|pred)$/);
      if (!match) return;
      const base = match[1];
      if (!base || base === 'timestamp' || base === 'full_ts' || base === 'is_future') return;
      seen.add(base);
    });
  });
  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
};

const normalizeAiHistory = (payload: any): Array<Record<string, any>> => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

function ThermalForecastPanel({ station, devices }: { station: Station; devices: Device[] }) {
  const [cameras, setCameras] = useState<Array<Device | CameraDevice>>([]);
  const [selectedCamera, setSelectedCamera] = useState<Device | CameraDevice | null>(null);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<{ status: string; last_updated: string }>({ status: 'Idle', last_updated: '—' });
  const [targets, setTargets] = useState<string[]>([]);
  const [historyData, setHistoryData] = useState<Array<Record<string, any>>>([]);
  const [latestPrediction, setLatestPrediction] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [roiPoints, setRoiPoints] = useState<any[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);
  const [remoteKpi, setRemoteKpi] = useState<any | null>(null);
  const [latestPoints, setLatestPoints] = useState<SensorPoint[]>([]);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const directPoints = Array.isArray(remoteKpi?.points) && remoteKpi.points.length > 0 ? remoteKpi.points : latestPoints;
  const historyDeviceId = selectedCamera?.id || directPoints?.[0]?.deviceId || '';
  const sourceName = selectedCamera?.name || directPoints?.[0]?.deviceId || 'Không xác định';
  const remotePoints = directPoints;
  const latestDirectTime = useMemo(() => {
    let latest = '';
    for (const point of remotePoints) {
      const t = String(point?.time || '');
      if (t && (!latest || t > latest)) latest = t;
    }
    return latest ? latest.replace('T', ' ').slice(0, 19) : '—';
  }, [remotePoints]);

  const aiDeviceCandidates = useMemo(() => {
    const candidates = [
      selectedCamera?.id,
      selectedCamera?.config?.go2rtc_thermal,
      selectedCamera?.config?.go2rtc_id,
      directPoints?.[0]?.deviceId,
      remoteKpi?.points?.[0]?.deviceId,
    ];
    return Array.from(new Set(candidates.filter((value): value is string => !!value && String(value).trim().length > 0)));
  }, [selectedCamera, directPoints, remoteKpi]);

  const remotePointMap = useMemo(() => {
    const map = new Map<string, any>();
    remotePoints.forEach((point: any) => {
      const keys = [point.pointId, point.name, point.label, point.deviceId];
      keys.forEach(key => {
        if (!key) return;
        map.set(normalizeLabel(String(key)), point);
      });
    });
    return map;
  }, [remotePoints]);

  const formatRemotePointValue = (point: any) => {
    if (!point) return '—';
    const value = point.value;
    if (value == null || value === '') return '—';
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    const unit = String(point.unit || '').trim();
    if (/db/i.test(unit)) return `${num.toFixed(1)} dB`;
    if (unit.includes('°C') || unit.toLowerCase() === 'c' || /temp|nhiet|thermal/i.test(String(point.pointId || ''))) return `${num.toFixed(1)}°C`;
    return unit ? `${num.toFixed(1)} ${unit}` : num.toFixed(1);
  };

  const formatRemotePointTime = (point: any) => {
    if (!point?.time) return '';
    const time = String(point.time);
    const parts = time.includes('T') ? time.split('T') : time.split(' ');
    return parts.length > 1 ? (parts[1] || '').slice(0, 8) : time.slice(11, 19);
  };

  const resolvePointValue = (item: any) => {
    const keys = [item?.pointId, item?.label, item?.name, item?.id];
    for (const key of keys) {
      if (!key) continue;
      const found = remotePointMap.get(normalizeLabel(String(key)));
      if (found) return found;
    }
    return null;
  };

  const thermalPointRows = useMemo(() => {
    return remotePoints
      .filter((point: any) => isThermalPoint(point) && !isPdPoint(point))
      .map((point: any, idx: number) => ({
        key: `${point.deviceId || 'dev'}-${point.pointId || point.name || point.label || idx}`,
        label: point.name || point.label || point.pointId || 'Điểm nhiệt',
        value: formatRemotePointValue(point),
        meta: point.deviceId || point.pointId || '—',
        time: formatRemotePointTime(point),
      }))
      .sort(sortMetricRows);
  }, [remotePoints]);

  const pdPointRows = useMemo(() => {
    return remotePoints
      .filter((point: any) => isPdPoint(point) || /db/i.test(String(point.unit || '')))
      .map((point: any, idx: number) => ({
        key: `${point.deviceId || 'dev'}-${point.pointId || point.name || point.label || idx}`,
        label: point.name || point.label || point.pointId || 'PD',
        value: formatRemotePointValue(point),
        meta: point.deviceId || point.pointId || '—',
        time: formatRemotePointTime(point),
      }))
      .sort(sortMetricRows);
  }, [remotePoints]);

  const thermalBoundaryRows = useMemo(() => {
    return (remoteKpi?.boundaries || [])
      .filter((b: any) => String(b.type || '').toLowerCase() === 'roi' || String(b.type || '').toLowerCase() === 'thermal')
      .map((b: any) => {
        const point = resolvePointValue(b);
        return {
          key: b.id || b.name,
          label: b.name || 'Vùng nhiệt',
          value: point ? formatRemotePointValue(point) : '—',
          meta: point?.pointId || point?.name || b.deviceId || 'chưa map',
          time: point ? formatRemotePointTime(point) : '',
        };
      })
      .sort(sortMetricRows);
  }, [remoteKpi, remotePointMap]);

  const pdBoundaryRows = useMemo(() => {
    return (remoteKpi?.boundaries || [])
      .filter((b: any) => String(b.type || '').toLowerCase() === 'pd')
      .map((b: any) => {
        const point = resolvePointValue(b);
        return {
          key: b.id || b.name,
          label: b.name || 'Vùng PD',
          value: point ? formatRemotePointValue(point) : '—',
          meta: point?.pointId || point?.name || b.deviceId || 'chưa map',
          time: point ? formatRemotePointTime(point) : '',
        };
      })
      .sort(sortMetricRows);
  }, [remoteKpi, remotePointMap]);

  const thermalRoiRows = useMemo(() => {
    const roiRows = (remoteKpi?.roiPoints || [])
      .map((p: any) => {
        const point = resolvePointValue(p);
        return {
          key: p.id || p.pointId || p.label || p.name,
          label: p.label || p.name || p.pointId || 'Điểm nhiệt',
          value: point ? formatRemotePointValue(point) : '—',
          meta: point?.pointId || point?.deviceId || p.deviceId || 'chưa map',
          time: point ? formatRemotePointTime(point) : '',
        };
      });

    if (roiRows.length > 0) {
      return roiRows.sort(sortMetricRows);
    }

    return remotePoints
      .filter((point: any) => /nhiet|temp|thermal/i.test(String(point.pointId || point.label || point.name || '')) || String(point.unit || '').includes('°C'))
      .map((point: any, idx: number) => ({
        key: `${point.deviceId || 'dev'}-${point.pointId || point.label || point.name || idx}`,
        label: point.label || point.name || point.pointId || `Điểm nhiệt ${idx + 1}`,
        value: formatRemotePointValue(point),
        meta: point.pointId || point.deviceId || '—',
        time: formatRemotePointTime(point),
      }))
      .sort(sortMetricRows);
  }, [remoteKpi, remotePointMap, remotePoints]);

  const allRemotePointRows = useMemo(() => {
    return remotePoints.map((point: any, idx: number) => {
      const pid = String(point.pointId || point.label || point.name || `point_${idx + 1}`);
      const unit = String(point.unit || '').trim();
      const pidLower = pid.toLowerCase();
      const kind = /pd|phong_dien/.test(pidLower) || /db/i.test(unit)
        ? 'PD'
        : /nhiet|temp|thermal/.test(pidLower) || unit.includes('°C') || unit.toLowerCase() === 'c'
          ? 'NHIỆT'
          : 'KHÁC';
      return {
        key: `${point.deviceId || 'dev'}-${pid}-${idx}`,
        label: pid,
        value: formatRemotePointValue(point),
        meta: `${kind} • ${point.deviceId || '—'}`,
        time: formatRemotePointTime(point),
      };
    });
  }, [remotePoints]);

  const aiDisplayTargets = useMemo(
    () => (targets.length > 0 ? targets : inferAiTargetsFromHistory(historyData)),
    [targets, historyData]
  );

  const latestPredictionTargets = useMemo(() => {
    if (!latestPrediction) return [];
    return inferAiTargetsFromHistory([latestPrediction]);
  }, [latestPrediction]);

  const filteredTargets = useMemo(() => {
    if (targets.length === 0) return [];
    const camTargetNames = new Set<string>();
    roiPoints.forEach(p => {
      if (p.name) camTargetNames.add(normalizeLabel(p.name));
      if (p.pointId) camTargetNames.add(normalizeLabel(p.pointId));
    });
    boundaries.forEach(b => {
      if (b.name) camTargetNames.add(normalizeLabel(b.name));
    });
    return targets.filter(t => camTargetNames.has(normalizeLabel(t)));
  }, [selectedCamera, targets, roiPoints, boundaries]);

  const liveTime = useMemo(() => {
    if (historyData.length === 0 || aiDisplayTargets.length === 0) return null;
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      if (item && aiDisplayTargets.some(t => item[`${t}_actual`] !== null && item[`${t}_actual`] !== undefined && item[`${t}_actual`] !== '')) {
        return item.timestamp || item.full_ts || null;
      }
    }
    return null;
  }, [historyData, aiDisplayTargets]);

  const forecastTime = useMemo(() => {
    if (historyData.length === 0 || aiDisplayTargets.length === 0) return null;
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      if (item && aiDisplayTargets.some(t => item[`${t}_pred`] !== null && item[`${t}_pred`] !== undefined && item[`${t}_pred`] !== '')) {
        return item.timestamp || item.full_ts || null;
      }
    }
    return null;
  }, [historyData, aiDisplayTargets]);

  const updateStatusAndHistory = useCallback(async (showChartSpinner = true) => {
    try {
      if (showChartSpinner) setChartLoading(true);
      
      let statusData;
      if (station?.id && station.apiUrl) {
        statusData = await stationApi.getRemoteTrainingStatus(station.id);
      } else {
        const statusResp = await fetch(`${AI_ENGINE_URL}/api/training-status`);
        statusData = await statusResp.json();
      }
      setModelStatus(statusData);
      setLatestPrediction(null);

      const requestedDate = selectedDate;
      const fallbackDates: string[] = [requestedDate];
      try {
        const base = new Date(`${requestedDate}T00:00:00`);
        for (let i = 1; i <= 21; i++) {
          const d = new Date(base);
          d.setDate(base.getDate() - i);
          fallbackDates.push(d.toISOString().split('T')[0] || requestedDate);
        }
      } catch {
        // giữ nguyên fallbackDates với ngày hiện tại
      }

      const queryAttempts: Record<string, string>[] = [];
      if (selectedCamera?.id) queryAttempts.push({ device_id: selectedCamera.id });
      if (selectedCamera?.config?.go2rtc_thermal) queryAttempts.push({ stream_id: selectedCamera.config.go2rtc_thermal });
      if (selectedCamera?.config?.go2rtc_id) queryAttempts.push({ stream_id: selectedCamera.config.go2rtc_id });
      if (selectedCamera?.config?.ip) queryAttempts.push({ camera_ip: selectedCamera.config.ip });
      if (directPoints?.[0]?.deviceId) queryAttempts.push({ device_id: directPoints[0].deviceId });
      if (remoteKpi?.points?.[0]?.deviceId) queryAttempts.push({ device_id: remoteKpi.points[0].deviceId });
      queryAttempts.push({});

      let resolvedHistory: Array<Record<string, any>> = [];
      let resolvedTargets: string[] = [];
      let fallbackTargets: string[] = [];
      let resolvedPrediction: Record<string, any> | null = null;

      for (const date of fallbackDates) {
        for (const params of queryAttempts) {
          try {
            let hData;
            let configData;
            let predData;

            if (station?.id && station.apiUrl) {
              const queryObj: Record<string, string> = { points: '1440', date };
              Object.entries(params).forEach(([key, value]) => {
                if (value) queryObj[key] = value;
              });

              const [remoteHist, remoteConfig, remotePred] = await Promise.all([
                stationApi.getRemotePredictionHistory(station.id, queryObj),
                stationApi.getRemotePredictionConfig(station.id, params),
                stationApi.getRemoteLatestPrediction(station.id, params).catch(() => ({}))
              ]);
              hData = remoteHist;
              configData = remoteConfig;
              predData = remotePred;
            } else {
              const query = new URLSearchParams({ points: '1440', date });
              Object.entries(params).forEach(([key, value]) => {
                if (value) query.set(key, value);
              });

              const [historyResp, configResp] = await Promise.all([
                fetch(`${AI_ENGINE_URL}/api/prediction/history?${query.toString()}`),
                fetch(`${AI_ENGINE_URL}/api/config${Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : ''}`)
              ]);
              const predictionResp = await fetch(`${AI_ENGINE_URL}/api/latest-prediction${Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : ''}`);

              hData = await historyResp.json();
              configData = await configResp.json();
              predData = await predictionResp.json().catch(() => ({}));
            }

            const normalizedHistory = normalizeAiHistory(hData);
            const activeTargets = Array.isArray(configData.targets) && configData.targets.length > 0
              ? configData.targets
              : inferAiTargetsFromHistory(normalizedHistory);
            const normalizedPrediction = predData?.prediction && typeof predData.prediction === 'object' ? predData.prediction : null;

            if (activeTargets.length > 0 && fallbackTargets.length === 0) {
              fallbackTargets = activeTargets;
            }

            if (normalizedHistory.length > 0) {
              resolvedHistory = normalizedHistory;
              resolvedTargets = activeTargets;
              resolvedPrediction = normalizedPrediction;
              break;
            }

            if (!resolvedPrediction && normalizedPrediction) {
              resolvedPrediction = normalizedPrediction;
            }
          } catch (err) {
            console.warn('[AI Forecast] Candidate fetch failed:', params, err);
          }
        }
        if (resolvedHistory.length > 0) break;
      }

      if (resolvedTargets.length === 0 && fallbackTargets.length > 0) {
        resolvedTargets = fallbackTargets;
      }

      setTargets(resolvedTargets);
      setActiveFilters(prev => {
        const updated = { ...prev };
        resolvedTargets.forEach((t: string, idx: number) => {
          if (updated[t] === undefined) updated[t] = idx < 2;
        });
        return updated;
      });

      setHistoryData(resolvedHistory);
      setLatestPrediction(resolvedPrediction);
    } catch (err) {
      console.warn('[AI Forecast] Polling failed:', err);
      setHistoryData([]);
      setTargets([]);
      setLatestPrediction(null);
    } finally {
      if (showChartSpinner) setChartLoading(false);
    }
  }, [aiDeviceCandidates, selectedDate]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true);
        if (station.apiUrl) {
          const [kpi, remoteCamerasResp, latest] = await Promise.all([
            stationApi.getRemoteKpi(station.id).catch(() => null),
            stationApi.getRemoteCameras(station.id).catch(() => null),
            stationApi.getLatestPoints(station.id).catch(() => [] as SensorPoint[]),
          ]);
          if (!alive) return;
          setRemoteKpi(kpi);
          setLatestPoints(latest);

          const remoteThermalCameras = (remoteCamerasResp?.cameras || [])
            .map(item => item.device)
            .filter((cam: any) => {
              const type = String(cam?.type || '').toLowerCase().trim();
              const cfg = cam?.config || {};
              return type === 'camera_thermal' || type === 'camera_dual' || !!(cfg.go2rtc_thermal || cfg.rtsp_thermal);
            });
          setCameras(remoteThermalCameras);
          if (remoteThermalCameras.length > 0) {
            const thermalCam = remoteThermalCameras.find((c: any) => c.name?.toLowerCase().includes('thermal') || c.config?.go2rtc_thermal);
            setSelectedCamera((thermalCam || remoteThermalCameras[0]) as any);
          } else {
            setSelectedCamera(null);
          }
        } else {
          setRemoteKpi(null);
          const points = await stationApi.getLatestPoints(station.id).catch(() => [] as SensorPoint[]);
          if (!alive) return;
          setLatestPoints(points);
          const thermalDevices = devices.filter(d => {
            const type = (d.type || '').toLowerCase().trim();
            const cfg = d.config || {};
            const hasThermal = !!(cfg.go2rtc_thermal || cfg.rtsp_thermal);
            return type === 'camera_thermal' || type === 'camera_dual' || hasThermal;
          });
          setCameras(thermalDevices);
          if (thermalDevices.length > 0) {
            const thermalCam = thermalDevices.find(c => c.name?.toLowerCase().includes('thermal') || c.config?.go2rtc_thermal) || thermalDevices[0];
            setSelectedCamera(thermalCam ?? null);
          } else {
            setSelectedCamera(null);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [devices, station.apiUrl, station.id]);

  useEffect(() => {
    if (!historyDeviceId && !station.apiUrl) return;
    const fetchOverlayData = async () => {
      try {
        if (station.apiUrl) {
          setRoiPoints(remoteKpi?.roiPoints || []);
          setBoundaries(remoteKpi?.boundaries || []);
          return;
        }

        if (!selectedCamera?.id) return;
        const [pts, bounds] = await Promise.all([
          stationApi.getRoiPoints(selectedCamera.id),
          stationApi.getBoundaries(selectedCamera.id, 'roi')
        ]);
        setRoiPoints(pts);
        setBoundaries(bounds);
      } catch (err) {
        console.warn('[AI Forecast] Failed to fetch overlay metadata:', err);
        setRoiPoints([]);
        setBoundaries([]);
      }
    };
    fetchOverlayData();
  }, [historyDeviceId, station.apiUrl, remoteKpi]);

  useEffect(() => {
    if (aiDeviceCandidates.length === 0) return;
    updateStatusAndHistory(true);
    const timer = setInterval(() => { updateStatusAndHistory(false); }, 10000);
    return () => clearInterval(timer);
  }, [aiDeviceCandidates, selectedDate, updateStatusAndHistory]);

  useEffect(() => {
    if (!chartRef.current) return;

    const existingChart = Chart.getChart(chartRef.current);
    if (existingChart) existingChart.destroy();
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
    if (historyData.length === 0 || aiDisplayTargets.length === 0) return;

    const xLabels = historyData.map(h => {
      if (!h.full_ts) return h.timestamp;
      const parts = String(h.full_ts).split(' ');
      if (parts.length < 2) return h.timestamp;
      const [datePart, timePart] = parts;
      const dateParts = String(datePart).split('-');
      if (dateParts.length < 3) return h.timestamp;
      const [year, month, day] = dateParts;
      if (!year || !month || !day) return h.timestamp;
      const now = new Date();
      const isToday = now.getFullYear() === parseInt(year) && (now.getMonth() + 1) === parseInt(month) && now.getDate() === parseInt(day);
      return isToday ? timePart : `${day}/${month} ${timePart}`;
    });

    const targetColors = [
      { actual: '#3B82F6', pred: '#93C5FD' }, { actual: '#10B981', pred: '#6EE7B7' },
      { actual: '#F59E0B', pred: '#FCD34D' }, { actual: '#EF4444', pred: '#FCA5A5' },
      { actual: '#8B5CF6', pred: '#C4B5FD' }, { actual: '#EC4899', pred: '#FBCFE8' },
      { actual: '#14B8A6', pred: '#99F6E4' }, { actual: '#F97316', pred: '#FED7AA' },
    ];

    const datasets: any[] = [];
    let currentIdx = 0;
    for (let i = historyData.length - 1; i >= 0; i--) {
      const item = historyData[i];
      if (item && !item.is_future && aiDisplayTargets.some(t => item[`${t}_actual`] !== null)) {
        currentIdx = i;
        break;
      }
    }

    aiDisplayTargets.forEach((target, i) => {
      if (activeFilters[target] === false) return;
      const colors = targetColors[i % targetColors.length] || { actual: '#3B82F6', pred: '#93C5FD' };

      datasets.push({
        label: `${target} (Thực tế)`,
        data: historyData.map(h => h[`${target}_actual`]),
        borderColor: colors.actual,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: colors.actual,
        spanGaps: true,
      });

      datasets.push({
        label: `${target} (Dự báo)`,
        data: historyData.map(h => h[`${target}_pred`]),
        borderColor: colors.pred,
        borderWidth: 1.5,
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 0,
        spanGaps: true,
      });
    });

    const currentLinePlugin = {
      id: 'currentLine',
      afterDraw: (chart: any) => {
        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis = chart.scales.y;
        const xPos = xAxis.getPixelForTick(currentIdx);
        if (!xPos) return;
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]);
        ctx.moveTo(xPos, yAxis.top);
        ctx.lineTo(xPos, yAxis.bottom);
        ctx.stroke();
        ctx.fillStyle = '#ffff00';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('● HIỆN TẠI', xPos - 30, yAxis.top - 8);
        ctx.restore();
      }
    };

    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: { labels: xLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: getCSSColor('--admin-panel'),
            titleColor: getCSSColor('--admin-text'),
            bodyColor: getCSSColor('--admin-text-muted'),
            borderColor: getCSSColor('--admin-border'),
            borderWidth: 1,
            callbacks: {
              label: (context: any) => ` ${context.dataset.label}: ${context.parsed.y?.toFixed(1)}°C`
            }
          }
        },
        scales: {
          x: {
            grid: { color: getCSSColor('--admin-border'), drawTicks: false },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' }, autoSkip: true, maxRotation: 0, maxTicksLimit: 10 }
          },
          y: {
            grid: { color: getCSSColor('--admin-border') },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' }, callback: (v: any) => `${v}°C` },
            suggestedMin: 25,
            suggestedMax: 35
          }
        }
      },
      plugins: [currentLinePlugin]
    });
    return () => chartInst.current?.destroy();
  }, [historyData, aiDisplayTargets, activeFilters]);

  const latestReadings = useMemo(() => {
    if (historyData.length === 0 || aiDisplayTargets.length === 0) return {};
    const readings: Record<string, { actual: number; hasActual: boolean; pred: number; hasPred: boolean }> = {};
    const targetMap: Record<string, string> = {};
    aiDisplayTargets.forEach(t => { targetMap[normalizeLabel(t)] = t; });

    aiDisplayTargets.forEach(t => {
      let actualVal: number | null = null;
      let currentIdx = historyData.length - 1;
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${t}_actual`] != null && item[`${t}_actual`] !== '') {
          actualVal = Number(item[`${t}_actual`]);
          currentIdx = i;
          break;
        }
      }

      let predVal: number | null = null;
      for (let i = historyData.length - 1; i >= 0; i--) {
        const item = historyData[i];
        if (item && item[`${t}_pred`] != null && item[`${t}_pred`] !== '') {
          if (i >= currentIdx - 10) predVal = Number(item[`${t}_pred`]);
          break;
        }
      }

      readings[t] = { actual: actualVal ?? 0.0, hasActual: actualVal != null, pred: predVal ?? 0.0, hasPred: predVal != null };
    });

    const aliasedReadings: Record<string, any> = { ...readings };
    roiPoints.forEach(p => {
      const np = normalizeLabel(p.name || '');
      const nid = normalizeLabel(p.pointId || '');
      const match = targetMap[np] || targetMap[nid];
      if (match && readings[match]) aliasedReadings[p.name || p.pointId] = readings[match];
    });
    boundaries.forEach(b => {
      const nb = normalizeLabel(b.name || '');
      const match = targetMap[nb];
      if (match && readings[match]) aliasedReadings[b.name] = readings[match];
    });

    return aliasedReadings;
  }, [historyData, aiDisplayTargets, roiPoints, boundaries]);

  const toggleFilter = (t: string) => setActiveFilters(prev => ({ ...prev, [t]: !prev[t] }));

  const latestPredictionRows = useMemo(() => {
    if (!latestPrediction) return [];
    return (latestPredictionTargets.length > 0 ? latestPredictionTargets : aiDisplayTargets)
      .map((target) => {
        const value = latestPrediction[`${target}_pred`];
        return {
          key: target,
          label: target,
          value: value == null || value === '' ? '—' : `${Number(value).toFixed(1)}°C`,
          meta: latestPrediction.forecast_timestamp || latestPrediction.issued_at || latestPrediction.input_timestamp || '—',
          time: latestPrediction.issued_at || latestPrediction.forecast_timestamp || '',
        };
      })
      .filter(row => row.value !== '—');
  }, [latestPrediction, latestPredictionTargets, aiDisplayTargets]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!cameraMenuRef.current) return;
      if (!cameraMenuRef.current.contains(event.target as Node)) {
        setCameraMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCameraMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 10, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)' }}>
        <RotateCw size={18} className="animate-spin" color="var(--admin-accent)" />
        <span style={{ fontSize: '.8rem', fontFamily: 'var(--admin-font-mono)' }}>ĐANG ĐỒNG BỘ CẤU HÌNH AI...</span>
        <style dangerouslySetInnerHTML={{ __html: `.animate-spin { animation: spin 1.2s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }` }} />
      </div>
    );
  }

  if (!historyDeviceId && remotePoints.length === 0) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', fontSize: '.8rem', fontFamily: 'var(--admin-font-mono)' }}>
        {station.apiUrl ? 'TRẠM CỤC BỘ CHƯA TRẢ VỀ DỮ LIỆU NHIỆT' : 'TRẠM NÀY CHƯA CÓ DỮ LIỆU NHIỆT'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', padding: '8px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <div style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--admin-text-muted)', letterSpacing: '0.5px' }}>XEM LỊCH SỬ NGÀY:</div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', color: 'var(--admin-text)', fontSize: '.75rem', padding: '4px 10px', borderRadius: 2, outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>
          <span style={{ color: 'var(--admin-accent)' }}>●</span> TỰ ĐỘNG CẬP NHẬT (10S)
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 12, overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: 340, flexShrink: 0, height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12, overflow: 'hidden', minHeight: 0 }}>
          <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)' }}>
              <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>
                CHỌN CAMERA NHIỆT
              </span>
            </div>
            <div style={{ padding: 14, display: 'grid', gap: 10, position: 'relative' }} ref={cameraMenuRef}>
              <button
                type="button"
                onClick={() => cameras.length > 0 && setCameraMenuOpen(v => !v)}
                style={{
                  width: '100%',
                  background: 'var(--admin-layer-2)',
                  border: '1px solid var(--admin-border)',
                  color: cameras.length > 0 ? 'var(--admin-text)' : 'var(--admin-text-muted)',
                  fontSize: '.8rem',
                  fontWeight: 800,
                  padding: '10px 12px',
                  outline: 'none',
                  cursor: cameras.length > 0 ? 'pointer' : 'not-allowed',
                  borderRadius: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedCamera ? (selectedCamera.name || sourceName) : 'Không có camera nhiệt'}
                </span>
                <ChevronDown size={14} style={{ flexShrink: 0, opacity: cameras.length > 0 ? 1 : 0.5 }} />
              </button>
              {cameraMenuOpen && cameras.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 14,
                  right: 14,
                  zIndex: 40,
                  background: 'var(--admin-layer-1)',
                  border: '1px solid var(--admin-border)',
                  boxShadow: '0 18px 36px rgba(0,0,0,0.45)',
                  overflow: 'hidden'
                }}>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }} className="sidebar-scroll">
                    {cameras.map(cam => {
                      const active = cam.id === selectedCamera?.id;
                      return (
                        <button
                          key={cam.id}
                          type="button"
                          onClick={() => {
                            setSelectedCamera(cam);
                            setCameraMenuOpen(false);
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            border: 'none',
                            borderBottom: '1px solid var(--admin-border-light)',
                            background: active ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
                            color: active ? 'var(--admin-accent)' : 'var(--admin-text)',
                            fontSize: '.75rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {cam.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', lineHeight: 1.5 }}>
                {selectedCamera ? 'Chọn camera để lấy dữ liệu nhiệt.' : 'Chưa có camera nhiệt.'}
              </div>
            </div>
          </div>

          <MetricSectionCard
            title="ĐIỂM NHIỆT TRẠM CỤC BỘ"
            accent="#A855F7"
            rows={thermalRoiRows.length > 0 ? thermalRoiRows : allRemotePointRows.filter((row: MetricRow) => /NHIỆT/i.test(row.meta || '') || /nhiet|temp|thermal/i.test(row.label))}
            emptyText="Trạm cục bộ chưa trả về điểm nhiệt."
          />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minWidth: 0 }}>
          <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>DỮ LIỆU TRỰC TIẾP TỪ TRẠM CỤC BỘ</div>
              <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>{station.apiUrl ? 'PROXY MASTER' : 'LOCAL'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, overflow: 'auto' }} className="sidebar-scroll">
              <MetricSectionCard
                title="CHỈ SỐ NHIỆT ĐỘ"
                accent="#3B82F6"
                rows={thermalPointRows}
                emptyText="Chưa có điểm nhiệt từ trạm cục bộ."
              />
              <MetricSectionCard
                title="CHỈ SỐ PD"
                accent="#F59E0B"
                rows={pdPointRows}
                emptyText="Chưa có chỉ số PD từ trạm cục bộ."
              />
              <MetricSectionCard
                title="VÙNG NHIỆT"
                accent="#10B981"
                rows={thermalBoundaryRows}
                emptyText="Chưa có vùng nhiệt hoặc chưa map được dữ liệu."
              />
              <MetricSectionCard
                title="VÙNG PHÓNG ĐIỆN"
                accent="#EF4444"
                rows={pdBoundaryRows}
                emptyText="Chưa có vùng phóng điện hoặc chưa map được dữ liệu."
              />
              <MetricSectionCard
                title="ĐIỂM NHIỆT"
                accent="#8B5CF6"
                rows={thermalRoiRows}
                emptyText="Chưa có điểm nhiệt ROI."
              />
            </div>
            <MetricSectionCard
              title="ĐIỂM NHIỆT THỰC TẾ"
              accent="#A855F7"
              rows={thermalRoiRows}
              emptyText="Chưa có điểm nhiệt từ trạm cục bộ."
            />
          </div>
          <MetricSectionCard
            title="TẤT CẢ ĐIỂM TRẠM CỤC BỘ"
            accent="#22C55E"
            rows={allRemotePointRows}
            emptyText="Trạm cục bộ chưa trả về điểm nào."
          />
          <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>TRẠNG THÁI DỮ LIỆU</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--admin-text)' }}>{station.apiUrl ? (remotePoints.length > 0 ? 'ĐÃ NHẬN DỮ LIỆU TRẠM CỤC BỘ' : 'ĐANG KẾT NỐI TRẠM CỤC BỘ') : 'DỮ LIỆU NỘI BỘ'}</span>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: remotePoints.length > 0 ? 'var(--admin-success)' : 'var(--admin-warning)', animation: 'pulse 2s infinite' }} />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>LẤY DỮ LIỆU GẦN NHẤT</div>
              <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--admin-text)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{latestDirectTime}</div>
            </div>
          </div>

          <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '18px', display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 320 }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: '.62rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px' }}>BIỂU ĐỒ XU HƯỚNG AI</div>
              <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                {historyData.length > 0 && aiDisplayTargets.length > 0 ? 'ĐANG HIỂN THỊ DỰ ĐOÁN' : 'CHƯA CÓ DỮ LIỆU DỰ ĐOÁN'}
              </div>
            </div>
            {historyData.length > 0 && aiDisplayTargets.length > 0 ? (
              <>
                <div style={{ flex: 1, position: 'relative' }}>
                  {chartLoading && (<div style={{ position: 'absolute', inset: 0, background: 'rgba(9, 14, 26, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}><RotateCw className="animate-spin" size={24} color="var(--admin-accent)" /></div>)}
                  <canvas ref={chartRef} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 12, justifyContent: 'center', borderTop: '1px solid var(--admin-border-light)', paddingTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 2, background: '#9CA3AF' }} /><span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--admin-text-muted)', letterSpacing: '.5px' }}>THỰC TẾ (NÉT LIỀN)</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 0, borderBottom: '2px dashed #9CA3AF' }} /><span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--admin-text-muted)', letterSpacing: '.5px' }}>DỰ BÁO AI (NÉT ĐỨT)</span></div>
                </div>
              </>
            ) : latestPredictionRows.length > 0 ? (
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignContent: 'start' }}>
                {latestPredictionRows.map(row => (
                  <div key={row.key} style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{row.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--admin-accent)', fontFamily: 'var(--admin-font-mono)' }}>{row.value}</div>
                    <div style={{ fontSize: '.52rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--admin-font-mono)' }}>{row.meta}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem', textAlign: 'center', lineHeight: 1.6 }}>
                Chưa có dữ liệu dự đoán từ AI Engine cho thiết bị này.
              </div>
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .animate-spin { animation: spin 1.2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
        .sidebar-scroll::-webkit-scrollbar { width: 10px; }
        .sidebar-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: #f59e0b; border-radius: 4px; border: 2px solid #000; }
        .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #fbbf24; }
        .sidebar-scroll { scrollbar-width: auto; scrollbar-color: #f59e0b rgba(0,0,0,0.3); }
      ` }} />
    </div>
  );
}

function PdAnalyticsPanel({ station, devices }: { station: Station; devices: Device[] }) {
  const [cameras, setCameras] = useState<Device[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [eventHistory, setEventHistory] = useState<any[]>([]);
  const [boundaries, setBoundaries] = useState<any[]>([]);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<Chart | null>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);

  // Filter PD cameras
  useEffect(() => {
    const pdDevs = devices.filter(d => d.type === 'camera_pd' || d.type === 'cabinet');
    setCameras(pdDevs);
    if (pdDevs.length > 0) {
      setSelectedCamera(pdDevs[0] ?? null);
    } else {
      setSelectedCamera(null);
    }
  }, [devices]);

  // Click outside helper for camera select dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(e.target as Node)) {
        setCameraMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Fetch boundaries
  useEffect(() => {
    if (!selectedCamera) return;
    let alive = true;
    const fetchBounds = async () => {
      try {
        let bs: any[] = [];
        if (station.apiUrl) {
          // If remote station, fetch remote KPI (which has boundaries)
          const kpi = await stationApi.getRemoteKpi(station.id);
          bs = (kpi?.boundaries || []).filter((b: any) => b.deviceId === selectedCamera.id && b.type?.toLowerCase() === 'pd');
        } else {
          bs = await stationApi.getBoundaries(selectedCamera.id, 'pd');
        }
        if (alive) setBoundaries(bs);
      } catch (err) {
        console.warn('[PD Analytics] Failed to fetch boundaries:', err);
        if (alive) setBoundaries([]);
      }
    };
    fetchBounds();
    return () => { alive = false; };
  }, [selectedCamera, station.apiUrl, station.id]);

  const getEventLevel = useCallback((db: number, currentBoundaries: any[], activeBoundaryName?: string | null) => {
    let warnDb = 20, alarmDb = 45;
    const region = currentBoundaries.find(b => b.name === activeBoundaryName) || currentBoundaries[0];
    if (region) {
      const parsed = typeof region.points === 'string' ? JSON.parse(region.points) : region.points;
      if (parsed) {
        if (parsed.warn_db) warnDb = parsed.warn_db;
        if (parsed.alarm_db) alarmDb = parsed.alarm_db;
      }
    }
    if (db >= alarmDb) return 'alarm';
    if (db >= warnDb) return 'warning';
    return 'event';
  }, []);

  // Load history
  const loadHistory = useCallback(async (camId: string, currentBoundaries: any[], dateStr: string) => {
    try {
      setLoading(true);
      const fromDate = `${dateStr}T00:00:00`;
      const toDate = `${dateStr}T23:59:59`;
      const params = {
        deviceId: camId,
        type: 'partial_discharge',
        from: fromDate,
        to: toDate,
        limit: '100'
      };
      
      let data: any[] = [];
      if (station.apiUrl) {
        data = await stationApi.getRemoteDetections(station.id, params);
      } else {
        const queryParams = new URLSearchParams(params).toString();
        data = await stationApi.getDetections(queryParams);
      }

      setEventHistory(data.reverse().map((d: any) => {
        const db = d.maxTemp || 0;
        return {
          id: d.id,
          time: new Date(d.detectedAt).toLocaleTimeString('vi-VN', { hour12: false }),
          db: db,
          level: getEventLevel(db, currentBoundaries, d.affectedZone)
        };
      }));
    } catch (err) {
      console.error('[PD Analytics] Error loading history:', err);
      setEventHistory([]);
    } finally {
      setLoading(false);
    }
  }, [station.apiUrl, station.id, getEventLevel]);

  useEffect(() => {
    if (!selectedCamera) return;
    loadHistory(selectedCamera.id, boundaries, selectedDate);
  }, [selectedCamera, boundaries, selectedDate, loadHistory]);

  // Render Chart
  useEffect(() => {
    if (!chartRef.current) return;

    const existingChart = Chart.getChart(chartRef.current);
    if (existingChart) existingChart.destroy();
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }

    const xLabels = eventHistory.map(h => h.time);
    const yData = eventHistory.map(h => h.db);

    const getLevelColor = (level: string, alpha = 1) => {
      if (level === 'alarm') return `rgba(239, 68, 68, ${alpha})`;
      if (level === 'warning') return `rgba(245, 158, 11, ${alpha})`;
      return `rgba(59, 130, 246, ${alpha})`;
    };

    const bgColors = eventHistory.map(h => getLevelColor(h.level, 0.7));
    const borderColors = eventHistory.map(h => getLevelColor(h.level, 1));

    chartInst.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: 'Cường độ PD (dB)',
            data: yData,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: 2,
            barThickness: 'flex',
            maxBarThickness: 30
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: getCSSColor('--admin-panel'),
            titleColor: getCSSColor('--admin-text'),
            bodyColor: '#fff',
            borderColor: getCSSColor('--admin-border'),
            borderWidth: 1,
            callbacks: {
              label: (context: any) => {
                const h = eventHistory[context.dataIndex];
                const levelName = h.level === 'alarm' ? 'BÁO ĐỘNG' : h.level === 'warning' ? 'CẢNH BÁO' : 'VƯỢT NGƯỠNG';
                return `${levelName}: ${context.parsed.y.toFixed(1)} dB`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' } }
          },
          y: {
            grid: { color: getCSSColor('--admin-border'), borderDash: [2, 2] } as any,
            ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9, family: 'Consolas' } },
            title: { display: true, text: 'dB', color: 'rgba(255,255,255,0.3)', font: { size: 10 } },
            suggestedMin: 0,
            suggestedMax: 60
          }
        }
      }
    });

    return () => chartInst.current?.destroy();
  }, [eventHistory]);

  const summary = useMemo(() => {
    let alarm = 0, warning = 0, event = 0;
    eventHistory.forEach(h => {
      if (h.level === 'alarm') alarm++;
      else if (h.level === 'warning') warning++;
      else event++;
    });
    return { alarm, warning, event, total: eventHistory.length };
  }, [eventHistory]);

  return (
    <div style={{ display: 'flex', height: 600, gap: 16, overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        {/* Selector Panel */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Camera Selector */}
          <div>
            <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '.5px' }}>THIẾT BỊ TỦ / CAMERA PD</div>
            {cameras.length > 0 ? (
              <div style={{ position: 'relative' }} ref={cameraMenuRef}>
                <button
                  onClick={() => setCameraMenuOpen(!cameraMenuOpen)}
                  style={{
                    width: '100%',
                    background: 'var(--admin-layer-2)',
                    border: '1px solid var(--admin-border)',
                    color: 'var(--admin-text)',
                    padding: '8px 12px',
                    fontSize: '.7rem',
                    fontWeight: 700,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCamera?.name || 'Chọn thiết bị'}
                  </span>
                  <ChevronDown size={14} style={{ transform: cameraMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {cameraMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'var(--admin-panel)',
                    border: '1px solid var(--admin-border)',
                    zIndex: 100,
                    maxHeight: 200,
                    overflowY: 'auto'
                  }}>
                    {cameras.map(c => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setSelectedCamera(c);
                          setCameraMenuOpen(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          fontSize: '.7rem',
                          cursor: 'pointer',
                          background: selectedCamera?.id === c.id ? 'var(--admin-layer-2)' : 'transparent',
                          color: selectedCamera?.id === c.id ? 'var(--admin-accent)' : 'var(--admin-text)',
                          fontWeight: selectedCamera?.id === c.id ? 800 : 500
                        }}
                        className="hover-bg-layer-2"
                      >
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)' }}>Không tìm thấy camera PD nào.</div>
            )}
          </div>

          {/* Date Picker */}
          <div>
            <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '.5px' }}>LỊCH SỬ NGÀY</div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--admin-layer-2)',
                border: '1px solid var(--admin-border)',
                color: 'var(--admin-text)',
                fontSize: '.7rem',
                padding: '8px 12px',
                borderRadius: 0,
                outline: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--admin-font-mono)',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* Counter Summary */}
        <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)' }}>TỔNG SỐ LẦN VƯỢT:</span>
            <span style={{ fontSize: '.9rem', fontWeight: 900, color: 'var(--admin-warning)' }}>{summary.total}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 4 }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: '#ef4444', fontWeight: 800 }}>BÁO ĐỘNG</div>
              <div style={{ fontSize: '12px', fontWeight: 900, color: '#ef4444' }}>{summary.alarm}</div>
            </div>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: '#f59e0b', fontWeight: 800 }}>CẢNH BÁO</div>
              <div style={{ fontSize: '12px', fontWeight: 900, color: '#f59e0b' }}>{summary.warning}</div>
            </div>
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '9px', color: '#3b82f6', fontWeight: 800 }}>VƯỢT NGƯỠNG</div>
              <div style={{ fontSize: '12px', fontWeight: 900, color: '#3b82f6' }}>{summary.event}</div>
            </div>
          </div>
        </div>

        {/* Event List */}
        <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '.5px' }}>
            DANH SÁCH SỰ KIỆN ({eventHistory.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }} className="sidebar-scroll">
            {eventHistory.length === 0 ? (
              <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', textAlign: 'center', padding: '20px 0' }}>Không có sự kiện vượt ngưỡng nào trong ngày.</div>
            ) : (
              eventHistory.map((h, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', padding: '6px 10px', fontSize: '.6rem' }}>
                  <span style={{ fontFamily: 'var(--admin-font-mono)', color: 'var(--admin-text)' }}>{h.time}</span>
                  <span style={{ fontWeight: 800, color: h.level === 'alarm' ? '#ef4444' : h.level === 'warning' ? '#f59e0b' : '#3b82f6' }}>
                    {h.db.toFixed(1)} dB
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main Chart Area */}
      <div style={{ flex: 1, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', padding: 20, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', gap: 10 }}>
            <RotateCw size={18} className="animate-spin" color="var(--admin-accent)" />
            <span style={{ fontSize: '.7rem', fontFamily: 'var(--admin-font-mono)' }}>ĐANG TẢI DỮ LIỆU...</span>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              BIỂU ĐỒ PHÂN BỐ CƯỜNG ĐỘ PHÓNG ĐIỆN THEO THỜI GIAN
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <canvas ref={chartRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StationAnalysisOverlay({ snapshot, onClose, openStationDevices, openStationAlerts }: { snapshot: StationAnalyticsSnapshot; onClose: () => void; openStationDevices: (id: string) => void; openStationAlerts: (id: string) => void; }) {
  const [activeTab, setActiveTab] = useState<'thermal' | 'pd' | 'diagnostics'>('thermal');
  const endpoint = getStationEndpointInfo(snapshot.station);

  const cabinetSummary = getCabinetSummary(snapshot.points, snapshot.devices);

  return (
    <div 
      className="station-overlay-animate"
      style={{
        flex: 1,
        background: 'var(--admin-panel)',
        border: 'none', borderRadius: 0,
        display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'hidden'
      }}
    >
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-2)', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
          <div style={{ width: 10, height: 10, borderRadius: 0, background: snapshot.onlineDevices === snapshot.deviceTotal ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: `0 0 12px ${snapshot.onlineDevices === snapshot.deviceTotal ? 'var(--admin-success)' : 'var(--admin-danger)'}` }} />
          <div>
            <div style={{ fontSize: '.55rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 2 }}>TRUNG TÂM ĐIỀU HÀNH</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff', letterSpacing: '0.02em' }}>{snapshot.station.name}</div>
            <div style={{ marginTop: 4, fontSize: '.56rem', fontWeight: 700, color: 'var(--admin-text-muted)', fontFamily: 'var(--admin-font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              H:{endpoint.host} | IP:{endpoint.ip} | P:{endpoint.port}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, overflowX: 'auto' }} className="custom-hud-scroll">
          {[
            { id: 'thermal', label: 'NHIỆT ĐỘ', icon: <Thermometer size={13} /> },
            { id: 'pd', label: 'PHÓNG ĐIỆN', icon: <Zap size={13} /> },
            { id: 'diagnostics', label: 'CHẨN ĐOÁN', icon: <Shield size={13} /> },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              style={{
                background: 'transparent', border: 'none', color: activeTab === t.id ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
                fontSize: '.62rem', fontWeight: 950, cursor: 'pointer', padding: '8px 10px',
                borderBottom: activeTab === t.id ? '3px solid var(--admin-accent)' : '3px solid transparent',
                textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s', flexShrink: 0, whiteSpace: 'nowrap'
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text-muted)', cursor: 'pointer', padding: 8, display: 'flex', transition: 'all 0.2s', flexShrink: 0 }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = 'var(--admin-text-muted)'}><X size={18} /></button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }} className="custom-hud-scroll">
        {activeTab === 'thermal' && (
          <ThermalForecastPanel station={snapshot.station} devices={snapshot.devices} />
        )}

        {activeTab === 'pd' && (
          <PdAnalyticsPanel station={snapshot.station} devices={snapshot.devices} />
        )}

        {activeTab === 'diagnostics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Nhật ký Vận hành Hệ thống</div>
             <div style={{ background: 'var(--admin-bg)', borderRadius: 0, border: '1px solid var(--admin-border)', padding: 12, fontFamily: 'monospace', fontSize: '.6rem', color: '#aaa', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:15:22]</span><span>AI Engine: Đã tải mô hình YOLOv8 thành công</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:15:25]</span><span>NVR: Bắt đầu ghi hình luồng Camera 153</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-warning)' }}>[10:18:01]</span><span>Network: Độ trễ Gateway tăng cao (45ms)</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:20:00]</span><span>Sync: Đã đồng bộ 120 bản ghi lên trạm trung tâm</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:22:15]</span><span>System: Kiểm tra định kỳ thiết bị - OK</span></div>
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Công cụ Chẩn đoán</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                   <button style={{ padding: '8px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', fontSize: '.6rem', fontWeight: 800, cursor: 'pointer' }}>PING GATEWAY</button>
                   <button style={{ padding: '8px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', fontSize: '.6rem', fontWeight: 800, cursor: 'pointer' }}>RESTART AI SERVICE</button>
                </div>
             </div>
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderTop: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', display: 'flex', gap: 10 }}>
         <button 
           onClick={() => openStationDevices(snapshot.station.id)}
           style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--admin-accent)', color: 'var(--admin-accent)', borderRadius: 0, fontSize: '.7rem', fontWeight: 900, cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.05em' }}
           onMouseEnter={e => { e.currentTarget.style.background = 'var(--admin-accent)'; e.currentTarget.style.color = '#000'; }}
           onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--admin-accent)'; }}
         >
           MỞ TẠI TRẠM TRUNG TÂM
         </button>
      </div>
    </div>
  );
}

function StationCard({ snapshot, selected, onClick }: { snapshot: StationAnalyticsSnapshot; selected: boolean; onClick: () => void }) {
  const health = getHealthClass(snapshot.avgHealth);
  const thermal = getThermalClass(snapshot.hottestPoint?.value ?? null);
  const hasAlerts = snapshot.openAlerts > 0;
  const endpoint = getStationEndpointInfo(snapshot.station);

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        cursor: 'pointer',
        background: selected ? 'var(--admin-hover)' : 'transparent',
        borderLeft: selected ? '3px solid var(--admin-accent)' : '3px solid transparent',
        borderBottom: '1px solid var(--admin-border)',
        transition: 'all 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative'
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--admin-layer-2)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Station name row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--admin-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{snapshot.station.name}</div>
          <div style={{ fontSize: '.58rem', color: 'var(--admin-text-muted)', fontFamily: 'monospace' }}>{snapshot.station.code || 'NO-CODE'}</div>
          <div style={{ marginTop: 3, fontSize: '.52rem', color: 'var(--admin-text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            H:{endpoint.host} | IP:{endpoint.ip} | P:{endpoint.port}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasAlerts && (
            <span style={{ background: 'var(--admin-danger)', color: '#fff', fontSize: '.55rem', fontWeight: 900, padding: '1px 7px', borderRadius: 0, letterSpacing: '0.03em' }}>
              {snapshot.openAlerts}
            </span>
          )}
          <div style={{ width: 7, height: 7, borderRadius: 0, background: snapshot.onlineDevices === snapshot.deviceTotal && snapshot.deviceTotal > 0 ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: snapshot.onlineDevices === snapshot.deviceTotal && snapshot.deviceTotal > 0 ? '0 0 6px var(--admin-success)' : '0 0 6px var(--admin-danger)' }} />
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Health mini ring */}
        <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
          <svg width="34" height="34" viewBox="0 0 36 36">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={health.color} strokeWidth="3" strokeDasharray={`${snapshot.avgHealth ?? 0}, 100`} strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.55rem', fontWeight: 900, color: health.color }}>
            {snapshot.avgHealth != null ? Math.round(snapshot.avgHealth) : '—'}
          </div>
        </div>

        {/* Info Grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Thermometer size={10} style={{ color: thermal.color }} />
            <span style={{ fontSize: '.6rem', fontWeight: 800, color: thermal.color }}>{snapshot.hottestPoint ? `${snapshot.hottestPoint.value.toFixed(0)}°C` : '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Zap size={10} style={{ color: snapshot.warningPdPoints > 0 ? '#f59e0b' : 'var(--admin-text-muted)' }} />
            <span style={{ fontSize: '.6rem', fontWeight: 800, color: snapshot.warningPdPoints > 0 ? '#f59e0b' : 'var(--admin-text-muted)' }}>
              {snapshot.warningPdPoints > 0 ? `${snapshot.warningPdPoints} PD` : 'Safe'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Wifi size={10} style={{ color: 'var(--admin-success)' }} />
            <span style={{ fontSize: '.55rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>{snapshot.onlineDevices}/{snapshot.deviceTotal}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Shield size={10} style={{ color: snapshot.openAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-accent)' }} />
            <span style={{ fontSize: '.55rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>{snapshot.openAlerts} alerts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Health Gauge (Right Panel) ─────────────────────────────────

function HealthGauge({ score }: { score: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const health = getHealthClass(score);
  const display = score != null ? Math.round(score) : 0;

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [display, 100 - display],
          backgroundColor: [health.color, 'var(--admin-layer-2)'],
          borderWidth: 0,
          borderRadius: 0,
          circumference: 270,
          rotation: 225,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '75%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        events: []
      }
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [score, health.color, display]);

  return (
    <div style={{ position: 'relative', width: 130, height: 130, margin: '0 auto' }}>
      <canvas ref={canvasRef} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: health.color, lineHeight: 1 }}>{score != null ? display : '—'}</div>
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Health</div>
      </div>
    </div>
  );
}

// ── Thermal Bar (Right Panel) ──────────────────────────────────

function ThermalBar({ value, label, color }: { value: number | null; label: string; color: string }) {
  const pct = value != null ? Math.min(Math.round((value / 120) * 100), 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: '.65rem', fontWeight: 900, color }}>{value != null ? `${value.toFixed(1)}°C` : 'N/A'}</span>
      </div>
      <div style={{ height: 6, background: 'var(--admin-layer-2)', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 0, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

// ── Analysis Mini Card ─────────────────────────────────────────

function AnalysisCard({ icon, title, children, onClick, accentColor }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
  onClick: () => void; accentColor?: string;
}) {
  return (
    <div style={{
      background: 'var(--admin-layer-2)',
      borderRadius: 0,
      border: '1px solid var(--admin-border)',
      borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
      overflow: 'hidden'
    }}>
      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          {icon}
          <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--admin-text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        </div>
        {children}
      </div>
      <button
        onClick={onClick}
        style={{
          width: '100%', padding: '5px 0', border: 'none', borderTop: '1px solid var(--admin-border)',
          background: 'transparent', color: 'var(--admin-accent)', cursor: 'pointer',
          fontSize: '.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
        }}
      >
        <TrendingUp size={10} /> MỞ PHÂN TÍCH
      </button>
    </div>
  );
}

function CabinetMiniRow({ t1, t2, t3, pdVal }: { t1: number | null; t2: number | null; t3: number | null; pdVal: number | null }) {
  const hasTemp = t1 != null || t2 != null || t3 != null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {hasTemp ? (
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'T1', val: t1 },
            { label: 'T2', val: t2 },
            { label: 'T3', val: t3 }
          ].map(({ label, val }) => (
            <div key={label} style={{
              textAlign: 'center',
              background: 'var(--admin-bg)',
              borderRadius: 0,
              padding: '3px 6px',
              flex: 1
            }}>
              <div style={{ fontSize: '.5rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>{label}</div>
              <div style={{
                fontSize: '.68rem', fontWeight: 900,
                color: val != null ? (val >= 60 ? 'var(--admin-danger)' : val >= 45 ? '#f59e0b' : 'var(--admin-text)') : 'var(--admin-text-muted)'
              }}>
                {fmtTemp(val)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)' }}>Chưa có dữ liệu nhiệt</div>
      )}
      <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
        PD: <span style={{ color: pdVal != null && pdVal >= 20 ? '#f59e0b' : 'var(--admin-text-muted)', fontWeight: 800 }}>{fmtDb(pdVal)}</span>
      </div>
    </div>
  );
}

type CentralTab = 'overview' | 'thermal' | 'pd' | 'health';
type ProvinceStationGroup = {
  provinceId: string;
  provinceName: string;
  stations: StationAnalyticsSnapshot[];
  totalStations: number;
  totalDevices: number;
  totalOnline: number;
  totalAlerts: number;
};

// ── Main Component ─────────────────────────────────────────────

export default function CentralAnalyticsLayout() {
  const navigate = useNavigate();
  const setViewingStation = useStationStore(s => s.setViewingStation);

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationAnalyticsSnapshot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [fleetTab, setFleetTab] = useState<CentralTab>('overview');
  const [expandedProvinces, setExpandedProvinces] = useState<Set<string>>(new Set());
  const [downloadDropdownOpen, setDownloadDropdownOpen] = useState(false);
  const downloadDropdownRef = useRef<HTMLDivElement | null>(null);

  // ── Data Loading ───────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [stationList, recentAlerts] = await Promise.all([
          stationApi.getStations(),
          stationApi.getAlerts(undefined, undefined, undefined, 80),
        ]);

        const snapshots = await Promise.all(
          stationList.map(async (station) => {
            const isChild = !!station.apiUrl;

            const [devices, points, healthScores, remoteKpi] = await Promise.all([
              stationApi.getDevices(station.id).catch(() => [] as Device[]),
              stationApi.getLatestPoints(station.id).catch(() => [] as SensorPoint[]),
              stationApi.getHealthScores(station.id).catch(() => [] as HealthScore[]),
              isChild ? stationApi.getRemoteKpi(station.id).catch(() => null) : Promise.resolve(null),
            ]);

            // For child stations, use remote data when local master DB is empty
            const useRemote = isChild && remoteKpi && !remoteKpi.error;

            const effectivePoints: SensorPoint[] = (useRemote && remoteKpi!.points.length > 0)
              ? remoteKpi!.points.map(p => ({
                  deviceId: p.deviceId,
                  pointId: p.pointId,
                  value: p.value,
                  unit: p.unit,
                  quality: p.quality,
                  time: p.time,
                  stationId: station.id,
                } as unknown as SensorPoint))
              : points;

            const effectiveHealthScores: HealthScore[] = (useRemote && remoteKpi!.healthScores.length > 0)
              ? remoteKpi!.healthScores.map(h => ({
                  deviceId: h.deviceId,
                  deviceName: h.deviceName,
                  deviceType: h.deviceType,
                  status: h.status,
                  score: h.score,
                  risk: h.risk,
                } as unknown as HealthScore))
              : healthScores;

            const healthValues = effectiveHealthScores
              .map(item => item.score)
              .filter((value): value is number => Number.isFinite(value));
            const avgHealth = healthValues.length > 0
              ? healthValues.reduce((sum, value) => sum + value, 0) / healthValues.length
              : null;

            const hottest = effectivePoints
              .filter(isThermalPoint)
              .reduce<{ value: number; label: string } | null>((max, point) => {
                if (typeof point.value !== 'number') return max;
                if (!max || point.value > max.value) return { value: point.value, label: point.pointId };
                return max;
              }, null);

            const stationAlerts = recentAlerts.filter(a => a.stationId === station.id && a.status !== 'closed');
            const warningPdPoints = effectivePoints.filter(p => isPdPoint(p) && typeof p.value === 'number' && p.value >= 20).length;

            const effectiveDevices: Device[] = (useRemote && devices.length === 0)
              ? Array.from({ length: remoteKpi!.devicesTotal }, (_, i) => ({
                  id: `remote-${station.id}-${i}`,
                  name: `Thiết bị ${i + 1}`,
                  type: 'unknown',
                  protocol: 'unknown',
                  config: {},
                  status: i < remoteKpi!.devicesOnline ? 'online' : 'offline',
                  stationId: station.id,
                  createdAt: '',
                } as Device))
              : devices;
            const effectiveDeviceTotal = useRemote
              ? remoteKpi!.devicesTotal
              : effectiveDevices.length;
            const effectiveOnline = useRemote
              ? remoteKpi!.devicesOnline
              : devices.filter(d => d.status === 'online').length;
            const effectiveAlerts = useRemote
              ? remoteKpi!.alertsCount
              : stationAlerts.length;

            return {
              station, devices: effectiveDevices, deviceTotal: effectiveDeviceTotal, points: effectivePoints, healthScores: effectiveHealthScores,
              avgHealth,
              onlineDevices: effectiveOnline,
              openAlerts: effectiveAlerts,
              warningPdPoints,
              hottestPoint: hottest,
            };
          })
        );

        setStations(snapshots);
        setAlerts(recentAlerts);
      } catch (err) {
        console.error('[CentralAnalytics] Load failed:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    stationApi.getProvinces().then(setProvinces).catch(() => {});
  }, []);

  // ── Computed Values ────────────────────────────────────────

  const fleetSummary = useMemo(() => {
    const totalStations = stations.length;
    const totalDevices = stations.reduce((s, i) => s + i.deviceTotal, 0);
    const totalOnline = stations.reduce((s, i) => s + i.onlineDevices, 0);
    const totalAlerts = stations.reduce((s, i) => s + i.openAlerts, 0);
    const totalPdWarnings = stations.reduce((s, i) => s + i.warningPdPoints, 0);
    const healthVals = stations.map(i => i.avgHealth).filter((v): v is number => v != null);
    const avgHealth = healthVals.length > 0 ? healthVals.reduce((a, b) => a + b, 0) / healthVals.length : null;

    const hottest = stations.reduce<{ stationName: string; stationId: string; value: number; label: string } | null>((max, i) => {
      if (!i.hottestPoint) return max;
      if (!max || i.hottestPoint.value > max.value) return { stationName: i.station.name, stationId: i.station.id, value: i.hottestPoint.value, label: i.hottestPoint.label };
      return max;
    }, null);

    return { totalStations, totalDevices, totalOnline, totalAlerts, totalPdWarnings, avgHealth, hottest };
  }, [stations]);

  const selectedSnapshot = useMemo(() => stations.find(s => s.station.id === selectedStationId) || null, [stations, selectedStationId]);

  const cabinetSummary = useMemo(() => {
    if (!selectedSnapshot) return null;
    return getCabinetSummary(selectedSnapshot.points, selectedSnapshot.devices);
  }, [selectedSnapshot]);

  const provinceNameMap = useMemo(() => new Map(provinces.map(p => [p.id, p.name])), [provinces]);

  const provinceGroups = useMemo<ProvinceStationGroup[]>(() => {
    const grouped = new Map<string, StationAnalyticsSnapshot[]>();

    stations.forEach(station => {
      const provinceId = station.station.provinceId || '__none__';
      const current = grouped.get(provinceId) || [];
      current.push(station);
      grouped.set(provinceId, current);
    });

    return [...grouped.entries()]
      .map(([provinceId, items]) => {
        const orderedStations = [...items].sort((a, b) => a.station.name.localeCompare(b.station.name, 'vi'));
        const provinceName = provinceId === '__none__'
          ? 'Chưa phân tỉnh'
          : provinceNameMap.get(provinceId) || 'Chưa phân tỉnh';

        return {
          provinceId,
          provinceName,
          stations: orderedStations,
          totalStations: orderedStations.length,
          totalDevices: orderedStations.reduce((sum, item) => sum + item.deviceTotal, 0),
          totalOnline: orderedStations.reduce((sum, item) => sum + item.onlineDevices, 0),
          totalAlerts: orderedStations.reduce((sum, item) => sum + item.openAlerts, 0),
        };
      })
      .sort((a, b) => {
        if (a.provinceId === '__none__') return 1;
        if (b.provinceId === '__none__') return -1;
        return a.provinceName.localeCompare(b.provinceName, 'vi');
      });
  }, [stations, provinceNameMap]);

  useEffect(() => {
    if (provinceGroups.length === 0) return;
    setExpandedProvinces(prev => {
      const next = new Set(prev);
      if (next.size === 0 && provinceGroups[0]) {
        next.add(provinceGroups[0].provinceId);
      }
      if (selectedStationId) {
        const matchedStation = stations.find(s => s.station.id === selectedStationId);
        if (matchedStation?.station.provinceId) {
          next.add(matchedStation.station.provinceId);
        }
      }

      const same = next.size === prev.size && [...next].every(value => prev.has(value));
      return same ? prev : next;
    });
  }, [provinceGroups, selectedStationId, stations]);

  useEffect(() => {
    if (!downloadDropdownOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (downloadDropdownRef.current && !downloadDropdownRef.current.contains(event.target as Node)) {
        setDownloadDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [downloadDropdownOpen]);

  const analyticsExportRows = useMemo(() => stations.map(sn => ({
    'Tram': sn.station.name,
    'Ma tram': sn.station.code || '',
    'Tong thiet bi': sn.deviceTotal,
    'Thiet bi online': sn.onlineDevices,
    'Canh bao mo': sn.openAlerts,
    'Diem PD canh bao': sn.warningPdPoints,
    'Suc khoe TB': sn.avgHealth != null ? Number(sn.avgHealth.toFixed(1)) : '',
    'Diem nong nhat': sn.hottestPoint?.label || '',
    'Nhiet do cao nhat': sn.hottestPoint?.value != null ? Number(sn.hottestPoint.value.toFixed(1)) : '',
    'IP': getStationEndpointInfo(sn.station).ip,
    'Port': getStationEndpointInfo(sn.station).port,
    'Dia chi': parseLocation(sn.station.location).address || '',
  })), [stations]);

  // ── Actions ────────────────────────────────────────────────

  const openStationDevices = useCallback((stationId: string) => {
    localStorage.setItem(MULTISITE_RETURN_TAB_KEY, 'analytics');
    setViewingStation(null);
    navigate(`/multisite?tab=devices&stationId=${encodeURIComponent(stationId)}`);
  }, [navigate, setViewingStation]);

  const openStationAlerts = useCallback((stationId: string) => {
    localStorage.setItem(MULTISITE_RETURN_TAB_KEY, 'analytics');
    setViewingStation(null);
    navigate(`/alerts-history?stationId=${encodeURIComponent(stationId)}`);
  }, [navigate, setViewingStation]);

  const exportAnalyticsCsv = useCallback(() => {
    if (analyticsExportRows.length === 0) {
      showToast('Không có dữ liệu để xuất', 'error');
      return;
    }
    const firstRow = analyticsExportRows[0];
    if (!firstRow) return;
    const headers = Object.keys(firstRow);
    const rows = analyticsExportRows.map(row => headers.map(key => `"${String((row as Record<string, unknown>)[key] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CentralAnalytics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analyticsExportRows]);

  const exportAnalyticsXlsx = useCallback(() => {
    if (analyticsExportRows.length === 0) {
      showToast('Không có dữ liệu để xuất', 'error');
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(analyticsExportRows);
    ws['!cols'] = [
      { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
      { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'PhanTich');
    XLSX.writeFile(wb, `CentralAnalytics_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [analyticsExportRows]);

  const exportAnalyticsPdf = useCallback(() => {
    if (analyticsExportRows.length === 0) {
      showToast('Không có dữ liệu để xuất', 'error');
      return;
    }
    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) return;
    const firstRow = analyticsExportRows[0];
    if (!firstRow) return;
    const headers = Object.keys(firstRow);
    const rowsHtml = analyticsExportRows.map(row => `
      <tr>${headers.map(key => `<td style="padding:6px 8px;border:1px solid #e5e7eb;">${String((row as Record<string, unknown>)[key] ?? '')}</td>`).join('')}</tr>
    `).join('');
    win.document.write(`
      <!DOCTYPE html><html><head><title>Phan tich trung tam</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }
        th { background: #f3f4f6; padding: 8px; border: 1px solid #e5e7eb; text-align: left; }
      </style></head><body>
      <h2>PHAN TICH TRUNG TAM</h2>
      <div>Thời gian xuất: <b>${new Date().toLocaleString('vi-VN')}</b> | Số trạm: <b>${analyticsExportRows.length}</b></div>
      <table><thead><tr>${headers.map(key => `<th>${key}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }, [analyticsExportRows]);

  // ── Fleet-wide Ranked Lists ───────────────────────────────

  const rankedStations = useMemo(() => {
    return [...stations].sort((a, b) => {
      const riskA = a.openAlerts * 20 + (100 - (a.avgHealth ?? 100)) + a.warningPdPoints * 8 + (a.hottestPoint?.value ?? 0);
      const riskB = b.openAlerts * 20 + (100 - (b.avgHealth ?? 100)) + b.warningPdPoints * 8 + (b.hottestPoint?.value ?? 0);
      return riskB - riskA;
    });
  }, [stations]);

  const thermalRanking = useMemo(() => {
    return rankedStations
      .filter(item => item.hottestPoint)
      .sort((a, b) => (b.hottestPoint?.value ?? 0) - (a.hottestPoint?.value ?? 0));
  }, [rankedStations]);

  const pdRanking = useMemo(() => {
    return [...stations].sort((a, b) => b.warningPdPoints - a.warningPdPoints);
  }, [stations]);

  const healthRanking = useMemo(() => {
    return [...stations].sort((a, b) => (a.avgHealth ?? 999) - (b.avgHealth ?? 999));
  }, [stations]);

  const recentAlertsList = useMemo(() => {
    return [...alerts]
      .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
      .slice(0, 10);
  }, [alerts]);

  function MetricCard({ label, value, sub, icon, accentColor }: { label: string; value: string | number; sub: string; icon: React.ReactNode; accentColor?: string }) {
    return (
      <div style={{ padding: 16, borderLeft: accentColor ? `4px solid ${accentColor}` : undefined, background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 0, background: accentColor ? `${accentColor}1A` : 'var(--admin-layer-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor || 'var(--admin-text-muted)', border: '1px solid var(--admin-border)' }}>
            {icon}
          </div>
          <div>
            <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', marginTop: 2, lineHeight: 1.1 }}>{value}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 600 }}>{sub}</div>
      </div>
    );
  }

  const renderOverview = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard label="Trạm đang theo dõi" value={fleetSummary.totalStations} sub={`${fleetSummary.totalDevices} thiết bị`} icon={<Activity size={20} />} accentColor="var(--admin-accent)" />
        <MetricCard label="Thiết bị trực tuyến" value={`${fleetSummary.totalOnline}/${fleetSummary.totalDevices}`} sub="Toàn mạng lưới" icon={<Wifi size={20} />} accentColor="var(--admin-success)" />
        <MetricCard label="Cảnh báo chưa đóng" value={fleetSummary.totalAlerts} sub="Open và acked" icon={<AlertTriangle size={20} />} accentColor="var(--admin-danger)" />
        <MetricCard label="Điểm sức khỏe TB" value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'} sub={getHealthClass(fleetSummary.avgHealth).label} icon={<Radio size={20} />} accentColor="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 24 }}>
        <section style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={14} style={{ color: 'var(--admin-accent)' }} /> BẢNG XẾP HẠNG RỦI RO
          </div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table className="data-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
                  <th style={{ width: 40, textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Trạm</th>
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Sức khỏe</th>
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Hotspot</th>
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>PD</th>
                  <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Cảnh báo</th>
                </tr>
              </thead>
              <tbody>
                {rankedStations.map((item, idx) => (
                  <tr key={item.station.id} onClick={() => setSelectedStationId(item.station.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--admin-border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem', padding: '12px 14px' }}>{idx + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center', color: getHealthClass(item.avgHealth).color, fontWeight: 800, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.avgHealth != null ? `${item.avgHealth.toFixed(1)}` : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'center', color: getThermalClass(item.hottestPoint?.value ?? null).color, fontWeight: 800, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: getPdClass(item.warningPdPoints).color, fontWeight: 800, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.warningPdPoints > 0 ? item.warningPdPoints : '—'}
                    </td>
                    <td style={{ textAlign: 'center', color: item.openAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text-muted)', fontWeight: 800, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.openAlerts > 0 ? item.openAlerts : '0'}
                    </td>
                  </tr>
                ))}
                {rankedStations.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Không có dữ liệu trạm</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ display: 'grid', gap: 24, alignContent: 'start' }}>
          <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text-muted)', fontWeight: 800, fontSize: '.7rem', letterSpacing: '0.05em' }}>
              <Thermometer size={14} style={{ color: 'var(--admin-danger)' }} /> ĐIỂM NÓNG NHẤT HỆ THỐNG
            </div>
            <div style={{ marginTop: 16, fontSize: '2.5rem', fontWeight: 900, color: 'var(--admin-danger)' }}>
              {fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text)', fontSize: '.8rem', fontWeight: 700 }}>
              {fleetSummary.hottest ? fleetSummary.hottest.stationName : 'Chưa có dữ liệu nhiệt'}
            </div>
            <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', marginTop: 2 }}>
              {fleetSummary.hottest ? fleetSummary.hottest.label : '---'}
            </div>
            {fleetSummary.hottest && (
              <button className="btn-industrial btn-primary" style={{ marginTop: 20, padding: '8px 12px', fontSize: '.7rem', fontWeight: 800, width: 'fit-content' }} onClick={() => setSelectedStationId(fleetSummary.hottest!.stationId)}>
                KIỂM TRA NGAY
              </button>
            )}
          </div>

          <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--admin-text-muted)', fontWeight: 800, fontSize: '.7rem', letterSpacing: '0.05em' }}>
              <Zap size={14} style={{ color: '#f59e0b' }} /> DẤU HIỆU PD MẠNG LƯỚI
            </div>
            <div style={{ marginTop: 16, fontSize: '2.5rem', fontWeight: 900, color: fleetSummary.totalPdWarnings > 0 ? '#f59e0b' : 'var(--admin-success)' }}>
              {fleetSummary.totalPdWarnings}
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text)', fontSize: '.8rem', fontWeight: 700 }}>
              {fleetSummary.totalPdWarnings > 0 ? 'Phát hiện tín hiệu bất thường' : 'Hệ thống điện ổn định'}
            </div>
             <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', marginTop: 2 }}>
              Cần phân tích phổ âm thanh chuyên sâu
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderThermal = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Hotspot cao nhất"
          value={fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
          sub={fleetSummary.hottest ? fleetSummary.hottest.stationName : 'Chưa có dữ liệu'}
          icon={<Thermometer size={20} />}
          accentColor="var(--admin-danger)"
        />
        <MetricCard
          label="Trạm có dữ liệu nhiệt"
          value={thermalRanking.length}
          sub={`${stations.length - thermalRanking.length} trạm chưa có nhiệt`}
          icon={<Activity size={20} />}
          accentColor="var(--admin-accent)"
        />
      </div>

      <section style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Thermometer size={14} style={{ color: 'var(--admin-danger)' }} /> BẢNG XẾP HẠNG NHIỆT ĐỘ LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
                <th style={{ width: 40, textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>#</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Trạm</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Điểm đo nóng nhất</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Nhiệt độ</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {thermalRanking.map((item, idx) => {
                const thermalInfo = getThermalClass(item.hottestPoint?.value ?? null);
                return (
                  <tr key={item.station.id} onClick={() => setSelectedStationId(item.station.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--admin-border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem', padding: '12px 14px' }}>{idx + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', padding: '12px 14px' }}>
                      {item.hottestPoint?.label || 'Không rõ'}
                    </td>
                    <td style={{ textAlign: 'center', color: thermalInfo.color, fontWeight: 900, fontSize: '1.1rem', padding: '12px 14px' }}>
                      {item.hottestPoint ? `${item.hottestPoint.value.toFixed(1)}°C` : 'N/A'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                      <span style={{ 
                        background: thermalInfo.color === 'var(--admin-danger)' ? 'rgba(239,68,68,0.1)' : thermalInfo.color === '#f59e0b' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: thermalInfo.color, padding: '2px 8px', borderRadius: 0, fontSize: '.65rem', fontWeight: 800 
                      }}>
                        {thermalInfo.label.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {thermalRanking.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu nhiệt.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderPd = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Điểm PD đáng chú ý"
          value={fleetSummary.totalPdWarnings}
          sub={getPdClass(fleetSummary.totalPdWarnings).label}
          icon={<Zap size={20} />}
          accentColor={fleetSummary.totalPdWarnings > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
        <MetricCard
          label="Trạm có PD"
          value={pdRanking.filter(item => item.warningPdPoints > 0).length}
          sub={`${pdRanking.filter(item => item.warningPdPoints === 0).length} trạm ổn định`}
          icon={<Radio size={20} />}
          accentColor={pdRanking.filter(item => item.warningPdPoints > 0).length > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
      </div>

      <section style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} style={{ color: '#f59e0b' }} /> BẢNG XẾP HẠNG PHÓNG ĐIỆN LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
                <th style={{ width: 40, textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>#</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Trạm</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Số điểm cảnh báo PD</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Đánh giá rủi ro</th>
              </tr>
            </thead>
            <tbody>
              {pdRanking.map((item, idx) => {
                const pdInfo = getPdClass(item.warningPdPoints);
                return (
                  <tr key={item.station.id} onClick={() => setSelectedStationId(item.station.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--admin-border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem', padding: '12px 14px' }}>{idx + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center', color: pdInfo.color, fontWeight: 900, fontSize: '1.1rem', padding: '12px 14px' }}>
                      {item.warningPdPoints}
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                      <span style={{ 
                        background: pdInfo.color === 'var(--admin-danger)' ? 'rgba(239,68,68,0.1)' : pdInfo.color === '#f59e0b' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: pdInfo.color, padding: '2px 8px', borderRadius: 0, fontSize: '.65rem', fontWeight: 800 
                      }}>
                        {pdInfo.label.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {pdRanking.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu phóng điện.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderHealth = () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <MetricCard
          label="Sức khỏe trung bình"
          value={fleetSummary.avgHealth != null ? fleetSummary.avgHealth.toFixed(1) : 'N/A'}
          sub={getHealthClass(fleetSummary.avgHealth).label}
          icon={<Radio size={20} />}
          accentColor={getHealthClass(fleetSummary.avgHealth).color}
        />
        <MetricCard
          label="Trạm cần theo dõi"
          value={healthRanking.filter(item => (item.avgHealth ?? 100) < 75).length}
          sub="Điểm sức khỏe dưới 75"
          icon={<AlertTriangle size={20} />}
          accentColor={healthRanking.filter(item => (item.avgHealth ?? 100) < 75).length > 0 ? '#f59e0b' : 'var(--admin-success)'}
        />
      </div>

      <section style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} style={{ color: 'var(--admin-accent)' }} /> TÌNH TRẠNG KẾT NỐI THIẾT BỊ LIÊN TRẠM
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table className="data-table" style={{ width: '100%', margin: 0, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
                <th style={{ width: 40, textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>#</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Trạm</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Sức khỏe thiết bị (ĐTB)</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Thiết bị Online</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>Tổng thiết bị giám sát</th>
              </tr>
            </thead>
            <tbody>
              {healthRanking.map((item, idx) => {
                const healthInfo = getHealthClass(item.avgHealth);
                return (
                  <tr key={item.station.id} onClick={() => setSelectedStationId(item.station.id)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--admin-border)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem', padding: '12px 14px' }}>{idx + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>{item.station.name}</div>
                      <div style={{ color: 'var(--admin-text-muted)', fontSize: '.65rem' }}>{item.station.code || 'NO-CODE'}</div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '12px 14px' }}>
                       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <span style={{ color: healthInfo.color, fontWeight: 900, fontSize: '1.1rem', minWidth: 40 }}>
                            {item.avgHealth != null ? `${item.avgHealth.toFixed(1)}` : 'N/A'}
                          </span>
                          {item.avgHealth != null && (
                            <div style={{ width: 60, height: 4, background: 'var(--admin-layer-2)', borderRadius: 0, overflow: 'hidden' }}>
                              <div style={{ width: `${item.avgHealth}%`, height: '100%', background: healthInfo.color }} />
                            </div>
                          )}
                       </div>
                    </td>
                    <td style={{ textAlign: 'center', color: item.onlineDevices === item.deviceTotal && item.deviceTotal > 0 ? 'var(--admin-success)' : 'var(--admin-text)', fontWeight: 800, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.onlineDevices} / {item.deviceTotal}
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontWeight: 700, padding: '12px 14px', fontSize: '.75rem' }}>
                      {item.deviceTotal} thiết bị
                    </td>
                  </tr>
                );
              })}
              {healthRanking.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Chưa có dữ liệu.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );

  const renderRecentAlerts = () => (
    <section style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)', fontWeight: 800, fontSize: '.75rem', color: 'var(--admin-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} style={{ color: 'var(--admin-danger)' }} /> CẢNH BÁO MỚI NHẤT TOÀN HỆ THỐNG
      </div>
      <div style={{ display: 'grid' }}>
        {recentAlertsList.map(alert => (
          <div key={alert.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                 <span style={{ 
                    padding: '2px 8px', borderRadius: 0, fontSize: '.65rem', fontWeight: 900,
                    background: alert.level === 'alarm' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                    color: alert.level === 'alarm' ? 'var(--admin-danger)' : '#f59e0b'
                 }}>
                    {alert.level.toUpperCase()}
                 </span>
                 <span style={{ color: 'var(--admin-text)', fontWeight: 800, fontSize: '.75rem' }}>
                   {alert.stationName || 'Không rõ trạm'}
                 </span>
              </div>
              <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', fontWeight: 700 }}>
                {new Date(alert.triggeredAt).toLocaleString('vi-VN')}
              </div>
            </div>
            <div style={{ marginTop: 8, color: 'var(--admin-text-muted)', fontSize: '.75rem', fontWeight: 600 }}>
              {alert.message}
            </div>
          </div>
        ))}
        {recentAlertsList.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '.7rem' }}>Hệ thống không có cảnh báo nào gần đây.</div>
        )}
      </div>
    </section>
  );

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="central-analytics-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      {/* ── Main Content: Left Panel + Right Panel ───────── */}
      <div className="central-analytics-main" style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* ── Left Panel: Station List ────────────────────── */}
        <div className="central-analytics-left" style={{
          width: leftPanelCollapsed ? 0 : 280,
          minWidth: leftPanelCollapsed ? 0 : 280,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--admin-panel)',
          borderRight: leftPanelCollapsed ? 'none' : '1px solid var(--admin-border)',
          overflowX: 'hidden',
          overflowY: 'visible',
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 10
        }}>
          {!leftPanelCollapsed && (
            <>
              {/* Station list */}
              <div style={{ flex: 1, overflowY: 'auto' }} className="custom-hud-scroll">
                {loading ? (
                  <div style={{ padding: 40, textAlign: 'center' }}>
                    <Activity size={32} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} />
                    <div style={{ marginTop: 14, fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.1em' }}>ĐANG TẢI DỮ LIỆU...</div>
                  </div>
                ) : provinceGroups.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                    CHƯA CÓ TRẠM NÀO
                  </div>
                ) : (
                  provinceGroups.map(group => {
                    const expanded = expandedProvinces.has(group.provinceId);
                    const hasAlerts = group.totalAlerts > 0;

                    return (
                      <div key={group.provinceId} style={{ border: '1px solid var(--admin-border)', borderRadius: 0, margin: '0 12px 10px', overflow: 'hidden', background: 'var(--admin-layer-1)' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedProvinces(prev => {
                              const next = new Set(prev);
                              if (next.has(group.provinceId)) next.delete(group.provinceId);
                              else next.add(group.provinceId);
                              return next;
                            });
                          }}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            border: 'none',
                            background: expanded ? 'var(--admin-layer-2)' : 'var(--admin-layer-1)',
                            color: 'var(--admin-text)',
                            cursor: 'pointer',
                            borderBottom: expanded ? '1px solid var(--admin-border)' : 'none',
                            textAlign: 'left',
                          }}
                        >
                          {expanded ? <ChevronDown size={14} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />}
                          <span style={{ fontSize: '.72rem', fontWeight: 900, color: 'var(--admin-text)', flex: 1 }}>
                            {group.provinceName}
                          </span>
                          <span style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', whiteSpace: 'nowrap' }}>
                            {group.totalStations} trạm
                          </span>
                          {hasAlerts && (
                            <span style={{ fontSize: '.56rem', fontWeight: 900, color: 'var(--admin-danger)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                              {group.totalAlerts} BĐ
                            </span>
                          )}
                        </button>

                        {expanded && (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {group.stations.map(sn => {
                              const isSelected = sn.station.id === selectedStationId;
                              const online = sn.station.connectionStatus === 'online';
                              const endpoint = getStationEndpointInfo(sn.station);

                              return (
                                <div
                                  key={sn.station.id}
                                  onClick={() => {
                                    setSelectedStationId(sn.station.id);
                                    setExpandedProvinces(prev => {
                                      const next = new Set(prev);
                                      next.add(group.provinceId);
                                      return next;
                                    });
                                  }}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '10px 12px',
                                    cursor: 'pointer',
                                    background: isSelected ? 'rgba(14,165,233,0.10)' : 'transparent',
                                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    transition: 'background 0.15s ease',
                                  }}
                                  onMouseEnter={e => {
                                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
                                  }}
                                  onMouseLeave={e => {
                                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                      background: online ? 'var(--admin-success)' : 'var(--admin-danger)',
                                      boxShadow: online ? '0 0 6px rgba(16,185,129,0.8)' : '0 0 6px rgba(239,68,68,0.8)',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <span style={{
                                    fontSize: '.62rem',
                                    fontWeight: 900,
                                    color: 'var(--admin-accent)',
                                    minWidth: 68,
                                    fontFamily: 'var(--admin-font-mono)',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {sn.station.code || sn.station.id.slice(0, 8).toUpperCase()}
                                  </span>
                                  <span style={{
                                    flex: 1,
                                    fontSize: '.7rem',
                                    fontWeight: 700,
                                    color: 'var(--admin-text)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}>
                                    {sn.station.name}
                                  </span>
                                  <span style={{
                                    display: 'block',
                                    fontSize: '.52rem',
                                    color: 'var(--admin-text-muted)',
                                    fontFamily: 'var(--admin-font-mono)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}>
                                    H:{endpoint.host} | IP:{endpoint.ip} | P:{endpoint.port}
                                  </span>
                                  {sn.openAlerts > 0 ? (
                                    <span style={{
                                      fontSize: '.55rem',
                                      fontWeight: 900,
                                      color: '#ff6b6b',
                                      background: 'rgba(239,68,68,0.14)',
                                      border: '1px solid rgba(239,68,68,0.35)',
                                      padding: '1px 6px',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      {sn.openAlerts}
                                    </span>
                                  ) : (
                                    <span style={{
                                      fontSize: '.55rem',
                                      fontWeight: 900,
                                      color: online ? 'var(--admin-success)' : 'var(--admin-text-muted)',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      {online ? 'ONLINE' : 'OFFLINE'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Left panel toggle */}
        <button
          onClick={() => setLeftPanelCollapsed(v => !v)}
          style={{
            position: 'absolute', left: leftPanelCollapsed ? 0 : 280, top: '50%', transform: 'translateY(-50%)',
            zIndex: 11, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)',
            color: 'var(--admin-accent)', width: 20, height: 60, borderRadius: 0,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            borderLeft: leftPanelCollapsed ? '1px solid var(--admin-border)' : 'none',
            boxShadow: '4px 0 10px rgba(0,0,0,0.3)'
          }}
        >
          {leftPanelCollapsed ? <ChevronRight size={14} strokeWidth={3} /> : <ChevronRight size={14} strokeWidth={3} style={{ transform: 'rotate(180deg)' }} />}
        </button>

        {/* ── Right Panel: Details or Fleet-wide Analytics ─────────────────── */}
        <div className="central-analytics-right-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
          {selectedSnapshot ? (
            <StationAnalysisOverlay
              snapshot={selectedSnapshot}
              onClose={() => setSelectedStationId(null)}
              openStationDevices={openStationDevices}
              openStationAlerts={openStationAlerts}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              {/* Fleet-wide Analytics sub-nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-border)' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto', minWidth: 0, flex: 1 }}>
                  {[
                    { id: 'overview', label: 'TỔNG QUAN', icon: <Activity size={12} /> },
                    { id: 'thermal', label: 'BẢN ĐỒ NHIỆT', icon: <Thermometer size={12} /> },
                    { id: 'pd', label: 'PHÓNG ĐIỆN', icon: <Zap size={12} /> },
                    { id: 'health', label: 'SỨC KHỎE THIẾT BỊ', icon: <Radio size={12} /> }
                  ].map(t => (
                    <button
                      key={t.id}
                      className={`btn-industrial ${fleetTab === t.id ? 'btn-primary' : ''}`}
                      onClick={() => setFleetTab(t.id as CentralTab)}
                      style={{
                        padding: '6px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.65rem',
                        fontWeight: 900,
                        letterSpacing: '0.05em',
                        borderRadius: 0,
                        flexShrink: 0,
                      }}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                <div ref={downloadDropdownRef} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
                  <button
                    onClick={() => setDownloadDropdownOpen(v => !v)}
                    title="Xuất dữ liệu"
                    style={{
                      height: 28,
                      minWidth: 86,
                      padding: '0 10px',
                      border: '1px solid var(--admin-border)',
                      background: 'var(--admin-layer-2)',
                      color: 'var(--admin-accent)',
                      borderRadius: 0,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: '0.68rem',
                      fontWeight: 900,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <Download size={12} />
                      <span>XUẤT</span>
                    </span>
                    <ChevronDown size={11} style={{ opacity: 0.85, flexShrink: 0 }} />
                  </button>
                  {downloadDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        background: '#0b0f14',
                        border: '1px solid var(--admin-border)',
                        borderRadius: 3,
                        boxShadow: '0 4px 12px rgba(0,0,0,.5)',
                        padding: '4px 0',
                        zIndex: 30,
                        minWidth: 120,
                      }}
                    >
                      <button
                        onClick={() => {
                          exportAnalyticsXlsx();
                          setDownloadDropdownOpen(false);
                        }}
                        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--admin-text)', padding: '6px 12px', fontSize: '.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <FileSpreadsheet size={12} style={{ color: 'var(--admin-accent)' }} />
                        <span>Tải file XLSX</span>
                      </button>
                      <button
                        onClick={() => {
                          exportAnalyticsCsv();
                          setDownloadDropdownOpen(false);
                        }}
                        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--admin-text)', padding: '6px 12px', fontSize: '.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <FileSpreadsheet size={12} style={{ color: 'var(--admin-success)' }} />
                        <span>Tải file CSV</span>
                      </button>
                      <button
                        onClick={() => {
                          exportAnalyticsPdf();
                          setDownloadDropdownOpen(false);
                        }}
                        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--admin-text)', padding: '6px 12px', fontSize: '.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <FileText size={12} style={{ color: 'var(--admin-warning)' }} />
                        <span>Tải file PDF</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Fleet-wide Content Area */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }} className="custom-hud-scroll">
                {loading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                    <Activity size={32} style={{ opacity: 0.2, marginBottom: 16 }} className="pulse-slow" />
                    <div>ĐANG TỔNG HỢP DỮ LIỆU PHÂN TÍCH...</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {fleetTab === 'overview' && renderOverview()}
                    {fleetTab === 'thermal' && renderThermal()}
                    {fleetTab === 'pd' && renderPd()}
                    {fleetTab === 'health' && renderHealth()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Animations ────────────────────────────────────── */}
      <style>{`
        .pulse-slow {
          animation: pulse-slow 2.5s infinite ease-in-out;
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.05); }
        }
        .custom-hud-scroll::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-hud-scroll::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb {
          background: var(--admin-border);
          border-radius: 2px;
        }
        .custom-hud-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--admin-accent);
        }
      `}</style>
    </div>
  );
}
