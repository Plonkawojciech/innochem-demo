FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html produkt.html checkout.html styles.css app.js /usr/share/nginx/html/
COPY img /usr/share/nginx/html/img
