FROM python:3.13-alpine
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TRAILER_ROOM_BIND=0.0.0.0 TRAILER_ROOM_DATA=/data
RUN mkdir /data && chown 10001:10001 /data
COPY server.py catalogs.py trailer_selection.py ./
COPY web/ web/
USER 10001:10001
EXPOSE 8765
CMD ["python", "server.py"]
