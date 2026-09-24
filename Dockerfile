FROM nginx:alpine

# 复制网站文件
COPY . /usr/share/nginx/html

# 复制nginx配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露80端口
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
