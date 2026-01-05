const path = require('path');

// Fabric network configuration with multi-org support and CA TLS
const config = {
    // Network details
    channelName: 'e-sign-channel',
    chaincodeName: 'basic',
    
    // TLS CA Configuration (separate CA for TLS certificates)
    tlsCA: {
        name: 'tlsca-esign',
        url: 'https://ca_tls:10054',
        port: 10054,
        caName: 'tlsca-esign',
        paths: {
            tlsCert: path.resolve(__dirname, '..', '..', 'data-ca-tls', 'ca-cert.pem'),
            wallet: path.join(process.cwd(), 'wallet-tls')
        }
    },
    
    // Organizations configuration
    organizations: {
        org1: {
            name: 'Org1',
            mspId: 'Org1MSP',
            domain: 'org1.esign.com',
            caPort: 7054,
            caName: 'ca-org1',
            collections: {
                documents: 'collectionOrg1',
                logs: 'collectionOrg1Log'
            },
            paths: {
                connectionProfile: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'connection-org1.json'),
                wallet: path.join(process.cwd(), 'wallet-org1'),
                certificates: {
                    // TLS CA certificates (actual file name)
                    tlsCACerts: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'msp', 'tlscacerts', 'tlsca-esign.pem'),
                    // Individual peer TLS certificates
                    peer0TLS: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'peers', 'peer0.org1.esign.com', 'tls', 'ca.crt'),
                    peer1TLS: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'peers', 'peer1.org1.esign.com', 'tls', 'ca.crt'),
                    // CA TLS certificate (untuk enrollment CA)
                    caTLS: path.resolve(__dirname, '..', '..', 'ca', 'ca-org1', 'data-org1', 'tls-cert.pem'),
                    // Global TLS CA certificate (separate TLS CA)
                    globalTLSCA: path.resolve(__dirname, '..', '..', 'data-ca-tls', 'ca-cert.pem')
                }
            },
            endpoints: {
                peers: {
                    peer0: {
                        url: 'grpcs://peer0.org1.esign.com:7051',
                        hostname: 'peer0.org1.esign.com',
                        // TLS options
                        tlsEnabled: true,
                        tlsCert: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'peers', 'peer0.org1.esign.com', 'tls', 'ca.crt')
                    },
                    peer1: {
                        url: 'grpcs://peer1.org1.esign.com:8051',
                        hostname: 'peer1.org1.esign.com',
                        tlsEnabled: true,
                        tlsCert: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org1.esign.com', 'peers', 'peer1.org1.esign.com', 'tls', 'ca.crt')
                    }
                },
                ca: {
                    url: 'https://ca_org1:7054',
                    name: 'ca-org1',
                    tlsEnabled: true,
                    tlsCert: path.resolve(__dirname, '..', '..', 'ca', 'ca-org1', 'data-org1', 'tls-cert.pem')
                }
            }
        },
        org2: {
            name: 'Org2',
            mspId: 'Org2MSP',
            domain: 'org2.esign.com',
            caPort: 8054,
            caName: 'ca-org2',
            collections: {
                documents: 'collectionOrg2',
                logs: 'collectionOrg2Log'
            },
            paths: {
                connectionProfile: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'connection-org2.json'),
                wallet: path.join(process.cwd(), 'wallet-org2'),
                certificates: {
                    // TLS CA certificates (actual file name - same for both orgs)
                    tlsCACerts: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'msp', 'tlscacerts', 'tlsca-esign.pem'),
                    // Individual peer TLS certificates
                    peer0TLS: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'peers', 'peer0.org2.esign.com', 'tls', 'ca.crt'),
                    peer1TLS: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'peers', 'peer1.org2.esign.com', 'tls', 'ca.crt'),
                    // CA TLS certificate (untuk enrollment CA)
                    caTLS: path.resolve(__dirname, '..', '..', 'ca', 'ca-org2', 'data-org2', 'tls-cert.pem'),
                    // Global TLS CA certificate (separate TLS CA)
                    globalTLSCA: path.resolve(__dirname, '..', '..', 'data-ca-tls', 'ca-cert.pem')
                }
            },
            endpoints: {
                peers: {
                    peer0: {
                        url: 'grpcs://peer0.org2.esign.com:9051',
                        hostname: 'peer0.org2.esign.com',
                        // TLS options
                        tlsEnabled: true,
                        tlsCert: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'peers', 'peer0.org2.esign.com', 'tls', 'ca.crt')
                    },
                    peer1: {
                        url: 'grpcs://peer1.org2.esign.com:10051',
                        hostname: 'peer1.org2.esign.com',
                        tlsEnabled: true,
                        tlsCert: path.resolve(__dirname, '..', '..', 'organizations', 'peerOrganizations', 'org2.esign.com', 'peers', 'peer1.org2.esign.com', 'tls', 'ca.crt')
                    }
                },
                ca: {
                    url: 'https://ca_org2:8054',
                    name: 'ca-org2',
                    tlsEnabled: true,
                    tlsCert: path.resolve(__dirname, '..', '..', 'ca', 'ca-org2', 'data-org2', 'tls-cert.pem')
                }
            }
        }
    },
    
    // Default organization (backward compatibility)
    defaultOrg: 'org1',
    
    // CA admin credentials
    caAdmin: {
        enrollmentID: 'admin',
        enrollmentSecret: 'adminpw'
    },
    
    // TLS CA admin credentials
    tlsCAAdmin: {
        enrollmentID: 'admin',
        enrollmentSecret: 'adminpw'
    },
    
    // Connection timeout settings and TLS options
    timeout: {
        peer: {
            endorser: '300'
        }
    },
    
    // Global TLS settings
    tls: {
        enabled: true,
        // Connection options for better TLS handling
        connectionOptions: {
            'grpc.keepalive_time_ms': 120000,
            'grpc.keepalive_timeout_ms': 20000,
            'grpc.keepalive_permit_without_calls': true,
            'grpc.http2.max_pings_without_data': 0,
            'grpc.http2.min_time_between_pings_ms': 10000,
            'grpc.http2.min_ping_interval_without_data_ms': 5000,
            'grpc.ssl_target_name_override_authority': false
        }
    }
};

// Helper functions
config.getOrgConfig = function(orgName = null) {
    const org = orgName || this.defaultOrg;
    if (!this.organizations[org]) {
        throw new Error(`Organization ${org} not found in configuration`);
    }
    return this.organizations[org];
};

config.getAllOrgs = function() {
    return Object.keys(this.organizations);
};

// New helper function for TLS CA
config.getTLSCAConfig = function() {
    return this.tlsCA;
};

// Helper function to get TLS-enabled peer configuration
config.getPeerTLSConfig = function(orgName, peerName) {
    const org = this.getOrgConfig(orgName);
    const peer = org.endpoints.peers[peerName];
    
    if (!peer || !peer.tlsEnabled) {
        throw new Error(`TLS-enabled peer ${peerName} not found for org ${orgName}`);
    }
    
    // Try to use organization's TLS CA cert first, fallback to peer-specific cert
    let tlsCertPath = org.paths.certificates.tlsCACerts;
    if (!require('fs').existsSync(tlsCertPath)) {
        tlsCertPath = peer.tlsCert;
    }
    
    return {
        url: peer.url,
        tlsCACerts: {
            pem: require('fs').readFileSync(tlsCertPath).toString()
        },
        grpcOptions: {
            'ssl-target-name-override': peer.hostname,
            ...this.tls.connectionOptions
        }
    };
};

// Helper function to get CA TLS configuration
config.getCATLSConfig = function(orgName) {
    const org = this.getOrgConfig(orgName);
    const ca = org.endpoints.ca;
    
    if (!ca.tlsEnabled) {
        throw new Error(`TLS-enabled CA not found for org ${orgName}`);
    }
    
    return {
        url: ca.url,
        tlsCACerts: {
            pem: require('fs').readFileSync(ca.tlsCert).toString()
        },
        caName: ca.name
    };
};

// Legacy properties for backward compatibility
Object.defineProperty(config, 'channelName', { value: config.channelName });
Object.defineProperty(config, 'chaincodeName', { value: config.chaincodeName });
Object.defineProperty(config, 'organization', { 
    get: function() { return this.getOrgConfig(this.defaultOrg); }
});
Object.defineProperty(config, 'paths', { 
    get: function() { return this.getOrgConfig(this.defaultOrg).paths; }
});
Object.defineProperty(config, 'endpoints', { 
    get: function() { return this.getOrgConfig(this.defaultOrg).endpoints; }
});

module.exports = config;