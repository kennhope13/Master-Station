import type { ReactNode } from 'react';
import { ArrowRight, Wifi, WifiOff, AlertTriangle, Monitor, Cpu, Activity } from 'lucide-react';
import type { StationView } from './types';

interface Props {
  views: StationView[];
  onOpenStation: (station: StationView['station']) => void;
}

export default function LiveStationPicker({ views }: Props) {

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'var(--admin-bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, height: 40,
        borderBottom: '1px solid var(--admin-border)',
        background: 'var(--admin-panel)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 10
      }}>
        <Monitor size={13} style={{ color: 'var(--admin-accent)' }} />
        <span style={{ fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--admin-text)' }}>
          TRỰC TIẾP — CHỌN TRẠM
        </span>
        <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)', marginLeft: 4 }}>
          ({views.length} trạm)
        </span>
      </div>

      {/* Station grid */}
      <div style={{
        flex: 1, overflow: 'auto',
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
        alignContent: 'start'
      }}>
        {views.length === 0 && (
          <div style={{
            gridColumn: '1/-1',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: 200, gap: 10, color: 'var(--admin-text-muted)'
          }}>
            <Monitor size={36} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: '0.78rem' }}>Chưa có trạm nào được cấu hình</span>
          </div>
        )}

        {views.map(v => {
          const online = v.station.connectionStatus === 'online';
          const hasAlarm = v.kpi.alarmsCount > 0;
          const hasWarning = v.kpi.warningsCount > 0;
          const borderColor = !online
            ? 'rgba(107,114,128,0.4)'
            : hasAlarm
            ? 'rgba(239,68,68,0.45)'
            : hasWarning
            ? 'rgba(245,158,11,0.4)'
            : 'rgba(16,185,129,0.3)';

          const glowColor = !online ? 'none'
            : hasAlarm ? '0 0 6px rgba(239,68,68,0.12)'
            : hasWarning ? '0 0 6px rgba(245,158,11,0.1)'
            : '0 0 6px rgba(16,185,129,0.08)';

          return (
            <button
              key={v.station.id}
              onClick={() => window.open(`/live-camera?stationId=${encodeURIComponent(v.station.id)}`, `station_${v.station.id}`, 'noopener,noreferrer,width=1440,height=900')}
              title={`Xem trực tiếp ${v.station.name}`}
              style={{
                position: 'relative',
                background: 'var(--admin-panel)',
                border: `1px solid ${borderColor}`,
                borderRadius: 6,
                boxShadow: glowColor,
                padding: '14px 16px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'all 0.18s',
                outline: 'none'
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.borderColor = online
                  ? hasAlarm ? 'rgba(239,68,68,0.65)'
                  : hasWarning ? 'rgba(245,158,11,0.55)'
                  : 'rgba(16,185,129,0.45)'
                  : 'rgba(107,114,128,0.5)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.borderColor = borderColor;
              }}
            >
              {/* Status dot + ExternalLink icon */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: online ? 'var(--admin-success)' : 'var(--admin-danger)',
                    boxShadow: online ? '0 0 6px var(--admin-success)' : 'none'
                  }} />
                  {online
                    ? <Wifi size={11} style={{ color: 'var(--admin-success)' }} />
                    : <WifiOff size={11} style={{ color: '#6b7280' }} />
                  }
                  <span style={{
                    fontSize: '0.58rem', fontWeight: 900,
                    color: online ? 'var(--admin-success)' : '#6b7280',
                    letterSpacing: '0.07em'
                  }}>
                    {online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
                <ArrowRight size={12} style={{ color: 'var(--admin-text-muted)', opacity: 0.6 }} />
              </div>

              {/* Station name + code */}
              <div>
                <div style={{
                  fontSize: '0.62rem', fontWeight: 900, fontFamily: 'monospace',
                  color: 'var(--admin-accent)', letterSpacing: '0.06em', marginBottom: 3
                }}>
                  {v.station.code || v.station.id.slice(0, 8).toUpperCase()}
                </div>
                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: 'var(--admin-text)',
                  lineHeight: 1.3
                }}>
                  {v.station.name}
                </div>
              </div>

              {/* KPI row */}
              <div style={{ display: 'flex', gap: 10 }}>
                <KpiChip
                  icon={<Cpu size={9} />}
                  label="Thiết bị"
                  value={`${v.kpi.devicesOnline}/${v.kpi.devicesTotal}`}
                  ok={v.kpi.devicesOnline > 0}
                />
                <KpiChip
                  icon={<AlertTriangle size={9} />}
                  label="Cảnh báo"
                  value={String(v.kpi.alerts)}
                  danger={v.kpi.alerts > 0}
                />
                <KpiChip
                  icon={<Activity size={9} />}
                  label="Báo động"
                  value={String(v.kpi.alarmsCount)}
                  danger={v.kpi.alarmsCount > 0}
                />
              </div>

              {/* Alert badge */}
              {(hasAlarm || hasWarning) && (
                <div style={{
                  position: 'absolute', top: 10, right: 36,
                  fontSize: '0.52rem', fontWeight: 900, padding: '1px 5px',
                  background: hasAlarm ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.15)',
                  color: hasAlarm ? '#ff4444' : 'var(--admin-accent)',
                  border: `1px solid ${hasAlarm ? 'rgba(239,68,68,0.5)' : 'rgba(245,158,11,0.4)'}`,
                  borderRadius: 2
                }}>
                  {hasAlarm ? `🔴 ${v.kpi.alarmsCount} BĐ` : `⚠ ${v.kpi.warningsCount} CB`}
                </div>
              )}

            </button>
          );
        })}
      </div>
    </div>
  );
}

function KpiChip({ icon, label, value, ok, danger }: {
  icon: ReactNode; label: string; value: string; ok?: boolean; danger?: boolean;
}) {
  const color = danger ? 'var(--admin-danger)' : ok === false ? '#6b7280' : 'var(--admin-text)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      background: 'var(--admin-overlay)', borderRadius: 4,
      padding: '4px 7px', flex: 1, minWidth: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--admin-text-muted)' }}>
        {icon}
        <span style={{ fontSize: '0.48rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
          {label.toUpperCase()}
        </span>
      </div>
      <span style={{ fontSize: '0.72rem', fontWeight: 900, fontFamily: 'monospace', color }}>
        {value}
      </span>
    </div>
  );
}
