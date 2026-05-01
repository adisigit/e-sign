FROM node:22

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Upgrade npm
RUN npm install -g npm@11.7.0

# Install fabric-gateway dan grpc DULU (sebelum caliper)
RUN npm install -g \
    @hyperledger/fabric-gateway@1.7.1 \
    @grpc/grpc-js@1.13.1

# Install caliper CLI dan core
RUN npm install -g \
    @hyperledger/caliper-cli@0.7.1 \
    @hyperledger/caliper-core@0.7.1

# Create a temp bind directory so caliper bind has a valid cwd
RUN mkdir -p /caliper-bind

# Bind Fabric 2.5 — use the temp dir, NOT the volume-mounted workspace
RUN caliper bind --caliper-bind-sut fabric:2.5 --caliper-bind-cwd /caliper-bind

WORKDIR /workspace

CMD ["caliper"]