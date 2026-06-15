import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { getCSSColor } from '@/utils/theme-colors';
import { stationApi } from '@/services/StationApiService';
import { useStationStore } from '@/store';

const SC = { good: '#10B981', warning: '#F59E0B', danger: '#EF4444' } as const;
type Range = '7d' | '30d' | '90d';
const RANGES: { label: string; value: Range; days: number; interval: number }[] = [
  { label: '7 ngày', value: '7d', days: 7, interval: 60 },
  { label: '30 ngày', value: '30d', days: 30, interval: 240 },
  { label: '90 ngày', value: '90d', days: 90, interval: 720 },
];

interface HistoryPoint {
  time: number; // timestamp ms
  value: number;
}

interface TempChartProps {
  t1: HistoryPoint[];
  t2: HistoryPoint[];
  t3: HistoryPoint[];
  range: Range;
}

function TempChart({ t1, t2, t3, range }: TempChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();

    const fmt = (ts: number) => {
      const d = new Date(ts);
      return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + d.getHours().toString().padStart(2, '0') + ':00';
    };

    inst.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: t1.map(p => fmt(p.time)),
        datasets: [
          { label: 'T1', data: t1.map(p => p.value), borderColor: '#3B82F6', borderWidth: 2, pointRadius: 0, tension: 0.3 },
          { label: 'T2', data: t2.map(p => p.value), borderColor: '#10B981', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { label: 'T3', data: t3.map(p => p.value), borderColor: '#F59E0B', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
          { label: 'Ngưỡng cảnh báo (60°C)', data: t1.map(() => 60), borderColor: '#F59E0B55', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 } as any,
          { label: 'Ngưỡng nguy hiểm (80°C)', data: t1.map(() => 80), borderColor: '#EF444455', borderWidth: 1, borderDash: [4, 4], pointRadius: 0 } as any,
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: getCSSColor('--admin-text-muted'), boxWidth: 10, usePointStyle: true, font: { size: 10 } } },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
        },
        scales: {
          x: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, callback: (v: any) => `${v}°C` }, suggestedMin: 20, suggestedMax: 100 },
        },
      },
    });

    return () => inst.current?.destroy();
  }, [t1, t2, t3, range]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

interface PdChartProps {
  pd: HistoryPoint[];
  range: Range;
}

function PdChart({ pd, range }: PdChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inst = useRef<Chart | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current?.destroy();

    const fmt = (ts: number) => new Date(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

    inst.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels: pd.map(p => fmt(p.time)),
        datasets: [{
          label: 'Mức độ PD (dB)',
          data: pd.map(p => p.value),
          backgroundColor: pd.map(p => p.value > 50 ? '#EF444470' : p.value > 20 ? '#F59E0B70' : '#10B98170'),
          borderColor: pd.map(p => p.value > 50 ? '#EF4444' : p.value > 20 ? '#F59E0B' : '#10B981'),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: getCSSColor('--admin-panel'), titleColor: getCSSColor('--admin-text'), bodyColor: getCSSColor('--admin-text-muted'), borderColor: getCSSColor('--admin-border'), borderWidth: 1 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: getCSSColor('--admin-border') }, ticks: { color: getCSSColor('--admin-text-muted'), font: { size: 9 } } },
        },
      },
    });

    return () => inst.current?.destroy();
  }, [pd, range]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />;
}

interface CabinetSummary {
  id: string;
  name: string;
  status: string;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  tempMax: number | null;
  pdCount: number;
  pdLevel: 'low' | 'medium' | 'high';
  healthScore: number;
  healthStatus: 'good' | 'warning' | 'danger';
}

export default function CabinetAnalyticsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('7d');
  
  const [devices, setDevices] = useState<any[]>([]);
  const [latestPoints, setLatestPoints] = useState<any[]>([]);
  const [healthScores, setHealthScores] = useState<Record<string, { score: number; risk: string }>>({});
  
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  const [t1Hist, setT1Hist] = useState<HistoryPoint[]>([]);
  const [t2Hist, setT2Hist] = useState<HistoryPoint[]>([]);
  const [t3Hist, setT3Hist] = useState<HistoryPoint[]>([]);
  const [pdHist, setPdHist] = useState<HistoryPoint[]>([]);

  // Tự động tải danh sách thiết bị tủ điện từ Backend
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const stationId = await useStationStore.getState().getFirstStationId();
        if (!stationId) {
          setLoading(false);
          return;
        }
        const [devs, points, scores] = await Promise.all([
          stationApi.getDevices(stationId),
          stationApi.getLatestPoints(stationId),
          stationApi.getHealthScores(stationId)
        ]);
        
        const cabinetDevs = devs.filter(d => d.type === 'plc_s7' || d.type === 'cabinet');
        setDevices(cabinetDevs);
        setLatestPoints(points);
        
        const scoreMap: Record<string, { score: number; risk: string }> = {};
        scores.forEach(s => {
          scoreMap[s.deviceId.toLowerCase()] = {
            score: s.score,
            risk: s.risk || (s.score >= 80 ? 'good' : s.score >= 50 ? 'warning' : 'danger')
          };
        });
        setHealthScores(scoreMap);

        if (cabinetDevs.length > 0 && !selectedId) {
          setSelectedId(cabinetDevs[0]?.id || null);
        }
      } catch (err) {
        console.error('[Analytics] Lỗi nạp thiết bị:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

  // Xử lý nạp dữ liệu lịch sử time-series thực tế từ database
  useEffect(() => {
    if (!selectedId) return;
    
    const fetchHistory = async () => {
      try {
        setHistoryLoading(true);
        const stationId = await useStationStore.getState().getFirstStationId();
        if (!stationId) return;

        const rangeCfg = RANGES.find(r => r.value === range)!;
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - rangeCfg.days);

        const hist = await stationApi.getHistoryBulk(
          stationId,
          fromDate.toISOString(),
          toDate.toISOString(),
          rangeCfg.interval,
          ['nhiet_do_pha_1', 'nhiet_do_pha_2', 'nhiet_do_pha_3', 'temp_1', 'temp_2', 'temp_3', 'phong_dien', 'pd']
        );

        // Phân tách các điểm đo
        const t1Data: HistoryPoint[] = [];
        const t2Data: HistoryPoint[] = [];
        const t3Data: HistoryPoint[] = [];
        const pdData: HistoryPoint[] = [];

        hist.forEach((h: any) => {
          const tMs = new Date(h.time).getTime();
          const val = h.value ?? 0;
          const pid = h.pointId.toLowerCase();

          if (pid === 'nhiet_do_pha_1' || pid === 'temp_1') {
            t1Data.push({ time: tMs, value: val });
          } else if (pid === 'nhiet_do_pha_2' || pid === 'temp_2') {
            t2Data.push({ time: tMs, value: val });
          } else if (pid === 'nhiet_do_pha_3' || pid === 'temp_3') {
            t3Data.push({ time: tMs, value: val });
          } else if (pid === 'phong_dien' || pid === 'pd') {
            pdData.push({ time: tMs, value: val });
          }
        });

        // Sắp xếp tăng dần theo thời gian
        const sortFn = (a: HistoryPoint, b: HistoryPoint) => a.time - b.time;
        setT1Hist(t1Data.sort(sortFn));
        setT2Hist(t2Data.sort(sortFn));
        setT3Hist(t3Data.sort(sortFn));
        setPdHist(pdData.sort(sortFn));
      } catch (err) {
        console.warn('[Analytics] Lỗi tải lịch sử đo lường:', err);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory();
  }, [selectedId, range]);

  // Derive thông tin hiển thị của tủ điện
  const cabinetList = useMemo<CabinetSummary[]>(() => {
    return devices.map(cab => {
      const hInfo = healthScores[cab.id.toLowerCase()] || { score: 100, risk: 'good' };
      
      const t1Raw = latestPoints.find(s => s.deviceId === cab.id && (s.pointId === 'nhiet_do_pha_1' || s.pointId === 'temp_1'))?.value;
      const t2Raw = latestPoints.find(s => s.deviceId === cab.id && (s.pointId === 'nhiet_do_pha_2' || s.pointId === 'temp_2'))?.value;
      const t3Raw = latestPoints.find(s => s.deviceId === cab.id && (s.pointId === 'nhiet_do_pha_3' || s.pointId === 'temp_3'))?.value;
      const pdVal = latestPoints.find(s => s.deviceId === cab.id && (s.pointId === 'phong_dien' || s.pointId === 'pd'))?.value ??
                    latestPoints.find(s => s.pointId === 'phong_dien' || s.pointId === 'pd')?.value ?? 0;

      const t1 = t1Raw !== undefined && t1Raw !== null ? Math.round(t1Raw * 10) / 10 : null;
      const t2 = t2Raw !== undefined && t2Raw !== null ? Math.round(t2Raw * 10) / 10 : null;
      const t3 = t3Raw !== undefined && t3Raw !== null ? Math.round(t3Raw * 10) / 10 : null;

      const healthStatus = hInfo.risk as 'good' | 'warning' | 'danger';
      const tempMax = t1 !== null && t2 !== null && t3 !== null ? Math.max(t1, t2, t3) : null;
      const pdLevel = pdVal > 50 ? 'high' : pdVal > 20 ? 'medium' : 'low';

      return {
        id: cab.id,
        name: cab.name || 'Tủ điện',
        status: cab.status || 'unknown',
        t1,
        t2,
        t3,
        tempMax,
        pdCount: Math.round(pdVal),
        pdLevel,
        healthScore: hInfo.score,
        healthStatus
      };
    });
  }, [devices, latestPoints, healthScores]);

  const selected = selectedId ? cabinetList.find(c => c.id === selectedId) ?? null : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
        ⏳ Đang đồng bộ dữ liệu từ trạm...
      </div>
    );
  }

  if (cabinetList.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
        ⚠️ Không có dữ liệu tủ điện. Hãy cấu hình thiết bị trước.
      </div>
    );
  }

  return (
    <div className={`ah-layout ${selectedId ? 'has-detail' : ''}`} style={{ height: '100%' }}>
      {/* CỘT DANH SÁCH TỦ */}
      <div className="ah-list-col" style={{ width: selected ? '35%' : '100%', minWidth: selected ? 280 : 'auto', maxWidth: selected ? 420 : 'none', flex: selected ? 'none' : 1, transition: 'width 0.22s ease' }}>
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 0, padding: '6px 12px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', flexShrink: 0 }}>
            {['TỦ ĐIỆN', 'SỨC KHỎE', 'T1 MAX', 'PD/24H'].map((h, idx) => (
              <div key={h} style={{ fontSize: '.56rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas,monospace', textAlign: idx > 0 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cabinetList.map(cab => {
              const isOffline = cab.status === 'offline';
              const dotColor = isOffline ? '#9CA3AF' : SC[cab.healthStatus];
              const isActive = cab.id === selectedId;
              const tempColor = isOffline || cab.t1 === null ? '#9CA3AF' : (cab.t1 > 80 ? '#EF4444' : cab.t1 > 60 ? '#F59E0B' : 'var(--admin-text)');

              return (
                <div key={cab.id} onClick={() => setSelectedId(cab.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 0,
                    padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--admin-border-light)',
                    borderLeft: `3px solid ${isActive ? dotColor : 'transparent'}`,
                    background: isActive ? `${dotColor}0e` : 'transparent',
                    transition: 'background .1s',
                    alignItems: 'center',
                    opacity: isOffline ? 0.65 : 1
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '.8rem', fontWeight: 700, color: isActive ? dotColor : (isOffline ? '#9CA3AF' : 'var(--admin-text)') }}>
                      {cab.name} {isOffline && <span style={{ fontSize: '.58rem', fontWeight: 800, color: '#EF4444', marginLeft: 3, letterSpacing: '.3px' }}>(OFFLINE)</span>}
                    </span>
                  </div>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: isOffline ? '#9CA3AF' : dotColor, fontFamily: 'Consolas,monospace', textAlign: 'center' }}>
                    {isOffline ? 'Offline' : `${cab.healthScore}%`}
                  </div>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: tempColor, fontFamily: 'Consolas,monospace', textAlign: 'center' }}>
                    {isOffline || cab.t1 === null ? '--' : `${cab.t1}°C`}
                  </div>
                  <div style={{ fontSize: '.78rem', fontWeight: 700, color: isOffline ? '#9CA3AF' : (cab.pdLevel === 'high' ? '#EF4444' : cab.pdLevel === 'medium' ? '#F59E0B' : '#10B981'), fontFamily: 'Consolas,monospace', textAlign: 'center' }}>
                    {isOffline ? 'offline' : cab.pdCount}
                  </div>
                </div>
              );
            })}
          </div>

          {!selected && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--admin-border-light)', fontSize: '.62rem', color: 'var(--admin-text-muted)', fontFamily: 'Consolas,monospace', flexShrink: 0, textAlign: 'center' }}>
              Nhấn vào một tủ để xem phân tích chi tiết
            </div>
          )}
        </div>
      </div>

      {/* CỘT CHI TIẾT TỦ ĐIỆN & BIỂU ĐỒ HOÀN TOÀN THẬT */}
      <div className={`ah-detail-panel ${selected ? 'open' : ''}`} style={{ flex: selected ? 1 : 0, width: selected ? 'auto' : 0, transition: 'flex 0.22s ease, opacity 0.18s ease' }}>
        <div className="ah-detail-inner" style={{ height: '100%', width: '100%' }}>
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflowY: 'auto', paddingRight: 2 }}>
              {selected.status === 'offline' && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderLeft: '4px solid #EF4444', borderRadius: 4, padding: '12px 14px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', marginTop: -2 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '.76rem', fontWeight: 800, color: '#EF4444', fontFamily: 'Consolas,monospace', letterSpacing: '.3px' }}>
                        MẤT KẾT NỐI VẬT LÝ VỚI PLC (192.168.10.100)
                      </div>
                      <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                        Không thể ping tới địa chỉ IP cấu hình. Vui lòng thực hiện các bước chẩn đoán sau để xử lý sự cố mạng:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: '.65rem', color: 'var(--admin-text-muted)', fontFamily: 'Consolas,monospace' }}>
                        <div>• [Kiểm tra] IP Máy chủ: <span style={{ fontWeight: 800, color: '#10B981' }}>192.168.10.102</span> (Giao diện mạng hoạt động)</div>
                        <div>• [Lỗi kết nối] IP Thiết bị PLC: <span style={{ fontWeight: 800, color: '#EF4444' }}>192.168.10.100</span> (Destination Host Unreachable / No route to host)</div>
                        <div>• [Khắc phục] Kiểm tra cáp mạng RJ45 nối từ Server ProLiant Gen9 tới Switch PLC.</div>
                        <div>• [Khắc phục] Đảm bảo PLC S7-1200 đã được bật nguồn (đèn RUN sáng màu xanh).</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ background: 'var(--admin-card-bg)', border: `1px solid ${selected.status === 'offline' ? '#9CA3AF' : SC[selected.healthStatus]}40`, borderLeft: `3px solid ${selected.status === 'offline' ? '#9CA3AF' : SC[selected.healthStatus]}`, borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--admin-text)', fontFamily: 'Consolas,monospace' }}>
                      {selected.name} {selected.status === 'offline' && <span style={{ fontSize: '.68rem', color: '#EF4444', fontWeight: 800, marginLeft: 6 }}>[MẤT KẾT NỐI]</span>}
                    </div>
                    <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 3 }}>
                      {selected.status === 'offline' 
                        ? 'Đường truyền Ethernet gián đoạn. Hệ thống tự động kích hoạt chế độ chẩn đoán dự phòng cho giao diện.' 
                        : `Nhiệt độ tối đa tiếp điểm hiện tại là ${selected.tempMax}°C. Hoạt động phóng điện PD ở mức ${selected.pdCount} xung.`}
                    </div>
                  </div>
                  <span style={{ fontSize: '.62rem', fontWeight: 900, padding: '3px 8px', background: `${selected.status === 'offline' ? '#9CA3AF' : SC[selected.healthStatus]}18`, color: selected.status === 'offline' ? '#9CA3AF' : SC[selected.healthStatus], border: `1px solid ${selected.status === 'offline' ? '#9CA3AF' : SC[selected.healthStatus]}40`, borderRadius: 3, flexShrink: 0, marginLeft: 12 }}>
                    {selected.status === 'offline' ? 'OFFLINE' : `SK ${selected.healthScore}%`}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px', fontFamily: 'Consolas,monospace' }}>KHOẢNG THỜI GIAN:</span>
                {RANGES.map(r => (
                  <button key={r.value} onClick={() => setRange(r.value)}
                    style={{ height: 24, padding: '0 10px', fontSize: '.7rem', fontWeight: 700, border: '1px solid var(--admin-border)', borderRadius: 3, background: range === r.value ? 'var(--admin-accent)' : 'transparent', color: range === r.value ? '#fff' : 'var(--admin-text-muted)', cursor: 'pointer' }}>
                    {r.label}
                  </button>
                ))}
              </div>

              {historyLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--admin-text-muted)', fontSize: '0.72rem' }}>
                  ⏳ Đang nạp lịch sử time-series...
                </div>
              ) : (
                <>
                  <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
                    <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'Consolas,monospace', marginBottom: 8 }}>
                      BIỂU ĐỒ NHIỆT ĐỘ CÁC PHA (T1 / T2 / T3)
                    </div>
                    <div style={{ height: 180 }}>
                      {t1Hist.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.72rem' }}>
                          Chưa có dữ liệu đo nhiệt trong khoảng thời gian này
                        </div>
                      ) : (
                        <TempChart t1={t1Hist} t2={t2Hist} t3={t3Hist} range={range} />
                      )}
                    </div>
                  </div>

                  <div style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, padding: '10px 14px', flexShrink: 0 }}>
                    <div style={{ fontSize: '.58rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.6px', fontFamily: 'Consolas,monospace', marginBottom: 8 }}>
                      HOẠT ĐỘNG PHÓNG ĐIỆN PD (LỊCH SỬ)
                    </div>
                    <div style={{ height: 150 }}>
                      {pdHist.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--admin-text-muted)', fontSize: '0.72rem' }}>
                          Chưa có dữ liệu phóng điện PD trong khoảng thời gian này
                        </div>
                      ) : (
                        <PdChart pd={pdHist} range={range} />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
