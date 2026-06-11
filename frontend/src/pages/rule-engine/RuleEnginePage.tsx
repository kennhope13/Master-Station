// ============================================================
// RuleEnginePage.tsx — Quản lý quy tắc giám sát tự động
// Mỗi quy tắc gồm: thiết bị + điểm đo + ngưỡng + tác động (cảnh báo/sức khỏe/bảo trì)
// Hỗ trợ chọn thiết bị cụ thể, nhân bản (clone) quy tắc, và hiển thị màu chuẩn
// ============================================================

import { useState, useEffect } from 'react';
import { stationApi, Rule, Device } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { PT_TEMP_1, PT_TEMP_2, PT_TEMP_3, PT_PD, PT_CAM_IDS, TEMP_LABELS, CAM_POINT_LABELS } from '@/constants/points';

// Danh sách điểm đo mặc định dùng dự phòng
const FALLBACK_POINTS = [
  ...(PT_CAM_IDS as readonly string[]).map(id => ({ value: id, label: `Điểm camera ${id} — Nhiệt độ (°C)` })),
  { value: PT_TEMP_1, label: `${TEMP_LABELS[PT_TEMP_1]} (°C)` },
  { value: PT_TEMP_2, label: `${TEMP_LABELS[PT_TEMP_2]} (°C)` },
  { value: PT_TEMP_3, label: `${TEMP_LABELS[PT_TEMP_3]} (°C)` },
  { value: PT_PD,     label: `${TEMP_LABELS[PT_PD]} (dB)` },
];

export default function RuleEnginePage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointOptions, setPointOptions] = useState(FALLBACK_POINTS);


  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = tạo mới

  // Dữ liệu form quy tắc — preAlarm=Cảnh báo (Vàng), alarm=Nguy hiểm (Đỏ)
  const [formData, setFormData] = useState({
    name: '',
    ruleSet: '',
    deviceId: '', // Thiết bị áp dụng (rỗng = Tất cả thiết bị)
    point: 'P1',
    op: '>=',
    preAlarm: '',
    alarm: '',
    doAlert: true,
    doHealth: false,
    doMaintenance: false,
    penalty: 10,
    maintType: 'inspection',
    maintDays: 30
  });

  useEffect(() => {
    loadData();
  }, []);

  // Parse JSON điều kiện từ API
  const parseCondition = (json: string): any => {
    try { return JSON.parse(json); } catch { return { point: '?', op: '>=', value: 0 }; }
  };

  // Parse JSON hành động từ API
  const parseActions = (actionsJson: string): any => {
    try {
      const arr: any[] = JSON.parse(actionsJson);
      const healthA = arr.find(a => a.type === 'health');
      const alertA = arr.find(a => a.type === 'alert' || !a.type);
      const maintA = arr.find(a => a.type === 'maintenance');
      return {
        doHealth: !!healthA, penalty: healthA?.penalty ?? 10,
        doAlert: !!alertA, level: alertA?.level ?? (alertA === undefined ? 'warning' : 'hybrid'),
        doMaintenance: !!maintA, maintType: maintA?.taskType ?? 'inspection', maintDays: maintA?.scheduledInDays ?? 30,
      };
    } catch {
      return { doHealth: false, penalty: 10, doAlert: true, level: 'warning', doMaintenance: false, maintType: 'inspection', maintDays: 30 };
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const savedStationId = localStorage.getItem('selected_station_id');
      let activeStationId = savedStationId;
      if (!activeStationId) {
        const stations = await stationApi.getStations();
        activeStationId = stations[0]?.id ?? null;
      }
      
      const [rulesData, pts, devs] = await Promise.all([
        stationApi.getRules(),
        (activeStationId ? stationApi.getLatestPoints(activeStationId) : Promise.resolve([])).catch(() => []),
        (activeStationId ? stationApi.getDevices(activeStationId) : Promise.resolve([])).catch(() => [])
      ]);

      setDevices(devs);

      // Xử lý các điểm đo
      const seen = new Set<string>();
      const apiPoints = pts
        .filter(p => { const ok = !seen.has(p.pointId); seen.add(p.pointId); return ok; })
        .map(p => {
          const name = TEMP_LABELS[p.pointId] ?? CAM_POINT_LABELS[p.pointId] ?? (p.pointId.toUpperCase().startsWith('P') ? `Điểm camera ${p.pointId}` : p.pointId.replace(/_/g, ' '));
          return { value: p.pointId, label: p.unit ? `${name} (${p.unit})` : name };
        });

      setPointOptions(apiPoints);

      // Đồng bộ các rule nhiệt độ nếu cần
      const isSynced = localStorage.getItem('thermal_rules_sync_v3');
      let finalRules = rulesData;
      if (!isSynced && rulesData.length > 0) {
        for (const r of rulesData) {
          if (r.ruleSet === 'Các điểm đo của cam nhiệt' || r.ruleSet === 'camera_thermal_zones') {
            const cond = parseCondition(r.condition);
            if (!cond.point) continue;
            let updated = false, pre_alarm = 50, alarm = 70;
            if (cond.point === 'P1') { pre_alarm = 30; alarm = 50; updated = true; }
            else if (cond.point.match(/^P[2-9]$/) || cond.point === 'P10') { pre_alarm = 50; alarm = 70; updated = true; }

            if (updated) {
              await stationApi.updateRule(r.id, {
                ...r,
                condition: JSON.stringify({ ...cond, type: 'analog', pre_alarm, alarm })
              });
            }
          }
        }
        localStorage.setItem('thermal_rules_sync_v3', 'true');
        finalRules = await stationApi.getRules();
      }

      setRules(finalRules);
    } catch (e) {
      console.error('Lỗi khi tải danh sách quy tắc:', e);
    } finally {
      setLoading(false);
    }
  };



  const toggleRule = async (id: string, currentEnabled: boolean) => {
    try {
      await stationApi.toggleRule(id);
      setRules(rules.map(r => r.id === id ? { ...r, enabled: !currentEnabled } : r));
    } catch (e) {
      alert('Không thể thay đổi trạng thái quy tắc: ' + e);
    }
  };

  const deleteRule = async (id: string) => {
    if (!await confirmDialog({ title: 'Xác nhận xóa', message: 'Bạn có chắc chắn muốn xóa quy tắc giám sát này không?', confirmText: 'Xóa quy tắc', danger: true })) return;
    try {
      await stationApi.deleteRule(id);
      setRules(rules.filter(r => r.id !== id));
    } catch (e) {
      alert('Không thể xóa quy tắc: ' + e);
    }
  };

  const openAddModal = (presetSet = '') => {
    setEditingId(null);
    setFormData({
      name: '',
      ruleSet: presetSet || 'Quy tắc máy biến áp',
      deviceId: '',
      point: 'P1',
      op: '>=',
      preAlarm: '',
      alarm: '',
      doAlert: true,
      doHealth: false,
      doMaintenance: false,
      penalty: 10,
      maintType: 'inspection',
      maintDays: 30
    });
    setIsModalOpen(true);
  };

  const openEditModal = (r: Rule) => {
    setEditingId(r.id);
    const cond = parseCondition(r.condition);
    const actions = parseActions(r.actions);
    let setVal = r.ruleSet || '';
    if (setVal === 'camera_thermal_zones') setVal = 'Các điểm đo của cam nhiệt';

    setFormData({
      name: r.name,
      ruleSet: setVal,
      deviceId: r.deviceId || '',
      point: cond.point,
      op: cond.op || '>=',
      preAlarm: cond.pre_alarm ?? cond.value ?? '',
      alarm: cond.alarm ?? '',
      doAlert: actions.doAlert,
      doHealth: actions.doHealth,
      doMaintenance: actions.doMaintenance,
      penalty: actions.penalty,
      maintType: actions.maintType,
      maintDays: actions.maintDays
    });
    setIsModalOpen(true);
  };

  // Tính năng Clone (Sao chép) quy tắc
  const cloneRule = (r: Rule) => {
    const cond = parseCondition(r.condition);
    const actions = parseActions(r.actions);
    let setVal = r.ruleSet || '';
    if (setVal === 'camera_thermal_zones') setVal = 'Các điểm đo của cam nhiệt';

    setEditingId(null); // Đặt thành null để khi lưu sẽ tạo mới
    setFormData({
      name: `${r.name} (Bản sao)`,
      ruleSet: setVal,
      deviceId: r.deviceId || '',
      point: cond.point,
      op: cond.op || '>=',
      preAlarm: cond.pre_alarm ?? cond.value ?? '',
      alarm: cond.alarm ?? '',
      doAlert: actions.doAlert,
      doHealth: actions.doHealth,
      doMaintenance: actions.doMaintenance,
      penalty: actions.penalty,
      maintType: actions.maintType,
      maintDays: actions.maintDays
    });
    setIsModalOpen(true);
  };

  const saveRule = async () => {
    const { name, point, op, preAlarm, alarm, doAlert, doHealth, doMaintenance, penalty, maintType, maintDays, deviceId } = formData;
    const ruleSet = formData.ruleSet.trim() || undefined;

    if (!name) { alert('Vui lòng nhập tên quy tắc'); return; }
    
    const preA = preAlarm === '' ? null : parseFloat(preAlarm);
    const alA = alarm === '' ? null : parseFloat(alarm);

    if (preA === null && alA === null) { alert('Vui lòng cấu hình ít nhất 1 ngưỡng cảnh báo hoặc nguy hiểm'); return; }
    if (!doAlert && !doHealth && !doMaintenance) { alert('Vui lòng chọn ít nhất 1 hành động tác động'); return; }

    const condition = JSON.stringify({ type: 'analog', point, op, pre_alarm: preA, alarm: alA });
    
    const actionList: any[] = [];
    if (doAlert) actionList.push({ type: 'alert', level: (alA !== null && preA !== null) ? 'hybrid' : (alA !== null ? 'alarm' : 'warning') });
    if (doHealth) actionList.push({ type: 'health', penalty });
    if (doMaintenance) actionList.push({ type: 'maintenance', taskType: maintType, scheduledInDays: maintDays });

    const actions = JSON.stringify(actionList);
    const devIdParam = deviceId ? deviceId : null;

    try {
      if (editingId) {
        await stationApi.updateRule(editingId, { name, ruleSet, condition, actions, deviceId: devIdParam });
      } else {
        await stationApi.createRule({ name, ruleSet, condition, actions, enabled: true, deviceId: devIdParam });
      }
      setIsModalOpen(false);
      loadData();
    } catch (e) {
      alert(`Không thể lưu quy tắc: ${e}`);
    }
  };

  // Tính toán số liệu thống kê
  const total = rules.length;
  const enabled = rules.filter(r => r.enabled).length;
  let totalWarning = 0;
  let totalAlarm = 0;

  rules.forEach(r => {
    const cond = parseCondition(r.condition);
    const actions = parseActions(r.actions);
    if (cond.alarm !== null && cond.alarm !== undefined && cond.alarm !== '') totalAlarm++;
    else if (actions.level === 'alarm') totalAlarm++;

    if (cond.pre_alarm !== null && cond.pre_alarm !== undefined && cond.pre_alarm !== '') totalWarning++;
    else if (actions.level === 'warning' || actions.level === 'hybrid') totalWarning++;
  });

  // No longer need grouping, we render flat rules.

  return (
    <div className="admin-page-container">
      {/* Toolbar */}
      <div className="page-toolbar-row dash-header">
        <div className="page-title-cell">
          <h2>RULE ENGINE</h2>
        </div>
        <div className="page-toolbar-group">
          <button 
            className="btn-industrial btn-primary" 
            style={{ height: 32, padding: '0 16px', fontSize: '.75rem', fontWeight: 800 }}
            onClick={() => openAddModal()}
          >
            + THÊM QUY TẮC MỚI
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display:'flex', gap:16, alignItems:'center', padding:'6px 14px', background:'var(--admin-panel)', borderBottom:'1px solid var(--admin-border)', fontSize:'.6rem', color:'var(--admin-text-muted)', fontWeight:800, letterSpacing:'.08em', flexShrink:0 }}>
        <span>TỔNG: <b style={{color:'var(--admin-text)',letterSpacing:'0'}}>{loading ? '—' : total}</b></span>
        <span style={{width:1,height:12,background:'var(--admin-border)',flexShrink:0}} />
        <span>KÍCH HOẠT: <b style={{color:'var(--admin-success)',letterSpacing:'0'}}>{loading ? '—' : enabled}</b></span>
        <span style={{width:1,height:12,background:'var(--admin-border)',flexShrink:0}} />
        <span>CẢNH BÁO: <b style={{color:'var(--admin-warning)',letterSpacing:'0'}}>{loading ? '—' : totalWarning}</b></span>
        <span style={{width:1,height:12,background:'var(--admin-border)',flexShrink:0}} />
        <span>NGUY HIỂM: <b style={{color:'var(--admin-danger)',letterSpacing:'0'}}>{loading ? '—' : totalAlarm}</b></span>
      </div>

      {/* Main List */}
      <div className="admin-card" style={{ padding: 0, overflow: 'auto', flex: 1, margin: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Tên quy tắc / Điểm đo</th>
              <th>Thiết bị / Nhóm</th>
              <th style={{ textAlign: 'center' }}>Mức độ</th>
              <th style={{ textAlign: 'center' }}>Ngưỡng kích hoạt</th>
              <th style={{ textAlign: 'center' }}>Trạng thái</th>
              <th style={{ textAlign: 'right' }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)' }}>⏳ Đang tải dữ liệu quy tắc...</td></tr>
            ) : total === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--admin-text-muted)' }}>Hệ thống chưa có quy tắc nào. Nhấp vào <b>+ Thêm quy tắc mới</b> để bắt đầu thiết lập giám sát.</td></tr>
            ) : (
              rules.map(r => {
                const cond = parseCondition(r.condition);
                const actions = parseActions(r.actions);
                const pointLabel = (pointOptions.find(p => p.value === cond.point)?.label ?? cond.point).split(' — ')[0];
                
                const hasAlarm = cond.alarm !== null && cond.alarm !== undefined && cond.alarm !== '';
                const hasWarning = (cond.pre_alarm !== null && cond.pre_alarm !== undefined && cond.pre_alarm !== '') || (cond.value !== undefined && actions.level === 'warning');
                const valAlarm = cond.alarm ?? (actions.level === 'alarm' ? cond.value : null);
                const valWarning = cond.pre_alarm ?? (actions.level === 'warning' ? cond.value : null);

                let badgeHtml, valueHtml;
                if (hasAlarm && hasWarning) {
                  badgeHtml = (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', background: 'rgba(239,68,68,.15)', color: 'var(--admin-danger)' }}>Nguy hiểm</span>
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', background: 'rgba(245,158,11,.15)', color: 'var(--admin-warning)' }}>Cảnh báo</span>
                    </div>
                  );
                  valueHtml = <><span style={{ color: 'var(--admin-danger)', fontWeight: 800 }}>{valAlarm}</span> <span style={{ opacity: 0.3, margin: '0 2px' }}>/</span> <span style={{ color: 'var(--admin-warning)', fontWeight: 800 }}>{valWarning}</span></>;
                } else if (hasAlarm) {
                  badgeHtml = <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', background: 'rgba(239,68,68,.15)', color: 'var(--admin-danger)' }}>Nguy hiểm</span>;
                  valueHtml = <span style={{ color: 'var(--admin-danger)', fontWeight: 800 }}>{valAlarm}</span>;
                } else {
                  badgeHtml = <span style={{ fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', background: 'rgba(245,158,11,.15)', color: 'var(--admin-warning)' }}>Cảnh báo</span>;
                  valueHtml = <span style={{ color: 'var(--admin-warning)', fontWeight: 800 }}>{valWarning}</span>;
                }

                const isCameraPoint = cond.point.startsWith('P') && cond.point.length <= 3;
                const typeLabel = isCameraPoint ? 'Camera' : 'Cảm biến';

                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{r.name}</span>
                        {actions.doHealth && <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(14,165,233,0.15)', color: 'var(--admin-accent)', borderRadius: 3, fontWeight: 'normal' }}>Sức khỏe (-{actions.penalty}đ)</span>}
                        {actions.doMaintenance && <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(34,197,94,0.15)', color: 'var(--admin-success)', borderRadius: 3, fontWeight: 'normal' }}>Bảo trì</span>}
                      </div>
                      <div style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{typeLabel}: {pointLabel}</span>
                        <code style={{ background: 'var(--admin-layer-2)', padding: '1px 4px', borderRadius: 3, fontSize: '0.65rem' }}>{cond.op || '≥'}</code>
                      </div>
                    </td>
                    
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--admin-text)' }}>{r.deviceName || 'Tất cả thiết bị'}</div>
                      <div style={{ fontSize: '0.68rem', marginTop: 2, color: 'var(--admin-text-muted)' }}>Nhóm: {r.ruleSet || 'Mặc định'}</div>
                    </td>
                    
                    <td style={{ textAlign: 'center' }}>{badgeHtml}</td>
                    
                    <td style={{ fontSize: '0.85rem', textAlign: 'center', fontFamily: 'Consolas, monospace' }}>{valueHtml}</td>
                    
                    <td style={{ textAlign: 'center' }}>
                      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22 }}>
                        <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id, r.enabled)} style={{ opacity: 0, width: 0, height: 0 }} />
                        <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, background: r.enabled ? 'var(--admin-accent)' : 'var(--admin-layer-3)', borderRadius: 22, transition: '.2s' }}>
                          <span style={{ position: 'absolute', content: '""', height: 16, width: 16, left: r.enabled ? 21 : 3, bottom: 3, background: 'white', borderRadius: '50%', transition: '.2s' }}></span>
                        </span>
                      </label>
                    </td>
                    
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn-industrial btn-sm" onClick={() => openEditModal(r)} title="Sửa">Sửa</button>
                        <button className="btn-industrial btn-sm" onClick={() => cloneRule(r)} title="Sao chép">Sao chép</button>
                        <button className="btn-industrial btn-sm btn-danger" onClick={() => deleteRule(r.id)} title="Xóa">Xóa</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Thêm/Sửa */}
      {isModalOpen && (
        <div className="modal-overlay active" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="modal-content" style={{ width: 550, background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, overflow: 'hidden', boxShadow: 'var(--admin-shadow)', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ padding: '14px 20px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--admin-layer-1)' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>{editingId ? 'Cập nhật quy tắc giám sát' : 'Thiết lập quy tắc giám sát mới'}</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '75vh', overflowY: 'auto' }}>
              
              {/* Tên Rule */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Tên quy tắc <span style={{ color: 'var(--admin-danger)' }}>*</span></label>
                <input className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="VD: Quá nhiệt máy biến áp Tủ 471" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                <div className="hint-text">Đặt tên mô tả rõ ràng để khi kích hoạt cảnh báo, người vận hành hiểu ngay sự cố nằm ở đâu.</div>
              </div>
              
              {/* Thiết bị áp dụng */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Thiết bị áp dụng <span style={{ color: 'var(--admin-accent)' }}>(Khuyên dùng)</span></label>
                <select 
                  className="form-select" 
                  style={{ width: '100%', boxSizing: 'border-box' }} 
                  value={formData.deviceId} 
                  onChange={e => setFormData({ ...formData, deviceId: e.target.value })}
                >
                  <option value="">-- Áp dụng chung cho tất cả thiết bị phù hợp --</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.type === 'plc_s7' ? 'PLC Siemens' : d.type === 'camera_thermal' ? 'Camera Nhiệt' : d.type === 'camera_dual' ? 'Camera 2 Mắt' : d.type})
                    </option>
                  ))}
                </select>
                <div className="hint-text">Chọn một thiết bị cụ thể để quy tắc này chỉ áp dụng riêng cho thiết bị đó. Để trống nếu muốn áp dụng cho mọi thiết bị có chung điểm đo.</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Điểm đo */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Điểm đo cảm biến <span style={{ color: 'var(--admin-danger)' }}>*</span></label>
                  <select className="form-select" style={{ width: '100%' }} value={formData.point} onChange={e => setFormData({ ...formData, point: e.target.value })}>
                    {pointOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                
                {/* Phân nhóm */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Phân nhóm quy tắc</label>
                  <input className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} list="ruleSetDatalist" placeholder="VD: Cảnh báo nhiệt độ" value={formData.ruleSet} onChange={e => setFormData({ ...formData, ruleSet: e.target.value })} />
                  <datalist id="ruleSetDatalist">
                    {[...new Set(rules.map(r => r.ruleSet).filter(Boolean))].map(s => <option key={s as string} value={s as string} />)}
                  </datalist>
                </div>
              </div>

              {/* Ngưỡng kích hoạt */}
              <div style={{ border: '1px solid var(--admin-border)', padding: 14, borderRadius: 6, background: 'var(--admin-layer-1)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--admin-accent)', fontWeight: 800, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ngưỡng và Điều kiện so sánh</div>
                
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, marginBottom: 4 }}>Phép toán so sánh</label>
                  <select className="form-select" style={{ width: '100%' }} value={formData.op} onChange={e => setFormData({ ...formData, op: e.target.value })}>
                    <option value=">=">&gt;= Lớn hơn hoặc bằng (Mặc định cho nhiệt độ)</option>
                    <option value=">">&gt; Lớn hơn hẳn</option>
                    <option value="<=">&lt;= Nhỏ hơn hoặc bằng</option>
                    <option value="<">&lt; Nhỏ hơn hẳn</option>
                    <option value="==">== Bằng chính xác</option>
                  </select>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--admin-warning)', marginBottom: 4 }}>Ngưỡng Cảnh báo (Vàng)</label>
                    <input className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} type="number" placeholder="Bỏ trống nếu không dùng" step="any" value={formData.preAlarm} onChange={e => setFormData({ ...formData, preAlarm: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--admin-danger)', marginBottom: 4 }}>Ngưỡng Nguy hiểm (Đỏ)</label>
                    <input className="form-input" style={{ width: '100%', boxSizing: 'border-box' }} type="number" placeholder="Bỏ trống nếu không dùng" step="any" value={formData.alarm} onChange={e => setFormData({ ...formData, alarm: e.target.value })} />
                  </div>
                </div>
                
                <div className="hint-text" style={{ marginTop: 8 }}>
                  <b>Hướng dẫn đặt màu sắc:</b> Khi giá trị đo vượt ngưỡng <i>Cảnh báo</i>, thông số trên SLD/Bản đồ nhiệt sẽ đổi sang <b>màu Vàng</b>. Khi vượt ngưỡng <i>Nguy hiểm</i>, thông số sẽ đổi sang <b>màu Đỏ</b> đồng thời kích hoạt camera tự động ghi lại bằng chứng video sự cố.
                </div>
              </div>

              {/* Tác động khi vi phạm */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: 6 }}>Tác động và Tự động hóa hệ thống</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  
                  {/* Cảnh báo Alert */}
                  <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                      <input type="checkbox" checked={formData.doAlert} onChange={e => setFormData({ ...formData, doAlert: e.target.checked })} style={{ accentColor: 'var(--admin-warning)', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--admin-text)' }}>Kích hoạt cảnh báo hệ thống</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Hiển thị trên bảng cảnh báo thời gian thực và lưu nhật ký sự cố.</div>
                      </div>
                    </label>
                  </div>
                  
                  {/* Sức khỏe thiết bị */}
                  <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                      <input type="checkbox" checked={formData.doHealth} onChange={e => setFormData({ ...formData, doHealth: e.target.checked })} style={{ accentColor: '#0ea5e9', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--admin-text)' }}>Ảnh hưởng sức khỏe thiết bị</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Trừ điểm sức khỏe tự động của thiết bị này khi có sự cố xảy ra.</div>
                      </div>
                    </label>
                    {formData.doHealth && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-muted)' }}>Số điểm trừ mỗi lần vi phạm (1-100):</span>
                        <input type="number" className="form-input" style={{ width: 80, padding: '4px 8px' }} min="1" max="100" value={formData.penalty} onChange={e => setFormData({ ...formData, penalty: Number(e.target.value) })} />
                      </div>
                    )}
                  </div>

                  {/* Bảo trì CMMS */}
                  <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                      <input type="checkbox" checked={formData.doMaintenance} onChange={e => setFormData({ ...formData, doMaintenance: e.target.checked })} style={{ accentColor: 'var(--admin-success)', width: 16, height: 16 }} />
                      <div>
                        <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--admin-text)' }}>Lập phiếu bảo trì tự động (CMMS)</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginTop: 1 }}>Tự động tạo một công việc bảo trì khi thiết bị vượt ngưỡng đỏ.</div>
                      </div>
                    </label>
                    {formData.doMaintenance && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <label style={{ fontSize: '0.68rem', color: 'var(--admin-text-muted)', display: 'block', marginBottom: 4 }}>Loại công việc bảo trì</label>
                            <select className="form-select" style={{ width: '100%', padding: '4px 8px', fontSize: '0.72rem' }} value={formData.maintType} onChange={e => setFormData({ ...formData, maintType: e.target.value })}>
                              <option value="inspection">Kiểm tra thiết bị</option>
                              <option value="repair">Sửa chữa khẩn cấp</option>
                              <option value="cleaning">Vệ sinh công nghiệp</option>
                              <option value="calibration">Hiệu chuẩn thông số</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: '0.68rem', color: 'var(--admin-text-muted)', display: 'block', marginBottom: 4 }}>Thời hạn hoàn thành (ngày)</label>
                            <input type="number" className="form-input" style={{ width: '100%', padding: '4px 8px', fontSize: '0.72rem', boxSizing: 'border-box' }} min="1" max="365" value={formData.maintDays} onChange={e => setFormData({ ...formData, maintDays: Number(e.target.value) })} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
            
            <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--admin-layer-1)' }}>
              <button className="btn-industrial" style={{ padding: '6px 16px', fontSize: '0.75rem' }} onClick={() => setIsModalOpen(false)}>Hủy bỏ</button>
              <button className="btn-industrial btn-primary" style={{ padding: '6px 16px', fontSize: '0.75rem' }} onClick={saveRule}>Lưu cấu hình</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
