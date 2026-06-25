import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateFilterButtonProps {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  inputType?: 'date' | 'datetime-local';
  showAll?: boolean;
  style?: React.CSSProperties;
}

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS = [
  'Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6',
  'Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12',
];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function datePart(s: string): string {
  return s ? (s.split('T')[0] ?? '') : '';
}

function formatLabel(from: string, to: string, inputType: 'date' | 'datetime-local'): string {
  if (!from && !to) return 'Tất cả';
  const fmt = (s: string) => {
    const dp = datePart(s);
    if (!dp) return '';
    const [y, m, d] = dp.split('-');
    if (inputType === 'datetime-local') {
      const tp = s.includes('T') ? s.split('T')[1] : '';
      return `${d}/${m} ${tp}`.trim();
    }
    return `${d}/${m}/${y}`;
  };
  const fd = datePart(from), td = datePart(to);
  if (fd === td && fd) return `Ngày ${fmt(from)}`;
  if (!fd) return `Đến ${fmt(to)}`;
  if (!td) return `Từ ${fmt(from)}`;
  return `${fmt(from)} → ${fmt(to)}`;
}

function deriveMode(from: string, to: string, showAll: boolean): 'all' | 'single' | 'range' {
  if (showAll && !from && !to) return 'all';
  if (datePart(from) === datePart(to) && from) return 'single';
  return 'range';
}

// ─── Mini Calendar ────────────────────────────────────────────────
function MiniCalendar({
  mode,
  tempFrom, setTempFrom,
  tempTo, setTempTo,
  inputType,
}: {
  mode: 'single' | 'range';
  tempFrom: string; setTempFrom: (v: string) => void;
  tempTo: string;   setTempTo: (v: string) => void;
  inputType: 'date' | 'datetime-local';
}) {
  const todayStr = isoDate(new Date());
  const initDate = datePart(tempFrom) || todayStr;
  const [vy, setVy] = useState(() => parseInt(initDate.split('-')[0] ?? '2026'));
  const [vm, setVm] = useState(() => parseInt(initDate.split('-')[1] ?? '1') - 1);
  const [hover, setHover] = useState('');
  const [step, setStep] = useState<'from'|'to'>('from');

  const prevMonth = () => vm === 0 ? (setVm(11), setVy(y => y-1)) : setVm(m => m-1);
  const nextMonth = () => vm === 11 ? (setVm(0), setVy(y => y+1)) : setVm(m => m+1);

  const daysInMonth = new Date(vy, vm+1, 0).getDate();
  const firstDow = (new Date(vy, vm, 1).getDay() + 6) % 7; // Mon=0

  const fromD = datePart(tempFrom);
  const toD   = datePart(tempTo);

  const isSelected = (d: string) => d === fromD || d === toD;

  const isInRange = (d: string) => {
    if (mode !== 'range') return false;
    const lo = fromD;
    const hi = toD || (step === 'to' && hover ? hover : '');
    if (!lo || !hi) return false;
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    return d > a && d < b;
  };

  const isRangeEnd = (d: string) => {
    if (mode !== 'range') return false;
    const hi = toD || (step === 'to' && hover ? hover : '');
    return !!hi && d === hi;
  };

  const handleClick = (d: string) => {
    if (mode === 'single') {
      const time = tempFrom.includes('T') ? tempFrom.split('T')[1] : '00:00';
      setTempFrom(inputType === 'datetime-local' ? `${d}T${time}` : d);
      return;
    }
    if (step === 'from') {
      setTempFrom(d); setTempTo(''); setStep('to');
    } else {
      if (d < fromD) { setTempFrom(d); setTempTo(fromD); }
      else            { setTempTo(d); }
      setStep('from');
    }
  };

  // Build cell grid: blanks + days
  const cells: (number|null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({length: daysInMonth}, (_, i) => i+1),
  ];

  const cellDs = (day: number|null): string => {
    if (!day) return '';
    return `${vy}-${String(vm+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  };

  const C = {
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 8,
    } as React.CSSProperties,
    navBtn: {
      width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid var(--admin-border)', background: 'var(--admin-layer-2)',
      color: 'var(--admin-text)', cursor: 'pointer', borderRadius: 0, flexShrink: 0,
    } as React.CSSProperties,
    title: {
      fontSize: '.65rem', fontWeight: 800, color: 'var(--admin-text)', letterSpacing: '.06em',
    } as React.CSSProperties,
    grid: {
      display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2,
    } as React.CSSProperties,
    dayLabel: {
      textAlign: 'center' as const, fontSize: '.5rem', fontWeight: 700,
      color: 'var(--admin-text-muted)', padding: '3px 0',
    } as React.CSSProperties,
  };

  return (
    <div>
      {/* Month navigation */}
      <div style={C.header}>
        <button style={C.navBtn} onClick={prevMonth}><ChevronLeft size={12}/></button>
        <span style={C.title}>{MONTHS[vm]} {vy}</span>
        <button style={C.navBtn} onClick={nextMonth}><ChevronRight size={12}/></button>
      </div>

      {/* Day-of-week labels */}
      <div style={C.grid}>
        {DAYS.map(d => <div key={d} style={C.dayLabel}>{d}</div>)}
      </div>

      {/* Day cells */}
      <div style={C.grid}>
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const ds = cellDs(day);
          const sel = isSelected(ds);
          const inRange = isInRange(ds);
          const end = isRangeEnd(ds);
          const isToday = ds === todayStr;

          let bg = 'transparent';
          let color = 'var(--admin-text)';
          let border = '1px solid transparent';

          if (sel) {
            bg = 'var(--admin-accent)';
            color = '#fff';
            border = '1px solid var(--admin-accent)';
          } else if (end) {
            bg = 'var(--admin-accent)';
            color = '#fff';
            border = '1px solid var(--admin-accent)';
          } else if (inRange) {
            bg = 'rgba(37,99,235,0.18)';
            color = 'var(--admin-accent)';
            border = '1px solid transparent';
          } else if (isToday) {
            border = '1px solid var(--admin-accent)';
            color = 'var(--admin-accent)';
          }

          return (
            <button
              key={ds}
              onClick={() => handleClick(ds)}
              onMouseEnter={() => setHover(ds)}
              onMouseLeave={() => setHover('')}
              style={{
                height: 26, border, background: bg, color,
                fontSize: '.6rem', fontWeight: 700, cursor: 'pointer',
                borderRadius: 0, display: 'flex', alignItems: 'center',
                justifyContent: 'center', transition: 'background .1s',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Time inputs for datetime-local */}
      {inputType === 'datetime-local' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: '.5rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.08em' }}>
              {mode === 'range' ? 'GIỜ BẮT ĐẦU' : 'GIỜ'}
            </span>
            <input
              type="time"
              value={tempFrom.includes('T') ? tempFrom.split('T')[1] : '00:00'}
              onChange={e => setTempFrom(datePart(tempFrom) ? `${datePart(tempFrom)}T${e.target.value}` : tempFrom)}
              style={{
                height: 26, padding: '0 6px', border: '1px solid var(--admin-border)',
                background: 'var(--admin-layer-2)', color: 'var(--admin-text)',
                fontSize: '.62rem', outline: 'none', borderRadius: 0, width: '100%',
                boxSizing: 'border-box', fontFamily: 'var(--admin-font-mono)',
              }}
            />
          </div>
          {mode === 'range' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '.5rem', fontWeight: 900, color: 'var(--admin-text-muted)', letterSpacing: '.08em' }}>GIỜ KẾT THÚC</span>
              <input
                type="time"
                value={tempTo.includes('T') ? tempTo.split('T')[1] : '23:59'}
                onChange={e => setTempTo(datePart(tempTo) ? `${datePart(tempTo)}T${e.target.value}` : tempTo)}
                style={{
                  height: 26, padding: '0 6px', border: '1px solid var(--admin-border)',
                  background: 'var(--admin-layer-2)', color: 'var(--admin-text)',
                  fontSize: '.62rem', outline: 'none', borderRadius: 0, width: '100%',
                  boxSizing: 'border-box', fontFamily: 'var(--admin-font-mono)',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Range step hint */}
      {mode === 'range' && (
        <div style={{ fontSize: '.55rem', color: 'var(--admin-text-muted)', marginTop: 6, fontStyle: 'italic', letterSpacing: '.04em' }}>
          {step === 'from' ? (fromD && toD ? `${fromD} → ${toD}` : 'Bấm chọn ngày bắt đầu') : `Từ: ${fromD} — bấm chọn ngày kết thúc`}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────
export default function DateFilterButton({
  from, to, onApply,
  inputType = 'date',
  showAll = false,
  style,
}: DateFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [mode, setMode] = useState<'all'|'single'|'range'>(() => deriveMode(from, to, showAll));
  const [tempFrom, setTempFrom] = useState(from);
  const [tempTo, setTempTo]   = useState(to);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(deriveMode(from, to, showAll));
    setTempFrom(from);
    setTempTo(to);
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  const handleApply = () => {
    if (mode === 'all')    onApply('', '');
    else if (mode === 'single') onApply(tempFrom, tempFrom);
    else                   onApply(tempFrom, tempTo);
    setApplied(true);
    setOpen(false);
  };

  const showLabel = applied || (showAll && !from && !to);
  const label = showLabel ? formatLabel(from, to, inputType) : 'Chọn ngày';
  const hasFilter = applied && !!(from || to);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, height: 26,
    border: `1px solid ${active ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
    background: active ? 'rgba(37,99,235,0.18)' : 'var(--admin-layer-2)',
    color: active ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
    fontSize: '.58rem', fontWeight: 700, cursor: 'pointer', borderRadius: 0,
    letterSpacing: '.04em',
  });

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          height: 26, padding: '0 10px',
          border: `1px solid ${hasFilter ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
          background: hasFilter ? 'rgba(37,99,235,0.12)' : 'var(--admin-layer-2)',
          color: hasFilter ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
          fontSize: '.62rem', fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          borderRadius: 0, whiteSpace: 'nowrap', letterSpacing: '.04em',
          ...style,
        }}
      >
        <Calendar size={11} />
        {label}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          width: 220,
          background: 'var(--admin-bg)',
          border: '1px solid var(--admin-border)',
          boxShadow: '0 12px 32px rgba(0,0,0,.6)',
          padding: 10, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 3 }}>
            {showAll && (
              <button style={tabStyle(mode === 'all')} onClick={() => setMode('all')}>Tất cả</button>
            )}
            <button style={tabStyle(mode === 'single')} onClick={() => setMode('single')}>Ngày cố định</button>
            <button style={tabStyle(mode === 'range')}  onClick={() => setMode('range')}>Khoảng TG</button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--admin-border)', margin: '0 -10px' }} />

          {/* Calendar or "all" message */}
          {mode === 'all' ? (
            <div style={{ fontSize: '.62rem', color: 'var(--admin-text-muted)', padding: '6px 0', fontStyle: 'italic', textAlign: 'center' }}>
              Hiển thị toàn bộ lịch sử
            </div>
          ) : (
            <MiniCalendar
              mode={mode as 'single'|'range'}
              tempFrom={tempFrom} setTempFrom={setTempFrom}
              tempTo={tempTo}     setTempTo={setTempTo}
              inputType={inputType}
            />
          )}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--admin-border)', margin: '0 -10px' }} />

          {/* Apply */}
          <button
            onClick={handleApply}
            style={{
              height: 28, border: 'none',
              background: 'var(--admin-accent)', color: '#fff',
              fontSize: '.65rem', fontWeight: 800, cursor: 'pointer',
              borderRadius: 0, letterSpacing: '.06em',
            }}
          >
            ÁP DỤNG
          </button>
        </div>
      )}
    </div>
  );
}
