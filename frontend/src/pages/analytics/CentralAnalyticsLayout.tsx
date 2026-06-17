import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Radio, Thermometer, Zap,
  Search, MapPin, ChevronRight, ChevronDown, X,
  Shield, Wifi, WifiOff, TrendingUp, Maximize2, Crosshair, Video, BarChart3,
  RefreshCw, ShieldCheck, Loader2
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
  const [activeTab, setActiveTab] = useState<'overview' | 'thermal' | 'pd' | 'live' | 'alerts' | 'diagnostics'>('overview');
  const [localAlerts, setLocalAlerts] = useState<AlertItem[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const cabinetSummary = getCabinetSummary(snapshot.points, snapshot.devices);
  
  const loadStationAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const res = await stationApi.getAlerts('open', undefined, undefined, 20, snapshot.station.id);
      setLocalAlerts(res);
    } catch (err) {
      console.error('Failed to load station alerts', err);
    } finally {
      setLoadingAlerts(false);
    }
  }, [snapshot.station.id]);

  useEffect(() => {
    if (activeTab === 'alerts') loadStationAlerts();
  }, [activeTab, loadStationAlerts]);

  const handleAck = async (id: string) => {
    try {
      await stationApi.ackAlert(id, 'Xác nhận từ trạm tổng');
      setLocalAlerts(prev => prev.filter(a => a.id !== id));
      showToast('Đã xác nhận cảnh báo', 'success');
    } catch (err) {
      showToast('Lỗi khi xác nhận', 'error');
    }
  };

  const mockHistory = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    time: i.toString(),
    value: 40 + Math.random() * 20
  })), []);

  const mockPdHistory = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    time: i.toString(),
    value: 5 + Math.random() * 15
  })), []);

  const selectedCamera = useMemo(() => {
    return snapshot.devices.find(d => d.type.startsWith('camera')) as CameraDevice | undefined;
  }, [snapshot.devices]);

  return (
      <div 
      className="station-overlay-animate"
      style={{
        position: 'absolute', top: 16, left: 16, bottom: 16, width: 440,
        background: 'var(--admin-panel)',
        border: '1px solid var(--admin-accent)', borderRadius: 0,
        zIndex: 1010, display: 'flex', flexDirection: 'column',
        boxShadow: '4px 4px 0 rgba(0,0,0,0.5)', overflow: 'hidden'
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
          { id: 'live', label: 'TRỰC TIẾP', icon: <Video size={13} /> },
          { id: 'alerts', label: `SỰ CỐ (${snapshot.openAlerts})`, icon: <AlertTriangle size={13} />, color: snapshot.openAlerts > 0 ? 'var(--admin-danger)' : undefined },
          { id: 'thermal', label: 'NHIỆT ĐỘ', icon: <Thermometer size={13} /> },
          { id: 'pd', label: 'PHÓNG ĐIỆN', icon: <Zap size={13} /> },
          { id: 'diagnostics', label: 'CHẨN ĐOÁN', icon: <Shield size={13} /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            style={{
              background: 'transparent', border: 'none', color: activeTab === t.id ? (t.color || 'var(--admin-accent)') : 'var(--admin-text-muted)',
              fontSize: '.62rem', fontWeight: 950, cursor: 'pointer', padding: '18px 14px',
              borderBottom: activeTab === t.id ? `3px solid ${t.color || 'var(--admin-accent)'}` : '3px solid transparent',
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
                <StationTrendChart color="var(--admin-accent)" data={mockHistory} />
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

        {activeTab === 'live' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ flex: 1, background: '#000', borderRadius: 0, overflow: 'hidden', border: '1px solid var(--admin-border)', position: 'relative', minHeight: 240, boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)' }}>
              {selectedCamera ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--admin-text-muted)', gap: 14 }}>
                   <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 16px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', display: 'flex', justifyContent: 'space-between', zIndex: 1 }}>
                      <span style={{ fontSize: '.65rem', fontWeight: 800, color: '#fff' }}>{selectedCamera.name}</span>
                      <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)' }}>{selectedCamera.config.ip || '192.168.1.150'}</span>
                   </div>
                   <Video size={56} style={{ opacity: 0.2, color: 'var(--admin-accent)' }} />
                   <div style={{ fontSize: '.65rem', fontWeight: 800, letterSpacing: '0.1em' }}>Hệ thống đang kết nối luồng RTSP...</div>
                   <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 8 }}>
                      <div style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.6)', borderRadius: 0, fontSize: '.55rem', fontWeight: 900, color: 'var(--admin-success)', border: '1px solid var(--admin-success)' }}>25 FPS</div>
                      <div style={{ padding: '4px 10px', background: 'rgba(0,0,0,0.6)', borderRadius: 0, fontSize: '.55rem', fontWeight: 900, color: 'var(--admin-accent)', border: '1px solid var(--admin-accent)' }}>4K ULTRA</div>
                   </div>
                   <div style={{ position: 'absolute', top: 12, right: 12, padding: '4px 10px', background: 'rgba(239, 68, 68, 0.9)', color: '#fff', fontSize: '.6rem', fontWeight: 900, borderRadius: 0, boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)' }}>REC LIVE</div>
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted)', fontSize: '.75rem' }}>
                  Trạm hiện chưa cấu hình Camera IP
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button style={{ padding: '12px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: '#fff', fontSize: '.7rem', fontWeight: 900, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--admin-layer-2)'}>CHỤP ẢNH TỨC THÌ</button>
              <button style={{ padding: '12px', background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', borderRadius: 0, color: '#fff', fontSize: '.7rem', fontWeight: 900, cursor: 'pointer', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--admin-layer-2)'}>GHI HÌNH SỰ KIỆN</button>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
               <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>Danh sách Sự cố</div>
               <button onClick={loadStationAlerts} style={{ background: 'transparent', border: 'none', color: 'var(--admin-accent)', cursor: 'pointer' }}><RefreshCw size={14} /></button>
            </div>
            {loadingAlerts ? (
              <div style={{ padding: 60, textAlign: 'center' }}><Activity size={28} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} /></div>
            ) : localAlerts.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', border: '1px dashed var(--admin-border)', borderRadius: 0}}>
                 <ShieldCheck size={32} style={{ color: 'var(--admin-success)', opacity: 0.3, marginBottom: 12 }} />
                 <div style={{ color: 'var(--admin-text-muted)', fontSize: '.7rem', fontWeight: 700 }}>Hệ thống vận hành an toàn</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {localAlerts.map(alert => (
                  <div key={alert.id} style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-danger)', letterSpacing: '0.01em' }}>{alert.message}</div>
                      <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', fontWeight: 800, background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 0}}>{new Date(alert.triggeredAt).toLocaleTimeString()}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                         <div style={{ width: 6, height: 6, borderRadius: 0, background: alert.level === 'alarm' ? 'var(--admin-danger)' : '#f59e0b' }} />
                         <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{alert.level === 'alarm' ? 'Critical' : 'Warning'}</span>
                      </div>
                      <button 
                        onClick={() => handleAck(alert.id)}
                        style={{ padding: '6px 14px', background: 'var(--admin-danger)', color: '#fff', border: 'none', borderRadius: 0, fontSize: '.65rem', fontWeight: 900, cursor: 'pointer', boxShadow: '0 2px 8px rgba(239,68,68,0.3)' }}
                      >XÁC NHẬN</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
               <StationTrendChart color="var(--admin-danger)" data={mockHistory} />
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
                  <StationTrendChart color="#f59e0b" data={mockPdHistory} />
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

// ── Main Component ─────────────────────────────────────────────

export default function CentralAnalyticsLayout() {
  const navigate = useNavigate();
  const setViewingStation = useStationStore(s => s.setViewingStation);

  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<StationAnalyticsSnapshot[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [showAnalysisOverlay, setShowAnalysisOverlay] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  // Leaflet refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const markerMapRef = useRef<Record<string, any>>({});
  const [leafletReady, setLeafletReady] = useState(false);
  const [mapFitTrigger, setMapFitTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

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
        setMapFitTrigger(t => t + 1);
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
          Devices: ${sn.onlineDevices}/${sn.deviceTotal}<br/>
          Alerts: <b style="color:${hasAlerts ? 'var(--admin-danger)' : 'inherit'}">${sn.openAlerts}</b>
        </div>
      `);
      marker.on('click', () => {
        setSelectedStationId(sn.station.id);
        setShowAnalysisOverlay(true);
      });

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

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="central-analytics-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      {/* ── Main Content: Left Panel + Map ───────────────── */}
      <div className="central-analytics-main" style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* ── Left Panel: Station List ────────────────────── */}
        <div className="central-analytics-left" style={{
          width: leftPanelCollapsed ? 0 : 280,
          minWidth: leftPanelCollapsed ? 0 : 280,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--admin-panel)',
          borderRight: leftPanelCollapsed ? 'none' : '1px solid var(--admin-border)',
          overflow: 'hidden',
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
                        setShowAnalysisOverlay(true);
                        // Fit map to station
                        const loc = parseLocation(sn.station.location);
                        if (loc.lat && loc.lng && leafletMap.current) {
                          leafletMap.current.setView([loc.lat, loc.lng], 14, { animate: true });
                        }
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

        {/* ── Center: Map ─────────────────────────────────── */}
        <div className="central-analytics-map" style={{ flex: 1, position: 'relative', background: 'var(--admin-bg)' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

          {showAnalysisOverlay && selectedSnapshot && (
            <StationAnalysisOverlay 
              snapshot={selectedSnapshot} 
              onClose={() => setShowAnalysisOverlay(false)} 
              openStationDevices={openStationDevices}
              openStationAlerts={openStationAlerts}
            />
          )}

          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,22,40,0.8)', zIndex: 1009 }}>
              <div style={{ textAlign: 'center' }}>
                <Loader2 size={40} className="pulse-slow" style={{ color: 'var(--admin-accent)' }} />
                <div style={{ marginTop: 12, fontSize: '.8rem', color: 'var(--admin-text-muted)', fontWeight: 900, letterSpacing: '0.2em' }}>ĐANG ĐỒNG BỘ DỮ LIỆU ĐA TRẠM...</div>
              </div>
            </div>
          )}

          {/* Map Title Overlay */}
          <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none' }}>
             <div style={{ background: 'var(--admin-layer-2)', padding: '8px 24px', borderRadius: 0, border: '1px solid var(--admin-border)', borderBottom: '2px solid var(--admin-accent)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <MapPin size={16} style={{ color: 'var(--admin-accent)' }} />
                <span style={{ fontSize: '.75rem', fontWeight: 950, color: '#fff', letterSpacing: '0.15em', textTransform: 'uppercase' }}>BẢN ĐỒ GIÁM SÁT TRẠM BIẾN ÁP</span>
             </div>
          </div>

          {/* Map zoom controls */}
          <div style={{ position: 'absolute', bottom: 30, right: 20, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-industrial"
              onClick={() => leafletMap.current?.zoomIn()}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', padding: 0, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', color: '#fff', borderRadius: 0, cursor: 'pointer' }}
            >+</button>
            <button
              className="btn-industrial"
              onClick={() => leafletMap.current?.zoomOut()}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', padding: 0, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', color: '#fff', borderRadius: 0, cursor: 'pointer' }}
            >−</button>
            <button
              className="btn-industrial"
              onClick={() => setMapFitTrigger(t => t + 1)}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', color: 'var(--admin-accent)', borderRadius: 0, cursor: 'pointer' }}
              title="Fit all stations"
            ><Maximize2 size={16} /></button>
          </div>
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
