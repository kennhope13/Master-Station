import { useEffect, useRef } from 'react';
import { createRealtimeHub } from '@/services/realtime.service';
import { HubConnection } from '@microsoft/signalr';

interface RealtimeHandlers {
  onSensorUpdate?: (data: any[]) => void;
  onAlertNew?: (data: any) => void;
  onAlertUpdated?: (data: any) => void;
  onUserStatusChange?: (data: { username: string; status: string; ts: string }) => void;
  onStationListChanged?: (data: { action: string; stationId: string }) => void;
  onDeviceListChanged?: (data: { action: string; stationId: string; deviceId: string }) => void;
}

/** Hook quản lý vòng đời kết nối SignalR WebSocket: tự động connect khi mount, cleanup khi unmount. */
export function useRealtime(handlers: RealtimeHandlers, dependencies: any[] = []) {
  const hubRef = useRef<HubConnection | null>(null);

  useEffect(() => {
    const hub = createRealtimeHub();
    hubRef.current = hub;

    if (handlers.onSensorUpdate) {
      hub.on('SensorUpdate', handlers.onSensorUpdate);
    }
    if (handlers.onAlertNew) {
      hub.on('AlertNew', handlers.onAlertNew);
    }
    if (handlers.onAlertUpdated) {
      hub.on('AlertUpdated', handlers.onAlertUpdated);
    }
    if (handlers.onUserStatusChange) {
      hub.on('UserStatusChange', handlers.onUserStatusChange);
    }
    if (handlers.onStationListChanged) {
      hub.on('StationListChanged', handlers.onStationListChanged);
    }
    if (handlers.onDeviceListChanged) {
      hub.on('DeviceListChanged', handlers.onDeviceListChanged);
    }

    let isMounted = true;
    const startHub = async () => {
      try {
        await hub.start();
      } catch (err) {
        console.warn('[useRealtime] SignalR Connection failed, retrying in 5s...', err);
        if (isMounted) {
          setTimeout(startHub, 5000);
        }
      }
    };
    startHub();

    return () => {
      isMounted = false;
      hub.stop();
      hubRef.current = null;
    };
  }, dependencies);

  return hubRef.current;
}
