#!/bin/bash
set -euo pipefail

DOCKER_COMPOSE_FILE=docker/docker-compose.yaml

function networkUp() {
  echo ">>> Starting network..."
  docker-compose -f $DOCKER_COMPOSE_FILE up -d
}

function networkDown() {
  echo ">>> Stopping network and removing volumes..."
  docker-compose -f $DOCKER_COMPOSE_FILE down
}

function networkStart() {
  echo ">>> Starting existing network containers..."
  docker-compose -f $DOCKER_COMPOSE_FILE start
}

function networkStop() {
  echo ">>> Stopping running network containers..."
  docker-compose -f $DOCKER_COMPOSE_FILE stop
}

case "${1:-}" in
  up)
    networkUp
    ;;
  down)
    networkDown
    ;;
  start)
    networkStart
    ;;
  stop)
    networkStop
    ;;
  *)
    echo "Usage: ./network.sh up|down|start|stop"
    ;;
esac
