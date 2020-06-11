'use strict'

import Packet from './packet.js'

const BUFF_SIZE = 128;
const WINDOW_SIZE = 32;
const IN_BUFFER = 4;
const LIMIT_NUM = 100
const LIMIT = false

class CircularBuffer {
    constructor() {
        this.requested_packet = -1; // Packet counter

        this.buffer_size = BUFF_SIZE; // Number of samples in each packet
        this.window_size = WINDOW_SIZE; // Max number of packets that can be stored in the queue simultaneously
        this.size = this.buffer_size * this.window_size; // Size of the circular buffer
        this.currDimm = 0; // Current size of the buffer
        this.queue = new Float32Array(this.size) // Buffer
        this.marker = new Array(this.window_size); // Array to keep track if there is a packet or not

        // Initialize marker
        for(let i=0; i<this.window_size; i++) {
            this.marker[i] = false;
        }
    }

    enqueue(packet_n, samples) {
        // If i try to enqueue a previous packet or a packet which is too early i discard it
        if((packet_n > this.requested_packet) && (packet_n < this.requested_packet+this.window_size)) {
            // Set the packet as present
            this.marker[packet_n%this.window_size] = true;

            // Calculate starting point of the packet in the queue
            let start = (packet_n%this.window_size) * this.buffer_size;

            // Set the data
            for(let j = 0; j < this.buffer_size; j++, start++) {
                this.queue[start] = samples[j];
            }
            //console.log("Packet stored");
        }
        else {
            //console.log("Packet dropped");
        }
    }

    dequeue(packet_n) {
        // Set the packet as no more present since consumed
        this.marker[packet_n%this.window_size] = false;

        // Calculate starting point of the packet in the queue
        let start = (packet_n%this.window_size) * this.buffer_size;

        // Get the buffer
        let buff = new Float32Array(this.buffer_size);

        // Get values from the queue and reset the queue
        for(let j = 0; j < this.buffer_size; j++, start++) {
            buff[j] = this.queue[start];
            this.queue[start] = 0;
        }

        // Return the buffer
        return buff;
    }

    hasData(packet_n) {
        // Update requested packet
        this.requested_packet = packet_n;

        // Return if data is present or not
        return this.marker[packet_n%this.window_size];
    }
}

class DataReceiverProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.n = 0; // Counter to decide when to start
        this.packet_n = 0; // Packet number
        this.queue = new CircularBuffer(); // CircularBuffer
        this.begin = false; // Flag to decide whether to start or not the playback

        this.port.onmessage = (event) => {
            let obj = event.data;

            switch(obj.type) {
                case 'packet':
                    // Receive the array buffer
                    let data = Packet.parse(obj.data);

                    // Load data in the queue
                    this.queue.enqueue(data.packet_n, data.samples);
                    this.n++;

                    // I received IN_BUFFER packets => start the playback
                    if(this.n >= IN_BUFFER) {
                        this.begin = true;
                    }

                    break;
                default:
                    // Nothing to do
            }
        };

        // Send packetNumber to DataNode
        this.port.postMessage({
            packet_n: this.packet_n
        });

    }

    process(inputs, outputs, parameters) {
        // The processor may have multiple outputs. Get the first output.
        const output = outputs[0][0];

        // Check whete or not to start playback
        if(this.begin) {

            // Check if packet is present
            if(this.queue.hasData(this.packet_n)) {
                // Get samples
                let buff = this.queue.dequeue(this.packet_n);

                // Process output data
                for(let i = 0; i<BUFF_SIZE; i++) {
                    output[i] = buff[i];
                }
            }

            // Update packet number to request
            this.packet_n++;

            // Send packetNumber to DataNode
            this.port.postMessage({
                packet_n: this.packet_n
            });
        }

        // For test purposes
        if(LIMIT === true && this.packet_n === LIMIT_NUM) {
            return false;
        }
        // To keep this processor alive.
        return true;
    }
}

registerProcessor('data-receiver-processor', DataReceiverProcessor);
