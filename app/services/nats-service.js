const { connect, StringCodec, JSONCodec } = require("nats");

class NatsService {
  constructor(orgName) {
    this.orgName = orgName;
    this.connection = null;
    this.jsm = null;
    this.js = null;
    this.kv = null;
    this.sc = StringCodec();
    this.jc = JSONCodec();

    this.servers = {
      org1: "nats://nats.org1.esign.com:4222",
      org2: "nats://nats.org2.esign.com:4222",
    };
  }

  async connect() {
    try {
      const server = this.servers[this.orgName.toLowerCase()];

      if (!server) {
        throw new Error(`Invalid organization: ${this.orgName}`);
      }

      this.connection = await connect({
        servers: [server],
        name: `${this.orgName}-client`,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
      });

      console.log(`Connected to NATS JetStream for ${this.orgName}`);
      console.log(`Server: ${server}`);

      this.jsm = await this.connection.jetstreamManager();
      this.js = this.connection.jetstream();
      this.setupEventListeners();

      await this.initKV();

      return this.connection;
    } catch (error) {
      console.error(
        `Failed to connect to NATS for ${this.orgName}:`,
        error.message
      );
      throw error;
    }
  }

  async initKV() {
    const bucket = `WEBHOOK_STATUS_${this.orgName.toUpperCase()}`;

    try {
      this.kv = await this.js.views.kv(bucket);
      console.log(`KV bucket '${bucket}' loaded`);
    } catch (err) {
      this.kv = await this.js.views.kv(bucket, {
        history: 10,
        ttl: 0,
        max_bytes: 10 * 1024 * 1024,
      });
      console.log(`KV bucket '${bucket}' created`);
    }
  }

  setupEventListeners() {
    this.connection.closed().then((err) => {
      if (err) {
        console.log(`NATS connection closed with error: ${err.message}`);
      } else {
        console.log(`NATS connection closed gracefully`);
      }
    });
    (async () => {
      for await (const s of this.connection.status()) {
        console.log(`NATS status: ${s.type}: ${s.data}`);
      }
    })().then();
  }

  async createStream(streamName, subjects) {
    try {
      const config = {
        name: streamName,
        subjects: subjects,
        retention: "limits",
        max_age: 86400000000000,
        storage: "file",
        max_msgs: 100000,
        discard: "old",
      };

      if (streamName.includes("WEBHOOK_QUEUE")) {
        config.retention = "workqueue";
        config.max_age = 604800000000000;
      }

      await this.jsm.streams.add(config);

      console.log(`Stream '${streamName}' created for ${this.orgName}`);
    } catch (error) {
      if (error.message.includes("already in use")) {
        console.log(
          `Stream '${streamName}' already exists for ${this.orgName}`
        );
      } else {
        console.error(`Error creating stream '${streamName}':`, error.message);
        throw error;
      }
    }
  }

  async createConsumer(streamName, consumerName, filterSubject) {
    try {
      await this.jsm.consumers.add(streamName, {
        durable_name: consumerName,
        filter_subject: filterSubject,
        ack_policy: "explicit",
        max_deliver: 3,
        ack_wait: 30000000000,
      });
      console.log(`Consumer '${consumerName}' created for ${this.orgName}`);
    } catch (error) {
      if (error.message.includes("already in use")) {
        console.log(
          `Consumer '${consumerName}' already exists for ${this.orgName}`
        );
      } else {
        console.error(
          `Error creating consumer '${consumerName}':`,
          error.message
        );
        throw error;
      }
    }
  }

  async publish(subject, data) {
    try {
      const ack = await this.js.publish(subject, this.jc.encode(data));
      console.log(`Published to ${subject}:`, {
        stream: ack.stream,
        seq: ack.seq,
        org: this.orgName,
      });
      return ack;
    } catch (error) {
      console.error(`Error publishing to ${subject}:`, error.message);
      return null;
    }
  }

  async subscribe(streamName, consumerName, callback) {
    try {
      const consumer = await this.js.consumers.get(streamName, consumerName);
      const messages = await consumer.consume();

      (async () => {
        for await (const msg of messages) {
          const deliveryCount = msg.info?.deliveryCount || 1;

          try {
            const data = this.jc.decode(msg.data);
            console.log(`Received message from ${this.orgName}:`, {
              subject: msg.subject,
              seq: msg.seq,
              deliveryCount,
            });
            await callback(data, msg);
          } catch (error) {
            console.error(
              `[${this.orgName}] FATAL error processing message (attempt ${deliveryCount}):`,
              error.message
            );

            await this.publish(`fabric.${this.orgName}.dlq`, {
              subject: msg.subject,
              error: error.message,
              data: msg.data.toString(),
              retries: deliveryCount,
              timestamp: new Date().toISOString(),
              fatal: true,
            });
          }
        }
      })();
    } catch (error) {
      console.error(`Error subscribing to stream:`, error.message);
      throw error;
    }
  }

  async close() {
    if (this.connection) {
      await this.connection.close();
      console.log(`NATS connection closed for ${this.orgName}`);
    }
  }

  async getStreamInfo(streamName) {
    try {
      const stream = await this.jsm.streams.info(streamName);
      return stream;
    } catch (error) {
      console.error(`Error getting stream info:`, error.message);
      throw error;
    }
  }

  async listStreams() {
    try {
      const streams = await this.jsm.streams.list().next();
      return streams;
    } catch (error) {
      console.error(`Error listing streams:`, error.message);
      throw error;
    }
  }
}

module.exports = NatsService;
