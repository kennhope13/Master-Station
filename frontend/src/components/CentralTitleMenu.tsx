import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Map, FileArchive, Users, LogOut, LayoutGrid, BellRing } from 'lucide-react';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';

interface Props {
  title: string;
}

export default function CentralTitleMenu({ title }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentUser = authService.getUser();
  const isCentralMode = isCentralUser(currentUser);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isCentralMode) return <h2 style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '0.02em' }}>{title}</h2>;

  const handleOpen = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 12, left: r.left });
    }
    setOpen(v => !v);
  };

  const go = (path: string) => { navigate(path); setOpen(false); };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleOpen}
        className={`central-menu-trigger ${open ? 'is-open' : ''}`}
        style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: 10, 
          cursor: 'pointer', 
          userSelect: 'none',
          padding: '4px 12px',
          borderRadius: '8px',
          background: open ? 'var(--admin-layer-2)' : 'transparent',
          transition: 'all 0.2s ease',
          border: `1px solid ${open ? 'var(--admin-border)' : 'transparent'}`
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, letterSpacing: '0.02em' }}>{title}</h2>
        <ChevronDown
          size={16}
          strokeWidth={3}
          style={{ 
            color: open ? 'var(--admin-accent)' : 'var(--admin-text-muted)', 
            flexShrink: 0, 
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
            transform: open ? 'rotate(180deg)' : 'none' 
          }}
        />
      </div>
      {open && (
        <div
          ref={menuRef}
          style={{ 
            position: 'fixed', 
            top: pos.top, 
            left: pos.left, 
            width: 260, 
            background: 'var(--admin-panel)', 
            border: '1px solid var(--admin-border)', 
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)', 
            borderRadius: '12px', 
            zIndex: 9999, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            animation: 'menuFadeIn 0.2s ease'
          }}
        >
          <style>{`
            @keyframes menuFadeIn {
              from { opacity: 0; transform: translateY(-10px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .menu-item {
              width: 100%;
              text-align: left;
              padding: 10px 14px;
              font-size: 0.8rem;
              display: flex;
              align-items: center;
              gap: 12px;
              background: transparent;
              border: none;
              color: var(--admin-text);
              cursor: pointer;
              transition: all 0.15s;
              font-weight: 600;
            }
            .menu-item:hover {
              background: var(--admin-hover);
              color: var(--admin-accent);
              padding-left: 18px;
            }
            .menu-item svg {
              color: var(--admin-text-muted);
              transition: color 0.15s;
            }
            .menu-item:hover svg {
              color: var(--admin-accent);
            }
          `}</style>
          
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-layer-1)', fontSize: '0.65rem', fontWeight: 900, color: 'var(--admin-accent)', letterSpacing: '0.1em' }}>
            HỆ THỐNG ĐA TRẠM
          </div>
          
          <div style={{ padding: '6px 0' }}>
            <button onClick={() => go('/multisite')} className="menu-item">
              <LayoutGrid size={16} /> Dashboard Trung tâm
            </button>
            <button onClick={() => go('/alerts-history')} className="menu-item">
              <BellRing size={16} /> Nhật ký cảnh báo
            </button>
            <button onClick={() => go('/audit-log')} className="menu-item">
              <FileArchive size={16} /> Nhật ký hệ thống
            </button>
            <div style={{ height: 1, background: 'var(--admin-border)', margin: '6px 0' }} />
            <button onClick={() => go('/user-management')} className="menu-item">
              <Users size={16} /> Quản trị người dùng
            </button>
          </div>
          
          <div style={{ background: 'rgba(239,68,68,0.03)', borderTop: '1px solid var(--admin-border)' }}>
            <button
              onClick={() => { authService.logout(); navigate('/login'); window.location.reload(); }}
              className="menu-item"
              style={{ color: '#ef4444', padding: '12px 14px' }}
            >
              <LogOut size={16} /> Đăng xuất hệ thống
            </button>
          </div>
        </div>
      )}
    </>
  );
}
