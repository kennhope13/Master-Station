import { useState } from 'react';
import { Video, Wifi, AlertTriangle, Activity, Monitor, ExternalLink } from 'lucide-react';
import type { StationView } from './types';
import type { Station } from '@/types/api.types';

interface Props {
  views: StationView[];
  onOpenStation: (station: Station) => void;
}

export default function LiveStationPicker({ views, onOpenStation }: Props) {
  const totalAlerts = views.reduce((s, v) => s + v.kpi.alerts, 0);
  const totalOnline = views.reduce((s, v) => s + v.kpi.devicesOnline, 0);
  const totalDevices = views.reduce((s, v) => s + v.kpi.devicesTotal, 0);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'var(--admin-bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Scanline overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)',
      }} />

      {/* Header */}
      <div style={{
        position: 'relative', zIndex: 1, flexShrink: 0,
        borderBottom: '1px solid var(--admin-border)',
        padding: '14px 28px 12px',
        background: 'var(--admin-panel)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 4, height: 20, background: 'var(--admin-accent)', borderRadius: 2 }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              TRỰC TIẾP / CHỌN TRẠM
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: 'var(--admin-text)', letterSpacing: '-0.02em', paddingLeft: 12 }}>
            Giám sát trực tiếp
          </h2>
          <p style={{ margin: '2px 0 0 12px', fontSize: '0.68rem', color: 'var(--admin-text-muted)' }}>
            Chọn trạm để vào màn hình giám sát của trạm đó
          </p>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <KpiChip icon={<Monitor size={13} />} label="TRẠM" value={String(views.length)} />
          <KpiChip icon={<Wifi size={13} />} label="THIẾT BỊ ONLINE" value={`${totalOnline}/${totalDevices}`} />
          <KpiChip icon={<AlertTriangle size={13} />} label="CẢNH BÁO" value={String(totalAlerts)} danger={totalAlerts > 0} />
        </div>
      </div>

      {/* Station grid */}
      <div style={{
        flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1,
        padding: '24px 28px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16, alignContent: 'start'
      }}>
        {views.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center',
            padding: '60px 0', color: 'var(--admin-text-muted)', fontSize: '0.75rem'
          }}>
            Chưa có trạm nào được cấu hình
          </div>
        )}
        {views.map(v => (
          <StationLiveCard
            key={v.station.id}
            view={v}
            onSelect={() => onOpenStation(v.station)}
          />
        ))}
      </div>
    </div>
  );
}

function KpiChip({ icon, label, value, danger = false }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: danger ? 'var(--admin-danger)' : 'var(--admin-text-muted)' }}>
        {icon}
        <span style={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <span style={{ fontSize: '1rem', fontWeight: 900, lineHeight: 1, color: danger ? 'var(--admin-danger)' : 'var(--admin-text)', fontFamily: 'monospace' }}>
        {value}
      </span>
    </div>
  );
}

function StationLiveCard({ view, onSelect }: { view: StationView; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  const { station, kpi } = view;
  const hasAlert = kpi.alerts > 0;
  const uptimeRatio = kpi.devicesTotal > 0 ? kpi.devicesOnline / kpi.devicesTotal : 1;
  const hasUrl = !!station.apiUrl;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--admin-layer-2, #1e2227)' : 'var(--admin-panel)',
        border: `1px solid ${hasAlert ? 'rgba(239,68,68,0.5)' : hovered ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        transition: 'all 0.18s ease',
        boxShadow: hovered
          ? '0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)'
          : hasAlert ? '0 0 16px rgba(239,68,68,0.18)' : '0 2px 8px rgba(0,0,0,0.18)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        position: 'relative', overflow: 'hidden',
        opacity: hasUrl ? 1 : 0.55,
      }}
    >
      {/* Top accent bar */}
      <div style={{
        height: 3,
        background: hasAlert
          ? 'linear-gradient(90deg, var(--admin-danger), transparent)'
          : hovered ? 'linear-gradient(90deg, var(--admin-accent), transparent)' : 'transparent',
        transition: 'background 0.2s'
      }} />

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Identity */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--admin-accent)', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 3 }}>
              {station.code || '—'}
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--admin-text)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {station.name}
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
            background: hasAlert ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.08)',
            border: `1px solid ${hasAlert ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.2)'}`,
            flexShrink: 0, marginLeft: 8
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              background: hasAlert ? 'var(--admin-danger)' : 'var(--admin-success)',
              boxShadow: `0 0 5px ${hasAlert ? 'var(--admin-danger)' : 'var(--admin-success)'}`,
              animation: hasAlert ? 'pulse-red-dot 1.2s infinite' : 'none'
            }} />
            <span style={{ fontSize: '0.55rem', fontWeight: 900, color: hasAlert ? 'var(--admin-danger)' : 'var(--admin-success)' }}>
              {hasAlert ? `${kpi.alerts} LỖI` : 'BT'}
            </span>
          </div>
        </div>

        {/* Uptime bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)', fontWeight: 800 }}>THIẾT BỊ ONLINE</span>
            <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--admin-text)', fontFamily: 'monospace' }}>
              {kpi.devicesOnline} <span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>/ {kpi.devicesTotal}</span>
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--admin-bg)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.round(uptimeRatio * 100)}%`,
              background: uptimeRatio > 0.8 ? 'var(--admin-success)' : uptimeRatio > 0.5 ? 'var(--admin-warning, #f59e0b)' : 'var(--admin-danger)',
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatBox icon={<Wifi size={11} />} label="TRỰC TUYẾN" value={`${Math.round(uptimeRatio * 100)}%`} ok={uptimeRatio > 0.8} />
          <StatBox icon={<AlertTriangle size={11} />} label="CẢNH BÁO" value={String(kpi.alerts)} ok={kpi.alerts === 0} danger={kpi.alerts > 0} />
        </div>
      </div>

      {/* CTA footer */}
      <div style={{
        borderTop: `1px solid ${hovered ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
        padding: '9px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        background: hovered ? 'rgba(245,158,11,0.06)' : 'transparent',
        transition: 'all 0.18s'
      }}>
        {hasUrl ? (
          <>
            <ExternalLink size={11} style={{ color: hovered ? 'var(--admin-accent)' : 'var(--admin-text-muted)' }} />
            <span style={{ fontSize: '0.62rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: hovered ? 'var(--admin-accent)' : 'var(--admin-text-muted)' }}>
              Vào trạm
            </span>
            <Video size={11} style={{ color: hovered ? 'var(--admin-accent)' : 'var(--admin-text-muted)', marginLeft: 2 }} />
          </>
        ) : (
          <>
            <Activity size={11} style={{ color: 'var(--admin-text-muted)' }} />
            <span style={{ fontSize: '0.62rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--admin-text-muted)' }}>
              Chưa cấu hình URL
            </span>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse-red-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

function StatBox({ icon, label, value, ok, danger }: { icon: React.ReactNode; label: string; value: string; ok?: boolean; danger?: boolean }) {
  const color = danger ? 'var(--admin-danger)' : ok ? 'var(--admin-success)' : 'var(--admin-text-muted)';
  return (
    <div style={{ background: 'var(--admin-bg)', padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--admin-text-muted)' }}>
        {icon}
        <span style={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <span style={{ fontSize: '0.9rem', fontWeight: 900, color, fontFamily: 'monospace', lineHeight: 1 }}>{value}</span>
    </div>
  );
}
