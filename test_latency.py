import time
import requests

BASE_URL = "http://127.0.0.1:6000/api/v1"

def test_endpoints():
    print("Logging in...")
    login_payload = {"username": "multi", "password": "Demo@2024"}
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json=login_payload, timeout=5)
        if r.status_code != 200:
            print("Login failed!")
            return
        token = r.json().get("token")
    except Exception as e:
        print("Login error:", e)
        return

    headers = {"Authorization": f"Bearer {token}"}

    try:
        r = requests.get(f"{BASE_URL}/stations", headers=headers, timeout=5)
        stations = r.json()
        print("\nBenchmarking Station Endpoints (Goal: <100ms for offline/bypass, fast failure/success otherwise):")
        print("-" * 100)
        print(f"{'Station Name':<35} | {'KPI Latency':<12} | {'Cameras Latency':<15} | {'Devices Latency':<15}")
        print("-" * 100)
        
        for s in stations:
            sid = s.get('id')
            name = s.get('name')
            
            # 1. Test remote-kpi
            start = time.time()
            try:
                r_kpi = requests.get(f"{BASE_URL}/stations/{sid}/remote-kpi", headers=headers, timeout=5)
                kpi_ms = f"{(time.time() - start) * 1000:.1f}ms"
            except requests.exceptions.Timeout:
                kpi_ms = "TIMEOUT"
            except Exception:
                kpi_ms = "ERROR"

            # 2. Test remote-cameras
            start = time.time()
            try:
                r_cam = requests.get(f"{BASE_URL}/stations/{sid}/remote-cameras", headers=headers, timeout=5)
                cam_ms = f"{(time.time() - start) * 1000:.1f}ms"
            except requests.exceptions.Timeout:
                cam_ms = "TIMEOUT"
            except Exception:
                cam_ms = "ERROR"

            # 3. Test devices
            start = time.time()
            try:
                r_dev = requests.get(f"{BASE_URL}/stations/{sid}/devices", headers=headers, timeout=5)
                dev_ms = f"{(time.time() - start) * 1000:.1f}ms"
            except requests.exceptions.Timeout:
                dev_ms = "TIMEOUT"
            except Exception:
                dev_ms = "ERROR"

            print(f"{name:<35} | {kpi_ms:<12} | {cam_ms:<15} | {dev_ms:<15}")
            
    except Exception as e:
        print("Failed during benchmark:", e)

if __name__ == "__main__":
    test_endpoints()
