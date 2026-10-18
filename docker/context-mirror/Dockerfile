FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY certs/mirror.crt certs/mirror.key /etc/nginx/certs/
COPY www/ /srv/
