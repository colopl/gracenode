'use strict';

const net = require('net');
const gn = require('../gracenode');

const E_PORT_IN_USE = 'EADDRINUSE';

const DELIMITER = gn.Buffer.alloc(4);
DELIMITER[0] = 0xdd;
DELIMITER[1] = 0xcc;
DELIMITER[2] = 0xbb;
DELIMITER[3] = 0xaa;

const conf = {
    address: '127.0.0.1',
    port: 8100
};

var logger;
var info = {
    address: '',
    port: 0
};
var shutdown = false;
var server;
var clients = {};
var notifier;
var rcvbuffer = null;

module.exports = {
    config: config,
    setup: setup,
    emit: null,
    on: on,
    info: getInfo
};

function config(_conf) {
    logger = gn.log.create(
        'portal.broker.delivery.tcp'
    );
    if (_conf.address) {
        conf.address = _conf.address;
    }
    if (_conf.port) {
        conf.port = _conf.port;
    }
    module.exports.emit = emit;
}

function setup(cb) {
    if (server) {
        server.close(function () {
            server = null;
            setup(cb);
        });
        return;
    }
    gn.onExit(function shutdownPortalTCP(next) {
        shutdown = true;
        for (var key in clients) {
            if (clients[key]) {
                clients[key].end();
            }
        }
        server.close();
        next();
    });
    server = new net.createServer(_onConnection);
    server.on('error', _onError.bind({ cb: cb }));
    server.on('listening', _onListening.bind({ cb: cb }));
    server.listen({
        port: conf.port,
        address: conf.address,
        exclusive: true
    });
}

function getInfo() {
    return {
        address: info.address,
        port: info.port
    };
}

function emit(addr, port, packed, isResponse) {
    logger.sys(
        'Emitting to', addr, port,
        'as response', isResponse ? true : false
    );
    // add sender informantion bytes
    var senderBytes = senderToBytes(info.address, info.port);
    var buf = Buffer.concat([ packed, senderBytes, DELIMITER ]);
    var key = addr + '/' + port;
    if (!clients[key]) {
        clients[key] = _createConnectionAndEmit(
            addr,
            port,
            buf
        );
        return;
    }
    if (shutdown) {
        return;
    }
    clients[key].write(buf, _onClientWrite.bind({ key: key }));
}

function on(_notifier) {
    notifier = _notifier;
}

function _createConnectionAndEmit(addr, port, packed) {
    var key = addr + '/' + port;
    var conn = new net.Socket();
    conn.on('error', _onClientError.bind({ key: key }));
    conn.on('close', _onClientClose.bind({ key: key }));
    conn.connect(port, addr, _onClientConnect.bind({
        conn: conn,
        key: key,
        packed: packed
    }));
}

function _onClientConnect() {
    var conn = this.conn;
    var key = this.key;
    var packed = this.packed;
    clients[key] = conn;
    if (shutdown) {
        return;
    }
    conn.write(packed, _onClientWrite.bind({ key: key }));
}

function _onClientError(error) {
    var key = this.key;
    logger.error('Client error', error);
    delete clients[key];
}

function _onClientClose() {
    var key = this.key;
    delete clients[key];
}

function _onClientWrite(error) {
    if (error) {
        logger.sys('Error writing to', key, error);
        var key = this.key;
        delete clients[key];
    }
}

function _onConnection(conn) {
    logger.sys('Mesh network TCP new connection accepted');
    conn.on('error', _onConnError);
    conn.on('end', _onEnd.bind({ conn: conn }));
    conn.on('data', _onData);
}

function _onConnError(error) {
    logger.error('Server connection error', error);
    setup(function () {
        logger.info('Server recovered');
    });
}

function _onEnd() {
    var conn = this.conn;
    conn.removeAllListeners();
    logger.sys('Mesh network TCP client closed');
}

function _onData(buf) {
    if (!buf) {
        // there's nothing to read...
        return;
    }
    if (rcvbuffer) {
        rcvbuffer = Buffer.concat([ rcvbuffer, buf ]);
    } else {
        rcvbuffer = buf;
    }
    var readBufferList = _readBufferToList();
    for (var i = 0, len = readBufferList.length; i < len; i++) {
        var readBuffer = readBufferList[i];
        // last 6 bytes is the sender information
        var senderBytes = readBuffer.slice(readBuffer.length - 6);
        // remove last 6 bytes now...
        readBuffer = readBuffer.slice(0, readBuffer.length - 6);
        // get sender address and port
        var sender = bytesToSender(senderBytes);
        // handle the rest now
        var resp = _onMessageResponse.bind({ sender: sender });
        notifier(readBuffer, resp);
    }
}

function _readBufferToList() {
    var index = rcvbuffer.indexOf(DELIMITER);
    var list = [];
    while (index > -1) {
        list.push(rcvbuffer.slice(0, index));
        // 4 = 4-byte long DELIMITER
        rcvbuffer = rcvbuffer.slice(index + 4);
        index = rcvbuffer.indexOf(DELIMITER);
    }
    return list;
}

function _onMessageResponse(payload) {
    var sender = this.sender;
    emit(
        sender.address,
        sender.port,
        payload,
        true
    );
}

function _onError(error) {
    var cb = this.cb;
    if (error.code === E_PORT_IN_USE) {
        conf.port += 1;
        setup(cb);
        return;
    }
    logger.error('Mesh network TCP error:', error);
    cb(error);
}

function _onListening() {
    var cb = this.cb;
    info.address = conf.address;
    info.port = conf.port;
    logger.info('Mesh network TCP ready:', info);
    cb();
}

function senderToBytes(addr, port) {
    var list = addr.split('.');
    var abuf = gn.Buffer.alloc(4);
    var pbuf = gn.Buffer.alloc(2);
    abuf.writeUInt8(list[0], 0);
    abuf.writeUInt8(list[1], 1);
    abuf.writeUInt8(list[2], 2);
    abuf.writeUInt8(list[3], 3);
    pbuf.writeUInt16BE(port);
    return Buffer.concat([ abuf, pbuf ]);
}

function bytesToSender(buf) {
    var list = [];
    for (var i = 0; i < 4; i++) {
        list.push(buf.readUInt8(i));
    }
    return {
        address: list.join('.'),
        port: buf.readUInt16BE(4)
    };
}

