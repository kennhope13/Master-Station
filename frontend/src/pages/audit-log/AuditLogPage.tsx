import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, ChevronLeft, LayoutGrid, Database } from 'lucide-react';
import { stationApi, Station } from '@/services/StationApiService';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';
import { fmtDateTime } from '@/utils/format';
import DateFilterButton from '@/components/ui/DateFilterButton';
import { Province, Team, NotifyLogEntry, RuleTriggerLogEntry } from '@/types/api.types';
import './AuditLogPage.css';

type ModeTab = 'system' | 'alerts';
type SystemFilter = 'all' | 'audit' | 'login';
type AlertFilter = 'all' | 'rule' | 'notify';

interface LogItem {
  ts: string;
  type: 'audit' | 'login' | 'rule' | 'notify';
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
  minWidth = 150
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
    rule_trigger: 'Kích hoạt rule',
    notify: 'Gửi thông báo',
    login: 'Đăng nhập',
    auth: 'Xác thực'
  };

  if (type === 'login') return 'Đăng nhập hệ thống';
  return actionMap[action.toLowerCase()] || `${action.toUpperCase()} ${entityLabel}`;
}

export default function AuditLogPage({ embeddedMode = 'default', stationIdOverride = null }: AuditLogPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMode = (searchParams.get('auditTab') as ModeTab) || 'system';
  const [systemFilter, setSystemFilter] = useState<SystemFilter>('all');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [filterFrom, setFilterFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));
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
  
  const dates = useMemo(() => ({ from: filterFrom, to: filterTo }), [filterFrom, filterTo]);

  useEffect(() => {
    if (isCentralMode) {
      stationApi.getStations().then(setStationsList).catch(console.error);
      stationApi.getProvinces().then(setProvincesList).catch(console.error);
      stationApi.getTeams().then(setTeamsList).catch(console.error);
    }
  }, [isCentralMode]);

  useEffect(() => {
    setSelectedLog(null);
  }, [activeMode, filterStation]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const from = dates.from ? new Date(dates.from).toISOString() : undefined;
    const to = dates.to ? new Date(dates.to + (dates.to.includes('T') ? '' : 'T23:59:59')).toISOString() : undefined;
    try {
      const station = filterStation ? stationsList.find(s => s.id === filterStation) : null;
      const useRemoteStation = !!station?.apiUrl;

      if (activeMode === 'alerts') {
        const params = { from, to, limit: 500, stationId: filterStation || undefined };
        const [ruleTriggers, notifyLogs] = await Promise.all([
          useRemoteStation && filterStation
            ? stationApi.getRemoteRuleTriggerLogs(filterStation, params)
            : stationApi.getRuleTriggerLogs(params),
          useRemoteStation && filterStation
            ? stationApi.getRemoteNotifyLogs(filterStation, params)
            : stationApi.getNotifyLogs(params),
        ]);

        const merged = [
          ...ruleTriggers.map((l: RuleTriggerLogEntry) => ({
            ts: l.triggeredAt,
            type: 'rule' as const,
            action: 'rule_trigger',
            info: l.ruleName || l.deviceName || 'RULE',
            who: 'HỆ THỐNG',
            stationId: l.stationId,
            stationName: l.stationName,
            raw: l
          })),
          ...notifyLogs.map((l: NotifyLogEntry) => ({
            ts: l.sentAt,
            type: 'notify' as const,
            action: 'notify',
            info: l.channel?.toUpperCase() || 'NOTIFY',
            who: l.recipient || 'HỆ THỐNG',
            stationId: l.stationId,
            stationName: l.stationName,
            raw: l
          }))
        ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        setLogs(merged);
      } else {
        const params = { from, to, limit: 500, stationId: filterStation || undefined };
        const [audit, logins] = await Promise.all([stationApi.getAuditLogs(params), stationApi.getLoginLogs(params)]);
        const merged = [
          ...audit.map(l => ({
            ts: l.ts,
            type: 'audit' as const,
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
            type: 'login' as const,
            action: 'auth',
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
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [activeMode, dates, filterStation, stationsList]);

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
    const typeFilter = activeMode === 'system' ? systemFilter : alertFilter;
    let source = typeFilter === 'all' ? logs : logs.filter(l => l.type === typeFilter);
    // Khi chưa chọn trạm cụ thể nhưng đang lọc theo tỉnh/tổ → lọc client-side
    if (!filterStation && filteredStationIds && (filterProvince || filterTeam)) {
      source = source.filter(l => l.stationId ? filteredStationIds.has(l.stationId) : false);
    }
    if (!searchText) return source;
    const q = searchText.toLowerCase();
    return source.filter(l =>
      l.action.toLowerCase().includes(q) ||
      l.info.toLowerCase().includes(q) ||
      l.who.toLowerCase().includes(q) ||
      formatActionLabel(l.type, l.action, l.raw?.entityType).toLowerCase().includes(q) ||
      String(l.raw?.ruleName ?? l.raw?.deviceName ?? l.raw?.recipient ?? '').toLowerCase().includes(q)
    );
  }, [logs, activeMode, systemFilter, alertFilter, searchText, filterStation, filteredStationIds, filterProvince, filterTeam]);

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

  const stationAuditCount = useMemo(() => filtered.filter(l => l.type === 'audit' || l.type === 'rule').length, [filtered]);
  const stationLoginCount = useMemo(() => filtered.filter(l => l.type === 'login' || l.type === 'notify').length, [filtered]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      alert('Không có dữ liệu để xuất CSV');
      return;
    }
    const headers = ['Thời gian', 'Loại', 'Tài khoản', 'Hành động', 'Chi tiết/Đối tượng', 'Trạm'];
    const rows = filtered.map(l => [
      fmtDateTime(l.ts),
      l.type === 'audit' ? 'Hệ thống' : l.type === 'login' ? 'Đăng nhập' : l.type === 'rule' ? 'Rule' : 'Thông báo',
      l.who,
      formatActionLabel(l.type, l.action, l.raw?.entityType),
      l.info,
      l.stationName || 'Trung tâm',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AuditLog_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    if (filtered.length === 0) {
      alert('Không có dữ liệu để xuất XLSX');
      return;
    }
    const rows = filtered.map(l => ({
      'Thời gian': fmtDateTime(l.ts),
      'Loại': l.type === 'audit' ? 'Hệ thống' : l.type === 'login' ? 'Đăng nhập' : l.type === 'rule' ? 'Rule' : 'Thông báo',
      'Tài khoản': l.who,
      'Hành động': formatActionLabel(l.type, l.action, l.raw?.entityType),
      'Chi tiết/Đối tượng': l.info,
      'Trạm': l.stationName || 'Trung tâm',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 28 }, { wch: 24 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, 'AuditLog');
    XLSX.writeFile(wb, `AuditLog_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportPdf = () => {
    if (filtered.length === 0) {
      alert('Không có dữ liệu để xuất PDF');
      return;
    }
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) return;
    const rowsHtml = filtered.map(l => `
      <tr>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;white-space:nowrap;">${fmtDateTime(l.ts)}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;">${l.type === 'audit' ? 'Hệ thống' : l.type === 'login' ? 'Đăng nhập' : l.type === 'rule' ? 'Rule' : 'Thông báo'}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;">${l.who}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;">${formatActionLabel(l.type, l.action, l.raw?.entityType)}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;">${l.info}</td>
        <td style="padding:6px 8px;border:1px solid #e5e7eb;">${l.stationName || 'Trung tâm'}</td>
      </tr>
    `).join('');
    win.document.write(`
      <!DOCTYPE html><html><head><title>Nhật ký hệ thống</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f3f4f6; padding: 8px; border: 1px solid #e5e7eb; text-align: left; font-size: 11px; }
      </style></head><body>
      <h2>NHẬT KÝ HỆ THỐNG</h2>
      <div>Thời gian xuất: <b>${new Date().toLocaleString('vi-VN')}</b> | Số dòng: <b>${filtered.length}</b></div>
      <table>
        <thead><tr><th>Thời gian</th><th>Loại</th><th>Tài khoản</th><th>Hành động</th><th>Chi tiết/Đối tượng</th><th>Trạm</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  return (
    <div className="rtm-page industrial-theme">
      <header className="rtm-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginRight: 10 }}>
          <span 
            onClick={() => setSearchParams(prev => { prev.set('auditTab', 'alerts'); return prev; })}
            style={{ 
              fontSize: '0.75rem', 
              fontWeight: 900, 
              color: activeMode === 'alerts' ? 'var(--admin-accent, #00ebc7)' : 'var(--admin-text-muted, #64748b)',
              cursor: 'pointer', 
              paddingBottom: 2, 
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              transition: 'color 0.2s',
              borderBottom: activeMode === 'alerts' ? '2px solid var(--admin-accent, #00ebc7)' : 'none'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--admin-text, #f1f5f9)'}
            onMouseLeave={(e) => e.currentTarget.style.color = activeMode === 'alerts' ? 'var(--admin-accent, #00ebc7)' : 'var(--admin-text-muted, #64748b)'}
          >
            NHẬT KÝ CẢNH BÁO
          </span>
          <span 
            onClick={() => setSearchParams(prev => { prev.set('auditTab', 'system'); return prev; })}
            style={{ 
              fontSize: '0.75rem', 
              fontWeight: 900, 
              color: activeMode === 'system' ? 'var(--admin-accent, #00ebc7)' : 'var(--admin-text-muted, #64748b)',
              borderBottom: activeMode === 'system' ? '2px solid var(--admin-accent, #00ebc7)' : 'none',
              paddingBottom: 2, 
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              cursor: 'pointer'
            }}
          >
            NHẬT KÝ HỆ THỐNG
          </span>
        </div>
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
             value={activeMode === 'system' ? systemFilter : alertFilter}
             onChange={value => {
               if (activeMode === 'system') setSystemFilter(value as SystemFilter);
               else setAlertFilter(value as AlertFilter);
             }}
             options={activeMode === 'system'
               ? [
                   { value: 'all', label: 'TẤT CẢ' },
                   { value: 'audit', label: 'HÀNH ĐỘNG' },
                   { value: 'login', label: 'ĐĂNG NHẬP' }
                 ]
               : [
                   { value: 'all', label: 'TẤT CẢ' },
                   { value: 'rule', label: 'KÍCH HOẠT RULE' },
                   { value: 'notify', label: 'THÔNG BÁO' }
                 ]}
           />
           <DateFilterButton
             from={filterFrom}
             to={filterTo}
             onApply={(f, t) => { setFilterFrom(f); setFilterTo(t); }}
             showAll
             style={{ height: 28 }}
           />
           <button className="nvr-lb" title="Làm mới dữ liệu" onClick={loadData}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
           <button className="nvr-lb" title="Xuất XLSX" onClick={exportXlsx} style={{ width: 'auto', padding: '0 8px', fontSize: 10 }}>XLSX</button>
           <button className="nvr-lb" title="Xuất CSV" onClick={exportCsv} style={{ width: 'auto', padding: '0 8px', fontSize: 10 }}>CSV</button>
           <button className="nvr-lb" title="Xuất PDF" onClick={exportPdf} style={{ width: 'auto', padding: '0 8px', fontSize: 10 }}>PDF</button>
        </div>
      </header>

      {isCentralMode && (
        <div className="audit-filter-bar">
          <span className="audit-filter-label">TỈNH</span>
          <AuditFilterDropdown
            value={filterProvince}
            minWidth={160}
            onChange={v => { setFilterProvince(v); setFilterTeam(''); setFilterStation(''); }}
            options={[
              { value: '', label: 'TẤT CẢ TỈNH' },
              ...provincesList.map(p => ({ value: p.id, label: p.name.toUpperCase() }))
            ]}
          />
          <span className="audit-filter-label">TỔ</span>
          <AuditFilterDropdown
            value={filterTeam}
            minWidth={160}
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
            minWidth={200}
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
                          <div><span>{activeMode === 'system' ? 'AUDIT' : 'RULE'}</span><b>{activeMode === 'system' ? group.items.filter(i => i.type === 'audit').length : group.items.filter(i => i.type === 'rule').length}</b></div>
                          <div><span>{activeMode === 'system' ? 'LOGIN' : 'NOTIFY'}</span><b>{activeMode === 'system' ? group.items.filter(i => i.type === 'login').length : group.items.filter(i => i.type === 'notify').length}</b></div>
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          ) : (
            <div className="nvr-log-area">
              <div className="station-detail-head">
                <div>
                  <div className="station-detail-kicker">{activeMode === 'system' ? 'NHẬT KÝ TRẠM' : 'NHẬT KÝ CẢNH BÁO TRẠM'}</div>
                  <div className="station-detail-name">{selectedStationInfo?.name || filtered[0]?.stationName || 'TRUNG TÂM'}</div>
                </div>
                <div className="station-detail-stats">
                  <div className="station-detail-stat">
                    <span>TỔNG</span>
                    <b>{filtered.length}</b>
                  </div>
                  <div className="station-detail-stat">
                    <span>{activeMode === 'system' ? 'HÀNH ĐỘNG' : 'RULE'}</span>
                    <b>{stationAuditCount}</b>
                  </div>
                  <div className="station-detail-stat">
                    <span>{activeMode === 'system' ? 'ĐĂNG NHẬP' : 'THÔNG BÁO'}</span>
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

                      {activeMode === 'alerts' ? (
                        <div className="detail-grid">
                          {selectedLog.type === 'rule' ? (
                            <>
                              <div className="detail-card"><span>RULE</span><b>{selectedLog.raw?.ruleName || selectedLog.info}</b></div>
                              <div className="detail-card"><span>THIẾT BỊ</span><b>{selectedLog.raw?.deviceName || '—'}</b></div>
                              <div className="detail-card"><span>GIÁ TRỊ</span><b>{selectedLog.raw?.valueAtTrigger ?? '—'}</b></div>
                              <div className="detail-card"><span>TRẠM</span><b>{selectedLog.stationName || 'TRUNG TÂM'}</b></div>
                              <div className="detail-card"><span>ĐIỀU KIỆN</span><b>{selectedLog.raw?.conditionSnapshot || '—'}</b></div>
                              <div className="detail-card"><span>THỜI GIAN</span><b>{fmtDateTime(selectedLog.ts)}</b></div>
                            </>
                          ) : (
                            <>
                              <div className="detail-card"><span>KÊNH</span><b>{selectedLog.raw?.channel || selectedLog.info}</b></div>
                              <div className="detail-card"><span>NGƯỜI NHẬN</span><b>{selectedLog.raw?.recipient || selectedLog.who}</b></div>
                              <div className="detail-card"><span>TRẠNG THÁI</span><b>{selectedLog.raw?.status || '—'}</b></div>
                              <div className="detail-card"><span>TRẠM</span><b>{selectedLog.stationName || 'TRUNG TÂM'}</b></div>
                              <div className="detail-card"><span>LỖI</span><b>{selectedLog.raw?.errorMessage || '—'}</b></div>
                              <div className="detail-card"><span>THỜI GIAN</span><b>{fmtDateTime(selectedLog.ts)}</b></div>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="detail-grid">
                          <div className="detail-card"><span>ĐỐI TƯỢNG</span><b>{selectedLog.info}</b></div>
                          <div className="detail-card"><span>THAO TÁC GỐC</span><b>{selectedLog.action}</b></div>
                          <div className="detail-card"><span>THỰC HIỆN</span><b>{selectedLog.who}</b></div>
                          <div className="detail-card"><span>TRẠM BỊ TÁC ĐỘNG</span><b>{selectedLog.stationName || 'TRUNG TÂM'}</b></div>
                          <div className="detail-card"><span>TRẠM CỦA TÀI KHOẢN</span><b>{selectedLog.accountStationName || selectedLog.stationName || 'N/A'}</b></div>
                          <div className="detail-card"><span>THỜI GIAN</span><b>{fmtDateTime(selectedLog.ts)}</b></div>
                        </div>
                      )}
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
