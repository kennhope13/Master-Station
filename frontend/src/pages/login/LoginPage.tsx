import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/AuthService';
import { isCentralUser } from '@/utils/centralAccess';
import './LoginPage.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authService.isAuthenticated()) {
      const u = authService.getUser();
      navigate(isCentralUser(u) ? '/multisite' : '/dashboard', { replace: true });
    } else {
      usernameRef.current?.focus();
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true); setErrorMsg(''); setIsShaking(false);
    await new Promise(r => setTimeout(r, 600));
    const result = await authService.login(username.trim(), password);
    setLoading(false);
    if (result.success) {
      navigate(isCentralUser(authService.getUser()) ? '/multisite' : '/dashboard');
    } else {
      setErrorMsg(result.error || 'Đăng nhập thất bại');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  return (
    <div className="gm-login-wrapper">
      <div className="gm-overlay" />
      <div className="gm-glass-panel">

        <div className="gm-central-badge">Central Hub</div>

        {/* Icon mạng lưới đa trạm */}
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none"
          xmlns="http://www.w3.org/2000/svg" className="gm-network-icon">
          <circle cx="28" cy="28" r="27" stroke="rgba(59,130,246,0.2)" strokeWidth="1"/>
          <circle cx="28" cy="28" r="5" fill="#3b82f6" opacity="0.9"/>
          <circle cx="28" cy="10" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="44" cy="20" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="44" cy="36" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="28" cy="46" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="12" cy="36" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.5"/>
          <circle cx="12" cy="20" r="3.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.5"/>
          <line x1="28" y1="23" x2="28" y2="13.5" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
          <line x1="32.5" y1="25" x2="40.5" y2="22" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
          <line x1="32.5" y1="31" x2="40.5" y2="34" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
          <line x1="28" y1="33" x2="28" y2="42.5" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
          <line x1="23.5" y1="31" x2="15.5" y2="34" stroke="rgba(59,130,246,0.18)" strokeWidth="1"/>
          <line x1="23.5" y1="25" x2="15.5" y2="22" stroke="rgba(59,130,246,0.18)" strokeWidth="1"/>
        </svg>

        <h2>TRUNG TÂM <span>GIÁM SÁT</span></h2>
        <p className="gm-subtitle">Đa Trạm</p>
        <p className="gm-slogan">Tập trung — Toàn mạng lưới — Thời gian thực</p>

        {errorMsg && (
          <div className={`gm-error ${isShaking ? 'shake' : ''}`}>{errorMsg}</div>
        )}

        <form onSubmit={handleLogin} autoComplete="off">
          <div className="gm-input-group">
            <label htmlFor="loginUsername">Tên đăng nhập</label>
            <input
              ref={usernameRef}
              type="text" id="loginUsername"
              placeholder="Ví dụ: multi"
              required value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="gm-input-group">
            <label htmlFor="loginPassword">Mật khẩu</label>
            <div className="gm-pw-wrap">
              <input
                type={showPassword ? 'text' : 'password'} id="loginPassword"
                placeholder="••••••••" required value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
              <button type="button" className="gm-eye-btn"
                onClick={() => setShowPassword(!showPassword)} disabled={loading}>
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="gm-btn-login" disabled={loading}>
            {loading ? <span>ĐANG XÁC THỰC...</span> : <span>ĐĂNG NHẬP HỆ THỐNG</span>}
          </button>
        </form>

        <p className="gm-footer">StationOS Central · Phiên bản đa trạm</p>
      </div>
    </div>
  );
}
