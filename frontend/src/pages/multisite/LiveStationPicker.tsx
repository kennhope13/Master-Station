import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ArrowRight, Wifi, WifiOff, AlertTriangle, Monitor,
  Cpu, Activity, LayoutGrid, List, Layers, ChevronDown, ChevronRight,
  MapPin, Users,
} from 'lucide-react';
import type { StationView } from './types';
import type { Province, Team } from '@/types/api.types';

interface Props {
  views: StationView[];
  provinces: Province[];
  teams: Team[];
  onOpenStation: (station: StationView['station']) => void;
}

type ViewMode = 'group' | 'list' | 'grid';

export default function LiveStationPicker({ views, provinces, teams }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('live_picker_view') as ViewMode) || 'group'
  );

  const setMode = (m: ViewMode) => {
    setViewMode(m);
    localStorage.setItem('live_picker_view', m);
  };

  const online  = views.filter(v => v.station.connectionStatus === 'online').length;
  const offline = views.length - online;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--admin-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        flexShrink: 0, height: 40,
        borderBottom: '1px solid var(--admin-border)',
        background: 'var(--admin-panel)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 12,
      }}>
        <Monitor size={13} style={{ color: 'var(--admin-accent)' }} />
        <span style={{ fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--admin-text)' }}>
          TRỰC TIẾP — CHỌN TRẠM
        </span>
        <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)' }}>({views.length} trạm)</span>
        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#10b981' }}>● {online} online</span>
        {offline > 0 && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#6b7280' }}>● {offline} offline</span>}

        {/* View toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([
            { m: 'group', icon: <Layers size={13} />, title: 'Theo Tỉnh / Tổ / Trạm' },
            { m: 'list',  icon: <List size={13} />,   title: 'Danh sách' },
            { m: 'grid',  icon: <LayoutGrid size={13} />, title: 'Dạng lưới' },
          ] as { m: ViewMode; icon: ReactNode; title: string }[]).map(({ m, icon, title }) => (
            <button key={m} onClick={() => setMode(m)} title={title} style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: viewMode === m ? 'var(--admin-accent)' : 'var(--admin-overlay)',
              border: '1px solid ' + (viewMode === m ? 'var(--admin-accent)' : 'var(--admin-border)'),
              borderRadius: 4, cursor: 'pointer',
              color: viewMode === m ? '#fff' : 'var(--admin-text-muted)',
            }}>
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {views.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: 'var(--admin-text-muted)' }}>
            <Monitor size={36} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: '0.78rem' }}>Chưa có trạm nào được cấu hình</span>
          </div>
        )}
        {viewMode === 'group' && <GroupView views={views} provinces={provinces} teams={teams} />}
        {viewMode === 'list'  && <ListView  views={views} />}
        {viewMode === 'grid'  && <GridView  views={views} />}
      </div>
    </div>
  );
}

/* ── GROUP VIEW — Tỉnh → Tổ → Trạm ────────────────────────── */
function GroupView({ views, provinces, teams }: { views: StationView[]; provinces: Province[]; teams: Team[] }) {
  const [collapsedProvinces, setCollapsedProvinces] = useState<Set<string>>(new Set());
  const [collapsedTeams,     setCollapsedTeams]     = useState<Set<string>>(new Set());

  const toggleProvince = (id: string) => setCollapsedProvinces(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTeam     = (id: string) => setCollapsedTeams(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Build: provinceId → province name
  const provMap = Object.fromEntries(provinces.map(p => [p.id, p.name]));

  // Group views by provinceId
  const byProvince = new Map<string, StationView[]>();
  for (const v of views) {
    const pid = v.station.provinceId ?? '__none__';
    if (!byProvince.has(pid)) byProvince.set(pid, []);
    byProvince.get(pid)!.push(v);
  }

  // Sort: provinces first (by name), then __none__ last
  const provinceEntries = [...byProvince.entries()].sort(([a], [b]) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return (provMap[a] ?? '').localeCompare(provMap[b] ?? '', 'vi');
  });

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {provinceEntries.map(([pid, pViews]) => {
        const provinceName = pid === '__none__' ? 'Chưa phân tỉnh' : (provMap[pid] ?? pid.slice(0, 8));
        const collapsed    = collapsedProvinces.has(pid);
        const onlineCount  = pViews.filter(v => v.station.connectionStatus === 'online').length;
        const alarmCount   = pViews.reduce((s, v) => s + v.kpi.alarmsCount, 0);

        // Group stations in this province by team
        const byTeam = new Map<string, StationView[]>();
        for (const v of pViews) {
          const team = teams.find(t => t.stationIds?.includes(v.station.id));
          const tid  = team?.id ?? '__none__';
          if (!byTeam.has(tid)) byTeam.set(tid, [{ ...v, _teamName: team?.name } as any]);
          else byTeam.get(tid)!.push({ ...v, _teamName: team?.name } as any);
        }

        // Sort: teams first (by name), then __none__ last
        const teamEntries = [...byTeam.entries()].sort(([a], [b]) => {
          if (a === '__none__') return 1;
          if (b === '__none__') return -1;
          const na = teams.find(t => t.id === a)?.name ?? '';
          const nb = teams.find(t => t.id === b)?.name ?? '';
          return na.localeCompare(nb, 'vi');
        });

        return (
          <div key={pid} style={{ border: '1px solid var(--admin-border)', borderRadius: 6, overflow: 'hidden' }}>
            {/* Province header */}
            <div
              onClick={() => toggleProvince(pid)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 14px', cursor: 'pointer',
                background: 'var(--admin-layer-2, #1e293b)',
                borderBottom: collapsed ? 'none' : '1px solid var(--admin-border)',
                userSelect: 'none',
              }}
            >
              {collapsed ? <ChevronRight size={14} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />
                         : <ChevronDown  size={14} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />}
              <MapPin size={12} style={{ color: 'var(--admin-accent)', flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: '0.72rem', color: 'var(--admin-accent)', flex: 1 }}>
                {provinceName}
              </span>
              <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)', marginLeft: 'auto' }}>
                {pViews.length} trạm
              </span>
              <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--admin-success)', marginLeft: 10 }}>
                {onlineCount} online
              </span>
              {alarmCount > 0 && (
                <span style={{ fontSize: '0.58rem', fontWeight: 800, color: 'var(--admin-danger)', marginLeft: 8 }}>
                  ● {alarmCount} BĐ
                </span>
              )}
            </div>

            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {teamEntries.map(([tid, tViews]) => {
                  const teamName    = tid === '__none__' ? 'Chưa có tổ' : (teams.find(t => t.id === tid)?.name ?? tid.slice(0, 8));
                  const tCollapsed  = collapsedTeams.has(tid + pid);
                  const tOnline     = tViews.filter(v => v.station.connectionStatus === 'online').length;
                  const tAlarm      = tViews.reduce((s, v) => s + v.kpi.alarmsCount, 0);

                  return (
                    <div key={tid}>
                      {/* Team sub-header */}
                      <div
                        onClick={() => toggleTeam(tid + pid)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 14px 7px 32px', cursor: 'pointer',
                          background: 'var(--admin-layer-1)',
                          borderBottom: '1px solid var(--admin-border)',
                          userSelect: 'none',
                        }}
                      >
                        {tCollapsed ? <ChevronRight size={12} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />
                                    : <ChevronDown  size={12} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />}
                        <Users size={11} style={{ color: 'var(--admin-warning)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: '0.65rem', color: 'var(--admin-warning)', flex: 1 }}>
                          {teamName}
                        </span>
                        <span style={{ fontSize: '0.56rem', color: 'var(--admin-text-muted)' }}>
                          {tViews.length} trạm
                        </span>
                        <span style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--admin-success)', marginLeft: 8 }}>
                          {tOnline} online
                        </span>
                        {tAlarm > 0 && (
                          <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--admin-danger)', marginLeft: 8 }}>
                            ● {tAlarm} BĐ
                          </span>
                        )}
                      </div>

                      {/* Station rows */}
                      {!tCollapsed && tViews.map((v, i) => (
                        <StationRow key={v.station.id} v={v} indent={52} last={i === tViews.length - 1} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StationRow({ v, indent, last }: { v: StationView; indent: number; last: boolean }) {
  const online     = v.station.connectionStatus === 'online';
  const hasAlarm   = v.kpi.alarmsCount > 0;
  const hasWarning = v.kpi.warningsCount > 0;

  return (
    <div
      onClick={() => window.open(`/live-camera?stationId=${encodeURIComponent(v.station.id)}`, `station_${v.station.id}`, 'noopener,noreferrer,width=1440,height=900')}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: `7px 14px 7px ${indent}px`,
        borderBottom: last ? 'none' : '1px solid var(--admin-border)',
        cursor: 'pointer',
        background: hasAlarm ? 'rgba(var(--admin-danger-rgb,239,68,68),0.05)' : 'transparent',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = hasAlarm ? 'rgba(var(--admin-danger-rgb,239,68,68),0.05)' : 'transparent'}
    >
      {/* Status dot */}
      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: online ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: online ? '0 0 5px var(--admin-success)' : 'none' }} />
      {online ? <Wifi size={11} style={{ color: 'var(--admin-success)', flexShrink: 0 }} />
              : <WifiOff size={11} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />}

      {/* Code */}
      <span style={{ fontFamily: 'var(--admin-font-mono)', fontWeight: 900, fontSize: '0.63rem', color: 'var(--admin-accent)', flexShrink: 0, width: 80 }}>
        {v.station.code || v.station.id.slice(0, 8).toUpperCase()}
      </span>

      {/* Name */}
      <span style={{ fontWeight: 600, fontSize: '0.68rem', color: 'var(--admin-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v.station.name}
      </span>

      {/* KPI chips */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0, alignItems: 'center' }}>
        <MiniKpi icon={<Cpu size={9} />} value={`${v.kpi.devicesOnline}/${v.kpi.devicesTotal}`} muted={v.kpi.devicesOnline === 0} />
        <MiniKpi icon={<AlertTriangle size={9} />} value={v.kpi.alerts > 0 ? `⚠ ${v.kpi.alerts}` : '—'} warn={v.kpi.alerts > 0} />
        <MiniKpi icon={<Activity size={9} />} value={v.kpi.alarmsCount > 0 ? `🔴 ${v.kpi.alarmsCount}` : '—'} danger={v.kpi.alarmsCount > 0} />
      </div>

      <ArrowRight size={12} style={{ color: 'var(--admin-text-muted)', opacity: 0.4, flexShrink: 0 }} />
    </div>
  );
}

function MiniKpi({ icon, value, muted, warn, danger }: { icon: ReactNode; value: string; muted?: boolean; warn?: boolean; danger?: boolean }) {
  const color = danger ? 'var(--admin-danger)' : warn ? 'var(--admin-warning)' : muted ? 'var(--admin-text-muted)' : 'var(--admin-text)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      {icon}
      <span style={{ fontFamily: 'var(--admin-font-mono)', fontSize: '0.62rem', fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/* ── LIST VIEW ──────────────────────────────────────────────── */
function ListView({ views }: { views: StationView[] }) {
  const th: React.CSSProperties = {
    padding: '7px 12px', textAlign: 'left' as const,
    fontSize: '0.55rem', fontWeight: 900, letterSpacing: '0.08em',
    color: 'var(--admin-text-muted)', borderBottom: '1px solid var(--admin-border)',
    whiteSpace: 'nowrap' as const, background: 'var(--admin-panel)',
    position: 'sticky' as const, top: 0, zIndex: 1,
  };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 90 }} />
        <col style={{ width: 100 }} />
        <col />
        <col style={{ width: 90 }} />
        <col style={{ width: 80 }} />
        <col style={{ width: 80 }} />
        <col style={{ width: 36 }} />
      </colgroup>
      <thead>
        <tr>
          <th style={th}>TRẠNG THÁI</th>
          <th style={th}>MÃ TRẠM</th>
          <th style={th}>TÊN TRẠM</th>
          <th style={{ ...th, textAlign: 'center' as const }}>THIẾT BỊ</th>
          <th style={{ ...th, textAlign: 'center' as const }}>CẢNH BÁO</th>
          <th style={{ ...th, textAlign: 'center' as const }}>BÁO ĐỘNG</th>
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {views.map((v, i) => {
          const online     = v.station.connectionStatus === 'online';
          const hasAlarm   = v.kpi.alarmsCount > 0;
          const hasWarning = v.kpi.warningsCount > 0;
          const accentBg   = hasAlarm ? 'rgba(239,68,68,0.06)' : hasWarning ? 'rgba(245,158,11,0.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';
          const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.68rem', background: accentBg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
          return (
            <tr key={v.station.id} style={{ cursor: 'pointer' }}
              onClick={() => window.open(`/live-camera?stationId=${encodeURIComponent(v.station.id)}`, `station_${v.station.id}`, 'noopener,noreferrer,width=1440,height=900')}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.07)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
            >
              <td style={td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: online ? '0 0 5px var(--admin-success)' : 'none' }} />
                  {online ? <Wifi size={11} style={{ color: 'var(--admin-success)' }} /> : <WifiOff size={11} style={{ color: 'var(--admin-text-muted)' }} />}
                  <span style={{ fontWeight: 800, fontSize: '0.6rem', color: online ? 'var(--admin-success)' : 'var(--admin-text-muted)' }}>{online ? 'ONLINE' : 'OFFLINE'}</span>
                </div>
              </td>
              <td style={{ ...td, fontFamily: 'var(--admin-font-mono)', fontWeight: 900, fontSize: '0.65rem', color: 'var(--admin-accent)' }}>{v.station.code || v.station.id.slice(0, 8)}</td>
              <td style={{ ...td, fontWeight: 600, color: 'var(--admin-text)' }} title={v.station.name}>{v.station.name}</td>
              <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--admin-font-mono)', fontWeight: 800, color: v.kpi.devicesOnline > 0 ? 'var(--admin-text)' : 'var(--admin-text-muted)' }}>{v.kpi.devicesOnline}<span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>/{v.kpi.devicesTotal}</span></td>
              <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--admin-font-mono)', fontWeight: 800, color: v.kpi.alerts > 0 ? 'var(--admin-warning)' : 'var(--admin-text-muted)' }}>{v.kpi.alerts > 0 ? `⚠ ${v.kpi.alerts}` : '—'}</td>
              <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--admin-font-mono)', fontWeight: 800, color: v.kpi.alarmsCount > 0 ? 'var(--admin-danger)' : 'var(--admin-text-muted)' }}>{v.kpi.alarmsCount > 0 ? `● ${v.kpi.alarmsCount}` : '—'}</td>
              <td style={{ ...td, textAlign: 'center', padding: '8px 6px' }}><ArrowRight size={13} style={{ color: 'var(--admin-text-muted)', opacity: 0.5 }} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── GRID VIEW ──────────────────────────────────────────────── */
function GridView({ views }: { views: StationView[] }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, alignContent: 'start' }}>
      {views.map(v => {
        const online     = v.station.connectionStatus === 'online';
        const hasAlarm   = v.kpi.alarmsCount > 0;
        const hasWarning = v.kpi.warningsCount > 0;
        const borderColor = !online ? 'var(--admin-border)' : hasAlarm ? 'var(--admin-danger)' : hasWarning ? 'var(--admin-warning)' : 'var(--admin-success)';
        return (
          <button key={v.station.id}
            onClick={() => window.open(`/live-camera?stationId=${encodeURIComponent(v.station.id)}`, `station_${v.station.id}`, 'noopener,noreferrer,width=1440,height=900')}
            style={{ position: 'relative', background: 'var(--admin-panel)', border: `1px solid ${borderColor}`, borderRadius: 6, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, transition: 'all 0.18s', outline: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: online ? '0 0 6px var(--admin-success)' : 'none' }} />
                {online ? <Wifi size={11} style={{ color: 'var(--admin-success)' }} /> : <WifiOff size={11} style={{ color: 'var(--admin-text-muted)' }} />}
                <span style={{ fontSize: '0.58rem', fontWeight: 900, color: online ? 'var(--admin-success)' : 'var(--admin-text-muted)', letterSpacing: '0.07em' }}>{online ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              <ArrowRight size={12} style={{ color: 'var(--admin-text-muted)', opacity: 0.6 }} />
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 900, fontFamily: 'var(--admin-font-mono)', color: 'var(--admin-accent)', marginBottom: 3 }}>{v.station.code || v.station.id.slice(0, 8)}</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text)', lineHeight: 1.3 }}>{v.station.name}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <KpiChip icon={<Cpu size={9} />} label="Thiết bị" value={`${v.kpi.devicesOnline}/${v.kpi.devicesTotal}`} ok={v.kpi.devicesOnline > 0} />
              <KpiChip icon={<AlertTriangle size={9} />} label="Cảnh báo" value={String(v.kpi.alerts)} danger={v.kpi.alerts > 0} />
              <KpiChip icon={<Activity size={9} />} label="Báo động" value={String(v.kpi.alarmsCount)} danger={v.kpi.alarmsCount > 0} />
            </div>
            {(hasAlarm || hasWarning) && (
              <div style={{ position: 'absolute', top: 10, right: 36, fontSize: '0.52rem', fontWeight: 900, padding: '1px 5px', background: hasAlarm ? 'var(--admin-tag-danger-bg)' : 'var(--admin-tag-warning-bg)', color: hasAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)', border: `1px solid ${hasAlarm ? 'var(--admin-danger)' : 'var(--admin-warning)'}`, borderRadius: 2, opacity: 0.9 }}>
                {hasAlarm ? `● ${v.kpi.alarmsCount} BĐ` : `⚠ ${v.kpi.warningsCount} CB`}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function KpiChip({ icon, label, value, ok, danger }: { icon: ReactNode; label: string; value: string; ok?: boolean; danger?: boolean }) {
  const color = danger ? 'var(--admin-danger)' : ok === false ? '#6b7280' : 'var(--admin-text)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--admin-overlay)', borderRadius: 4, padding: '4px 7px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--admin-text-muted)' }}>
        {icon}
        <span style={{ fontSize: '0.48rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{label.toUpperCase()}</span>
      </div>
      <span style={{ fontSize: '0.72rem', fontWeight: 900, fontFamily: 'var(--admin-font-mono)', color }}>{value}</span>
    </div>
  );
}
