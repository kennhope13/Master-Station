// ============================================================
// CentralDeviceView.tsx — Trang thiết bị đa trạm
// Dashboard tổng quan + drill-down từng trạm
// Tính năng: Dashboard, nhóm/bảng/thẻ, tìm/lọc/sắp xếp,
//   test kết nối, sửa nhanh, xóa, copy IP, thêm mới,
//   xuất CSV, chọn hàng loạt, auto-refresh
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertCircle, CheckSquare, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Copy, Cpu, Download, Edit3, FileSpreadsheet, FileText,
  Plus, RefreshCw, Server, Thermometer, Trash2, Video, Wifi, X, Zap,
} from 'lucide-react';
import type { Station, Device, Province } from '@/types/api.types';
import { DEVICE_TYPE_LABELS, DEV_CAM_TYPES } from '@/constants/devices';
import { stationApi } from '@/services/StationApiService';
import { confirmDialog } from '@/utils/confirm';
import './CentralDeviceView.css';

// ── Types ─────────────────────────────────────────────────────
type SortField = 'name' | 'type' | 'ip' | 'status';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'online' | 'offline' | 'maintenance';
type ViewMode = 'grouped' | 'table' | 'cards';

interface Props {
  stations: Station[];
  provinces: Province[];
  devicesByStation: Record<string, Device[]>;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
  onRefresh: () => void;
  alertsByStation?: Record<string, number>; // stationId → số cảnh báo đang mở
}

const ADD_FORM_INIT = {
  name: '', type: 'camera_cctv', ip: '',
  username: '', password: '',
  rtspPath: '', go2rtcId: '',
  rtspOptical: '', go2rtcOptical: '',
  rtspThermal: '', go2rtcThermal: '',
  rack: '0', slot: '1', db: '32',
};

interface StationSummary {
  id: string;
  name: string;
  code: string;
  provinceName: string;
  total: number;
  online: number;
  offline: number;
  maintenance: number;
  filteredTotal: number;
  topTypes: [string, number][];
  healthPct: number;
  alertCount: number;
}

interface DeviceGroup {
  type: string;
  label: string;
  devices: Device[];
  online: number;
  total: number;
}

interface ProvinceSummary {
  name: string;
  stationCount: number;
  total: number;
  online: number;
  offline: number;
  maintenance: number;
  filteredTotal: number;
  topTypes: [string, number][];
  healthPct: number;
  alertCount: number;
}

interface ProvinceStationGroup {
  summary: ProvinceSummary;
  stations: StationSummary[];
}

interface TestResult {
  ok: boolean;
  msg: string;
  pending: boolean;
}

// ── Constants ─────────────────────────────────────────────────
const TYPE_LABELS = DEVICE_TYPE_LABELS;

const TYPE_ICONS: Record<string, (size?: number) => React.ReactElement> = {
  plc_s7: (s = 14) => <Cpu size={s} />,
  modbus_tcp: (s = 14) => <Server size={s} />,
  cabinet: (s = 14) => <Cpu size={s} />,
  camera_thermal: (s = 14) => <Thermometer size={s} />,
  camera_pd: (s = 14) => <Zap size={s} />,
  camera_cctv: (s = 14) => <Video size={s} />,
  camera_dual: (s = 14) => <Video size={s} />,
};

const TYPE_COLORS: Record<string, string> = {
  plc_s7: '#3b82f6',
  modbus_tcp: '#f59e0b',
  cabinet: '#06b6d4',
  camera_thermal: '#ef4444',
  camera_pd: '#8b5cf6',
  camera_dual: '#0ea5e9',
  camera_cctv: '#22c55e',
};

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tất cả',
  online: 'Online',
  offline: 'Offline',
  maintenance: 'Bảo trì',
};

const SORT_FIELD_LABELS: Record<SortField, string> = {
  name: 'Tên',
  type: 'Loại',
  ip: 'IP',
  status: 'TT',
};

// ── Helper: icon & color ──────────────────────────────────────
function deviceIcon(type: string, size = 14): React.ReactElement {
  const fn = TYPE_ICONS[type];
  return fn ? fn(size) : <Cpu size={size} />;
}

function deviceColor(type: string): string {
  return TYPE_COLORS[type] || '#64748b';
}

function statusDot(status: string): string {
  if (status === 'online') return '🟢';
  if (status === 'maintenance') return '🟡';
  return '🔴';
}

function statusBadgeColor(status: string): string {
  if (status === 'online') return 'var(--admin-success)';
  if (status === 'maintenance') return 'var(--admin-warning)';
  return 'var(--admin-danger)';
}

function statusLabel(status: string): string {
  if (status === 'online') return 'Online';
  if (status === 'maintenance') return 'Bảo trì';
  return 'Offline';
}

function healthColor(pct: number): string {
  if (pct >= 80) return 'var(--admin-success)';
  if (pct >= 40) return 'var(--admin-warning)';
  return 'var(--admin-danger)';
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function parseStationAddress(location?: string): string {
  if (!location) return '';
  try {
    const parsed = JSON.parse(location);
    return typeof parsed?.address === 'string' ? parsed.address : '';
  } catch {
    return '';
  }
}

function extractProvinceName(address: string): string {
  const rawAddress = address.trim();
  if (!rawAddress) return 'Chưa phân tỉnh';

  const segments = rawAddress
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  if (segments.length === 0) return 'Chưa phân tỉnh';

  const preferred = [...segments].reverse().find(part =>
    /^(Tỉnh|Thành phố|TP\.?|TP )/i.test(part)
  );

  return preferred || segments[segments.length - 1] || 'Chưa phân tỉnh';
}

// ── Component ─────────────────────────────────────────────────
export default function CentralDeviceView({
  stations,
  provinces,
  devicesByStation,
  selectedStationId,
  onSelectStation,
  onRefresh,
  alertsByStation,
}: Props) {
  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');

  // Sort
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const [refreshing, setRefreshing] = useState(false);

  // Expand groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Test results cache
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Edit modal
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState({ name: '', ip: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Add device modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ ...ADD_FORM_INIT });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [addShowPassword, setAddShowPassword] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [expandedProvinces, setExpandedProvinces] = useState<Set<string>>(new Set());

  // Province / station quick-filter (toolbar dropdowns)
  const [filterProvince, setFilterProvince] = useState('');
  const [filterStation, setFilterStation]   = useState('');

  // Export dropdown
  const [downloadDropdownOpen, setDownloadDropdownOpen] = useState(false);
  const downloadDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!downloadDropdownOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (downloadDropdownRef.current && !downloadDropdownRef.current.contains(event.target as Node)) {
        setDownloadDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [downloadDropdownOpen]);

  const isDrilldown = Boolean(selectedStationId);

  // ── Derived: all device types across stations ──────────────
  const allTypes = useMemo(() => {
    const s = new Set<string>();
    Object.values(devicesByStation).forEach(ds => ds.forEach(d => s.add(d.type)));
    return [...s].sort();
  }, [devicesByStation]);

  // ── Derived: flat all devices ──────────────────────────────
  const allDevices = useMemo(() => {
    const result: { stationId: string; stationCode: string; device: Device }[] = [];
    stations.forEach(s => {
      (devicesByStation[s.id] ?? []).forEach(d => {
        result.push({ stationId: s.id, stationCode: s.code || s.id.slice(0, 8).toUpperCase(), device: d });
      });
    });
    return result;
  }, [stations, devicesByStation]);

  // ── Derived: station summaries ─────────────────────────────
  const stationSummaries = useMemo(() => stations.map(s => {
    const devices = devicesByStation[s.id] ?? [];
    const online = devices.filter(d => d.status === 'online').length;
    const maintenance = devices.filter(d => d.status === 'maintenance').length;
    const offline = devices.length - online - maintenance;

    // Apply filters for display purposes
    let filtered = [...devices];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.config?.ip || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'online') filtered = filtered.filter(d => d.status === 'online');
    else if (statusFilter === 'offline') filtered = filtered.filter(d => d.status !== 'online' && d.status !== 'maintenance');
    else if (statusFilter === 'maintenance') filtered = filtered.filter(d => d.status === 'maintenance');
    if (typeFilter) filtered = filtered.filter(d => d.type === typeFilter);

    // Type counts (for badges on card)
    const typeCounts: Record<string, number> = {};
    devices.forEach(d => { typeCounts[d.type] = (typeCounts[d.type] || 0) + 1; });
    const topTypes = Object.entries(typeCounts).sort(([, a], [, b]) => b - a).slice(0, 4);

    const provinceName =
      (s.provinceId ? provinces.find(p => p.id === s.provinceId)?.name : undefined) ||
      extractProvinceName(parseStationAddress(s.location));

    return {
      id: s.id,
      name: s.name,
      code: s.code || s.id.slice(0, 8).toUpperCase(),
      provinceName,
      total: devices.length,
      online,
      offline,
      maintenance,
      filteredTotal: filtered.length,
      topTypes,
      healthPct: devices.length ? Math.round((online / devices.length) * 100) : 0,
      alertCount: alertsByStation?.[s.id] ?? 0,
    };
  }).filter(s => {
    // In dashboard mode, hide stations with zero filtered results when filtering
    if (!isDrilldown && (searchQuery || statusFilter !== 'all' || typeFilter)) {
      return s.filteredTotal > 0;
    }
    return true;
  }), [stations, devicesByStation, searchQuery, statusFilter, typeFilter, isDrilldown, alertsByStation, provinces]);

  const provinceSummaries = useMemo<ProvinceSummary[]>(() => {
    const groups = new Map<string, StationSummary[]>();
    stationSummaries.forEach(summary => {
      const list = groups.get(summary.provinceName) || [];
      list.push(summary);
      groups.set(summary.provinceName, list);
    });

    return [...groups.entries()]
      .map(([name, group]) => {
        const typeCounts: Record<string, number> = {};
        group.forEach(summary => {
          const devices = devicesByStation[summary.id] ?? [];
          devices.forEach(device => {
            if (searchQuery.trim()) {
              const q = searchQuery.trim().toLowerCase();
              const matchesQuery =
                device.name.toLowerCase().includes(q) ||
                (device.config?.ip || '').toLowerCase().includes(q);
              if (!matchesQuery) return;
            }
            if (statusFilter === 'online' && device.status !== 'online') return;
            if (statusFilter === 'offline' && (device.status === 'online' || device.status === 'maintenance')) return;
            if (statusFilter === 'maintenance' && device.status !== 'maintenance') return;
            if (typeFilter && device.type !== typeFilter) return;
            typeCounts[device.type] = (typeCounts[device.type] || 0) + 1;
          });
        });

        const total = group.reduce((sum, summary) => sum + summary.total, 0);
        const online = group.reduce((sum, summary) => sum + summary.online, 0);
        const offline = group.reduce((sum, summary) => sum + summary.offline, 0);
        const maintenance = group.reduce((sum, summary) => sum + summary.maintenance, 0);
        const filteredTotal = group.reduce((sum, summary) => sum + summary.filteredTotal, 0);
        const alertCount = group.reduce((sum, summary) => sum + summary.alertCount, 0);

        return {
          name,
          stationCount: group.length,
          total,
          online,
          offline,
          maintenance,
          filteredTotal,
          topTypes: Object.entries(typeCounts).sort(([, a], [, b]) => b - a).slice(0, 4),
          healthPct: total ? Math.round((online / total) * 100) : 0,
          alertCount,
        };
      })
      .filter(group => {
        if (searchQuery || statusFilter !== 'all' || typeFilter) {
          return group.filteredTotal > 0;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [stationSummaries, devicesByStation, searchQuery, statusFilter, typeFilter]);

  const provinceStationGroups = useMemo<ProvinceStationGroup[]>(() => {
    return provinceSummaries.map(summary => ({
      summary,
      stations: stationSummaries
        .filter(station => station.provinceName === summary.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    }));
  }, [provinceSummaries, stationSummaries]);

  // ── Derived: province options for toolbar dropdown ─────────
  const provinceOptions = useMemo(
    () => [...new Set(stationSummaries.map(s => s.provinceName))].sort((a, b) => a.localeCompare(b, 'vi')),
    [stationSummaries]
  );

  // ── Derived: station options (filtered by filterProvince) ──
  const stationOptions = useMemo(
    () => filterProvince
      ? stationSummaries.filter(s => s.provinceName === filterProvince)
      : stationSummaries,
    [stationSummaries, filterProvince]
  );

  // ── Derived: province groups after toolbar filter ──────────
  const visibleProvinceStationGroups = useMemo(
    () => filterProvince
      ? provinceStationGroups.filter(g => g.summary.name === filterProvince)
      : provinceStationGroups,
    [provinceStationGroups, filterProvince]
  );

  // ── Derived: current station ───────────────────────────────
  const currentStation = useMemo(
    () => stationSummaries.find(s => s.id === selectedStationId) || null,
    [selectedStationId, stationSummaries]
  );

  useEffect(() => {
    if (selectedStationId && currentStation?.provinceName) {
      setSelectedProvince(currentStation.provinceName);
    }
  }, [selectedStationId, currentStation]);

  useEffect(() => {
    if (!selectedProvince) return;
    if (!provinceSummaries.some(summary => summary.name === selectedProvince)) {
      setSelectedProvince(null);
    }
  }, [provinceSummaries, selectedProvince]);

  useEffect(() => {
    setExpandedProvinces(prev => {
      const available = new Set(provinceSummaries.map(summary => summary.name));
      const next = new Set([...prev].filter(name => available.has(name)));
      if (searchQuery || statusFilter !== 'all' || typeFilter) {
        return new Set(provinceSummaries.map(summary => summary.name));
      }
      if (next.size === 0 && provinceSummaries[0]) {
        next.add(provinceSummaries[0].name);
      }
      return next;
    });
  }, [provinceSummaries, searchQuery, statusFilter, typeFilter]);

  // ── Derived: filtered & sorted devices for drilldown ───────
  const drilldownDevices = useMemo(() => {
    if (!selectedStationId) return [];
    let devices = [...(devicesByStation[selectedStationId] ?? [])];

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      devices = devices.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.config?.ip || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'online') devices = devices.filter(d => d.status === 'online');
    else if (statusFilter === 'offline') devices = devices.filter(d => d.status !== 'online' && d.status !== 'maintenance');
    else if (statusFilter === 'maintenance') devices = devices.filter(d => d.status === 'maintenance');
    if (typeFilter) devices = devices.filter(d => d.type === typeFilter);

    // Sort
    return [...devices].sort((a, b) => {
      let va = '', vb = '';
      switch (sortField) {
        case 'name':
          va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case 'type':
          va = (TYPE_LABELS[a.type] || a.type).toLowerCase();
          vb = (TYPE_LABELS[b.type] || b.type).toLowerCase(); break;
        case 'ip':
          va = (a.config?.ip || '').toLowerCase();
          vb = (b.config?.ip || '').toLowerCase(); break;
        case 'status':
          va = a.status; vb = b.status; break;
      }
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [selectedStationId, devicesByStation, searchQuery, statusFilter, typeFilter, sortField, sortDir]);

  // ── Derived: device groups ─────────────────────────────────
  const deviceGroups: DeviceGroup[] = useMemo(() => {
    const groups: Record<string, Device[]> = {};
    drilldownDevices.forEach(d => {
      (groups[d.type] ??= []).push(d);
    });
    return Object.entries(groups).map(([type, devices]) => ({
      type,
      label: TYPE_LABELS[type] || type,
      devices,
      online: devices.filter(d => d.status === 'online').length,
      total: devices.length,
    }));
  }, [drilldownDevices]);

  // ── Derived: fleet summary ─────────────────────────────────
  const fleetSummary = useMemo(() => {
    const online = allDevices.filter(x => x.device.status === 'online').length;
    const maintenance = allDevices.filter(x => x.device.status === 'maintenance').length;
    const offline = allDevices.length - online - maintenance;
    return {
      stationCount: stations.length,
      totalDevices: allDevices.length,
      onlineDevices: online,
      maintenanceDevices: maintenance,
      offlineDevices: offline,
    };
  }, [allDevices, stations]);

  const doRefresh = useCallback(() => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 500);
  }, [onRefresh]);

  // ── Handlers ────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const toggleGroup = (type: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const toggleProvince = (name: string) => {
    setExpandedProvinces(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const expandAllGroups = () => {
    setExpandedGroups(new Set(deviceGroups.map(g => g.type)));
  };

  // Auto-expand all groups when entering drilldown
  useEffect(() => {
    if (isDrilldown && viewMode === 'grouped') {
      expandAllGroups();
    }
  }, [isDrilldown, selectedStationId]);

  const openEditModal = (device: Device) => {
    setEditingDevice(device);
    setEditForm({ name: device.name, ip: device.config?.ip || '' });
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingDevice) return;
    if (!editForm.name.trim()) {
      setEditError('Vui lòng nhập tên thiết bị');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await stationApi.updateDevice(editingDevice.id, {
        name: editForm.name.trim(),
        config: JSON.stringify({ ...editingDevice.config, ip: editForm.ip.trim() }),
      });
      setEditingDevice(null);
      doRefresh();
    } catch (e: any) {
      setEditError(e.message || 'Lỗi khi lưu');
    } finally {
      setEditSaving(false);
    }
  };

  const openAddModal = () => {
    setAddForm({ ...ADD_FORM_INIT });
    setAddError('');
    setAddModalOpen(true);
  };

  const saveNewDevice = async () => {
    if (!addForm.name.trim()) { setAddError('Vui lòng nhập tên thiết bị'); return; }
    if (!selectedStationId) return;
    setAddSaving(true);
    setAddError('');
    try {
      const ip = addForm.ip.trim();
      const configObj: Record<string, any> = { ip };
      let protocol = 'modbus';

      if (addForm.type === 'plc_s7') {
        protocol = 'snap7';
        Object.assign(configObj, { rack: addForm.rack, slot: addForm.slot, db: addForm.db, offset: 0, length: 10 });
      } else if (addForm.type === 'cabinet') {
        protocol = 'json';
      } else if (addForm.type === 'camera_dual') {
        protocol = 'rtsp';
        const ipTag = ip.replace(/\./g, '_');
        const gOpt = addForm.go2rtcOptical.trim() || `cam_${ipTag || 'camera'}_optical`;
        const gThr = addForm.go2rtcThermal.trim() || `cam_${ipTag || 'camera'}_thermal`;
        const rtspOptical = addForm.rtspOptical.trim() || '/Streaming/Channels/101';
        const rtspThermal = addForm.rtspThermal.trim() || '/Streaming/Channels/201';
        Object.assign(configObj, { rtsp_optical: rtspOptical, go2rtc_optical: gOpt, rtsp_thermal: rtspThermal, go2rtc_thermal: gThr, username: addForm.username, password: addForm.password });
      } else if (addForm.type === 'camera_thermal') {
        protocol = 'rtsp';
        const ipTag = ip.replace(/\./g, '_');
        const gThr = addForm.go2rtcThermal.trim() || `cam_${ipTag || 'camera'}_thermal`;
        const rtspThermal = addForm.rtspThermal.trim() || '/Streaming/Channels/201';
        Object.assign(configObj, { rtsp_thermal: rtspThermal, go2rtc_thermal: gThr, username: addForm.username, password: addForm.password });
      } else if (addForm.type.startsWith('camera')) {
        protocol = 'rtsp';
        let rp = addForm.rtspPath.trim();
        if (rp && !rp.startsWith('/')) rp = '/' + rp;
        const gid = addForm.go2rtcId.trim() || `camera_${ip.replace(/\./g, '_')}_${addForm.type.replace('camera_', '')}`;
        Object.assign(configObj, { rtsp_path: rp, go2rtc_id: gid, username: addForm.username, password: addForm.password });
      } else if (addForm.type === 'modbus_tcp') {
        Object.assign(configObj, { port: 502, unit_id: 1 });
      }

      await stationApi.createDevice({ stationId: selectedStationId, name: addForm.name.trim(), type: addForm.type, protocol, config: JSON.stringify(configObj) });
      setAddModalOpen(false);
      doRefresh();
      showToast('Đã thêm thiết bị');
    } catch (e: any) {
      let msg = e.message;
      try {
        const parsed = JSON.parse(e.message);
        if (parsed.message) msg = parsed.message;
        else if (parsed.error) msg = parsed.error;
      } catch {}
      setAddError(msg || 'Lỗi khi thêm thiết bị');
    } finally {
      setAddSaving(false);
    }
  };

  const handleDelete = async (device: Device) => {
    if (!await confirmDialog({
      title: 'Xóa thiết bị',
      message: `Xóa thiết bị "${device.name}"?\nHành động này không thể hoàn tác.`,
      confirmText: 'Xóa',
      danger: true,
    })) return;

    try {
      await stationApi.deleteDevice(device.id);
      doRefresh();
      showToast(`Đã xóa "${device.name}"`);
    } catch {
      showToast('Xóa thất bại');
    }
  };

  const handleTest = async (device: Device) => {
    const id = device.id;
    setTestResults(prev => ({
      ...prev,
      [id]: { ok: false, msg: 'Đang kiểm tra...', pending: true },
    }));
    try {
      const result = await stationApi.testProtocolConnection(
        device.config?.ip || '',
        device.config?.port || 502,
        device.type
      );
      setTestResults(prev => ({
        ...prev,
        [id]: {
          ok: result.success,
          msg: result.success
            ? `OK — ${result.latencyMs ?? '?'}ms`
            : `Thất bại: ${result.message || 'Không xác định'}`,
          pending: false,
        },
      }));
    } catch (e: any) {
      setTestResults(prev => ({
        ...prev,
        [id]: { ok: false, msg: `Lỗi: ${e.message}`, pending: false },
      }));
    }
    // Clear result after 8s
    setTimeout(() => {
      setTestResults(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 8000);
  };

  const handleCopyIP = (ip: string) => {
    copyToClipboard(ip);
    showToast('Đã sao chép IP');
  };

  const canTest = (device: Device): boolean => {
    if (device.type === 'plc_s7' || device.type === 'modbus_tcp') return true;
    if (DEV_CAM_TYPES.some(t => device.type?.includes(t))) return true;
    return false;
  };

  // Bulk selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === drilldownDevices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drilldownDevices.map(d => d.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!await confirmDialog({
      title: 'Xóa hàng loạt',
      message: `Xóa ${selectedIds.size} thiết bị đã chọn?\nHành động này không thể hoàn tác.`,
      confirmText: `Xóa ${selectedIds.size} thiết bị`,
      danger: true,
    })) return;

    setBulkDeleting(true);
    let success = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        await stationApi.deleteDevice(id);
        success++;
      } catch { fail++; }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    doRefresh();
    showToast(`Đã xóa ${success} thiết bị${fail > 0 ? `, ${fail} thất bại` : ''}`);
  };

  // Export CSV
  const handleExportCSV = () => {
    const devices = isDrilldown ? drilldownDevices : allDevices.map(x => x.device);
    const headers = ['Tên', 'Loại', 'IP', 'Cổng', 'Trạng thái', 'Trạm', 'Ngày tạo'];
    const rows = devices.map(d => [
      d.name,
      TYPE_LABELS[d.type] || d.type,
      d.config?.ip || '',
      d.config?.port || '',
      statusLabel(d.status),
      isDrilldown ? (currentStation?.name || '') : (stations.find(s => s.id === d.stationId)?.name || ''),
      new Date(d.createdAt).toLocaleDateString('vi-VN'),
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thiet-bi-${isDrilldown ? currentStation?.code || 'tram' : 'da-tram'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã xuất CSV');
  };

  const handleExportXLSX = () => {
    const devices = isDrilldown ? drilldownDevices : allDevices.map(x => x.device);
    if (devices.length === 0) {
      alert('Không có dữ liệu để xuất XLSX');
      return;
    }

    const rows = devices.map(d => ({
      'Tên thiết bị': d.name,
      'Loại': TYPE_LABELS[d.type] || d.type,
      'IP': d.config?.ip || '',
      'Cổng': d.config?.port || '',
      'Trạng thái': statusLabel(d.status),
      'Trạm': isDrilldown ? (currentStation?.name || '') : (stations.find(s => s.id === d.stationId)?.name || ''),
      'Ngày tạo': new Date(d.createdAt).toLocaleDateString('vi-VN'),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 28 },
      { wch: 20 },
      { wch: 18 },
      { wch: 10 },
      { wch: 16 },
      { wch: 24 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'ThietBi');
    XLSX.writeFile(wb, `thiet-bi-${isDrilldown ? currentStation?.code || 'tram' : 'da-tram'}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('Đã xuất XLSX');
  };

  const handleExportPDF = () => {
    const devices = isDrilldown ? drilldownDevices : allDevices.map(x => x.device);
    if (devices.length === 0) {
      alert('Không có dữ liệu để xuất PDF');
      return;
    }
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    const rowsHtml = devices.map(d => {
      const stationName = isDrilldown ? (currentStation?.name || '') : (stations.find(s => s.id === d.stationId)?.name || '');
      const statusText = statusLabel(d.status);
      const ipText = d.config?.ip || '—';
      const portText = d.config?.port || '—';
      return `
        <tr>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;font-weight:bold;">${d.name}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${TYPE_LABELS[d.type] || d.type}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;font-family:monospace;">${ipText}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${portText}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${statusText}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${stationName}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;font-family:monospace;font-size:11px;">${new Date(d.createdAt).toLocaleDateString('vi-VN')}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Danh sách thiết bị</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #111; background: #fff; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background: #f3f4f6; padding: 8px; font-size: 11px; text-transform: uppercase; font-weight: bold; border: 1px solid #e5e7eb; text-align: left; }
          h2 { color: #1a56db; margin: 0 0 10px 0; }
          .meta { font-size: 11px; color: #6b7280; margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <h2>DANH SÁCH THIẾT BỊ</h2>
        <div class="meta">
          Thời gian xuất: <b>${new Date().toLocaleString('vi-VN')}</b> &nbsp;|&nbsp;
          Trạm: <b>${isDrilldown ? currentStation?.name || 'Chi tiết' : 'Đa trạm'}</b> &nbsp;|&nbsp;
          Số lượng: <b>${devices.length} thiết bị</b>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tên thiết bị</th>
              <th>Loại</th>
              <th>IP</th>
              <th>Cổng</th>
              <th>Trạng thái</th>
              <th>Trạm</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `;

    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.print();
    }, 400);
  };

  // Toast
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // ── Clear search when switching stations ────────────────────
  const handleBackToStations = () => {
    onSelectStation(null);
    setFilterStation('');
    setViewMode('grouped');
    setSelectedIds(new Set());
  };

  // ── Render helpers ──────────────────────────────────────────

  const renderStatusBadge = (status: string) => (
    <span className="cdv-badge" style={{ color: statusBadgeColor(status) }}>
      {statusDot(status)} {statusLabel(status)}
    </span>
  );

  const renderDeviceCard = (device: Device, compact = false) => {
    const testResult = testResults[device.id];
    const isSelected = selectedIds.has(device.id);
    const canTestDevice = canTest(device);

    return (
      <div key={device.id} className={`cdv-device-card ${isSelected ? 'selected' : ''} ${compact ? 'compact' : ''}`}>
        {/* Selection checkbox */}
        {!compact && (
          <div className="cdv-device-check" onClick={() => toggleSelect(device.id)}>
            <CheckSquare size={14} style={{ opacity: isSelected ? 1 : 0.2 }} />
          </div>
        )}

        {/* Header */}
        <div className="cdv-device-header">
          <span className="cdv-device-dot" style={{ background: statusBadgeColor(device.status) }} />
          <b>{device.name}</b>
          {renderStatusBadge(device.status)}
        </div>

        {/* Info */}
        <div className="cdv-device-info">
          <span className="cdv-device-icon" style={{ color: deviceColor(device.type) }}>
            {deviceIcon(device.type, 16)}
          </span>
          <div>
            <div className="cdv-device-type">{TYPE_LABELS[device.type] || device.type}</div>
            <small>
              IP: {device.config?.ip || '—'}
              {device.config?.port && <> · Cổng {device.config?.port}</>}
              {device.protocol && <> · {device.protocol}</>}
            </small>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`cdv-test-result ${testResult.ok ? 'ok' : testResult.pending ? 'pending' : 'fail'}`}>
            {testResult.pending && <RefreshCw size={9} className="cdv-spin" />}
            {testResult.msg}
          </div>
        )}

        {/* Actions */}
        <div className="cdv-device-actions">
          {/* Copy IP */}
          {device.config?.ip && (
            <button
              title="Sao chép IP"
              onClick={() => handleCopyIP(device.config.ip)}
            >
              <Copy size={11} />
            </button>
          )}
          {/* Edit */}
          <button title="Sửa" onClick={() => openEditModal(device)}>
            <Edit3 size={11} />
          </button>
          {/* Test */}
          {canTestDevice && (
            <button
              title="Kiểm tra kết nối"
              onClick={() => handleTest(device)}
              disabled={testResult?.pending}
            >
              <Wifi size={11} />
            </button>
          )}
          {/* Delete */}
          <button className="danger" title="Xóa" onClick={() => handleDelete(device)}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    );
  };

  // ── Main Render ─────────────────────────────────────────────

  return (
    <div className="cdv-root">
      {/* ═══ TOOLBAR ═══ */}
      <div className="cdv-toolbar">
        <div className="cdv-toolbar-left">
          {isDrilldown && (
            <button className="cdv-back-btn" onClick={handleBackToStations}>
              <ChevronLeft size={14} /> {selectedProvince || 'Tất cả trạm'}
            </button>
          )}

          <div className="cdv-title-group">
            <Cpu size={13} className="cdv-title-icon" />
            <h2 className="cdv-title">
              {isDrilldown ? currentStation?.name || 'Chi tiết' : 'Thiết bị đa trạm'}
            </h2>
            {isDrilldown && currentStation?.code && (
              <span className="cdv-title-code">{currentStation.code}</span>
            )}
          </div>

          <button className="cdv-refresh-btn" onClick={doRefresh} disabled={refreshing} title="Làm mới">
            <RefreshCw size={11} className={refreshing ? 'cdv-spin' : ''} />
          </button>
        </div>

        <div className="cdv-toolbar-right">
          {/* Province filter */}
          {!isDrilldown && provinceOptions.length > 1 && (
            <label className="cdv-filter-label">
              <span>Tỉnh</span>
              <select
                className="cdv-select"
                value={filterProvince}
                onChange={e => {
                  setFilterProvince(e.target.value);
                  setFilterStation('');
                  if (e.target.value) {
                    setExpandedProvinces(new Set([e.target.value]));
                  }
                }}
              >
                <option value="">Tất cả tỉnh</option>
                {provinceOptions.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          )}

          {/* Station filter */}
          {!isDrilldown && (
            <label className="cdv-filter-label">
              <span>Trạm</span>
              <select
                className="cdv-select"
                value={filterStation}
                onChange={e => {
                  setFilterStation(e.target.value);
                  if (e.target.value) {
                    setSelectedProvince(stationSummaries.find(s => s.id === e.target.value)?.provinceName ?? null);
                    onSelectStation(e.target.value);
                    setViewMode('table');
                  }
                }}
              >
                <option value="">Tất cả trạm</option>
                {stationOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* Status filter */}
          <label className="cdv-filter-label">
            <span>Trạng thái</span>
            <select
              className="cdv-select"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            >
              {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map(key => (
                <option key={key} value={key}>{STATUS_FILTER_LABELS[key]}</option>
              ))}
            </select>
          </label>

          {/* Type filter */}
          {allTypes.length > 0 && (
            <label className="cdv-filter-label">
              <span>Loại thiết bị</span>
              <select
                className="cdv-select"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="">Tất cả loại</option>
                {allTypes.map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
                ))}
              </select>
            </label>
          )}

          {/* Export */}
          <div ref={downloadDropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button
              className="cdv-chip"
              onClick={() => setDownloadDropdownOpen(v => !v)}
              title="Xuất dữ liệu"
            >
              <Download size={11} />
              <span>Xuất</span>
              <span style={{ fontSize: '.5rem', opacity: 0.7, marginLeft: 2 }}>▼</span>
            </button>

            {downloadDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  background: '#0b0f14',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 3,
                  boxShadow: '0 4px 12px rgba(0,0,0,.5)',
                  padding: '4px 0',
                  zIndex: 30,
                  minWidth: 120,
                }}
              >
                <button
                  onClick={() => {
                    handleExportXLSX();
                    setDownloadDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--admin-text)',
                    padding: '6px 12px',
                    fontSize: '.65rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <FileSpreadsheet size={12} style={{ color: 'var(--admin-accent)' }} />
                  <span>Tải file XLSX</span>
                </button>
                <button
                  onClick={() => {
                    handleExportCSV();
                    setDownloadDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--admin-text)',
                    padding: '6px 12px',
                    fontSize: '.65rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <FileSpreadsheet size={12} style={{ color: 'var(--admin-success)' }} />
                  <span>Tải file CSV</span>
                </button>
                <button
                  onClick={() => {
                    handleExportPDF();
                    setDownloadDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--admin-text)',
                    padding: '6px 12px',
                    fontSize: '.65rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--admin-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <FileText size={12} style={{ color: 'var(--admin-warning)' }} />
                  <span>Tải file PDF</span>
                </button>
              </div>
            )}
          </div>

          {/* Add device — chỉ hiện khi đang xem 1 trạm cụ thể */}
          {isDrilldown && (
            <button className="cdv-chip primary" onClick={openAddModal}>
              <Plus size={11} /> Thêm thiết bị
            </button>
          )}
        </div>
      </div>

      {/* ═══ SUMMARY BAR ═══ */}
      <div className="cdv-summary">
        <span>{fleetSummary.stationCount} trạm</span>
        <span className="cdv-summary-divider" />
        <span>{fleetSummary.onlineDevices}/{fleetSummary.totalDevices} online</span>
        <span className="cdv-summary-divider" />
        <span>
          {isDrilldown
            ? `${drilldownDevices.length} thiết bị`
            : `${stationSummaries.length} trạm hiển thị / ${provinceSummaries.length} tỉnh`}
        </span>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <>
            <span className="cdv-summary-divider" />
            <span className="cdv-bulk-info">
              Đã chọn {selectedIds.size}
              <button className="cdv-bulk-delete" onClick={handleBulkDelete} disabled={bulkDeleting}>
                <Trash2 size={11} /> Xóa
              </button>
              <button onClick={() => setSelectedIds(new Set())}>Bỏ chọn</button>
            </span>
          </>
        )}
      </div>

      {/* ═══ BODY ═══ */}
      <div className="cdv-body">
        {/* Loading state */}
        {stations.length === 0 && (
          <div className="cdv-empty">
            <RefreshCw size={24} className="cdv-spin" />
            <span>Đang tải dữ liệu...</span>
          </div>
        )}

        {/* ══════ DASHBOARD: All stations overview ══════ */}
        {!isDrilldown && stations.length > 0 && (
          <div className="cdv-dashboard">
            {visibleProvinceStationGroups.length === 0 ? (
              <div className="cdv-empty">
                <span>Không có dữ liệu nào khớp với bộ lọc</span>
              </div>
            ) : (
              <div className="cdv-hierarchy">
                {visibleProvinceStationGroups.map(({ summary, stations: provinceStations }) => {
                  const expanded = expandedProvinces.has(summary.name);
                  return (
                    <div key={summary.name} className="cdv-province-block">
                      <button
                        type="button"
                        className="cdv-province-row"
                        onClick={() => toggleProvince(summary.name)}
                      >
                        <span className="cdv-province-left">
                          <span className="cdv-province-chevron">
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </span>
                          <span className="cdv-province-label">{summary.name}</span>
                        </span>
                        <span className="cdv-province-meta">
                          <span>{summary.stationCount} trạm</span>
                          <span className="cdv-meta-online">{summary.online} online</span>
                          <span>{summary.total} thiết bị</span>
                        </span>
                      </button>

                      {expanded && (
                        <div className="cdv-station-list">
                          {provinceStations.map(station => (
                            <button
                              key={station.id}
                              type="button"
                              className="cdv-station-row"
                              onClick={() => {
                                setSelectedProvince(station.provinceName);
                                onSelectStation(station.id);
                                setViewMode('table');
                              }}
                            >
                              <span className="cdv-station-main">
                                <span
                                  className={`cdv-station-status ${station.online > 0 ? 'online' : 'offline'}`}
                                />
                                <span className="cdv-station-code">{station.code}</span>
                                <span className="cdv-station-name">{station.name}</span>
                              </span>
                              <span className="cdv-station-side">
                                <span className="cdv-station-count">{station.online}/{station.total}</span>
                                {station.alertCount > 0 && (
                                  <span className="cdv-station-alert">
                                    <AlertCircle size={11} /> {station.alertCount}
                                  </span>
                                )}
                                <span className="cdv-station-arrow"><ChevronRight size={13} /></span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════ DRILLDOWN: Single station views ══════ */}
        {isDrilldown && (
          <>
            {/* ── GROUPED VIEW ── */}
            {viewMode === 'grouped' && (
              <div className="cdv-groups">
                {deviceGroups.length === 0 ? (
                  <div className="cdv-empty">
                    <span>Không có thiết bị nào khớp với bộ lọc</span>
                  </div>
                ) : (
                  deviceGroups.map(group => {
                    const isOpen = expandedGroups.has(group.type);
                    return (
                      <div key={group.type} className="cdv-group">
                        {/* Group header */}
                        <div className="cdv-group-header" onClick={() => toggleGroup(group.type)}>
                          <span className="cdv-group-icon" style={{ color: deviceColor(group.type) }}>
                            {deviceIcon(group.type, 15)}
                          </span>
                          <b>{group.label}</b>
                          <span className="cdv-group-count">
                            {group.total} thiết bị · {group.online} online
                          </span>
                          <div className="cdv-group-health-bar">
                            <div style={{
                              width: `${group.total ? Math.round((group.online / group.total) * 100) : 0}%`,
                              background: group.total && group.online === group.total
                                ? 'var(--admin-success)'
                                : group.total && group.online === 0
                                  ? 'var(--admin-danger)'
                                  : 'var(--admin-warning)',
                            }} />
                          </div>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>

                        {/* Group body */}
                        {isOpen && (
                          <div className="cdv-group-body">
                            {group.devices.map(device => renderDeviceCard(device))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ── TABLE VIEW ── */}
            {viewMode === 'table' && (
              <div className="cdv-table-wrap">
                <table className="cdv-table">
                  <thead>
                    <tr>
                      <th className="cdv-col-check">
                        <CheckSquare
                          size={13}
                          style={{ cursor: 'pointer', opacity: selectedIds.size === drilldownDevices.length && drilldownDevices.length > 0 ? 1 : 0.3 }}
                          onClick={toggleSelectAll}
                        />
                      </th>
                      <th>Tên</th>
                      <th>Loại</th>
                      <th>IP</th>
                      <th>Cổng</th>
                      <th>Trạng thái</th>
                      <th>Kết nối</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownDevices.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--admin-text-muted)' }}>
                          Không có thiết bị nào
                        </td>
                      </tr>
                    ) : (
                      drilldownDevices.map(device => {
                        const testResult = testResults[device.id];
                        const isSelected = selectedIds.has(device.id);
                        const canTestDevice = canTest(device);
                        return (
                          <tr key={device.id} className={isSelected ? 'selected' : ''}>
                            <td className="cdv-col-check" onClick={() => toggleSelect(device.id)}>
                              <CheckSquare size={13} style={{ cursor: 'pointer', opacity: isSelected ? 1 : 0.2 }} />
                            </td>
                            <td><b>{device.name}</b></td>
                            <td>{TYPE_LABELS[device.type] || device.type}</td>
                            <td>
                              <code>{device.config?.ip || '—'}</code>
                              {device.config?.ip && (
                                <button
                                  className="cdv-copy-btn"
                                  onClick={() => handleCopyIP(device.config.ip)}
                                  title="Sao chép IP"
                                >
                                  <Copy size={9} />
                                </button>
                              )}
                            </td>
                            <td>{device.config?.port || '—'}</td>
                            <td>
                              <span style={{ color: statusBadgeColor(device.status) }}>
                                {statusLabel(device.status)}
                              </span>
                            </td>
                            <td>
                              {testResult ? (
                                <span className={`cdv-test-badge ${testResult.ok ? 'ok' : testResult.pending ? 'pending' : 'fail'}`}>
                                  {testResult.pending ? <RefreshCw size={9} className="cdv-spin" /> : testResult.ok ? '✓' : '✗'}
                                </span>
                              ) : canTestDevice ? (
                                <button className="cdv-test-btn" onClick={() => handleTest(device)}>
                                  <Wifi size={9} /> Test
                                </button>
                              ) : (
                                <span style={{ opacity: 0.3 }}>—</span>
                              )}
                            </td>
                            <td className="cdv-col-actions">
                              <button title="Sửa" onClick={() => openEditModal(device)}><Edit3 size={11} /></button>
                              <button className="danger" title="Xóa" onClick={() => handleDelete(device)}><Trash2 size={11} /></button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── CARDS VIEW ── */}
            {viewMode === 'cards' && (
              <div className="cdv-cards">
                {drilldownDevices.length === 0 ? (
                  <div className="cdv-empty">
                    <span>Không có thiết bị nào khớp với bộ lọc</span>
                  </div>
                ) : (
                  drilldownDevices.map(device => renderDeviceCard(device, true))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ EDIT MODAL ═══ */}
      {editingDevice && (
        <div
          className="cdv-modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget && !editSaving) setEditingDevice(null); }}
        >
          <div className="cdv-modal">
            <div className="cdv-modal-header">
              <Edit3 size={14} style={{ color: 'var(--admin-accent)' }} />
              <b>Sửa thiết bị</b>
            </div>

            <label className="cdv-modal-field">
              Tên thiết bị
              <input
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); }}
                placeholder="VD: PLC Tủ A1"
              />
            </label>

            <label className="cdv-modal-field">
              Địa chỉ IP
              <input
                value={editForm.ip}
                onChange={e => setEditForm({ ...editForm, ip: e.target.value })}
                placeholder="192.168.x.x"
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); }}
              />
            </label>

            {editError && <div className="cdv-modal-error">{editError}</div>}

            <div className="cdv-modal-actions">
              <button onClick={() => setEditingDevice(null)} disabled={editSaving}>
                Hủy
              </button>
              <button className="primary" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ADD DEVICE MODAL ═══ */}
      {addModalOpen && (
        <div className="cdv-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !addSaving) setAddModalOpen(false); }}>
          <div className="cdv-modal" style={{ minWidth: 360, maxWidth: 480 }}>
            <div className="cdv-modal-header">
              <Plus size={14} style={{ color: 'var(--admin-accent)' }} />
              <b>Thêm thiết bị mới</b>
            </div>

            <label className="cdv-modal-field">
              Loại thiết bị
              <select
                value={addForm.type}
                onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}
                style={{ background: 'var(--admin-layer-2)', border: '1px solid var(--admin-border)', color: 'var(--admin-text)', padding: '6px 8px', borderRadius: 2, fontSize: '.75rem' }}
              >
                {Object.entries(DEVICE_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </label>

            <label className="cdv-modal-field">
              Tên thiết bị *
              <input autoFocus value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="VD: Camera Cổng chính" />
            </label>

            <label className="cdv-modal-field">
              Địa chỉ IP
              <input value={addForm.ip} onChange={e => setAddForm(f => ({ ...f, ip: e.target.value }))} placeholder="192.168.x.x" />
            </label>

            {addForm.type.startsWith('camera') && (
              <>
                <label className="cdv-modal-field">
                  Username
                  <input value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} placeholder="admin" />
                </label>
                <label className="cdv-modal-field">
                  Password
                  <div style={{ position: 'relative' }}>
                    <input type={addShowPassword ? 'text' : 'password'} value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••" style={{ paddingRight: 32 }} />
                    <button type="button" onClick={() => setAddShowPassword(v => !v)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer', padding: 0 }}>
                      {addShowPassword ? <X size={12} /> : <Wifi size={12} />}
                    </button>
                  </div>
                </label>
              </>
            )}

            {(addForm.type === 'camera_cctv' || addForm.type === 'camera_pd') && (
              <>
                <label className="cdv-modal-field">
                  RTSP Path <span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>(vd: /Streaming/Channels/101)</span>
                  <input value={addForm.rtspPath} onChange={e => setAddForm(f => ({ ...f, rtspPath: e.target.value }))} placeholder="/Streaming/Channels/101" />
                </label>
                <label className="cdv-modal-field">
                  Go2RTC ID <span style={{ color: 'var(--admin-text-muted)', fontWeight: 400 }}>(tự tạo nếu để trống)</span>
                  <input value={addForm.go2rtcId} onChange={e => setAddForm(f => ({ ...f, go2rtcId: e.target.value }))} placeholder="camera_192_168_x_x_cctv" />
                </label>
              </>
            )}

            {addForm.type === 'camera_thermal' && (
              <>
                <label className="cdv-modal-field">
                  RTSP Thermal
                  <input value={addForm.rtspThermal} onChange={e => setAddForm(f => ({ ...f, rtspThermal: e.target.value }))} placeholder="rtsp://..." />
                </label>
                <label className="cdv-modal-field">
                  Go2RTC Thermal ID
                  <input value={addForm.go2rtcThermal} onChange={e => setAddForm(f => ({ ...f, go2rtcThermal: e.target.value }))} placeholder="cam_x_thermal" />
                </label>
              </>
            )}

            {addForm.type === 'camera_dual' && (
              <>
                <label className="cdv-modal-field">
                  RTSP Optical
                  <input value={addForm.rtspOptical} onChange={e => setAddForm(f => ({ ...f, rtspOptical: e.target.value }))} placeholder="rtsp://..." />
                </label>
                <label className="cdv-modal-field">
                  Go2RTC Optical ID
                  <input value={addForm.go2rtcOptical} onChange={e => setAddForm(f => ({ ...f, go2rtcOptical: e.target.value }))} placeholder="cam_x_optical" />
                </label>
                <label className="cdv-modal-field">
                  RTSP Thermal
                  <input value={addForm.rtspThermal} onChange={e => setAddForm(f => ({ ...f, rtspThermal: e.target.value }))} placeholder="rtsp://..." />
                </label>
                <label className="cdv-modal-field">
                  Go2RTC Thermal ID
                  <input value={addForm.go2rtcThermal} onChange={e => setAddForm(f => ({ ...f, go2rtcThermal: e.target.value }))} placeholder="cam_x_thermal" />
                </label>
              </>
            )}

            {addForm.type === 'plc_s7' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label className="cdv-modal-field">
                  Rack
                  <input value={addForm.rack} onChange={e => setAddForm(f => ({ ...f, rack: e.target.value }))} placeholder="0" />
                </label>
                <label className="cdv-modal-field">
                  Slot
                  <input value={addForm.slot} onChange={e => setAddForm(f => ({ ...f, slot: e.target.value }))} placeholder="1" />
                </label>
                <label className="cdv-modal-field">
                  DB
                  <input value={addForm.db} onChange={e => setAddForm(f => ({ ...f, db: e.target.value }))} placeholder="32" />
                </label>
              </div>
            )}

            {addError && <div className="cdv-modal-error">{addError}</div>}

            <div className="cdv-modal-actions">
              <button onClick={() => setAddModalOpen(false)} disabled={addSaving}>Hủy</button>
              <button className="primary" onClick={saveNewDevice} disabled={addSaving}>
                {addSaving ? 'Đang lưu...' : 'Thêm thiết bị'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TOAST ═══ */}
      {toast && <div className="cdv-toast">{toast}</div>}
    </div>
  );
}
