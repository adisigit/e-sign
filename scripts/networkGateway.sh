#!/bin/bash
set -euo pipefail

DOCKER_COMPOSE_FILE=app/docker-node/docker-compose.yaml

function networkUp() {
  echo ">>> Starting network..."
  docker-compose -f $DOCKER_COMPOSE_FILE up -d
}

function networkDown() {
  echo ">>> Stopping network and removing volumes..."
  docker-compose -f $DOCKER_COMPOSE_FILE down -v
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
    echo "Usage: ./networkGateway.sh up|down|start|stop"
    ;;
esac
