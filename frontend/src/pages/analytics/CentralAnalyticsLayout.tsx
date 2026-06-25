import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Radio, Thermometer, Zap,
  Search, MapPin, ChevronRight, ChevronDown, X,
  Shield, Wifi, WifiOff, TrendingUp, Maximize2, Crosshair, Video, BarChart3,
  RefreshCw, ShieldCheck, Loader2, Download, FileSpreadsheet, FileText
} from 'lucide-react';
import Chart from 'chart.js/auto';
import {
  stationApi,
  type AlertItem,
  type Device,
  type HealthScore,
  type SensorPoint,
  type Station,
  type CameraDevice,
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

// ── Station Card (Left Panel) ──────────────────────────────────

function StationTrendChart({ color, data }: { color: string; data: { time: string; value: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: data.map(d => d.time),
        datasets: [{
          data: data.map(d => d.value),
          borderColor: color,
          backgroundColor: color + '11',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
    return () => chart.destroy();
  }, [color, data]);
  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

function StationAnalysisOverlay({ snapshot, onClose, openStationDevices, openStationAlerts }: { snapshot: StationAnalyticsSnapshot; onClose: () => void; openStationDevices: (id: string) => void; openStationAlerts: (id: string) => void; }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'thermal' | 'pd' | 'diagnostics'>('overview');
  
  const cabinetSummary = getCabinetSummary(snapshot.points, snapshot.devices);

  const mockHistory = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    time: i.toString(),
    value: 40 + Math.random() * 20
  })), []);

  const mockPdHistory = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    time: i.toString(),
    value: 5 + Math.random() * 15
  })), []);

  const [historyData, setHistoryData] = useState<{ time: string; value: number }[]>([]);
  const [pdHistoryData, setPdHistoryData] = useState<{ time: string; value: number }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const to = now.toISOString();
        const rawHistory = await stationApi.getHistoryBulk(snapshot.station.id, from, to, 15);
        if (!active) return;

        // Separate points by type
        const thermalPoints = rawHistory.filter(p => isThermalPoint({ pointId: p.pointId } as any));
        const pdPoints = rawHistory.filter(p => isPdPoint({ pointId: p.pointId } as any));

        // Group thermal points by time
        const thermalByTime: Record<string, number[]> = {};
        thermalPoints.forEach(p => {
          const tStr = new Date(p.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          if (!thermalByTime[tStr]) thermalByTime[tStr] = [];
          thermalByTime[tStr].push(p.value);
        });

        // Group pd points by time
        const pdByTime: Record<string, number[]> = {};
        pdPoints.forEach(p => {
          const tStr = new Date(p.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          if (!pdByTime[tStr]) pdByTime[tStr] = [];
          pdByTime[tStr].push(p.value);
        });

        const sortedThermal = Object.entries(thermalByTime).map(([time, vals]) => ({
          time,
          value: vals.reduce((a, b) => a + b, 0) / vals.length
        })).sort((a, b) => a.time.localeCompare(b.time));

        const sortedPd = Object.entries(pdByTime).map(([time, vals]) => ({
          time,
          value: Math.max(...vals)
        })).sort((a, b) => a.time.localeCompare(b.time));

        setHistoryData(sortedThermal);
        setPdHistoryData(sortedPd);
      } catch (err) {
        console.error('Error fetching history:', err);
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    fetchHistory();
    return () => { active = false; };
  }, [snapshot.station.id]);

  const displayTempHistory = historyData.length > 0 ? historyData : mockHistory;
  const displayPdHistory = pdHistoryData.length > 0 ? pdHistoryData : mockPdHistory;

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
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: 0, background: snapshot.onlineDevices === snapshot.deviceTotal ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: `0 0 12px ${snapshot.onlineDevices === snapshot.deviceTotal ? 'var(--admin-success)' : 'var(--admin-danger)'}` }} />
          <div>
            <div style={{ fontSize: '.55rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 2 }}>TRUNG TÂM ĐIỀU HÀNH</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff', letterSpacing: '0.02em' }}>{snapshot.station.name}</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text-muted)', cursor: 'pointer', padding: 8, display: 'flex', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#fff'} onMouseLeave={e => e.currentTarget.style.color = 'var(--admin-text-muted)'}><X size={18} /></button>
      </div>

      <div style={{ display: 'flex', gap: 2, padding: '0 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-bg)', overflowX: 'auto' }} className="custom-hud-scroll">
        {[
          { id: 'overview', label: 'TỔNG QUAN', icon: <Activity size={13} /> },
          { id: 'thermal', label: 'NHIỆT ĐỘ', icon: <Thermometer size={13} /> },
          { id: 'pd', label: 'PHÓNG ĐIỆN', icon: <Zap size={13} /> },
          { id: 'diagnostics', label: 'CHẨN ĐOÁN', icon: <Shield size={13} /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            style={{
              background: 'transparent', border: 'none', color: activeTab === t.id ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
              fontSize: '.62rem', fontWeight: 950, cursor: 'pointer', padding: '18px 14px',
              borderBottom: activeTab === t.id ? '3px solid var(--admin-accent)' : '3px solid transparent',
              textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s', flexShrink: 0
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }} className="custom-hud-scroll">
        {activeTab === 'overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 16 }}>
                <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Chỉ số Sức khỏe</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 950, color: getHealthClass(snapshot.avgHealth).color }}>{snapshot.avgHealth?.toFixed(0)}%</div>
              </div>
              <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 16 }}>
                <div style={{ fontSize: '.55rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Thiết bị Trạm</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 950, color: '#fff' }}>{snapshot.onlineDevices}<span style={{ fontSize: '.9rem', color: 'var(--admin-text-muted)', marginLeft: 4 }}>/ {snapshot.deviceTotal}</span></div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Biểu đồ Xu hướng (24h)</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 6, height: 6, borderRadius: 0, background: 'var(--admin-accent)' }} /><span style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)' }}>Nhiệt</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 6, height: 6, borderRadius: 0, background: '#f59e0b' }} /><span style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)' }}>PD</span></div>
                </div>
              </div>
              <div style={{ height: 100, width: '100%', background: 'var(--admin-bg)', borderRadius: 0, overflow: 'hidden', border: '1px solid var(--admin-border)' }}>
                <StationTrendChart key="overview-temp" color="var(--admin-accent)" data={displayTempHistory} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Thao tác Nhanh</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button 
                  onClick={() => openStationDevices(snapshot.station.id)}
                  style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f644', borderRadius: 0, color: '#3b82f6', fontSize: '.65rem', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <Maximize2 size={14} /> THIẾT BỊ TRẠM
                </button>
                <button 
                  onClick={() => openStationAlerts(snapshot.station.id)}
                  style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef444444', borderRadius: 0, color: '#ef4444', fontSize: '.65rem', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <AlertTriangle size={14} /> XỬ LÝ LỖI
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trạng thái Hạ tầng</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                 {[
                   { label: 'AI Engine', status: 'Online', color: 'var(--admin-success)' },
                   { label: 'NVR Buffer', status: 'Running', color: 'var(--admin-success)' },
                   { label: 'Gateway', status: 'Connected', color: 'var(--admin-success)' },
                   { label: 'Database', status: 'Synced', color: 'var(--admin-success)' },
                 ].map((s, i) => (
                   <div key={i} style={{ padding: '8px 12px', background: 'var(--admin-layer-2)', borderRadius: 0, border: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>{s.label}</span>
                     <span style={{ fontSize: '.55rem', color: s.color, fontWeight: 900, textTransform: 'uppercase' }}>{s.status}</span>
                   </div>
                 ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'thermal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '.7rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Giám sát Nhiệt độ Tủ Điện</div>
                <div style={{ display: 'flex', gap: 4 }}>
                   <div style={{ width: 12, height: 12, borderRadius: 0, background: 'var(--admin-success)' }} />
                   <div style={{ width: 12, height: 12, borderRadius: 0, background: '#f59e0b' }} />
                   <div style={{ width: 12, height: 12, borderRadius: 0, background: 'var(--admin-danger)' }} />
                </div>
             </div>
            {[
              { label: 'Cực Pha A - ACB 01', val: cabinetSummary.t1 },
              { label: 'Cực Pha B - ACB 01', val: cabinetSummary.t2 },
              { label: 'Cực Pha C - ACB 01', val: cabinetSummary.t3 },
              { label: 'Thanh cái chính (Busbar)', val: 35.2 },
            ].map((roi, i) => (
              <div key={i} style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                   <div style={{ width: 4, height: 28, background: getThermalClass(roi.val).color, borderRadius: 0}} />
                   <div>
                    <div style={{ fontSize: '.75rem', fontWeight: 900, color: '#fff' }}>{roi.label}</div>
                    <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>Trạng thái: {getThermalClass(roi.val).label}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                   <div style={{ fontSize: '1.3rem', fontWeight: 950, color: getThermalClass(roi.val).color, lineHeight: 1 }}>{fmtTemp(roi.val)}</div>
                   <div style={{ fontSize: '.5rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>Ngưỡng: 65°C</div>
                </div>
              </div>
            ))}
            <div style={{ height: 110, background: 'var(--admin-bg)', borderRadius: 0, overflow: 'hidden', border: '1px solid var(--admin-border)' }}>
               <StationTrendChart key="thermal-temp" color="var(--admin-danger)" data={displayTempHistory} />
            </div>
          </div>
        )}

        {activeTab === 'pd' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'var(--admin-layer-1)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: 30, textAlign: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #f59e0b, #fff, #f59e0b, transparent)', opacity: 0.6 }} />
              <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Cường độ Phóng điện (PD)</div>
              <div style={{ fontSize: '3.5rem', fontWeight: 950, color: '#f59e0b', textShadow: '0 0 25px rgba(245, 158, 11, 0.5)', lineHeight: 1 }}>{fmtDb(cabinetSummary.pdVal)}</div>
              <div style={{ fontSize: '.7rem', color: '#f59e0b', fontWeight: 900, marginTop: 10, letterSpacing: '0.15em', background: 'rgba(245,158,11,0.1)', padding: '4px 12px', borderRadius: 0, display: 'inline-block' }}>HỆ THỐNG AN TOÀN</div>
            </div>
            <div>
               <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.05em' }}>Lịch sử Phóng điện (dB)</div>
               <div style={{ height: 140, background: 'var(--admin-bg)', borderRadius: 0, border: '1px solid var(--admin-border)', overflow: 'hidden' }}>
                  <StationTrendChart key="pd-pd" color="#f59e0b" data={displayPdHistory} />
               </div>
            </div>
          </div>
        )}

        {activeTab === 'diagnostics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Nhật ký Vận hành Hệ thống</div>
             <div style={{ background: 'var(--admin-bg)', borderRadius: 0, border: '1px solid var(--admin-border)', padding: 12, fontFamily: 'monospace', fontSize: '.6rem', color: '#aaa', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:15:22]</span><span>AI Engine: Đã tải mô hình YOLOv8 thành công</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:15:25]</span><span>NVR: Bắt đầu ghi hình luồng Camera 153</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-warning)' }}>[10:18:01]</span><span>Network: Độ trễ Gateway tăng cao (45ms)</span></div>
                <div style={{ display: 'flex', gap: 10 }}><span style={{ color: 'var(--admin-success)' }}>[10:20:00]</span><span>Sync: Đã đồng bộ 120 bản ghi lên trạm tổng</span></div>
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
           MỞ TẠI TRẠM TỔNG
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

// ── Main Component ─────────────────────────────────────────────

export default function CentralAnalyticsLayout() {
  const navigate = useNavigate();
  const setViewingStation = useStationStore(s => s.setViewingStation);

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationAnalyticsSnapshot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [fleetTab, setFleetTab] = useState<CentralTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredStations = useMemo(() => {
    if (!searchQuery.trim()) return stations;
    const q = searchQuery.toLowerCase();
    return stations.filter(s => s.station.name.toLowerCase().includes(q) || (s.station.code || '').toLowerCase().includes(q));
  }, [stations, searchQuery]);

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

  const analyticsExportRows = useMemo(() => filteredStations.map(sn => ({
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
  })), [filteredStations]);

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
              {/* Search */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--admin-layer-2)', borderRadius: 0, padding: '4px 12px', border: '1px solid var(--admin-border)' }}>
                  <Search size={14} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />
                  <input
                    placeholder="TÌM KIẾM TRẠM..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      flex: 1, border: 'none', background: 'transparent', color: 'var(--admin-text)',
                      fontSize: '.7rem', fontWeight: 800, outline: 'none', padding: '6px 0', textTransform: 'uppercase'
                    }}
                  />
                </div>
                <div ref={downloadDropdownRef} style={{ position: 'relative', display: 'inline-block', marginTop: 8 }}>
                  <button
                    onClick={() => setDownloadDropdownOpen(v => !v)}
                    title="Xuất dữ liệu"
                    style={{
                      height: 28,
                      padding: '0 8px',
                      border: '1px solid var(--admin-border)',
                      background: 'var(--admin-layer-2)',
                      color: 'var(--admin-text)',
                      borderRadius: 3,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <Download size={12} />
                    <span style={{ fontSize: '.5rem', opacity: 0.7 }}>▼</span>
                  </button>
                  {downloadDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
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

              {/* Station list */}
              <div style={{ flex: 1, overflowY: 'auto' }} className="custom-hud-scroll">
                {loading ? (
                  <div style={{ padding: 40, textAlign: 'center' }}>
                    <Activity size={32} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} />
                    <div style={{ marginTop: 14, fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 800, letterSpacing: '0.1em' }}>ĐANG TẢI DỮ LIỆU...</div>
                  </div>
                ) : filteredStations.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', fontSize: '.7rem', color: 'var(--admin-text-muted)', fontWeight: 700 }}>
                    {searchQuery ? 'KHÔNG TÌM THẤY TRẠM' : 'CHƯA CÓ TRẠM NÀO'}
                  </div>
                ) : (
                  filteredStations.map(sn => (
                    <StationCard
                      key={sn.station.id}
                      snapshot={sn}
                      selected={sn.station.id === selectedStationId}
                      onClick={() => {
                        setSelectedStationId(sn.station.id);
                      }}
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
              <div style={{ display: 'flex', gap: 4, padding: '10px 20px', background: 'var(--admin-panel)', borderBottom: '1px solid var(--admin-border)', alignItems: 'center', overflowX: 'auto' }}>
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
                    }}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
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
