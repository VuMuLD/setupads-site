import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Chính sách bảo mật | setupads.site",
  description:
    "Chính sách quyền riêng tư của setupads.site — Facebook Ads, Messenger, AI tư vấn.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 prose prose-slate max-w-none">
      <h1>Chính sách bảo mật</h1>
      <p className="lead text-muted-foreground">
        Cập nhật lần cuối: 8 tháng 3, 2026 · Website:{" "}
        <a href="https://setupads.site">https://setupads.site</a>
      </p>

      <p>
        <strong>setupads.site</strong> (FB Ads Manager + AI Optimizer) là ứng dụng web giúp chủ tài
        khoản quảng cáo Facebook và quản trị viên Facebook Page quản lý chiến dịch quảng cáo,
        nhận đề xuất tối ưu từ trí tuệ nhân tạo (AI), và xử lý tin nhắn Messenger của Page. Chính
        sách này mô tả dữ liệu chúng tôi thu thập, cách sử dụng, lưu trữ và quyền của bạn.
      </p>

      <h2>1. Chủ thể và phạm vi</h2>
      <p>
        Ứng dụng được vận hành tại <strong>setupads.site</strong>. Chúng tôi chỉ xử lý dữ liệu khi
        bạn tự đăng ký, đăng nhập, hoặc chủ động kết nối tài khoản Facebook / Facebook Ads / Facebook
        Page. Chúng tôi <strong>không</strong> thu thập mật khẩu Facebook của bạn.
      </p>

      <h2>2. Dữ liệu chúng tôi thu thập</h2>

      <h3>2.1. Tài khoản setupads.site</h3>
      <ul>
        <li>Họ tên, email và mật khẩu (đã mã hóa) khi bạn đăng ký bằng email</li>
        <li>Thông tin đăng nhập qua Facebook: ID Facebook, tên hiển thị, ảnh đại diện, email (nếu bạn cho phép)</li>
        <li>Nhật ký phiên đăng nhập và hoạt động trong ứng dụng (audit log nội bộ)</li>
      </ul>

      <h3>2.2. Facebook Ads (Marketing API)</h3>
      <p>Khi bạn bấm <strong>Kết nối Facebook</strong> trong mục Cài đặt và cấp quyền, chúng tôi có thể thu thập:</p>
      <ul>
        <li>Token truy cập Facebook (mã hóa khi lưu trữ)</li>
        <li>Danh sách tài khoản quảng cáo (Ad Accounts) bạn quản lý</li>
        <li>Chiến dịch (campaigns), nhóm quảng cáo (ad sets), quảng cáo (ads) và trạng thái của chúng</li>
        <li>Chỉ số hiệu suất: chi tiêu, lượt hiển thị, click, chuyển đổi, ROAS, CTR, CPC, CPM, v.v.</li>
        <li>Thông tin cấu hình quảng cáo (mục tiêu, ngân sách, creative công khai từ API)</li>
      </ul>

      <h3>2.3. Facebook Page & Messenger</h3>
      <p>Khi bạn đồng bộ tin nhắn Page, chúng tôi có thể thu thập:</p>
      <ul>
        <li>Danh sách Facebook Page bạn quản lý (tên Page, ID Page)</li>
        <li>Token truy cập cấp Page (mã hóa khi lưu trữ)</li>
        <li>Hội thoại Messenger: ID hội thoại, tên người tham gia, nội dung tin nhắn, thời gian gửi</li>
        <li>Tệp đính kèm (metadata từ API Facebook, nếu có)</li>
        <li>Gợi ý trả lời do AI tạo và lịch sử bạn chọn sao chép hoặc gửi</li>
      </ul>

      <h3>2.4. Sản phẩm do bạn nhập</h3>
      <p>
        Trong mục quản lý sản phẩm theo từng Page, bạn có thể lưu tên sản phẩm, mô tả, giá, ảnh
        sản phẩm. Dữ liệu này do bạn tự nhập để AI tư vấn khách hàng chính xác hơn — không lấy từ
        Facebook Catalog trừ khi bạn tự kết nối trong tương lai.
      </p>

      <h3>2.5. Dữ liệu AI</h3>
      <ul>
        <li>Câu hỏi bạn gửi tới AI Advisor và phản hồi AI</li>
        <li>Bối cảnh phân tích (snapshot metrics campaign/ad đã đồng bộ)</li>
        <li>Đề xuất tối ưu quảng cáo (loại, độ tin cậy, lý do, hành động đề xuất)</li>
      </ul>

      <h2>3. Quyền Facebook (Permissions) và mục đích sử dụng</h2>
      <p>Chúng tôi chỉ yêu cầu các quyền cần thiết cho tính năng ứng dụng:</p>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Quyền</th>
            <th className="text-left">Mục đích</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>public_profile</code></td>
            <td>Đăng nhập Facebook, hiển thị tên/ảnh trong dashboard</td>
          </tr>
          <tr>
            <td><code>email</code></td>
            <td>Nhận diện tài khoản khi đăng nhập Facebook (nếu bạn chia sẻ)</td>
          </tr>
          <tr>
            <td><code>business_management</code></td>
            <td>Liệt kê Ad Account bạn quản lý để chọn đồng bộ</td>
          </tr>
          <tr>
            <td><code>ads_read</code></td>
            <td>Đọc campaign, ad set, ad và báo cáo hiệu suất</td>
          </tr>
          <tr>
            <td><code>ads_management</code></td>
            <td>Thay đổi trạng thái/ngân sách khi <strong>bạn bấm Áp dụng</strong> đề xuất AI</td>
          </tr>
          <tr>
            <td><code>pages_show_list</code></td>
            <td>Hiển thị Page bạn quản lý</td>
          </tr>
          <tr>
            <td><code>pages_read_engagement</code></td>
            <td>Hỗ trợ tính năng Page liên quan inbox và quản lý Page</td>
          </tr>
          <tr>
            <td><code>pages_manage_metadata</code></td>
            <td>Truy cập metadata hội thoại Messenger (đồng bộ inbox)</td>
          </tr>
          <tr>
            <td><code>pages_messaging</code></td>
            <td>Đọc tin nhắn Messenger; gửi trả lời khi <strong>bạn chủ động bấm Gửi</strong></td>
          </tr>
        </tbody>
      </table>
      <p>
        Chúng tôi <strong>không</strong> gửi tin nhắn marketing hàng loạt, không đăng bài thay bạn,
        không truy cập danh sách bạn bè, và không thay đổi quảng cáo nếu bạn không xác nhận áp dụng
        đề xuất.
      </p>

      <h2>4. Cách chúng tôi sử dụng dữ liệu</h2>
      <ul>
        <li>Hiển thị dashboard, báo cáo và chi tiết campaign/ad</li>
        <li>Đồng bộ và lưu trữ dữ liệu quảng cáo để bạn xem lịch sử</li>
        <li>Phân tích bằng AI (Gemini và/hoặc mô hình khác) để đưa ra đề xuất tối ưu</li>
        <li>Đồng bộ inbox Messenger và gợi ý câu trả lời theo sản phẩm bạn đã khai báo</li>
        <li>Gửi tin nhắn Messenger thay mặt Page <strong>chỉ khi bạn thao tác gửi</strong></li>
        <li>Bảo mật tài khoản, chống lạm dụng API, và tuân thủ pháp luật</li>
      </ul>
      <p>
        Chúng tôi <strong>không bán</strong>, cho thuê hoặc trao đổi dữ liệu cá nhân của bạn cho bên
        thứ ba vì mục đích quảng cáo của họ.
      </p>

      <h2>5. Xử lý bởi AI và bên thứ ba</h2>
      <p>
        Một phần tính năng sử dụng dịch vụ AI (ví dụ Google Gemini) để phân tích metrics và soạn gợi
        ý trả lời. Chúng tôi chỉ gửi dữ liệu cần thiết cho từng yêu cầu (metrics, tin nhắn, danh
        sách sản phẩm bạn nhập). Kết quả AI mang tính gợi ý — bạn chịu trách nhiệm kiểm tra trước
        khi áp dụng lên quảng cáo hoặc gửi cho khách hàng.
      </p>
      <p>
        Dữ liệu quảng cáo và Messenger được lấy từ <strong>Meta (Facebook)</strong> qua API chính
        thức. Việc sử dụng còn chịu{" "}
        <a
          href="https://www.facebook.com/terms.php"
          target="_blank"
          rel="noopener noreferrer"
        >
          Điều khoản Meta
        </a>{" "}
        và{" "}
        <a
          href="https://developers.facebook.com/policy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chính sách nền tảng Meta
        </a>
        .
      </p>

      <h2>6. Lưu trữ và bảo mật</h2>
      <ul>
        <li>Token Facebook được mã hóa (AES-256-GCM) trước khi lưu database</li>
        <li>Mật khẩu tài khoản email được băm, không lưu dạng văn bản thuần</li>
        <li>Dữ liệu insights cũ có thể được xóa tự động sau khoảng 90 ngày (retention nội bộ)</li>
        <li>Truy cập server và database bị giới hạn cho quản trị viên hệ thống</li>
      </ul>

      <h2>7. Thời gian lưu giữ</h2>
      <p>
        Chúng tôi lưu dữ liệu trong thời gian tài khoản của bạn còn hoạt động và cần thiết để cung
        cấp dịch vụ. Bạn có thể ngắt kết nối Facebook bất cứ lúc nào. Sau khi xóa tài khoản hoặc
        nhận yêu cầu xóa từ Facebook, chúng tôi xóa hoặc ẩn danh hóa dữ liệu liên quan trong thời
        gian hợp lý.
      </p>

      <h2>8. Quyền của bạn</h2>
      <ul>
        <li>Xem và quản lý dữ liệu quảng cáo, tin nhắn trong ứng dụng</li>
        <li>Ngắt kết nối Facebook trong <strong>Cài đặt</strong></li>
        <li>Gỡ ứng dụng trên Facebook: Cài đặt Facebook → Ứng dụng và trang web → Gỡ setupads</li>
        <li>Yêu cầu xóa dữ liệu (xem mục 9)</li>
        <li>Liên hệ chúng tôi để được hỗ trợ truy cập hoặc chỉnh sửa thông tin tài khoản</li>
      </ul>

      <h2>9. Xóa dữ liệu (Data Deletion)</h2>
      <p>Meta có thể chuyển yêu cầu xóa dữ liệu khi bạn gỡ ứng dụng. Chúng tôi hỗ trợ:</p>
      <ul>
        <li>
          <strong>Callback xóa dữ liệu Facebook:</strong>{" "}
          <code>https://setupads.site/api/facebook/data-deletion</code>
        </li>
        <li>
          <strong>Kiểm tra trạng thái:</strong>{" "}
          <code>https://setupads.site/api/facebook/data-deletion/status</code>
        </li>
        <li>Ngắt kết nối và xóa token trong mục Cài đặt trên setupads.site</li>
      </ul>
      <p>
        Sau khi xử lý, dữ liệu Facebook (token, campaign sync, tin nhắn Page) liên quan tài khoản
        của bạn sẽ được xóa hoặc vô hiệu hóa theo quy trình nội bộ.
      </p>

      <h2>10. Trẻ em</h2>
      <p>
        Dịch vụ dành cho người từ 18 tuổi trở lên (hoặc đủ tuổi quản lý tài khoản quảng cáo theo
        quy định địa phương). Chúng tôi không cố ý thu thập dữ liệu trẻ em.
      </p>

      <h2>11. Thay đổi chính sách</h2>
      <p>
        Chúng tôi có thể cập nhật chính sách này. Phiên bản mới sẽ đăng tại trang này kèm ngày cập
        nhật. Việc tiếp tục sử dụng dịch vụ sau khi cập nhật đồng nghĩa bạn chấp nhận thay đổi.
      </p>

      <h2>12. Liên hệ</h2>
      <p>
        Mọi thắc mắc về quyền riêng tư hoặc yêu cầu xóa dữ liệu, vui lòng liên hệ qua email hỗ trợ
        gắn với tài khoản quản trị setupads.site hoặc qua biểu mẫu trong ứng dụng (mục Cài đặt).
      </p>

      <hr />

      <h2>Privacy Policy (English summary for App Review)</h2>
      <p>
        <strong>setupads.site</strong> is a Facebook Ads management and Page Messenger inbox tool
        with AI suggestions. We collect: (1) account info (email/name or Facebook Login profile); (2)
        encrypted Facebook access tokens; (3) ad account, campaign, ad set, ad, and insights data via
        Marketing API; (4) Page list and Messenger conversations/messages when the user syncs inbox;
        (5) product catalog entries the user manually adds per Page; (6) AI chat and recommendation
        history. We use <code>ads_read</code> to display analytics, <code>ads_management</code> only
        when the user clicks Apply on a suggestion, and <code>pages_messaging</code> to sync inbox and
        send replies only when the user clicks Send. We do not sell user data. Tokens are encrypted
        at rest. Users can disconnect Facebook in Settings or remove the app from Facebook. Data
        deletion callback:{" "}
        <a href="https://setupads.site/api/facebook/data-deletion">
          https://setupads.site/api/facebook/data-deletion
        </a>
        . Contact: via in-app Settings / support email on file for the app operator.
      </p>

      <p className="not-prose mt-8">
        <Link href="/login" className="text-primary underline">
          ← Quay lại đăng nhập
        </Link>
      </p>
    </div>
  );
}
