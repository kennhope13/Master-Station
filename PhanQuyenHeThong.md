# BẢNG THỐNG KÊ PHÂN QUYỀN HỆ THỐNG (RBAC) - STATIONOS

Tài liệu này tổng hợp chi tiết các **Vai trò (Role)**, **Tài khoản mẫu (Username & Mật khẩu mặc định)**, và **Quyền hạn** tương ứng trong hệ thống StationOS hiện tại.

---

## 1. Bảng Phân Quyền Chi Tiết

| STT | Vai trò (Role) | Tài khoản mẫu (Username) | Mật khẩu mặc định | Phạm vi quản lý (Scope) | Quyền hạn chính (Permissions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Admin Toàn Cục** *(Quản trị tối cao - Trạm Tổng)* | `multi` | `Demo@2024` | **Toàn bộ hệ thống** (Không giới hạn Tỉnh/Trạm) | **Full Quyền**: Có toàn bộ tất cả các quyền của hệ thống (Quản lý trạm, thiết bị, luật cảnh báo, cấu hình, bản quyền, người dùng, báo cáo,...). |
| **2** | **Admin Trạm Con** *(Quản trị Trạm Con)* | `admin` *(Chỉ có ở Trạm Con)* | `Admin@123` | **Toàn quyền tại Trạm Con** | **Quyền quản trị Trạm Con**: Thiết lập thiết bị, camera, luật cảnh báo, quản lý nhân sự tại trạm con. <br>*(Chú ý: Tài khoản này đã bị xóa hoàn toàn ở Trạm Tổng để bảo mật)* |
| **3** | **Admin Tỉnh** *(Quản trị cấp Tỉnh)* | `provinceadmin` | `Province@123` | Chỉ được phép thao tác trong **Tỉnh được gán** | **Quyền quản trị Tỉnh**: Thêm/sửa/xóa Trạm, Thiết bị, Luật cảnh báo, Người dùng (nhân sự cấp dưới), Tổ thao tác lưu động và Bản quyền thuộc tỉnh đó. |
| **4** | **Operator PC Tỉnh** *(Giám sát cấp Tỉnh)* | `operatorprovince` | `OperatorProvince@123` | Chỉ giám sát các Trạm thuộc **Tỉnh được gán** | **Chỉ xem (Read-only)**: Xem thông tin trạm, trạng thái thiết bị, luật cảnh báo và báo cáo của tỉnh phụ trách (Không có quyền cấu hình/chỉnh sửa). |
| **5** | **Admin Trạm** *(Quản trị cấp Trạm)* | `stationadmin` | `Station@123` | Chỉ được phép thao tác trong **Trạm được gán** | **Quyền quản trị Trạm**: Quản lý thiết bị, cấu hình luật cảnh báo, báo cáo và gán nhân sự trực thuộc trạm đó. |
| **6** | **Manager Trạm** *(Trưởng trạm)* | `manager` | `Manager@123` | Chỉ được phép thao tác trong **Trạm được gán** | Xem thông tin trạm, cấu hình/điều khiển thiết bị, xem luật và xem báo cáo của trạm đó. |
| **7** | **Operator Trạm** *(Nhân viên vận hành)* | `operator` | `Operator@123` | Chỉ giám sát các **Trạm được gán** | **Chỉ xem (Read-only)**: Theo dõi camera, trạng thái thiết bị và cảnh báo của trạm được gán. |
| **8** | **Tổ trưởng Tổ thao tác** | `teamleader` | `TeamLeader@123` | Các trạm do **Tổ thao tác phụ trách** | Giám sát trạm, điều khiển thiết bị tại hiện trường khi đi xử lý sự cố, xem luật và xem báo cáo sự cố. |
| **9** | **Nhân viên Tổ thao tác** | `teammember` | `TeamMember@123` | Các trạm do **Tổ thao tác phụ trách** | **Chỉ xem (Read-only)**: Giám sát trạng thái trạm và thiết bị khi đi xử lý sự cố. |

---

## 2. Các Quy Tắc Bảo Mật Đặc Biệt Trong Mã Nguồn

* **Tách biệt an toàn Trạm Tổng & Trạm Con**: 
  * Tài khoản `admin` (mật khẩu `Admin@123`) **chỉ tồn tại và được phép hoạt động trên Trạm Con** để phục vụ việc trạm tổng kết nối API lấy luồng camera, chỉ số đo đạc.
  * Trên **Trạm Tổng (Master Station)**, tài khoản `admin` này đã được **xóa hoàn toàn khỏi cơ sở dữ liệu**. Điều này ngăn chặn triệt để lỗ hổng bảo mật: người dùng biết thông tin tài khoản trạm con đăng nhập trái phép vào Trạm Tổng.
  * Trạm Tổng chỉ chấp nhận tài khoản quản trị tối cao duy nhất là **`multi`** (mật khẩu `Demo@2024`).
* **Bảo vệ tài khoản tối cao**: Đối với các tài khoản Admin mặc định hệ thống (`admin`, `multi`), giao diện sẽ ẩn hoàn toàn các nút hành động (Sửa, Đổi mật khẩu, Vô hiệu hóa) để ngăn ngừa trường hợp người quản trị vô tình tự khóa tài khoản hoặc xóa tài khoản tối cao.
* **Tự động lọc Realtime**: Khi một Admin thực hiện thay đổi thông tin tài khoản hoặc Tổ thao tác, hệ thống sẽ tự động gửi thông báo qua WebSocket (SignalR) để tất cả các phiên làm việc của người dùng khác được cập nhật tức thì mà không cần F5 tải lại trang.
