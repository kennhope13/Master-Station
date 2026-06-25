import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { stationApi, AlertItem } from '@/services/StationApiService';
import { fmtDateTime } from '@/utils/format';
import DateFilterButton from '@/components/ui/DateFilterButton';

const CHART_COLORS = [
  'var(--admin-accent)', '#10B981', '#F59E0B', '#a855f7',
  '#3b82f6', '#ef4444', '#14b8a6', '#f97316',
  '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899',
  '#6366f1', '#0ea5e9', '#22c55e', '#f43f5e',
];

const labelStyle: React.CSSProperties = {
  fontSize: '0.65rem', color: 'var(--admin-text-muted)', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '.06em',
};

export default function ExportTab({ stationId, alerts }: { stationId: string, alerts: AlertItem[] }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [interval, setIntervalVal] = useState('5');
  
  const [devices, setDevices] = useState<any[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [selectedPoints, setSelectedPoints] = useState<string[]>([]);
  const [inclAlerts, setInclAlerts] = useState(true);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [info, setInfo] = useState<{ msg: string; type: 'info' | 'ok' | 'error' }>({
    msg: 'Chọn cảm biến và khoảng thời gian, sau đó nhấn "Xem trước" hoặc xuất `XLSX / CSV / PDF`.',
    type: 'info',
  });

  const [previewData, setPreviewData] = useState<Array<Record<string, any>>>([]);
  const [totalRows, setTotalRows] = useState(0);

  const [allPoints, setAllPoints] = useState<any[]>([]);
  const [pointNamesMap, setPointNamesMap] = useState<Record<string, string>>({});

  // Load devices and sensors dynamically
  useEffect(() => {
    setLoadingDevices(true);
    
    const fetchData = async () => {
      try {
        const [devs, latestPoints] = await Promise.all([
          stationApi.getDevices(stationId),
          stationApi.getLatestPoints(stationId)
        ]);
        
        // Filter for devices that likely have sensors
        const filteredDevs = devs.filter((d: any) => 
          d.type === 'plc_s7' || 
          d.type === 'cabinet' || 
          d.type?.includes('camera_thermal') || 
          d.type?.includes('camera_pd') || 
          d.type?.includes('camera_dual')
        );
        setDevices(filteredDevs);
        setAllPoints(latestPoints);

        // Fetch friendly names for points
        const newMap: Record<string, string> = {};
        const cams = filteredDevs.filter((d: any) => d.type?.includes('camera'));
        
        await Promise.all(cams.map(async (cam) => {
          try {
            const [pts, rois] = await Promise.all([
              stationApi.getRoiPoints(cam.id).catch(() => []),
              stationApi.getBoundaries(cam.id).catch(() => [])
            ]);
            
            pts.forEach(p => {
              const label = p.label || p.name || '';
              if (p.pointId) newMap[`${cam.id}_${p.pointId}`.toLowerCase()] = label;
              if (p.id) newMap[`${cam.id}_${p.id}`.toLowerCase()] = label;
            });
            
            rois.forEach(r => {
              let descriptiveName = r.name;
              try {
                const t = JSON.parse(r.thresholds || '{}');
                if (t.fullName) descriptiveName = t.fullName;
              } catch {}
              
              if (r.id) newMap[`${cam.id}_${r.id}`.toLowerCase()] = descriptiveName;
              if (r.name) newMap[`${cam.id}_${r.name}`.toLowerCase()] = descriptiveName;
            });
          } catch (e) {
            console.warn(`[ExportTab] Lỗi nạp metadata cho ${cam.name}:`, e);
          }
        }));
        
        setPointNamesMap(newMap);

      } catch (err) {
        console.error('[ExportTab] Lỗi nạp thiết bị/cảm biến:', err);
      } finally {
        setLoadingDevices(false);
      }
    };
    
    fetchData();
  }, [stationId]);

  // Construct device configs and sensor list dynamically
  const deviceConfigs = devices.map(d => {
    // Find all points belonging to this device
    const devPoints = allPoints.filter(p => p.deviceId.toLowerCase() === d.id.toLowerCase());
    
    // Group them for display
    const sensors: any[] = devPoints.map(p => {
      const rawPid = p.pointId.toLowerCase();
      const uniqueKey = `${d.id}_${rawPid}`.toLowerCase();
      
      // 1. Try mapping from metadata (ROI/Boundaries)
      let label = pointNamesMap[uniqueKey];
      
      // 2. Try standardized labels for common points
      if (!label) {
        if (rawPid === 'nhiet_do_pha_1' || rawPid === 'temp_1') label = 'Nhiệt T1 — Pha A';
        else if (rawPid === 'nhiet_do_pha_2' || rawPid === 'temp_2') label = 'Nhiệt T2 — Pha B';
        else if (rawPid === 'nhiet_do_pha_3' || rawPid === 'temp_3') label = 'Nhiệt T3 — Pha C';
        else if (rawPid === 'phong_dien' || rawPid === 'pd') label = 'Phóng điện PD';
        else if (rawPid.startsWith('p')) label = `Điểm đo ${rawPid.toUpperCase()}`;
        else if (rawPid.startsWith('d')) label = `Vùng PD ${rawPid.toUpperCase()}`;
      }

      // 3. Fallback to raw ID
      if (!label) label = p.pointId;

      return {
        id: `${d.id}_${p.pointId}`,
        rawPointId: p.pointId,
        label,
        unit: p.unit || '',
        color: '' // Will be assigned below
      };
    });

    return {
      deviceId: d.id,
      deviceName: d.name || 'Thiết bị',
      type: d.type,
      sensors
    };
  });

  const allAvailableSensors = deviceConfigs.flatMap((dev, di) => 
    dev.sensors.map((s, si) => {
      const color = CHART_COLORS[(di * 4 + si) % CHART_COLORS.length];
      return {
        ...s,
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        color,
        yAxis: (s.rawPointId.toLowerCase().includes('pd') || s.rawPointId.toLowerCase().includes('phong_dien')) ? 'yPd' : 'yTemp'
      };
    })
  );

  const allPointIds = allAvailableSensors.map(s => s.id);

  // Default to selecting all sensors when devices load
  useEffect(() => {
    if (allPointIds.length > 0 && selectedPoints.length === 0) {
      setSelectedPoints(allPointIds);
    }
  }, [allPointIds]);

  const togglePoint = (id: string) =>
    setSelectedPoints(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleDevice = (deviceId: string) => {
    const dev = deviceConfigs.find(c => c.deviceId === deviceId);
    if (!dev) return;
    const pts = dev.sensors.map(s => s.id);
    const allOn = pts.every(p => selectedPoints.includes(p));
    setSelectedPoints(prev => allOn ? prev.filter(p => !pts.includes(p)) : [...new Set([...prev, ...pts])]);
  };

  const pivot = (raw: Array<{ pointId: string; time: string; value: number; deviceId?: string }>) => {
    const map = new Map<string, Record<string, any>>();
    raw.forEach(r => {
      const key = r.time;
      if (!map.has(key)) {
        const row: Record<string, any> = { time: r.time };
        allPointIds.forEach(id => { row[id] = null; });
        map.set(key, row);
      }
      
      const row = map.get(key)!;
      if (r.deviceId) {
        const uniqueId = `${r.deviceId.toLowerCase()}_${r.pointId}`;
        row[uniqueId] = r.value;
      }
    });
    return Array.from(map.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  };

  const fetchPivotedData = async () => {
    const queryPointIds = [...new Set(allAvailableSensors.map(s => s.rawPointId))];
    const raw = await stationApi.getHistoryBulk(stationId, from, to, Number(interval), queryPointIds);
    return { raw, pivoted: pivot(raw) };
  };

  const loadPreview = async () => {
    if (!stationId) { setInfo({ msg: 'Chưa kết nối backend', type: 'error' }); return; }
    if (!selectedPoints.length) { setInfo({ msg: 'Chọn ít nhất 1 cảm biến', type: 'error' }); return; }
    if (!from || !to) { setInfo({ msg: 'Chọn đầy đủ ngày', type: 'error' }); return; }
    setLoading(true);
    setInfo({ msg: 'Đang tải dữ liệu...', type: 'info' });
    try {
      const { pivoted } = await fetchPivotedData();
      setPreviewData(pivoted.slice(0, 30));
      setTotalRows(pivoted.length);
      setInfo({ msg: `Tổng ${pivoted.length} dòng · ${selectedPoints.length} cảm biến · khoảng ${interval === '0' ? 'raw' : interval + ' phút'}`, type: 'ok' });
    } catch (err: any) {
      setInfo({ msg: `Lỗi: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const exportXlsx = async () => {
    if (!stationId) { setInfo({ msg: 'Chưa kết nối backend', type: 'error' }); return; }
    if (!selectedPoints.length) { setInfo({ msg: 'Chọn ít nhất 1 cảm biến', type: 'error' }); return; }
    if (!from || !to) { setInfo({ msg: 'Chọn đầy đủ ngày', type: 'error' }); return; }
    setExporting(true);
    try {
      const { raw, pivoted } = await fetchPivotedData();
      const wb = XLSX.utils.book_new();
      const activeSensors = allAvailableSensors.filter(s => selectedPoints.includes(s.id));

      // Sheet 1: Dữ liệu cảm biến (time series)
      const headers = ['Thời gian', ...activeSensors.map(s => `${s.deviceName} · ${s.label} (${s.unit})`)];
      const dataRows = pivoted.map(row => [
        fmtDateTime(row.time as string),
        ...activeSensors.map(s => row[s.id] !== null && row[s.id] !== undefined ? Number(Number(row[s.id]).toFixed(2)) : ''),
      ]);
      const ws1 = XLSX.utils.aoa_to_sheet([
        [`STATION MONITOR — Dữ liệu cảm biến`],
        [`Khoảng thời gian: ${fmtDateTime(from)} → ${fmtDateTime(to)}`],
        [`Khoảng cách mẫu: ${interval === '0' ? 'Raw' : interval + ' phút'}`],
        [`Tổng số dòng: ${pivoted.length}`],
        [],
        headers,
        ...dataRows,
      ]);
      ws1['!cols'] = [{ wch: 22 }, ...activeSensors.map(() => ({ wch: 30 }))];
      XLSX.utils.book_append_sheet(wb, ws1, 'Dữ liệu cảm biến');

      // Sheet 2: Tóm tắt thiết bị (per-device summary)
      const devSummaryRows: any[] = [
        ['TÓM TẮT THEO THIẾT BỊ'],
        [`Khoảng thời gian: ${fmtDateTime(from)} → ${fmtDateTime(to)}`],
        [],
        ['Thiết bị', 'Cảm biến', 'Đơn vị', 'Nhỏ nhất', 'Lớn nhất', 'Trung bình', 'Số mẫu'],
      ];
      deviceConfigs.forEach(dev => {
        dev.sensors.forEach((s, si) => {
          if (!selectedPoints.includes(s.id)) return;
          const vals = raw.filter((r: any) => 
            r.pointId.toLowerCase() === s.rawPointId.toLowerCase() && 
            r.deviceId?.toLowerCase() === dev.deviceId.toLowerCase()
          ).map((r: { value: number }) => r.value);
          if (!vals.length) return;
          devSummaryRows.push([
            si === 0 ? dev.deviceName : '',
            s.label,
            s.unit,
            Number(Math.min(...vals).toFixed(2)),
            Number(Math.max(...vals).toFixed(2)),
            Number((vals.reduce((sum: number, v: number) => sum + v, 0) / vals.length).toFixed(2)),
            vals.length,
          ]);
        });
        devSummaryRows.push([]);
      });
      const ws2 = XLSX.utils.aoa_to_sheet(devSummaryRows);
      ws2['!cols'] = [{ wch: 20 }, { wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Tóm tắt thiết bị');

      // Sheet 3: Cảnh báo
      if (inclAlerts && alerts.length) {
        const fromMs = new Date(from).getTime();
        const toMs = new Date(to).getTime();
        const filtered = alerts.filter(a => {
          const t = new Date(a.triggeredAt).getTime();
          return t >= fromMs && t <= toMs;
        });
        const alertRows = filtered.map(a => [
          fmtDateTime(a.triggeredAt), a.message, a.level.toUpperCase(), a.status, a.closedAt ? fmtDateTime(a.closedAt) : '',
        ]);
        const ws3 = XLSX.utils.aoa_to_sheet([['Thời gian', 'Mô tả', 'Cấp độ', 'Trạng thái', 'Xử lý lúc'], ...alertRows]);
        ws3['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Cảnh báo');
      }

      XLSX.writeFile(wb, `SensorData_${from.replace(/[-:T]/g, '')}_${to.replace(/[-:T]/g, '')}.xlsx`);
    } catch (err: any) {
      setInfo({ msg: `Lỗi xuất XLSX: ${err.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = async () => {
    if (!stationId) { setInfo({ msg: 'Chưa kết nối backend', type: 'error' }); return; }
    if (!selectedPoints.length) { setInfo({ msg: 'Chọn ít nhất 1 cảm biến', type: 'error' }); return; }
    if (!from || !to) { setInfo({ msg: 'Chọn đầy đủ ngày', type: 'error' }); return; }
    setExporting(true);
    try {
      const { pivoted } = await fetchPivotedData();
      const activeSensors = allAvailableSensors.filter(s => selectedPoints.includes(s.id));
      const headers = ['Thời gian', ...activeSensors.map(s => `${s.deviceName} · ${s.label}${s.unit ? ` (${s.unit})` : ''}`)];
      const rows = pivoted.map(row => [
        fmtDateTime(row.time as string),
        ...activeSensors.map(s => row[s.id] !== null && row[s.id] !== undefined ? Number(Number(row[s.id]).toFixed(2)) : ''),
      ]);
      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SensorData_${from.replace(/[-:T]/g, '')}_${to.replace(/[-:T]/g, '')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setInfo({ msg: `Lỗi xuất CSV: ${err.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async () => {
    if (!stationId) { setInfo({ msg: 'Chưa kết nối backend', type: 'error' }); return; }
    if (!selectedPoints.length) { setInfo({ msg: 'Chọn ít nhất 1 cảm biến', type: 'error' }); return; }
    if (!from || !to) { setInfo({ msg: 'Chọn đầy đủ ngày', type: 'error' }); return; }
    setExporting(true);
    try {
      const { pivoted } = await fetchPivotedData();
      const activeSensors = allAvailableSensors.filter(s => selectedPoints.includes(s.id));
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.setFontSize(14);
      doc.text('STATION MONITOR - XUAT DU LIEU CAM BIEN', 40, 36);
      doc.setFontSize(9);
      doc.text(`Thoi gian: ${fmtDateTime(from)} -> ${fmtDateTime(to)}`, 40, 54);
      doc.text(`Khoang mau: ${interval === '0' ? 'Raw' : `${interval} phut`} | So dong: ${pivoted.length}`, 40, 68);
      autoTable(doc, {
        startY: 84,
        styles: { fontSize: 7, cellPadding: 3 },
        head: [[
          'Thời gian',
          ...activeSensors.map(s => `${s.label}${s.unit ? ` (${s.unit})` : ''}`),
        ]],
        body: pivoted.slice(0, 500).map(row => [
          fmtDateTime(row.time as string),
          ...activeSensors.map(s => row[s.id] !== null && row[s.id] !== undefined ? Number(Number(row[s.id]).toFixed(2)).toString() : ''),
        ]),
        margin: { left: 24, right: 24 },
      });
      doc.save(`SensorData_${from.replace(/[-:T]/g, '')}_${to.replace(/[-:T]/g, '')}.pdf`);
    } catch (err: any) {
      setInfo({ msg: `Lỗi xuất PDF: ${err.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const activeSensorCols = allAvailableSensors.filter(s => selectedPoints.includes(s.id));

  return (
    <div style={{ flex: 1, display: 'flex', gap: 8, overflow: 'hidden', height: '100%' }}>
      {/* Sidebar */}
      <div className="admin-card" style={{ width: 300, flexShrink: 0, background: 'var(--admin-card-bg, var(--admin-panel))', border: '1px solid var(--admin-border)', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, borderRadius: 0 }}>
        <div style={labelStyle}>Cấu hình xuất</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Thời gian</label>
          <DateFilterButton
            from={from}
            to={to}
            onApply={(f, t) => { setFrom(f); setTo(t); }}
            inputType="datetime-local"
            style={{ width: '100%', justifyContent: 'flex-start', height: 34, padding: '0 10px', fontSize: '0.78rem' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={labelStyle}>Khoảng cách mẫu</label>
          <select value={interval} onChange={e => setIntervalVal(e.target.value)}
            style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }}>
            <option value="0">Raw (tất cả mẫu)</option>
            <option value="1">Mỗi 1 phút</option>
            <option value="5">Mỗi 5 phút</option>
            <option value="15">Mỗi 15 phút</option>
            <option value="30">Mỗi 30 phút</option>
            <option value="60">Mỗi 1 giờ</option>
          </select>
        </div>

        {/* Device sensor selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={labelStyle}>Cảm biến</label>
            <button onClick={() => setSelectedPoints(selectedPoints.length === allPointIds.length ? [] : [...allPointIds])}
              style={{ fontSize: '0.62rem', padding: '2px 7px', borderRadius: 2, border: '1px solid var(--admin-border)', background: 'transparent', color: 'var(--admin-text-muted)', cursor: 'pointer' }}>
              {selectedPoints.length === allPointIds.length ? 'Bỏ tất cả' : 'Chọn tất cả'}
            </button>
          </div>

          {loadingDevices ? (
            <div style={{ padding: 10, textAlign: 'center', fontSize: '0.7rem', color: 'var(--admin-text-muted)' }}>Đang nạp thiết bị...</div>
          ) : deviceConfigs.length === 0 ? (
            <div style={{ padding: 10, textAlign: 'center', fontSize: '0.7rem', color: 'var(--admin-text-muted)' }}>Không tìm thấy thiết bị nào</div>
          ) : deviceConfigs.map((dev, di) => {
            const pts = dev.sensors.map(s => s.id);
            const allChecked = pts.every(p => selectedPoints.includes(p));
            const someChecked = pts.some(p => selectedPoints.includes(p));

            return (
              <div key={dev.deviceId} style={{ border: '1px solid var(--admin-border-light)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                {/* Device header */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', background: 'var(--admin-hover)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text)' }}>
                  <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={() => toggleDevice(dev.deviceId)} style={{ width: 13, height: 13, accentColor: CHART_COLORS[(di * 4) % CHART_COLORS.length] }} />
                  {dev.deviceName}
                </label>
                {/* Individual sensors */}
                {dev.sensors.map(({ id, color, unit, label }) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 8px 4px 22px', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--admin-text-muted)', borderTop: '1px solid var(--admin-border-light)' }}>
                    <input type="checkbox" checked={selectedPoints.includes(id)} onChange={() => togglePoint(id)}
                      style={{ width: 12, height: 12, accentColor: color }} />
                    <span style={{ color, fontWeight: 600, flex: 1 }}>{label}</span>
                    <span style={{ fontSize: '0.65rem' }}>{unit}</span>
                  </label>
                ))}
              </div>
            );
          })}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.75rem', color: 'var(--admin-text-muted)', padding: '5px 0', borderTop: '1px solid var(--admin-border-light)', marginTop: 2 }}>
            <input type="checkbox" checked={inclAlerts} onChange={e => setInclAlerts(e.target.checked)} style={{ width: 13, height: 13, accentColor: 'var(--admin-danger)' }} />
            <span style={{ color: 'var(--admin-danger)', fontWeight: 700 }}>Cảnh báo</span>
            <span style={{ fontSize: '0.68rem' }}>(sheet 3)</span>
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={loadPreview} disabled={loading || exporting || loadingDevices}
            style={{ padding: 9, background: 'var(--admin-btn-secondary-bg)', border: '1px solid var(--admin-accent)', borderRadius: 0, color: 'var(--admin-btn-secondary-text)', fontSize: '0.78rem', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Đang tải...' : 'Xem trước (30 dòng)'}
          </button>
          <button onClick={exportXlsx} disabled={loading || exporting || loadingDevices}
            style={{ padding: 9, background: 'var(--admin-accent)', border: 'none', borderRadius: 0, color: 'var(--admin-text)', fontSize: '0.78rem', fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer' }}>
            {exporting ? 'Đang xuất...' : `Xuất XLSX (${selectedPoints.length} cảm biến)`}
          </button>
          <button onClick={exportCsv} disabled={loading || exporting || loadingDevices}
            style={{ padding: 9, background: 'var(--admin-btn-secondary-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', fontSize: '0.78rem', fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer' }}>
            {exporting ? 'Đang xuất...' : `Xuất CSV (${selectedPoints.length} cảm biến)`}
          </button>
          <button onClick={exportPdf} disabled={loading || exporting || loadingDevices}
            style={{ padding: 9, background: 'var(--admin-btn-secondary-bg)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', fontSize: '0.78rem', fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer' }}>
            {exporting ? 'Đang xuất...' : `Xuất PDF (${selectedPoints.length} cảm biến)`}
          </button>
        </div>

        <div style={{ fontSize: '0.7rem', color: info.type === 'error' ? 'var(--admin-danger)' : info.type === 'ok' ? 'var(--admin-success)' : '#475569', padding: 10, background: 'var(--admin-panel)', borderRadius: 0, border: '1px solid var(--admin-border)' }}>
          {info.msg}
        </div>
      </div>

      {/* Right column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        {/* Preview table */}
        <div className="admin-card" style={{ borderRadius: 0, background: 'var(--admin-card-bg, var(--admin-panel))', border: '1px solid var(--admin-border)', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-border-light)' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--admin-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Xem trước dữ liệu</span>
            {totalRows > 0 && <span style={{ marginLeft: 8, fontSize: '0.68rem', color: 'var(--admin-text-muted)' }}>({totalRows} dòng, hiển thị 30)</span>}
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
              <thead>
                <tr style={{ background: 'var(--admin-panel)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--admin-text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--admin-border)' }}>Thời gian</th>
                  {activeSensorCols.map(s => (
                    <th key={s.id} style={{ padding: '8px 10px', textAlign: 'right', color: s.color, whiteSpace: 'nowrap', borderBottom: '1px solid var(--admin-border)', fontSize: '0.65rem' }}>
                      {s.label}<br />
                      <span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>{s.deviceName}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.length === 0 ? (
                  <tr><td colSpan={activeSensorCols.length + 1} style={{ padding: 40, textAlign: 'center', color: 'var(--admin-border)' }}>Nhấn "Xem trước" để tải dữ liệu</td></tr>
                ) : (
                  previewData.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 ? 'var(--admin-border-light)' : 'transparent' }}>
                      <td style={{ padding: '5px 12px', color: 'var(--admin-text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--admin-hover)' }}>{fmtDateTime(row.time)}</td>
                      {activeSensorCols.map(s => {
                        const v = row[s.id];
                        return (
                          <td key={s.id} style={{ padding: '5px 10px', textAlign: 'right', color: v !== null && v !== undefined ? s.color : 'var(--admin-border)', borderBottom: '1px solid var(--admin-hover)' }}>
                            {v !== null && v !== undefined ? Number(v).toFixed(1) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
