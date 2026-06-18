import type { User } from '@/types/api.types';

export const MULTISITE_DRILL_STATION_KEY = 'multisite_drill_station';
export const MULTISITE_RETURN_TAB_KEY = 'multisite_return_tab';

export function isCentralUser(user?: User | null): boolean {
  if (!user) return false;
  return (
    user.username === 'multi' ||
    (user.role === 'admin' && (!user.station_ids || user.station_ids.length === 0)) ||
    user.role === 'admin_province' ||
    user.role === 'operator_province'
  );
}

export function isCentralDrillDown(user?: User | null): boolean {
  if (!isCentralUser(user) || typeof window === 'undefined') return false;
  return !!window.localStorage.getItem(MULTISITE_DRILL_STATION_KEY);
}
