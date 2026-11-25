FROM python:3.13-alpine
LABEL org.opencontainers.image.source="https://github.com/mweint/trailer-room"
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TRAILER_ROOM_BIND=0.0.0.0 TRAILER_ROOM_DATA=/data
COPY server.py catalogs.py trailer_selection.py docker_entrypoint.py ./
COPY web/ web/
EXPOSE 8765
ENTRYPOINT ["python", "docker_entrypoint.py"]
CMD ["python", "server.py"]
