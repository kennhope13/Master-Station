import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stationApi } from '@/services/StationApiService';
import { GO2RTC_URL } from '@/utils/env';
import type { Device } from '@/types/api.types';

// ============================================================
// ThermalConfigPage — Giao diện chấm điểm nhiệt độ (ROI)
// Cho phép click trên canvas để xác định (tx, ty) và lưu vào DB.
// Tích hợp chức năng Zoom, Opacity, và Dual-Lens (Nhiệt/Quang)
// ============================================================

interface RoiPoint {
  id: string;
  deviceId: string;
  name: string;
  tx: number; ty: number;
  ox: number; oy: number;
  preAlarmThreshold: number;
  alarmThreshold: number;
}

export default function ThermalConfigPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  
  const [device, setDevice] = useState<Device | null>(null);
  const [points, setPoints] = useState<RoiPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Picker State
  const [pickerMode, setPickerMode] = useState<'thermal' | 'optical'>('thermal');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(100);
  
  // Draft Point Coordinates
  const [tx, setTx] = useState<string>('');
  const [ty, setTy] = useState<string>('');
  const [ox, setOx] = useState<string>('');
  const [oy, setOy] = useState<string>('');
  const [pointName, setPointName] = useState<string>('');
  const [preAlarm, setPreAlarm] = useState<string>('50');
  const [alarm, setAlarm] = useState<string>('70');

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deviceId) return;
    loadData();
  }, [deviceId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Temporary solution to get device configs (should use a specific API)
      const devices = await stationApi.getDevices('station-1'); // Default station
      const d = devices.find(x => x.id === deviceId);
      if (d) setDevice(d);

      const res = await fetch(`/api/v1/devices/${deviceId}/roi-points`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('station_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPoints(data);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi tải dữ liệu camera');
    } finally {
      setLoading(false);
    }
  };

  const activeX = pickerMode === 'thermal' ? parseFloat(tx) : parseFloat(ox);
  const activeY = pickerMode === 'thermal' ? parseFloat(ty) : parseFloat(oy);
  const showDot = !isNaN(activeX) && !isNaN(activeY) && activeX >= 0 && activeY >= 0;

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    
    let nx = (e.clientX - rect.left) / rect.width;
    let ny = (e.clientY - rect.top) / rect.height;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));

    const sx = nx.toFixed(4);
    const sy = ny.toFixed(4);

    if (pickerMode === 'thermal') {
      setTx(sx);
      setTy(sy);
      if (!ox) setOx(sx);
      if (!oy) setOy(sy);
    } else {
      setOx(sx);
      setOy(sy);
      if (!tx) setTx(sx);
      if (!ty) setTy(sy);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const oldZoom = zoomLevel;
    const zoomStep = 10;
    
    let newZoom = oldZoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(300, oldZoom + zoomStep);
    } else {
      newZoom = Math.max(50, oldZoom - zoomStep);
    }
    
    setZoomLevel(newZoom);
  };

  const openEditor = (pt?: RoiPoint) => {
    if (pt) {
      setEditingId(pt.id);
      setPointName(pt.name);
      setTx(pt.tx.toFixed(4));
      setTy(pt.ty.toFixed(4));
      setOx(pt.ox.toFixed(4));
      setOy(pt.oy.toFixed(4));
      setPreAlarm(pt.preAlarmThreshold.toString());
      setAlarm(pt.alarmThreshold.toString());
    } else {
      setEditingId(null);
      setPointName('');
      setTx(''); setTy(''); setOx(''); setOy('');
      setPreAlarm('50'); setAlarm('70');
    }
    setIsEditing(true);
    setPickerMode('thermal');
  };

  const savePoint = async () => {
    if (!pointName) { alert('Vui lòng nhập tên điểm'); return; }
    
    let ftx = parseFloat(tx);
    let fty = parseFloat(ty);
    let fox = parseFloat(ox);
    let foy = parseFloat(oy);

    // Fallback if one is missing
    if (isNaN(ftx) && !isNaN(fox)) ftx = fox;
    if (isNaN(fty) && !isNaN(foy)) fty = foy;
    if (isNaN(fox) && !isNaN(ftx)) fox = ftx;
    if (isNaN(foy) && !isNaN(fty)) foy = fty;

    if (isNaN(ftx) || isNaN(fty)) {
      alert('Vui lòng click vào ảnh để chọn tọa độ');
      return;
    }

    const body = {
      name: pointName,
      tx: ftx, ty: fty,
      ox: fox, oy: foy,
      preAlarmThreshold: parseFloat(preAlarm) || 50,
      alarmThreshold: parseFloat(alarm) || 70
    };

    const url = editingId 
      ? `/api/v1/devices/${deviceId}/roi-points/${editingId}`
      : `/api/v1/devices/${deviceId}/roi-points`;

    try {
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('station_token')}`
        },
        body: JSON.stringify(body)
      });
      
      if (res.ok) {
        setIsEditing(false);
        await loadData();
      } else {
        alert('Lỗi lưu điểm');
      }
    } catch {
      alert('Lỗi kết nối');
    }
  };

  const deletePoint = async (id: string) => {
    if (!confirm('Xóa điểm này? Hành động này không thể hoàn tác.')) return;
    try {
      const res = await fetch(`/api/v1/devices/${deviceId}/roi-points/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('station_token')}` }
      });
      if (res.ok) {
        await loadData();
      } else {
        alert('Xóa thất bại');
      }
    } catch {
      alert('Lỗi kết nối');
    }
  };

  if (loading) return <div style={{ padding: 20, color: 'var(--admin-text)' }}>Đang tải...</div>;
  if (!device) return <div style={{ padding: 20, color: 'var(--admin-text)' }}>Không tìm thấy thiết bị</div>;

  const cfg = device.config || {};
  
  // Use go2rtc stream. For thermal/optical separation, we use the respective go2rtc IDs.
  let streamSrc = '';
  if (pickerMode === 'thermal' && cfg.go2rtc_thermal) streamSrc = cfg.go2rtc_thermal;
  else if (pickerMode === 'optical' && cfg.go2rtc_optical) streamSrc = cfg.go2rtc_optical;
  else streamSrc = cfg.go2rtc_id || '';

  const streamUrl = streamSrc ? `${GO2RTC_URL}/api/stream.mp4?src=${encodeURIComponent(streamSrc)}` : '';

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto', color: 'var(--admin-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        <button onClick={() => navigate('/device-management')} className="btn-industrial" style={{ marginRight: 15 }}>← Trở lại</button>
        <h2 style={{ flex: 1, margin: 0, fontWeight: 800 }}>🌡️ CẤU HÌNH NHIỆT - {device.name}</h2>
        <button onClick={() => openEditor()} className="btn-industrial btn-primary">+ Thêm điểm</button>
      </div>

      <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--admin-layer-2)', color: 'var(--admin-text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ padding: '12px 14px' }}>Tên điểm</th>
              <th style={{ padding: '12px 14px' }}>Thermal (Tx, Ty)</th>
              <th style={{ padding: '12px 14px' }}>Optical (Ox, Oy)</th>
              <th style={{ padding: '12px 14px' }}>Ngưỡng cảnh báo</th>
              <th style={{ padding: '12px 14px' }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {points.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--admin-text-muted)' }}>Chưa có điểm đo nào</td></tr>
            ) : points.map(pt => (
              <tr key={pt.id} style={{ borderTop: '1px solid var(--admin-border)' }}>
                <td style={{ padding: '12px 14px', fontWeight: 'bold' }}>{pt.name}</td>
                <td style={{ padding: '12px 14px', fontFamily: 'var(--admin-font-mono)', fontSize: 12, color: 'var(--admin-text-muted)' }}>{pt.tx.toFixed(4)}, {pt.ty.toFixed(4)}</td>
                <td style={{ padding: '12px 14px', fontFamily: 'var(--admin-font-mono)', fontSize: 12, color: 'var(--admin-text-muted)' }}>{pt.ox.toFixed(4)}, {pt.oy.toFixed(4)}</td>
                <td style={{ padding: '12px 14px', fontSize: 13 }}>
                  <span style={{ color: '#fbbf24' }}>{pt.preAlarmThreshold}°C</span> / <span style={{ color: '#ef4444' }}>{pt.alarmThreshold}°C</span>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <button onClick={() => openEditor(pt)} className="btn-industrial" style={{ padding: '4px 8px', marginRight: 5 }}>Sửa</button>
                  <button onClick={() => deletePoint(pt.id)} className="btn-industrial btn-danger" style={{ padding: '4px 8px' }}>Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isEditing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 12, width: 800, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--admin-text)' }}>{editingId ? 'Chỉnh sửa điểm' : 'Thêm điểm mới'}</h3>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left Column - Picker */}
              <div style={{ flex: 2, padding: 20, borderRight: '1px solid var(--admin-border)', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <button onClick={() => setPickerMode('thermal')} className="btn-industrial" style={{ flex: 1, borderColor: pickerMode === 'thermal' ? 'var(--admin-accent)' : 'var(--admin-border)', color: pickerMode === 'thermal' ? 'var(--admin-accent)' : 'var(--admin-text)' }}>Thermal</button>
                  <button onClick={() => setPickerMode('optical')} className="btn-industrial" style={{ flex: 1, borderColor: pickerMode === 'optical' ? 'var(--admin-accent)' : 'var(--admin-border)', color: pickerMode === 'optical' ? 'var(--admin-accent)' : 'var(--admin-text)' }}>Optical</button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, color: 'var(--admin-text-muted)' }}>
                  <label>Zoom: {zoomLevel}%</label>
                  <label>Opacity: {overlayOpacity}%</label>
                </div>
                <div style={{ display: 'flex', gap: 20, marginBottom: 15 }}>
                  <input type="range" min="50" max="300" step="10" value={zoomLevel} onChange={e => setZoomLevel(parseInt(e.target.value))} style={{ flex: 1 }} />
                  <input type="range" min="0" max="100" value={overlayOpacity} onChange={e => setOverlayOpacity(parseInt(e.target.value))} style={{ flex: 1 }} />
                </div>

                <div style={{ background: '#000', border: '1px solid var(--admin-border)', borderRadius: 8, height: 400, overflow: 'auto', position: 'relative', cursor: 'crosshair' }} onWheel={handleWheel}>
                  <div ref={wrapperRef} onClick={handleImageClick} style={{ position: 'relative', width: `${zoomLevel}%`, transformOrigin: 'top left' }}>
                    {streamUrl ? (
                      <video src={streamUrl} autoPlay loop muted playsInline style={{ display: 'block', width: '100%', opacity: overlayOpacity / 100, pointerEvents: 'none' }} />
                    ) : (
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Không có luồng Video</div>
                    )}
                    
                    {showDot && (
                      <div style={{
                        position: 'absolute',
                        left: `${activeX * 100}%`,
                        top: `${activeY * 100}%`,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#ef4444', border: '2px solid #fff',
                        transform: 'translate(-50%, -50%)',
                        boxShadow: '0 0 6px rgba(239,68,68,0.8)',
                        pointerEvents: 'none'
                      }}></div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column - Form */}
              <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Tên điểm</label>
                  <input type="text" value={pointName} onChange={e => setPointName(e.target.value)} className="form-input" placeholder="VD: Đầu cáp" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Tx</label>
                    <input type="text" value={tx} onChange={e => setTx(e.target.value)} className="form-input" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Ty</label>
                    <input type="text" value={ty} onChange={e => setTy(e.target.value)} className="form-input" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Ox</label>
                    <input type="text" value={ox} onChange={e => setOx(e.target.value)} className="form-input" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Oy</label>
                    <input type="text" value={oy} onChange={e => setOy(e.target.value)} className="form-input" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Ngưỡng Vàng (°C)</label>
                    <input type="number" value={preAlarm} onChange={e => setPreAlarm(e.target.value)} className="form-input" style={{ color: 'var(--admin-warning)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>Ngưỡng Đỏ (°C)</label>
                    <input type="number" value={alarm} onChange={e => setAlarm(e.target.value)} className="form-input" style={{ color: 'var(--admin-danger)' }} />
                  </div>
                </div>

              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setIsEditing(false)} className="btn-industrial">Hủy</button>
              <button onClick={savePoint} className="btn-industrial btn-primary">Lưu điểm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
