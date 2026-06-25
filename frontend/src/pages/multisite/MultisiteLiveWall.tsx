import { useState, useEffect, useMemo } from 'react';
import {
  Video, Wifi, WifiOff, AlertTriangle, ChevronLeft, ChevronRight,
  RefreshCw, Save, Grid, ChevronDown, Trash2, Monitor, MapPin, Plus, Edit2, Play, ExternalLink,
} from 'lucide-react';
import type { StationView } from './types';
import type { Province, Team, CameraDevice } from '@/types/api.types';
import { stationApi } from '@/services/StationApiService';
import { GO2RTC_URL } from '@/utils/env';

/* ── Types ──────────────────────────────────────────────────────── */
interface CellAssignment {
  stationId: string;
  stationName: string;
  provinceName: string;
  cameraId: string;
  cameraName: string;
  go2rtcId: string;
  go2rtcBase: string;
}

interface WallPreset {
  id: string;
  name: string;
  layout: { cols: number; rows: number };
  cells: Record<number, CellAssignment>;
  createdAt: string;
}

type Screen = 'list' | 'wall';
type SideStep = 'province' | 'station' | 'camera';

const STORAGE_KEY = 'ms_wall_presets_v1';

/* ── Helpers ─────────────────────────────────────────────────────── */
function loadPresets(): WallPreset[] {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
  return [];
}
function savePresets(list: WallPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function expandCameras(cams: CameraDevice[]): CameraDevice[] {
  const out: CameraDevice[] = [];
  cams.forEach(c => {
    const cfg = (c as any).config || {};
    if (c.type === 'camera_dual') {
      out.push({ ...c, id: `${c.id}_optical`, name: `${c.name} (Quang học)`, config: { ...cfg, go2rtc_id: cfg.go2rtc_optical || cfg.go2rtc_id } } as any);
      out.push({ ...c, id: `${c.id}_thermal`,  name: `${c.name} (Nhiệt)`,     config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id } } as any);
    } else {
      out.push({ ...c, config: cfg } as any);
    }
  });
  return out;
}

/* ── Props ───────────────────────────────────────────────────────── */
interface Props {
  views: StationView[];
  provinces: Province[];
  teams: Team[];
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */
export default function MultisiteLiveWall({ views, provinces }: Props) {
  const [presets, setPresets]     = useState<WallPreset[]>(loadPresets);
  const [screen, setScreen]       = useState<Screen>('list');
  const [activePreset, setActivePreset] = useState<WallPreset | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const persistPresets = (list: WallPreset[]) => { setPresets(list); savePresets(list); };

  /* ── open a preset in play mode ── */
  const openPreset = (p: WallPreset) => {
    setActivePreset(p);
    setIsEditing(false);
    setScreen('wall');
    setRefreshKey(k => k + 1);
  };

  /* ── open a preset in edit mode (or create new) ── */
  const editPreset = (p: WallPreset | null) => {
    setActivePreset(p ?? {
      id: Date.now().toString(),
      name: '',
      layout: { cols: 2, rows: 2 },
      cells: {},
      createdAt: new Date().toISOString(),
    });
    setIsEditing(true);
    setScreen('wall');
  };

  /* ── save edited preset ── */
  const handleSavePreset = (updated: WallPreset) => {
    const exists = presets.some(p => p.id === updated.id);
    const list = exists
      ? presets.map(p => p.id === updated.id ? updated : p)
      : [...presets, updated];
    persistPresets(list);
    setActivePreset(updated);
    setIsEditing(false);
    setScreen('list');
  };

  const handleDeletePreset = (id: string) => {
    persistPresets(presets.filter(p => p.id !== id));
    if (activePreset?.id === id) { setActivePreset(null); setScreen('list'); }
  };

  /* ──────────────────────────────────── */
  if (screen === 'list') {
    return (
      <PresetList
        presets={presets}
        onOpen={openPreset}
        onEdit={p => editPreset(p)}
        onNew={() => editPreset(null)}
        onDelete={handleDeletePreset}
      />
    );
  }

  return (
    <WallView
      preset={activePreset!}
      views={views}
      provinces={provinces}
      isEditing={isEditing}
      refreshKey={refreshKey}
      onBack={() => { setScreen('list'); setIsEditing(false); }}
      onEdit={() => setIsEditing(true)}
      onSave={handleSavePreset}
      onRefresh={() => setRefreshKey(k => k + 1)}
      onCancelEdit={() => {
        if (!presets.some(p => p.id === activePreset?.id)) {
          setScreen('list');
        }
        setIsEditing(false);
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PRESET LIST SCREEN
═══════════════════════════════════════════════════════════════════ */
function PresetList({
  presets, onOpen, onEdit, onNew, onDelete,
}: {
  presets: WallPreset[];
  onOpen: (p: WallPreset) => void;
  onEdit: (p: WallPreset) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [deleteTarget, setDeleteTarget] = useState<WallPreset | null>(null);

  const openDd = (id: string, btn: HTMLElement) => {
    const rect = btn.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    setOpenDropdown(id);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', overflow: 'hidden' }}
      onClick={() => setOpenDropdown(null)}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, height: 42, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-panel)' }}>
        <Monitor size={13} style={{ color: 'var(--admin-accent)' }} />
        <span style={{ fontSize: '0.7rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--admin-text)' }}>TRỰC TIẾP ĐA TRẠM</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--admin-text-muted)' }}>— Cấu hình đã lưu</span>
        <button
          onClick={onNew}
          style={{ marginLeft: 'auto', height: 28, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--admin-accent)', border: 'none', borderRadius: 0, color: '#fff', fontSize: '0.62rem', fontWeight: 800, cursor: 'pointer', letterSpacing: '0.04em' }}
        >
          <Plus size={11} /> TẠO CẤU HÌNH MỚI
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {presets.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, gap: 14, color: 'var(--admin-text-muted)' }}>
            <Monitor size={40} style={{ opacity: 0.15 }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Chưa có cấu hình nào</span>
            <button
              onClick={onNew}
              style={{ padding: '8px 20px', background: 'var(--admin-accent)', border: 'none', borderRadius: 0, color: '#fff', fontSize: '0.68rem', fontWeight: 800, cursor: 'pointer' }}
            >
              Tạo cấu hình đầu tiên
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {presets.map(p => {
            const camCount = Object.keys(p.cells).length;
            const maxCells = p.layout.cols * p.layout.rows;
            return (
              <div
                key={p.id}
                style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-border)'}
              >
                {/* Mini grid preview */}
                <div
                  onClick={() => onOpen(p)}
                  style={{ padding: 14, cursor: 'pointer', display: 'grid', gap: 3, gridTemplateColumns: `repeat(${p.layout.cols}, 1fr)`, aspectRatio: `${p.layout.cols}/${p.layout.rows}`, background: '#0a0f1a' }}
                >
                  {Array.from({ length: maxCells }, (_, i) => {
                    const c = p.cells[i];
                    return (
                      <div key={i} style={{ background: c ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${c ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {c ? <Video size={8} style={{ color: '#f59e0b', opacity: 0.7 }} /> : null}
                      </div>
                    );
                  })}
                </div>

                {/* Info */}
                <div style={{ padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || 'Chưa đặt tên'}</div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--admin-text-muted)' }}>
                    Lưới {p.layout.cols}×{p.layout.rows} &nbsp;·&nbsp; {camCount}/{maxCells} camera
                  </div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--admin-text-muted)', opacity: 0.6 }}>
                    {new Date(p.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ borderTop: '1px solid var(--admin-border)', display: 'flex', position: 'relative' }}>
                  {/* XEM split button */}
                  <button
                    onClick={e => { e.stopPropagation(); onOpen(p); }}
                    style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'transparent', border: 'none', borderRight: '1px solid var(--admin-border)', color: 'var(--admin-accent)', fontSize: '0.6rem', fontWeight: 800, cursor: 'pointer', letterSpacing: '0.04em' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(14,165,233,0.08)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <Play size={10} /> XEM
                  </button>
                  {/* Dropdown toggle */}
                  <div style={{ borderRight: '1px solid var(--admin-border)' }}>
                    <button
                      onClick={e => { e.stopPropagation(); openDd(p.id, e.currentTarget as HTMLElement); }}
                      style={{ width: 26, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer' }}
                      title="Chọn cách xem"
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <ChevronDown size={11} />
                    </button>
                  </div>

                  <button
                    onClick={e => { e.stopPropagation(); onEdit(p); }}
                    style={{ width: 44, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRight: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)', cursor: 'pointer' }}
                    title="Chỉnh sửa"
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--admin-text)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--admin-text-muted)'}
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(p); }}
                    style={{ width: 44, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--admin-text-muted)', cursor: 'pointer' }}
                    title="Xóa"
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--admin-danger)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--admin-text-muted)'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed dropdown — renders outside cards to avoid overflow clipping */}
      {openDropdown && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: 200, zIndex: 9999 }}
        >
          {(() => {
            const p = presets.find(x => x.id === openDropdown);
            if (!p) return null;
            return (
              <>
                <button
                  onClick={() => { onOpen(p); setOpenDropdown(null); }}
                  style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, background: 'transparent', border: 'none', borderBottom: '1px solid var(--admin-border)', color: 'var(--admin-text)', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <Monitor size={13} style={{ color: 'var(--admin-accent)', flexShrink: 0 }} />
                  Xem trong trang
                </button>
                <button
                  onClick={() => {
                    window.open(`/live-wall?presetId=${encodeURIComponent(p.id)}`, `wall_${p.id}`, 'noopener,noreferrer,width=1440,height=900');
                    setOpenDropdown(null);
                  }}
                  style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, background: 'transparent', border: 'none', color: 'var(--admin-text)', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <ExternalLink size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  Mở cửa sổ mới
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 0, padding: '24px 28px', width: 340, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
              <Trash2 size={16} style={{ color: 'var(--admin-danger)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--admin-text)' }}>Xóa cấu hình</span>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--admin-text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Bạn có chắc muốn xóa cấu hình <strong style={{ color: 'var(--admin-text)' }}>"{deleteTarget.name}"</strong>? Hành động này không thể hoàn tác.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ padding: '7px 18px', background: 'var(--admin-layer-4)', border: '1px solid var(--admin-border)', borderRadius: 0, color: 'var(--admin-text)', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-layer-3)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--admin-layer-4)'}
              >
                Hủy
              </button>
              <button
                onClick={() => { onDelete(deleteTarget.id); setDeleteTarget(null); }}
                style={{ padding: '7px 18px', background: 'var(--admin-danger)', border: 'none', borderRadius: 0, color: '#fff', fontSize: '0.65rem', fontWeight: 800, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WALL VIEW SCREEN  (play + edit mode)
═══════════════════════════════════════════════════════════════════ */
function WallView({
  preset, views, provinces, isEditing, refreshKey,
  onBack, onEdit, onSave, onCancelEdit, onRefresh,
}: {
  preset: WallPreset;
  views: StationView[];
  provinces: Province[];
  isEditing: boolean;
  refreshKey: number;
  onBack: () => void;
  onEdit: () => void;
  onSave: (p: WallPreset) => void;
  onCancelEdit: () => void;
  onRefresh: () => void;
}) {
  const [working, setWorking] = useState<WallPreset>(() => ({ ...preset, cells: { ...preset.cells } }));

  // Re-sync when switching from play→edit or loading a different preset
  useEffect(() => {
    setWorking({ ...preset, cells: { ...preset.cells } });
    setSelectedCell(0);
    setSideStep('province');
    setPickedProvince(null);
    setPickedStation(null);
    setStationCameras([]);
  }, [preset.id, isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const [layoutOpen, setLayoutOpen]   = useState(false);
  const [selectedCell, setSelectedCell] = useState(0);
  const [sideStep, setSideStep]       = useState<SideStep>('province');
  const [pickedProvince, setPickedProvince] = useState<string | null>(null);
  const [pickedStation, setPickedStation]   = useState<StationView | null>(null);
  const [stationCameras, setStationCameras] = useState<CameraDevice[]>([]);
  const [go2rtcBase, setGo2rtcBase]         = useState<string | null>(null);
  const [loadingCams, setLoadingCams]       = useState(false);

  const maxCells = working.layout.cols * working.layout.rows;

  const updateLayout = (l: { cols: number; rows: number }) => {
    setWorking(w => ({ ...w, layout: l }));
    setLayoutOpen(false);
    setSelectedCell(0);
  };

  /* ── Province groups ── */
  const provMap = useMemo(() => Object.fromEntries(provinces.map(p => [p.id, p.name])), [provinces]);

  const provinceGroups = useMemo(() => {
    const map = new Map<string, StationView[]>();
    for (const v of views) {
      const pid = v.station.provinceId ?? '__none__';
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(v);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        if (a === '__none__') return 1; if (b === '__none__') return -1;
        return (provMap[a] ?? '').localeCompare(provMap[b] ?? '', 'vi');
      })
      .map(([pid, pvViews]) => ({
        pid,
        name: pid === '__none__' ? 'Chưa phân tỉnh' : (provMap[pid] ?? pid.slice(0, 8)),
        views: pvViews,
        online: pvViews.filter(v => v.station.connectionStatus === 'online').length,
        alarms: pvViews.reduce((s, v) => s + v.kpi.alarmsCount, 0),
      }));
  }, [views, provMap]);

  const stationsInProvince = useMemo(() =>
    pickedProvince === '__all__' ? views
      : pickedProvince ? (provinceGroups.find(g => g.pid === pickedProvince)?.views ?? [])
      : [],
    [provinceGroups, pickedProvince, views]);

  /* ── Pick handlers ── */
  const handleProvincePick = (pid: string) => {
    setPickedProvince(pid); setPickedStation(null); setStationCameras([]); setSideStep('station');
  };

  const enrichCameras = (result: Awaited<ReturnType<typeof stationApi.getRemoteCameras>>, view: StationView, provinceName: string) => {
    const getStreamId = (url?: string) => { if (!url) return null; try { return new URL(url).searchParams.get('src'); } catch { return null; } };
    return expandCameras(result.cameras.map(c => {
      const urls = (c.streamUrls || {}) as Record<string, string>;
      const dev = c.device as any;
      let cfg = {};
      if (dev.config) { try { cfg = typeof dev.config === 'string' ? JSON.parse(dev.config) : dev.config; } catch {} }
      return { ...dev, __stationId: view.station.id, __stationName: view.station.name, __provinceName: provinceName, __go2rtcBase: result.go2rtcBase ?? GO2RTC_URL,
        config: { ...cfg, go2rtc_id: (cfg as any).go2rtc_id || getStreamId(urls.main_webrtc), go2rtc_optical: (cfg as any).go2rtc_optical || getStreamId(urls.optical_webrtc), go2rtc_thermal: (cfg as any).go2rtc_thermal || getStreamId(urls.thermal_webrtc) } };
    }));
  };

  const handleStationPick = async (view: StationView) => {
    setPickedStation(view); setStationCameras([]); setGo2rtcBase(null); setLoadingCams(true); setSideStep('camera');
    try {
      const result = await stationApi.getRemoteCameras(view.station.id);
      setGo2rtcBase(result.go2rtcBase ?? null);
      const pGroup = provinceGroups.find(g => g.pid === pickedProvince);
      setStationCameras(enrichCameras(result, view, pGroup?.name ?? ''));
    } catch { setStationCameras([]); } finally { setLoadingCams(false); }
  };

  const handleAllStations = async () => {
    setPickedStation(null); setStationCameras([]); setGo2rtcBase(null); setLoadingCams(true); setSideStep('camera');
    try {
      const results = await Promise.allSettled(
        stationsInProvince.map(v => stationApi.getRemoteCameras(v.station.id).then(r => {
          const pGroup = provinceGroups.find(g => g.pid === (v.station.provinceId ?? '__none__'));
          return enrichCameras(r, v, pGroup?.name ?? '');
        }))
      );
      const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      setStationCameras(all);
    } catch { setStationCameras([]); } finally { setLoadingCams(false); }
  };

  /* Clicking a camera immediately assigns to the selected cell */
  const handleCameraPick = (cam: CameraDevice) => {
    const c = cam as any;
    const stId   = c.__stationId   ?? pickedStation?.station.id   ?? '';
    const stName = c.__stationName ?? pickedStation?.station.name ?? '';
    const prvName = c.__provinceName ?? (pickedProvince === '__all__' ? '' : (provinceGroups.find(g => g.pid === pickedProvince)?.name ?? ''));
    const base   = c.__go2rtcBase  ?? go2rtcBase ?? GO2RTC_URL;
    const assignment: CellAssignment = {
      stationId:    stId,
      stationName:  stName,
      provinceName: prvName,
      cameraId:     cam.id,
      cameraName:   cam.name,
      go2rtcId:     c.config?.go2rtc_id || '',
      go2rtcBase:   base,
    };
    setWorking(w => ({ ...w, cells: { ...w.cells, [selectedCell]: assignment } }));

    // Advance to next empty cell
    const currentCells = { ...working.cells, [selectedCell]: assignment };
    for (let i = 1; i < maxCells; i++) {
      const next = (selectedCell + i) % maxCells;
      if (!currentCells[next]) { setSelectedCell(next); setSideStep('province'); setPickedProvince(null); setPickedStation(null); setStationCameras([]); return; }
    }
    // All cells filled — stay on camera step
  };

  const handleCellClick = (idx: number) => {
    setSelectedCell(idx);
    const existing = working.cells[idx];
    if (existing && isEditing) {
      const view = views.find(v => v.station.id === existing.stationId) ?? null;
      if (view) { setPickedProvince(view.station.provinceId ?? '__none__'); handleStationPick(view); return; }
    }
    if (isEditing) { setSideStep('province'); setPickedProvince(null); setPickedStation(null); setStationCameras([]); }
  };

  const handleClearCell = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setWorking(w => { const c = { ...w.cells }; delete c[idx]; return { ...w, cells: c }; });
  };

  const handleSave = () => {
    if (!working.name.trim()) return;
    onSave({ ...working, name: working.name.trim() });
  };

  const camCount   = Object.keys(working.cells).length;
  const isPlayMode = !isEditing;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#070c14', fontFamily: 'var(--font-mono,"JetBrains Mono","Fira Code",monospace)', color: '#e2e8f0' }}>

      {/* ── TOP BAR ── */}
      <div style={{ flexShrink: 0, height: 40, background: 'rgba(15,23,42,0.97)', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10 }}>
        {/* Back */}
        <button
          onClick={isEditing ? onCancelEdit : onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', height: 26, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: '0.6rem', fontWeight: 700, cursor: 'pointer', borderRadius: 2 }}
        >
          <ChevronLeft size={11} /> {isEditing ? 'Hủy' : 'Danh sách'}
        </button>

        {/* Name */}
        {isEditing ? (
          <input
            value={working.name}
            onChange={e => setWorking(w => ({ ...w, name: e.target.value }))}
            placeholder="Đặt tên cấu hình..."
            style={{ flex: 1, maxWidth: 280, height: 26, padding: '0 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2, color: '#fff', fontSize: '0.68rem', fontWeight: 700, outline: 'none' }}
          />
        ) : (
          <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#fff', flex: 1 }}>{working.name}</span>
        )}

        <span style={{ fontSize: '0.56rem', color: 'rgba(255,255,255,0.3)' }}>{camCount}/{maxCells} camera</span>

        {/* Layout picker (edit only) */}
        {isEditing && (
          <LayoutPicker layout={working.layout} onChange={updateLayout} />
        )}

        {/* Action buttons */}
        {isEditing ? (
          <button
            onClick={handleSave}
            disabled={!working.name.trim()}
            style={{ height: 26, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, background: working.name.trim() ? '#f59e0b' : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 2, color: working.name.trim() ? '#000' : 'rgba(255,255,255,0.2)', fontSize: '0.62rem', fontWeight: 900, cursor: working.name.trim() ? 'pointer' : 'not-allowed', letterSpacing: '0.04em' }}
          >
            <Save size={11} /> LƯU CẤU HÌNH
          </button>
        ) : (
          <>
            <button
              onClick={onRefresh}
              title="Tải lại stream"
              style={{ width: 26, height: 26, padding: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2 }}
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={onEdit}
              style={{ height: 26, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', fontSize: '0.6rem', fontWeight: 700, cursor: 'pointer', borderRadius: 2 }}
            >
              <Edit2 size={10} /> Sửa
            </button>
          </>
        )}
      </div>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── SIDEBAR (edit mode only) ── */}
        {isEditing && (
          <div style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'rgba(15,23,42,0.98)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>

            {/* Selected cell badge */}
            <div style={{ flexShrink: 0, padding: '7px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(245,158,11,0.06)' }}>
              <div style={{ fontSize: '0.52rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 2 }}>Ô ĐANG CẤU HÌNH</div>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, color: '#f59e0b' }}>Ô {selectedCell + 1} / {maxCells}</div>
              {working.cells[selectedCell] && (
                <div style={{ marginTop: 2, fontSize: '0.55rem', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ✓ {working.cells[selectedCell].cameraName}
                </div>
              )}
            </div>

            {/* Step 1 — Province */}
            {sideStep === 'province' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ padding: '7px 14px 4px', fontSize: '0.52rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.07em' }}>CHỌN TỈNH</div>
                {/* Tất cả tỉnh */}
                <div onClick={() => handleProvincePick('__all__')}
                  style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245,158,11,0.05)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.05)'}
                >
                  <MapPin size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.66rem', fontWeight: 800, color: '#f59e0b' }}>Tất cả tỉnh</div>
                    <div style={{ fontSize: '0.54rem', color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{views.length} trạm</div>
                  </div>
                  <ChevronRight size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                </div>
                {provinceGroups.map(g => (
                  <div key={g.pid} onClick={() => handleProvincePick(g.pid)}
                    style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <MapPin size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                      <div style={{ fontSize: '0.54rem', color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                        {g.views.length} trạm · <span style={{ color: '#10b981' }}>{g.online} online</span>
                        {g.alarms > 0 && <span style={{ color: '#ef4444', marginLeft: 6 }}>● {g.alarms} BĐ</span>}
                      </div>
                    </div>
                    <ChevronRight size={11} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}

            {/* Step 2 — Station */}
            {sideStep === 'station' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div
                  onClick={() => { setSideStep('province'); setPickedProvince(null); }}
                  style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
                >
                  <ChevronLeft size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>← TỈNH</div>
                    <div style={{ fontSize: '0.63rem', fontWeight: 800, color: '#f59e0b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pickedProvince === '__all__' ? 'Tất cả tỉnh' : provinceGroups.find(g => g.pid === pickedProvince)?.name}
                    </div>
                  </div>
                </div>
                <div style={{ padding: '7px 14px 4px', fontSize: '0.52rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.07em' }}>CHỌN TRẠM ({stationsInProvince.length})</div>
                {/* Tất cả trạm */}
                <div onClick={handleAllStations}
                  style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245,158,11,0.05)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.1)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.05)'}
                >
                  <Wifi size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.66rem', fontWeight: 800, color: '#f59e0b' }}>Tất cả trạm</div>
                    <div style={{ fontSize: '0.54rem', color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>Tải camera từ {stationsInProvince.length} trạm</div>
                  </div>
                  <ChevronRight size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
                </div>
                {stationsInProvince.map(v => {
                  const online = v.station.connectionStatus === 'online';
                  return (
                    <div key={v.station.id} onClick={() => handleStationPick(v)}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: online ? '#10b981' : '#6b7280', boxShadow: online ? '0 0 5px #10b981' : 'none' }} />
                      {online ? <Wifi size={10} style={{ color: '#10b981', flexShrink: 0 }} /> : <WifiOff size={10} style={{ color: '#6b7280', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.58rem', fontWeight: 700, fontFamily: 'monospace', color: '#f59e0b' }}>{v.station.code || v.station.id.slice(0, 6)}</div>
                        <div style={{ fontSize: '0.62rem', fontWeight: 600, color: online ? '#e2e8f0' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.station.name}</div>
                      </div>
                      {v.kpi.alarmsCount > 0 && <span style={{ fontSize: '0.5rem', fontWeight: 800, color: '#ef4444' }}>●{v.kpi.alarmsCount}</span>}
                      <ChevronRight size={10} style={{ color: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Step 3 — Camera */}
            {sideStep === 'camera' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div
                  onClick={() => { setSideStep('station'); setPickedStation(null); setStationCameras([]); }}
                  style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
                >
                  <ChevronLeft size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)' }}>← TRẠM</div>
                    <div style={{ fontSize: '0.63rem', fontWeight: 800, color: '#f59e0b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickedStation ? pickedStation.station.name : 'Tất cả trạm'}</div>
                  </div>
                </div>
                <div style={{ padding: '7px 14px 4px', fontSize: '0.52rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.07em' }}>
                  CHỌN CAMERA {!loadingCams && `(${stationCameras.length})`}
                </div>
                {loadingCams && (
                  <div style={{ padding: '18px 14px', display: 'flex', gap: 8, alignItems: 'center', color: 'rgba(255,255,255,0.3)' }}>
                    <RefreshCw size={12} style={{ animation: 'ms-spin 1s linear infinite' }} />
                    <span style={{ fontSize: '0.6rem' }}>Đang tải...</span>
                    <style>{`@keyframes ms-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}
                {!loadingCams && stationCameras.length === 0 && (
                  <div style={{ padding: '18px 14px', color: 'rgba(255,255,255,0.25)', fontSize: '0.62rem' }}>Trạm chưa có camera</div>
                )}
                {!loadingCams && stationCameras.map((cam, idx) => {
                  const c = cam as any;
                  const assigned = working.cells[selectedCell]?.cameraId === cam.id;
                  const showStationLabel = !pickedStation && c.__stationName &&
                    (idx === 0 || (stationCameras[idx - 1] as any).__stationId !== c.__stationId);
                  return (
                    <div key={cam.id}>
                      {showStationLabel && (
                        <div style={{ padding: '5px 14px 2px', fontSize: '0.5rem', fontWeight: 900, color: 'rgba(245,158,11,0.6)', letterSpacing: '0.07em', background: 'rgba(245,158,11,0.04)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          {c.__stationName}
                        </div>
                      )}
                      <div onClick={() => handleCameraPick(cam)}
                        style={{ padding: '8px 14px 8px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8, background: assigned ? 'rgba(245,158,11,0.1)' : 'transparent', borderLeft: assigned ? '3px solid #f59e0b' : '3px solid transparent', transition: 'all 0.1s' }}
                        onMouseEnter={e => { if (!assigned) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseLeave={e => { if (!assigned) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <Video size={11} style={{ color: assigned ? '#f59e0b' : 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.64rem', fontWeight: assigned ? 800 : 500, color: assigned ? '#fff' : 'rgba(255,255,255,0.65)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.name}</span>
                        {assigned && <span style={{ fontSize: '0.5rem', fontWeight: 900, color: '#f59e0b' }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CAMERA GRID ── */}
        <div style={{ flex: 1, overflow: 'hidden', padding: 2, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: `repeat(${working.layout.cols}, 1fr)`, gridAutoRows: '1fr', gap: 2 }}>
          {Array.from({ length: maxCells }, (_, i) => {
            const cell = working.cells[i];
            const isSelected = isEditing && selectedCell === i;
            return (
              <div
                key={`${i}-${refreshKey}-${working.id}`}
                onClick={() => isEditing && handleCellClick(i)}
                style={{
                  position: 'relative', background: '#080d15',
                  border: `1px solid ${isSelected ? '#f59e0b' : 'rgba(255,255,255,0.05)'}`,
                  outline: isSelected ? '2px solid #f59e0b' : 'none', outlineOffset: -2,
                  cursor: isEditing ? 'pointer' : 'default',
                  overflow: 'hidden', minHeight: 0,
                  zIndex: isSelected ? 2 : 1, transition: 'border-color 0.15s',
                }}
              >
                {cell ? (
                  <>
                    {cell.go2rtcId ? (
                      <iframe
                        src={`/camera-stream.html?src=${encodeURIComponent(cell.go2rtcId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(cell.go2rtcBase)}`}
                        style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                        allow="autoplay"
                        title={cell.cameraName}
                      />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.1)' }}>
                        <Video size={20} style={{ opacity: 0.3 }} />
                      </div>
                    )}
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'linear-gradient(rgba(0,0,0,0.75),transparent)', padding: '5px 7px 16px', pointerEvents: 'none' }}>
                      {cell.provinceName && (
                        <div style={{ fontSize: '0.42rem', fontWeight: 700, color: 'rgba(245,158,11,0.65)', letterSpacing: '0.05em', marginBottom: 1 }}>{cell.provinceName}</div>
                      )}
                      <div style={{ fontSize: '0.47rem', fontWeight: 900, color: '#f59e0b', letterSpacing: '0.04em' }}>{cell.stationName}</div>
                      <div style={{ fontSize: '0.53rem', fontWeight: 700, color: '#fff' }}>{cell.cameraName}</div>
                    </div>
                    {isEditing && (
                      <button onClick={e => handleClearCell(i, e)} title="Xóa" style={{ position: 'absolute', top: 5, right: 5, width: 18, height: 18, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 2 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.borderColor = '#ef4444'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
                      >
                        <Trash2 size={9} />
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, color: isSelected ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.07)' }}>
                    <Video size={18} style={{ opacity: isSelected ? 0.7 : 0.3 }} />
                    {isEditing && <span style={{ fontSize: '0.48rem', fontWeight: 700 }}>Ô {i + 1}{isSelected ? ' ← chọn camera' : ''}</span>}
                  </div>
                )}
                <div style={{ position: 'absolute', bottom: 4, right: 5, fontSize: '0.43rem', fontWeight: 900, color: isSelected ? '#f59e0b' : 'rgba(255,255,255,0.1)', pointerEvents: 'none' }}>{i + 1}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LAYOUT PICKER — nhập số hoặc chọn ô lưới
═══════════════════════════════════════════════════════════════════ */
function LayoutPicker({ layout, onChange }: { layout: { cols: number; rows: number }; onChange: (l: { cols: number; rows: number }) => void }) {
  const [open, setOpen]           = useState(false);
  const [hoverGrid, setHoverGrid] = useState<{ cols: number; rows: number } | null>(null);
  const [customCols, setCustomCols] = useState(String(layout.cols));
  const [customRows, setCustomRows] = useState(String(layout.rows));

  const apply = (cols: number, rows: number) => {
    const c = Math.max(1, Math.min(20, cols));
    const r = Math.max(1, Math.min(20, rows));
    onChange({ cols: c, rows: r });
    setCustomCols(String(c));
    setCustomRows(String(r));
    setOpen(false);
    setHoverGrid(null);
  };

  const applyCustom = () => {
    const c = parseInt(customCols, 10);
    const r = parseInt(customRows, 10);
    if (!isNaN(c) && !isNaN(r)) apply(c, r);
  };

  const previewLayout = hoverGrid ?? layout;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ height: 26, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 5, background: open ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: '10px', fontWeight: 700, cursor: 'pointer', borderRadius: 0 }}
      >
        <Grid size={11} style={{ color: '#f59e0b' }} />
        {layout.cols}×{layout.rows}
        <ChevronDown size={9} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <>
          <div onClick={() => { setOpen(false); setHoverGrid(null); }} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.1)', padding: 12, zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,0.6)', borderRadius: 0, width: 240 }}>

            {/* Quick presets */}
            <div style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nhanh</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginBottom: 12 }}>
              {[{c:1,r:1},{c:2,r:2},{c:3,r:2},{c:3,r:3},{c:4,r:3},{c:4,r:4},{c:5,r:4},{c:6,r:4}].map(({c,r}) => {
                const active = layout.cols === c && layout.rows === r;
                return (
                  <button key={`${c}-${r}`} onClick={() => apply(c, r)}
                    style={{ background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`, color: active ? '#f59e0b' : '#fff', fontSize: '9px', fontWeight: 600, padding: '4px 2px', cursor: 'pointer', borderRadius: 0 }}>
                    {c}×{r}
                  </button>
                );
              })}
            </div>

            {/* Hover grid */}
            <div style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between' }}>
              <span>Chọn ô lưới</span>
              <span style={{ color: '#f59e0b' }}>{previewLayout.cols}×{previewLayout.rows} ({previewLayout.cols * previewLayout.rows} ô)</span>
            </div>
            <div
              onMouseLeave={() => setHoverGrid(null)}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 2, background: 'rgba(0,0,0,0.2)', padding: 4, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 12 }}
            >
              {Array.from({ length: 10 }).map((_, r) =>
                Array.from({ length: 10 }).map((_, c) => {
                  const lit = hoverGrid
                    ? (r < hoverGrid.rows && c < hoverGrid.cols)
                    : (r < layout.rows && c < layout.cols);
                  return (
                    <div
                      key={`${r}-${c}`}
                      onMouseEnter={() => setHoverGrid({ rows: r + 1, cols: c + 1 })}
                      onClick={() => apply(c + 1, r + 1)}
                      style={{ width: 16, height: 16, background: lit ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.04)', border: `1px solid ${lit ? 'rgba(245,158,11,0.8)' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer', transition: 'all 0.08s' }}
                    />
                  );
                })
              )}
            </div>

            {/* Custom number input */}
            <div style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nhập tùy chỉnh</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="ms-wall-number-input"
                type="number" min={1} max={20} value={customCols}
                onChange={e => setCustomCols(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyCustom()}
                placeholder="Cột"
                style={{ width: 52, height: 26, padding: '0 6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 0, color: '#fff', fontSize: '11px', fontWeight: 700, outline: 'none', textAlign: 'center' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>×</span>
              <input
                className="ms-wall-number-input"
                type="number" min={1} max={20} value={customRows}
                onChange={e => setCustomRows(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyCustom()}
                placeholder="Hàng"
                style={{ width: 52, height: 26, padding: '0 6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 0, color: '#fff', fontSize: '11px', fontWeight: 700, outline: 'none', textAlign: 'center' }}
              />
              <button
                onClick={applyCustom}
                style={{ flex: 1, height: 26, background: '#f59e0b', border: 'none', borderRadius: 0, color: '#000', fontSize: '10px', fontWeight: 900, cursor: 'pointer' }}
              >
                ÁP DỤNG
              </button>
            </div>
            <style>{`
              .ms-wall-number-input {
                appearance: textfield;
                -moz-appearance: textfield;
              }
              .ms-wall-number-input::-webkit-outer-spin-button,
              .ms-wall-number-input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
              }
            `}</style>

          </div>
        </>
      )}
    </div>
  );
}
