import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { RefreshCw, Play, Camera, Search, ChevronRight, ChevronLeft, Clock, ShieldAlert, CheckCircle2, History, User, ExternalLink } from 'lucide-react';
import { stationApi, AlertItem, AlertHistoryEntry } from '@/services/StationApiService';
import { useStationStore, useDeviceStore, useAlertStore } from '@/store';
import { ALERT_STATUS, ALERT_LEVEL, alertStatusLabel, alertLevelLabel } from '@/types/enums';
import { createRealtimeHub } from '@/services/realtime.service';
import { fmtDateTime, fmtTimeRange, cleanAlertMessage } from '@/utils/format';
import { confirmDialog } from '@/utils/confirm';
import { GO2RTC_URL } from '@/utils/env';
import { authService } from '@/services/AuthService';
import './AlertsHistoryPage.css';

type AlertDetail = AlertItem & { history: AlertHistoryEntry[] };

const alertSourceLabel = (src: string): string => {
  const sourceMap: Record<string, string> = {
    rule_engine: 'NGƯỠNG ĐO',
    ai_detection: 'NGƯỜI',
    manual: 'THỦ CÔNG',
    maintenance: 'BẢO TRÌ',
    camera: 'CAMERA',
    storage_monitor: 'GIÁM SÁT BỘ NHỚ',
    system: 'HỆ THỐNG',
  };
  return sourceMap[src] || src?.toUpperCase() || 'HỆ THỐNG';
};

export default function AlertsHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const stationId = searchParams.get('stationId') || undefined;
  const [timeRange, setTimeRange] = useState('7d');
  const [customFrom, setCustomFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isEpOpen, setIsEpOpen] = useState(true);

  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);
  const ackAlertInStore = useAlertStore(s => s.ack);
  const closeAlertInStore = useAlertStore(s => s.close);

  const dates = useMemo(() => {
    if (timeRange === 'custom') {
      return { from: customFrom, to: customTo };
    }
    if (timeRange === 'all') {
      return { from: '', to: '' };
    }
    return fmtTimeRange(timeRange);
  }, [timeRange, customFrom, customTo]);

  useEffect(() => { fetchStations(); }, [fetchStations]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const from = dates.from ? new Date(dates.from).toISOString() : undefined;
      const to = dates.to ? new Date(dates.to + 'T23:59:59').toISOString() : undefined;
      const data = await stationApi.getAlerts(filterStatus || undefined, from, to, 200, stationId);
      setAlerts(data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [dates, filterStatus, stationId]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  useEffect(() => {
    const hub = createRealtimeHub();
    hub.on('AlertUpdated', (data: any) => {
      setAlerts(prev => prev.map(a => a.id === data.id ? { ...a, ...data } : a));
      if (selectedAlertId === data.id) loadDetail(data.id, true);
    });
    hub.start().catch(() => {});
    return () => { hub.stop(); };
  }, [selectedAlertId]);

  const loadDetail = async (id: string, silent = false) => {
    setSelectedAlertId(id);
    if (!silent) setDetailLoading(true);
    try {
      const data = await stationApi.getAlertDetail(id);
      setDetailData(data);
    } catch (e) { console.error(e); } finally { if (!silent) setDetailLoading(false); }
  };

  const filtered = useMemo(() => {
    let list = alerts;
    if (filterSource) {
      list = list.filter(a => a.source === filterSource);
    }
    if (!searchText) return list;
    const q = searchText.toLowerCase();
    return list.filter(a => a.message.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }, [alerts, searchText, filterSource]);

  const handleAck = async (id: string) => {
    await ackAlertInStore(id, 'Tiếp nhận qua hệ thống');
    loadAlerts();
    if (selectedAlertId === id) loadDetail(id, true);
  };

  const handleClose = async (id: string) => {
    if (!await confirmDialog({ title: 'Đóng cảnh báo', message: 'Xác nhận đóng sự cố này?' })) return;
    await closeAlertInStore(id);
    loadAlerts();
    if (selectedAlertId === id) loadDetail(id, true);
  };

  return (
    <div className="rtm-page industrial-theme">
      <header className="rtm-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginRight: 10 }}>
          <span 
            style={{ 
              fontSize: '0.75rem', 
              fontWeight: 900, 
              color: 'var(--admin-accent, #00ebc7)', 
              borderBottom: '2px solid var(--admin-accent, #00ebc7)', 
              paddingBottom: 2, 
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap'
            }}
          >
            NHẬT KÝ CẢNH BÁO
          </span>
          {authService.hasPermission('settings:manage') && (
            <span 
              onClick={() => navigate('/audit-log')}
              style={{ 
                fontSize: '0.75rem', 
                fontWeight: 900, 
                color: 'var(--admin-text-muted, #64748b)', 
                cursor: 'pointer', 
                paddingBottom: 2, 
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
                transition: 'color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--admin-text, #f1f5f9)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--admin-text-muted, #64748b)'}
            >
              NHẬT KÝ HỆ THỐNG
            </span>
          )}
        </div>
        <div className="rtm-sep" />
        <div className="nvr-stats">
          <div className="nvr-stat">SỰ KIỆN: <b>{filtered.length}</b></div>
          <div className="nvr-stat">MỞ: <b style={{ color: 'var(--admin-danger)' }}>{filtered.filter(a => a.status === 'open').length}</b></div>
        </div>
        <div className="rtm-sep" />
        <div className="bar-search">
          <Search size={12} />
          <input type="text" placeholder="TÌM KIẾM..." value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="nvr-ep-filters" style={{ display:'flex', gap: 10, alignItems: 'center' }}>
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>TRẠNG THÁI:</span>
           <select className="nvr-sel" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">TẤT CẢ</option>
              <option value="open">CHƯA XỬ LÝ</option>
              <option value="acked">ĐANG XỬ LÝ</option>
              <option value="closed">ĐÃ ĐÓNG</option>
           </select>
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>LOẠI:</span>
           <select className="nvr-sel" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              <option value="">TẤT CẢ</option>
              <option value="rule_engine">NGƯỠNG ĐO</option>
              <option value="ai_detection">NGƯỜI</option>
              <option value="manual">THỦ CÔNG</option>
              <option value="maintenance">BẢO TRÌ</option>
              <option value="camera">CAMERA</option>
              <option value="storage_monitor">GIÁM SÁT BỘ NHỚ</option>
              <option value="system">HỆ THỐNG</option>
           </select>
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>HẠN:</span>
           <select className="nvr-sel" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
              <option value="today">HÔM NAY</option>
              <option value="yesterday">HÔM QUA</option>
              <option value="7d">7 NGÀY</option>
              <option value="custom">TÙY CHỌN</option>
              <option value="all">TẤT CẢ</option>
           </select>
           {timeRange === 'custom' && (
             <div className="nvr-custom-dates" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
               <input
                 type="date"
                 className="nvr-date-input"
                 value={customFrom}
                 onChange={e => setCustomFrom(e.target.value)}
               />
               <span className="rtm-title" style={{ fontSize: 9, opacity: 0.5 }}>-</span>
               <input
                 type="date"
                 className="nvr-date-input"
                 value={customTo}
                 onChange={e => setCustomTo(e.target.value)}
               />
             </div>
           )}
           <button className="nvr-lb" onClick={loadAlerts}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
      </header>

      <div className="rtm-main">
        <div className="nvr-wrap">
           <div className="nvr-log-area">
              <table className="nvr-table-sharp">
                 <thead>
                    <tr>
                       <th style={{ width: 60, textAlign: 'center' }}>ẢNH</th>
                       <th style={{ width: 140 }}>THỜI GIAN</th>
                       <th style={{ width: 100 }}>MỨC ĐỘ</th>
                       <th style={{ width: 120 }}>LOẠI</th>
                        <th>NỘI DUNG</th>
                       <th style={{ width: 100 }}>TRẠNG THÁI</th>
                    </tr>
                 </thead>
                 <tbody>
                    {filtered.map(a => (
                       <tr key={a.id} className={(selectedAlertId === a.id ? 'active' : '') + ' clickable'} onClick={() => loadDetail(a.id)}>
                          <td style={{ textAlign: 'center' }}>
                             <div className="nvr-thumb-min">
                                {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" /> : <Camera size={14} opacity={0.1} />}
                                {a.videoUrl && <div className="p-ico"><Play size={8} fill="currentColor" /></div>}
                             </div>
                          </td>
                          <td className="mono">{fmtDateTime(a.triggeredAt)}</td>
                          <td><span className={'badge-' + a.level}>{alertLevelLabel(a.level).toUpperCase()}</span></td>
                          <td><span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--admin-text-muted)' }}>{alertSourceLabel(a.source)}</span></td>
                           <td><b className="act-bold">{cleanAlertMessage(a.message)}</b></td>
                          <td><span className={'status-' + a.status}>{alertStatusLabel(a.status).toUpperCase()}</span></td>
                       </tr>
                    ))}
                 </tbody>
              </table>
           </div>
        </div>

        <aside className={'nvr-ep' + (isEpOpen ? '' : ' collapsed')}>
           <button className="nvr-ep-tab" onClick={() => setIsEpOpen(!isEpOpen)}>
              <span className="nvr-ep-tab-arrow">{isEpOpen ? <ChevronRight size={10}/> : <ChevronLeft size={10}/>}</span>
              <span className="nvr-ep-tab-label">BIẾN CỐ</span>
           </button>
           <div className="nvr-ep-body">
              <div className="nvr-ep-hdr"><div className="nvr-ep-title">CHI TIẾT BIẾN CỐ</div></div>
              <div className="nvr-ep-list">
                 {detailLoading ? (
                   <div className="nvr-ep-loading"><RefreshCw className="spin" /><span>TẢI DỮ LIỆU...</span></div>
                 ) : detailData ? (
                   <div className="nvr-evt-detail">
                      <div className="media-preview">
                         {detailData.videoUrl ? (
                           <video src={detailData.videoUrl} controls autoPlay loop muted />
                         ) : detailData.imageUrl ? (
                           <img src={detailData.imageUrl} alt="" />
                         ) : <div className="no-media">KHÔNG CÓ DỮ LIỆU PHƯƠNG TIỆN</div>}
                      </div>
                      <div className="detail-row"><span>THÔNG ĐIỆP</span><b className="highlight">{cleanAlertMessage(detailData.message)}</b></div>
                      <div className="detail-row"><span>THỜI GIAN</span><b>{fmtDateTime(detailData.triggeredAt)}</b></div>
                      <div className="detail-row"><span>MỨC ĐỘ</span><b className={'badge-' + detailData.level}>{alertLevelLabel(detailData.level).toUpperCase()}</b></div>
                      
                      <div className="history-box">
                         <div className="h-hdr"><History size={12} /><span>TIẾN TRÌNH XỬ LÝ</span></div>
                         <div className="h-list">
                            <div className="h-item"><div className="dot sys" /><span>HỆ THỐNG KÍCH HOẠT</span><small>{fmtDateTime(detailData.triggeredAt)}</small></div>
                            {detailData.history.map((h, i) => (
                              <div key={i} className="h-item">
                                <div className="dot user" />
                                <span>{h.status === 'acked' ? 'TIẾP NHẬN' : 'ĐÃ ĐÓNG'}</span>
                                <small>{fmtDateTime(h.changedAt)}</small>
                                <div className="actor"><User size={10} /> {h.changedBy?.toUpperCase() || 'VẬN HÀNH'}</div>
                              </div>
                            ))}
                         </div>
                      </div>

                      <div className="nvr-actions">
                         {detailData.status === 'open' && <button className="nvr-btn-p" onClick={() => handleAck(detailData.id)}>TIẾP NHẬN</button>}
                         {detailData.status !== 'closed' && <button className="nvr-btn-d" onClick={() => handleClose(detailData.id)}>ĐÓNG SỰ CỐ</button>}
                      </div>
                   </div>
                 ) : (
                   <div className="nvr-ep-empty">CHỌN BIẾN CỐ ĐỂ XEM</div>
                 )}
              </div>
           </div>
        </aside>
      </div>
    </div>
  );
}
