import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Video, RefreshCw, Wifi, WifiOff, AlertTriangle, Maximize2, Minimize2, Square, ChevronLeft, ChevronRight, Grid, ChevronDown
} from 'lucide-react';
import { authService } from '@/services/AuthService';
import { stationApi } from '@/services/StationApiService';
import type { CameraDevice, Station } from '@/types/api.types';
import { GO2RTC_URL } from '@/utils/env';

function expandCameras(cams: CameraDevice[]): CameraDevice[] {
  const out: CameraDevice[] = [];
  cams.forEach(c => {
    const cfg = (c as any).config || {};
    if (c.type === 'camera_dual') {
      out.push({ ...c, id: `${c.id}_optical`, name: `${c.name} (Quang học)`, config: { ...cfg, go2rtc_id: cfg.go2rtc_optical || cfg.go2rtc_id } } as any);
      out.push({ ...c, id: `${c.id}_thermal`, name: `${c.name} (Nhiệt)`, config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id } } as any);
    } else {
      out.push({ ...c, config: cfg } as any);
    }
  });
  return out;
}

export default function LiveCameraPopup() {
  const [params] = useSearchParams();
  const stationId = params.get('stationId') ?? '';

  const [authReady, setAuthReady] = useState(() => !!authService.getToken());
  const [station, setStation] = useState<Station | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [go2rtcBase, setGo2rtcBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<{ cols: number; rows: number }>({ cols: 2, rows: 2 });
  const [prevLayout, setPrevLayout] = useState<{ cols: number; rows: number }>({ cols: 2, rows: 2 });

  const changeLayout = (newLayout: { cols: number; rows: number }) => {
    setLayout(newLayout);
    if (newLayout.cols !== 1 || newLayout.rows !== 1) {
      setPrevLayout(newLayout);
    }
  };
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoverGrid, setHoverGrid] = useState<{ cols: number; rows: number } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedCellIndex, setSelectedCellIndex] = useState<number>(0);
  const [cellCameras, setCellCameras] = useState<Record<number, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const maxCams = layout.cols * layout.rows;
  useEffect(() => {
    if (selectedCellIndex >= maxCams) {
      setSelectedCellIndex(0);
    }
  }, [layout, selectedCellIndex, maxCams]);

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
      selectedCamFilter: '' // Popup does not have separate camera filters
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

  // Set window title and ensure auth
  useEffect(() => {
    document.title = 'Trực tiếp — Trạm Tổng';
    if (!authService.getToken()) {
      authService.login('multi', 'Demo@2024')
        .then(() => setAuthReady(true))
        .catch(() => setAuthReady(true));
    }
  }, []);

  // Load station info
  useEffect(() => {
    if (!authReady || !stationId) return;
    stationApi.getStations()
      .then(list => setStation(list.find(s => s.id === stationId) ?? null))
      .catch(() => {});
  }, [authReady, stationId]);

  // Update title with station name
  useEffect(() => {
    if (station) document.title = `${station.name || station.code} — Trực tiếp`;
  }, [station]);

  // Load cameras
  useEffect(() => {
    if (!authReady || !stationId) return;
    setLoading(true);
    setCameras([]);
    setExpandedId(null);
    setCellCameras({});
    setSelectedCellIndex(0);
    stationApi.getRemoteCameras(stationId)
      .then(result => {
        setGo2rtcBase(result.go2rtcBase ?? null);
        const getStreamId = (url?: string) => {
          if (!url) return null;
          try { return new URL(url).searchParams.get('src'); } catch { return null; }
        };
        const enriched = result.cameras.map(c => {
          const urls = (c.streamUrls || {}) as Record<string, string>;
          const dev = c.device as any;
          
          let existingCfg = {};
          if (dev.config) {
            try {
              existingCfg = typeof dev.config === 'string' ? JSON.parse(dev.config) : dev.config;
            } catch (e) {
              console.error('Error parsing camera config:', e);
            }
          }

          return {
            ...dev,
            config: {
              ...existingCfg,
              go2rtc_id:      (existingCfg as any).go2rtc_id      || getStreamId(urls.main_webrtc),
              go2rtc_optical: (existingCfg as any).go2rtc_optical || getStreamId(urls.optical_webrtc),
              go2rtc_thermal: (existingCfg as any).go2rtc_thermal || getStreamId(urls.thermal_webrtc),
            },
          };
        });
        setCameras(expandCameras(enriched));
      })
      .catch(() => { setCameras([]); setGo2rtcBase(null); })
      .finally(() => setLoading(false));
  }, [authReady, stationId, refreshKey]);

  const isOffline = station?.connectionStatus !== 'online';
  const cols = layout.cols;
  const gridCams = useMemo(() => {
    if (expandedId) {
      const cam = cameras.find(c => c.id === expandedId);
      return cam ? [cam] : [];
    }
    const list: (CameraDevice | undefined)[] = [];
    for (let i = 0; i < maxCams; i++) {
      const assignedId = cellCameras[i];
      if (assignedId) {
        list.push(cameras.find(c => c.id === assignedId));
      } else {
        list.push(cameras[i]);
      }
    }
    return list;
  }, [cameras, expandedId, maxCams, cellCameras]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#070c14',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      color: '#e2e8f0'
    }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0, height: 38,
        background: 'rgba(15,23,42,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 10
      }}>
        {/* Status dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: isOffline ? '#6b7280' : '#10b981',
          boxShadow: isOffline ? 'none' : '0 0 6px #10b981'
        }} />

        {/* Station name */}
        <span style={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.05em', whiteSpace: 'nowrap', flex: 1 }}>
          {station ? (station.code ? `[${station.code}] ${station.name}` : station.name) : stationId}
        </span>

        {/* Connection label */}
        <span style={{
          fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em',
          color: isOffline ? '#6b7280' : '#10b981'
        }}>
          {isOffline ? 'OFFLINE' : 'ONLINE'}
        </span>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Camera count */}
        <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
          {loading ? '…' : `${cameras.length} camera`}
        </span>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Grid Layout Selector Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 8px',
              background: dropdownOpen ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 0,
              outline: 'none',
            }}
          >
            <Grid size={12} style={{ color: '#f59e0b' }} />
            <span>Bố cục: {layout.cols} × {layout.rows}</span>
            <ChevronDown size={10} style={{ opacity: 0.6 }} />
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
                  background: '#0f172a',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  padding: 10,
                  zIndex: 999,
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                  borderRadius: 0,
                  width: 'max-content',
                }}
              >
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Chọn bố cục nhanh
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 10 }}>
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
                        changeLayout(preset);
                        setExpandedId(null);
                        setDropdownOpen(false);
                      }}
                      style={{
                        background: (layout.cols === preset.cols && layout.rows === preset.rows) ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        border: (layout.cols === preset.cols && layout.rows === preset.rows) ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                        color: (layout.cols === preset.cols && layout.rows === preset.rows) ? '#f59e0b' : '#fff',
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '3px 2px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        borderRadius: 0,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Lưới tự chọn
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b' }}>
                      {hoverGrid ? `${hoverGrid.cols} × ${hoverGrid.rows} (${hoverGrid.cols * hoverGrid.rows} ô)` : `${layout.cols} × ${layout.rows} (${layout.cols * layout.rows} ô)`}
                    </span>
                  </div>

                  <div 
                    onMouseLeave={() => setHoverGrid(null)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(10, 16px)',
                      gap: 2,
                      background: 'rgba(0, 0, 0, 0.2)',
                      padding: 4,
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
                              changeLayout({ cols: c + 1, rows: r + 1 });
                              setExpandedId(null);
                              setDropdownOpen(false);
                              setHoverGrid(null);
                            }}
                            style={{
                              width: 16,
                              height: 16,
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

                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 8, marginTop: 8 }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Lưu bố cục hiện tại
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
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
                        fontSize: '10px',
                        padding: '3px 6px',
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
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        cursor: 'pointer',
                        borderRadius: 0,
                      }}
                    >
                      Lưu
                    </button>
                  </div>

                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Bố cục đã lưu
                  </div>
                  {savedLayouts.length === 0 ? (
                    <div style={{ fontSize: '9px', color: 'rgba(255, 255, 255, 0.3)', fontStyle: 'italic', padding: '2px 0' }}>
                      Chưa có bố cục nào được lưu
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
                      {savedLayouts.map((l) => (
                        <div
                          key={l.id}
                          onClick={() => {
                            changeLayout({ cols: l.cols, rows: l.rows });
                            setExpandedId(null);
                            setDropdownOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '3px 5px',
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
                          <span style={{ fontSize: '10px', color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                            {l.name} ({l.cols}x{l.rows})
                          </span>
                          <button
                            onClick={(e) => handleDeleteLayout(l.id, e)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'rgba(255, 255, 255, 0.4)',
                              cursor: 'pointer',
                              fontSize: '10px',
                              padding: '0 3px',
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

        {/* Refresh */}
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          title="Tải lại stream"
          style={{
            width: 24, height: 24, padding: 0,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Main Area with Sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Camera Sidebar */}
        {!loading && cameras.length > 0 && (
          <div style={{
            width: 200,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(15,23,42,0.95)',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              fontSize: '0.62rem',
              fontWeight: 800,
              color: 'rgba(255,255,255,0.4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              letterSpacing: '0.05em'
            }}>
              <span>DANH SÁCH CAMERA</span>
              {expandedId && (
                <button
                  onClick={() => {
                    setExpandedId(null);
                    setCellCameras({});
                    setLayout(prevLayout);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f59e0b',
                    fontSize: '9px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    padding: 0
                  }}
                >
                  Hiện tất cả
                </button>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div
                onClick={() => {
                  setExpandedId(null);
                  setCellCameras({});
                  setLayout(prevLayout);
                }}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  background: !expandedId ? 'rgba(245,158,11,0.08)' : 'transparent',
                  borderLeft: !expandedId ? '3px solid #f59e0b' : '3px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'all 0.15s'
                }}
              >
                <Grid size={12} style={{ color: !expandedId ? '#f59e0b' : 'rgba(255,255,255,0.4)' }} />
                <span style={{
                  fontWeight: !expandedId ? 800 : 500,
                  fontSize: '0.68rem',
                  color: !expandedId ? '#fff' : 'rgba(255,255,255,0.4)'
                }}>Tất cả camera</span>
              </div>
              {cameras.map(c => {
                const currentCellCamId = cellCameras[selectedCellIndex] || cameras[selectedCellIndex]?.id;
                const active = currentCellCamId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setCellCameras(prev => ({
                        ...prev,
                        [selectedCellIndex]: c.id
                      }));
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      background: active ? 'rgba(245,158,11,0.08)' : 'transparent',
                      borderLeft: active ? '3px solid #f59e0b' : '3px solid transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'all 0.15s'
                    }}
                  >
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: '#10b981',
                      boxShadow: '0 0 4px #10b981'
                    }} />
                    <span style={{
                      fontWeight: active ? 800 : 500,
                      fontSize: '0.68rem',
                      color: active ? '#fff' : 'rgba(255,255,255,0.7)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1
                    }}>
                      {c.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Camera grid area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10,
              color: 'rgba(255,255,255,0.35)'
            }}>
              <RefreshCw size={20} style={{ animation: 'popup-spin 1s linear infinite' }} />
              <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Đang tải camera...</span>
              <style>{`@keyframes popup-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {!loading && cameras.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.25)'
            }}>
              {isOffline
                ? <WifiOff size={40} style={{ opacity: 0.4 }} />
                : <Video size={40} style={{ opacity: 0.4 }} />
              }
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {isOffline ? 'Trạm đang offline' : 'Trạm chưa có camera nào được cấu hình'}
              </span>
            </div>
          )}

          {!loading && cameras.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${expandedId ? 1 : cols}, 1fr)`,
              gridAutoRows: '1fr',
              gap: 2, height: '100%', padding: 2, boxSizing: 'border-box'
            }}>
              {gridCams.map((cam, i) => {
                const isSelected = selectedCellIndex === i;
                return (
                  <div
                    key={i}
                    onClick={() => !expandedId && setSelectedCellIndex(i)}
                    style={{
                      position: 'relative',
                      height: '100%',
                      minHeight: 0,
                      outline: (!expandedId && isSelected) ? '2px solid #f59e0b' : 'none',
                      outlineOffset: -2,
                      zIndex: (!expandedId && isSelected) ? 10 : 1,
                      cursor: !expandedId ? 'pointer' : 'default'
                    }}
                  >
                    {cam ? (
                      <CameraCell
                        camera={cam}
                        go2rtcBase={go2rtcBase ?? GO2RTC_URL}
                        isExpanded={expandedId === cam.id}
                        onExpand={() => setExpandedId(cam.id)}
                        onCollapse={() => setExpandedId(null)}
                      />
                    ) : (
                      <div style={{
                        height: '100%',
                        background: '#0d1117',
                        border: '1px dashed rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Video size={20} style={{ opacity: 0.1 }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CameraCell({ camera, go2rtcBase, isExpanded, onExpand, onCollapse }: {
  camera: CameraDevice;
  go2rtcBase: string;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cfg = (camera as any).config || {};
  const go2rtcId: string | undefined = cfg.go2rtc_id;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', background: '#080d15', border: '1px solid rgba(255,255,255,0.04)', overflow: 'hidden', minHeight: 0 }}
    >
      {go2rtcId ? (
        <iframe
          key={`${camera.id}-${go2rtcId}`}
          src={`/camera-stream.html?src=${encodeURIComponent(go2rtcId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(go2rtcBase)}`}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
          allow="autoplay"
          title={camera.name}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, color: 'rgba(255,255,255,0.2)'
        }}>
          <Video size={22} style={{ opacity: 0.35 }} />
          <span style={{ fontSize: '0.58rem' }}>Chưa cấu hình stream</span>
        </div>
      )}

      {/* Camera name — top gradient */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        background: 'linear-gradient(rgba(0,0,0,0.7), transparent)',
        padding: '7px 8px 18px',
        pointerEvents: 'none'
      }}>
        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)', letterSpacing: '0.04em' }}>
          {camera.name}
        </span>
      </div>

      {/* Bottom controls — hover */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        padding: '18px 8px 7px',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 5
      }}>
        <button
          onClick={isExpanded ? onCollapse : onExpand}
          style={{
            background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff', cursor: 'pointer',
            padding: '3px 8px', fontSize: '0.58rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 4
          }}
        >
          {isExpanded ? <><Minimize2 size={10} /> Thu lại</> : <><Maximize2 size={10} /> Phóng to</>}
        </button>
      </div>
    </div>
  );
}


