import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@/types/api.types';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setSession: (user: User, token: string, refreshToken?: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      setSession: (user, token, refreshToken) => set({ 
        user, 
        token, 
        refreshToken: refreshToken || null, 
        isAuthenticated: true 
      }),
      clearSession: () => set({ user: null, token: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'station_auth_storage',
      // Giữ phiên qua các lần đóng/mở Electron. Chỉ clearSession/logout mới xóa
      // phiên đã persist (hoặc backend từ chối refresh token không còn hợp lệ).
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Một số màn hình cũ vẫn đọc station_token trực tiếp từ sessionStorage.
        // Mirror lại sau khi khôi phục để chúng hoạt động ngay khi mở ứng dụng.
        if (state?.token) {
          sessionStorage.setItem('station_token', state.token);
        } else {
          sessionStorage.removeItem('station_token');
        }
      },
    }
  )
);
