import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Radio, Thermometer, Zap,
  Search, MapPin, ChevronRight, ChevronDown, X,
  Shield, Wifi, WifiOff, TrendingUp, Maximize2, Crosshair
} from 'lucide-react';
import Chart from 'chart.js/auto';
import {
  stationApi,
  type AlertItem,
  type Device,
  type HealthScore,
  type SensorPoint,
  type Station,
} from '@/services/StationApiService';
import { useStationStore } from '@/store';
import { MULTISITE_RETURN_TAB_KEY } from '@/utils/centralAccess';
import './AnalyticsLayout.css';

// ── Types ──────────────────────────────────────────────────────

interface StationAnalyticsSnapshot {
  station: Station;
  devices: Device[];
  points: SensorPoint[];
  healthScores: HealthScore[];
  avgHealth: number | null;
  onlineDevices: number;
  openAlerts: number;
  warningPdPoints: number;
  hottestPoint: { value: number; label: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────

const isThermalPoint = (point: SensorPoint) =>
  point.unit?.includes('C') || /nhiet|temp|thermal/i.test(point.pointId || '');

const isPdPoint = (point: SensorPoint) => /pd|phong_dien/i.test(point.pointId || '');

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

// ── Cabinet Summary Helper ─────────────────────────────────────

function getCabinetSummary(points: SensorPoint[], devices: Device[]) {
  const t1 = points.find(p => p.pointId === 'nhiet_do_pha_1' || p.pointId === 'temp_1')?.value ?? null;
  const t2 = points.find(p => p.pointId === 'nhiet_do_pha_2' || p.pointId === 'temp_2')?.value ?? null;
  const t3 = points.find(p => p.pointId === 'nhiet_do_pha_3' || p.pointId === 'temp_3')?.value ?? null;
  const pdVal = points.find(p => p.pointId === 'phong_dien' || p.pointId === 'pd')?.value ?? null;
  const cabinetDevices = devices.filter(d => d.type === 'cabinet');
  const thermalCameras = devices.filter(d => d.type === 'camera_thermal');
  const pdCameras = devices.filter(d => d.type === 'camera_pd');
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', background: 'var(--admin-layer-2)', borderRadius: 6, border: '1px solid var(--admin-border)' }}>
      <span style={{ color: color || 'var(--admin-accent)', display: 'flex', alignItems: 'center' }}>{icon}</span>
      <div>
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{label}</div>
        <div style={{ fontSize: '.85rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}

// ── Station Card (Left Panel) ──────────────────────────────────

function StationCard({ snapshot, selected, onClick }: { snapshot: StationAnalyticsSnapshot; selected: boolean; onClick: () => void }) {
  const health = getHealthClass(snapshot.avgHealth);
  const thermal = getThermalClass(snapshot.hottestPoint?.value ?? null);
  const hasAlerts = snapshot.openAlerts > 0;

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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasAlerts && (
            <span style={{ background: 'var(--admin-danger)', color: '#fff', fontSize: '.55rem', fontWeight: 900, padding: '1px 7px', borderRadius: 10, letterSpacing: '0.03em' }}>
              {snapshot.openAlerts}
            </span>
          )}
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: snapshot.onlineDevices === snapshot.devices.length && snapshot.devices.length > 0 ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: snapshot.onlineDevices === snapshot.devices.length && snapshot.devices.length > 0 ? '0 0 6px var(--admin-success)' : '0 0 6px var(--admin-danger)' }} />
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Health mini ring */}
        <div style={{ position: 'relative', width: 32, height: 32, flexShrink: 0 }}>
          <svg width="32" height="32" viewBox="0 0 36 36">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--admin-layer-2)" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={health.color} strokeWidth="3" strokeDasharray={`${snapshot.avgHealth ?? 0}, 100`} strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.5rem', fontWeight: 900, color: health.color }}>
            {snapshot.avgHealth != null ? Math.round(snapshot.avgHealth) : '—'}
          </div>
        </div>

        {/* Thermal & PD mini */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '.55rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Thermometer size={10} style={{ color: thermal.color }} />
            <span style={{ color: thermal.color, fontWeight: 800 }}>{snapshot.hottestPoint ? `${snapshot.hottestPoint.value.toFixed(0)}°C` : '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Zap size={10} style={{ color: snapshot.warningPdPoints > 0 ? '#f59e0b' : 'var(--admin-text-muted)' }} />
            <span style={{ color: snapshot.warningPdPoints > 0 ? '#f59e0b' : 'var(--admin-text-muted)', fontWeight: 800 }}>{snapshot.warningPdPoints > 0 ? `${snapshot.warningPdPoints} PD` : 'Sạch'}</span>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
          {snapshot.onlineDevices}/{snapshot.devices.length}
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
          borderRadius: display > 0 ? 4 : 0,
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
      <div style={{ height: 6, background: 'var(--admin-layer-2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
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
      borderRadius: 6,
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
              borderRadius: 4,
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

// ── Main Component ─────────────────────────────────────────────

export default function CentralAnalyticsLayout() {
  const navigate = useNavigate();
  const setViewingStation = useStationStore(s => s.setViewingStation);

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationAnalyticsSnapshot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const markerMapRef = useRef<Record<string, any>>({});
  const [leafletReady, setLeafletReady] = useState(false);
  const [mapFitTrigger, setMapFitTrigger] = useState(0);

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
            const [devices, points, healthScores] = await Promise.all([
              stationApi.getDevices(station.id).catch(() => [] as Device[]),
              stationApi.getLatestPoints(station.id).catch(() => [] as SensorPoint[]),
              stationApi.getHealthScores(station.id).catch(() => [] as HealthScore[]),
            ]);

            const healthValues = healthScores
              .map(item => item.score)
              .filter((value): value is number => Number.isFinite(value));
            const avgHealth = healthValues.length > 0
              ? healthValues.reduce((sum, value) => sum + value, 0) / healthValues.length
              : null;

            const hottest = points
              .filter(isThermalPoint)
              .reduce<{ value: number; label: string } | null>((max, point) => {
                if (typeof point.value !== 'number') return max;
                if (!max || point.value > max.value) return { value: point.value, label: point.pointId };
                return max;
              }, null);

            const stationAlerts = recentAlerts.filter(a => a.stationId === station.id && a.status !== 'closed');
            const warningPdPoints = points.filter(p => isPdPoint(p) && typeof p.value === 'number' && p.value >= 20).length;

            return {
              station, devices, points, healthScores,
              avgHealth,
              onlineDevices: devices.filter(d => d.status === 'online').length,
              openAlerts: stationAlerts.length,
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
        setMapFitTrigger(t => t + 1);
      }
    };
    load();
  }, []);

  // ── Computed Values ────────────────────────────────────────

  const fleetSummary = useMemo(() => {
    const totalStations = stations.length;
    const totalDevices = stations.reduce((s, i) => s + i.devices.length, 0);
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

  const filteredStations = useMemo(() => {
    if (!searchQuery.trim()) return stations;
    const q = searchQuery.toLowerCase();
    return stations.filter(s => s.station.name.toLowerCase().includes(q) || (s.station.code || '').toLowerCase().includes(q));
  }, [stations, searchQuery]);

  // ── Leaflet Map ────────────────────────────────────────────

  // Detect Leaflet CDN
  useEffect(() => {
    if ((window as any).L) { setLeafletReady(true); return; }
    const iv = setInterval(() => { if ((window as any).L) { setLeafletReady(true); clearInterval(iv); } }, 150);
    return () => clearInterval(iv);
  }, []);

  // Initialize map
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapContainerRef.current || !leafletReady) return;

    // Clean previous
    if (leafletMap.current) {
      try { leafletMap.current.remove(); } catch {}
      leafletMap.current = null;
    }
    markerMapRef.current = {};
    mapContainerRef.current.innerHTML = '';
    try { delete (mapContainerRef.current as any)._leaflet_id; } catch {}

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([16.0, 107.5], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
    }).addTo(map);

    leafletMap.current = map;

    // Fit when data loads
    setMapFitTrigger(t => t + 1);

    return () => {
      try { map.remove(); } catch {}
      leafletMap.current = null;
    };
  }, [leafletReady]);

  // Update markers
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMap.current;
    if (!L || !map) return;

    // Clear existing markers
    Object.values(markerMapRef.current).forEach((m: any) => { try { map.removeLayer(m); } catch {} });
    markerMapRef.current = {};

    const bounds: any[] = [];

    stations.forEach(sn => {
      const loc = parseLocation(sn.station.location);
      if (loc.lat == null || loc.lng == null) return;

      const health = getHealthClass(sn.avgHealth);
      const hasAlerts = sn.openAlerts > 0;
      const isSelected = sn.station.id === selectedStationId;

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width: ${isSelected ? '18px' : '14px'};
          height: ${isSelected ? '18px' : '14px'};
          background: ${hasAlerts ? 'var(--admin-danger)' : health.color};
          border: 2px solid #fff;
          border-radius: 50%;
          box-shadow: 0 0 ${isSelected ? '14px' : '8px'} ${hasAlerts ? 'var(--admin-danger)' : health.color};
          transition: all 0.2s;
          ${isSelected ? 'transform: scale(1.3);' : ''}
        "></div>`,
        iconSize: [isSelected ? 18 : 14, isSelected ? 18 : 14],
        iconAnchor: [isSelected ? 9 : 7, isSelected ? 9 : 7],
      });

      const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family:monospace;font-size:11px;min-width:140px">
          <b>${sn.station.name}</b><br/>
          <span style="font-size:10px;opacity:.7">${sn.station.code || '—'}</span>
          <hr style="margin:6px 0;border-color:rgba(255,255,255,.1)"/>
          Health: <b style="color:${health.color}">${sn.avgHealth != null ? sn.avgHealth.toFixed(0) : '—'}</b><br/>
          Devices: ${sn.onlineDevices}/${sn.devices.length}<br/>
          Alerts: <b style="color:${hasAlerts ? 'var(--admin-danger)' : 'inherit'}">${sn.openAlerts}</b>
        </div>
      `);
      marker.on('click', () => setSelectedStationId(sn.station.id));

      markerMapRef.current[sn.station.id] = marker;
      bounds.push([loc.lat, loc.lng]);
    });

    // Fit bounds
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
      } catch {}
    }
  }, [stations, selectedStationId, mapFitTrigger]);

  // Highlight selected marker
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMap.current;
    if (!L || !map) return;

    stations.forEach(sn => {
      const marker = markerMapRef.current[sn.station.id];
      if (!marker) return;
      const loc = parseLocation(sn.station.location);
      if (loc.lat == null) return;

      const health = getHealthClass(sn.avgHealth);
      const hasAlerts = sn.openAlerts > 0;
      const isSelected = sn.station.id === selectedStationId;

      try {
        marker.setIcon(L.divIcon({
          className: '',
          html: `<div style="
            width: ${isSelected ? '18px' : '14px'};
            height: ${isSelected ? '18px' : '14px'};
            background: ${hasAlerts ? 'var(--admin-danger)' : health.color};
            border: 2px solid #fff;
            border-radius: 50%;
            box-shadow: 0 0 ${isSelected ? '14px' : '8px'} ${hasAlerts ? 'var(--admin-danger)' : health.color};
            transition: all 0.2s;
            ${isSelected ? 'transform: scale(1.3);' : ''}
          "></div>`,
          iconSize: [isSelected ? 18 : 14, isSelected ? 18 : 14],
          iconAnchor: [isSelected ? 9 : 7, isSelected ? 9 : 7],
        }));
      } catch {}
    });
  }, [selectedStationId, stations]);

  // ── Actions ────────────────────────────────────────────────

  const drillIntoStation = useCallback((stationId: string) => {
    localStorage.setItem(MULTISITE_RETURN_TAB_KEY, 'analytics');
    setViewingStation(stationId);
    navigate(`/dashboard?station=${stationId}`);
  }, [navigate, setViewingStation]);

  const navigateToAnalytics = useCallback((stationId: string, tab: string) => {
    localStorage.setItem('multisite_return_tab', 'analytics');
    setViewingStation(stationId);
    navigate(`/analytics?tab=${tab}`);
  }, [navigate, setViewingStation]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="central-analytics-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      {/* ── Top Header Bar ─────────────────────────────────── */}
      <div className="central-analytics-header" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 18px',
        background: 'var(--admin-panel)',
        borderBottom: '1px solid var(--admin-border)',
        minHeight: 44,
        gap: 12,
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Crosshair size={18} style={{ color: 'var(--admin-accent)' }} />
          <h2 style={{ margin: 0, fontSize: '.78rem', fontWeight: 900, color: 'var(--admin-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            TRUNG TÂM ĐIỀU HÀNH PHÂN TÍCH
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <KpiBadge label="Trạm" value={fleetSummary.totalStations} icon={<Radio size={14} />} color="var(--admin-accent)" />
          <KpiBadge label="Health TB" value={fleetSummary.avgHealth != null ? `${fleetSummary.avgHealth.toFixed(0)}%` : '—'} icon={<Activity size={14} />} color={getHealthClass(fleetSummary.avgHealth).color} />
          <KpiBadge label="Cảnh báo" value={fleetSummary.totalAlerts} icon={<AlertTriangle size={14} />} color={fleetSummary.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-success)'} />
          <KpiBadge label="Hotspot" value={fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(0)}°C` : '—'} icon={<Thermometer size={14} />} color="var(--admin-danger)" />
        </div>
      </div>

      {/* ── Main Content: 3 Panels ────────────────────────── */}
      <div className="central-analytics-main" style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* ── Left Panel: Station List ────────────────────── */}
        <div className="central-analytics-left" style={{
          width: leftPanelCollapsed ? 0 : 260,
          minWidth: leftPanelCollapsed ? 0 : 260,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--admin-panel)',
          borderRight: leftPanelCollapsed ? 'none' : '1px solid var(--admin-border)',
          overflow: 'hidden',
          transition: 'width 0.3s ease, min-width 0.3s ease'
        }}>
          {!leftPanelCollapsed && (
            <>
              {/* Search */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--admin-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--admin-layer-2)', borderRadius: 4, padding: '2px 10px', border: '1px solid var(--admin-border)' }}>
                  <Search size={12} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />
                  <input
                    placeholder="Tìm trạm..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      flex: 1, border: 'none', background: 'transparent', color: 'var(--admin-text)',
                      fontSize: '.65rem', fontWeight: 700, outline: 'none', padding: '4px 0'
                    }}
                  />
                  {searchQuery && <X size={12} style={{ color: 'var(--admin-text-muted)', cursor: 'pointer', flexShrink: 0 }} onClick={() => setSearchQuery('')} />}
                </div>
              </div>

              {/* Station list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                  <div style={{ padding: 30, textAlign: 'center' }}>
                    <Activity size={24} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} />
                    <div style={{ marginTop: 10, fontSize: '.65rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>Đang tải...</div>
                  </div>
                ) : filteredStations.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', fontSize: '.65rem', color: 'var(--admin-text-muted)' }}>
                    {searchQuery ? 'Không tìm thấy trạm' : 'Chưa có trạm nào'}
                  </div>
                ) : (
                  filteredStations.map(sn => (
                    <StationCard
                      key={sn.station.id}
                      snapshot={sn}
                      selected={sn.station.id === selectedStationId}
                      onClick={() => setSelectedStationId(sn.station.id === selectedStationId ? null : sn.station.id)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Left panel toggle */}
        <button
          onClick={() => setLeftPanelCollapsed(v => !v)}
          style={{
            position: 'absolute', left: leftPanelCollapsed ? 0 : 260, top: '50%', transform: 'translateY(-50%)',
            zIndex: 10, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)',
            color: 'var(--admin-text-muted)', width: 22, height: 48, borderRadius: '0 4px 4px 0',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'left 0.3s ease',
            borderLeft: leftPanelCollapsed ? '1px solid var(--admin-border)' : 'none'
          }}
        >
          {leftPanelCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} style={{ transform: 'rotate(90deg)' }} />}
        </button>

        {/* ── Center: Map ─────────────────────────────────── */}
        <div className="central-analytics-map" style={{ flex: 1, position: 'relative', background: '#0a1628' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,22,40,0.7)', zIndex: 5 }}>
              <div style={{ textAlign: 'center' }}>
                <Activity size={32} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} />
                <div style={{ marginTop: 8, fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.05em' }}>TỔNG HỢP DỮ LIỆU...</div>
              </div>
            </div>
          )}

          {/* Map zoom controls */}
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              className="btn-industrial"
              onClick={() => leafletMap.current?.zoomIn()}
              style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', padding: 0 }}
            >+</button>
            <button
              className="btn-industrial"
              onClick={() => leafletMap.current?.zoomOut()}
              style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', padding: 0 }}
            >−</button>
            <button
              className="btn-industrial"
              onClick={() => setMapFitTrigger(t => t + 1)}
              style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              title="Fit all stations"
            ><Maximize2 size={12} /></button>
          </div>
        </div>

        {/* Right panel toggle */}
        <button
          onClick={() => setRightPanelCollapsed(v => !v)}
          style={{
            position: 'absolute', right: rightPanelCollapsed ? 0 : 340, top: '50%', transform: 'translateY(-50%)',
            zIndex: 10, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)',
            color: 'var(--admin-text-muted)', width: 22, height: 48, borderRadius: '4px 0 0 4px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'right 0.3s ease',
            borderRight: rightPanelCollapsed ? '1px solid var(--admin-border)' : 'none'
          }}
        >
          {rightPanelCollapsed ? <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /> : <ChevronDown size={12} style={{ transform: 'rotate(-90deg)' }} />}
        </button>

        {/* ── Right Panel: Detail / Overview ──────────────── */}
        <div className="central-analytics-right" style={{
          width: rightPanelCollapsed ? 0 : 340,
          minWidth: rightPanelCollapsed ? 0 : 340,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--admin-panel)',
          borderLeft: rightPanelCollapsed ? 'none' : '1px solid var(--admin-border)',
          overflow: 'hidden',
          transition: 'width 0.3s ease, min-width 0.3s ease'
        }}>
          {!rightPanelCollapsed && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {selectedSnapshot ? (
                /* ── Station Detail Scorecard ──────────────────── */
                <>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 16, borderBottom: '1px solid var(--admin-border)' }}>
                    <div>
                      <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-accent)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Scorecard Trạm</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--admin-text)', letterSpacing: '0.02em' }}>{selectedSnapshot.station.name}</div>
                      <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontFamily: 'var(--admin-font-mono)', marginTop: 2 }}>{selectedSnapshot.station.code || 'NO-CODE'}</div>
                    </div>
                    <button 
                      onClick={() => setSelectedStationId(null)} 
                      style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 6, color: 'var(--admin-text-muted)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--admin-text)'; e.currentTarget.style.borderColor = 'var(--admin-text-muted)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--admin-text-muted)'; e.currentTarget.style.borderColor = 'var(--admin-border)'; }}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Primary KPI: Health */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 20px' }}>
                    <HealthGauge score={selectedSnapshot.avgHealth} />
                    <div style={{ marginTop: 12, padding: '4px 14px', background: `${getHealthClass(selectedSnapshot.avgHealth).color}15`, border: `1px solid ${getHealthClass(selectedSnapshot.avgHealth).color}30`, borderRadius: 20, color: getHealthClass(selectedSnapshot.avgHealth).color, fontSize: '.65rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {getHealthClass(selectedSnapshot.avgHealth).label}
                    </div>
                  </div>

                  {/* Secondary KPIs Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--admin-text-muted)' }}>
                        <Wifi size={13} style={{ color: 'var(--admin-success)' }} /> <span style={{ fontSize: '.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kết nối</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1 }}>{selectedSnapshot.onlineDevices}</span>
                        <span style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>/ {selectedSnapshot.devices.length} thiết bị</span>
                      </div>
                    </div>
                    
                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--admin-text-muted)' }}>
                        <Thermometer size={13} style={{ color: 'var(--admin-danger)' }} /> <span style={{ fontSize: '.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Điểm nóng</span>
                      </div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 900, color: getThermalClass(selectedSnapshot.hottestPoint?.value ?? null).color, lineHeight: 1 }}>
                        {selectedSnapshot.hottestPoint ? `${selectedSnapshot.hottestPoint.value.toFixed(1)}°` : '—'}
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Zap size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cảnh báo Phóng điện</div>
                          <div style={{ fontSize: '.9rem', fontWeight: 900, color: getPdClass(selectedSnapshot.warningPdPoints).color, marginTop: 2 }}>
                            {selectedSnapshot.warningPdPoints > 0 ? `${selectedSnapshot.warningPdPoints} điểm phát hiện` : 'Hệ thống an toàn'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Context Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(cabinetSummary?.thermalCameraCount ?? 0) > 0 && (
                      <button 
                        onClick={() => navigateToAnalytics(selectedSnapshot.station.id, 'thermal')} 
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--admin-hover)'; e.currentTarget.style.borderColor = 'var(--admin-text-muted)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--admin-panel)'; e.currentTarget.style.borderColor = 'var(--admin-border)'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Thermometer size={14} style={{ color: 'var(--admin-danger)' }} />
                          <span style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--admin-text)' }}>Phân tích AI Nhiệt</span>
                        </div>
                        <ChevronRight size={14} style={{ color: 'var(--admin-text-muted)' }} />
                      </button>
                    )}
                    {(cabinetSummary?.pdCameraCount ?? 0) > 0 && (
                      <button 
                        onClick={() => navigateToAnalytics(selectedSnapshot.station.id, 'pd')} 
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--admin-hover)'; e.currentTarget.style.borderColor = 'var(--admin-text-muted)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--admin-panel)'; e.currentTarget.style.borderColor = 'var(--admin-border)'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Zap size={14} style={{ color: '#f59e0b' }} />
                          <span style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--admin-text)' }}>Phân tích Phóng điện</span>
                        </div>
                        <ChevronRight size={14} style={{ color: 'var(--admin-text-muted)' }} />
                      </button>
                    )}
                  </div>

                  {/* Alerts Warning */}
                  {selectedSnapshot.openAlerts > 0 && (
                    <div style={{ marginTop: 'auto', background: 'rgba(239,68,68,0.1)', borderLeft: '3px solid var(--admin-danger)', padding: '12px 16px', borderRadius: '0 8px 8px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <AlertTriangle size={16} style={{ color: 'var(--admin-danger)' }} />
                        <span style={{ fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-danger)', letterSpacing: '0.05em' }}>{selectedSnapshot.openAlerts} CẢNH BÁO ĐANG MỞ</span>
                      </div>
                    </div>
                  )}

                  {/* Action */}
                  <button
                    onClick={() => drillIntoStation(selectedSnapshot.station.id)}
                    style={{
                      marginTop: selectedSnapshot.openAlerts > 0 ? 16 : 'auto',
                      padding: '14px',
                      fontSize: '.75rem',
                      fontWeight: 900,
                      background: 'var(--admin-accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      letterSpacing: '0.08em',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.5)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(59, 130, 246, 0.4)'; }}
                  >
                    <TrendingUp size={15} /> TRUY XUẤT CHI TIẾT
                  </button>
                </>
              ) : (
                /* ── Fleet Overview Scorecard ──────────────────── */
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 20px', borderBottom: '1px solid var(--admin-border)', marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(59, 130, 246, 0.1)', color: 'var(--admin-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                      <Shield size={24} />
                    </div>
                    <div style={{ fontSize: '.9rem', fontWeight: 900, color: 'var(--admin-text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tổng quan hệ thống</div>
                    <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>Chọn một trạm để xem chi tiết</div>
                  </div>

                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(59, 130, 246, 0.1)', color: 'var(--admin-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Radio size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tổng trạm</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1, marginTop: 4 }}>{fleetSummary.totalStations}</div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(16, 185, 129, 0.1)', color: 'var(--admin-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Wifi size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Thiết bị Online</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
                          <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1 }}>{fleetSummary.totalOnline}</span>
                          <span style={{ fontSize: '.8rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>/{fleetSummary.totalDevices}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-layer-1)', border: fleetSummary.totalAlerts > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--admin-border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: fleetSummary.totalAlerts > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--admin-layer-2)', color: fleetSummary.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AlertTriangle size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cảnh báo mở</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: fleetSummary.totalAlerts > 0 ? 'var(--admin-danger)' : 'var(--admin-text)', lineHeight: 1, marginTop: 4 }}>{fleetSummary.totalAlerts}</div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--admin-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Thermometer size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hotspot toàn hệ thống</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1, marginTop: 4 }}>
                          {fleetSummary.hottest ? `${fleetSummary.hottest.value.toFixed(1)}°C` : 'N/A'}
                        </div>
                        {fleetSummary.hottest && (
                          <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>{fleetSummary.hottest.stationName}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: fleetSummary.totalPdWarnings > 0 ? 'rgba(245, 158, 11, 0.1)' : 'var(--admin-layer-2)', color: fleetSummary.totalPdWarnings > 0 ? '#f59e0b' : 'var(--admin-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Zap size={18} />
                      </div>
                      <div>
                        <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Điểm PD cảnh báo</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--admin-text)', lineHeight: 1, marginTop: 4 }}>{fleetSummary.totalPdWarnings}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Animations ────────────────────────────────────── */}
      <style>{`
        .pulse-slow {
          animation: pulse-slow 2s infinite ease-in-out;
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
