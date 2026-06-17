// ============================================================
// CentralDeviceView.tsx — Trang thiết bị đa trạm
// Dashboard tổng quan + drill-down từng trạm
// Tính năng: Dashboard, nhóm/bảng/thẻ, tìm/lọc/sắp xếp,
//   test kết nối, sửa nhanh, xóa, copy IP, thêm mới,
//   xuất CSV, chọn hàng loạt, auto-refresh
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowUpDown, CheckSquare, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Copy, Cpu, Download, Edit3,
  List, Plus, RefreshCw,
  RotateCw, Search, Server, Thermometer, Trash2, Video, Wifi, X, Zap,
} from 'lucide-react';
import type { Station, Device } from '@/types/api.types';
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
  devicesByStation: Record<string, Device[]>;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
  onRefresh: () => void;
  onAddDevice?: () => void;
  alertsByStation?: Record<string, number>; // stationId → số cảnh báo đang mở
}

interface StationSummary {
  id: string;
  name: string;
  code: string;
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

const AUTO_REFRESH_SEC = 30;

// ── Fleet Donut Chart ──────────────────────────────────────────
function FleetDonut({ online, maintenance, offline, total, size = 72 }: {
  online: number; maintenance: number; offline: number; total: number; size?: number;
}) {
  const r = 18;
  const onlinePct  = total ? (online      / total) * 100 : 0;
  const maintPct   = total ? (maintenance / total) * 100 : 0;
  const offlinePct = total ? (offline     / total) * 100 : 0;

  const segments = [
    { pct: onlinePct,  color: 'var(--admin-success)', acc: 0 },
    { pct: maintPct,   color: 'var(--admin-warning)', acc: onlinePct },
    { pct: offlinePct, color: 'var(--admin-danger)',  acc: onlinePct + maintPct },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 44 44" style={{ flexShrink: 0, display: 'block' }}>
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--admin-border)" strokeWidth="5" />
      {total === 0 ? (
        <text x={22} y={22} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 7, fontWeight: 900, fill: 'var(--admin-text-muted)', fontFamily: 'inherit' }}>—</text>
      ) : (
        <>
          {segments.map(({ pct, color, acc }, i) => pct > 0 && (
            <circle
              key={i}
              cx={22} cy={22} r={r} fill="none"
              stroke={color} strokeWidth="5"
              pathLength="100"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={-acc}
              strokeLinecap="butt"
              transform="rotate(-90 22 22)"
            />
          ))}
          <text x={22} y={21} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 8, fontWeight: 900, fill: 'var(--admin-text)', fontFamily: 'inherit' }}>
            {Math.round(onlinePct)}%
          </text>
          <text x={22} y={29} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 5.5, fontWeight: 700, fill: 'var(--admin-text-muted)', fontFamily: 'inherit' }}>
            online
          </text>
        </>
      )}
    </svg>
  );
}

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

// ── Component ─────────────────────────────────────────────────
export default function CentralDeviceView({
  stations,
  devicesByStation,
  selectedStationId,
  onSelectStation,
  onRefresh,
  onAddDevice,
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

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Expand groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Test results cache
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Edit modal
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState({ name: '', ip: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<string | null>(null);

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

    return {
      id: s.id,
      name: s.name,
      code: s.code || s.id.slice(0, 8).toUpperCase(),
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
  }), [stations, devicesByStation, searchQuery, statusFilter, typeFilter, isDrilldown, alertsByStation]);

  // ── Derived: current station ───────────────────────────────
  const currentStation = useMemo(
    () => stationSummaries.find(s => s.id === selectedStationId) || null,
    [selectedStationId, stationSummaries]
  );

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

  // ── Auto-refresh logic ─────────────────────────────────────
  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 500);
  }, [onRefresh]);

  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      setCountdown(0);
      return;
    }
    setCountdown(AUTO_REFRESH_SEC);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? AUTO_REFRESH_SEC : prev - 1));
    }, 1000);
    refreshTimerRef.current = setInterval(doRefresh, AUTO_REFRESH_SEC * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [autoRefresh, doRefresh]);

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

  // Toast
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // ── Clear search when switching stations ────────────────────
  const handleBackToStations = () => {
    onSelectStation(null);
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
              <ChevronLeft size={14} /> Tất cả trạm
            </button>
          )}
          <h2 className="cdv-title">
            {isDrilldown ? currentStation?.name || 'Chi tiết' : 'Thiết bị đa trạm'}
          </h2>

          {/* Auto-refresh indicator */}
          <span className={`cdv-refresh-indicator ${refreshing ? 'active' : ''}`}>
            <RotateCw size={10} className={refreshing ? 'cdv-spin' : ''} />
            {autoRefresh ? `Tự động ${countdown}s` : 'Thủ công'}
            <button onClick={() => setAutoRefresh(v => !v)}>
              {autoRefresh ? 'Tắt' : 'Bật'}
            </button>
            <button onClick={doRefresh} disabled={refreshing}>
              <RefreshCw size={10} />
            </button>
          </span>
        </div>

        <div className="cdv-toolbar-right">
          {/* Search */}
          <div className="cdv-search-box">
            <Search size={12} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm tên hoặc IP..."
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}><X size={11} /></button>
            )}
          </div>

          {/* Status filter buttons */}
          {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map(key => (
            <button
              key={key}
              className={`cdv-chip ${statusFilter === key ? 'active' : ''}`}
              onClick={() => setStatusFilter(key)}
            >
              {STATUS_FILTER_LABELS[key]}
            </button>
          ))}

          {/* Type filter */}
          {allTypes.length > 0 && (
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
          )}

          {/* View mode toggle (drilldown only) */}
          {isDrilldown && (
            <div className="cdv-view-toggle">
              <button
                className="active"
                onClick={() => setViewMode('table')}
                title="Bảng"
              >
                <List size={14} />
              </button>
            </div>
          )}

          {/* Export */}
          <button className="cdv-chip" onClick={handleExportCSV} title="Xuất CSV">
            <Download size={11} /> CSV
          </button>

          {/* Add device */}
          {onAddDevice && (
            <button className="cdv-chip primary" onClick={onAddDevice}>
              <Plus size={11} /> Thêm
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
            : `${stationSummaries.length} trạm hiển thị`}
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
            {stationSummaries.length === 0 ? (
              <div className="cdv-empty">
                <span>Không có trạm nào khớp với bộ lọc</span>
              </div>
            ) : (
              <div className="cdv-dashboard-grid">
                {stationSummaries.map(s => {
                  const hc = healthColor(s.healthPct);
                  return (
                    <div
                      key={s.id}
                      className="cdv-station-card"
                      onClick={() => { onSelectStation(s.id); setViewMode('table'); }}
                    >
                      {/* Top: name + health ring */}
                      <div className="cdv-station-top">
                        <div className="cdv-station-info">
                          <code>{s.code}</code>
                          <h3>{s.name}</h3>
                        </div>
                        <div className="cdv-health-ring">
                          <svg viewBox="0 0 52 52">
                            <circle cx="26" cy="26" r="22" fill="none" stroke="var(--admin-border)" strokeWidth="3" />
                            <circle
                              cx="26" cy="26" r="22" fill="none"
                              stroke={hc} strokeWidth="3" strokeLinecap="round"
                              pathLength="100"
                              strokeDasharray={`${s.healthPct} 100`}
                              transform="rotate(-90 26 26)"
                            />
                          </svg>
                          <strong>{s.healthPct}%</strong>
                        </div>
                      </div>

                      {/* Online / Offline bars */}
                      <div className="cdv-station-bars">
                        <div className="cdv-bar-row">
                          <span>Online</span>
                          <div className="cdv-bar-track">
                            <div style={{
                              width: `${s.total ? (s.online / s.total) * 100 : 0}%`,
                              background: 'var(--admin-success)',
                            }} />
                          </div>
                          <b>{s.online}</b>
                        </div>
                        <div className="cdv-bar-row">
                          <span>Offline</span>
                          <div className="cdv-bar-track">
                            <div style={{
                              width: `${s.total ? (s.offline / s.total) * 100 : 0}%`,
                              background: 'var(--admin-danger)',
                            }} />
                          </div>
                          <b>{s.offline}</b>
                        </div>
                      </div>

                      {/* Device type badges */}
                      <div className="cdv-station-types">
                        {s.topTypes.map(([type, count]) => (
                          <span
                            key={type}
                            className="cdv-type-badge"
                            style={{
                              color: deviceColor(type),
                              borderColor: deviceColor(type) + '44',
                              background: deviceColor(type) + '10',
                            }}
                          >
                            {deviceIcon(type, 9)} {TYPE_LABELS[type] || type} <b>{count}</b>
                          </span>
                        ))}
                      </div>

                      {/* Footer */}
                      <div className="cdv-station-footer">
                        <span>{s.total} thiết bị</span>
                        {s.alertCount > 0 && (
                          <span className="cdv-alert-count">
                            <AlertCircle size={11} /> {s.alertCount} cảnh báo
                          </span>
                        )}
                        <span className="cdv-station-arrow"><ChevronRight size={14} /></span>
                      </div>
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

      {/* ═══ TOAST ═══ */}
      {toast && <div className="cdv-toast">{toast}</div>}
    </div>
  );
}
