const { connect, StringCodec, JSONCodec } = require('nats');

class NatsService {
  constructor(orgName) {
    this.orgName = orgName;
    this.connection = null;
    this.jsm = null;
    this.js = null;
    this.sc = StringCodec();
    this.jc = JSONCodec();

    this.servers = {
      org1: 'nats://localhost:4222',
      org2: 'nats://localhost:4223'
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
        reconnectTimeWait: 2000
      });

      console.log(`Connected to NATS JetStream for ${this.orgName}`);
      console.log(`Server: ${server}`);

      this.jsm = await this.connection.jetstreamManager();
      this.js = this.connection.jetstream();
      this.setupEventListeners();

      return this.connection;
    } catch (error) {
      console.error(`Failed to connect to NATS for ${this.orgName}:`, error.message);
      throw error;
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
      await this.jsm.streams.add({
        name: streamName,
        subjects: subjects,
        retention: 'limits',
        max_age: 86400000000000,
        storage: 'file',
        max_msgs: 100000,
        discard: 'old'
      });
      console.log(`Stream '${streamName}' created for ${this.orgName}`);
    } catch (error) {
      if (error.message.includes('already in use')) {
        console.log(`Stream '${streamName}' already exists for ${this.orgName}`);
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
        ack_policy: 'explicit',
        max_deliver: 3,
        ack_wait: 30000000000
      });
      console.log(`Consumer '${consumerName}' created for ${this.orgName}`);
    } catch (error) {
      if (error.message.includes('already in use')) {
        console.log(`Consumer '${consumerName}' already exists for ${this.orgName}`);
      } else {
        console.error(`Error creating consumer '${consumerName}':`, error.message);
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
        org: this.orgName
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
      
      console.log(`Subscribed to stream '${streamName}' consumer '${consumerName}' for ${this.orgName}`);
      (async () => {
        for await (const msg of messages) {
          try {
            const data = this.jc.decode(msg.data);
            
            console.log(`Received message from ${this.orgName}:`, {
              subject: msg.subject,
              seq: msg.seq,
              data: data
            });
            await callback(data, msg);
            msg.ack();
          } catch (error) {
            console.error(`Error processing message:`, error.message);
            msg.nak();
          }
        }
      })().catch((error) => {
        console.error(`Error in message loop:`, error.message);
      });

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