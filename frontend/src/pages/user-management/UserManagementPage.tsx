// ============================================================
// UserManagementPage.tsx — Quản lý tài khoản & Giám sát vận hành
// Giao diện hợp nhất: Bảng quản trị & Theo dõi nhân sự theo trạm
// ============================================================

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { stationApi, UserItem, Station, LoginLogEntry } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { authService } from '@/services/AuthService';
import { useStationStore } from '@/store';
import { 
  Search, UserPlus, Users, Clock, 
  Activity, CheckCircle2, Shield, Edit2, Key, Trash2, 
  MoreHorizontal, ChevronLeft, Map
} from 'lucide-react';
import { fmtDateTime } from '@/utils/format';

interface UserManagementPageProps {
  embeddedMode?: 'default' | 'central';
}

const ROLE_CFG = {
  admin:    { label: 'ADMIN',    color: 'var(--admin-danger)',  bg: 'rgba(239,68,68,0.1)' },
  manager:  { label: 'MANAGER',  color: '#f59e0b',              bg: 'rgba(245,158,11,0.1)' },
  operator: { label: 'OPERATOR', color: 'var(--admin-success)', bg: 'rgba(16,185,129,0.1)' },
} as const;

export default function UserManagementPage({ embeddedMode = 'default' }: UserManagementPageProps) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStationId, setFilterStationId] = useState('');
  const [searchText, setSearchText] = useState('');

  const stations = useStationStore(s => s.stations);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [u, s, logs] = await Promise.all([
        stationApi.getUsers(),
        stationApi.getStations(),
        stationApi.getLoginLogs({ limit: 500 } as any)
      ]);
      setUsers(u);
      setStationsList(s);
      setLoginLogs(logs);
    }
    catch (e) { console.error('Lỗi tải dữ liệu:', e); }
    finally { setLoading(false); }
  };

  const getStationUsers = (stationId: string) => {
    return users.filter(u => u.stationIds?.includes(stationId));
  };

  const filteredUsers = useMemo(() => {
    let list = users;
    if (filterStationId) list = list.filter(u => (u.stationIds ?? []).includes(filterStationId) || u.role === 'admin');
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(u =>
        u.username.toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filterStationId, searchText]);

  const getLastActive = (username: string) => {
    const userLogs = loginLogs.filter(l => l.username === username);
    if (userLogs.length === 0) return null;
    return userLogs[0]?.ts ?? null;
  };

  const openAddModal = () => {
    setEditingUserId(null);
    setFormData({ username: '', fullName: '', email: '', password: '', confirmPassword: '', role: 'operator', isActive: true, stationIds: [] });
    setIsUserModalOpen(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUserId(u.id);
    setFormData({ username: u.username, fullName: u.fullName || '', email: u.email || '', password: '', confirmPassword: '', role: u.role, isActive: u.isActive, stationIds: u.stationIds || [] });
    setIsUserModalOpen(true);
  };

  const openPwModal = (id: string) => {
    setEditingUserId(id);
    setPwData({ newPassword: '', confirmPassword: '' });
    setIsPwModalOpen(true);
  };

  const deactivateUser = async (u: UserItem) => {
    if (!await confirmDialog({ title: 'Vô hiệu hóa tài khoản', message: `Vô hiệu hóa tài khoản "${u.username}"?`, confirmText: 'Vô hiệu hóa', danger: true })) return;
    try {
      await stationApi.deactivateUser(u.id);
      loadData();
    } catch (e: any) { alert(`Lỗi: ${e.message}`); }
  };

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isPwModalOpen, setIsPwModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    username: '', fullName: '', email: '',
    password: '', confirmPassword: '',
    role: 'operator', isActive: true,
    stationIds: [] as string[]
  });

  const [pwData, setPwData] = useState({ newPassword: '', confirmPassword: '' });

  const saveUser = async () => {
    const { username, fullName, email, password, confirmPassword, role, isActive, stationIds } = formData;
    if (editingUserId) {
      try {
        await stationApi.updateUser(editingUserId, { fullName, email, role, isActive, stationIds });
        setIsUserModalOpen(false);
        loadData();
      } catch (e: any) { alert(`Lỗi: ${e.message}`); }
    } else {
      if (!username) return;
      if (password !== confirmPassword) { alert('Mật khẩu không khớp'); return; }
      try {
        await stationApi.createUser({ username, password, fullName, email, role, stationIds });
        setIsUserModalOpen(false);
        loadData();
      } catch (e: any) { alert(`Lỗi: ${e.message}`); }
    }
  };

  const changePassword = async () => {
    if (!editingUserId) return;
    if (pwData.newPassword !== pwData.confirmPassword) { alert('Mật khẩu không khớp'); return; }
    try {
      await stationApi.changePassword(editingUserId, { newPassword: pwData.newPassword });
      setIsPwModalOpen(false);
      alert('Đã đổi mật khẩu');
    } catch (e: any) { alert(`Lỗi: ${e.message}`); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      
      {/* HEADER BAR — Ultra Minimalist */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--admin-border)',
        display: 'flex', alignItems: 'center', gap: 20,
        background: 'var(--admin-panel)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {filterStationId && (
            <button 
              onClick={() => setFilterStationId('')}
              style={{
                height: 28,
                padding: '0 10px',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--admin-border)',
                background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.72))',
                color: 'var(--admin-accent)',
                fontSize: '0.68rem',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <span style={{ fontSize: '0.8rem', lineHeight: 1 }}>←</span>
              <span>Trở về</span>
            </button>
          )}
          
          <TopStat 
            icon={<Users size={14} color="var(--admin-text-muted)" />} 
            label={filterStationId ? "Nhân sự tại trạm" : "Tổng nhân sự"} 
            value={filteredUsers.length} 
          />
          
          {filterStationId && (
            <span style={{ fontSize: '.85rem', fontWeight: 900, color: 'var(--admin-text)', letterSpacing: '0.02em', textTransform: 'uppercase', marginLeft: 10 }}>
              / {stationsList.find(s => s.id === filterStationId)?.name}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--admin-text-muted)' }} />
            <input 
              className="form-input" 
              placeholder="Tìm nhân sự..." 
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 220, height: 32, paddingLeft: 30, fontSize: '.75rem', background: 'var(--admin-layer-2)' }} 
            />
          </div>
          <button onClick={openAddModal} className="btn-industrial btn-primary" style={{ height: 32, padding: '0 15px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '.75rem' }}>
            <UserPlus size={14} /> THÊM
          </button>
        </div>
      </div>

      {/* DATA AREA */}
      <div className="custom-hud-scroll" style={{ flex: 1, overflowY: 'auto', padding: filterStationId ? 0 : 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            <Activity className="animate-spin" style={{ margin: '0 auto 10px' }} /> Đang tải dữ liệu...
          </div>
        ) : !filterStationId ? (
          /* LEVEL 1: STATION MONITORING GRID (Default) */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {stationsList.map(s => {
              const stationUsers = getStationUsers(s.id);
              const onlineCount = stationUsers.filter(u => {
                const last = getLastActive(u.username);
                return last && (Date.now() - new Date(last).getTime() < 15 * 60 * 1000);
              }).length;

              return (
                <div 
                  key={s.id} 
                  onClick={() => setFilterStationId(s.id)}
                  className="multisite-hud-panel station-card-interactive" 
                  style={{ 
                    padding: 0, display: 'flex', flexDirection: 'column', 
                    border: '1px solid var(--admin-border)', background: 'rgba(255,255,255,0.02)',
                    cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s'
                  }}
                >
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }}>
                    <div>
                      <div style={{ fontSize: '.6rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase' }}>{s.code || 'TBA'}</div>
                      <div style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--admin-text)' }}>{s.name}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--admin-layer-2)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--admin-border)' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--admin-success)' }} />
                      <span style={{ fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text)' }}>{onlineCount}/{stationUsers.length} TRỰC</span>
                    </div>
                  </div>

                  <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: '.6rem', fontWeight: 900, color: 'var(--admin-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Users size={12} /> NHÂN SỰ PHỤ TRÁCH ({stationUsers.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {stationUsers.slice(0, 5).map(u => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--admin-layer-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.6rem', fontWeight: 900, color: 'var(--admin-accent)', border: '1px solid var(--admin-border)' }}>
                              {u.username.charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: '.72rem', color: 'var(--admin-text)', fontWeight: 600 }}>{u.fullName || u.username}</span>
                          </div>
                        ))}
                        {stationUsers.length > 5 && <div style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', paddingLeft: 30 }}>+ {stationUsers.length - 5} nhân sự khác...</div>}
                        {stationUsers.length === 0 && <div style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Chưa gán nhân sự</div>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* LEVEL 2: DETAILED USER TABLE (Filtered by Station) */
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
                <th style={TH_STYLE}>NHÂN SỰ / TÀI KHOẢN</th>
                <th style={TH_STYLE}>VAI TRÒ</th>
                <th style={TH_STYLE}>TRẠM ĐANG PHỤ TRÁCH</th>
                <th style={TH_STYLE}>TRẠNG THÁI HĐ</th>
                <th style={TH_STYLE}>THỜI GIAN HĐ GẦN NHẤT</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => {
                const role = ROLE_CFG[u.role as keyof typeof ROLE_CFG] ?? ROLE_CFG.operator;
                const lastActive = getLastActive(u.username);
                const assignedStations = u.stationIds?.map(id => stationsList.find(s => s.id === id)).filter(Boolean) ?? [];
                const isOnline = lastActive && (Date.now() - new Date(lastActive).getTime() < 15 * 60 * 1000);

                return (
                  <tr key={u.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--admin-border)', opacity: u.isActive ? 1 : 0.5 }}>
                    <td style={TD_STYLE}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--admin-layer-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-accent)', border: '1px solid var(--admin-border)' }}>
                          {u.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--admin-text)' }}>{u.fullName || u.username}</div>
                          <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontFamily: 'monospace' }}>@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td style={TD_STYLE}>
                      <span style={{ fontSize: '.6rem', fontWeight: 900, padding: '2px 8px', background: role.bg, color: role.color, borderRadius: 2, border: `1px solid ${role.color}40` }}>
                        {role.label}
                      </span>
                    </td>
                    <td style={TD_STYLE}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {assignedStations.length === 0 ? (
                          <span style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Tất cả các trạm</span>
                        ) : (
                          assignedStations.map(s => (
                            <span key={s!.id} style={{ fontSize: '.6rem', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', padding: '1px 5px', border: '1px solid var(--admin-border)', borderRadius: 2 }}>
                              {s!.code || s!.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td style={TD_STYLE}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? 'var(--admin-success)' : 'var(--admin-text-muted)' }} />
                        <span style={{ fontSize: '.7rem', fontWeight: 700, color: isOnline ? 'var(--admin-success)' : 'var(--admin-text-muted)' }}>
                          {isOnline ? 'ĐANG TRỰC' : 'NGOẠI TUYẾN'}
                        </span>
                      </div>
                    </td>
                    <td style={TD_STYLE}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.72rem', color: 'var(--admin-text)' }}>
                        <Clock size={12} style={{ color: 'var(--admin-text-muted)' }} />
                        {lastActive ? fmtDateTime(lastActive) : 'Chưa ghi nhận'}
                      </div>
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                        <ActionIcon icon={<Edit2 size={12} />} onClick={() => openEditModal(u)} title="Sửa thông tin" />
                        <ActionIcon icon={<Key size={12} />} onClick={() => openPwModal(u.id)} title="Đổi mật khẩu" />
                        {u.isActive && <ActionIcon icon={<Trash2 size={12} />} onClick={() => deactivateUser(u)} danger title="Vô hiệu hóa" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* MODALS */}
      {isUserModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 500 }}>
            <div className="modal-header">
              <h3>{editingUserId ? `CẬP NHẬT NHÂN SỰ` : 'THÊM NHÂN SỰ MỚI'}</h3>
              <button className="modal-close-btn" onClick={() => setIsUserModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
               {!editingUserId && <div className="form-group"><label>Tên đăng nhập *</label><input className="form-input" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} /></div>}
               <div className="form-group"><label>Họ và tên</label><input className="form-input" value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} /></div>
               <div className="form-group"><label>Email</label><input className="form-input" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
               {!editingUserId && (
                 <div className="form-grid-2">
                   <div className="form-group"><label>Mật khẩu *</label><input className="form-input" type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} /></div>
                   <div className="form-group"><label>Xác nhận *</label><input className="form-input" type="password" value={formData.confirmPassword} onChange={e => setFormData({...formData, confirmPassword: e.target.value})} /></div>
                 </div>
               )}
               <div className="form-group">
                 <label>Vai trò hệ thống</label>
                 <div style={{ display: 'flex', gap: 15, marginTop: 5 }}>
                   {['operator', 'manager', 'admin'].map(r => (
                     <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.75rem', cursor: 'pointer' }}>
                       <input type="radio" name="role" value={r} checked={formData.role === r} onChange={e => setFormData({...formData, role: e.target.value})} /> 
                       {r.toUpperCase()}
                     </label>
                   ))}
                 </div>
               </div>
               <div className="form-group">
                  <label>Trạm được phân công</label>
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--admin-border)', padding: 10, marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--admin-layer-2)' }}>
                    {stationsList.map(s => (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.7rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={formData.stationIds.includes(s.id)} onChange={() => {
                          const next = formData.stationIds.includes(s.id) ? formData.stationIds.filter(id => id !== s.id) : [...formData.stationIds, s.id];
                          setFormData({...formData, stationIds: next});
                        }} /> {s.name} ({s.code})
                      </label>
                    ))}
                  </div>
               </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setIsUserModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={saveUser}>Lưu dữ liệu</button>
            </div>
          </div>
        </div>
      )}

      {isPwModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 400 }}>
            <div className="modal-header"><h3>ĐỔI MẬT KHẨU</h3><button className="modal-close-btn" onClick={() => setIsPwModalOpen(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group"><label>Mật khẩu mới</label><input className="form-input" type="password" value={pwData.newPassword} onChange={e => setPwData({...pwData, newPassword: e.target.value})} /></div>
              <div className="form-group"><label>Xác nhận lại</label><input className="form-input" type="password" value={pwData.confirmPassword} onChange={e => setPwData({...pwData, confirmPassword: e.target.value})} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" onClick={() => setIsPwModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" onClick={changePassword}>Cập nhật</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .table-row-hover:hover { background: rgba(255,255,255,0.02); }
        .table-row-hover td { transition: background 0.2s; }
        .station-card-interactive:hover { border-color: var(--admin-accent) !important; transform: translateY(-2px); }
      `}</style>
    </div>
  );
}

function TopStat({ icon, label, value }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon}
      <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--admin-text-muted)', textTransform: 'uppercase' }}>{label}:</span>
      <span style={{ fontSize: '.75rem', fontWeight: 900, color: 'var(--admin-text)' }}>{value}</span>
    </div>
  );
}

function ActionIcon({ icon, onClick, danger, title }: any) {
  return (
    <button 
      onClick={onClick} 
      title={title}
      style={{
        width: 28, height: 28, borderRadius: 4, border: '1px solid var(--admin-border)',
        background: 'var(--admin-layer-3)', color: danger ? 'var(--admin-danger)' : 'var(--admin-text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        transition: 'all 0.2s'
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = danger ? 'var(--admin-danger)' : 'var(--admin-accent)';
        e.currentTarget.style.color = danger ? 'var(--admin-danger)' : 'var(--admin-accent)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--admin-border)';
        e.currentTarget.style.color = danger ? 'var(--admin-danger)' : 'var(--admin-text-muted)';
      }}
    >
      {icon}
    </button>
  );
}

const TH_STYLE: React.CSSProperties = {
  padding: '12px 20px',
  fontSize: '.65rem',
  fontWeight: 900,
  color: 'var(--admin-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '.05em'
};

const TD_STYLE: React.CSSProperties = {
  padding: '12px 20px',
  verticalAlign: 'middle'
};
