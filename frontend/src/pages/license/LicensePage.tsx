import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import { stationApi } from '@/services/StationApiService';
import './LicensePage.css';

interface LicenseStatus {
  activated: boolean;
  tier?: string;
  maxUsers?: number;
  maxStations?: number;
  maxCameras?: number;
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

const RESOURCE_LABELS: Record<string, { label: string; icon: string }> = {
  stations:    { label: 'Trạm biến áp',      icon: '🏭' },
  cameras:     { label: 'Camera',             icon: '📷' },
  roi_points:  { label: 'Điểm giám sát nhiệt', icon: '🌡️' },
  roi_regions: { label: 'Vùng nhiệt (ROI)',   icon: '🔥' },
  pd_regions:  { label: 'Vùng phóng điện (PD)', icon: '⚡' },
};

export default function LicensePage() {
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [limits, setLimits] = useState<ResourceLimit[]>([]);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const canManageLicense = authService.hasPermission('license:manage');

  const loadStatus = async () => {
    try {
      const data = await stationApi.getLicenseStatus();
      setStatus(data);
    } catch {
      setStatus({ activated: false });
    }
  };

  const loadLimits = async () => {
    try {
      const data = await stationApi.getLicenseLimits();
      setLimits(data);
    } catch {
      setLimits([]);
    }
  };

  useEffect(() => {
    loadStatus();
    loadLimits();
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setErrorMsg('Vui lòng nhập license key');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const data = await stationApi.activateLicense(key.trim());
      if (data?.message && !data?.activated) {
        setErrorMsg(data.message ?? 'Kích hoạt thất bại');
      } else {
        setSuccessMsg('Kích hoạt thành công! Đang tải lại...');
        setKey('');
        await loadStatus();
        await loadLimits();
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Không thể kết nối backend');
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
    if (!status) {
      return <div style={{ color: 'var(--admin-text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Đang tải trạng thái...</div>;
    }

    if (!status.activated) {
      return (
        <div className="status-box">
          <div className="status-row">
            <span>Trạng thái</span>
            <span className="status-badge demo">Chưa kích hoạt (Demo)</span>
          </div>
          <div className="status-row">
            <span>Giới hạn</span>
            <span style={{ color: '#ff8787', fontWeight: 'bold' }}>Mặc định 10 đơn vị/tài nguyên (Liên hệ dev để nâng cấp)</span>
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
    // Use limits from API if available, otherwise fall back to status fields
    const resourceData = limits.length > 0 ? limits : [
      { resource: 'stations',    current: 0, max: status?.maxStations   && status.maxStations >= 999   ? -1 : (status?.maxStations ?? 10),   exceeded: false },
      { resource: 'cameras',     current: 0, max: status?.maxCameras    && status.maxCameras >= 999    ? -1 : (status?.maxCameras ?? 10),    exceeded: false },
      { resource: 'roi_points',  current: 0, max: status?.maxRoiPoints  && status.maxRoiPoints >= 999  ? -1 : (status?.maxRoiPoints ?? 10),  exceeded: false },
      { resource: 'roi_regions', current: 0, max: status?.maxRoiRegions && status.maxRoiRegions >= 999 ? -1 : (status?.maxRoiRegions ?? 10), exceeded: false },
      { resource: 'pd_regions',  current: 0, max: status?.maxPdRegions  && status.maxPdRegions >= 999  ? -1 : (status?.maxPdRegions ?? 10),  exceeded: false },
    ];

    return (
      <div className="resource-limits-section">
        <h3>Giới hạn tài nguyên</h3>
        {!status?.activated && (
          <div className="demo-limit-warning" style={{ 
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
            <span>Hệ thống đang chạy ở chế độ Demo/Thử nghiệm. Giới hạn mặc định tối đa 10 đơn vị cho mỗi loại tài nguyên. Vui lòng liên hệ nhà phát triển (dev) để nâng cấp bản quyền.</span>
          </div>
        )}
        <div className="resource-grid">
          {resourceData.map((item) => {
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

  return (
    <div className="license-page">
      <div className="license-hero">
        <div className="license-card">
          <div className="license-header">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#44ff88" strokeWidth="1.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <h1>Quản lý License</h1>
            <p>Kích hoạt bản quyền phần mềm StationMonitor</p>
          </div>

          {renderStatusBox()}
          {renderResourceLimits()}

          {canManageLicense && (
            <div className="license-activate-section" id="activateSection">
              <h3>Kích hoạt License Key</h3>
              <p className="license-hint">
                Nhập license key do nhà cung cấp cấp. Hỗ trợ nhiều định dạng (4 đến 10 phần).
              </p>

              {errorMsg && <div className="license-error">️ {errorMsg}</div>}
              {successMsg && <div className="license-success">{successMsg}</div>}

              <form onSubmit={handleActivate} className="license-input-row">
                <input 
                  type="text" 
                  className="license-input"
                  placeholder="VD: TEAM-270101-A3F7-1B2C3D4E"
                  spellCheck="false" 
                  autoComplete="off"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  disabled={loading}
                />
                <button type="submit" className="btn-license-activate" disabled={loading}>
                  {loading ? 'Đang kích hoạt...' : 'Kích hoạt'}
                </button>
              </form>

              <div className="license-tiers">
                <div className="tier-card">
                  <span className="tier-badge solo">SOLO</span>
                  <span>1 user • 1 trạm</span>
                </div>
                <div className="tier-card">
                  <span className="tier-badge team">TEAM</span>
                  <span>5 users • 10 trạm</span>
                </div>
                <div className="tier-card">
                  <span className="tier-badge ent">ENTERPRISE</span>
                  <span>Không giới hạn</span>
                </div>
              </div>
            </div>
          )}

          <div className="license-actions">
            <button className="btn-license-skip" onClick={() => navigate(-1)}>
              Quay lại
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
