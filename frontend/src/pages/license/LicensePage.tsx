import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, PenLine } from 'lucide-react';
import { authService } from '@/services/AuthService';
import { stationApi } from '@/services/StationApiService';
import { useRealtime } from '@/hooks/useRealtime';
import { confirmDialog } from '@/utils/confirm';
import type { Device, Province, Station } from '@/types/api.types';
import './LicensePage.css';

interface LicenseStatus {
  activated: boolean;
  tier?: string;
  maxUsers?: number;
  maxStations?: number;
  maxCameras?: number;
  maxSensors?: number;
  maxRoiPoints?: number;
  maxRoiRegions?: number;
  maxPdRegions?: number;
  expiresAt?: string;
  activatedAt?: string;
  activeSessions?: number;
  isValid?: boolean;
  daysRemaining?: number;
}

interface ResourceLimit {
  resource: string;
  current: number;
  max: number;       // -1 = unlimited
  exceeded: boolean;
}

type ResourceCountSummary = {
  stations: number;
  cameras: number;
  sensors: number;
  roi_points: number;
  roi_regions: number;
  pd_regions: number;
};

function LicenseFilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = options.find(option => option.value === value)?.label || options[0]?.label || '—';

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
    <div className="license-filter-dropdown" ref={rootRef}>
      <button type="button" onClick={() => setOpen(prev => !prev)}>
        <span>{activeLabel}</span>
        <b>{open ? '▴' : '▾'}</b>
      </button>
      {open && (
        <div className="license-filter-menu">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'active' : ''}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LicenseExportDropdown({
  disabled,
  onCsv,
  onXlsx,
  onPdf,
}: {
  disabled: boolean;
  onCsv: () => void;
  onXlsx: () => void;
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  const runExport = (handler: () => void) => {
    handler();
    setOpen(false);
  };

  return (
    <div className="license-export-dropdown" ref={rootRef}>
      <button type="button" disabled={disabled} onClick={() => setOpen(prev => !prev)}>
        <Download size={13} strokeWidth={2.4} />
        <span>Xuất</span>
        {open ? <ChevronUp size={12} strokeWidth={2.4} /> : <ChevronDown size={12} strokeWidth={2.4} />}
      </button>
      {open && !disabled && (
        <div className="license-export-menu">
          <button type="button" onClick={() => runExport(onCsv)}><span>CSV</span></button>
          <button type="button" onClick={() => runExport(onXlsx)}><span>XLSX</span></button>
          <button type="button" onClick={() => runExport(onPdf)}><span>PDF</span></button>
        </div>
      )}
    </div>
  );
}

const LICENSE_STATUS_CACHE_KEY = 'license-page-status-cache';
const LICENSE_LIMITS_CACHE_KEY = 'license-page-limits-cache-v3';

function readCachedStatus(): LicenseStatus | null {
  try {
    const raw = sessionStorage.getItem(LICENSE_STATUS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseStatus;
  } catch {
    return null;
  }
}

function readCachedLimits(): ResourceLimit[] {
  try {
    const raw = sessionStorage.getItem(LICENSE_LIMITS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ResourceLimit[];
  } catch {
    return [];
  }
}

const RESOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  stations:    { label: 'Trạm biến áp',      icon: '🏭' },
  cameras:     { label: 'Camera',            icon: '📷' },
  sensors:     { label: 'Sensor',            icon: '📡' },
};

function isThermalDevice(device: Device) {
  const cfg = device.config || {};
  return device.type === 'camera_thermal'
    || device.type === 'camera_dual'
    || !!cfg.go2rtc_thermal
    || !!cfg.rtsp_thermal;
}

function isPdDevice(device: Device) {
  const name = device.name?.toLowerCase?.() || '';
  return device.type === 'camera_pd'
    || device.type === 'cabinet'
    || name.includes('pd')
    || name.includes('phong dien')
    || name.includes('phóng điện');
}

function isCameraDevice(device: Device) {
  return device.type.startsWith('camera') || device.protocol?.toLowerCase() === 'rtsp';
}

function isSensorDevice(device: Device) {
  return !isCameraDevice(device);
}

export default function LicensePage() {
  const navigate = useNavigate();
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const cachedStatusRef = useRef<LicenseStatus | null>(readCachedStatus());
  const cachedLimitsRef = useRef<ResourceLimit[]>(readCachedLimits());
  
  const [status, setStatus] = useState<LicenseStatus | null>(cachedStatusRef.current);
  const [limits, setLimits] = useState<ResourceLimit[]>(cachedLimitsRef.current);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(cachedStatusRef.current === null);
  const [limitsLoading, setLimitsLoading] = useState(cachedLimitsRef.current.length === 0);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [managedStations, setManagedStations] = useState<Station[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [selectedProvinceId, setSelectedProvinceId] = useState('all');
  const [activeTab, setActiveTab] = useState<'master' | 'child'>('master');
  const [childRequestLoadingId, setChildRequestLoadingId] = useState<string | null>(null);
  const [childImportLoadingId, setChildImportLoadingId] = useState<string | null>(null);
  const [childClearLoadingId, setChildClearLoadingId] = useState<string | null>(null);
  const [quotaEditingId, setQuotaEditingId] = useState<string | null>(null);
  const [quotaDraft, setQuotaDraft] = useState({ cameras: '', sensors: '' });
  const [quotaSavingId, setQuotaSavingId] = useState<string | null>(null);
  const [stationActionMenuId, setStationActionMenuId] = useState<string | null>(null);

  const canManageLicense = authService.hasPermission('license:manage');
  const childStations = managedStations;

  useEffect(() => {
    if (!stationActionMenuId) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.license-station-actions')) {
        setStationActionMenuId(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [stationActionMenuId]);

  const getActualResourceCounts = async (): Promise<ResourceCountSummary> => {
    const stations = await stationApi.getStations().catch(() => []);

    // Lấy KPI (boundaries + roiPoints) từ tất cả trạm con có apiUrl song song
    const subStations = stations.filter(s => (s as any).apiUrl);
    const remoteKpis = await Promise.all(
      subStations.map(s => stationApi.getRemoteKpi(s.id).catch(() => null))
    );

    // Đếm devices từ local DB
    const deviceGroups = await Promise.all(
      stations.map(station => stationApi.getDevices(station.id).catch(() => []))
    );
    const devices = deviceGroups.flat();

    // Gộp boundaries + roiPoints từ tất cả trạm con
    let roi_regions = 0;
    let pd_regions = 0;
    let roi_points = 0;
    for (const kpi of remoteKpis) {
      if (!kpi) continue;
      roi_regions += (kpi.boundaries ?? []).filter((b: any) => b.type === 'roi').length;
      pd_regions  += (kpi.boundaries ?? []).filter((b: any) => b.type === 'pd').length;
      roi_points  += (kpi.roiPoints ?? []).length;
    }

    // Fallback sang local DB nếu không lấy được từ trạm con
    if (roi_regions === 0 && pd_regions === 0 && roi_points === 0) {
      const thermalDevices = devices.filter(isThermalDevice);
      const pdDevices = devices.filter(isPdDevice);
      const thermalConfigs = await Promise.all(
        thermalDevices.map(async device => {
          const [points, regions] = await Promise.all([
            stationApi.getRoiPoints(device.id).catch(() => []),
            stationApi.getBoundaries(device.id, 'roi').catch(() => []),
          ]);
          return { points: points.length, regions: regions.length };
        })
      );
      const pdConfigs = await Promise.all(
        pdDevices.map(async device => {
          const regions = await stationApi.getBoundaries(device.id, 'pd').catch(() => []);
          return regions.length;
        })
      );
      roi_points  = thermalConfigs.reduce((sum, item) => sum + item.points, 0);
      roi_regions = thermalConfigs.reduce((sum, item) => sum + item.regions, 0);
      pd_regions  = pdConfigs.reduce((sum, count) => sum + count, 0);
    }

    return {
      stations: stations.length,
      cameras: devices.filter(isCameraDevice).length,
      sensors: devices.filter(isSensorDevice).length,
      roi_points,
      roi_regions,
      pd_regions,
    };
  };

  const mergeActualCounts = (baseLimits: ResourceLimit[], actualCounts: ResourceCountSummary) => {
    const actualByResource: Record<string, number> = actualCounts;
    return baseLimits.map(item => {
      if (item.max <= 0) {
        return { ...item, current: 0, exceeded: false };
      }
      const actualCurrent = actualByResource[item.resource];
      const current = typeof actualCurrent === 'number'
        ? Math.max(item.current ?? 0, actualCurrent)
        : item.current;
      const normalizedMax = item.max === -1 ? 999 : item.max;
      const exceeded = normalizedMax < 999 && current >= normalizedMax;
      return { ...item, current, exceeded };
    });
  };

  const loadStatus = async (showLoading = false) => {
    if (showLoading || status === null) {
      setStatusLoading(true);
    }
    try {
      const data = await stationApi.getLicenseStatus();
      setStatus(data);
      sessionStorage.setItem(LICENSE_STATUS_CACHE_KEY, JSON.stringify(data));
    } catch {
      const fallback = { activated: false };
      setStatus(fallback);
      sessionStorage.setItem(LICENSE_STATUS_CACHE_KEY, JSON.stringify(fallback));
    } finally {
      setStatusLoading(false);
    }
  };

  const loadLimits = async (showLoading = false) => {
    if (showLoading || limits.length === 0) {
      setLimitsLoading(true);
    }
    try {
      const [data, actualCounts] = await Promise.all([
        stationApi.getLicenseLimits().catch(() => []),
        getActualResourceCounts(),
      ]);
      const mergedLimits = data.length > 0 ? mergeActualCounts(data, actualCounts) : [
        { resource: 'stations', current: actualCounts.stations, max: status?.maxStations && status.maxStations >= 999 ? -1 : (status?.maxStations ?? 10), exceeded: false },
        { resource: 'cameras', current: actualCounts.cameras, max: status?.maxCameras && status.maxCameras >= 999 ? -1 : (status?.maxCameras ?? 10), exceeded: false },
        { resource: 'sensors', current: actualCounts.sensors, max: status?.maxSensors && status.maxSensors >= 999 ? -1 : (status?.maxSensors ?? 10), exceeded: false },
        { resource: 'roi_points', current: actualCounts.roi_points, max: status?.maxRoiPoints && status.maxRoiPoints >= 999 ? -1 : (status?.maxRoiPoints ?? 10), exceeded: false },
        { resource: 'roi_regions', current: actualCounts.roi_regions, max: status?.maxRoiRegions && status.maxRoiRegions >= 999 ? -1 : (status?.maxRoiRegions ?? 10), exceeded: false },
        { resource: 'pd_regions', current: actualCounts.pd_regions, max: status?.maxPdRegions && status.maxPdRegions >= 999 ? -1 : (status?.maxPdRegions ?? 10), exceeded: false },
      ].map(item => ({
        ...item,
        exceeded: item.max !== -1 && item.max < 999 && item.current >= item.max,
      }));

      setLimits(mergedLimits);
      sessionStorage.setItem(LICENSE_LIMITS_CACHE_KEY, JSON.stringify(mergedLimits));
    } catch {
      setLimits([]);
      sessionStorage.removeItem(LICENSE_LIMITS_CACHE_KEY);
    } finally {
      setLimitsLoading(false);
    }
  };

  const refreshLicenseData = async (showLoading = false) => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    try {
      await Promise.allSettled([loadStatus(showLoading), loadLimits(showLoading)]);
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refreshLicenseData(false);
      }
    }
  };

  const loadManagedStations = async () => {
    try {
      const [stations, provinceList] = await Promise.all([
        stationApi.getStations(true),
        stationApi.getProvinces().catch(() => []),
      ]);
      setManagedStations(stations);
      setProvinces(provinceList);
    } catch {
      setManagedStations([]);
      setProvinces([]);
    }
  };

  const scheduleRefresh = () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshLicenseData(false);
    }, 250);
  };

  useEffect(() => {
    void refreshLicenseData(true);
    void loadManagedStations();
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    const handleOnline = () => {
      scheduleRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useRealtime({
    onStationListChanged: () => {
      scheduleRefresh();
      void loadManagedStations();
    },
    onDeviceListChanged: () => {
      scheduleRefresh();
    },
    onUserStatusChange: () => {
      scheduleRefresh();
    },
  }, []);

  // ── Offline license request ──────────────────────────────
  const downloadLicenseRequest = (data: any, fallbackFileName: string) => {
    const request = data?.request ?? JSON.stringify(data, null, 2);
    const blob = new Blob([request], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data?.fileName || fallbackFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRequest = async () => {
    setLoading(true);
    setImportMsg('');
    try {
      const data = await stationApi.getLicenseRequest();
      downloadLicenseRequest(data, 'StationMonitor_Master_Request.licreq');
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi tạo yêu cầu');
    } finally {
      setLoading(false);
    }
  };

  const handleChildRequest = async (station: Station) => {
    if (!station.apiUrl) {
      setImportMsg(`Trạm ${station.name} chưa cấu hình API URL nên chưa thể xuất .licreq`);
      return;
    }

    setChildRequestLoadingId(station.id);
    setImportMsg('');
    try {
      const data = await stationApi.getRemoteLicenseRequest(station.id);
      const stationCode = station?.code || station?.name || 'ChildStation';
      const safeStationCode = stationCode.replace(/[^\w.-]+/g, '_');
      downloadLicenseRequest(data, `${safeStationCode}_Request.licreq`);
      setImportMsg(`Đã xuất .licreq của trạm con ${station?.name ?? ''}`.trim());
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi tạo yêu cầu từ trạm con');
    } finally {
      setChildRequestLoadingId(null);
    }
  };

  const handleChildImport = async (station: Station, file?: File | null) => {
    if (!file) return;
    if (!station.apiUrl) {
      setImportMsg(`Trạm ${station.name} chưa cấu hình API URL nên chưa thể nhập license`);
      return;
    }

    setChildImportLoadingId(station.id);
    setImportMsg('');
    try {
      const data = await stationApi.importRemoteLicense(station.id, file);
      setImportMsg(data?.message ?? `Đã nhập license cho trạm con ${station.name}`);
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi nhập license vào trạm con');
    } finally {
      setChildImportLoadingId(null);
    }
  };

  const handleChildClear = async (station: Station) => {
    if (!station.apiUrl) {
      setImportMsg(`Trạm ${station.name} chưa cấu hình API URL nên chưa thể xóa license`);
      return;
    }
    const ok = await confirmDialog({
      title: 'Xóa license trạm con',
      message: `Xóa toàn bộ license đang áp dụng trên trạm con ${station.name}?`,
      confirmText: 'Xóa license',
      cancelText: 'Hủy',
      danger: true,
    });
    if (!ok) return;

    setChildClearLoadingId(station.id);
    setImportMsg('');
    try {
      const data = await stationApi.clearRemoteLicense(station.id);
      await stationApi.updateStation(station.id, {
        name: station.name,
        code: station.code,
        location: station.location,
        apiUrl: station.apiUrl,
        apiUsername: station.apiUsername,
        webUrl: station.webUrl,
        status: station.status,
        provinceId: station.provinceId,
        cameraQuota: 0,
        sensorQuota: 0,
      });
      setManagedStations(prev => prev.map(item =>
        item.id === station.id ? { ...item, cameraQuota: 0, sensorQuota: 0 } : item
      ));
      if (quotaEditingId === station.id) {
        setQuotaDraft({ cameras: '0', sensors: '0' });
      }
      await loadManagedStations();
      setImportMsg(data?.message ?? `Đã xóa license trạm con ${station.name}`);
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi xóa license trạm con');
    } finally {
      setChildClearLoadingId(null);
    }
  };

  const openQuotaEditor = (station: Station) => {
    setQuotaEditingId(station.id);
    setQuotaDraft({
      cameras: station.cameraQuota == null ? '' : String(station.cameraQuota),
      sensors: station.sensorQuota == null ? '' : String(station.sensorQuota),
    });
  };

  const saveStationQuota = async (station: Station) => {
    const cameraQuota = quotaDraft.cameras.trim() === '' ? null : Number(quotaDraft.cameras);
    const sensorQuota = quotaDraft.sensors.trim() === '' ? null : Number(quotaDraft.sensors);

    if ((cameraQuota != null && (!Number.isInteger(cameraQuota) || cameraQuota < 0)) ||
        (sensorQuota != null && (!Number.isInteger(sensorQuota) || sensorQuota < 0))) {
      setImportMsg('Quota camera/sensor phải là số nguyên không âm');
      return;
    }

    setQuotaSavingId(station.id);
    setImportMsg('');
    try {
      await stationApi.updateStation(station.id, {
        name: station.name,
        code: station.code,
        location: station.location,
        apiUrl: station.apiUrl,
        apiUsername: station.apiUsername,
        webUrl: station.webUrl,
        status: station.status,
        provinceId: station.provinceId,
        cameraQuota,
        sensorQuota,
      });
      setManagedStations(prev => prev.map(item =>
        item.id === station.id ? { ...item, cameraQuota, sensorQuota } : item
      ));
      setQuotaEditingId(null);
      if (station.apiUrl) {
        try {
          const provision = await stationApi.provisionRemoteLicense(station.id);
          setImportMsg(provision?.message ?? `Đã cấp và nhập license cho trạm ${station.name}: ${cameraQuota ?? 0} cam, ${sensorQuota ?? 0} sensor`);
        } catch (provisionErr: any) {
          setImportMsg(`Đã lưu quota cho trạm ${station.name}, nhưng chưa đẩy được license vào trạm con: ${provisionErr?.message ?? provisionErr}`);
        }
      } else {
        setImportMsg(`Đã cấp quota cho trạm ${station.name}: ${cameraQuota ?? 0} cam, ${sensorQuota ?? 0} sensor`);
      }
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi cấp quota cho trạm con');
    } finally {
      setQuotaSavingId(null);
    }
  };

  // ── Import license file (.lic) ───────────────────────────
  const handleImport = async () => {
    if (!importFile) {
      setImportMsg('Vui lòng chọn file license (.lic)');
      return;
    }
    setLoading(true);
    setImportMsg('');
    try {
      const data = await stationApi.importLicense(importFile);
      setImportMsg(data?.message ?? 'License đã nhập thành công!');
      setImportFile(null);
      setStatus(null);
      setLimits([]);
      setStatusLoading(true);
      setLimitsLoading(true);
      await refreshLicenseData(true);
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi nhập license');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    const confirmed = await confirmDialog({
      title: 'Xóa license trạm tổng',
      message: 'Xóa license hiện tại đang áp dụng trên ứng dụng này?',
      confirmText: 'Xóa license',
      cancelText: 'Hủy',
      danger: true,
    });
    if (!confirmed) return;

    setLoading(true);
    setImportMsg('');
    try {
      const data = await stationApi.clearLicense();
      setImportMsg(data?.message ?? 'Đã xóa license hiện tại!');
      setImportFile(null);
      setStatus(null);
      setLimits([]);
      setStatusLoading(true);
      setLimitsLoading(true);
      await refreshLicenseData(true);
    } catch (err: any) {
      setImportMsg(err?.message ?? 'Lỗi xóa license hiện tại');
    } finally {
      setLoading(false);
    }
  };

  const getTierClass = (tier: string) => {
    if (tier === 'solo') return 'solo';
    if (tier === 'team') return 'team';
    return 'ent';
  };

  const formatLimit = (val?: number) => {
    if (val === undefined || val === null) return '—';
    return val >= 999 ? '∞' : String(val);
  };

  const renderStatusBox = () => {
    if (statusLoading && !status) {
      return <div style={{ color: 'var(--admin-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Đang tải trạng thái...</div>;
    }

    if (!status || !status.activated) {
      return (
        <div className="status-box">
          <div className="status-row">
            <span>Trạng thái</span>
            <span className="status-badge neutral">Chưa kích hoạt</span>
          </div>
          <div className="status-row">
            <span>Người dùng đồng thời</span>
            <span>0 / 0</span>
          </div>
          <div className="status-row">
            <span>Giới hạn tài nguyên</span>
            <span style={{ color: '#ff8787', fontWeight: 'bold' }}>0 / 0</span>
          </div>
        </div>
      );
    }

    const tierLabel = status.tier === 'solo' ? 'Solo' : status.tier === 'team' ? 'Team' : status.tier === 'ent' ? 'Enterprise' : status.tier;
    const expDate = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString('vi-VN') : '—';
    const actDate = status.activatedAt ? new Date(status.activatedAt).toLocaleDateString('vi-VN') : '—';
    const statusCls = status.isValid ? 'valid' : 'expired';
    const statusTxt = status.isValid ? 'Đang hoạt động' : 'Đã hết hạn';

    return (
      <div className={`status-box ${statusCls}`}>
        <div className="status-row">
          <span>Trạng thái</span>
          <span className={`status-badge ${statusCls}`}>{statusTxt}</span>
        </div>
        <div className="status-row">
          <span>Gói</span>
          <span>
            <span className={`tier-pill ${status.tier ? getTierClass(status.tier) : ''}`}>
              {tierLabel}
            </span>
          </span>
        </div>
        <div className="status-row">
          <span>Người dùng đồng thời</span>
          <span>{status.activeSessions ?? 0} / {formatLimit(status.maxUsers)}</span>
        </div>
        <div className="status-row">
          <span>Ngày hết hạn</span>
          <span>{expDate} (còn {status.daysRemaining ?? 0} ngày)</span>
        </div>
        <div className="status-row">
          <span>Ngày kích hoạt</span>
          <span>{actDate}</span>
        </div>
      </div>
    );
  };

  const renderResourceLimits = () => {
    if (statusLoading && limitsLoading && !status && limits.length === 0) {
      return (
        <div className="resource-limits-section">
          <h3>Giới hạn tài nguyên</h3>
          <div style={{ color: 'var(--admin-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Đang tải giới hạn tài nguyên...
          </div>
        </div>
      );
    }

    if (!status?.activated) {
      const zeroResources = [
        { resource: 'stations', current: 0, max: 0, exceeded: false },
        { resource: 'cameras', current: 0, max: 0, exceeded: false },
        { resource: 'sensors', current: 0, max: 0, exceeded: false },
      ];

      return (
        <div className="resource-limits-section">
          <h3>Giới hạn tài nguyên</h3>
          <div className="no-license-warning" style={{
            backgroundColor: 'rgba(255, 107, 107, 0.1)',
            border: '1px solid rgba(255, 107, 107, 0.3)',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '14px',
            color: '#ff8787',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⚠️</span>
            <span>Chưa có license. Tất cả giới hạn hiện là 0/0.</span>
          </div>
          <div className="resource-grid">
            {zeroResources.map((item) => {
              const info = RESOURCE_LABELS[item.resource] ?? { label: item.resource, icon: '📦' };
              return (
                <div key={item.resource} className="resource-card">
                  <div className="resource-icon">{info.icon}</div>
                  <div className="resource-info">
                    <div className="resource-name">{info.label}</div>
                    <div className="resource-count">
                      <span className="resource-current">{item.current}</span>
                      <span className="resource-sep">/</span>
                      <span className="resource-max">{item.max}</span>
                    </div>
                    <div className="resource-bar-bg">
                      <div className="resource-bar-fill normal" style={{ width: '0%' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Use limits from API if available, otherwise fall back to status fields
    const resourceData = limits.length > 0 ? limits : [
      { resource: 'stations',    current: 0, max: status?.activated ? (status.maxStations   ?? 0) : 0, exceeded: false },
      { resource: 'cameras',     current: 0, max: status?.activated ? (status.maxCameras    ?? 0) : 0, exceeded: false },
      { resource: 'sensors',     current: 0, max: status?.activated ? (status.maxSensors    ?? 0) : 0, exceeded: false },
      { resource: 'roi_points',  current: 0, max: status?.activated ? (status.maxRoiPoints  ?? 0) : 0, exceeded: false },
      { resource: 'roi_regions', current: 0, max: status?.activated ? (status.maxRoiRegions ?? 0) : 0, exceeded: false },
      { resource: 'pd_regions',  current: 0, max: status?.activated ? (status.maxPdRegions  ?? 0) : 0, exceeded: false },
    ];
    const visibleResources = resourceData.filter(item => item.resource === 'stations' || item.resource === 'cameras' || item.resource === 'sensors');

    return (
      <div className="resource-limits-section">
        <h3>Giới hạn tài nguyên</h3>
        {!statusLoading && !status?.activated && (
          <div className="no-license-warning" style={{ 
            backgroundColor: 'rgba(255, 107, 107, 0.1)', 
            border: '1px solid rgba(255, 107, 107, 0.3)',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '14px',
            color: '#ff8787',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⚠️</span>
            <span>Chưa có license. Tất cả giới hạn hiện là 0/0.</span>
          </div>
        )}
        <div className="resource-grid">
          {visibleResources.map((item) => {
            const info = RESOURCE_LABELS[item.resource] ?? { label: item.resource, icon: '📦' };
            const isUnlimited = item.max === -1 || (item.max !== undefined && item.max >= 999);
            const pct = isUnlimited ? 0 : (item.max > 0 ? Math.min(100, (item.current / item.max) * 100) : 0);
            const barClass = item.exceeded ? 'exceeded' : pct >= 80 ? 'warning' : 'normal';

            return (
              <div key={item.resource} className={`resource-card ${item.exceeded ? 'exceeded' : ''}`}>
                <div className="resource-icon">{info.icon}</div>
                <div className="resource-info">
                  <div className="resource-name">{info.label}</div>
                  <div className="resource-count">
                    <span className="resource-current">{item.current}</span>
                    <span className="resource-sep">/</span>
                    <span className="resource-max">{isUnlimited ? '∞' : item.max}</span>
                  </div>
                  {!isUnlimited && (
                    <div className="resource-bar-bg">
                      <div className={`resource-bar-fill ${barClass}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {isUnlimited && (
                    <div className="resource-unlimited">Không giới hạn</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMasterLicenseTab = () => (
    <div className="license-master-grid">
      <div className="license-master-main">
        {renderStatusBox()}

        {canManageLicense && (
          <div className="license-activate-section" id="activateSection">
            <h3>Kích hoạt Offline Trạm Tổng</h3>
            <p className="license-hint">
              Xuất mã yêu cầu phần cứng của máy trạm tổng thành file <code>.licreq</code>, sau đó nhập file <code>.lic</code> nhận được cho trạm tổng.
            </p>

            <div className="license-offline-actions">
              <button
                className="btn-license-request"
                onClick={handleRequest}
                disabled={loading}
                id="btnLicenseRequest"
              >
                {loading ? 'Đang tạo...' : '📋 Xuất .licreq trạm tổng'}
              </button>

              <span className="license-offline-sep">hoặc</span>

              <label className="btn-license-file" htmlFor="licenseFileInput">
                📂 Chọn file .lic
                <input
                  type="file"
                  accept=".lic"
                  id="licenseFileInput"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  disabled={loading}
                  hidden
                />
              </label>
              {importFile && (
                <button
                  className="btn-license-import"
                  onClick={handleImport}
                  disabled={loading}
                  id="btnLicenseImport"
                >
                  {loading ? 'Đang nhập...' : '📥 Nhập'}
                </button>
              )}
            </div>

            {importFile && (
              <div className="license-file-name">📄 {importFile.name}</div>
            )}
          </div>
        )}
      </div>

      <div className="license-master-side">
        {renderResourceLimits()}
      </div>
    </div>
  );

  const provinceById = new Map(provinces.map(province => [province.id, province]));
  const getStationProvinceId = (station: Station) => {
    if (station.provinceId && provinceById.has(station.provinceId)) {
      return station.provinceId;
    }

    let address = '';
    if (station.location) {
      try {
        const parsed = JSON.parse(station.location);
        address = parsed?.address || '';
      } catch {
        address = station.location;
      }
    }

    const haystack = `${station.name || ''} ${address}`.toLowerCase();
    const matched = provinces.find(province => {
      const aliases = [
        province.name,
        province.name
          ?.replace(/^Tỉnh\s+/i, '')
          .replace(/^Thành phố\s+/i, '')
          .replace(/^TP\.?\s+/i, ''),
      ].filter(Boolean) as string[];

      return aliases.some(alias => haystack.includes(alias.toLowerCase()));
    });

    return matched?.id || 'unassigned';
  };
  const stationProvinceIds = new Set(childStations.map(station => getStationProvinceId(station)));
  const visibleProvinces = provinces.filter(province => stationProvinceIds.has(province.id));
  const hasUnassignedStations = stationProvinceIds.has('unassigned');
  const effectiveSelectedProvinceId =
    selectedProvinceId === 'unassigned'
      ? (hasUnassignedStations ? selectedProvinceId : 'all')
      : selectedProvinceId !== 'all' && !stationProvinceIds.has(selectedProvinceId)
        ? 'all'
        : selectedProvinceId;
  const filteredChildStations = childStations.filter(station => {
    const stationProvinceId = getStationProvinceId(station);
    return (
      effectiveSelectedProvinceId === 'all' ||
      (effectiveSelectedProvinceId === 'unassigned' ? stationProvinceId === 'unassigned' : stationProvinceId === effectiveSelectedProvinceId)
    );
  });
  const groupedChildStations = new Map<string, Station[]>();
  for (const station of filteredChildStations) {
    const key = getStationProvinceId(station);
    groupedChildStations.set(key, [...(groupedChildStations.get(key) ?? []), station]);
  }
  const sortedChildLicenseGroups = Array.from(groupedChildStations.entries()).sort(([leftId], [rightId]) => {
    const leftName = provinceById.get(leftId)?.name ?? 'Chưa gán tỉnh';
    const rightName = provinceById.get(rightId)?.name ?? 'Chưa gán tỉnh';
    return leftName.localeCompare(rightName, 'vi');
  });
  const getProvinceName = (station: Station) => provinceById.get(getStationProvinceId(station))?.name ?? 'Chưa gán tỉnh';
  const getStationLicenseUsage = (station: Station) => ({
    stations: 1,
    cameras: station.cameraQuota ?? 0,
    sensors: station.sensorQuota ?? 0,
  });
  const getProvinceLicenseUsage = (stations: Station[]) => stations.reduce(
    (total, station) => {
      const usage = getStationLicenseUsage(station);
      return {
        stations: total.stations + usage.stations,
        cameras: total.cameras + usage.cameras,
        sensors: total.sensors + usage.sensors,
      };
    },
    { stations: 0, cameras: 0, sensors: 0 }
  );
  const getChildLicenseExportRows = () => filteredChildStations.map(station => ({
    'Tỉnh': getProvinceName(station),
    'Tên trạm': station.name,
    'Mã trạm': station.code || '',
    'Chiếm trạm': '1',
    'Camera đã cấp': String(station.cameraQuota ?? 0),
    'Sensor đã cấp': String(station.sensorQuota ?? 0),
    'API trạm con': station.apiUrl || 'Chưa cấu hình API URL',
    'Trạng thái': station.apiUrl ? (station.connectionStatus || 'unknown') : 'no api',
  }));

  const exportChildLicenseCsv = () => {
    const rows = getChildLicenseExportRows();
    if (rows.length === 0) {
      alert('Không có dữ liệu để xuất CSV');
      return;
    }
    const headers = ['Tỉnh', 'Tên trạm', 'Mã trạm', 'Chiếm trạm', 'Camera đã cấp', 'Sensor đã cấp', 'API trạm con', 'Trạng thái'];
    const csv = [headers, ...rows.map(row => headers.map(key => (row as Record<string, string>)[key]))]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `License_TramCon_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportChildLicenseXlsx = () => {
    const rows = getChildLicenseExportRows();
    if (rows.length === 0) {
      alert('Không có dữ liệu để xuất XLSX');
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 42 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'LicenseTramCon');
    XLSX.writeFile(wb, `License_TramCon_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportChildLicensePdf = () => {
    const rows = getChildLicenseExportRows();
    if (rows.length === 0) {
      alert('Không có dữ liệu để xuất PDF');
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text('DANH SACH LICENSE TRAM CON', 40, 36);
    doc.setFontSize(9);
    doc.text(`Ngay xuat: ${new Date().toLocaleString('vi-VN')} | So tram: ${rows.length}`, 40, 54);
    autoTable(doc, {
      startY: 72,
      styles: { fontSize: 8, cellPadding: 4 },
      head: [['Tinh', 'Ten tram', 'Ma tram', 'Tram', 'Camera', 'Sensor', 'API tram con', 'Trang thai']],
      body: rows.map(row => [
        row['Tỉnh'],
        row['Tên trạm'],
        row['Mã trạm'],
        row['Chiếm trạm'],
        row['Camera đã cấp'],
        row['Sensor đã cấp'],
        row['API trạm con'],
        row['Trạng thái'],
      ]),
      margin: { left: 24, right: 24 },
    });
    doc.save(`License_TramCon_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const renderChildLicenseTab = () => (
    <div className="license-child-tab">
      <div className="license-offline-divider"></div>
      <h3>Quản lý License Theo Từng Trạm Con</h3>

      {childStations.length === 0 ? (
        <div className="license-empty-state">
          Chưa có trạm con nào trong hệ thống.
        </div>
      ) : (
        <>
          <div className="license-child-filters">
            <LicenseFilterDropdown
              value={effectiveSelectedProvinceId}
              onChange={setSelectedProvinceId}
              options={[
                { value: 'all', label: 'Tất cả tỉnh' },
                ...(hasUnassignedStations ? [{ value: 'unassigned', label: 'Chưa gán tỉnh' }] : []),
                ...visibleProvinces.map(province => ({
                  value: province.id,
                  label: `${province.name}${province.code ? ` (${province.code})` : ''}`,
                })),
              ]}
            />
            <LicenseExportDropdown
              disabled={filteredChildStations.length === 0}
              onCsv={exportChildLicenseCsv}
              onXlsx={exportChildLicenseXlsx}
              onPdf={exportChildLicensePdf}
            />
          </div>
          {(() => {
            if (sortedChildLicenseGroups.length === 0) {
              return <div className="license-empty-state">Không có trạm con nào khớp bộ lọc hiện tại.</div>;
            }

            return (
              <div className="license-province-groups">
                {sortedChildLicenseGroups.map(([provinceId, stations]) => {
                  const province = provinceById.get(provinceId);
                  const provinceName = province?.name ?? 'Chưa gán tỉnh';
                  const provinceUsage = getProvinceLicenseUsage(stations);
                  return (
                    <section key={provinceId} className="license-province-group">
                      <div className="license-province-header">
                        <span>{provinceName}</span>
                        <div className="license-usage-summary">
                          <small>{provinceUsage.cameras} cam</small>
                          <small>{provinceUsage.sensors} sensor</small>
                        </div>
                      </div>
                      <div className="license-station-list">
                        {stations.map(station => {
                          const isLoading = childRequestLoadingId === station.id;
                          const isImporting = childImportLoadingId === station.id;
                          const isClearing = childClearLoadingId === station.id;
                          const isSavingQuota = quotaSavingId === station.id;
                          const actionDisabled = !!childRequestLoadingId || !!childImportLoadingId || !!childClearLoadingId || !!quotaSavingId || !station.apiUrl;
                          const stationUsage = getStationLicenseUsage(station);
                          const quotaEditorOpen = quotaEditingId === station.id;
                          const actionMenuOpen = stationActionMenuId === station.id;
                          return (
                            <div key={station.id} className="license-station-row">
                              <div className="license-station-main">
                                <div className="license-cell-label">Trạm</div>
                                <div className="license-station-name">
                                  {station.name}
                                  {station.code && <span>{station.code}</span>}
                                </div>
                              </div>
                              <div className="license-station-usage">
                                <div className="license-cell-label">Thông số license</div>
                                <div className="license-usage-chips">
                                  <span>{stationUsage.stations} trạm</span>
                                  <span>{stationUsage.cameras} cam</span>
                                  <span>{stationUsage.sensors} sensor</span>
                                </div>
                              </div>
                              <div className="license-station-state">
                                <div className="license-cell-label">Trạng thái</div>
                                <span className={`license-station-status ${station.connectionStatus || 'unknown'}`}>
                                  {station.apiUrl ? (station.connectionStatus || 'unknown') : 'no api'}
                                </span>
                              </div>
                              {canManageLicense && (
                                <div className="license-station-actions">
                                  <div className="license-cell-label">Thao tác</div>
                                  <button
                                    type="button"
                                    className="btn-license-action-menu"
                                    onClick={() => setStationActionMenuId(prev => prev === station.id ? null : station.id)}
                                    disabled={!!childRequestLoadingId || !!childImportLoadingId || !!childClearLoadingId || !!quotaSavingId}
                                    title="Mở menu thao tác license"
                                  >
                                    <PenLine size={13} strokeWidth={2.4} />
                                    <ChevronDown size={13} strokeWidth={2.4} />
                                  </button>
                                  {actionMenuOpen && (
                                    <div className="license-station-action-menu">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setStationActionMenuId(null);
                                          openQuotaEditor(station);
                                        }}
                                        disabled={!!quotaSavingId}
                                      >
                                        Cấp quota
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setStationActionMenuId(null);
                                          void handleChildRequest(station);
                                        }}
                                        disabled={actionDisabled}
                                      >
                                        {isLoading ? 'Đang xuất...' : 'Xuất .licreq'}
                                      </button>
                                      <label className={actionDisabled ? 'disabled' : ''}>
                                        {isImporting ? 'Đang nhập...' : 'Nhập .lic'}
                                        <input
                                          type="file"
                                          accept=".lic"
                                          hidden
                                          disabled={actionDisabled}
                                          onChange={event => {
                                            const file = event.target.files?.[0] ?? null;
                                            event.target.value = '';
                                            setStationActionMenuId(null);
                                            void handleChildImport(station, file);
                                          }}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        className="danger"
                                        onClick={() => {
                                          setStationActionMenuId(null);
                                          void handleChildClear(station);
                                        }}
                                        disabled={actionDisabled}
                                      >
                                        {isClearing ? 'Đang xóa...' : 'Xóa license'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {quotaEditorOpen && (
                                <div className="license-quota-editor">
                                  <label>
                                    <span>Camera cấp cho trạm</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={quotaDraft.cameras}
                                      onChange={event => setQuotaDraft(prev => ({ ...prev, cameras: event.target.value }))}
                                      placeholder="VD: 10"
                                    />
                                  </label>
                                  <label>
                                    <span>Sensor cấp cho trạm</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={quotaDraft.sensors}
                                      onChange={event => setQuotaDraft(prev => ({ ...prev, sensors: event.target.value }))}
                                      placeholder="VD: 10"
                                    />
                                  </label>
                                  <div className="license-quota-editor-actions">
                                    <button type="button" onClick={() => void saveStationQuota(station)} disabled={isSavingQuota}>
                                      {isSavingQuota ? 'Đang lưu...' : 'Lưu quota'}
                                    </button>
                                    <button type="button" onClick={() => setQuotaEditingId(null)} disabled={isSavingQuota}>
                                      Hủy
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );

  return (
    <div className="license-page">
      <div className="license-hero">
        <div className="license-card">
          <div className="license-header">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#44ff88" strokeWidth="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div className="license-title-row">
              <button className="btn-license-back" onClick={() => navigate(-1)} title="Quay lại">←</button>
              <h1>Quản lý License</h1>
            </div>
            <p>Kích hoạt bản quyền phần mềm StationMonitor</p>
          </div>

          <div className="license-tabs">
            <button className={activeTab === 'master' ? 'active' : ''} onClick={() => setActiveTab('master')}>
              Trạm tổng
            </button>
            <button className={activeTab === 'child' ? 'active' : ''} onClick={() => setActiveTab('child')}>
              Trạm con
            </button>
          </div>

          {activeTab === 'master' ? renderMasterLicenseTab() : renderChildLicenseTab()}

          {importMsg && (
            <div className={`license-import-msg ${importMsg.includes('thành công') || importMsg.startsWith('Đã xuất') || importMsg.startsWith('Đã nhập') || importMsg.startsWith('Đã cấp quota') || importMsg.startsWith('Đã cấp và nhập') || importMsg.startsWith('Đã xóa license') ? 'success' : 'error'}`}>
              {importMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
