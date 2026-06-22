// ============================================================
// ReportsPage.tsx — Báo cáo dữ liệu
// Tab "Xuất XLSX": chọn cảm biến + khoảng thời gian → xem trước + xuất file
// Tab "Báo cáo": tạo báo cáo định kỳ (daily/monthly/event), tải về PDF
// ============================================================

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ToolbarSelect from '@/components/ui/ToolbarSelect';
import { stationApi, AlertItem, Province, Team } from '@/services/StationApiService';
import { useStationStore } from '@/store';
import { TabId } from './types';
import ExportTab from './tabs/ExportTab';
import ReportTab from './tabs/ReportTab';

interface ReportsPageProps {
  embeddedMode?: 'default' | 'central';
  initialStationId?: string;
}

export default function ReportsPage({ embeddedMode = 'default', initialStationId = '' }: ReportsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Tránh xung đột param 'tab' với MultisitePage khi ở chế độ nhúng
  const tabKey = embeddedMode === 'central' ? 'subtab' : 'tab';
  const activeTab = (searchParams.get(tabKey) as TabId) || 'export';

  const setActiveTab = (tab: TabId) => {
    setSearchParams(prev => {
      prev.set(tabKey, tab);
      return prev;
    }, { replace: true });
  };

  const [stationId, setStationId] = useState(initialStationId);
  const [reportScopeType, setReportScopeType] = useState<'fleet' | 'province' | 'team' | 'station'>('fleet');
  const [reportScopeId, setReportScopeId] = useState('');
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const stations = useStationStore(s => s.stations);
  const fetchStations = useStationStore(s => s.fetch);

  useEffect(() => {
    fetchStations().then(() => {
      // Nếu có initialStationId thì giữ nguyên, không thì mặc định ''
      if (initialStationId && !stationId) {
        setStationId(initialStationId);
      }
    }).catch(() => {});
    stationApi.getAlerts(undefined, undefined, undefined, 500).then(setAlerts).catch(() => {});
    stationApi.getProvinces().then(setProvinces).catch(() => {});
    stationApi.getTeams().then(setTeams).catch(() => {});
  }, [fetchStations, initialStationId]);

  useEffect(() => {
    setReportScopeId('');
  }, [reportScopeType]);

  const reportScopeOptions = [
    { value: 'fleet', label: 'Toàn hệ thống' },
    { value: 'province', label: 'Theo tỉnh' },
    { value: 'team', label: 'Theo tổ' },
    { value: 'station', label: 'Theo trạm' },
  ];

  const reportEntityOptions = reportScopeType === 'province'
    ? provinces.map(p => ({ value: p.id, label: p.name }))
    : reportScopeType === 'team'
      ? teams.map(t => ({ value: t.id, label: t.name }))
      : reportScopeType === 'station'
        ? stations.map(s => ({ value: s.id, label: s.name }))
        : [{ value: '', label: 'Toàn hệ thống' }];

  const selectedReportStationIds = reportScopeType === 'fleet'
    ? stations.map(s => s.id)
    : reportScopeType === 'province'
      ? stations.filter(s => s.provinceId === reportScopeId).map(s => s.id)
      : reportScopeType === 'team'
        ? (teams.find(t => t.id === reportScopeId)?.stationIds || [])
        : reportScopeId
          ? [reportScopeId]
          : [];

  const selectedReportScopeLabel = reportScopeType === 'fleet'
    ? `Toàn hệ thống (${stations.length} trạm)`
    : reportEntityOptions.find(option => option.value === reportScopeId)?.label || '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--admin-bg)', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: embeddedMode === 'central' ? '10px 14px 0 14px' : '20px 20px 0 20px' }}>
        <div className="admin-card" style={{ padding: '8px 16px', background: 'var(--admin-panel)', borderBottom: 'none', borderRadius: '3px 3px 0 0' }}>
          <div className="page-toolbar-row" style={{ margin: 0, padding: 0, borderBottom: 'none', height: 'auto', minHeight: 36, background: 'transparent' }}>
            {embeddedMode !== 'central' && (
              <div className="page-title-cell" style={{ border: 'none', background: 'transparent', padding: '0 10px 0 0' }}>
                <h2 style={{ fontSize: '0.9rem' }}>BÁO CÁO</h2>
              </div>
            )}
            <div className="page-toolbar-group" style={{ gap: 10 }}>
              {activeTab === 'export' ? (
                <div className="page-toolbar-cell" style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="page-cell-label" style={{ fontSize: '0.6rem', fontWeight: 800 }}>TRẠM:</span>
                  <ToolbarSelect
                    value={stationId}
                    onChange={setStationId}
                    options={[{ value: '', label: 'Tất cả các trạm' }, ...stations.map(s => ({ value: s.id, label: s.name }))]}
                    width={180}
                  />
                </div>
              ) : (
                <>
                  <div className="page-toolbar-cell" style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="page-cell-label" style={{ fontSize: '0.6rem', fontWeight: 800 }}>PHẠM VI:</span>
                    <ToolbarSelect
                      value={reportScopeType}
                      onChange={value => setReportScopeType(value as 'fleet' | 'province' | 'team' | 'station')}
                      options={reportScopeOptions}
                      width={150}
                    />
                  </div>
                  {reportScopeType !== 'fleet' && (
                    <div className="page-toolbar-cell" style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="page-cell-label" style={{ fontSize: '0.6rem', fontWeight: 800 }}>
                        {reportScopeType === 'province' ? 'TỈNH:' : reportScopeType === 'team' ? 'TỔ:' : 'TRẠM:'}
                      </span>
                      <ToolbarSelect
                        value={reportScopeId}
                        onChange={setReportScopeId}
                        options={[{ value: '', label: '-- Chọn --' }, ...reportEntityOptions]}
                        width={190}
                      />
                    </div>
                  )}
                </>
              )}
              <div style={{ width: 1, height: 16, background: 'var(--admin-border)', margin: '0 4px' }} />
              <button 
                onClick={() => setActiveTab('export')} 
                className="btn-industrial" 
                style={{ 
                  height: 26, padding: '0 12px', fontSize: '0.65rem', fontWeight: 800,
                  background: activeTab === 'export' ? 'var(--admin-accent)' : 'var(--admin-layer-2)',
                  color: activeTab === 'export' ? '#fff' : 'var(--admin-text)',
                  borderColor: activeTab === 'export' ? 'var(--admin-accent)' : 'var(--admin-border)'
                }}
              >
                XUẤT DỮ LIỆU
              </button>
              <button 
                onClick={() => setActiveTab('report')} 
                className="btn-industrial" 
                style={{ 
                  height: 26, padding: '0 12px', fontSize: '0.65rem', fontWeight: 800,
                  background: activeTab === 'report' ? 'var(--admin-accent)' : 'var(--admin-layer-2)',
                  color: activeTab === 'report' ? '#fff' : 'var(--admin-text)',
                  borderColor: activeTab === 'report' ? 'var(--admin-accent)' : 'var(--admin-border)'
                }}
              >
                BÁO CÁO PHÂN TÍCH
              </button>
            </div>
          </div>
        </div>
      </div>
 
      {/* CONTENT */}
      <div style={{ padding: embeddedMode === 'central' ? '0 14px 10px 14px' : '0 20px 20px 20px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="admin-card" style={{ padding: 12, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', borderRadius: '0 0 3px 3px', borderTop: '1px solid var(--admin-border)' }}>
          {activeTab === 'export' && <ExportTab stationId={stationId} alerts={alerts} />}
          {activeTab === 'report' && (
            <ReportTab
              stationId={stationId}
              scopeType={reportScopeType}
              scopeId={reportScopeId}
              scopeLabel={selectedReportScopeLabel}
              stationIds={selectedReportStationIds}
            />
          )}
        </div>
      </div>
    </div>
  );
}
