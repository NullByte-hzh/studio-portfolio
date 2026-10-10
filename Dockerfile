FROM nginx:alpine

# 只把站点运行需要的文件放进镜像。
# 旧版用 `COPY .`，把 .git / deploy / docs / README 一起打进了 web 根目录，
# 导致 /.git/config、/.git/packed-refs、/deploy/chat/chat-proxy.py 等可被公网直接下载。
WORKDIR /usr/share/nginx/html
COPY index.html manifest.json service-worker.js .
COPY icon-192.svg logo.svg favicon-32.png apple-touch-icon.png icon-192.png icon-512.png icon-512-maskable.png ./
COPY admin/ ./admin/

# 构建期预压缩，配合 nginx `gzip_static on` 实现零 CPU 开销的压缩响应
RUN for f in index.html manifest.json service-worker.js icon-192.svg logo.svg admin/index.html admin/config.yml; do \
      [ -f "$f" ] && gzip -9 -c "$f" > "$f.gz" || true; \
    done; \
    echo "--- precompressed ---"; ls -l *.gz admin/*.gz 2>/dev/null || true

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
