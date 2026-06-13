// src/components/pd/PdList.tsx
import React from 'react';
import { Zap } from 'lucide-react';

type Props = {
  regions: any[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onEdit: (region: any) => void;
  onDelete: (id: string) => void;
};

export const PdList: React.FC<Props> = ({ regions, activeId, onSelect, onEdit, onDelete }) => {
  return (
    <div className="admin-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '.8px', background: 'var(--admin-layer-1)' }}>
        DANH SÁCH VÙNG GIÁM SÁT ({regions.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--admin-bg)' }}>
        {regions.length === 0 ? (
          <div style={{ padding: 30, fontSize: '.78rem', color: 'var(--admin-text-muted)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ opacity: 0.2 }}><Zap size={32} /></div>
            Chưa có vùng PD nào được cấu hình.
          </div>
        ) : (
          regions.map(r => (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              style={{
                padding: '12px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--admin-border)',
                background: activeId === r.id ? 'rgba(59,130,246,.08)' : 'transparent',
                borderLeft: activeId === r.id ? '3px solid var(--admin-accent)' : '3px solid transparent',
                transition: '.12s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem', color: activeId === r.id ? 'var(--admin-accent)' : 'var(--admin-text)' }}>{r.name}</div>
                <div style={{ fontSize: '.7rem', fontWeight: 800, color: (r.warningThreshold ?? 0) > 30 ? 'var(--admin-danger)' : 'var(--admin-warning)' }}>
                   {r.warningThreshold} dB
                </div>
              </div>
              <div style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
                Ngưỡng: {r.warningThreshold ?? 20} / {r.alarmThreshold ?? 45} dB
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <button className="btn-industrial btn-sm" onClick={e => { e.stopPropagation(); onEdit(r); }}>Sửa</button>
                <button className="btn-industrial btn-sm btn-danger" onClick={e => { e.stopPropagation(); onDelete(r.id); }}>Xóa</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
