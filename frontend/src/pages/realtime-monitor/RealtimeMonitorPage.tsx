// ============================================================
// RealtimeMonitorPage.tsx — Giám sát camera trực tiếp
// Phát stream qua go2rtc (WebRTC) — layout 1/4/9 camera
// Hiển thị sự kiện phát hiện AI (nhiệt, khói, xâm nhập, phóng điện)
// Panel phải: danh sách sự kiện theo thời gian, lọc theo loại/ngày
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Map as MapIcon, AlertTriangle, Activity, Server, CheckCircle, Video, Radio, ShieldCheck, Clock, Search, ChevronLeft, ChevronRight, Grid, ChevronDown } from 'lucide-react';
import ToolbarSelect from '@/components/ui/ToolbarSelect';
import { stationApi, CameraDevice, RoiPoint, Boundary } from '@/services/StationApiService';
import { GO2RTC_URL, AI_ENGINE_URL, API_BASE_URL } from '@/utils/env';
import { authService } from '@/services/AuthService';
import { createRealtimeHub } from '@/services/realtime.service';
import { useAlertStore } from '@/store/alertStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useStationStore } from '@/store/stationStore';
import { ALERT_STATUS } from '@/types/enums';
import { Device } from '@/types/api.types';
import './RealtimeMonitorPage.css';

type Layout = { cols: number; rows: number };

const PREDEFINED_GRID_SIZES = [1, 2, 3, 4, 6, 8, 9, 12, 16, 20, 24, 25, 36, 49, 64];

function getGridDimensions(count: number): { cols: number, rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 3) return { cols: 3, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 8) return { cols: 4, rows: 2 };
  if (count === 9) return { cols: 3, rows: 3 };
  if (count <= 12) return { cols: 4, rows: 3 };
  if (count <= 16) return { cols: 4, rows: 4 };
  if (count <= 20) return { cols: 5, rows: 4 };
  if (count <= 25) return { cols: 5, rows: 5 };
  if (count <= 36) return { cols: 6, rows: 6 };
  if (count <= 49) return { cols: 7, rows: 7 };
  if (count <= 64) return { cols: 8, rows: 8 };
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

interface RealtimeMonitorPageProps {
  embeddedMode?: 'default' | 'central';
  stationIdOverride?: string | null;
  onStationIdChange?: (stationId: string) => void;
}





/**
 * Trang giám sát camera trực tiếp — hiển thị lưới stream WebRTC với overlay nhiệt/PD,
 * bảng sự kiện AI theo thời gian thực và đồng hồ trạng thái thiết bị.
 */
export default function RealtimeMonitorPage({
  embeddedMode = 'default',
  stationIdOverride = null,
  onStationIdChange,
}: RealtimeMonitorPageProps) {
  const [searchParams] = useSearchParams();
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [layout, setLayout] = useState<Layout>({ cols: 2, rows: 2 });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoverGrid, setHoverGrid] = useState<{ cols: number; rows: number } | null>(null);
  const [selectedCamFilter, setSelectedCamFilter] = useState('');
  
  const [expandedCamId, setExpandedCamId] = useState<string | null>(null);
  
  // Realtime
  const [deviceStatus, setDeviceStatus] = useState<Record<string, string>>({});
  const [aiStatsMap, setAiStatsMap] = useState<Record<string, any>>({});

  // Lightbox
  const [lightbox, setLightbox] = useState<{ url: string, isVideo: boolean } | null>(null);

  // ROI Configuration & Readings
  const [roiBoundaries, setRoiBoundaries] = useState<Record<string, Boundary[]>>({});
  const [roiPoints, setRoiPoints] = useState<Record<string, RoiPoint[]>>({});
  const [roiReadings, setRoiReadings] = useState<Record<string, Record<string, number>>>({});
  const [pdBoundaries, setPdBoundaries] = useState<Record<string, Boundary[]>>({});
  // VVR mapping cache per device: deviceId → {x, y, width, height}
  const [vvrCache, setVvrCache] = useState<Record<string, {x:number;y:number;width:number;height:number}>>({});

  // AI Stream Toggle State (mặc định tắt, dùng WebRTC + SVG overlay)
  const [aiStreamCells, setAiStreamCells] = useState<Record<string, boolean>>({});
  const [stationMenuOpen, setStationMenuOpen] = useState(false);
  const [stationMenuPos, setStationMenuPos] = useState({ top: 0, left: 0, width: 260 });
  const stationBtnRef = useRef<HTMLButtonElement>(null);

  const [savedLayouts, setSavedLayouts] = useState<{
    id: string;
    name: string;
    cols: number;
    rows: number;
    selectedCamFilter: string;
  }[]>([]);
  const [newLayoutName, setNewLayoutName] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('stationos_saved_layouts');
      if (stored) {
        setSavedLayouts(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleSaveLayout = () => {
    if (!newLayoutName.trim()) return;
    const item = {
      id: Date.now().toString(),
      name: newLayoutName.trim(),
      cols: layout.cols,
      rows: layout.rows,
      selectedCamFilter: selectedCamFilter
    };
    const updated = [...savedLayouts, item];
    setSavedLayouts(updated);
    localStorage.setItem('stationos_saved_layouts', JSON.stringify(updated));
    setNewLayoutName('');
  };

  const handleDeleteLayout = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedLayouts.filter(l => l.id !== id);
    setSavedLayouts(updated);
    localStorage.setItem('stationos_saved_layouts', JSON.stringify(updated));
  };

  // Device, Alert and Station stores
  const fetchDevices = useDeviceStore(s => s.fetch);
  const devicesByStation = useDeviceStore(s => s.devicesByStation);
  const devices = useMemo(() => Object.values(devicesByStation).flat() as Device[], [devicesByStation]);
  const fetchAlerts = useAlertStore(s => s.fetch);
  const getFirstStationId = useStationStore(s => s.getFirstStationId);
  const stations = useStationStore(s => s.stations);
  const alertsByFilter = useAlertStore(s => s.alertsByFilter);
  const alerts = alertsByFilter[ALERT_STATUS.OPEN] ?? [];
  const queryStationId = searchParams.get('stationId');
  const effectiveStationId = stationIdOverride || queryStationId;

  const expandCameraVariants = (cams: CameraDevice[], stationName?: string) => {
    const initialStatus: Record<string, string> = {};
    cams.forEach(c => initialStatus[c.id.toLowerCase()] = c.status || 'unknown');

    const expandedCams: CameraDevice[] = [];
    cams.forEach(c => {
      const cfg = (c as any).config || {};
      const withStationMeta = { ...(c as any), stationName };
      if (c.type === 'camera_dual') {
        expandedCams.push({
          ...withStationMeta,
          id: `${c.id}_optical`,
          name: `${c.name} (Quang học)`,
          config: { ...cfg, go2rtc_id: cfg.go2rtc_optical || cfg.go2rtc_id }
        } as any);
        expandedCams.push({
          ...withStationMeta,
          id: `${c.id}_thermal`,
          name: `${c.name} (Nhiệt)`,
          config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id }
        } as any);
      } else if (c.type === 'camera_thermal') {
        expandedCams.push({
          ...withStationMeta,
          name: c.name.includes('nhiệt') || c.name.includes('Nhiệt') ? c.name : `${c.name} (Nhiệt)`,
          config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id }
        } as any);
      } else {
        expandedCams.push({
          ...withStationMeta,
          config: cfg
        } as any);
      }
    });

    return { expandedCams, initialStatus };
  };

  // 1. Initial Load: Fetch cameras once on mount
  useEffect(() => {
    let active = true;

    const loadAllStationsCams = async (stationsList: any[]) => {
      try {
        console.log(`[RealtimeMonitor] Fetching cameras for ${stationsList.length} stations:`, stationsList.map(s => s.name));
        const cameraResults = await Promise.all(
          stationsList.map(async station => {
            const cams = await stationApi.getCameras(station.id).catch(() => [] as CameraDevice[]);
            console.log(`[RealtimeMonitor] Station: ${station.name} (id: ${station.id}) fetched ${cams.length} cameras`);
            return { station, cams };
          })
        );
        
        if (!active) return;
        console.log(`[RealtimeMonitor] Total camera results count: ${cameraResults.length}`);

        const mergedStatus: Record<string, string> = {};
        const mergedCams: CameraDevice[] = [];
        const thermalIds: string[] = [];

        cameraResults.forEach(({ station, cams }) => {
          console.log(`[RealtimeMonitor] Processing station: ${station.name}, found ${cams.length} cameras`);
          const { expandedCams, initialStatus } = expandCameraVariants(cams, station.name);
          Object.assign(mergedStatus, initialStatus);
          mergedCams.push(...expandedCams);
          thermalIds.push(...cams.filter(c => c.type === 'camera_thermal' || c.type === 'camera_dual').map(c => c.id));
        });

        if (!active) return;
        console.log(`[RealtimeMonitor] Final merged camera count: ${mergedCams.length}`);

        setDeviceStatus(mergedStatus);
        setCameras(mergedCams);

        thermalIds.forEach(cid => {
          stationApi.getThermalMapping(cid).then(m => {
            if (m && active) setVvrCache(prev => ({ ...prev, [cid.toLowerCase()]: m }));
          }).catch(() => {});
        });
      } catch (err) {
        console.error(err);
      }
    };

    const savedStationId = effectiveStationId || localStorage.getItem('selected_station_id');

    const init = async () => {
      let currentStations = stations;
      if (currentStations.length === 0) {
        try {
          currentStations = await useStationStore.getState().fetch();
        } catch (e) {
          console.error('[RealtimeMonitor] Failed to fetch stations:', e);
        }
      }
      if (!active) return;

      await loadAllStationsCams(currentStations);
      if (!active) return;

      if (embeddedMode === 'central' && !effectiveStationId) {
        currentStations.forEach(s => fetchDevices(s.id));
        fetchAlerts(ALERT_STATUS.OPEN);
      } else if (savedStationId) {
        fetchDevices(savedStationId);
        fetchAlerts(ALERT_STATUS.OPEN);
      } else {
        getFirstStationId().then((id: string | null) => {
          if (id && active) {
            onStationIdChange?.(id);
            fetchDevices(id);
            fetchAlerts(ALERT_STATUS.OPEN);
          }
        }).catch(() => {});
      }
    };

    init();

    // Initial latest points
    stationApi.getLatestPoints().then(readings => {
      if (!active) return;
      setRoiReadings(prev => {
        const next = { ...prev };
        readings.forEach(r => {
          const devId = r.deviceId?.toLowerCase();
          const ptId = r.pointId?.toLowerCase();
          if (!devId || !ptId) return;
          next[devId] = { ...(next[devId] || {}), [ptId]: r.value };
        });
        return next;
      });
    }).catch(console.error);

    return () => {
      active = false;
    };
  }, [embeddedMode, stationIdOverride, effectiveStationId, stations, fetchDevices, fetchAlerts, getFirstStationId, onStationIdChange]);

  // 2. Periodic ROI/PD Boundary Refresh
  useEffect(() => {
    if (cameras.length === 0) return;
    
    const fetchRoiConfig = () => {
      const baseCamIds = Array.from(new Set(cameras.map(c => c.id.replace(/_(optical|thermal)$/, ''))));
      Promise.all(
        baseCamIds.map(id =>
          Promise.all([
            stationApi.getBoundaries(id, 'roi').catch(() => []),
            stationApi.getRoiPoints(id).catch(() => []),
            stationApi.getBoundaries(id, 'pd').catch(() => []),
          ]).then(([boundaries, points, pdBounds]) => ({ id, boundaries, points, pdBounds }))
        )
      ).then(results => {
        const boundMap: Record<string, Boundary[]> = {};
        const pointMap: Record<string, RoiPoint[]> = {};
        const pdMap: Record<string, Boundary[]> = {};
        results.forEach(res => {
          const lowId = res.id.toLowerCase();
          boundMap[lowId] = res.boundaries;
          pointMap[lowId] = res.points;
          pdMap[lowId] = res.pdBounds;
        });
        setRoiBoundaries(boundMap);
        setRoiPoints(pointMap);
        setPdBoundaries(pdMap);
      }).catch(console.error);
    };

    fetchRoiConfig();
    const timer = setInterval(fetchRoiConfig, 5000);
    return () => clearInterval(timer);
  }, [cameras.length]); // Re-run if camera count changes

  // 3. AI State Polling (Fast sync for visual feedback)
  useEffect(() => {
    const pdCams = cameras.filter(c => c.type === 'camera_pd');
    if (pdCams.length === 0) return;

    const aiPollInterval = setInterval(async () => {
      const token = authService.getToken() || '';
      const backend = API_BASE_URL.replace('/api/v1', '');

      pdCams.forEach(async (cam) => {
        const baseId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
        try {
          const res = await fetch(`${AI_ENGINE_URL}/pd-monitor/${baseId}/state?token=${token}&backend=${backend}`);
          if (res.ok) {
            const data = await res.json();
            setAiStatsMap(prev => ({ ...prev, [baseId]: data }));
          }
        } catch {}
      });
    }, 800);

    return () => clearInterval(aiPollInterval);
  }, [cameras.length]); // Independent of ROI config sync

  // SignalR (Simplified: only local UI state, global alerts handled in AppShell)
  useEffect(() => {
    const hubConnection = createRealtimeHub();
    hubConnection.on('DeviceStatus', (data: { deviceId: string; status: string }) => {
      setDeviceStatus(prev => ({ ...prev, [data.deviceId.toLowerCase()]: data.status }));
    });
    
    hubConnection.on('SensorUpdate', (data: any[]) => {
      if (!Array.isArray(data)) return;
      setRoiReadings(prev => {
        const next = { ...prev };
        data.forEach(item => {
          const devId = item.deviceId?.toLowerCase();
          const ptId = item.pointId?.toLowerCase();
          if (!devId || !ptId) return;
          next[devId] = {
            ...(next[devId] || {}),
            [ptId]: item.value
          };
        });
        return next;
      });
    });

    hubConnection.start().catch(() => {});
    return () => { hubConnection.stop(); };
  }, []);

  // Helpers
  const cellCount = layout.cols * layout.rows;
  
  const displayCams = useMemo(() => {
    if (selectedCamFilter) {
      return cameras.filter(c => c.id === selectedCamFilter);
    }
    if (effectiveStationId) {
      const station = stations.find(s => s.id === effectiveStationId);
      if (station) {
        return cameras.filter(c => (c as any).stationName === station.name);
      }
    }
    return cameras;
  }, [cameras, selectedCamFilter, effectiveStationId, stations]);

  const sortedCamOptions = useMemo(() => {
    const optionsWithMeta = cameras.map(c => {
      const stationLabel = (c as any).stationName ? `${(c as any).stationName} · ` : '';
      return {
        value: c.id,
        label: `${stationLabel}${c.name}`,
        stationName: (c as any).stationName || ''
      };
    });
    
    optionsWithMeta.sort((a, b) => {
      const stationCompare = a.stationName.localeCompare(b.stationName, 'vi');
      if (stationCompare !== 0) return stationCompare;
      return a.label.localeCompare(b.label, 'vi');
    });

    return optionsWithMeta.map(o => ({ value: o.value, label: o.label }));
  }, [cameras]);

  const stationCams = useMemo(() => {
    if (!effectiveStationId) return [];
    const station = stations.find(s => s.id === effectiveStationId);
    if (!station) return [];
    return cameras.filter(c => (c as any).stationName === station.name);
  }, [cameras, effectiveStationId, stations]);
  const isCentralFleetView = embeddedMode === 'central' && !effectiveStationId;
  const stationCameraStats = useMemo(() => {
    const grouped = new Map<string, {
      stationId: string;
      stationName: string;
      total: number; online: number; offline: number;
      thermal: number; optical: number; pd: number; cctv: number;
      cameraNames: string[];
      alertCount: number;
      firstCam?: CameraDevice;
    }>();
    const seenBaseIds = new Set<string>();

    cameras.forEach(cam => {
      const baseId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
      if (seenBaseIds.has(baseId)) return;
      seenBaseIds.add(baseId);

      const stationName = ((cam as any).stationName as string | undefined) || 'Không rõ trạm';
      const stationId = stations.find(s => s.name === stationName)?.id || '';
      const key = stationName.toLowerCase();
      const status = deviceStatus[baseId] || 'unknown';
      const entry = grouped.get(key) || { stationId, stationName, total: 0, online: 0, offline: 0, thermal: 0, optical: 0, pd: 0, cctv: 0, cameraNames: [], alertCount: 0 };

      entry.total += 1;
      if (status === 'online') entry.online += 1;
      else entry.offline += 1;

      const t = cam.type || '';
      if (t === 'camera_thermal') entry.thermal += 1;
      else if (t === 'camera_pd') entry.pd += 1;
      else if (t === 'camera_dual') { entry.thermal += 1; entry.optical += 1; }
      else entry.cctv += 1;

      if (!entry.firstCam) entry.firstCam = cam;

      entry.cameraNames.push(cam.name.replace(/\s+\((Quang học|Nhiệt)\)$/i, ''));
      grouped.set(key, entry);
    });

    const result = [...grouped.values()];
    
    // Add missing stations
    stations.forEach(s => {
        if (!grouped.has(s.name.toLowerCase())) {
            result.push({
                stationId: s.id, stationName: s.name,
                total: 0, online: 0, offline: 0,
                thermal: 0, optical: 0, pd: 0, cctv: 0,
                cameraNames: [], alertCount: 0
            });
        }
    });

    result.sort((a, b) => a.stationName.localeCompare(b.stationName, 'vi'));
    result.forEach(entry => {
      entry.alertCount = alerts.filter(a => {
        const dev = devices.find(d => d.id.toLowerCase() === (typeof a.deviceId === 'string' ? a.deviceId.toLowerCase() : ''));
        if (!dev) return false;
        const st = stations.find(s => s.id === entry.stationId);
        return st && (dev as any).stationId === st.id;
      }).length;
    });
    return result;
  }, [cameras, deviceStatus, stations, alerts, devices]);

  const fleetSummary = useMemo(() => {
    const totalStations = stations.length;
    const totalCams = stationCameraStats.reduce((acc, s) => acc + s.total, 0);
    const onlineCams = stationCameraStats.reduce((acc, s) => acc + s.online, 0);
    const totalAlerts = alerts.length;
    const avgHealth = totalCams > 0 ? Math.round((onlineCams / totalCams) * 100) : 0;
    
    return { totalStations, totalCams, onlineCams, totalAlerts, avgHealth };
  }, [stationCameraStats, alerts, stations]);

  const filteredStats = useMemo(() => {
    return stationCameraStats;
  }, [stationCameraStats]);

  const fleetGridConfig = useMemo(() => {
    const total = Math.max(filteredStats.length, 1);
    const columns = total >= 7 ? 3 : total >= 3 ? 3 : total === 2 ? 2 : 1;
    const rows = Math.max(1, Math.ceil(total / columns));
    return { columns, rows };
  }, [filteredStats.length]);

  /** Render các polygon SVG vùng ROI nhiệt lên overlay của ô camera. */
  const renderOverlayBoundaries = (cam: CameraDevice) => {
    let baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';

    let targetCam = cam;
    if (!isThermal && cam.type !== 'camera_dual' && !cam.id.includes('_optical')) {
      const cfg = cam.config || {};
      if (cfg.ip) {
        const linkedThermal = devices.find(d => 
          (d.type === 'camera_thermal' || d.type === 'camera_dual') && 
          (d.config as any)?.ip === cfg.ip
        );
        if (linkedThermal) {
          baseDeviceId = linkedThermal.id.toLowerCase();
          targetCam = linkedThermal as any;
        }
      }
    }

    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};

    const cfg = targetCam.config || {};
    const focalOpt = cfg.focal_length_optical;
    const focalTh = cfg.focal_length_thermal;
    const isFocalEqual = focalOpt != null && focalTh != null && Number(focalOpt) === Number(focalTh);
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = isFocalEqual ? { x: 0, y: 0, width: 1, height: 1 } : (vvrCache[baseDeviceId]
      ?? (vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 }));

    return boundaries.map((b, index) => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return null; }
      if (poly.length < 3) return null;

      const mappedPoly = poly.map(([txVal, tyVal]) => {
        let rx = txVal;
        let ry = tyVal;
        if (!isThermal) {
          rx = txVal * vvr.width + vvr.x;
          ry = tyVal * vvr.height + vvr.y;
        }
        return [rx, ry] as [number, number];
      });

      const pointsStr = mappedPoly.map(p => `${p[0] * 100},${p[1] * 100}`).join(' ');

      const lookupId = b.id.toLowerCase();
      const temp = readings[lookupId] ?? 
                   (b.name ? readings[b.name.toLowerCase()] : undefined) ?? 
                   readings[`r${index + 1}`];

      let color = '#3b82f6';
      let warningTemp = 50, alarmTemp = 70, borderWidth = 0.5;
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50;
          alarmTemp = t.alarm || 70;
          if (t.borderWidth) borderWidth = parseFloat(t.borderWidth) || 0.5;
        } catch {}
      }

      if (temp !== undefined) {
        if (temp >= alarmTemp) color = '#ef4444';
        else if (temp >= warningTemp) color = '#fbbf24';
      }

      return (
        <polygon
          key={b.id}
          points={pointsStr}
          fill={color + '12'}
          stroke={color}
          strokeWidth={borderWidth}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.9}
        />
      );
    });
  };

  /** Render nhãn tên vùng và nhiệt độ lên overlay dạng HTML div (hỗ trợ blur backdrop). */
  const renderOverlayLabels = (cam: CameraDevice) => {
    let baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';

    let targetCam = cam;
    if (!isThermal && cam.type !== 'camera_dual' && !cam.id.includes('_optical')) {
      const cfg = cam.config || {};
      if (cfg.ip) {
        const linkedThermal = devices.find(d => 
          (d.type === 'camera_thermal' || d.type === 'camera_dual') && 
          (d.config as any)?.ip === cfg.ip
        );
        if (linkedThermal) {
          baseDeviceId = linkedThermal.id.toLowerCase();
          targetCam = linkedThermal as any;
        }
      }
    }

    const points = roiPoints[baseDeviceId] || [];
    const boundaries = roiBoundaries[baseDeviceId] || [];
    const readings = roiReadings[baseDeviceId] || {};
    const aiState = aiStatsMap[baseDeviceId] || {};

    const cfg = targetCam.config || {};
    const focalOpt = cfg.focal_length_optical;
    const focalTh = cfg.focal_length_thermal;
    const isFocalEqual = focalOpt != null && focalTh != null && Number(focalOpt) === Number(focalTh);
    const vvrRaw = (cfg as any).visible_valid_rect;
    const vvr = isFocalEqual ? { x: 0, y: 0, width: 1, height: 1 } : (vvrCache[baseDeviceId]
      ?? (vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 }));

    const labels: React.ReactNode[] = [];

    // 1. Boundary Labels
    boundaries.forEach((b, index) => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return; }
      if (poly.length < 1) return;

      const firstPt = poly[0];
      if (!firstPt) return;
      let rx = firstPt[0];
      let ry = firstPt[1];
      if (!isThermal) {
        rx = rx * vvr.width + vvr.x;
        ry = ry * vvr.height + vvr.y;
      }

      const lookupId = b.id.toLowerCase();
      const temp = readings[lookupId] ?? 
                   (b.name ? readings[b.name.toLowerCase()] : undefined) ?? 
                   readings[`r${index + 1}`];
      
      let color = '#3b82f6';
      let warningTemp = 50, alarmTemp = 70;
      let fontSize = 14;
      let labelPos = 'top';
      if (b.thresholds) {
        try {
          const t = JSON.parse(b.thresholds);
          warningTemp = t.warning || 50; alarmTemp = t.alarm || 70;
          if (t.fontSize) fontSize = parseInt(t.fontSize) || 14;
          if (t.namePosition || t.labelPos) labelPos = t.namePosition || t.labelPos || 'top';
        } catch {}
      }
      if (temp !== undefined) {
        if (temp >= alarmTemp) color = '#ef4444';
        else if (temp >= warningTemp) color = '#fbbf24';
      }

      const labelTransform =
        labelPos === 'bottom' ? 'translate(-50%, 0)'    :
        labelPos === 'left'   ? 'translate(-100%, -50%)':
        labelPos === 'right'  ? 'translate(0, -50%)'    :
        /* top */               'translate(-50%, -100%)';
      labels.push(
        <div
          key={`label-b-${b.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: labelTransform,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.95)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${color}`,
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: `${fontSize - 4}px`,
              color: '#fff',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: `0 2px 6px rgba(0,0,0,0.5), 0 0 6px ${color}33`,
              fontFamily: 'var(--font-mono)',
              animation: temp !== undefined ? 'pulse-subtle 2s infinite' : 'none'
            }}
          >
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{b.name.replace(/Vùng\s*/g, 'V')}</span>
            <span style={{ fontWeight: 800, color: color, fontSize: '9px', borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 4 }}>
              {temp !== undefined ? `${temp.toFixed(1)}°C` : '--°C'}
            </span>
          </div>
        </div>
      );
    });

    // 2. Điểm đo nhiệt — CSS crosshair y hệt ThermalConfigTab
    points.forEach((pt, index) => {
      // Chọn tọa độ theo loại camera: thermal dùng tx/ty, optical dùng ox/oy
      const txv = pt.tx ?? (pt.x !== undefined ? pt.x / 100 : 0);
      const tyv = pt.ty ?? (pt.y !== undefined ? pt.y / 100 : 0);
      let rx = txv, ry = tyv;
      if (!isThermal) {
        rx = txv * vvr.width + vvr.x;
        ry = tyv * vvr.height + vvr.y;
      }
      if (rx === 0 && ry === 0) return;

      // Tra nhiệt độ từ SignalR readings
      const pid = pt.pointId || '';
      const nm  = pt.name || pt.label || '';
      const fallbackP1 = `p${pt.sortOrder || (index + 1)}`;
      const temp =
        (pid ? readings[pid] ?? readings[pid.toLowerCase()] : undefined) ??
        (nm  ? readings[nm]  ?? readings[nm.toLowerCase()]  : undefined) ??
        readings[pt.id] ?? readings[pt.id.toLowerCase()] ??
        readings[fallbackP1];

      const preAlarm = pt.preAlarmThreshold ?? 50;
      const alarmTh  = pt.alarmThreshold   ?? 70;
      const color = temp != null
        ? (temp >= alarmTh ? '#ef4444' : temp >= preAlarm ? '#f59e0b' : '#10b981')
        : '#10b981';

      const sz  = pt.sortOrder || 28;
      const lp  = (pt as any).description || 'top';
      const labelStyle: React.CSSProperties =
        lp === 'bottom' ? { top: '100%',  left: '50%', transform: 'translateX(-50%)', marginTop: 4 } :
        lp === 'left'   ? { right: '100%', top: '50%',  transform: 'translateY(-50%)', marginRight: 6 } :
        lp === 'right'  ? { left: '100%',  top: '50%',  transform: 'translateY(-50%)', marginLeft: 6  } :
        /* top */         { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 };

      labels.push(
        <div key={`pt-${pt.id}`} style={{
          position: 'absolute',
          left: `${rx * 100}%`,
          top:  `${ry * 100}%`,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 11,
        }}>
          {/* CSS crosshair — y hệt ThermalConfigTab */}
          <div style={{ position: 'relative', width: sz, height: sz }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: 1.5, background: color, transform: 'translateY(-50%)', boxShadow: '0 0 3px rgba(0,0,0,.9)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, width: 1.5, height: '100%', background: color, transform: 'translateX(-50%)', boxShadow: '0 0 3px rgba(0,0,0,.9)' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 4, height: 4, borderRadius: '50%', background: '#fff', boxShadow: `0 0 4px ${color}` }} />
          </div>
          {/* Label badge — y hệt ThermalConfigTab */}
          <div style={{ position: 'absolute', ...labelStyle, background: 'rgba(8,8,8,.88)', border: `1px solid ${color}55`, borderRadius: 3, padding: '1px 6px', fontSize: 9, fontFamily: 'var(--admin-font-mono)', whiteSpace: 'nowrap', color: '#fff' }}>
             <span style={{ color: '#ccc' }}>{(pid || nm).replace(/Điểm\s*/gi, 'D').replace(/P\s*/g, 'D')}</span>
            {temp != null && <span style={{ fontWeight: 800, color, marginLeft: 4 }}>{temp.toFixed(1)}°C</span>}
          </div>
        </div>
      );
    });

    // 3. PD Boundary Labels (Được hiển thị trực quan kèm chỉ số phóng điện dB)
    const pdList = pdBoundaries[baseDeviceId] || [];
    pdList.forEach(b => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return; }
      if (poly.length < 1) return;

      const minX = Math.min(...poly.map(p => p[0]));
      const maxX = Math.max(...poly.map(p => p[0]));
      const minY = Math.min(...poly.map(p => p[1]));
      const maxY = Math.max(...poly.map(p => p[1]));
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;

      let rx = cx, ry = cy;
      let labelPos = 'bottom';
      let fontSize = 12;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          if (t.labelPos) labelPos = t.labelPos;
          if (t.fontSize) fontSize = parseInt(t.fontSize) || 12;
        }
      } catch {}

      if (labelPos === 'top')         { ry = minY; }
      else if (labelPos === 'bottom') { ry = maxY; }
      else if (labelPos === 'left')   { rx = minX; }
      else if (labelPos === 'right')  { rx = maxX; }

      const lookupId = b.id.toLowerCase();
      
      const regionValue = readings[lookupId] ?? 
                          (b.name ? readings[b.name.toLowerCase()] : undefined) ??
                          readings[b.name];

      // Fallback to global PD camera decibel value if region value is 0 or missing
      const globalDb = readings['phong_dien'] ?? readings['pd'];
      const pdValue = (regionValue !== undefined && regionValue !== 0) ? regionValue : globalDb;
      const hasDischarge = pdValue !== undefined;

      // Xác định các ngưỡng cảnh báo/báo động động cho vùng này
      let warningDb = 20, alarmDb = 45;
      try {
        if (b.thresholds) {
          const t = JSON.parse(b.thresholds);
          warningDb = t.warn || t.warning || 20;
          alarmDb = t.alarm || 45;
        }
      } catch {}

      const isAlarm = hasDischarge && pdValue !== undefined && pdValue >= alarmDb;
      const isWarning = hasDischarge && pdValue !== undefined && pdValue >= warningDb;
      const isActive = aiState.active_boundary === b.name;
      const color = isAlarm ? '#ef4444' : (isActive || isWarning ? '#fbbf24' : '#10b981');

      const labelTransform =
        labelPos === 'bottom' ? 'translate(-50%, 0)'    :
        labelPos === 'left'   ? 'translate(-100%, -50%)':
        labelPos === 'right'  ? 'translate(0, -50%)'    :
        /* top */               'translate(-50%, -100%)';

      const liveDb = aiState.db;
      const liveHz = aiState.hz;

      labels.push(
        <div
          key={`label-pd-${b.id}`}
          style={{
            position: 'absolute',
            left: `${rx * 100}%`,
            top: `${ry * 100}%`,
            transform: labelTransform,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(13, 17, 23, 0.95)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${color}`,
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: `${fontSize - 2}px`,
              color: '#fff',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: `0 2px 6px rgba(0,0,0,0.5), 0 0 6px ${color}33`,
              fontFamily: 'var(--font-mono)',
              animation: isActive ? 'pulse-subtle 2s infinite' : 'none'
            }}
          >
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{b.name}</span>
            <span style={{ fontWeight: 800, color: color, fontSize: `${fontSize - 3}px`, borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 4 }}>
              {liveDb != null ? `${liveDb.toFixed(1)} dB` : '-- dB'}
            </span>
            <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontSize: `${fontSize - 4}px`, borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: 4 }}>
              {liveHz != null ? `${(liveHz / 1000).toFixed(1)} kHz` : '-- kHz'}
            </span>
          </div>
        </div>
      );
    });

    return labels;
  };

  /** Render các polygon SVG vùng PD (phóng điện) lên overlay. */
  const renderOverlayPdBoundaries = (cam: CameraDevice) => {
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const boundaries = pdBoundaries[baseDeviceId] || [];
    const aiState = aiStatsMap[baseDeviceId] || {};

    return boundaries.map(b => {
      let poly: [number, number][] = [];
      try { poly = JSON.parse(b.polygon); } catch { return null; }
      if (poly.length < 3) return null;

      const pointsStr = poly.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');

      const isActive = aiState.active_boundary === b.name;
      const liveDb: number | null = aiState.db ?? null;

      let warnDb = 20, alarmDb = 35;
      try {
        const t = JSON.parse(b.thresholds || '{}');
        warnDb = t.warn || t.warning || 20;
        alarmDb = t.alarm || 35;
      } catch {}

      const isAlarm = liveDb != null && liveDb >= alarmDb;
      const isWarn  = liveDb != null && liveDb >= warnDb;
      const color = isAlarm ? '#ef4444' : (isWarn ? '#fbbf24' : '#10b981');

      return (
        <g key={b.id}>
          <polygon
            points={pointsStr}
            fill={`${color}${isActive ? '25' : '10'}`}
            stroke={color}
            strokeWidth={isActive ? 3 : 1.5}
            strokeDasharray={isActive ? 'none' : '4 2'}
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
            style={{ transition: 'all 0.3s ease' }}
          />
        </g>
      );
    });
  };

  /** Render một ô camera trong lưới NVR — bao gồm stream, overlay và HUD. */
  const renderCell = (cam: CameraDevice | undefined, idx: number) => {
    const ch = String(idx + 1).padStart(2, '0');
    if (!cam) {
      return (
        <div key={`empty-${idx}`} className="nvr-cell">
          <div className="nvr-nosig">
            <span className="nvr-nosig-ico"></span>
            <span className="nvr-nosig-txt">Không có tín hiệu</span>
          </div>
          <div className="nvr-ch">CH{ch}</div>
        </div>
      );
    }

    const cfg = (cam as any).config || {};
    const go2rtcId = cfg.go2rtc_id || '';
    if (!go2rtcId) {
      return (
        <div key={cam.id} className="nvr-cell">
          <div className="nvr-nosig">
            <span className="nvr-nosig-ico">️</span>
            <span className="nvr-nosig-txt">Chưa cấu hình</span>
          </div>
          <div className="nvr-ch">CH{ch} · {cam.name}</div>
        </div>
      );
    }

    const isExpanded = expandedCamId === cam.id;
    const subId = cfg.go2rtc_sub_id || go2rtcId;
    const mainId = cfg.go2rtc_main_id || go2rtcId;
    const baseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
    const cellBoundaries = roiBoundaries[baseDeviceId] || [];
    const cellPoints = roiPoints[baseDeviceId] || [];
    const activeId = isExpanded ? mainId : subId;
    const status = deviceStatus[baseDeviceId] || 'unknown';
    
    const isAI = !!aiStreamCells[cam.id];
    const isOptical = cam.id.endsWith('_optical'); // Nhận diện camera quang học trong bộ đôi

    const hasAlert = alerts.some(alert => {
      const alertDevId = typeof alert.deviceId === 'string' ? alert.deviceId.toLowerCase() : '';
      if (!alertDevId) return false;
      const baseCamIdLower = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();

      // 1. Direct match
      if (alertDevId === baseCamIdLower) {
        const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
        const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
        const isOpticalCell = cam.id.endsWith('_optical');
        const isThermalCell = cam.id.endsWith('_thermal');
        if (isThermalAlert && isOpticalCell) return false;
        if (!isThermalAlert && isThermalCell) return false;
        return true;
      }

      // 2. cabinetId match
      const origCam = devices.find((d: Device) => d.id.toLowerCase() === baseCamIdLower);
      if (origCam) {
        const camCfg = (origCam as any).config || {};
        const cabIdStr = typeof camCfg.cabinetId === 'string' ? camCfg.cabinetId.toLowerCase() : '';
        if (cabIdStr && cabIdStr === alertDevId) {
          const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
          const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
          const isOpticalCell = cam.id.endsWith('_optical');
          const isThermalCell = cam.id.endsWith('_thermal');
          if (isThermalAlert && isOpticalCell) return false;
          if (!isThermalAlert && isThermalCell) return false;
          return true;
        }
        
        // 3. zone match fallback
        const camZone = typeof camCfg.zone === 'string' ? camCfg.zone.trim().toLowerCase() : '';
        if (camZone) {
          const alertDev = devices.find((d: Device) => d.id.toLowerCase() === alertDevId);
          const alertCfgZone = (alertDev?.config as any)?.zone;
          const alertDevZone = typeof alertCfgZone === 'string' ? alertCfgZone.trim().toLowerCase() : '';
          if (alertDevZone && alertDevZone === camZone) {
            const alertMsg = typeof alert.message === 'string' ? alert.message.toLowerCase() : '';
            const isThermalAlert = alertMsg.match(/nhiệt|nhiet|roi|thermal|quá nhiệt|qua nhiet|temp/);
            const isOpticalCell = cam.id.endsWith('_optical');
            const isThermalCell = cam.id.endsWith('_thermal');
            if (isThermalAlert && isOpticalCell) return false;
            if (!isThermalAlert && isThermalCell) return false;
            return true;
          }
        }
      }
      return false;
    });
    
    const rawStreamUrl = `/camera-stream.html?src=${encodeURIComponent(activeId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`;
    const aiStreamUrl = `${AI_ENGINE_URL}/stream/${activeId}`;

    return (
      <div 
        key={cam.id} 
        className={`nvr-cell ${isExpanded ? 'expanded' : ''} ${hasAlert ? 'alarm-triggered' : ''}`} 
        style={{ display: (expandedCamId && !isExpanded) ? 'none' : 'block' }}
        onDoubleClick={() => toggleExpand(cam.id)}
      >
        <div className={`nvr-stream-wrapper ${isOptical ? 'nvr-sync-zoom' : ''}`}>
          {isAI ? (
            <img src={aiStreamUrl} alt={cam.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <iframe 
              src={rawStreamUrl} 
              allow="autoplay; camera; microphone" 
              title={cam.name} 
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
                pointerEvents: 'none',
                zIndex: 1
              }}
            />
          )}
          {!isAI && (
            <div 
              className="nvr-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2
              }}
            >
              {/* VVR Dashed Bounding Box for Optical Stream */}
              {(() => {
                const isThermal = cam.id.endsWith('_thermal') || cam.type === 'camera_thermal';
                if (isThermal) return null;

                // Resolve linked thermal camera for CCTV/optical streams
                let targetCam = cam;
                let targetBaseDeviceId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
                if (cam.type !== 'camera_dual' && !cam.id.includes('_optical')) {
                  const c = cam.config || {};
                  if (c.ip) {
                    const linkedThermal = devices.find(d => 
                      (d.type === 'camera_thermal' || d.type === 'camera_dual') && 
                      (d.config as any)?.ip === c.ip
                    );
                    if (linkedThermal) {
                      targetBaseDeviceId = linkedThermal.id.toLowerCase();
                      targetCam = linkedThermal as any;
                    } else {
                      return null;
                    }
                  } else {
                    return null;
                  }
                }

                const cfg = targetCam.config || {};
                const focalOpt = cfg.focal_length_optical;
                const focalTh = cfg.focal_length_thermal;
                const isFocalEqual = focalOpt != null && focalTh != null && Number(focalOpt) === Number(focalTh);
                const vvrRaw = (cfg as any).visible_valid_rect;
                const vvr = isFocalEqual ? { x: 0, y: 0, width: 1, height: 1 } : (vvrCache[targetBaseDeviceId]
                  ?? (vvrRaw && typeof vvrRaw.x === 'number' ? vvrRaw : { x: 0.20, y: 0.084, width: 0.63, height: 0.841 }));
                
                // Only show dashed box if it's not the full 1:1 view
                if (vvr.x === 0 && vvr.y === 0 && vvr.width === 1 && vvr.height === 1) return null;

                const pct = (val: number) => `${val * 100}%`;
                return (
                  <div style={{ position:'absolute', left:pct(vvr.x), top:pct(vvr.y), width:pct(vvr.width), height:pct(vvr.height), border:'1.5px dashed rgba(239, 68, 68, 0.55)', pointerEvents:'none', zIndex:5 }}>
                    <div style={{ position:'absolute', top:-16, left:4, color:'#ef4444', fontSize:9, fontWeight:600, opacity:0.9, background:'rgba(15,23,42,0.85)', border:'1px solid rgba(239,68,68,0.25)', padding:'1px 5px', borderRadius:2, whiteSpace:'nowrap' }}>Vùng ảnh nhiệt</div>
                  </div>
                );
              })()}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  overflow: 'visible',
                  zIndex: 1
                }}
              >
                {renderOverlayBoundaries(cam)}
                {renderOverlayPdBoundaries(cam)}
                {/* Marker đốm PD */}
                {(() => {
                  const baseId = cam.id.replace(/_(optical|thermal)$/, '').toLowerCase();
                  const det = aiStatsMap[baseId]?.detection;
                  if (!det) return null;
                  return (
                    <g transform={`translate(${det.x * 100}, ${det.y * 100})`}>
                      <circle r="2" fill="none" stroke="#fff" strokeWidth="0.5" />
                      <line x1="-2.5" y1="0" x2="2.5" y2="0" stroke="#ef4444" strokeWidth="0.6" />
                      <line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#ef4444" strokeWidth="0.6" />
                    </g>
                  );
                })()}
              </svg>
              {renderOverlayLabels(cam)}
            </div>
          )}
        </div>
        
        <div className="nvr-hud-t">
          <div className="nvr-cam-info">
            <span className={`nvr-dot ${status}`} />
            <span className="nvr-cname">CH{ch} · {cam.name}</span>
            {cellBoundaries.length > 0 && (
              <span style={{ 
                background: 'rgba(59, 130, 246, 0.2)', 
                color: '#3b82f6', 
                fontSize: '0.65rem', 
                padding: '1px 5.5px', 
                borderRadius: 3, 
                marginLeft: 8,
                fontWeight: 600,
                border: '1px solid rgba(59, 130, 246, 0.4)' 
              }}>
                Vùng nhiệt: {cellBoundaries.length}
              </span>
            )}
            {cellPoints.length > 0 && (
              <span style={{ 
                background: 'rgba(16, 185, 129, 0.2)', 
                color: '#10b981', 
                fontSize: '0.65rem', 
                padding: '1px 5.5px', 
                borderRadius: 3, 
                marginLeft: 8,
                fontWeight: 600,
                border: '1px solid rgba(16, 185, 129, 0.4)' 
              }}>
                Điểm nhiệt: {cellPoints.length}
              </span>
            )}
          </div>
          <div className="nvr-rec"><span className="nvr-recdot" />REC</div>
        </div>

        <div className="nvr-hud-b">
          <div className="nvr-acts">
            <button 
              className={`nvr-abtn ${isAI ? 'active' : ''}`} 
              title={isAI ? "Tắt luồng AI (Hiện luồng thô)" : "Bật luồng AI (Hiện bounding box/line/nhiệt độ từ OpenCV)"} 
              onClick={(e) => { e.stopPropagation(); setAiStreamCells(prev => ({ ...prev, [cam.id]: !prev[cam.id] })); }}
              style={{ color: isAI ? '#3b82f6' : 'inherit', fontSize: '9px', fontWeight: 'bold' }}
            >
              AI
            </button>
            <button 
              className="nvr-abtn" 
              title="Chụp ảnh" 
              onClick={(e) => { e.stopPropagation(); takeSnapshot(activeId); }}
            >
              📸
            </button>
            <button 
              className="nvr-abtn" 
              title="Xem toàn màn hình" 
              onClick={(e) => { e.stopPropagation(); toggleExpand(cam.id); }}
            >
              ⛶
            </button>
          </div>
        </div>
      </div>
    );
  };

  /** Phóng to/thu nhỏ ô camera — khi thu nhỏ sẽ reset bộ lọc camera. */
  const toggleExpand = (camId: string) => {
    if (expandedCamId === camId) {
      setExpandedCamId(null);
      setSelectedCamFilter(''); // Reset filter when un-expanding
    } else {
      setExpandedCamId(camId);
      setSelectedCamFilter(camId);
    }
  };

  /** Tải ảnh chụp tức thời từ go2rtc về máy người dùng. */
  const takeSnapshot = (srcId: string) => {
    const url = `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(srcId)}`;
    Object.assign(document.createElement('a'), { href: url, download: `snap_${Date.now()}.jpg`, target: '_blank' }).click();
  };


  return (
    <div className="rtm-page">

      {/* ── Toolbar ── */}
      {(!isCentralFleetView || effectiveStationId) && (
        <div className="page-toolbar-row dash-header" style={{ height: 32, minHeight: 32 }}>
          {((embeddedMode !== 'central') || (embeddedMode === 'central' && effectiveStationId)) && (
            <div className="page-title-cell">
              {embeddedMode !== 'central' && <h2>GIÁM SÁT CAMERA TRỰC TIẾP</h2>}
              {embeddedMode === 'central' && effectiveStationId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    padding: '2px 10px', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--admin-border)',
                    color: 'var(--admin-accent)',
                    fontSize: '.72rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.05em'
                  }}>
                    {stations.find(s => s.id === effectiveStationId)?.name || 'Chi tiết trạm'}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="page-toolbar-group">
            {!isCentralFleetView && (
              <>
            {/* Grid Layout Selector Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="btn-industrial"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 28,
                  padding: '0 10px',
                  background: dropdownOpen ? 'var(--admin-hover)' : 'var(--admin-layer-2)',
                  border: '1px solid var(--admin-border)',
                  color: 'var(--admin-text)',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                <Grid size={14} style={{ color: 'var(--admin-accent)' }} />
                <span>Bố cục: {layout.cols} × {layout.rows}</span>
                <ChevronDown size={12} style={{ opacity: 0.6 }} />
              </button>

              {dropdownOpen && (
                <>
                  {/* Click overlay to close */}
                  <div
                    onClick={() => {
                      setDropdownOpen(false);
                      setHoverGrid(null);
                    }}
                    style={{
                      position: 'fixed',
                      inset: 0,
                      zIndex: 998,
                    }}
                  />
                  
                  {/* Dropdown panel */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      background: 'var(--admin-layer-2)',
                      border: '1px solid var(--admin-border)',
                      padding: 12,
                      zIndex: 999,
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                      borderRadius: 0,
                      width: 'max-content',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Chọn bố cục nhanh
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
                      {[
                        { cols: 1, rows: 1, label: 'Lưới 1×1' },
                        { cols: 2, rows: 2, label: 'Lưới 2×2' },
                        { cols: 3, rows: 3, label: 'Lưới 3×3' },
                        { cols: 4, rows: 4, label: 'Lưới 4×4' },
                        { cols: 6, rows: 4, label: 'Lưới 6×4' },
                        { cols: 6, rows: 5, label: 'Lưới 6×5' },
                        { cols: 6, rows: 6, label: 'Lưới 6×6' },
                        { cols: 8, rows: 8, label: 'Lưới 8×8' },
                      ].map((preset) => (
                        <button
                          key={`${preset.cols}-${preset.rows}`}
                          onClick={() => {
                            setLayout(preset);
                            setExpandedCamId(null);
                            setDropdownOpen(false);
                          }}
                          style={{
                            background: (layout.cols === preset.cols && layout.rows === preset.rows) ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                            border: (layout.cols === preset.cols && layout.rows === preset.rows) ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                            color: (layout.cols === preset.cols && layout.rows === preset.rows) ? '#f59e0b' : 'var(--admin-text)',
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '4px 2px',
                            cursor: 'pointer',
                            textAlign: 'center',
                            borderRadius: 0,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                          }}
                          onMouseLeave={(e) => {
                            const isSel = layout.cols === preset.cols && layout.rows === preset.rows;
                            e.currentTarget.style.background = isSel ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)';
                            e.currentTarget.style.borderColor = isSel ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.1)';
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Lưới tự chọn
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#f59e0b' }}>
                          {hoverGrid ? `${hoverGrid.cols} × ${hoverGrid.rows} (${hoverGrid.cols * hoverGrid.rows} ô)` : `${layout.cols} × ${layout.rows} (${layout.cols * layout.rows} ô)`}
                        </span>
                      </div>

                      <div 
                        onMouseLeave={() => setHoverGrid(null)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(10, 18px)',
                          gap: 3,
                          background: 'rgba(0, 0, 0, 0.15)',
                          padding: 6,
                          border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                      >
                        {Array.from({ length: 10 }).map((_, r) =>
                          Array.from({ length: 10 }).map((_, c) => {
                            const isHighlighted = hoverGrid
                              ? (r < hoverGrid.rows && c < hoverGrid.cols)
                              : (r < layout.rows && c < layout.cols);
                            return (
                              <div
                                key={`${r}-${c}`}
                                onMouseEnter={() => setHoverGrid({ rows: r + 1, cols: c + 1 })}
                                onClick={() => {
                                  setLayout({ cols: c + 1, rows: r + 1 });
                                  setExpandedCamId(null);
                                  setDropdownOpen(false);
                                  setHoverGrid(null);
                                }}
                                style={{
                                  width: 18,
                                  height: 18,
                                  background: isHighlighted ? 'rgba(245, 158, 11, 0.45)' : 'rgba(255, 255, 255, 0.04)',
                                  border: isHighlighted ? '1px solid rgba(245, 158, 11, 0.8)' : '1px solid rgba(255, 255, 255, 0.08)',
                                  cursor: 'pointer',
                                  transition: 'all 0.1s ease',
                                }}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 10, marginTop: 10 }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Lưu bố cục hiện tại
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        <input
                          type="text"
                          value={newLayoutName}
                          onChange={(e) => setNewLayoutName(e.target.value)}
                          placeholder="Tên bố cục..."
                          style={{
                            flex: 1,
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            fontSize: '11px',
                            padding: '4px 8px',
                            outline: 'none',
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveLayout();
                            }
                          }}
                        />
                        <button
                          onClick={handleSaveLayout}
                          style={{
                            background: '#f59e0b',
                            color: '#000',
                            border: 'none',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '4px 10px',
                            cursor: 'pointer',
                            borderRadius: 0,
                          }}
                        >
                          Lưu
                        </button>
                      </div>

                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--admin-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Bố cục đã lưu
                      </div>
                      {savedLayouts.length === 0 ? (
                        <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.3)', fontStyle: 'italic', padding: '2px 0' }}>
                          Chưa có bố cục nào được lưu
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                          {savedLayouts.map((l) => (
                            <div
                              key={l.id}
                              onClick={() => {
                                setLayout({ cols: l.cols, rows: l.rows });
                                setSelectedCamFilter(l.selectedCamFilter);
                                setDropdownOpen(false);
                              }}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '4px 6px',
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                              }}
                            >
                              <span style={{ fontSize: '11px', color: 'var(--admin-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                                {l.name} ({l.cols}x{l.rows})
                              </span>
                              <button
                                onClick={(e) => handleDeleteLayout(l.id, e)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'rgba(255, 255, 255, 0.4)',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  padding: '0 4px',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="rtm-sep" />
            <ToolbarSelect
              value={selectedCamFilter}
              onChange={v => { setSelectedCamFilter(v); if (v) setLayout({ cols: 1, rows: 1 }); else setLayout({ cols: 2, rows: 2 }); }}
              options={[{ value: '', label: 'Tất cả camera' }, ...sortedCamOptions]}
              width={180}
            />

            {expandedCamId && (
              <div className="nvr-back-btn visible" onClick={() => toggleExpand(expandedCamId)}>
                ← Quay về lưới
              </div>
            )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="rtm-main">
        {isCentralFleetView ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', overflow: 'hidden' }}>

            {/* Station Mosaic Grid */}
            <div className="rtm-fleet-scroll">
               <div
                 className="rtm-fleet-grid"
                 style={{
                   gridTemplateColumns: `repeat(${fleetGridConfig.columns}, minmax(0, 1fr))`,
                   gridTemplateRows: `repeat(${fleetGridConfig.rows}, minmax(0, 1fr))`,
                 }}
               >
                  {filteredStats.map(stat => {
                     const cam = stat.firstCam;
                     const health = stat.total > 0 ? Math.round((stat.online / stat.total) * 100) : 0;
                     const healthColor = health === 100 ? 'var(--admin-success)' : health >= 50 ? 'var(--admin-accent)' : 'var(--admin-danger)';
                     
                     return (
                        <div 
                          key={stat.stationId} 
                          className="admin-card rtm-fleet-card"
                          onClick={() => stat.stationId && onStationIdChange?.(stat.stationId)}
                        >
                           {/* Station Header */}
                           <div className="rtm-fleet-card-header">
                              <div className="rtm-fleet-card-title">
                                 <div className="rtm-fleet-card-dot" style={{ background: stat.online > 0 ? 'var(--admin-success)' : 'var(--admin-danger)', boxShadow: stat.online > 0 ? '0 0 5px var(--admin-success)' : 'none' }} />
                                 <b>{stat.stationName.toUpperCase()}</b>
                              </div>
                              {stat.alertCount > 0 && (
                                 <div className="rtm-fleet-alert-badge">
                                    <AlertTriangle size={10} /> {stat.alertCount}
                                 </div>
                              )}
                           </div>

                           {/* Preview Section */}
                           <div className="rtm-fleet-preview">
                              {cam ? (
                                 <iframe 
                                    src={`/camera-stream.html?src=${encodeURIComponent(cam.config.go2rtc_id || cam.config.go2rtc_optical || '')}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`}
                                    className="rtm-fleet-preview-frame"
                                    title={cam.name}
                                 />
                              ) : (
                                 <div className="rtm-fleet-nosignal">
                                    <Video size={32} />
                                    <div style={{ fontSize: '.6rem', fontWeight: 900, letterSpacing: '0.2em' }}>NO SIGNAL</div>
                                 </div>
                              )}
                              <div className="rtm-fleet-preview-overlay" />
                              <div className="rtm-fleet-preview-meta">
                                 <span className="rtm-fleet-preview-name">{cam?.name || '---'}</span>
                                 <span className="rtm-fleet-preview-live">LIVE</span>
                              </div>
                           </div>

                           {/* Station Footer Stats */}
                           <div className="rtm-fleet-card-footer">
                              <div className="rtm-fleet-card-online">
                                 ONLINE: <span style={{ color: 'var(--admin-text)' }}>{stat.online}</span> / {stat.total}
                              </div>
                              <div className="rtm-fleet-card-health">
                                 <div className="rtm-fleet-card-healthbar">
                                    <div style={{ width: `${health}%`, height: '100%', background: healthColor, borderRadius: 2, transition: 'width 0.5s' }} />
                                 </div>
                                 <span className="rtm-fleet-card-healthpct" style={{ color: healthColor }}>{health}%</span>
                              </div>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>


          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {/* Camera Sidebar */}
            <div className="admin-card rtm-sidebar" style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderRight: '1px solid var(--admin-border)', borderRadius: 0, background: 'var(--admin-layer-2)' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--admin-border)', fontSize: '.72rem', fontWeight: 800, color: 'var(--admin-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>DANH SÁCH CAMERA</span>
                {selectedCamFilter && (
                  <button 
                    onClick={() => { setSelectedCamFilter(''); setExpandedCamId(null); setLayout({ cols: 2, rows: 2 }); }}
                    style={{ background: 'none', border: 'none', color: 'var(--admin-accent)', fontSize: '10px', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                  >
                    Hiện tất cả
                  </button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div 
                  onClick={() => { setSelectedCamFilter(''); setExpandedCamId(null); setLayout({ cols: 2, rows: 2 }); }} 
                  style={{
                    padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--admin-border)',
                    background: !selectedCamFilter ? 'rgba(59,130,246,.08)' : 'transparent',
                    borderLeft: !selectedCamFilter ? '3px solid var(--admin-accent)' : '3px solid transparent',
                    display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s'
                  }}
                >
                  <Grid size={14} style={{ color: !selectedCamFilter ? 'var(--admin-accent)' : 'var(--admin-text-muted)' }} />
                  <span style={{ fontWeight: !selectedCamFilter ? 800 : 600, fontSize: '.75rem', color: !selectedCamFilter ? 'var(--admin-text)' : 'var(--admin-text-muted)' }}>Tất cả camera</span>
                </div>
                {stationCams.map(c => {
                  const active = selectedCamFilter === c.id;
                  const baseId = c.id.replace(/_(optical|thermal)$/, '').toLowerCase();
                  const status = deviceStatus[baseId] || 'unknown';
                  return (
                    <div 
                      key={c.id} 
                      onClick={() => {
                        setSelectedCamFilter(c.id);
                        setExpandedCamId(c.id);
                        setLayout({ cols: 1, rows: 1 });
                      }} 
                      style={{
                        padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--admin-border)',
                        background: active ? 'rgba(59,130,246,.08)' : 'transparent',
                        borderLeft: active ? '3px solid var(--admin-accent)' : '3px solid transparent',
                        display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s'
                      }}
                    >
                      <span className={`nvr-dot ${status}`} style={{ width: 6, height: 6 }} />
                      <span style={{ fontWeight: active ? 800 : 500, fontSize: '.75rem', color: active ? 'var(--admin-text)' : 'var(--admin-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {c.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* NVR Wrap Grid */}
            <div className="nvr-wrap">
              {(() => {
                const { cols, rows } = selectedCamFilter ? { cols: 1, rows: 1 } : layout;
                const displayCellCount = selectedCamFilter ? 1 : cellCount;
                return (
                  <div 
                    className="nvr-grid"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gridTemplateRows: `repeat(${rows}, 1fr)`,
                    }}
                  >
                    {Array.from({ length: displayCellCount }).map((_, i) => renderCell(displayCams[i], i))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Events Panel — tạm ẩn */}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="nvr-lb-overlay open" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}>
          <span className="nvr-lb-close" onClick={() => setLightbox(null)}></span>
          <div className="nvr-lb-content">
            {lightbox.isVideo ? (
              <video src={lightbox.url} controls autoPlay loop style={{ maxHeight: '85vh' }} />
            ) : (
              <img src={lightbox.url} alt="snapshot" style={{ maxHeight: '85vh' }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
