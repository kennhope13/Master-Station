# BẢNG THỐNG KÊ PHÂN QUYỀN HỆ THỐNG (RBAC) - STATIONOS

Tài liệu này tổng hợp chi tiết các **Vai trò (Role)**, **Tài khoản mẫu (Username & Mật khẩu mặc định)**, và **Quyền hạn** tương ứng trong hệ thống StationOS hiện tại.

---

## 1. Bảng Phân Quyền Chi Tiết

| STT | Vai trò (Role) | Tài khoản mẫu (Username) | Mật khẩu mặc định | Phạm vi quản lý (Scope) | Quyền hạn chính (Permissions) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Admin Toàn Cục** *(Quản trị tối cao)* | `multi`<br>`admin` | `Demo@2024`<br>`Admin@123` | **Toàn bộ hệ thống** (Không giới hạn Tỉnh/Trạm) | **Full Quyền**: Có toàn bộ tất cả các quyền của hệ thống (Quản lý trạm, thiết bị, luật cảnh báo, cấu hình, bản quyền, người dùng, báo cáo,...). |
| **2** | **Admin Tỉnh** *(Quản trị cấp Tỉnh)* | `provinceadmin` | `Province@123` | Chỉ được phép thao tác trong **Tỉnh được gán** | **Quyền quản trị Tỉnh**: Thêm/sửa/xóa Trạm, Thiết bị, Luật cảnh báo, Người dùng (nhân sự cấp dưới), Tổ thao tác lưu động và Bản quyền thuộc tỉnh đó. |
| **3** | **Operator PC Tỉnh** *(Giám sát cấp Tỉnh)* | `operatorprovince` | `OperatorProvince@123` | Chỉ giám sát các Trạm thuộc **Tỉnh được gán** | **Chỉ xem (Read-only)**: Xem thông tin trạm, trạng thái thiết bị, luật cảnh báo và báo cáo của tỉnh phụ trách (Không có quyền cấu hình/chỉnh sửa). |
| **4** | **Admin Trạm** *(Quản trị cấp Trạm)* | `stationadmin` | `Station@123` | Chỉ được phép thao tác trong **Trạm được gán** | **Quyền quản trị Trạm**: Quản lý thiết bị, cấu hình luật cảnh báo, báo cáo và gán nhân sự trực thuộc trạm đó. |
| **5** | **Manager Trạm** *(Trưởng trạm)* | `manager` | `Manager@123` | Chỉ được phép thao tác trong **Trạm được gán** | Xem thông tin trạm, cấu hình/điều khiển thiết bị, xem luật và xem báo cáo của trạm đó. |
| **6** | **Operator Trạm** *(Nhân viên vận hành)* | `operator` | `Operator@123` | Chỉ giám sát các **Trạm được gán** | **Chỉ xem (Read-only)**: Theo dõi camera, trạng thái thiết bị và cảnh báo của trạm được gán. |
| **7** | **Tổ trưởng Tổ thao tác** | `teamleader` | `TeamLeader@123` | Các trạm do **Tổ thao tác phụ trách** | Giám sát trạm, điều khiển thiết bị tại hiện trường khi đi xử lý sự cố, xem luật và xem báo cáo sự cố. |
| **8** | **Nhân viên Tổ thao tác** | `teammember` | `TeamMember@123` | Các trạm do **Tổ thao tác phụ trách** | **Chỉ xem (Read-only)**: Giám sát trạng thái trạm và thiết bị khi đi xử lý sự cố. |

---

## 2. Các Quy Tắc Bảo Mật Đặc Biệt Trong Mã Nguồn

* **Bảo vệ tài khoản tối cao**: Đối với các tài khoản Admin mặc định hệ thống (`admin`, `multi`), giao diện sẽ ẩn hoàn toàn các nút hành động (Sửa, Đổi mật khẩu, Vô hiệu hóa) để ngăn ngừa trường hợp người quản trị vô tình tự khóa tài khoản hoặc xóa tài khoản tối cao.
* **Tự động lọc Realtime**: Khi một Admin thực hiện thay đổi thông tin tài khoản hoặc Tổ thao tác, hệ thống sẽ tự động gửi thông báo qua WebSocket (SignalR) để tất cả các phiên làm việc của người dùng khác được cập nhật tức thì mà không cần F5 tải lại trang.
