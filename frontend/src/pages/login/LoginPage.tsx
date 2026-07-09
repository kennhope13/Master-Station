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
  const resolveNextPath = () => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (next && next.startsWith('/')) return next;
    return null;
  };

  useEffect(() => {
    if (authService.isAuthenticated()) {
      const u = authService.getUser();
      navigate(resolveNextPath() || (isCentralUser(u) ? '/multisite' : '/dashboard'), { replace: true });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token && authService.acceptExternalToken(token)) {
      navigate(resolveNextPath() || '/dashboard', { replace: true });
      return;
    }
    // Nếu có params tự động đăng nhập từ trạm trung tâm
    const embedUser = params.get('u');
    const embedPass = params.get('p');
    const nextPath = resolveNextPath();
    if (params.get('embed') === '1' && embedUser && embedPass) {
      authService.login(embedUser, embedPass).then(result => {
        if (result.success) {
          navigate(nextPath || '/dashboard', { replace: true });
        } else {
          usernameRef.current?.focus();
        }
      });
      return;
    }
    // Nếu đang chạy trong iframe không có params, thử admin mặc định
    if (window.self !== window.top) {
      authService.login('admin', 'Admin@123').then(result => {
        if (result.success) navigate(nextPath || '/dashboard', { replace: true });
        else usernameRef.current?.focus();
      });
      return;
    }
    usernameRef.current?.focus();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true); setErrorMsg(''); setIsShaking(false);
    await new Promise(r => setTimeout(r, 600));
    const result = await authService.login(username.trim(), password);
    setLoading(false);
    if (result.success) {
      navigate(resolveNextPath() || (isCentralUser(authService.getUser()) ? '/multisite' : '/dashboard'));
    } else {
      setErrorMsg(result.error || 'Đăng nhập thất bại');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-grid" />

      <div className={`login-card${isShaking ? ' shake' : ''}`}>
        {/* Góc bracket */}
        <span className="login-corner login-corner--tl" />
        <span className="login-corner login-corner--tr" />
        <span className="login-corner login-corner--bl" />
        <span className="login-corner login-corner--br" />

        {/* Badge */}
        <div className="login-badge">
          <span className="login-badge__dot" />
          CENTRAL HUB
        </div>

        {/* Icon mạng lưới đa trạm */}
        <svg className="login-net-icon" width="52" height="52" viewBox="0 0 56 56" fill="none">
          <circle cx="28" cy="28" r="27" stroke="currentColor" strokeWidth="0.5" opacity="0.15"/>
          <circle cx="28" cy="28" r="5" fill="currentColor" opacity="0.9"/>
          <circle cx="28" cy="10" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="44" cy="20" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7"/>
          <circle cx="44" cy="36" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
          <circle cx="28" cy="46" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
          <circle cx="12" cy="36" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45"/>
          <circle cx="12" cy="20" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45"/>
          <line x1="28" y1="23" x2="28" y2="13.5" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
          <line x1="32.5" y1="25" x2="40.5" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
          <line x1="32.5" y1="31" x2="40.5" y2="34" stroke="currentColor" strokeWidth="1" opacity="0.25"/>
          <line x1="28" y1="33" x2="28" y2="42.5" stroke="currentColor" strokeWidth="1" opacity="0.25"/>
          <line x1="23.5" y1="31" x2="15.5" y2="34" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
          <line x1="23.5" y1="25" x2="15.5" y2="22" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
        </svg>

        <h2 className="login-title">Master<span>Station</span></h2>
        <p className="login-slogan">Tập trung · Toàn mạng lưới · Thời gian thực</p>

        {errorMsg && <div className="login-error">{errorMsg}</div>}

        <form onSubmit={handleLogin} autoComplete="off">
          <div className="login-field">
            <label htmlFor="loginUsername">Tên đăng nhập</label>
            <input
              ref={usernameRef}
              type="text" id="loginUsername"
              placeholder="multi"
              required value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="login-field">
            <label htmlFor="loginPassword">Mật khẩu</label>
            <div className="login-pw-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                id="loginPassword"
                placeholder="••••••••"
                required value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
              <button type="button" className="login-eye"
                onClick={() => setShowPassword(!showPassword)} disabled={loading}>
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'ĐANG XÁC THỰC...' : 'ĐĂNG NHẬP HỆ THỐNG'}
          </button>
        </form>

        <p className="login-footer">StationOS Central</p>
      </div>
    </div>
  );
}
