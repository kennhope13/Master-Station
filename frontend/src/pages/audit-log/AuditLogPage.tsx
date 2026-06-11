import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, Clock, Shield, ChevronLeft, LayoutGrid, Database } from 'lucide-react';
import { stationApi, Station } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';
import { fmtDateTime, fmtTimeRange } from '@/utils/format';
import './AuditLogPage.css';

type TabId = 'all' | 'audit' | 'login';

interface LogItem {
  ts: string;
  type: string;
  action: string;
  info: string;
  who: string;
  stationId?: string;
  stationName?: string;
  raw: any;
}

interface AuditLogPageProps {
  embeddedMode?: 'default' | 'central';
  stationIdOverride?: string | null;
}

export default function AuditLogPage({ embeddedMode = 'default', stationIdOverride = null }: AuditLogPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('auditTab') as TabId) || 'all';
  const [timeRange, setTimeRange] = useState('today');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterStation, setFilterStation] = useState(stationIdOverride || '');
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [isEpOpen, setIsEpOpen] = useState(true);

  const currentUser = authService.getUser();
  const isCentralMode = isCentralUser(currentUser);
  const dates = useMemo(() => fmtTimeRange(timeRange), [timeRange]);

  useEffect(() => {
    if (isCentralMode) {
      stationApi.getStations().then(setStationsList).catch(console.error);
    }
  }, [isCentralMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const from = dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = dates.to ? new Date(dates.to + 'T23:59:59').toISOString() : undefined;
    const params = { from, to, limit: 300, stationId: filterStation || undefined };
    try {
      const [audit, logins] = await Promise.all([stationApi.getAuditLogs(params), stationApi.getLoginLogs(params)]);
      const merged = [
        ...audit.map(l => ({ ts: l.ts, type: 'audit', action: l.action, info: l.entityType?.toUpperCase() || 'SYS', who: l.fullName || l.username || 'system', raw: l })),
        ...logins.map(l => ({ ts: l.ts, type: 'login', action: 'Auth', info: 'LOGIN', who: l.username || 'system', raw: l }))
      ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setLogs(merged);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [dates, filterStation]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let source = activeTab === 'all' ? logs : logs.filter(l => l.type === activeTab);
    if (!searchText) return source;
    const q = searchText.toLowerCase();
    return source.filter(l => l.action.toLowerCase().includes(q) || l.info.toLowerCase().includes(q) || l.who.toLowerCase().includes(q));
  }, [logs, activeTab, searchText]);

  const groupedStations = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; items: LogItem[] }>();
    filtered.forEach((item) => {
      const id = item.stationId || 'central-sys';
      const name = item.stationName || 'TRUNG TÂM';
      const current = grouped.get(id);
      if (current) {
        current.items.push(item);
        return;
      }
      grouped.set(id, { id, name, items: [item] });
    });
    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [filtered]);

  return (
    <div className="rtm-page industrial-theme">
      <header className="rtm-bar">
        <div className="rtm-title">NHẬT KÝ HỆ THỐNG</div>
        <div className="rtm-sep" />
        <div className="nvr-stats">
          <div className="nvr-stat">TỔNG: <b>{filtered.length}</b></div>
          <div className="nvr-stat">TRẠM: <b>{isCentralMode ? (filterStation ? '1' : stationsList.length) : 'LOCAL'}</b></div>
        </div>
        <div className="rtm-sep" />
        <div className="bar-search">
          <Search size={12} />
          <input type="text" placeholder="TÌM KIẾM..." value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="nvr-ep-filters" style={{ display:'flex', gap: 10, alignItems: 'center' }}>
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>LOẠI:</span>
           <select className="nvr-sel" value={activeTab} onChange={e => setSearchParams({ auditTab: e.target.value })}>
              <option value="all">TẤT CẢ</option>
              <option value="audit">HÀNH ĐỘNG</option>
              <option value="login">ĐĂNG NHẬP</option>
           </select>
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>HẠN:</span>
           <select className="nvr-sel" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
              <option value="today">HÔM NAY</option>
              <option value="yesterday">HÔM QUA</option>
              <option value="7d">7 NGÀY</option>
              <option value="all">TẤT CẢ</option>
           </select>
           <button className="nvr-lb" onClick={loadData}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
      </header>

      <div className="rtm-main">
        {isCentralMode && (
          <aside className="nvr-left-sidebar">
            <div className="sb-hdr">HỆ THỐNG TRẠM</div>
            <div className="sb-list">
              <div className={`sb-item ${!filterStation ? 'active' : ''}`} onClick={() => setFilterStation('')}>
                <LayoutGrid size={13} />
                <span className="txt">TẤT CẢ TRẠM</span>
                <span className="cnt">{stationsList.length}</span>
              </div>
              {stationsList.map(s => (
                <div key={s.id} className={`sb-item ${filterStation === s.id ? 'active' : ''}`} onClick={() => setFilterStation(s.id)}>
                  <Database size={13} />
                  <span className="txt">{s.name.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        <div className="nvr-wrap">
          {!filterStation && isCentralMode ? (
            <div className="nvr-mosaic-grid">
               {groupedStations.map(group => (
                 <div key={group.id} className="nvr-cell-card" onClick={() => setFilterStation(group.id === 'central-sys' ? '' : group.id)}>
                    <div className="cell-hdr">
                       <div className="st-status" />
                       <span className="st-name">{group.name.toUpperCase()}</span>
                    </div>
                    <div className="cell-body">
                       <div className="main-stat">{group.items.length}</div>
                       <div className="sub-stat">LOGS</div>
                       <div className="stat-split">
                          <div><span>AUDIT</span><b>{group.items.filter(i => i.type === 'audit').length}</b></div>
                          <div><span>LOGIN</span><b>{group.items.filter(i => i.type === 'login').length}</b></div>
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          ) : (
            <div className="nvr-log-area">
              <table className="nvr-table-sharp">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>THỜI GIAN</th>
                    <th style={{ width: 80 }}>LOẠI</th>
                    <th>HÀNH ĐỘNG</th>
                    <th style={{ width: 150 }}>NGƯỜI DÙNG</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, idx) => (
                    <tr key={idx} className={selectedLog === l ? 'active' : ''} onClick={() => setSelectedLog(l)}>
                      <td className="mono">{fmtDateTime(l.ts)}</td>
                      <td><span className={'badge-' + l.type}>{l.type.toUpperCase()}</span></td>
                      <td><b className="act-bold">{l.info}</b> <small style={{ opacity: 0.5 }}>{l.action}</small></td>
                      <td className="mono">{l.who.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className={'nvr-ep' + (isEpOpen ? '' : ' collapsed')}>
           <button className="nvr-ep-tab" onClick={() => setIsEpOpen(!isEpOpen)}>
              <span className="nvr-ep-tab-arrow">{isEpOpen ? <ChevronRight size={10}/> : <ChevronLeft size={10}/>}</span>
              <span className="nvr-ep-tab-label">CHI TIẾT</span>
           </button>
           <div className="nvr-ep-body">
              <div className="nvr-ep-hdr"><div className="nvr-ep-title">THÔNG TIN CHI TIẾT</div></div>
              <div className="nvr-ep-list">
                 {selectedLog ? (
                   <div className="nvr-evt-detail">
                      <div className="detail-row"><span>THỜI GIAN</span><b>{fmtDateTime(selectedLog.ts)}</b></div>
                      <div className="detail-row"><span>ĐỐI TƯỢNG</span><b>{selectedLog.info}</b></div>
                      <div className="detail-row"><span>HÀNH ĐỘNG</span><b>{selectedLog.action}</b></div>
                      <div className="detail-row"><span>THỰC HIỆN</span><b>{selectedLog.who}</b></div>
                      {selectedLog.type === 'audit' && (
                        <div className="diff-area">
                           <div className="diff-box">
                              <span>CŨ</span>
                              <pre>{typeof selectedLog.raw.oldValue === 'string' ? selectedLog.raw.oldValue : JSON.stringify(selectedLog.raw.oldValue, null, 2)}</pre>
                           </div>
                           <div className="diff-box new">
                              <span>MỚI</span>
                              <pre>{typeof selectedLog.raw.newValue === 'string' ? selectedLog.raw.newValue : JSON.stringify(selectedLog.raw.newValue, null, 2)}</pre>
                           </div>
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className="nvr-ep-empty">CHỌN DÒNG ĐỂ XEM</div>
                 )}
              </div>
           </div>
        </aside>
      </div>
    </div>
  );
}
