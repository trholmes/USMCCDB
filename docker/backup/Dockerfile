FROM postgres:16-alpine

COPY entrypoint.sh backup.sh restore.sh /
RUN chmod +x /entrypoint.sh /backup.sh /restore.sh

ENTRYPOINT ["/entrypoint.sh"]
