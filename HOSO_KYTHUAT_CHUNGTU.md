# HỒ SƠ KỸ THUẬT CHI TIẾT DỰ ÁN
## HỆ THỐNG GIÁM SÁT TRUNG TÂM (STATIONOS - MASTER STATION)
### PHIÊN BẢN: v3.0.13

---

> [!IMPORTANT]
> Bộ hồ sơ kỹ thuật chi tiết này được thiết lập nhằm chứng minh quy trình sản xuất phần mềm khép kín từ khâu khảo sát đến bàn giao của dự án **StationOS - Master Station (Phiên bản v3.0.13)**. Tài liệu này đóng vai trò là chứng từ chứng minh hoạt động sản xuất phần mềm phục vụ lưu trữ, kiểm toán và báo cáo thuế của doanh nghiệp.

---

## I. CÔNG ĐOẠN KHẢO SÁT & XÁC ĐỊNH YÊU CẦU

### 1. Phiếu khảo sát yêu cầu khách hàng
* **Đơn vị yêu cầu**: Các Công ty Điện lực Thành phố/Tỉnh trực thuộc Tổng công ty, phòng điều khiển trung tâm SCADA và các tổ thao tác lưu động.
* **Thời gian khảo sát**: Tháng 05/2026.
* **Hiện trạng & Khó khăn tại các trạm**:
  * Các trạm biến áp, trạm phân phối điện năng (trạm con) phân tán trên diện rộng. Dữ liệu giám sát nhiệt độ thiết bị ngoại vi, phóng điện cục bộ (PD) tủ trung thế, và luồng camera an ninh hiện tại chỉ lưu trữ cục bộ, không thể giám sát tập trung gây khó khăn cho việc quản lý cấp tổng công ty.
  * Việc đo đạc thủ công hoặc kiểm tra định kỳ tại trạm tốn kém thời gian và nhân lực. Cần một giải pháp trạm tổng để hợp nhất toàn bộ dữ liệu đo đạc thời gian thực từ các trạm con về phòng điều khiển trung tâm qua mạng WAN nội bộ.
  * Hạ tầng máy chủ tại trung tâm vận hành đồng thời nhiều hệ thống. Khi cài đặt phần mềm Master Station trên cùng máy chủ vật lý đang chạy ứng dụng Trạm con (Sub-station), thường xuyên xảy ra xung đột cổng mạng (Port Collision) và tiến trình ngầm (như PostgreSQL hoặc API Backend bị tắt chéo). 
  * Giao diện bản đồ GIS giám sát đa điểm (Multisite Map View) thi thoảng bị lỗi xám một phần khung hình khi người dùng chuyển hướng nhanh giữa trang Quản lý License và trang Dashboard chính, làm giảm hiệu quả giám sát liên tục.

### 2. Tài liệu đặc tả yêu cầu hệ thống (SRS - Software Requirement Specification)
Tài liệu này xác định chi tiết các chức năng hệ thống cung cấp:

#### 2.1. Yêu cầu chức năng (Functional Requirements)
* **G1. Bản đồ giám sát đa trạm GIS tập trung (Multisite Map View)**:
  * Tải bản đồ số GIS trực tuyến hoặc ngoại tuyến, hiển thị tọa độ địa lý chính xác của tất cả các trạm con.
  * Hiển thị trạng thái kết nối thời gian thực của trạm con thông qua mã màu (Màu xanh: Bình thường/Online; Màu đỏ: Có cảnh báo/Alarm; Màu xám: Mất kết nối/Offline).
  * Liên kết nhanh: Click vào trạm con trên bản đồ sẽ mở popover thông tin chi tiết và cung cấp link truy cập trực tiếp hệ thống của trạm đó.
* **G2. Hợp nhất luồng trực tuyến Camera trung tâm (Live Wall)**:
  * Tiếp nhận luồng RTSP camera (quang học thông thường, camera nhiệt đo nhiệt độ đầu cáp, camera phóng điện) từ các trạm con.
  * Giải mã và chuyển đổi luồng trung gian thông qua bộ chuyển mã `go2rtc` tích hợp sẵn trong bộ cài, truyền tải luồng WebRTC/MSE độ trễ cực thấp (dưới 500ms) để xem mượt mà trên trình duyệt/Electron client.
  * Thiết lập bảng lưới camera động (Live Wall) hỗ trợ xem đồng thời nhiều luồng camera từ nhiều trạm khác nhau trên cùng một màn hình điều khiển.
* **G3. Đồng bộ cảnh báo & Sự kiện thời gian thực (Centralized Alert Hub)**:
  * Tiếp nhận tự động các bản tin cảnh báo sự cố gửi lên từ trạm con thông qua API REST.
  * Đẩy thông báo cảnh báo tức thời lên giao diện Client bằng giao thức WebSocket (SignalR).
  * Hỗ trợ thanh điều khiển bên phải (Right Panel) để truy xuất nhanh danh sách cảnh báo mới nhất, phát âm thanh còi báo động khi có sự cố nghiêm trọng (Alarm Level).
* **G4. Phân cấp quản trị người dùng phức hợp (RBAC 4 tầng)**:
  * Hỗ trợ phân quyền chặt chẽ theo cấu trúc hình cây hành chính:
    * `Admin Toàn Cục (multi)`: Quản lý tối cao toàn bộ hệ thống, quản trị hạn ngạch license.
    * `Admin Tỉnh (provinceadmin)`: Chỉ thao tác và giám sát các Tổ thao tác và Trạm con trong phạm vi tỉnh được gán.
    * `Tổ Trưởng Tổ Thao Tác (teamleader)`: Giám sát và điều phối xử lý sự cố tại nhóm trạm thuộc tổ phụ trách.
    * `Admin Trạm (stationadmin)`: Quản trị cấu hình và phân công nhân sự cục bộ tại một trạm con cụ thể.
* **G5. Quản lý hạn ngạch bản quyền phần mềm (License Quota Management)**:
  * Mã hóa và giải mã file bản quyền chứa thông số hạn ngạch sử dụng thiết bị (Số lượng camera được phép giám sát, số lượng điểm đo cảm biến nhiệt độ tối đa).
  * Kiểm soát việc import/export license của trạm tổng và quản lý cấp quota xuống các trạm con trực thuộc.
* **G6. Sơ đồ đơn tuyến động (Single Line Diagram - SLD View)**:
  * Tải sơ đồ đơn tuyến kỹ thuật dạng vector (.svg), hiển thị trạng thái đóng/cắt thời gian thực của máy cắt, dao cách ly và vị trí đo lường trực quan.
* **G7. Phân tích & Dự báo nhiệt độ chuyên sâu bằng AI (AI Analytics & Thermal Forecasting)**:
  * Phân tích biểu đồ xu hướng nhiệt độ và đưa ra dự báo biến động nhiệt độ 5 phút tiếp theo bằng mô hình AI.
  * Tích hợp sự kiện AI phát hiện người (Person Detection), phát hiện lửa và khói (Fire/Smoke Detection) từ luồng video camera.
* **G8. Bộ cấu hình quy tắc giám sát động (Dynamic Rule Engine)**:
  * Thiết lập ngưỡng nhiệt độ cảnh báo cho từng vùng ROI trên camera nhiệt hoặc cảm biến tiếp xúc.
* **G9. Hệ thống cảnh báo đa kênh (Notification Hub)**:
  * Cấu hình gửi mail báo cáo sự cố hoặc gửi thông báo cảnh báo tức thời qua Telegram Bot cho các tổ trưởng tổ vận hành.

#### 2.2. Yêu cầu phi chức năng (Non-Functional Requirements)
* **Hiệu năng & Khả năng xử lý song song**: Tối ưu hóa bộ nhớ và tài nguyên CPU. Khi chạy song song trên cùng một hệ điều hành với Trạm con, ứng dụng Master Station phải cách ly hoàn toàn tài nguyên cổng mạng và tiến trình dịch vụ.
* **Độ trễ dữ liệu**:
  * Thời gian phản hồi tín hiệu kết nối trạm con < 2 giây.
  * Độ trễ luồng truyền hình trực tiếp WebRTC < 500ms.
* **Dung lượng đóng gói**: Tối ưu hóa bộ cài đặt dưới 230 MB bằng cách dọn dẹp các tệp tin debug, symbols của PostgreSQL và thư mục tạm thời của Backend.

### 3. Biên bản phê duyệt yêu cầu khách hàng
* **Đại diện Khách hàng**: Ban Kỹ thuật An toàn & Công nghệ Thông tin - Tổng công ty Điện lực.
* **Đại diện Đơn vị Phát triển**: Trưởng dự án phát triển StationOS Master Station.
* **Nội dung thống nhất**: Phê duyệt các chức năng trên và đưa vào kế hoạch phân tích thiết kế, triển khai mã nguồn cho phiên bản ứng dụng v3.0.13.

---

## II. CÔNG ĐOẠN PHÂN TÍCH & THIẾT KẾ

### 1. Sơ đồ kiến trúc hệ thống (Architecture Diagram)
Hệ thống Master Station được đóng gói dưới dạng **Thick Client (All-in-One)**. Các cổng mạng dịch vụ được thiết lập độc lập so với Trạm con.

![Sơ đồ kiến trúc hệ thống Master Station](/home/admin-/Desktop/Master-Station/docs-project/diagrams/architecture_diagram.png)

### 2. Sơ đồ Use Case (Use Case Diagram)
Phân tích các tác vụ và vai trò tương tác giữa các tài khoản người dùng và hệ thống Master Station:

![Sơ đồ Use Case hệ thống](/home/admin-/Desktop/Master-Station/docs-project/diagrams/usecase_diagram.png)

### 3. Sơ đồ lớp (Class Diagram)
Mô tả cấu trúc thực thể và quan hệ logic giữa các đối tượng trong mã nguồn:

![Sơ đồ lớp UML](/home/admin-/Desktop/Master-Station/docs-project/diagrams/class_diagram.png)

### 4. Sơ đồ hoạt động (Activity Diagram)
Mô tả quy trình xử lý dữ liệu đồng bộ song song từ các trạm con về màn hình giám sát trung tâm:

![Sơ đồ hoạt động](/home/admin-/Desktop/Master-Station/docs-project/diagrams/activity_diagram.png)

### 5. Sơ đồ trạng thái (State Diagram)
Mô tả sự chuyển đổi trạng thái kết nối của trạm con và vòng đời của sự cố cảnh báo:

![Sơ đồ trạng thái](/home/admin-/Desktop/Master-Station/docs-project/diagrams/state_diagram.png)

### 6. Sơ đồ cơ sở dữ liệu chi tiết (Database ERD Diagram)
Các bảng dữ liệu được thiết kế tối ưu trên PostgreSQL phục vụ quản lý tập trung.

![Sơ đồ mối quan hệ cơ sở dữ liệu ERD](/home/admin-/Desktop/Master-Station/docs-project/diagrams/erd_diagram.png)

#### Bảng `Provinces` (Danh mục Tỉnh thành quản lý)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(200)` | Not Null | Tên tỉnh thành (Ví dụ: `Long An`) |
| `code` | `varchar(50)` | Null | Mã tỉnh thành |
| `description` | `text` | Null | Mô tả chi tiết |
| `status` | `varchar(20)` | Not Null | Trạng thái (`active`/`inactive`) |
| `createdAt` | `timestamp` | Not Null | Thời gian khởi tạo |

#### Bảng `Stations` (Thông tin các Trạm con kết nối)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(200)` | Not Null | Tên trạm biến áp |
| `code` | `varchar(50)` | Unique, Not Null | Mã trạm |
| `status` | `varchar(20)` | Not Null | Trạng thái (`active`/`inactive`) |
| `location` | `text (jsonb)` | Null | Tọa độ GIS và địa chỉ trạm |
| `apiUrl` | `varchar(250)` | Not Null | Địa chỉ REST API của trạm con |
| `apiUsername` | `varchar(100)` | Null | Tài khoản kết nối API |
| `hasApiPassword`| `boolean` | Not Null | Cấu hình bảo mật mật khẩu API |
| `webUrl` | `varchar(250)` | Null | Đường dẫn giao diện web trạm con |
| `connectionStatus`| `varchar(20)`| Not Null | Trạng thái kết nối (`online`/`offline`/`unknown`) |
| `lastSeenAt` | `timestamp` | Null | Thời điểm phản hồi cuối cùng |
| `cameraQuota` | `integer` | Null | Số lượng camera tối đa cấp cho trạm |
| `sensorQuota` | `integer` | Null | Số lượng cảm biến tối đa cấp cho trạm |
| `provinceId` | `uuid` | Foreign Key | Liên kết tới bảng `Provinces` (Set Null khi xóa) |

#### Bảng `Devices` (Các thiết bị giám sát thuộc trạm con)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(150)` | Not Null | Tên thiết bị |
| `type` | `varchar(50)` | Not Null | Loại thiết bị (`camera_thermal`, `plc_s7`...) |
| `protocol` | `varchar(50)` | Not Null | Giao thức truyền thông (`rtsp`, `modbus_tcp`) |
| `config` | `text (jsonb)` | Not Null | Tham số cấu hình chi tiết dạng JSON |
| `status` | `varchar(20)` | Not Null | Trạng thái kết nối (`online`/`offline`/`error`) |
| `stationId` | `uuid` | Foreign Key | Liên kết tới bảng `Stations` |
| `createdAt` | `timestamp` | Not Null | Thời điểm khai báo thiết bị |

#### Bảng `Users` (Thông tin tài khoản và phạm vi quản lý)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `user_id` | `uuid` | Primary Key | Khóa chính |
| `username` | `varchar(100)` | Unique, Not Null | Tên đăng nhập hệ thống |
| `fullname` | `varchar(200)` | Not Null | Họ và tên đầy đủ |
| `email` | `varchar(150)` | Null | Địa chỉ thư điện tử |
| `role` | `varchar(50)` | Not Null | Vai trò (`admin`, `admin_province`, `operator_province`...) |
| `active` | `boolean` | Not Null | Trạng thái kích hoạt tài khoản |
| `created_at` | `timestamp` | Not Null | Thời gian tạo tài khoản |
| `province_ids` | `uuid[]` | Null | Danh sách tỉnh thành được phép quản lý |
| `permissions` | `text[]` | Null | Danh sách quyền cụ thể |
| `team_id` | `uuid` | Foreign Key | Liên kết tới bảng `Teams` |

#### Bảng `SldFiles` (Tệp sơ đồ đơn tuyến SLD)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `station_id` | `uuid` | Foreign Key | Liên kết tới bảng `Stations` |
| `file_name` | `varchar(200)` | Not Null | Tên file sơ đồ đơn tuyến |
| `file_path` | `varchar(500)` | Not Null | Đường dẫn vật lý của file trên đĩa |
| `uploaded_at` | `timestamp` | Not Null | Thời điểm tải lên sơ đồ |

#### Bảng `SldPoints` (Điểm liên kết trên sơ đồ đơn tuyến)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `sld_file_id` | `uuid` | Foreign Key | Liên kết tới bảng `SldFiles` |
| `element_id` | `varchar(100)` | Not Null | ID phần tử SVG tương ứng |
| `device_id` | `uuid` | Foreign Key | Liên kết tới bảng `Devices` |
| `point_id` | `varchar(100)` | Not Null | Mã điểm đo đạc của thiết bị |

#### Bảng `SensorReadings` (Dữ liệu đo đạc cảm biến - Hypertable)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `time` | `timestamp` | Composite Key | Thời gian ghi nhận giá trị đo |
| `id` | `bigint` | Composite Key | Khóa phụ tăng tự động |
| `station_id` | `uuid` | Not Null | ID trạm phát sinh dữ liệu |
| `device_id` | `uuid` | Not Null | ID thiết bị đo |
| `point_id` | `varchar(100)` | Not Null | Mã điểm đo cảm biến |
| `val` | `double precision`| Not Null | Giá trị đo lường thực tế |

#### Bảng `AiModelVersions` (Phiên bản mô hình AI dự báo/nhận diện)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `model_name` | `varchar(100)` | Not Null | Tên mô hình AI (`intrusion`, `thermal_forecasting`) |
| `version` | `varchar(20)` | Not Null | Số phiên bản mô hình |
| `file_path` | `varchar(500)` | Not Null | Đường dẫn lưu file trọng số mô hình |
| `is_active` | `boolean` | Not Null | Trạng thái mô hình đang hoạt động |

#### Bảng `DetectionEvents` (Sự kiện nhận diện AI)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `device_id` | `uuid` | Foreign Key | ID camera phát hiện sự kiện |
| `event_type` | `varchar(50)` | Not Null | Loại sự kiện AI (`person`, `fire`, `smoke`) |
| `confidence` | `double precision`| Not Null | Độ tin cậy của thuật toán AI |
| `bounding_boxes`| `text (jsonb)` | Null | Tọa độ khung nhận diện dạng JSON |
| `metadata` | `text (jsonb)` | Null | Thông tin bổ sung của sự kiện |
| `triggered_at` | `timestamp` | Not Null | Thời điểm xảy ra sự kiện |

#### Bảng `MediaFiles` (Tệp ghi hình ảnh/video sự kiện)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `event_id` | `uuid` | Null | ID liên kết sự kiện (nếu có) |
| `file_type` | `varchar(10)` | Not Null | Định dạng tệp (`jpg`, `mp4`) |
| `file_path` | `varchar(500)` | Not Null | Đường dẫn lưu trữ tệp trên đĩa |
| `created_at` | `timestamp` | Not Null | Thời điểm tạo tệp media |

#### Bảng `ThermalFrames` (Khung nhiệt độ đầy đủ từ camera nhiệt)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `device_id` | `uuid` | Foreign Key | ID camera nhiệt |
| `temp_matrix` | `text (jsonb)` | Not Null | Ma trận điểm nhiệt độ phân giải cao |
| `max_temp` | `double precision`| Not Null | Nhiệt độ cao nhất trong khung hình |
| `min_temp` | `double precision`| Not Null | Nhiệt độ thấp nhất trong khung hình |
| `captured_at` | `timestamp` | Not Null | Thời điểm chụp khung nhiệt |

#### Bảng `Alerts` (Cảnh báo sự cố hiện hành)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `source` | `varchar(50)` | Not Null | Nguồn cảnh báo (`rule_engine`, `ai_detection`) |
| `level` | `varchar(20)` | Not Null | Mức độ (`warning`, `alarm`) |
| `status` | `varchar(20)` | Not Null | Trạng thái cảnh báo (`open`, `acked`) |
| `message` | `text` | Not Null | Nội dung thông báo sự cố |
| `value` | `double precision`| Null | Giá trị quá ngưỡng đo được |
| `device_id` | `uuid` | Foreign Key | ID thiết bị bị sự cố |
| `station_id` | `uuid` | Foreign Key | ID trạm xảy ra sự cố |
| `triggered_at` | `timestamp` | Not Null | Thời điểm bắt đầu sự cố |

#### Bảng `AlertHistories` (Lịch sử cảnh báo đã được đóng)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `alert_id` | `uuid` | Not Null | ID của bản tin cảnh báo gốc |
| `closed_at` | `timestamp` | Not Null | Thời điểm đóng sự cố |
| `ack_by` | `varchar(100)` | Null | Tài khoản nhân viên xác nhận |
| `ack_note` | `text` | Null | Ghi chú vận hành xử lý sự cố |

#### Bảng `Rules` (Quy tắc giám sát sự cố)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(150)` | Not Null | Tên quy tắc giám sát |
| `condition` | `text (jsonb)` | Not Null | Điều kiện kích hoạt logic phức hợp |
| `actions` | `text (jsonb)` | Not Null | Hành động khi kích hoạt (Gửi Mail, Telegram) |
| `is_enabled` | `boolean` | Not Null | Trạng thái quy tắc hoạt động |

#### Bảng `RuleTriggerLogs` (Lịch sử kích hoạt quy tắc)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `rule_id` | `uuid` | Foreign Key | ID quy tắc bị kích hoạt |
| `condition_snapshot`| `text (jsonb)`| Not Null | Ảnh chụp giá trị cảm biến khi kích hoạt |
| `triggered_at` | `timestamp` | Not Null | Thời điểm kích hoạt quy tắc |

#### Bảng `AuditLogs` (Nhật ký kiểm toán hệ thống)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `action` | `varchar(50)` | Not Null | Hành động thực thi (`CREATE`, `UPDATE`...) |
| `entity_type` | `varchar(50)` | Null | Tên đối tượng bị tác động |
| `entity_id` | `varchar(100)` | Null | Khóa của đối tượng bị tác động |
| `username` | `varchar(100)` | Null | Tài khoản người thực thi |
| `ip_address` | `varchar(50)` | Null | Địa chỉ IP máy trạm thao tác |
| `old_value` | `text (jsonb)` | Null | Trạng thái dữ liệu cũ |
| `new_value` | `text (jsonb)` | Null | Trạng thái dữ liệu mới |
| `ts` | `timestamp` | Not Null | Thời điểm thao tác |

#### Bảng `LoginLogs` (Nhật ký đăng nhập người dùng)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `username` | `varchar(100)` | Not Null | Tài khoản thực hiện đăng nhập |
| `login_at` | `timestamp` | Not Null | Thời điểm đăng nhập |
| `ip_address` | `varchar(50)` | Null | Địa chỉ IP của máy khách |
| `user_agent` | `varchar(500)` | Null | Trình duyệt hoặc thiết bị đăng nhập |
| `status` | `varchar(20)` | Not Null | Trạng thái (`success`/`failed`) |

#### Bảng `NotifyLogs` (Nhật ký thông báo đa kênh)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `channel` | `varchar(20)` | Not Null | Kênh gửi (`email`, `telegram`, `sms`) |
| `recipient` | `varchar(200)` | Not Null | Địa chỉ nhận (Email hoặc chat_id) |
| `subject` | `varchar(200)` | Null | Tiêu đề thông báo |
| `content` | `text` | Not Null | Nội dung thông báo chi tiết |
| `status` | `varchar(20)` | Not Null | Trạng thái gửi (`sent`/`failed`) |
| `sent_at` | `timestamp` | Not Null | Thời gian gửi đi |

#### Bảng `SystemSettings` (Cài đặt hệ thống Master)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `station_id` | `uuid` | Not Null | ID trạm áp dụng cấu hình |
| `key` | `varchar(100)` | Not Null | Tên cấu hình |
| `value` | `text (jsonb)` | Not Null | Giá trị cấu hình dạng JSON |
| `updated_at` | `timestamp` | Not Null | Thời điểm cập nhật cuối cùng |

#### Bảng `Reports` (Danh mục báo cáo xuất bản)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(200)` | Not Null | Tên file báo cáo |
| `type` | `varchar(20)` | Not Null | Loại báo cáo (`pdf`, `xlsx`) |
| `created_by` | `varchar(100)` | Not Null | Người kết xuất báo cáo |
| `file_path` | `varchar(500)` | Not Null | Đường dẫn lưu trữ tệp báo cáo |
| `created_at` | `timestamp` | Not Null | Thời điểm xuất bản |

#### Bảng `SyncQueues` (Hàng đợi đồng bộ dữ liệu trạm con)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `station_id` | `uuid` | Foreign Key | ID trạm phát sinh đồng bộ |
| `payload` | `text (jsonb)` | Not Null | Nội dung dữ liệu cần đồng bộ |
| `retry_count` | `integer` | Not Null | Số lần thử lại khi lỗi |
| `status` | `varchar(20)` | Not Null | Trạng thái (`pending`, `processed`, `failed`) |

#### Bảng `MaintenanceTasks` (Lịch bảo trì và phân công sửa chữa)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `title` | `varchar(200)` | Not Null | Tiêu đề công việc bảo trì |
| `description` | `text` | Null | Chi tiết nhiệm vụ bảo trì |
| `checklist` | `text (jsonb)` | Null | Danh sách hạng mục cần kiểm tra dạng JSON |
| `assigned_team_id`| `uuid` | Foreign Key | Tổ thao tác được phân công |
| `scheduled_date`| `date` | Not Null | Ngày thực hiện dự kiến |
| `status` | `varchar(20)` | Not Null | Trạng thái (`pending`, `in_progress`, `done`) |

#### Bảng `Licenses` (Khóa bản quyền hệ thống)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `license_key` | `text` | Not Null | Chuỗi khóa bản quyền đã được mã hóa |
| `activated_at` | `timestamp` | Not Null | Thời gian kích hoạt bản quyền |
| `expired_at` | `timestamp` | Null | Thời hạn hết hạn bản quyền |
| `device_limits` | `text (jsonb)` | Not Null | Hạn ngạch thiết bị tối đa cho phép |

#### Bảng `LicenseAddonRecords` (Bản ghi nạp addon bản quyền chống nạp trùng)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `addon_id` | `uuid` | Unique, Not Null | Mã định danh duy nhất của gói Addon |
| `loaded_at` | `timestamp` | Not Null | Thời gian nạp Addon vào hệ thống |

#### Bảng `Boundaries` (Vùng ranh giới ROI/AI)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `device_id` | `uuid` | Not Null | ID camera thiết lập vùng |
| `type` | `varchar(20)` | Not Null | Loại vùng (`roi_thermal`, `intrusion_boundary`) |
| `polygon_json` | `text (jsonb)` | Not Null | Tập hợp tọa độ các đỉnh của đa giác |
| `thresholds_json`| `text (jsonb)`| Null | Ngưỡng cảnh báo nhiệt độ gán riêng cho vùng |

#### Bảng `RoiPoints` (Điểm đo nhiệt độ cụ thể trên camera nhiệt)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `device_id` | `uuid` | Foreign Key | ID camera nhiệt |
| `point_name` | `varchar(100)` | Not Null | Tên điểm đo (Ví dụ: `Đầu cáp pha A`) |
| `x_coord` | `integer` | Not Null | Tọa độ X trên khung hình camera |
| `y_coord` | `integer` | Not Null | Tọa độ Y trên khung hình camera |

#### Bảng `Teams` (Thông tin Tổ thao tác lưu động)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | `uuid` | Primary Key | Khóa chính |
| `name` | `varchar(150)` | Not Null | Tên tổ thao tác lưu động |
| `description` | `text` | Null | Mô tả địa bàn hoạt động |
| `province_id` | `uuid` | Foreign Key | Liên kết tới bảng `Provinces` |
| `station_ids` | `uuid[]` | Null | Danh sách các trạm phụ trách của tổ |

---

## III. CÔNG ĐOẠN LẬP TRÌNH & VIẾT MÃ NGUỒN

### 1. Nhật ký lập trình đầy đủ (Git Commit Log)
Dưới đây là toàn bộ nhật ký kiểm soát mã nguồn lịch sử phát triển của dự án Master Station:

* 1e1f657 - kennhope13, 2 minutes ago : docs: resolve arrow label text collision in architecture and state diagrams with line masking
* 595819c - kennhope13, 6 minutes ago : docs: resolve Vietnamese diacritics rendering issue in diagrams using DejaVu Sans font
* f9f7ca7 - kennhope13, 13 minutes ago : docs: integrate 6 UML diagrams as visual figures, include full git history, expand bug reports, and remove code snippets
* 08e4a06 - kennhope13, 18 hours ago : docs: generate and commit HOSO_KYTHUAT_CHUNGTU.docx
* f0400a5 - kennhope13, 18 hours ago : docs: expand technical profile with exhaustive details, schemas, and test matrices
* 16c7fc9 - kennhope13, 18 hours ago : docs: add software production technical profile (HOSO_KYTHUAT_CHUNGTU.md)
* 7a72c18 - kennhope13, 19 hours ago : bump(version): 3.0.13
* c2bc5c7 - kennhope13, 19 hours ago : fix(ui): resolve layout and styling leaks/glitches when returning from License page to Multisite dashboard
* 95bccad - kennhope13, 25 hours ago : chore: clean up pg_portable and backend wwwroot to optimize installer size
* e822ce7 - kennhope13, 3 days ago : fix: resolve central monitor branding and startup freeze on loadscreen
* c6a34f7 - kennhope13, 3 days ago : fix: relocate installer.nsh to non-ignored electron directory and bump version to 3.0.9
* 5ad2b54 - kennhope13, 3 days ago : chore: bump version to 3.0.8
* a80d2e8 - kennhope13, 3 days ago : feat: configure Master Station thick client packaging and sync legacy vendor secret
* 9494e5c - kennhope13, 5 days ago : fix: correct go2rtc download check and backend extraResources path, bump version to 3.0.7
* 6a585e9 - kennhope13, 5 days ago : feat: configure custom icon, port 6432, file logging, and bump version to 3.0.6
* 3316095 - kennhope13, 5 days ago : feat: rename app to Master Station to prevent conflicts with Station Monitor
* cfba0bb - kennhope13, 5 days ago : chore: bump version to 3.0.4 and add GITHUB_TOKEN permissions
* f81f9d6 - kennhope13, 5 days ago : chore: bump version to 3.0.3
* d2d0427 - kennhope13, 5 days ago : chore: bump version to 3.0.2
* 37ec6f3 - kennhope13, 5 days ago : chore: remove old build-thin-client.bat
* 7bc7a84 - kennhope13, 5 days ago : feat: apply Thick Client All-in-One architecture for Master Station
* 230c95f - kennhope13, 6 days ago : fix license và thêm license cho trạm con
* 10de561 - kennhope13, 7 days ago : feat: fix station monitor and license
* 2619b2d - kennhope13, 10 days ago : fix(license): implement license and sensor limit validation and UI updates
* 2edda7c - kennhope13, 10 days ago : feat: implement real-time synchronization for devices, audit logs, and maintenance tasks upon ingestion
* f5d4136 - kennhope13, 10 days ago : feat: remove delete license button and explanation text from UI
* 3ea1cb9 - kennhope13, 10 days ago : style(multisite): wrap selected station detail body in scrollable container and remove stray text
* f6d356a - kennhope13, 10 days ago : style(multisite): overhaul station panels layout to full height and integrate collapse & back navigation into headers
* 7e9dbe1 - kennhope13, 10 days ago : style(multisite): make user profile dropdown menu solid background instead of transparent
* 3abe468 - kennhope13, 10 days ago : fix(sync): resolve EF Core tracking conflicts for duplicate ingest items in same batch
* 601def2 - kennhope13, 10 days ago : fix(frontend): bypass sessionStorage cache for device list and remote kpis on refresh
* fbf951d - kennhope13, 11 days ago : fix: resolve province matching and license check on station registration
* 202dcc6 - kennhope13, 12 days ago : fix license
* 52c5b5c - kennhope13, 3 weeks ago : feat: implement remote station daily pd and thermal history queries via proxy API and match styling
* b75666a - kennhope13, 3 weeks ago : feat: modernize central analytics dashboard by replacing leaflet map with fleet diagnostic grid
* 594d523 - kennhope13, 3 weeks ago : Simplify date filter: single native date picker for multisite logs
* b2aeeb6 - kennhope13, 3 weeks ago : style: hide old/new value column in audit change details table based on action
* 10655b8 - kennhope13, 3 weeks ago : style: convert audit config changes into structured table, translate field labels and format ISO date strings
* b955ed4 - kennhope13, 3 weeks ago : feat: convert system logs detail panel to centered modal overlay matching alert details
* 62271be - kennhope13, 3 weeks ago : style: left-align alert message text inside detail modal
* 1376fdf - kennhope13, 3 weeks ago : style: center modal header and details, set border radius to 0, and use system colors for alert details
* c1a18d2 - kennhope13, 3 weeks ago : style: enhance alert detail modal aesthetics and key-value alignment
* a841ce8 - kennhope13, 3 weeks ago : feat: show alert details in a centered modal dialog with a dimmed background overlay
* b227508 - kennhope13, 3 weeks ago : fix: group filter labels and dropdowns in alert history to prevent layout issues
* a25b9bc - kennhope13, 3 weeks ago : feat: remove per-station summary strip (THEO TRẠM) from Central System Logs
* 3e891e6 - kennhope13, 3 weeks ago : style: center Xóa cấu hình title text in preset delete confirmation dialog
* 3d49b52 - kennhope13, 3 weeks ago : feat: remove search bar from Central System Logs view toolbar
* ba14534 - kennhope13, 3 weeks ago : feat: add BẢO TRÌ category mapping for maintenance alerts in dashboard AlertPanel
* b229f5d - kennhope13, 3 weeks ago : style: change default calendar picker display text to Lịch
* b55b3da - kennhope13, 3 weeks ago : feat: add team filter to central alerts history view
* c22ecd0 - kennhope13, 3 weeks ago : feat: standardize multisite export utility with consolidated CSV/PDF dropdown and optimize filters
* bb2e48a - kennhope13, 3 weeks ago : feat: support commercial package license key format with right-to-left parsing
* a37b465 - kennhope13, 3 weeks ago : Fix license activation frontend bug, refine demo limits UI text, and add database initializer upgrades
* 9405a85 - kennhope13, 3 weeks ago : Fix license activation check to treat any successful 2xx API response as success
* 9c65296 - kennhope13, 3 weeks ago : Update license page UI in demo mode to show unlimited users and default resource limit of 10
* bb6e997 - kennhope13, 3 weeks ago : Change wording from 'tối đa 10' to 'mặc định là 10' in license page warning
* 76cdf93 - kennhope13, 3 weeks ago : Enforce default limit of 10 for unlicensed mode on stations, devices, and boundaries with backend validation
* cddd744 - kennhope13, 3 weeks ago : feat: add STATION-MONITOR-ENTERPRISE-UNLIMITED master key support and apply_license.py activator script
* 81ac5d0 - kennhope13, 3 weeks ago : feat: integrate license resource limits validation, resolve session limits, and fix UI redirection to license page
* 5f4def7 - kennhope13, 3 weeks ago : Add permanent delete user, fix province dropdown dark theme, fix Tay Ninh station province
* cd07899 - kennhope13, 3 weeks ago : Fix province permission: restrict station CRUD to assigned provinces only
* eed066c - kennhope13, 4 weeks ago : Add province and location validation to station creation
* 34f37a9 - kennhope13, 4 weeks ago : docs: revert local station admin credentials back to stationadmin/Station@123
* 615136f - kennhope13, 4 weeks ago : docs: standardize default substation admin credentials to admin/Admin@123 in doc files
* d63139a - kennhope13, 4 weeks ago : fix: simplify LaTeX table headers to resolve alignment issues
* a3594b3 - kennhope13, 4 weeks ago : fix: resolve vertical alignment issues in longtable by replacing itemize environment
* 8e853ae - kennhope13, 4 weeks ago : fix: drop STT column and resolve header alignment issues in LaTeX table
* 4d7ffea - kennhope13, 4 weeks ago : fix: resolve table horizontal overflow by reducing cell padding and column widths
* b7d758d - kennhope13, 4 weeks ago : docs: expand LaTeX table with detailed descriptions and adjust page layout margins
* c4cc309 - kennhope13, 4 weeks ago : fix: adjust LaTeX longtable column widths to fit layout page margins
* ff05fe2 - kennhope13, 4 weeks ago : fix: escape underscores and fix tikz library name in LaTeX file
* f205a81 - kennhope13, 4 weeks ago : docs: add T5 fontenc package to LaTeX document for correct Vietnamese rendering
* de835e3 - kennhope13, 4 weeks ago : docs: create LaTeX version of system RBAC documentation with TikZ diagram
* 99c5d00 - kennhope13, 4 weeks ago : docs: add Mermaid tree diagram representing the 4-tier hierarchy to PhanQuyenHeThong.md
* 5cb8588 - kennhope13, 4 weeks ago : refactor: simplify default seed accounts to the core 4 admin levels
* e15d46a - kennhope13, 4 weeks ago : refactor: update seed scopes for default accounts to match RBAC guidelines
* d3fff06 - kennhope13, 4 weeks ago : security: delete 'admin' user from Central database for security
* c5ddbfa - kennhope13, 4 weeks ago : docs: add passwords of default accounts to RBAC table
* 74b8fbf - kennhope13, 4 weeks ago : docs: add RBAC system permissions documentation table
* cd463f7 - kennhope13, 4 weeks ago : feat: implement real-time synchronization for users and teams using SignalR on 18-06-2026
* e9517f3 - kennhope13, 4 weeks ago : feat: hệ thống phân quyền động checklist, admin tỉnh/trạm, form 2 cột rộng - 17/06/2026
* c758d52 - kennhope13, 4 weeks ago : feat: multisite proxy fixes 2026-06-17
* 42404dc - kennhope13, 4 weeks ago : chore: save current multisite back button adjustments
* 59cb4e4 - kennhope13, 4 weeks ago : feat: fix analytics data loading, remote station token caching, plc simulation cache key format
* 9e6a193 - kennhope13, 4 weeks ago : UI improvements: modernize industrial buttons, refine dashboard toolbar, enhance login page, and simplify map back button
* 38fcd62 - kennhope13, 5 weeks ago : feat: redesign login page, add child station URL + connectivity check, remove fake station seed
* b25307d - admin, 5 weeks ago : feat: integrate multi-station overview, optimize telemetry ingestion cache, and update station monitoring config
* f8800c1 - admin, 5 weeks ago : revert: restore child station analytics layout to its original style
* f8b31ff - admin, 5 weeks ago : feat: integrate central/multisite monitoring station configurations and layouts
* bc42c00 - admin, 5 weeks ago : fix: make Tauri commands async to prevent thread blocks on navigation
* 842c74e - admin, 5 weeks ago : fix: bypass connection health checks in connection manager to avoid hang
* a3f11f5 - admin, 5 weeks ago : feat: simplify thin client login page, focus on local/localhost connections
* 81b2eee - admin, 5 weeks ago : fix: resolve compilation errors in UserManagementPage and cleanup unused vars
* 96ab300 - admin, 5 weeks ago : feat: optimize thin client UI, fix global Tauri API injection, and improve multi-site overview
* 0c028a8 - admin, 5 weeks ago : fix(desktop): enable withGlobalTauri in config and add safety check to prevent JS crash on load
* 3fca27f - admin, 5 weeks ago : fix(desktop): handle host unreachable error properly on connect screen
* 241b13e - admin, 5 weeks ago : feat(desktop): bundle tailscale setup installer as resource and add quick install button
* 4fe6c17 - admin, 5 weeks ago : feat: add Tailscale VPN helper and open_url command to Tauri desktop connection screen
* f7a8360 - admin, 5 weeks ago : style: refine multi-station navigation back buttons and logos
* f8d6024 - admin, 5 weeks ago : feat: integrate real-time PD telemetry indicator into region overlays and clean up UI build issues
* ec9729d - admin, 5 weeks ago : đa trạm và fix ai nhiệt độ
* 27c2a26 - admin, 5 weeks ago : feat: bypass license, optimize telemetry ingestion to memory cache, persist active station selection, and resolve scoping conflicts
* 00e37a2 - admin, 6 weeks ago : fix(thermal-pred): fix thermal forecast loop indentation and dynamic frontend retrieval
* 7a428c5 - admin, 6 weeks ago : feat: optimize PD boundaries detection logic and fix deletion constraint
* 7c8a43b - Admin, 6 weeks ago : chore: persist db volume using name stationos-main in compose
* 7ce6507 - Admin, 6 weeks ago : fix: override beforeBuildCommand to empty for thin client build
* 3b6fb8a - Admin, 6 weeks ago : fix: remove invalid NSIS config fields (shortcutName not in Tauri 2 schema)
* 2012ab0 - Admin, 6 weeks ago : chore: sync all latest changes before push to App-Station-Monitor
* b9d2ab9 - Admin, 6 weeks ago : feat: add thin client Windows installer with GitHub Actions CI
* 2890455 - Admin, 6 weeks ago : Update forecasting horizon from 5 steps to 1 step to show only the next 5-minute prediction
* b045b0a - Admin, 6 weeks ago : Fix thermal history bucketing: include date in bucket key to ensure correct chronological sorting
* b240dd5 - Admin, 6 weeks ago : Optimize AppShell header layout: apply square corners (borderRadius: 0) and remove unused imports
* a8d71a9 - Admin, 6 weeks ago : Optimize dashboard alert panel: add squared edges and auto-trigger live camera view on alarm events
* 797e7fe - Admin, 6 weeks ago : chore: remove redundant camera linkage configuration tab from SettingsPage
* 571df39 - Admin, 6 weeks ago : chore: remove redundant theme configuration tab from SettingsPage
* f782c4b - Admin, 6 weeks ago : style: implement collapsible inline theme selector in AppShell
* 209ed00 - Admin, 6 weeks ago : style: replace native theme select with custom styled theme selector
* b08855e - Admin, 6 weeks ago : chore: remove rule-engine from sidebar navigation
* a8c158e - Admin, 6 weeks ago : feat: implement quick rule engine configuration, optimize storage monitor worker, and clean up thermal monitoring labels
* 380ef91 - Admin, 6 weeks ago : feat(ui): optimize alert panel layout horizontal columns and vertical tight styling
* 220455a - Admin, 6 weeks ago : feat(thermal): implement real-time dynamic sync and clashing-free point ID assignment on deletion
* b0133b0 - Admin, 6 weeks ago : Fix compiler errors and unused imports in frontend
* 963f51e - Admin, 6 weeks ago : Merge branch 'backup-xem-ai-detect-changes' to restore uncommitted local changes and resolve conflicts
* 55b97cd - Admin, 6 weeks ago : Backup local uncommitted changes before merging thermal-forecast
* ab84315 - kennhope13, 6 weeks ago : feat: implement 5-minute thermal forecasting data synchronization and partner Jetson push
* 46cf91a - kennhope13, 7 weeks ago : feat: integrate Jetson Orin Nano AI Person Detection webhook and enable LAN connection binding on port 5000
* 63eeadf - Admin, 7 weeks ago : feat: implement system-wide toast notification UI and update visual styles for page headers and user actions
* 59ff9a9 - Admin, 7 weeks ago : feat: restore PD camera region drawing interface and realtime warning log panel
* ebc9dc2 - Admin, 7 weeks ago : style: compact all page toolbar headers globally - remove scroll, reduce heights/gaps/fonts for single-row layout
* a0a9c8c - Admin, 7 weeks ago : style: remove hardcoded 270px from KpiCards and CameraGrid, compact fonts/padding, fully fluid width
* a47fc7a - Admin, 7 weeks ago : style: refactor CabinetAnalyticsTab layout from fixed 420px to fluid percentage-based scaling with bounds
* 98335ed - Admin, 7 weeks ago : style: optimize DashboardPage layout with fluid percentage-based widths and add settings gear toggle to DashboardToolbar
* f175e65 - Admin, 7 weeks ago : style: implement responsive compact Option 1 toolbar styling globally to prevent overflow
* 7c22bc1 - Admin, 7 weeks ago : style: optimize DeviceManagementPage UI by using ActionDropdown for table rows and enabling flex-wrap for toolbar rows to prevent overflow
* c4da78e - Admin, 7 weeks ago : fix: restrict PD alerts to within-region hotspots exceeding warning/alarm thresholds, and upgrade region alert to multipart snapshot uploads
* faa8e33 - Admin, 7 weeks ago : feat: take annotated camera snapshot on PD alert and upload to backend webhook
* 42e3511 - Admin, 7 weeks ago : feat: integrate global SignalR AlertNew toast and floating RichAlertModal for thermal hotspot, fire, intrusion, and PD
* e88b482 - Admin, 7 weeks ago : fix: stage CameraHandlers changes to align with updated DeviceService
* e9cdac6 - Admin, 7 weeks ago : fix: keep user in active camera config on save and render both thermal roi and pd boundaries on realtime overlays
* ea9494f - Admin, 7 weeks ago : fix: restore missing backend service methods and correct vite local proxy configuration
* 9cf6d2c - Admin, 7 weeks ago : fix: resolve frontend typescript compile and build errors for thermal ROI and PD integration
* 4887909 - Admin, 7 weeks ago : merge: integrate thermal ROI polygon optimization and acoustic PD monitoring features
* 0ec88df - Admin, 7 weeks ago : update-phongdien
* 8d8e039 - kennhope13, 7 weeks ago : feat: thermal roi polygon optimization and repository cleanup
* a1758a3 - Admin, 7 weeks ago : feat: optimize PD Monitor UI and silence engine error logs
* bff1607 - kennhope13, 7 weeks ago : feat: optimize thermal monitoring region boundaries scaling and restore realtime point monitoring
* d3ecd2d - metorkhai, 7 weeks ago : feat: Restore Dual-Lens picking logic and fix thermal camera DB seeding
* 65ce22d - Admin, 7 weeks ago : feat(relay,backend,frontend): optimize thermal readings, skip PD prediction ingest, and seed rules P11-P20
* f049819 - metorkhai, 7 weeks ago : Initial commit
* 9380894 - Admin, 8 weeks ago : feat: restructure PD insights panel to 4-section 2x2 grid with AI frequency prediction
* 02876f4 - Admin, 8 weeks ago : perf: optimize RuleEvaluationWorker query to avoid slow GroupBy and disable verbose EF SQL logs
* 66934ca - Admin, 8 weeks ago : perf: optimize AI predictions and PD predictions retrieval using fast backward-seeking chunk parser
* cc988ee - Admin, 8 weeks ago : feat(thermal-points): change default overlay opacity to 100%
* f0c716e - Admin, 8 weeks ago : feat(thermal-points): hide overlay and zoom controls from the UI, setting default blend to 40%
* 2113dd3 - Admin, 8 weeks ago : fix(thermal-points): preserve picker dot and coordinates during zoom and tab changes
* 002ecef - Admin, 8 weeks ago : feat(thermal-points): implement real-time camera overlay and cursor-centered zoom; optimize DB queries for local mode
* ee5c5ab - Admin, 8 weeks ago : feat: add scrollbar and sticky header to thermal points table
* b074be4 - Admin, 8 weeks ago : feat: Add Thermal Points management and persistent Docker DB
* 3261780 - Admin, 9 weeks ago : feat: optimize thermal overlay size and fix stream connectivity issues
* 59d34b7 - Admin, 9 weeks ago : backup: thermal relay state with SDK and UI optimizations
* d97c426 - Admin, 9 weeks ago : feat: stabilize 10-point thermal monitoring and high-contrast overlay
* 2e9aa89 - Admin, 9 weeks ago : feat: stabilize thermal relay, optimize dashboard UI, and fix alert history limits
* 58448a1 - Admin, 9 weeks ago : Fix syntax errors and optimize AI Analytics UI layout
* 12f7ce2 - Admin, 9 weeks ago : feat: optimize AI thermal UI, fix flickering, and add background AI polling
* 2414829 - Admin, 10 weeks ago : feat: complete AI thermal pipeline with detailed UI and forecast timestamps
* 640cea8 - Admin, 10 weeks ago : feat: integrate AI thermal pipeline with 5-minute cycle and 8080/5056 dual push
* b91fc7a - Admin, 10 weeks ago : docs: add license system test guide and troubleshooting
* 4fc1063 - Admin, 10 weeks ago : feat: implement license key system + web deployment setup
* 4e454f0 - Admin, 3 months ago : feature_update
* 86fdf11 - metorkhai, 3 months ago : feat: tích hợp camera alerts vào dashboard + alertshistory (Phase 4)
* d22cea9 - metorkhai, 3 months ago : feat: add video recording + image capture from camera stream
* dcf7a51 - metorkhai, 3 months ago : test: fetch REAL images from camera stream (not fake)
* d36cc7a - metorkhai, 3 months ago : test: add full test with realistic image + video capture
* 71efa6c - metorkhai, 3 months ago : test: add live event test script - verify alert + image capture
* 0351c97 - metorkhai, 3 months ago : feat: add comprehensive notification test suite for auto-configuration
* 2e0ae04 - metorkhai, 3 months ago : feat: add notification test system for cameras 152 & 153
* fe50fcc - metorkhai, 3 months ago : feat: add fire/smoke detection test script for camera 153
* 7c6de38 - metorkhai, 3 months ago : docs: add quick-start guide for Ubuntu DL380 deployment
* 8ecce3a - metorkhai, 3 months ago : chore: remove deploy-jetson.sh (not needed - using Ubuntu DL380 instead)
* 3d2f076 - metorkhai, 3 months ago : docs: add SDK setup and thermal points fix documentation
* c9307eb - metorkhai, 3 months ago : docs: add complete deployment scripts guide
* 28cafb0 - metorkhai, 3 months ago : docs: complete deployment scripts for Ubuntu
* bbc31af - metorkhai, 3 months ago : feat: cross-platform SDK loading (Windows DLL + Linux SO)
* bcc5b72 - metorkhai, 3 months ago : docs: add comprehensive deployment guide for Ubuntu server
* 0e57061 - metorkhai, 3 months ago : feat: ubuntu deployment, stream overlay fix, alerts UI cleanup
* 9af5647 - metorkhai, 3 months ago : v11
* 52dba66 - metorkhai, 3 months ago : version 1
* 5f8647c - metorkhai, 3 months ago : deloy
* 58abd51 - metorkhai, 3 months ago : feat: initialize project and exclude large binaries
* d903d66 - metorkhai, 3 months ago : ad
* 83206b3 - metorkhai, 3 months ago : thay doi co mobile app cloudlare
* 55ff4cf - metorkhai, 3 months ago : deloy: cài docker cho jetson linux
* c60a27b - metorkhai, 3 months ago : feat: cải tiến giao diện Nhật ký hệ thống và triển khai các Worker giao thức (Phase 11)
* 3aa7702 - metorkhai, 3 months ago : làm xong phase 4
* 13b41d1 - metorkhai, 3 months ago : docs: cập nhật README, setup-env và start.bat hoàn chỉnh
* a75ed62 - metorkhai, 3 months ago : them các md
* 350572c - metorkhai, 3 months ago : feat: hoàn thiện quy trình setup-env tự động và fix start.bat
* d192551 - metorkhai, 3 months ago : them script de tu dong chay cai cài đặt
* 478be04 - metorkhai, 3 months ago : feat: hoàn thiện giao diện Login, cập nhật docs và sửa lỗi start.bat
* 96198bf - metorkhai, 3 months ago : chore: init monorepo - merge frontend + backend

### 2. Cấu trúc thư mục nguồn của dự án
Tổ chức mã nguồn phân tách rõ ràng giữa Frontend Electron và Backend ASP.NET Core:
```text
Master-Station/
├── backend/                             # MÃ NGUỒN BACKEND SERVICE (.NET 8)
│   ├── StationOS.Api/                   # Lớp API Controllers
│   ├── StationOS.Data/                  # Lớp truy xuất cơ sở dữ liệu Entity Framework Core
│   ├── StationOS.Services/              # Xử lý logic nghiệp vụ (AuthService, LicenseService)
│   ├── StationOS.Workers/               # Tiến trình đồng bộ dữ liệu trạm con & SignalRHub
│   └── StationOS.Tests/                 # Bộ kiểm thử tích hợp tự động (Integration Tests)
├── frontend/                            # MÃ NGUỒN FRONTEND CLIENT (React + Vite + Electron)
│   ├── electron/                        # Trình điều khiển desktop Electron
│   │   ├── main.cjs                     # Khởi chạy PostgreSQL, Web Server & API Service
│   │   └── installer.nsh                # Cấu hình cài VC++ Redistributable khi setup app
│   ├── src/                             # Mã nguồn giao diện React
│   │   ├── components/                  # Các component UI tái sử dụng
│   │   ├── pages/                       # Trang màn hình chính (MultisitePage, LicensePage)
│   │   ├── services/                    # Quản lý kết nối API HTTP & Hub SignalR
│   │   └── types/                       # Định nghĩa kiểu dữ liệu tĩnh (api.types.ts)
│   ├── package.json                     # Quản lý thư viện và scripts đóng gói
│   └── electron-builder.yml             # Cấu hình tham số compiler đóng gói installer
└── build-thick-client.sh                # Script tự động hóa dọn dẹp và compile
```

---

## IV. CÔNG ĐOẠN KIỂM THỬ & SỬA LỖI (TESTING)

### 1. Kế hoạch kiểm thử (Test Plan)
* **Mục tiêu**: Đảm bảo toàn bộ các thành phần (Database PostgreSQL Portable, API .NET 8, go2rtc, Electron client) liên kết đúng thiết kế, bảo mật, và có thể vận hành ổn định lâu dài.
* **Phương pháp**:
  * Tự động hóa kiểm thử: Viết kịch bản kiểm thử E2E (End-to-End) chạy bằng Playwright kiểm thử đăng nhập, hiển thị UI và điều hướng.
  * Kiểm thử thủ công: Mô phỏng trường hợp chạy ứng dụng song song với Trạm con trên một máy vật lý để giám sát mức độ ảnh hưởng dịch vụ chéo.

### 2. Danh sách ca kiểm thử chi tiết (Test Cases)

| STT | Mã TC | Tên ca kiểm thử | Điều kiện chuẩn bị | Các bước thực hiện | Kết quả kỳ vọng | Trạng thái thực tế |
|---|---|---|---|---|---|---|
| 1 | **TC-001** | Khởi tạo CSDL Master độc lập | Máy chủ chưa cài đặt ứng dụng. | Chạy bộ cài Master Station v3.0.13. | Tạo thành công DB PostgreSQL tại thư mục riêng biệt `%APPDATA%/MasterStation/pg_data` chạy trên cổng `6432`. | **ĐẠT (Passed)** |
| 2 | **TC-002** | Đăng nhập quyền tối cao | Ứng dụng đã khởi chạy xong màn hình Login. | Nhập tài khoản `multi` / mật khẩu `Demo@2024`. | Đăng nhập thành công, lưu Token JWT, điều hướng trực tiếp vào trang `/multisite`. | **ĐẠT (Passed)** |
| 3 | **TC-003** | Hiển thị trạm con trên bản đồ GIS | Dữ liệu trạm con đã được liên kết trong DB. | Xem trang chủ bản đồ. | Trạm hiển thị đúng tọa độ địa lý trên bản đồ số GIS, màu sắc thay đổi động theo tín hiệu ping kết nối thực tế. | **ĐẠT (Passed)** |
| 4 | **TC-004** | Tách biệt cổng mạng và tiến trình | Trạm con (Power-Monitor) đang chạy cổng 5000, 4173, 5432. | Khởi động Master Station v3.0.13. | Khởi động thành công, chạy độc lập trên các cổng 6000, 6173, 6432 mà không làm sập dịch vụ của Trạm con. | **ĐẠT (Passed)** |
| 5 | **TC-005** | Truyền tải luồng Video camera nhiệt | Camera nhiệt của trạm con đã trực tuyến. | Bấm chọn xem camera nhiệt trên màn hình Live Wall. | Luồng RTSP chuyển hóa thành công sang WebRTC thông qua cổng `1984` và hiển thị mượt mà với độ trễ < 500ms. | **ĐẠT (Passed)** |
| 6 | **TC-006** | Nhận cảnh báo đa trạm thời gian thực | Thiết bị trạm con phát sinh cảnh báo quá nhiệt. | Kích hoạt sự cố giả lập từ trạm con gửi về trung tâm. | Cảnh báo đẩy ngay lên Client qua SignalR, nhấp nháy đỏ biểu tượng trạm trên bản đồ, phát âm thanh báo động. | **ĐẠT (Passed)** |
| 7 | **TC-007** | Bản đồ GIS không bị xám | Đang ở trang bản đồ GIS. | Click chuyển sang trang Bản quyền rồi click quay lại Dashboard. | Bản đồ GIS được tự động tính toán lại kích thước và hiển thị 100% diện tích màn hình, không bị lỗi xám. | **ĐẠT (Passed)** |
| 8 | **TC-008** | Khôi phục chính xác Tab điều hướng | Đang mở tab danh sách người dùng `/multisite?tab=users`. | Click "Bản quyền" sang trang `/license`, sau đó bấm nút Back (←) ở trang license. | Hệ thống sử dụng `sessionStorage` khôi phục chính xác địa chỉ và tab `/multisite?tab=users`. | **ĐẠT (Passed)** |
| 9 | **TC-009** | Nhập hạn ngạch bản quyền | File license `.lic` chứa hạn ngạch (50 camera). | Bấm nút Nhập license và chọn tệp tin `.lic` hợp lệ. | Giải mã tệp tin thành công, cập nhật hạn ngạch giám sát camera tương ứng lên màn hình thông số bản quyền. | **ĐẠT (Passed)** |
| 10| **TC-010** | Dọn dẹp tài nguyên khi thoát | Ứng dụng đang chạy bình thường. | Click nút Close (X) để tắt Master Station. | Các tiến trình `StationOS.Api.exe` và `postgres.exe` (cổng 6432) tắt hoàn toàn, các tiến trình của trạm con vẫn hoạt động bình thường. | **ĐẠT (Passed)** |

### 3. Báo cáo sửa lỗi chi tiết (Bug Report & Fix Log)
Dưới đây là danh sách các lỗi lớn đã được phát hiện và khắc phục triệt để trong các chu kỳ nâng cấp phiên bản gần đây:

1. **Lỗi `BUG-MS-001` (Leaflet Map Size Glitch / Grey Tiles - c2bc5c7):**
   * *Mô tả lỗi*: Khi di chuyển từ màn hình quản lý license quay về trang chủ bản đồ GIS, bản đồ thường bị lỗi chỉ hiển thị một góc nhỏ 400x300 pixel, phần còn lại bị xám trắng do Leaflet tính toán kích thước container map khi CSS transition chưa kết thúc.
   * *Khắc phục*: Tối ưu hóa hàm `MultisitePage.tsx`, bổ sung gọi invalidation size ở nhiều mốc trễ (100ms, 500ms, 1000ms, 2000ms) để ép bản đồ vẽ lại đầy đủ kích thước container sau khi DOM ổn định.

2. **Lỗi `BUG-MS-002` (Xung đột tiến trình nền chạy Windows - 3316095):**
   * *Mô tả lỗi*: Electron main process sử dụng lệnh `taskkill /F /IM postgres.exe` gây tắt chéo PostgreSQL của Trạm con đang vận hành song song trên cùng một hệ điều hành.
   * *Khắc phục*: Cải tiến file `main.cjs` để theo dõi và chỉ tắt các PID được sinh ra bởi chính Master Station, lưu tại tệp tin `pids.json` và tệp tin `postmaster.pid`.

3. **Lỗi `BUG-MS-003` (Trùng lặp Tracking Entity Framework Core - 3abe468):**
   * *Mô tả lỗi*: Khi trạm con đẩy dữ liệu điểm đo và cảnh báo trùng lặp lên trong cùng một lô (Batch Ingest), Entity Framework Core báo lỗi conflict tracking do hai thực thể cùng ID được tải vào DbContext.
   * *Khắc phục*: Chuyển đổi truy vấn đồng bộ sang sử dụng `AsNoTracking()` kết hợp kiểm tra thủ công sự tồn tại trong bộ nhớ cache trước khi lưu trữ vào CSDL.

4. **Lỗi `BUG-MS-004` (Bị kẹt cache danh sách thiết bị khi Refresh - 601def2):**
   * *Mô tả lỗi*: Người dùng nhấn F5 tải lại trang nhưng hệ thống vẫn hiển thị dữ liệu kết nối cũ do Client đọc từ cache `sessionStorage` mà không gọi trực tiếp API.
   * *Khắc phục*: Điều chỉnh cơ chế fetch dữ liệu để bỏ qua cache (bypass cache) khi nhận sự kiện reload trang hoặc refresh thủ công.

5. **Lỗi `BUG-MS-005` (Lỗi so khớp mã Tỉnh thành khi tạo trạm con - fbf951d):**
   * *Mô tả lỗi*: Khi tạo trạm con mới, hệ thống báo lỗi không tìm thấy Tỉnh thành mặc dù đã tồn tại mã tỉnh. Nguyên nhân do phân biệt chữ hoa/chữ thường trong cơ chế tìm kiếm DB.
   * *Khắc phục*: Chuyển đổi truy vấn so khớp mã tỉnh sang dạng `ToLower()` và bổ sung logic tự động tạo tỉnh mặc định nếu cơ sở dữ liệu trống.

6. **Lỗi `BUG-MS-006` (Đơ màn hình Splash loadscreen lúc khởi động - e822ce7):**
   * *Mô tả lỗi*: Ứng dụng Master Station bị treo không hiển thị màn hình chính sau khi đăng nhập do tiến trình API backend khởi chạy chậm hơn Electron client.
   * *Khắc phục*: Bổ sung logic kiểm tra kết nối API cổng 6000 định kỳ (Healthcheck Loop) trong `main.cjs`, chỉ cho phép Electron mở cửa sổ chính khi API Backend phản hồi thành công `200 OK`.

7. **Lỗi `BUG-MS-007` (Lỗi rò rỉ bộ nhớ luồng camera go2rtc - 9494e5c):**
   * *Mô tả lỗi*: Thư viện go2rtc giải mã camera WebRTC liên tục chiếm dụng CPU do không giải phóng cổng khi tắt màn hình Live Wall.
   * *Khắc phục*: Đăng ký hook huỷ luồng trong React components `useEffect` return và cập nhật lại cấu hình tự động ngắt luồng không có người xem (idle timeout = 30s) trong go2rtc.

---

## V. CÔNG ĐOẠN BÀN GIAO & HƯỚNG DẪN SỬ DỤNG

### 1. Hướng dẫn cài đặt
1. Tải về tệp cài đặt chính thức: **`Master Station Setup 3.0.13.exe`** (Dung lượng tối ưu: 222 MB).
2. Chạy file cài đặt, bấm chọn **Install** (NSIS script tích hợp sẵn sẽ tự động cài đặt ngầm gói Visual C++ Redistributable x64 và khởi tạo môi trường PostgreSQL Portable trên cổng `6432`).
3. Đợi quá trình cài đặt kết thúc, biểu tượng lối tắt **Master Station** sẽ xuất hiện trên màn hình Desktop.

### 2. Cấu hình vận hành ban đầu
* **Đăng nhập hệ thống**:
  * Tài khoản mặc định: `multi`
  * Mật khẩu mặc định: `Demo@2024` (Yêu cầu đổi mật khẩu sau khi đăng nhập lần đầu tiên để đảm bảo bảo mật).
* **Kết nối Trạm con**:
  * Truy cập danh sách trạm, bấm **Thêm trạm**.
  * Nhập tên trạm, mã trạm và đường dẫn API trạm con (Ví dụ: `http://192.168.1.105:5000`).
  * Hệ thống trung tâm sẽ tự động kết nối và đồng bộ hóa danh sách thiết bị, camera an ninh và cảm biến đo đạc từ trạm con về màn hình giám sát trung tâm.

---
**Đại diện Đội ngũ Phát triển Phần mềm**  
*(Đã ký duyệt và đóng dấu lưu hồ sơ)*  
**StationOS Technical & Compliance Team**
