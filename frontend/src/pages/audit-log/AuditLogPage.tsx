import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, ChevronLeft, LayoutGrid, Database } from 'lucide-react';
import { stationApi, Station } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';
import { fmtDateTime, fmtTimeRange } from '@/utils/format';
import { Province, Team } from '@/types/api.types';
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
  accountStationId?: string;
  accountStationName?: string;
  raw: any;
}

interface AuditLogPageProps {
  embeddedMode?: 'default' | 'central';
  stationIdOverride?: string | null;
}

function AuditFilterDropdown({
  value,
  options,
  onChange,
  minWidth = 110
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = options.find(option => option.value === value)?.label || options[0]?.label || '';

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth }}>
      <button type="button" className="nvr-sel nvr-sel-button" onClick={() => setOpen(prev => !prev)}>
        <span>{activeLabel}</span>
        <span style={{ color: '#64748b' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="nvr-sel-menu">
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`nvr-sel-item ${active ? 'active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatActionLabel(type: string, action: string, entity?: string) {
  const entityLabel = entity ? entity.toUpperCase() : 'HỆ THỐNG';
  const actionMap: Record<string, string> = {
    create: `Tạo ${entityLabel}`,
    update: `Cập nhật ${entityLabel}`,
    delete: `Xóa ${entityLabel}`,
    ack_alert: 'Xác nhận cảnh báo',
    close_alert: 'Đóng cảnh báo',
    login: 'Đăng nhập',
    auth: 'Xác thực'
  };

  if (type === 'login') return 'Đăng nhập hệ thống';
  return actionMap[action.toLowerCase()] || `${action.toUpperCase()} ${entityLabel}`;
}

export default function AuditLogPage({ embeddedMode = 'default', stationIdOverride = null }: AuditLogPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('auditTab') as TabId) || 'all';
  const [timeRange, setTimeRange] = useState('today');
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterProvince, setFilterProvince] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterStation, setFilterStation] = useState(stationIdOverride || '');
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [provincesList, setProvincesList] = useState<Province[]>([]);
  const [teamsList, setTeamsList] = useState<Team[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [isEpOpen, setIsEpOpen] = useState(true);

  const currentUser = authService.getUser();
  const isCentralMode = isCentralUser(currentUser);
  
  const dates = useMemo(() => {
    if (timeRange === 'custom') {
      return { from: customFrom, to: customTo };
    }
    return fmtTimeRange(timeRange);
  }, [timeRange, customFrom, customTo]);

  useEffect(() => {
    if (isCentralMode) {
      stationApi.getStations().then(setStationsList).catch(console.error);
      stationApi.getProvinces().then(setProvincesList).catch(console.error);
      stationApi.getTeams().then(setTeamsList).catch(console.error);
    }
  }, [isCentralMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const from = dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = dates.to ? new Date(dates.to + (dates.to.includes('T') ? '' : 'T23:59:59')).toISOString() : undefined;
    const params = { from, to, limit: 500, stationId: filterStation || undefined };
    try {
      const [audit, logins] = await Promise.all([stationApi.getAuditLogs(params), stationApi.getLoginLogs(params)]);
      const merged = [
        ...audit.map(l => ({
          ts: l.ts,
          type: 'audit',
          action: l.action,
          info: l.entityType?.toUpperCase() || 'SYS',
          who: l.fullName || l.username || 'system',
          stationId: l.stationId,
          stationName: l.stationName,
          accountStationId: l.accountStationId,
          accountStationName: l.accountStationName,
          raw: l
        })),
        ...logins.map(l => ({
          ts: l.ts,
          type: 'login',
          action: 'Auth',
          info: 'LOGIN',
          who: l.username || 'system',
          stationId: l.stationId,
          stationName: l.stationName,
          accountStationId: l.accountStationId,
          accountStationName: l.accountStationName,
          raw: l
        }))
      ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setLogs(merged);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [dates, filterStation]);

  useEffect(() => { loadData(); }, [loadData]);

  // Tập stationId thuộc tỉnh/tổ đang chọn; null = không có bộ lọc nào
  const filteredStationIds = useMemo<Set<string> | null>(() => {
    if (!isCentralMode || (!filterProvince && !filterTeam)) return null;
    let ids = stationsList.map(s => s.id);
    if (filterProvince) ids = ids.filter(id => stationsList.find(s => s.id === id)?.provinceId === filterProvince);
    if (filterTeam) {
      const team = teamsList.find(t => t.id === filterTeam);
      if (team?.stationIds?.length) ids = ids.filter(id => team.stationIds!.includes(id));
    }
    return new Set(ids);
  }, [isCentralMode, stationsList, teamsList, filterProvince, filterTeam]);

  const filtered = useMemo(() => {
    let source = activeTab === 'all' ? logs : logs.filter(l => l.type === activeTab);
    // Khi chưa chọn trạm cụ thể nhưng đang lọc theo tỉnh/tổ → lọc client-side
    if (!filterStation && filteredStationIds && (filterProvince || filterTeam)) {
      source = source.filter(l => l.stationId ? filteredStationIds.has(l.stationId) : false);
    }
    if (!searchText) return source;
    const q = searchText.toLowerCase();
    return source.filter(l => l.action.toLowerCase().includes(q) || l.info.toLowerCase().includes(q) || l.who.toLowerCase().includes(q));
  }, [logs, activeTab, searchText, filterStation, filteredStationIds, filterProvince, filterTeam]);

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

  const selectedStationInfo = useMemo(() => {
    if (!filterStation) return null;
    return stationsList.find(s => s.id === filterStation) || null;
  }, [filterStation, stationsList]);

  const stationAuditCount = useMemo(() => filtered.filter(l => l.type === 'audit').length, [filtered]);
  const stationLoginCount = useMemo(() => filtered.filter(l => l.type === 'login').length, [filtered]);

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
           <AuditFilterDropdown
             value={activeTab}
             onChange={value => setSearchParams({ auditTab: value })}
             options={[
               { value: 'all', label: 'TẤT CẢ' },
               { value: 'audit', label: 'HÀNH ĐỘNG' },
               { value: 'login', label: 'ĐĂNG NHẬP' }
             ]}
           />
           <span className="rtm-title" style={{ letterSpacing: 1, fontSize: 9 }}>THỜI GIAN:</span>
           <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
             <AuditFilterDropdown
               value={timeRange}
               minWidth={130}
               onChange={setTimeRange}
               options={[
                 { value: 'today', label: 'HÔM NAY' },
                 { value: 'yesterday', label: 'HÔM QUA' },
                 { value: '7d', label: '7 NGÀY QUA' },
                 { value: 'custom', label: 'CHỌN NGÀY CỤ THỂ' },
                 { value: 'all', label: 'TẤT CẢ LỊCH SỬ' }
               ]}
             />
             {timeRange === 'custom' && (
               <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#000', border: '1px solid #334155', padding: '2px 8px', height: 26 }}>
                 <input 
                   type="text"
                   placeholder="YYYY-MM-DD"
                   style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 11, outline: 'none', cursor: 'pointer' }} 
                   value={customFrom} 
                   onChange={e => setCustomFrom(e.target.value)} 
                 />
                 <span style={{ color: '#475569', fontSize: 10, fontWeight: 900 }}>→</span>
                 <input 
                   type="text"
                   placeholder="YYYY-MM-DD"
                   style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 11, outline: 'none', cursor: 'pointer' }} 
                   value={customTo} 
                   onChange={e => setCustomTo(e.target.value)} 
                 />
               </div>
             )}
           </div>
           <button className="nvr-lb" title="Làm mới dữ liệu" onClick={loadData}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
      </header>

      {isCentralMode && (
        <div className="audit-filter-bar">
          <span className="audit-filter-label">TỈNH</span>
          <AuditFilterDropdown
            value={filterProvince}
            minWidth={140}
            onChange={v => { setFilterProvince(v); setFilterTeam(''); setFilterStation(''); }}
            options={[
              { value: '', label: 'TẤT CẢ TỈNH' },
              ...provincesList.map(p => ({ value: p.id, label: p.name.toUpperCase() }))
            ]}
          />
          <span className="audit-filter-label">TỔ</span>
          <AuditFilterDropdown
            value={filterTeam}
            minWidth={130}
            onChange={v => { setFilterTeam(v); setFilterStation(''); }}
            options={[
              { value: '', label: 'TẤT CẢ TỔ' },
              ...(filterProvince
                ? teamsList.filter(t => t.provinceId === filterProvince)
                : teamsList
              ).map(t => ({ value: t.id, label: t.name.toUpperCase() }))
            ]}
          />
          <span className="audit-filter-label">TRẠM</span>
          <AuditFilterDropdown
            value={filterStation}
            minWidth={140}
            onChange={v => setFilterStation(v)}
            options={[
              { value: '', label: 'TẤT CẢ TRẠM' },
              ...(filteredStationIds
                ? stationsList.filter(s => filteredStationIds.has(s.id))
                : stationsList
              ).map(s => ({ value: s.id, label: s.name.toUpperCase() }))
            ]}
          />
          {(filterProvince || filterTeam || filterStation) && (
            <button
              className="nvr-lb"
              title="Xóa bộ lọc"
              onClick={() => { setFilterProvince(''); setFilterTeam(''); setFilterStation(''); }}
              style={{ fontSize: 10, width: 'auto', padding: '0 8px', gap: 4, display: 'flex', alignItems: 'center' }}
            >
              ✕ XÓA LỌC
            </button>
          )}
        </div>
      )}

      <div className="rtm-main">
        {isCentralMode && (
          <aside className="nvr-left-sidebar">
            <div className="sb-hdr">HỆ THỐNG TRẠM</div>
            <div className="sb-list">
              <div className={`sb-item ${!filterStation ? 'active' : ''}`} onClick={() => setFilterStation('')}>
                <LayoutGrid size={13} />
                <span className="txt">TẤT CẢ TRẠM</span>
                <span className="cnt">{filteredStationIds ? filteredStationIds.size : stationsList.length}</span>
              </div>
              {(filteredStationIds
                ? stationsList.filter(s => filteredStationIds.has(s.id))
                : stationsList
              ).map(s => (
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
              <div className="station-detail-head">
                <div>
                  <div className="station-detail-kicker">NHẬT KÝ TRẠM</div>
                  <div className="station-detail-name">{selectedStationInfo?.name || filtered[0]?.stationName || 'TRUNG TÂM'}</div>
                </div>
                <div className="station-detail-stats">
                  <div className="station-detail-stat">
                    <span>TỔNG</span>
                    <b>{filtered.length}</b>
                  </div>
                  <div className="station-detail-stat">
                    <span>HÀNH ĐỘNG</span>
                    <b>{stationAuditCount}</b>
                  </div>
                  <div className="station-detail-stat">
                    <span>ĐĂNG NHẬP</span>
                    <b>{stationLoginCount}</b>
                  </div>
                </div>
              </div>

              <div className="station-log-list">
                {filtered.map((l, idx) => (
                  <button key={idx} type="button" className={`station-log-card ${selectedLog === l ? 'active' : ''}`} onClick={() => setSelectedLog(l)}>
                    <div className="station-log-top">
                      <span className={'station-log-type badge-' + l.type}>{l.type.toUpperCase()}</span>
                      <span className="station-log-time">{fmtDateTime(l.ts)}</span>
                    </div>
                    <div className="station-log-title">{formatActionLabel(l.type, l.action, l.info)}</div>
                    <div className="station-log-meta">
                      <span>{l.info}</span>
                      <span>{l.who.toUpperCase()}</span>
                    </div>
                  </button>
                ))}
              </div>
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
                      <div className="detail-hero">
                        <span className={'detail-hero-badge badge-' + selectedLog.type}>{selectedLog.type.toUpperCase()}</span>
                        <b>{formatActionLabel(selectedLog.type, selectedLog.action, selectedLog.info)}</b>
                        <small>{fmtDateTime(selectedLog.ts)}</small>
                      </div>

                      <div className="detail-grid">
                        <div className="detail-card"><span>ĐỐI TƯỢNG</span><b>{selectedLog.info}</b></div>
                        <div className="detail-card"><span>THAO TÁC GỐC</span><b>{selectedLog.action}</b></div>
                        <div className="detail-card"><span>THỰC HIỆN</span><b>{selectedLog.who}</b></div>
                        <div className="detail-card"><span>TRẠM BỊ TÁC ĐỘNG</span><b>{selectedLog.stationName || 'TRUNG TÂM'}</b></div>
                        <div className="detail-card"><span>TRẠM CỦA TÀI KHOẢN</span><b>{selectedLog.accountStationName || selectedLog.stationName || 'N/A'}</b></div>
                        <div className="detail-card"><span>THỜI GIAN</span><b>{fmtDateTime(selectedLog.ts)}</b></div>
                      </div>
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
