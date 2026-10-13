#!/usr/bin/env python3
"""STUDIO 摄影站 · 作品图上传服务（服务端永久保存）

链路：浏览器 → 宿主 nginx /upload-api/ → 本服务(127.0.0.1:8791) → 本地目录
存储：STORAGE_DIR/YYYY/MM/<epoch_ms>-<净化后原名>.<ext>
      该目录已只读挂载进 nginx 容器，落盘即可通过 /media/uploads/... 公开访问。
索引：**不建 index.json**——文件系统就是唯一事实源，不会与磁盘脱节。
      文件名以 epoch 毫秒开头，字典序即时间序；原始文件名保留在后半段可读。

上传走「裸 body」而非 multipart：Python 3.13+ 已移除 cgi 模块，自己解析 multipart
纯属自找麻烦；而每文件一个请求天然带来逐文件进度与逐文件错误提示。

安全边界（全部为不可信输入）：
  · 类型只认魔数，不信扩展名与客户端 Content-Type；显式排除 SVG（XSS 载体）
  · 大小既看 Content-Length 提前拒，也在流式读取时硬截断（不信任头部）
  · 文件名净化 + 落盘路径完全由服务端拼装，杜绝路径穿越
  · 先写 .part 临时文件再 os.replace 原子改名，绝不暴露半成品
  · 令牌用 hmac.compare_digest 常量时间比较
"""
import hashlib
import hmac
import json
import os
import re
import shutil
import struct
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

C = {
    "HOST": os.environ.get("HOST", "127.0.0.1"),
    "PORT": int(os.environ.get("PORT", "8791")),
    "STORAGE": os.environ.get("STORAGE_DIR", "/home/jzy/studio-portfolio-docker/media/uploads"),
    "PUBLIC_PREFIX": os.environ.get("PUBLIC_PREFIX", "/media/uploads").rstrip("/"),
    "TOKEN_FILE": os.environ.get("TOKEN_FILE", "/etc/studio-upload/token"),
    "MAX_BYTES": int(os.environ.get("MAX_BYTES", str(15 * 1024 * 1024))),
    "MIN_FREE_BYTES": int(os.environ.get("MIN_FREE_BYTES", str(1024 ** 3))),
    "RATE_PER_MIN": int(os.environ.get("RATE_PER_MIN", "30")),
    "NAME_MAX": int(os.environ.get("NAME_MAX", "80")),
}

# 错误码 → HTTP 状态 + 面向用户的中文提示
ERR = {
    "UNAUTHORIZED":          (401, "上传令牌缺失或无效"),
    "TOO_LARGE":             (413, "图片超过 15MB 上限"),
    "UNSUPPORTED":           (415, "只支持 jpg / png / gif / webp 四种格式"),
    "BAD_REQUEST":           (400, "请求无效"),
    "EMPTY":                 (400, "图片是空文件"),
    "NOT_FOUND":             (404, "图片不存在或已被删除"),
    "TOO_MANY_REQUESTS":     (429, "上传过于频繁，请稍后再试"),
    "INSUFFICIENT_STORAGE":  (507, "服务器磁盘空间不足，请联系站长"),
    "INTERNAL":              (500, "服务器内部错误，请稍后重试"),
}


# ---------------------------------------------------------------- 图片尺寸解析
def _jpeg_size(d):
    i, n = 2, len(d)
    while i + 9 < n:
        if d[i] != 0xFF:
            i += 1
            continue
        m = d[i + 1]
        if m == 0xFF:
            i += 1
            continue
        if m == 0xD8 or m == 0x01 or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        if m == 0xD9:
            return None
        seg = struct.unpack(">H", d[i + 2:i + 4])[0]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", d[i + 5:i + 9])
            return (w, h) if w and h else None
        i += 2 + seg
    return None


def _webp_size(d):
    fmt = d[12:16]
    try:
        if fmt == b"VP8 ":
            w, h = struct.unpack("<HH", d[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if fmt == b"VP8L":
            b0, b1, b2, b3 = d[21], d[22], d[23], d[24]
            return (1 + (((b1 & 0x3F) << 8) | b0),
                    1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)))
        if fmt == b"VP8X":
            return (1 + (d[24] | (d[25] << 8) | (d[26] << 16)),
                    1 + (d[27] | (d[28] << 8) | (d[29] << 16)))
    except (struct.error, IndexError):
        return None
    return None


def sniff(d):
    """按魔数判定真实类型；返回 (mime, ext) 或 (None, None)。"""
    if d[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if d[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if d[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif", "gif"
    if d[:4] == b"RIFF" and d[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None, None


def image_size(mime, d):
    try:
        if mime == "image/jpeg":
            return _jpeg_size(d)
        if mime == "image/png":
            return struct.unpack(">II", d[16:24])
        if mime == "image/gif":
            return struct.unpack("<HH", d[6:10])
        if mime == "image/webp":
            return _webp_size(d)
    except (struct.error, IndexError):
        return None
    return None


# ---------------------------------------------------------------- 文件名与路径
def safe_basename(raw):
    """净化客户端文件名：去路径、去控制字符、空白折叠为 -、限长。"""
    base = os.path.basename((raw or "").replace("\\", "/")).strip()
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    base = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "-", base, flags=re.UNICODE)
    # 去掉客户端自带的扩展名：真实类型由魔数判定，扩展名由服务端统一追加，
    # 否则会存出 photo.jpg.jpg 这种双扩展名
    base = re.sub(r"\.(jpe?g|png|gif|webp|bmp|tiff?)$", "", base, flags=re.I)
    base = re.sub(r"^[.\-]+|[.\-]+$", "", base).strip(".")
    base = re.sub(r"-{2,}", "-", base)
    if len(base) > C["NAME_MAX"]:
        base = base[:C["NAME_MAX"]]
    return base or "upload"


def unique_path(day_dir, ts, base, ext):
    """同名同毫秒时追加序号，绝不覆盖既有文件。"""
    for i in range(1, 100):
        name = "%d-%s.%s" % (ts, base, ext) if i == 1 else "%d-%s-%d.%s" % (ts, base, i, ext)
        p = os.path.join(day_dir, name)
        if not os.path.exists(p):
            return p, name
    raise OSError("too many name collisions")


def resolve_rel(rel):
    """把客户端给的相对路径安全解析成绝对路径；越界/穿越一律 None。"""
    rel = (rel or "").strip().lstrip("/")
    if not rel or ".." in rel.replace("\\", "/").split("/"):
        return None
    root = os.path.realpath(C["STORAGE"])
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    return full, os.path.relpath(full, root).replace(os.sep, "/")


# ---------------------------------------------------------------- 索引（读磁盘）
_dim_cache = {}
_dim_lock = threading.Lock()


def dimensions(path, mime, size, mtime):
    key = (path, size, int(mtime))
    with _dim_lock:
        if key in _dim_cache:
            return _dim_cache[key]
        if len(_dim_cache) > 4096:
            _dim_cache.clear()
    wh = None
    try:
        with open(path, "rb") as f:
            wh = image_size(mime, f.read(1 << 20))
    except OSError:
        pass
    with _dim_lock:
        _dim_cache[key] = wh
    return wh


def rel_from_name(name):
    """从存储文件名 <epoch_ms>-<展示名> 还原时间戳与展示名。"""
    m = re.match(r"^(\d{10,})-(.+)$", name)
    if m:
        return int(m.group(1)), m.group(2)
    return None, name
    return int(os.path.getmtime(name) * 1000), stem


def list_items(sort="time", order="desc", limit=500):
    root = os.path.realpath(C["STORAGE"])
    items = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if fn.startswith(".part-") or fn.startswith("."):
                continue
            full = os.path.join(dirpath, fn)
            try:
                st = os.stat(full)
            except OSError:
                continue
            try:
                with open(full, "rb") as fh:
                    head = fh.read(16)
            except OSError:
                continue
            mime, _ext = sniff(head)
            if not mime:
                continue
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            ts, disp = rel_from_name(fn)
            if ts is None:
                ts = int(st.st_mtime * 1000)
            wh = dimensions(full, mime, st.st_size, st.st_mtime)
            items.append({
                "id": rel,
                "name": disp,
                "url": C["PUBLIC_PREFIX"] + "/" + rel,
                "rel": rel,
                "size": st.st_size,
                "mime": mime,
                "width": wh[0] if wh else None,
                "height": wh[1] if wh else None,
                "ts": ts,
                "uploadedAt": datetime.fromtimestamp(ts / 1000, timezone.utc).astimezone().isoformat(timespec="seconds"),
            })
    if sort == "name":
        items.sort(key=lambda x: x["name"].lower(), reverse=(order == "desc"))
    else:
        items.sort(key=lambda x: (x["ts"], x["name"]), reverse=(order == "desc"))
    return items[:limit]


# ---------------------------------------------------------------- 限流
_hits = {}
_hits_lock = threading.Lock()


def rate_ok(ip):
    now = time.time()
    with _hits_lock:
        w = [t for t in _hits.get(ip, []) if now - t < 60]
        if len(w) >= C["RATE_PER_MIN"]:
            _hits[ip] = w
            return False
        w.append(now)
        _hits[ip] = w
        if len(_hits) > 4096:
            for k in list(_hits):
                _hits[k] = [t for t in _hits[k] if now - t < 60]
                if not _hits[k]:
                    del _hits[k]
        return True


def load_token():
    try:
        with open(C["TOKEN_FILE"], "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


# ---------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    server_version = "studio-upload"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        pass

    def _send(self, code, obj, ctype="application/json; charset=utf-8"):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, key, extra=None):
        code, msg = ERR[key]
        e = {"code": key, "message": msg}
        if extra:
            e["detail"] = extra
        self._send(code, {"ok": False, "error": e})

    def _path(self):
        """http.server 按 latin-1 解码请求行；把字节还原后按 UTF-8 重解，
        这样客户端即使没做百分号编码、直接在 URL 里写中文也不会乱码。
        （浏览器用 encodeURIComponent 时是 %XX，parse_qs 已按 UTF-8 解，此处不受影响）"""
        try:
            return self.path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return self.path

    def _client_ip(self):
        xff = self.headers.get("X-Forwarded-For", "")
        return (xff.split(",")[0].strip() if xff else self.client_address[0]) or "unknown"

    def _authed(self):
        tok = load_token()
        if not tok:
            self._err("INTERNAL", "服务端未配置上传令牌")
            return False
        h = self.headers.get("Authorization", "")
        got = h[7:].strip() if h[:7].lower() == "bearer " else ""
        if not got or not hmac.compare_digest(got, tok):
            self._err("UNAUTHORIZED")
            return False
        return True

    # ---- GET ----
    def do_GET(self):
        u = urlparse(self._path())
        q = parse_qs(u.query)
        path = u.path.rstrip("/") or "/"
        try:
            if path in ("/health", "/"):
                return self._send(200, {"ok": True, "service": "studio-upload",
                                        "maxBytes": C["MAX_BYTES"],
                                        "accept": ["jpg", "png", "gif", "webp"]})
            if path == "/list":
                sort = "name" if q.get("sort", ["time"])[0] == "name" else "time"
                order = "asc" if q.get("order", ["desc"])[0] == "asc" else "desc"
                try:
                    limit = max(1, min(1000, int(q.get("limit", ["500"])[0])))
                except ValueError:
                    limit = 500
                items = list_items(sort, order, limit)
                return self._send(200, {"ok": True, "sort": sort, "order": order,
                                        "total": len(items), "items": items})
            return self._err("NOT_FOUND")
        except Exception as ex:
            return self._err("INTERNAL", type(ex).__name__)

    def do_HEAD(self):
        """HEAD 只发头不发体（健康检查用）。"""
        u = urlparse(self._path())
        if (u.path.rstrip("/") or "/") in ("/health", "/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    # ---- DELETE ----
    def do_DELETE(self):
        u = urlparse(self._path())
        if u.path.rstrip("/") != "/item":
            return self._err("NOT_FOUND")
        if not self._authed():
            return
        if not rate_ok(self._client_ip()):
            return self._err("TOO_MANY_REQUESTS")
        rel = parse_qs(u.query).get("id", [""])[0]
        got = resolve_rel(rel)
        if not got:
            return self._err("NOT_FOUND")
        full, canon = got
        try:
            os.remove(full)
            d = os.path.dirname(full)
            while d != os.path.realpath(C["STORAGE"]) and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
        except OSError as ex:
            return self._err("INTERNAL", ex.strerror)
        return self._send(200, {"ok": True, "deleted": canon})

    # ---- POST /upload ----
    def do_POST(self):
        u = urlparse(self._path())
        if u.path.rstrip("/") != "/upload":
            return self._err("NOT_FOUND")
        if not self._authed():
            return self._drain()
        if not rate_ok(self._client_ip()):
            return self._err("TOO_MANY_REQUESTS")

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self._err("EMPTY")
            return self._drain()
        if length > C["MAX_BYTES"]:
            self._err("TOO_LARGE", "声明 %d 字节，上限 %d" % (length, C["MAX_BYTES"]))
            return self._drain()

        # 边读边计数：不信任 Content-Length，超限立刻中止
        cap = C["MAX_BYTES"]
        chunks, got = [], 0
        try:
            while got < length:
                b = self.rfile.read(min(65536, length - got))
                if not b:
                    break
                got += len(b)
                if got > cap:
                    self._err("TOO_LARGE")
                    return self._drain()
                chunks.append(b)
        except OSError:
            return self._err("BAD_REQUEST", "读取请求体失败")
        data = b"".join(chunks)
        if not data:
            self._err("EMPTY")
            return self._drain()

        mime, ext = sniff(data[:16])
        if not mime:
            self._err("UNSUPPORTED", "无法识别的图片格式（只按文件内容判定，不看扩展名）")
            return

        free = shutil.disk_usage(C["STORAGE"]).free
        if free - len(data) < C["MIN_FREE_BYTES"]:
            self._err("INSUFFICIENT_STORAGE", "剩余空间不足 1GB")
            return

        q = parse_qs(u.query)
        now = datetime.now().astimezone()
        day_dir = os.path.join(C["STORAGE"], "%04d" % now.year, "%02d" % now.month)
        try:
            os.makedirs(day_dir, exist_ok=True)
            base = safe_basename(q.get("name", [""])[0])
            ts = int(now.timestamp() * 1000)
            final, name = unique_path(day_dir, ts, base, ext)
            display = name[len(str(ts)) + 1:]   # 去掉 "<ts>-" 前缀，与 /list 返回一致
            tmp = os.path.join(day_dir, ".part-%d-%s" % (ts, hashlib.sha1(data).hexdigest()[:8]))
            with open(tmp, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, final)
        except OSError as ex:
            try:
                os.remove(tmp)
            except (OSError, UnboundLocalError):
                pass
            return self._err("INTERNAL", ex.strerror)

        rel = os.path.relpath(final, os.path.realpath(C["STORAGE"])).replace(os.sep, "/")
        wh = image_size(mime, data)
        item = {
            "id": rel, "name": display, "url": C["PUBLIC_PREFIX"] + "/" + rel, "rel": rel,
            "size": len(data), "mime": mime,
            "width": wh[0] if wh else None, "height": wh[1] if wh else None,
            "ts": ts, "uploadedAt": now.isoformat(timespec="seconds"),
        }
        return self._send(201, {"ok": True, "item": item})

    def _drain(self):
        """把未读完的请求体丢弃，避免连接被复用时错位。"""
        try:
            n = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            n = 0
        while n > 0:
            b = self.rfile.read(min(65536, n))
            if not b:
                break
            n -= len(b)


def main():
    os.makedirs(C["STORAGE"], exist_ok=True)
    if not load_token():
        print("WARN: 令牌文件 %s 不可读，所有写操作将返回 500" % C["TOKEN_FILE"], file=sys.stderr)
    srv = ThreadingHTTPServer((C["HOST"], C["PORT"]), H)
    srv.daemon_threads = True
    print("studio-upload listening on %s:%d -> %s" % (C["HOST"], C["PORT"], C["STORAGE"]), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
