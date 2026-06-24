// ============================================================
// UserManagementPage.tsx — Quản lý tài khoản & Giám sát vận hành
// Giao diện hợp nhất: Bảng quản trị & Theo dõi nhân sự theo trạm
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { stationApi, UserItem, Station, LoginLogEntry, PermissionInfo, Province, Team } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import { authService } from '@/services/AuthService';
import { useStationStore } from '@/store';
import { useRealtime } from '@/hooks/useRealtime';
import { 
  Search, UserPlus, Users, Clock, 
  Activity, CheckCircle2, Shield, Edit2, Trash2, X,
  MoreHorizontal, ChevronLeft, Map, Plus
} from 'lucide-react';
import { fmtDateTime } from '@/utils/format';

interface UserManagementPageProps {
  embeddedMode?: 'default' | 'central';
}

const ROLE_CFG = {
  admin:             { label: 'ADMIN TOÀN CỤC', color: 'var(--admin-danger)',  bg: 'rgba(239,68,68,0.1)' },
  admin_province:    { label: 'ADMIN TỈNH',     color: '#8b5cf6',              bg: 'rgba(139,92,246,0.1)' },
  operator_province: { label: 'OPERATOR TỈNH',  color: '#0d9488',              bg: 'rgba(13,148,136,0.1)' },
  team_leader:       { label: 'TỔ TRƯỞNG',      color: '#f59e0b',              bg: 'rgba(245,158,11,0.12)' },
  team_member:       { label: 'NHÂN VIÊN TỔ',  color: '#3b82f6',              bg: 'rgba(59,130,246,0.1)' },
  admin_station:     { label: 'ADMIN TRẠM',     color: '#06b6d4',              bg: 'rgba(6,182,212,0.1)' },
  manager:           { label: 'MANAGER',        color: '#f59e0b',              bg: 'rgba(245,158,11,0.1)' },
  operator:          { label: 'OPERATOR',       color: 'var(--admin-success)', bg: 'rgba(16,185,129,0.1)' },
} as const;

// Quyền mặc định theo vai trò — khớp với sơ đồ Use Case
// Danh sách key hợp lệ: station:view, station:manage, device:view, device:manage,
// user:view, user:manage, rule:view, rule:manage, report:view, report:manage,
// settings:manage, license:manage
const DEFAULT_PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  admin: [], // admin luôn full → sẽ chọn tất cả dynamically
  admin_province: [
    'station:view', 'station:manage',
    'device:view', 'device:manage',
    'rule:view', 'rule:manage',
    'user:view', 'user:manage',
    'report:view', 'report:manage',
    'license:manage'
  ],
  operator_province: [
    'station:view', 'device:view', 'rule:view', 'report:view'
  ],
  admin_station: [
    'station:view', 'station:manage',
    'device:view', 'device:manage',
    'rule:view', 'rule:manage',
    'user:view', 'user:manage',
    'report:view', 'report:manage'
  ],
  team_leader: [
    'station:view', 'device:view', 'device:manage',
    'rule:view', 'report:view'
  ],
  team_member: [
    'station:view', 'device:view', 'rule:view', 'report:view'
  ],
  manager: [
    'station:view', 'device:view', 'device:manage',
    'rule:view', 'report:view'
  ],
  operator: [
    'station:view', 'device:view', 'rule:view', 'report:view'
  ],
};

function FilterDropdown({
  value,
  placeholder,
  options,
  onChange,
  width = 170
}: {
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = options.find(option => option.value === value)?.label || placeholder;

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
    <div ref={rootRef} style={{ position: 'relative', width, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        style={{
          width: '100%',
          height: 32,
          padding: '0 10px',
          border: '1px solid var(--admin-border)',
          background: 'var(--admin-layer-2)',
          color: 'var(--admin-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: '.72rem',
          cursor: 'pointer',
          borderRadius: 4
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeLabel}</span>
        <span style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)' }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 30,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--admin-panel)',
            border: '1px solid var(--admin-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            borderRadius: 4
          }}
        >
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: active ? 'var(--admin-layer-3)' : 'transparent',
                  color: active ? 'var(--admin-accent)' : 'var(--admin-text)',
                  textAlign: 'left',
                  fontSize: '.72rem',
                  cursor: 'pointer',
                  fontWeight: active ? 800 : 600
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

export default function UserManagementPage({ embeddedMode = 'default' }: UserManagementPageProps) {
  const navigate = useNavigate();
  const isEmbeddedCentral = embeddedMode === 'central';
  const currentUser = authService.getUser();
  const callerProvinceIds = currentUser?.province_ids || [];
  const isProvinceAdmin = currentUser?.role === 'admin_province';
  const [users, setUsers] = useState<UserItem[]>([]);
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [provincesList, setProvincesList] = useState<Province[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLogEntry[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<PermissionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStationId, setFilterStationId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [teamProvinceFilter, setTeamProvinceFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'stations' | 'teams' | 'users'>('stations');
  const [teamsList, setTeamsList] = useState<Team[]>([]);
  const [collapsedStationProvinces, setCollapsedStationProvinces] = useState<Set<string>>(new Set());
  const [collapsedStationTeams, setCollapsedStationTeams] = useState<Set<string>>(new Set());
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamFormData, setTeamFormData] = useState({
    name: '',
    description: '',
    provinceId: '',
    stationIds: [] as string[]
  });

  const stations = useStationStore(s => s.stations);

  useRealtime({
    onUserStatusChange: (data) => {
      if (['team_changed', 'updated', 'deactivated'].includes(data.status)) {
        loadData();
        return;
      }

      setLoginLogs(prev => {
        if (!data.username) return prev;
        const index = prev.findIndex(l => l.username === data.username);
        if (index > -1) {
          const updated = [...prev];
          updated[index] = { ...updated[index], ts: data.ts } as LoginLogEntry;
          return updated;
        } else {
          const newEntry: LoginLogEntry = {
            id: Math.random().toString(),
            username: data.username,
            ipAddress: '',
            action: data.status === 'online' ? 'login' : 'logout',
            ts: data.ts
          };
          return [newEntry, ...prev];
        }
      });
    }
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, []);

  const refreshData = async () => {
    try {
      const [u, logs] = await Promise.all([
        stationApi.getUsers(),
        stationApi.getLoginLogs({ limit: 500 } as any)
      ]);
      setUsers(u);
      setLoginLogs(logs);
    } catch (e) {
      console.error('Lỗi tự động cập nhật:', e);
    }
  };

  const loadData = async () => {
    console.log('DEBUG: loadData started! currentUser:', authService.getUser());
    setLoading(true);
    try {
      const [u, s, logs, perms, provs, teams] = await Promise.all([
        stationApi.getUsers(),
        stationApi.getStations(),
        stationApi.getLoginLogs({ limit: 500 } as any),
        stationApi.getAvailablePermissions(),
        stationApi.getProvinces(),
        stationApi.getTeams()
      ]);

      console.log('DEBUG: currentUser', currentUser);
      let filteredStations = s;
      let filteredProvinces = provs;
      let filteredTeams = teams;

      if (currentUser && currentUser.role !== 'admin') {
        if (currentUser.role === 'admin_province') {
          const currProvinces = (currentUser.province_ids || []).map((id: string) => id.toLowerCase());
          console.log('DEBUG: admin_province currProvinces', currProvinces);
          filteredProvinces = provs.filter(p => currProvinces.includes(p.id.toLowerCase()));
          console.log('DEBUG: filteredProvinces', filteredProvinces);
          filteredStations = s.filter(st => st.provinceId && currProvinces.includes(st.provinceId.toLowerCase()));
          filteredTeams = teams.filter(t => t.provinceId && currProvinces.includes(t.provinceId.toLowerCase()));
        } else if (currentUser.role === 'admin_station') {
          const currStations = (currentUser.station_ids || []).map(id => id.toLowerCase());
          filteredStations = s.filter(st => currStations.includes(st.id.toLowerCase()));
          filteredTeams = teams.filter(t => t.stationIds?.some(sid => currStations.includes(sid.toLowerCase())));
          const provinceIdsOfStations = filteredStations.map(st => st.provinceId).filter(Boolean) as string[];
          filteredProvinces = provs.filter(p => provinceIdsOfStations.some(sid => sid.toLowerCase() === p.id.toLowerCase()));
        } else if (currentUser.role === 'team_leader') {
          // Tổ trưởng chỉ thấy tổ của mình (backend đã lọc, đồng bộ lại frontend)
          const currTeamId = currentUser.team_id?.toLowerCase();
          filteredTeams = currTeamId ? teams.filter(t => t.id.toLowerCase() === currTeamId) : [];
          const ownTeam = filteredTeams[0];
          filteredStations = ownTeam?.stationIds
            ? s.filter(st => ownTeam.stationIds!.map(id => id.toLowerCase()).includes(st.id.toLowerCase()))
            : [];
          filteredProvinces = ownTeam?.provinceId
            ? provs.filter(p => p.id.toLowerCase() === ownTeam.provinceId!.toLowerCase())
            : [];
        }
      }

      setUsers(u);
      setStationsList(filteredStations);
      setLoginLogs(logs);
      setAvailablePermissions(perms);
      setProvincesList(filteredProvinces);
      setTeamsList(filteredTeams);
    }
    catch (e) { console.error('Lỗi tải dữ liệu:', e); }
    finally { setLoading(false); }
  };

  const getStationUsers = (stationId: string) => {
    const station = stationsList.find(s => s.id === stationId);

    return users.filter(u => {
      if (u.station_ids?.includes(stationId)) return true;

      if (u.teamId) {
        const team = teamsList.find(t => t.id === u.teamId);
        if (team?.stationIds?.includes(stationId)) return true;
      }

      if (
        station?.provinceId &&
        ['admin_province', 'operator_province'].includes(u.role) &&
        u.province_ids?.includes(station.provinceId)
      ) {
        return true;
      }

      return false;
    });
  };

  const getUserProvinceIds = (user: UserItem) => {
    if (user.province_ids?.length) return user.province_ids;
    if (user.teamId) {
      const team = teamsList.find(t => t.id === user.teamId);
      return team?.provinceId ? [team.provinceId] : [];
    }
    const stationProvinceIds = (user.station_ids || [])
      .map(id => stationsList.find(s => s.id === id)?.provinceId)
      .filter(Boolean) as string[];
    return [...new Set(stationProvinceIds)];
  };

  const getUserTeamId = (user: UserItem) => user.teamId || '';

  const filteredUsers = useMemo(() => {
    let list = users;

    if (currentUser && currentUser.role !== 'admin') {
      list = list.filter(target => {
        if (target.role === 'admin') return false;

        if (currentUser.role === 'admin_province') {
          const currProvinces = (currentUser.province_ids || []).map(id => id.toLowerCase());
          if (currProvinces.length === 0) return false;

          if (['admin_province', 'operator_province'].includes(target.role)) {
            const targetProvinces = (target.province_ids || []).map(id => id.toLowerCase());
            return targetProvinces.some((id: string) => currProvinces.includes(id));
          }

          const targetProvinces = (target.province_ids || []).map(id => id.toLowerCase());
          if (targetProvinces.some((id: string) => currProvinces.includes(id))) return true;

          const targetStations = (target.station_ids || []).map(id => id.toLowerCase());
          if (targetStations.some((sid: string) => {
            const st = stationsList.find(s => s.id.toLowerCase() === sid);
            return st?.provinceId && currProvinces.includes(st.provinceId.toLowerCase());
          })) return true;

          if (target.teamId) {
            const team = teamsList.find(t => t.id.toLowerCase() === target.teamId!.toLowerCase());
            if (team?.provinceId && currProvinces.includes(team.provinceId.toLowerCase())) return true;
          }

          return false;
        }

        if (currentUser.role === 'admin_station') {
          if (['admin_province', 'operator_province', 'admin_station', 'manager'].includes(target.role)) return false;

          const currStations = (currentUser.station_ids || []).map(id => id.toLowerCase());
          if (currStations.length === 0) return false;

          const targetStations = (target.station_ids || []).map(id => id.toLowerCase());
          if (targetStations.some((sid: string) => currStations.includes(sid))) return true;

          if (target.teamId) {
            const team = teamsList.find(t => t.id.toLowerCase() === target.teamId!.toLowerCase());
            if (team?.stationIds?.some(sid => currStations.includes(sid.toLowerCase()))) return true;
          }

          return false;
        }

        if (currentUser.role === 'team_leader') {
          // Tổ trưởng thấy nhân viên trong tổ của mình
          const currTeamId = currentUser.team_id?.toLowerCase();
          if (!currTeamId) return false;

          if (target.teamId && target.teamId.toLowerCase() === currTeamId) return true;

          // Hoặc user có trạm trùng với trạm trong tổ
          const ownTeam = teamsList.find(t => t.id.toLowerCase() === currTeamId);
          if (ownTeam?.stationIds) {
            const teamStationIds = ownTeam.stationIds.map(id => id.toLowerCase());
            const targetStations = (target.station_ids || []).map(id => id.toLowerCase());
            if (targetStations.some(sid => teamStationIds.includes(sid))) return true;
          }

          return false;
        }

        return target.username === currentUser.username;
      });
    }

    if (filterStationId) {
      const selectedStation = stationsList.find(s => s.id === filterStationId);
      list = list.filter(u => {
        if (u.role === 'admin') return true;
        if (u.station_ids?.includes(filterStationId)) return true;

        if (u.teamId) {
          const team = teamsList.find(t => t.id === u.teamId);
          if (team?.stationIds?.includes(filterStationId)) return true;
        }

        if (
          selectedStation?.provinceId &&
          ['admin_province', 'operator_province'].includes(u.role) &&
          u.province_ids?.includes(selectedStation.provinceId)
        ) {
          return true;
        }

        return false;
      });
    }
    if (roleFilter) list = list.filter(u => u.role === roleFilter);
    if (provinceFilter) {
      list = list.filter(u => getUserProvinceIds(u).includes(provinceFilter));
    }
    if (teamFilter) {
      list = list.filter(u => getUserTeamId(u) === teamFilter);
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(u =>
        u.username.toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filterStationId, roleFilter, provinceFilter, teamFilter, searchText, stationsList, teamsList]);

  const getLastActive = (username: string) => {
    const userLogs = loginLogs.filter(l => l.username === username);
    if (userLogs.length === 0) return null;
    return userLogs[0]?.ts ?? null;
  };

  const filteredTeamsView = useMemo(() => {
    let list = teamsList;

    if (teamProvinceFilter) {
      list = list.filter(team => team.provinceId === teamProvinceFilter);
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(team =>
        team.name.toLowerCase().includes(q) ||
        (team.description || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [teamsList, teamProvinceFilter, searchText]);



  const openAddTeamModal = () => {
    setEditingTeamId(null);
    setTeamFormData({
      name: '',
      description: '',
      provinceId: provincesList[0]?.id || '',
      stationIds: []
    });
    setIsTeamModalOpen(true);
  };

  const openEditTeamModal = (team: Team) => {
    setEditingTeamId(team.id);
    setTeamFormData({
      name: team.name,
      description: team.description || '',
      provinceId: team.provinceId,
      stationIds: team.stationIds || []
    });
    setIsTeamModalOpen(true);
  };

  const saveTeam = async () => {
    const { name, description, provinceId, stationIds } = teamFormData;
    if (!name.trim()) { alert('Tên tổ không được để trống'); return; }
    if (!provinceId) { alert('Vui lòng chọn tỉnh'); return; }
    if (!await confirmDialog({
      title: 'Lưu tổ thao tác',
      message: 'Bạn có chắc chắn muốn lưu thông tin tổ thao tác này không?',
      confirmText: 'Lưu',
      cancelText: 'Hủy'
    })) return;
    try {
      if (editingTeamId) {
        await stationApi.updateTeam(editingTeamId, { name, description, provinceId, stationIds });
      } else {
        await stationApi.createTeam({ name, description, provinceId, stationIds });
      }
      setIsTeamModalOpen(false);
      loadData();
    } catch (e: any) {
      alert(`Lỗi lưu tổ: ${e.message}`);
    }
  };

  const deleteTeam = async (team: Team) => {
    if (!await confirmDialog({ title: 'Xóa tổ thao tác', message: `Bạn có chắc chắn muốn xóa tổ "${team.name}"?`, confirmText: 'Xóa', danger: true })) return;
    try {
      await stationApi.deleteTeam(team.id);
      loadData();
    } catch (e: any) {
      alert(`Lỗi xóa tổ: ${e.message}`);
    }
  };

  const openAddModal = () => {
    setEditingUserId(null);
    setFormData({ username: '', fullName: '', email: '', password: '', confirmPassword: '', role: 'operator', isActive: true, station_ids: [], province_ids: [], permissions: DEFAULT_PERMISSIONS_BY_ROLE['operator'] || [], teamId: '' });
    setPwData({ newPassword: '', confirmPassword: '' });
    setIsUserModalOpen(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUserId(u.id);
    setFormData({ username: u.username, fullName: u.fullName || '', email: u.email || '', password: '', confirmPassword: '', role: u.role, isActive: u.isActive, station_ids: u.station_ids || [], province_ids: u.province_ids || [], permissions: u.permissions || [], teamId: u.teamId || '' });
    setPwData({ newPassword: '', confirmPassword: '' });
    setIsUserModalOpen(true);
  };

  const deactivateUser = async (u: UserItem) => {
    if (!await confirmDialog({ title: 'Vô hiệu hóa tài khoản', message: `Vô hiệu hóa tài khoản "${u.username}"?`, confirmText: 'Vô hiệu hóa', danger: true })) return;
    try {
      await stationApi.deactivateUser(u.id);
      loadData();
    } catch (e: any) { alert(`Lỗi: ${e.message}`); }
  };

  const permanentDeleteUser = async (u: UserItem) => {
    if (!await confirmDialog({ title: 'XÓA VĨNH VIỄN TÀI KHOẢN', message: `Bạn có chắc chắn muốn XÓA VĨNH VIỄN tài khoản "${u.username}"?\n\nHành động này KHÔNG THỂ hoàn tác!`, confirmText: 'Xóa vĩnh viễn', danger: true })) return;
    try {
      await stationApi.permanentDeleteUser(u.id);
      loadData();
    } catch (e: any) { alert(`Lỗi: ${e.message}`); }
  };

  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    username: '', fullName: '', email: '',
    password: '', confirmPassword: '',
    role: 'operator', isActive: true,
    station_ids: [] as string[],
    province_ids: [] as string[],
    permissions: [] as string[],
    teamId: ''
  });

  const [pwData, setPwData] = useState({ newPassword: '', confirmPassword: '' });

  const normalizeAccountToken = (value?: string | null) => {
    if (!value) return '';
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  };

  const deriveDisplayedPassword = (user: UserItem) => {
    if (user.initialPassword) return user.initialPassword;
    if (user.username === 'multi') return 'Demo@2024';
    if (user.username === 'stationadmin') return 'Station@123';
    if (user.username === 'admin') return 'Admin@123';

    if (user.role === 'admin_province' && user.province_ids?.length) {
      const province = provincesList.find(p => p.id === user.province_ids?.[0]);
      const code = (province?.code || normalizeAccountToken(province?.name)).toUpperCase();
      return code ? `Tinh${code}@2026!` : null;
    }

    if (user.role === 'team_leader' && user.teamId) {
      const team = teamsList.find(t => t.id === user.teamId);
      const province = provincesList.find(p => p.id === team?.provinceId);
      const teamToken = normalizeAccountToken(team?.name);
      const provinceToken = normalizeAccountToken(province?.code || province?.name);
      if (!teamToken) return null;

      const shortTeamToken = teamToken.slice(0, 6);
      const shortProvinceToken = provinceToken.slice(0, 3).toUpperCase();
      const teamPart = shortTeamToken
        ? `${shortTeamToken.charAt(0).toUpperCase()}${shortTeamToken.slice(1)}`
        : '';
      return `${teamPart}${shortProvinceToken}@26`;
    }

    if (user.role === 'admin_station' && user.station_ids?.length) {
      const station = stationsList.find(s => s.id === user.station_ids?.[0]);
      const stationToken = normalizeAccountToken(station?.code || station?.name);
      if (!stationToken) return null;
      const shortStationToken = stationToken.slice(0, 8).toUpperCase();
      return `Tram${shortStationToken}@26`;
    }

    return null;
  };

  const editingUser = useMemo(
    () => editingUserId ? users.find(u => u.id === editingUserId) || null : null,
    [editingUserId, users]
  );

  const applyRoleToForm = (newRole: string) => {
    const defaultPerms = newRole === 'admin'
      ? availablePermissions.map(p => p.key)
      : (DEFAULT_PERMISSIONS_BY_ROLE[newRole] || []);

    setFormData(prev => ({
      ...prev,
      role: newRole,
      permissions: defaultPerms,
      province_ids: ['admin_province', 'operator_province'].includes(newRole)
        ? (isProvinceAdmin ? callerProvinceIds : prev.province_ids)
        : [],
      station_ids: ['admin_province', 'operator_province'].includes(newRole) ? [] : prev.station_ids,
      teamId: ['admin_province', 'operator_province'].includes(newRole) ? '' : prev.teamId
    }));
  };

  const saveUser = async () => {
    const { username, fullName, email, password, confirmPassword, role, isActive, station_ids, province_ids, permissions, teamId } = formData;
    const finalTeamId = teamId === '' ? null : teamId;

    if (editingUserId) {
      if (pwData.newPassword && pwData.newPassword !== pwData.confirmPassword) { alert('Mật khẩu mới không khớp'); return; }
      if (!await confirmDialog({
        title: 'Cập nhật tài khoản',
        message: `Bạn có chắc chắn muốn lưu các thay đổi cho tài khoản "${username}" không?`,
        confirmText: 'Lưu',
        cancelText: 'Hủy'
      })) return;
      try {
        await stationApi.updateUser(editingUserId, { fullName, email, role, isActive, station_ids: station_ids, province_ids: province_ids, permissions, teamId: finalTeamId });
        if (pwData.newPassword) {
          await stationApi.changePassword(editingUserId, { newPassword: pwData.newPassword });
        }
        setIsUserModalOpen(false);
        loadData();
      } catch (e: any) { alert(`Lỗi: ${e.message}`); }
    } else {
      if (!username) return;
      if (password !== confirmPassword) { alert('Mật khẩu không khớp'); return; }
      if (!await confirmDialog({
        title: 'Tạo tài khoản mới',
        message: `Bạn có chắc chắn muốn tạo tài khoản "${username}" không?`,
        confirmText: 'Tạo mới',
        cancelText: 'Hủy'
      })) return;
      try {
        await stationApi.createUser({ username, password, fullName, email, role, station_ids: station_ids, province_ids: province_ids, permissions, teamId: finalTeamId });
        setIsUserModalOpen(false);
        loadData();
      } catch (e: any) { alert(`Lỗi: ${e.message}`); }
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', minHeight: 0, width: '100%', overflow: 'hidden' }}>
      
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--admin-border)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'nowrap',
        background: 'var(--admin-panel)',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0, flexShrink: 1 }}>
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
                borderRadius: 4
              }}
            >
              <span style={{ fontSize: '0.8rem', lineHeight: 1, position: 'relative', top: 1 }}>←</span>
              <span>Trở về</span>
            </button>
          )}
          
          {activeTab === 'stations' && (
            <TopStat 
              icon={<Users size={14} color="var(--admin-text-muted)" />} 
              label={filterStationId ? "Nhân sự tại trạm" : "Tổng nhân sự"} 
              value={filteredUsers.length} 
            />
          )}

          {activeTab === 'teams' && (
            <TopStat 
              icon={<Users size={14} color="var(--admin-text-muted)" />} 
              label="Tổng số tổ" 
              value={teamsList.length} 
            />
          )}

          {activeTab === 'users' && (
            <TopStat 
              icon={<Users size={14} color="var(--admin-text-muted)" />} 
              label="Tổng tài khoản" 
              value={users.length} 
            />
          )}
          
          {filterStationId && (
            <span style={{ fontSize: '.85rem', fontWeight: 900, color: 'var(--admin-text)', letterSpacing: '0.02em', textTransform: 'uppercase', marginLeft: 10, whiteSpace: 'nowrap' }}>
              / {stationsList.find(s => s.id === filterStationId)?.name}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 20 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', justifyContent: 'flex-end', minWidth: 0, flexShrink: 0 }}>
          {(activeTab === 'users' || activeTab === 'teams' || filterStationId || activeTab === 'stations') && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 220px' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--admin-text-muted)' }} />
              <input 
                className="form-input" 
                placeholder={activeTab === 'teams' ? 'Tìm tổ...' : 'Tìm nhân sự...'} 
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ width: '100%', minWidth: 0, maxWidth: activeTab === 'teams' ? 200 : (isEmbeddedCentral ? 220 : 260), height: 32, paddingLeft: 30, fontSize: '.75rem', background: 'var(--admin-layer-2)' }} 
              />
            </div>
          )}

          {activeTab === 'teams' && (
            <FilterDropdown
              value={teamProvinceFilter}
              placeholder="Tất cả tỉnh"
              onChange={setTeamProvinceFilter}
              width={170}
              options={[
                { value: '', label: 'Tất cả tỉnh' },
                ...provincesList.map(p => ({ value: p.id, label: p.name }))
              ]}
            />
          )}

          {activeTab === 'users' && (
            <>
              <FilterDropdown
                value={provinceFilter}
                placeholder="Tất cả tỉnh"
                onChange={value => {
                  setProvinceFilter(value);
                  setTeamFilter('');
                }}
                options={[
                  { value: '', label: 'Tất cả tỉnh' },
                  ...provincesList.map(p => ({ value: p.id, label: p.name }))
                ]}
              />

              <FilterDropdown
                value={teamFilter}
                placeholder="Tất cả tổ"
                onChange={setTeamFilter}
                options={[
                  { value: '', label: 'Tất cả tổ' },
                  ...teamsList
                    .filter(t => !provinceFilter || t.provinceId === provinceFilter)
                    .map(t => ({ value: t.id, label: t.name }))
                ]}
              />

              <FilterDropdown
                value={roleFilter}
                placeholder="Tất cả vai trò"
                onChange={setRoleFilter}
                options={[
                  { value: '', label: 'Tất cả vai trò' },
                  ...Object.entries(ROLE_CFG).map(([key, cfg]) => ({ value: key, label: cfg.label }))
                ]}
              />
            </>
          )}

          {activeTab === 'teams' && (
            <button onClick={openAddTeamModal} className="btn-industrial btn-primary" style={{ height: 32, minWidth: 128, padding: '0 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '.72rem', whiteSpace: 'nowrap', lineHeight: 1 }}>
              <Plus size={14} /> THÊM TỔ MỚI
            </button>
          )}

          {(activeTab === 'users' || filterStationId) && (
            <button onClick={openAddModal} className="btn-industrial btn-primary" style={{ height: 32, minWidth: 136, padding: '0 14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '.72rem', whiteSpace: 'nowrap', lineHeight: 1, flexShrink: 0 }}>
              <UserPlus size={14} /> THÊM TÀI KHOẢN
            </button>
          )}
        </div>
      </div>

      {!filterStationId && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '0 20px',
          background: 'var(--admin-panel)',
          borderBottom: '1px solid var(--admin-border)',
          gap: 24,
          flexShrink: 0
        }}>
          <TabButton active={activeTab === 'stations'} onClick={() => { setActiveTab('stations'); setSearchText(''); }}>
            Giám sát theo Trạm
          </TabButton>
          <TabButton active={activeTab === 'teams'} onClick={() => { setActiveTab('teams'); setSearchText(''); }}>
            Tổ Thao Tác Lưu Động
          </TabButton>
          <TabButton active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setSearchText(''); }}>
            Tài khoản Người dùng
          </TabButton>
        </div>
      )}

      <div className="custom-hud-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: (activeTab === 'stations' && filterStationId) ? 0 : 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)' }}>
            <Activity className="animate-spin" style={{ margin: '0 auto 10px' }} /> Đang tải dữ liệu...
          </div>
        ) : activeTab === 'stations' && !filterStationId ? (
          <StationGroupedView
            stationsList={stationsList}
            provincesList={provincesList}
            teamsList={teamsList}
            liveStations={stations}
            getStationUsers={getStationUsers}
            getLastActive={getLastActive}
            setFilterStationId={setFilterStationId}
            collapsedProvinces={collapsedStationProvinces}
            collapsedTeams={collapsedStationTeams}
            setCollapsedProvinces={setCollapsedStationProvinces}
            setCollapsedTeams={setCollapsedStationTeams}
          />
        ) : activeTab === 'teams' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
            {filteredTeamsView.map(t => {
              const teamProvince = provincesList.find(p => p.id === t.provinceId);
              const teamStations = t.stationIds?.map(id => stationsList.find(s => s.id === id)).filter(Boolean) || [];
              const teamMembers = users.filter(u => u.teamId === t.id);

              return (
                <div 
                  key={t.id} 
                  className="multisite-hud-panel" 
                  style={{ 
                    padding: 0, display: 'flex', flexDirection: 'column', 
                    border: '1px solid var(--admin-border)', background: 'rgba(255,255,255,0.02)',
                    borderRadius: 4
                  }}
                >
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }}>
                    <div>
                      <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase' }}>
                        📍 TỈNH: {teamProvince?.name || 'Chưa rõ'}
                      </div>
                      <div style={{ fontSize: '.9rem', fontWeight: 800, color: 'var(--admin-text)' }}>{t.name}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <ActionIcon icon={<Edit2 size={12} />} onClick={() => openEditTeamModal(t)} title="Sửa tổ" />
                      <ActionIcon icon={<Trash2 size={12} />} onClick={() => deleteTeam(t)} danger title="Xóa tổ" />
                    </div>
                  </div>

                  <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {t.description && (
                      <div style={{ fontSize: '.75rem', color: 'var(--admin-text-muted)', lineHeight: 1.4, borderBottom: '1px solid var(--admin-border)', paddingBottom: 10 }}>
                        {t.description}
                      </div>
                    )}

                    <div>
                      <div style={{ fontSize: '.6rem', fontWeight: 900, color: 'var(--admin-text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                        Trạm giám sát phụ trách ({teamStations.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {teamStations.map(s => (
                          <span key={s!.id} style={{ fontSize: '.62rem', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', padding: '2px 6px', border: '1px solid var(--admin-border)', borderRadius: 2 }}>
                            {s!.code || s!.name}
                          </span>
                        ))}
                        {teamStations.length === 0 && (
                          <span style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Chưa gán trạm</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '.6rem', fontWeight: 900, color: 'var(--admin-text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                        Nhân sự trong tổ ({teamMembers.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {teamMembers.map(m => {
                          const role = ROLE_CFG[m.role as keyof typeof ROLE_CFG] ?? ROLE_CFG.operator;
                          return (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'rgba(255,255,255,0.01)', padding: '4px 8px', borderRadius: 2, border: '1px solid rgba(255,255,255,0.02)' }}>
                              <span style={{ flex: 1, minWidth: 0, fontSize: '.72rem', color: 'var(--admin-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.fullName || m.username} <span style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontWeight: 'normal' }}>@{m.username}</span>
                              </span>
                              <span style={{ flexShrink: 0, fontSize: '.58rem', fontWeight: 900, padding: '1px 8px', background: role.bg, color: role.color, borderRadius: 2, border: `1px solid ${role.color}40`, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', minHeight: 22 }}>
                                {role.label}
                              </span>
                            </div>
                          );
                        })}
                        {teamMembers.length === 0 && (
                          <span style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Chưa có thành viên</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 4, overflowX: 'auto', overflowY: 'hidden' }}>
	            <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', textAlign: 'left' }}>
	              <thead>
	                <tr style={{ background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)' }}>
	                  <th style={TH_STYLE}>NHÂN SỰ</th>
	                  <th style={TH_STYLE}>VAI TRÒ</th>
	                  <th style={TH_STYLE}>TỔ CHỨC / TRẠM PHÂN CÔNG</th>
	                  <th style={TH_STYLE}>TRẠNG THÁI HĐ</th>
                  <th style={TH_STYLE}>THỜI GIAN HĐ GẦN NHẤT</th>
                  <th style={{ ...TH_STYLE, textAlign: 'right' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const role = ROLE_CFG[u.role as keyof typeof ROLE_CFG] ?? ROLE_CFG.operator;
                  const lastActive = getLastActive(u.username);
                  const assignedStations = ['admin_province', 'operator_province'].includes(u.role) ? [] : (u.station_ids?.map(id => stationsList.find(s => s.id === id)).filter(Boolean) ?? []);
                  const assignedProvinces = ['admin_province', 'operator_province'].includes(u.role) ? (u.province_ids?.map(id => provincesList.find(p => p.id === id)).filter(Boolean) ?? []) : [];
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
	                          </div>
	                        </div>
	                      </td>
	                      <td style={TD_STYLE}>
	                        <span style={{ fontSize: '.6rem', fontWeight: 900, padding: '2px 8px', background: role.bg, color: role.color, borderRadius: 2, border: `1px solid ${role.color}40` }}>
	                          {role.label}
                        </span>
                      </td>
                      <td style={TD_STYLE}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          {u.role === 'admin' ? (
                            <span style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Toàn cục (Tất cả trạm)</span>
                          ) : ['admin_province', 'operator_province'].includes(u.role) ? (
                            assignedProvinces.length === 0 ? (
                              <span style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Chưa gán tỉnh</span>
                            ) : (
                              assignedProvinces.map(p => (
                                <span key={p!.id} style={{ fontSize: '.6rem', background: 'rgba(13,148,136,0.1)', color: '#0d9488', padding: '1px 5px', border: '1px solid rgba(13,148,136,0.2)', borderRadius: 2 }}>
                                  {p!.name}
                                </span>
                              ))
                            )
                          ) : (
                            <>
                              {u.teamId && (
                                <span style={{ fontSize: '.6rem', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '1px 5px', border: '1px solid rgba(245,158,11,0.22)', borderRadius: 2, fontWeight: 700 }}>
                                  👥 {teamsList.find(t => t.id === u.teamId)?.name || 'Tổ thao tác'}
                                </span>
                              )}
                              {assignedStations.length === 0 ? (
                                !u.teamId && <span style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>Chưa gán trạm</span>
                              ) : (
                                assignedStations.map(s => (
                                  <span key={s!.id} style={{ fontSize: '.6rem', background: 'var(--admin-layer-2)', color: 'var(--admin-text)', padding: '1px 5px', border: '1px solid var(--admin-border)', borderRadius: 2 }}>
                                    {s!.code || s!.name}
                                  </span>
                                ))
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td style={TD_STYLE}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 1, background: isOnline ? 'var(--admin-success)' : 'var(--admin-text-muted)' }} />
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
                          {['multi', 'admin'].includes(u.username) ? (
                            <span style={{ fontSize: '.68rem', color: 'var(--admin-text-muted)', fontStyle: 'italic', paddingRight: 8 }}>
                              Mặc định hệ thống
                            </span>
                          ) : (
                            <>
                              <ActionIcon icon={<Edit2 size={12} />} onClick={() => openEditModal(u)} title="Sửa thông tin / Đổi mật khẩu" />
                              {u.isActive && <ActionIcon icon={<X size={12} />} onClick={() => deactivateUser(u)} danger title="Vô hiệu hóa" />}
                              <ActionIcon icon={<Trash2 size={12} />} onClick={() => permanentDeleteUser(u)} danger title="Xóa vĩnh viễn" />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isUserModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 'min(860px, 95vw)', maxWidth: '95vw' }}>
            <div className="modal-header">
              <h3>{editingUserId ? `CẬP NHẬT TÀI KHOẢN` : 'THÊM TÀI KHOẢN MỚI'}</h3>
              <button className="modal-close-btn" onClick={() => setIsUserModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 'min(75vh, calc(100dvh - 180px))', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
	                  <div style={{ fontSize: '.7rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--admin-border)', paddingBottom: 6 }}>
	                    Thông tin tài khoản
	                  </div>
	                  {!editingUserId && <div className="form-group"><label>Tên đăng nhập *</label><input className="form-input" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} /></div>}
	                  {editingUserId && (
	                    <>
	                      <div className="form-group">
	                        <label>Tài khoản đăng nhập</label>
	                        <input className="form-input" value={`@${formData.username}`} disabled style={{ opacity: 0.8, cursor: 'not-allowed' }} />
	                      </div>
	                      <div className="form-group">
	                        <label>Mật khẩu khởi tạo hiện có</label>
	                        <input
	                          className="form-input"
	                          value={editingUser ? (deriveDisplayedPassword(editingUser) || 'Không hiển thị') : 'Không hiển thị'}
	                          disabled
	                          style={{ opacity: 0.8, cursor: 'not-allowed', fontFamily: 'monospace' }}
	                        />
	                      </div>
	                    </>
	                  )}
	                  <div className="form-group"><label>Họ và tên</label><input className="form-input" value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} /></div>
	                  <div className="form-group"><label>Email</label><input className="form-input" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
	                  {!editingUserId && (
	                    <div className="form-grid-2">
	                      <div className="form-group"><label>Mật khẩu *</label><input className="form-input" type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} /></div>
	                      <div className="form-group"><label>Xác nhận *</label><input className="form-input" type="password" value={formData.confirmPassword} onChange={e => setFormData({...formData, confirmPassword: e.target.value})} /></div>
	                    </div>
	                  )}
	                  {editingUserId && (
	                    <>
	                      <div style={{ fontSize: '.7rem', fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase', borderBottom: '1px solid var(--admin-border)', paddingBottom: 6, marginTop: 4 }}>
	                        Đặt lại mật khẩu
	                      </div>
	                      <div className="form-grid-2">
	                        <div className="form-group"><label>Mật khẩu mới</label><input className="form-input" type="password" value={pwData.newPassword} onChange={e => setPwData({...pwData, newPassword: e.target.value})} placeholder="Để trống nếu không đổi" /></div>
	                        <div className="form-group"><label>Xác nhận lại</label><input className="form-input" type="password" value={pwData.confirmPassword} onChange={e => setPwData({...pwData, confirmPassword: e.target.value})} placeholder="Nhập lại mật khẩu mới" /></div>
	                      </div>
	                      <div style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)' }}>
	                        Nếu nhập mật khẩu mới và lưu, hệ thống sẽ cập nhật ngay trong cùng thao tác chỉnh sửa này.
	                      </div>
	                    </>
	                  )}
	                  <div className="form-group">
                    <label>Vai trò hệ thống</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 12px', marginTop: 5 }}>
                      {Object.entries(ROLE_CFG)
                        .filter(([r]) => {
                          if (!currentUser) return false;
                          if (currentUser.role === 'admin') return true;
                          if (currentUser.role === 'admin_province') {
                            // Admin tỉnh không được tạo admin hoặc admin_province khác
                            return !['admin', 'admin_province'].includes(r);
                          }
                          if (currentUser.role === 'admin_station') {
                            return ['team_leader', 'team_member', 'operator'].includes(r);
                          }
                          if (currentUser.role === 'team_leader') {
                            // Tổ trưởng chỉ tạo được nhân viên tổ và operator
                            return ['team_member', 'operator'].includes(r);
                          }
                          return false;
                        })
                        .map(([r, cfg]) => (
                        <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.75rem', cursor: 'pointer' }}>
                          <input type="radio" name="role" value={r} checked={formData.role === r} onChange={e => {
                            applyRoleToForm(e.target.value);
                          }} /> 
                          {cfg.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {['team_leader', 'team_member', 'operator', 'manager', 'admin_station'].includes(formData.role) && (
                    <div className="form-group" style={{ marginTop: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        Tổ thao tác lưu động 
                        <span style={{ fontSize: '.6rem', color: 'var(--admin-text-muted)', fontWeight: 'normal' }}>(Tùy chọn)</span>
                      </label>
                      <select 
                        className="form-input" 
                        value={formData.teamId} 
                        onChange={e => setFormData({...formData, teamId: e.target.value})}
                        style={{ background: 'var(--admin-layer-2)', color: 'var(--admin-text)', border: '1px solid var(--admin-border)', borderRadius: 4, width: '100%', height: 32, colorScheme: 'dark' }}
                      >
                        <option value="" style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>-- Không tham gia tổ nào --</option>
                        {teamsList.map(t => (
                          <option key={t.id} value={t.id} style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>{t.name} ({provincesList.find(p => p.id === t.provinceId)?.name || 'Tỉnh khác'})</option>
                        ))}
                      </select>
                      {formData.teamId && (
                        <div style={{ fontSize: '.62rem', color: '#ec4899', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          ℹ️ Tài khoản sẽ tự động có quyền giám sát các trạm thuộc tổ này.
                        </div>
                      )}
                    </div>
                  )}

                  {['admin_province', 'operator_province'].includes(formData.role) && (
                    <div className="form-group">
                      <label>Tỉnh được phân công</label>
                      <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--admin-border)', padding: 10, marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--admin-layer-2)', borderRadius: 4 }}>
                        {provincesList.map(p => (
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.7rem', cursor: 'pointer' }}>
                            <input type="checkbox" disabled={isProvinceAdmin} checked={formData.province_ids.includes(p.id)} onChange={() => {
                              const next = formData.province_ids.includes(p.id) ? formData.province_ids.filter(id => id !== p.id) : [...formData.province_ids, p.id];
                              setFormData({...formData, province_ids: next});
                            }} /> {p.name} {p.code ? `(${p.code})` : ''}
                          </label>
                        ))}
                      </div>
                      {isProvinceAdmin && (
                        <div style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>
                          Tài khoản cấp tỉnh do admin tỉnh tạo sẽ bị khóa trong tỉnh được phân công.
                        </div>
                      )}
                    </div>
                  )}

                  {['admin_station', 'manager', 'operator', 'team_leader', 'team_member'].includes(formData.role) && (
                    <div className="form-group">
                      <label>Trạm được phân công riêng</label>
                      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--admin-border)', padding: 10, marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--admin-layer-2)', borderRadius: 4 }}>
                        {stationsList.map(s => (
                          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.7rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={formData.station_ids.includes(s.id)} onChange={() => {
                              const next = formData.station_ids.includes(s.id) ? formData.station_ids.filter(id => id !== s.id) : [...formData.station_ids, s.id];
                              setFormData({...formData, station_ids: next});
                            }} /> {s.name} ({s.code})
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {formData.role === 'admin' && (
                    <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px dashed var(--admin-danger)', color: 'var(--admin-danger)', fontSize: '.7rem', fontWeight: 700, borderRadius: 4 }}>
                      ⚡ Tài khoản ADMIN mặc định có toàn bộ quyền hệ thống và bỏ qua các bộ lọc giới hạn trạm.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: '.7rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--admin-border)', paddingBottom: 6 }}>
                    Quyền hạn chi tiết
                  </div>
                  {formData.role === 'admin' ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, border: '1px dashed var(--admin-border)', borderRadius: 4, background: 'var(--admin-layer-2)' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔓</div>
                        <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--admin-danger)' }}>FULL QUYỀN</div>
                        <div style={{ fontSize: '.65rem', color: 'var(--admin-text-muted)', marginTop: 4 }}>Admin Toàn Cục tự động có tất cả quyền</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ 
                      flex: 1,
                      overflowY: 'auto', 
                      border: '1px solid var(--admin-border)', 
                      padding: 14, 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 14, 
                      background: 'var(--admin-layer-2)',
                      borderRadius: 4
                    }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button 
                          type="button"
                          className="btn-industrial" 
                          style={{ fontSize: '.6rem', padding: '3px 10px', borderRadius: 4 }}
                          onClick={() => setFormData({...formData, permissions: availablePermissions.map(p => p.key)})}
                        >✓ Chọn tất cả</button>
                        <button 
                          type="button"
                          className="btn-industrial" 
                          style={{ fontSize: '.6rem', padding: '3px 10px', borderRadius: 4 }}
                          onClick={() => setFormData({...formData, permissions: []})}
                        >✕ Bỏ tất cả</button>
                      </div>
                      {Object.entries(
                        availablePermissions.reduce((acc, p) => {
                          if (!acc[p.group]) acc[p.group] = [];
                          acc[p.group]!.push(p);
                          return acc;
                        }, {} as Record<string, PermissionInfo[]>)
                      ).map(([groupName, groupPerms]) => (
                        <div key={groupName}>
                          <div style={{ fontSize: '.65rem', fontWeight: 900, color: 'var(--admin-accent)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 4, height: 14, background: 'var(--admin-accent)', borderRadius: 2, display: 'inline-block' }} />
                            {groupName}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 12 }}>
                            {groupPerms.map(p => (
                              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.72rem', cursor: 'pointer', padding: '3px 0' }}>
                                <input 
                                  type="checkbox" 
                                  checked={formData.permissions.includes(p.key)} 
                                  onChange={() => {
                                    const next = formData.permissions.includes(p.key) 
                                      ? formData.permissions.filter(k => k !== p.key) 
                                      : [...formData.permissions, p.key];
                                    setFormData({...formData, permissions: next});
                                  }} 
                                /> 
                                <span>{p.name}</span>
                                <span style={{ fontSize: '.58rem', color: 'var(--admin-text-muted)', fontFamily: 'monospace', marginLeft: 'auto', opacity: 0.7 }}>({p.key})</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" style={{ borderRadius: 4 }} onClick={() => setIsUserModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" style={{ borderRadius: 4 }} onClick={saveUser}>Lưu dữ liệu</button>
            </div>
          </div>
        </div>
      )}

      {isTeamModalOpen && (
        <div className="modal-overlay active">
          <div className="modal-content" style={{ width: 'min(500px, 95vw)', maxWidth: '95vw' }}>
            <div className="modal-header">
              <h3>{editingTeamId ? 'CẬP NHẬT TỔ THAO TÁC' : 'THÊM TỔ THAO TÁC MỚI'}</h3>
              <button className="modal-close-btn" onClick={() => setIsTeamModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label>Tên tổ thao tác *</label>
                <input 
                  className="form-input" 
                  value={teamFormData.name} 
                  onChange={e => setTeamFormData({ ...teamFormData, name: e.target.value })} 
                  placeholder="Ví dụ: Tổ thao tác lưu động 1"
                />
              </div>

              <div className="form-group">
                <label>Mô tả nhiệm vụ</label>
                <textarea 
                  className="form-input" 
                  value={teamFormData.description} 
                  onChange={e => setTeamFormData({ ...teamFormData, description: e.target.value })} 
                  placeholder="Nhập mô tả hoặc ghi chú..."
                  style={{ height: 60, resize: 'none', padding: 8 }}
                />
              </div>

              <div className="form-group">
                <label>Tỉnh quản lý *</label>
                <select 
                  className="form-input"
                  value={teamFormData.provinceId}
                  onChange={e => {
                    setTeamFormData({ ...teamFormData, provinceId: e.target.value, stationIds: [] });
                  }}
                  style={{ background: 'var(--admin-layer-2)', color: 'var(--admin-text)', border: '1px solid var(--admin-border)', borderRadius: 4, width: '100%', height: 32, colorScheme: 'dark' }}
                >
                  <option value="" style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>-- Chọn Tỉnh --</option>
                  {provincesList.map(p => (
                    <option key={p.id} value={p.id} style={{ background: 'var(--admin-panel)', color: 'var(--admin-text)' }}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Trạm giám sát thuộc tổ (chỉ hiển thị theo Tỉnh đã chọn)</label>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--admin-border)', padding: 10, marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--admin-layer-2)', borderRadius: 4 }}>
                  {stationsList.filter(s => s.provinceId === teamFormData.provinceId).map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.7rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={teamFormData.stationIds.includes(s.id)} 
                        onChange={() => {
                          const next = teamFormData.stationIds.includes(s.id) 
                            ? teamFormData.stationIds.filter(id => id !== s.id) 
                            : [...teamFormData.stationIds, s.id];
                          setTeamFormData({ ...teamFormData, stationIds: next });
                        }} 
                      /> 
                      {s.name} ({s.code})
                    </label>
                  ))}
                  {stationsList.filter(s => s.provinceId === teamFormData.provinceId).length === 0 && (
                    <div style={{ fontSize: '.7rem', color: 'var(--admin-text-muted)', fontStyle: 'italic', padding: '10px 0', textAlign: 'center' }}>
                      Vui lòng chọn tỉnh hoặc không có trạm nào thuộc tỉnh này.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-industrial" style={{ borderRadius: 4 }} onClick={() => setIsTeamModalOpen(false)}>Hủy</button>
              <button className="btn-industrial btn-primary" style={{ borderRadius: 4 }} onClick={saveTeam}>Lưu tổ</button>
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

function TabButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 4px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--admin-accent)' : '2px solid transparent',
        color: active ? 'var(--admin-text)' : 'var(--admin-text-muted)',
        fontSize: '.72rem',
        fontWeight: 800,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }}
    >
      {children}
    </button>
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

/* ── Grouped Station View: Tỉnh → Tổ → Trạm ─────────────────── */
function StationGroupedView({
  stationsList, provincesList, teamsList, liveStations,
  getStationUsers, getLastActive, setFilterStationId,
  collapsedProvinces, collapsedTeams, setCollapsedProvinces, setCollapsedTeams,
}: {
  stationsList: Station[];
  provincesList: Province[];
  teamsList: Team[];
  liveStations: Station[];
  getStationUsers: (id: string) => any[];
  getLastActive: (username: string) => string | null;
  setFilterStationId: (id: string) => void;
  collapsedProvinces: Set<string>;
  collapsedTeams: Set<string>;
  setCollapsedProvinces: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCollapsedTeams: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const provMap = Object.fromEntries(provincesList.map(p => [p.id, p.name]));

  // Real-time connection status: merge live store over stale API data
  const liveStatusMap = Object.fromEntries(liveStations.map(s => [s.id, s.connectionStatus ?? 'unknown']));
  const getConnStatus = (id: string) => liveStatusMap[id] ?? stationsList.find(s => s.id === id)?.connectionStatus ?? 'unknown';

  const byProvince = new window.Map<string, Station[]>();
  for (const s of stationsList) {
    const pid = s.provinceId ?? '__none__';
    if (!byProvince.has(pid)) byProvince.set(pid, []);
    byProvince.get(pid)!.push(s);
  }
  const provinceEntries = [...byProvince.entries()].sort(([a], [b]) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return (provMap[a] ?? '').localeCompare(provMap[b] ?? '', 'vi');
  });

  const toggleSP = (id: string) => setCollapsedProvinces(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleST = (id: string) => setCollapsedTeams(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (stationsList.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.75rem' }}>Chưa có trạm nào</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {provinceEntries.map(([pid, pStations]) => {
        const provinceName = pid === '__none__' ? 'Chưa phân tỉnh' : (provMap[pid] ?? pid.slice(0, 8));
        const pCollapsed = collapsedProvinces.has(pid);
        const pUserCount = pStations.reduce((sum: number, st: Station) => sum + getStationUsers(st.id).length, 0);
        const pOnlineCount = pStations.filter(st => getConnStatus(st.id) === 'online').length;

        const byTeam = new window.Map<string, Station[]>();
        for (const s of pStations) {
          const team = teamsList.find(t => t.stationIds?.includes(s.id));
          const tid = team?.id ?? '__none__';
          if (!byTeam.has(tid)) byTeam.set(tid, []);
          byTeam.get(tid)!.push(s);
        }
        const teamEntries = [...byTeam.entries()].sort(([a], [b]) => {
          if (a === '__none__') return 1;
          if (b === '__none__') return -1;
          const na = teamsList.find(t => t.id === a)?.name ?? '';
          const nb = teamsList.find(t => t.id === b)?.name ?? '';
          return na.localeCompare(nb, 'vi');
        });

        return (
          <div key={pid} style={{ border: '1px solid var(--admin-border)', borderRadius: 6, overflow: 'hidden' }}>
            {/* Province header */}
            <div onClick={() => toggleSP(pid)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer', background: 'var(--admin-layer-2)', borderBottom: pCollapsed ? 'none' : '1px solid var(--admin-border)', userSelect: 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--admin-text-muted)', flexShrink: 0 }}>{pCollapsed ? '▸' : '▾'}</span>
              <Map size={12} style={{ color: 'var(--admin-text-muted)', flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: '0.72rem', color: 'var(--admin-text)', flex: 1 }}>{provinceName}</span>
              <span style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)' }}>{pStations.length} trạm</span>
              <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--admin-success)', marginLeft: 10 }}>● {pOnlineCount} online</span>
              <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--admin-text)', marginLeft: 10 }}>{pUserCount} nhân sự</span>
            </div>

            {!pCollapsed && (
              <div>
                {teamEntries.map(([tid, tStations]) => {
                  const teamName = tid === '__none__' ? 'Chưa có tổ' : (teamsList.find(t => t.id === tid)?.name ?? tid.slice(0, 8));
                  const tKey = tid + pid;
                  const tCollapsed = collapsedTeams.has(tKey);
                  const tUserCount = tStations.reduce((sum: number, st: Station) => sum + getStationUsers(st.id).length, 0);
                  const tOnlineCount = tStations.filter(st => getConnStatus(st.id) === 'online').length;

                  return (
                    <div key={tid}>
                      {/* Team sub-header */}
                      <div onClick={() => toggleST(tKey)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px 7px 32px', cursor: 'pointer', background: 'var(--admin-layer-1)', borderBottom: '1px solid var(--admin-border)', userSelect: 'none' }}>
                        <span style={{ fontSize: 11, color: 'var(--admin-text-muted)', flexShrink: 0 }}>{tCollapsed ? '▸' : '▾'}</span>
                        <Users size={11} style={{ color: 'var(--admin-warning)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: '0.65rem', color: 'var(--admin-warning)', flex: 1 }}>{teamName}</span>
                        <span style={{ fontSize: '0.56rem', color: 'var(--admin-text-muted)' }}>{tStations.length} trạm</span>
                        <span style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--admin-success)', marginLeft: 10 }}>● {tOnlineCount} online</span>
                        <span style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--admin-text)', marginLeft: 10 }}>{tUserCount} nhân sự</span>
                      </div>

                      {/* Station rows */}
                      {!tCollapsed && tStations.map((s: Station, i: number) => {
                        const stationUsers = getStationUsers(s.id);
                        const onDutyCount = stationUsers.filter(u => {
                          const last = getLastActive(u.username);
                          return last && (Date.now() - new Date(last).getTime() < 15 * 60 * 1000);
                        }).length;
                        const connStatus = getConnStatus(s.id);
                        const isOnline = connStatus === 'online';
                        const isLast = i === tStations.length - 1;

                        return (
                          <div key={s.id}
                            onClick={() => setFilterStationId(s.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 52px', borderBottom: isLast ? 'none' : '1px solid var(--admin-border)', cursor: 'pointer', transition: 'background 0.12s' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            {/* Connection status dot */}
                            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isOnline ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: isOnline ? '0 0 5px var(--admin-success)' : 'none' }} />
                            <span style={{ fontSize: '0.58rem', fontWeight: 800, color: isOnline ? 'var(--admin-success)' : 'var(--admin-danger)', flexShrink: 0, letterSpacing: '0.04em' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '0.63rem', color: 'var(--admin-accent)', flexShrink: 0, width: 90 }}>{s.code || s.id.slice(0, 8).toUpperCase()}</span>
                            <span style={{ fontWeight: 600, fontSize: '0.68rem', color: 'var(--admin-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                              <Users size={10} style={{ color: 'var(--admin-text-muted)' }} />
                              <span style={{ fontSize: '0.6rem', fontWeight: 700, color: onDutyCount > 0 ? 'var(--admin-text)' : 'var(--admin-text-muted)', fontFamily: 'monospace' }}>
                                {onDutyCount}/{stationUsers.length} TRỰC
                              </span>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', marginLeft: 6 }}>›</span>
                          </div>
                        );
                      })}
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
